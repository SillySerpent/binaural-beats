'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const beatInput = $('beat'), volumeInput = $('volume'), durationInput = $('duration');
  const carrierInput = $('carrier'), roundsInput = $('rounds'), playButton = $('play');
  const modeButtons = [...document.querySelectorAll('[data-session]')];
  const presetButtons = [...document.querySelectorAll('[data-beat]')];
  const carriers = { manual: 200, study: 400 };
  let mode = 'manual';
  let context, voice, activePlan, startedAt = 0, finishAt = 0, interval, endingTimer;
  let busy = false, paused = false, generation = 0, currentEar = 'both';
  const beat = () => mode === 'study' ? 40 : Number(beatInput.value);
  const carrier = () => Number(carrierInput.value);
  // UI percentage maps to a capped amplitude: default 20% = 0.1 peak.
  const volume = () => Number(volumeInput.value) / 200;
  const formatTime = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  const formatHz = value => Number(value.toFixed(1)).toString();

  function displayFrequency(value) {
    $('beat-value').textContent = formatHz(value);
    $('custom-value').textContent = `${formatHz(value)} Hz`;
    $('left-frequency').textContent = `${carrier()} Hz`;
    $('right-frequency').textContent = `${formatHz(carrier() + value)} Hz`;
    presetButtons.forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.beat) === value));
  }

  function setStatus(message) {
    if ($('status').textContent !== message) $('status').textContent = message;
  }

  function refreshControls() {
    const active = Boolean(voice) || busy;
    const study = mode === 'study';
    modeButtons.forEach(button => {
      button.disabled = active;
      button.setAttribute('aria-pressed', button.dataset.session === mode);
    });
    presetButtons.forEach(button => { button.disabled = study || busy; });
    beatInput.disabled = study || busy;
    carrierInput.disabled = active;
    roundsInput.disabled = active;
    durationInput.disabled = active;
    $('test-left').disabled = busy;
    $('test-right').disabled = busy;
    $('study-settings').hidden = !study;
    $('manual-settings').hidden = study;
    $('study-progress').hidden = !study;
    $('manual-frequencies').hidden = study;
    $('manual-slider').hidden = study;
    playButton.disabled = busy;
    playButton.textContent = voice ? 'Stop session' : study ? 'Start study' : 'Start session';
    $('pause').hidden = !activePlan || !voice;
    $('pause').disabled = busy;
    $('pause').textContent = paused ? 'Resume session' : 'Pause session';
  }

  function resetStudyDisplay() {
    $('study-phase').textContent = '25 minutes focus · 5 minutes break';
    $('study-timer').textContent = '25:00';
    $('phase-progress').value = 0;
    $('study-hint').textContent = `${roundsInput.value} rounds · ${Number(roundsInput.value) * 30} minutes total. Take a longer break after the session.`;
  }

  function stop(message = 'Ready when you are') {
    generation++;
    clearInterval(interval); clearTimeout(endingTimer);
    voice?.stop(); voice = null; activePlan = null;
    // A stopped, suspended graph must be discarded so it cannot sound again
    // when a new session resumes an audio context.
    if (paused && context) {
      const closingContext = context;
      context = null;
      if (closingContext.state !== 'closed') void closingContext.close();
    }
    paused = false;
    busy = false;
    document.body.classList.remove('playing', 'resting');
    document.title = 'Still — Binaural Beats';
    setStatus(message);
    $('elapsed').textContent = '00:00';
    displayFrequency(beat());
    resetStudyDisplay();
    refreshControls();
  }

  function tick() {
    if (!voice) return;
    const now = context.currentTime;
    if (finishAt && now >= finishAt) {
      const studyFinished = Boolean(activePlan);
      stop(studyFinished ? 'Study complete — time for a longer break' : currentEar === 'both' ? 'Session complete' : 'Headphone check complete');
      if (studyFinished) {
        $('study-phase').textContent = 'All rounds complete';
        $('study-timer').textContent = '00:00';
        $('phase-progress').value = 1;
      }
      return;
    }
    if (activePlan) {
      const state = activePlan.stateAt(now - startedAt);
      const phase = state.phase === 'focus' ? 'Focus' : 'Break';
      const time = formatTime(Math.ceil(state.remaining));
      const phaseLabel = `${phase} · round ${state.round} of ${activePlan.rounds}`;
      setStatus(paused ? `Paused · ${phaseLabel}` : phaseLabel);
      $('study-phase').textContent = phaseLabel;
      $('study-timer').textContent = time;
      $('phase-progress').value = state.progress;
      $('study-hint').textContent = paused ? 'Audio and timer are paused. Resume whenever you’re ready.' : state.phase === 'focus'
        ? 'Stay with one task. Your break starts automatically.'
        : 'Step away, stretch, or rest your eyes. Focus returns automatically.';
      document.body.classList.toggle('resting', state.phase === 'break');
      document.title = `${paused ? 'Paused · ' : ''}${time} ${phase} — Still`;
      displayFrequency(state.beat);
    }
    $('elapsed').textContent = finishAt ? `${formatTime(Math.ceil(finishAt - now))} left` : formatTime(now - startedAt);
  }

  async function togglePause() {
    if (!voice || !activePlan || busy) return;
    const token = generation;
    const audioContext = context;
    const currentVoice = voice;
    busy = true;
    refreshControls();
    try {
      if (!paused) {
        paused = true;
        clearTimeout(endingTimer);
        currentVoice.setMuted(true);
        // Let the 40 ms fade reach silence before freezing the audio clock.
        await new Promise(resolve => setTimeout(resolve, 60));
        if (token !== generation) return;
        await audioContext.suspend();
      } else {
        await audioContext.resume();
        if (token !== generation) return;
        if (audioContext.state !== 'running') throw new Error('Audio could not resume. Please start the session again.');
        currentVoice.setMuted(false);
        paused = false;
        endingTimer = setTimeout(tick, Math.max(0, finishAt - audioContext.currentTime) * 1000 + 100);
      }
      if (token !== generation) return;
      document.body.classList.toggle('playing', !paused);
      tick();
    } catch (error) {
      if (token !== generation) return;
      stop('Audio interrupted');
      $('error').textContent = error.message;
      $('error').hidden = false;
    } finally {
      if (token === generation) {
        busy = false;
        refreshControls();
      }
    }
  }

  async function start(ear = 'both') {
    if (busy) return;
    stop();
    const token = ++generation;
    busy = true;
    refreshControls();
    $('error').hidden = true;
    setStatus('Starting audio…');
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('This browser does not support Web Audio. Open this app in Chrome, Safari, or Firefox.');
      if (!context || context.state === 'closed') {
        const audioContext = new AudioContextClass();
        context = audioContext;
        audioContext.addEventListener('statechange', () => {
          if (context === audioContext && voice && !paused && audioContext.state !== 'running') stop('Audio interrupted — start again to resume');
        });
      }
      await context.resume();
      if (token !== generation) return;
      if (context.state !== 'running') throw new Error('Audio could not start. Check your audio output and try again.');
      activePlan = mode === 'study' && ear === 'both' ? StudyCycle.createPlan({ rounds: Number(roundsInput.value) }) : null;
      voice = BinauralAudio.createVoice(context, { beat: beat(), carrier: carrier(), volume: volume(), ear });
      startedAt = context.currentTime;
      voice.start(startedAt);
      if (activePlan) voice.scheduleStudy(activePlan);
      currentEar = ear;
      const seconds = ear !== 'both' ? 2 : activePlan ? activePlan.duration : Number(durationInput.value) * 60;
      finishAt = seconds ? startedAt + seconds : 0;
      // All study transitions and the final stop are scheduled ahead on the
      // audio clock. UI timers only display progress; they never drive sound.
      if (finishAt) {
        voice.stop(finishAt);
        endingTimer = setTimeout(tick, seconds * 1000 + 100);
      }
      document.body.classList.add('playing');
      setStatus(ear === 'both' ? 'Playing · separate stereo tones' : `${ear === 'left' ? 'Left' : 'Right'} ear only · 2 seconds`);
      interval = setInterval(tick, 250);
      tick();
    } catch (error) {
      stop('Could not start audio');
      $('error').textContent = error.message;
      $('error').hidden = false;
    } finally {
      busy = false;
      refreshControls();
    }
  }

  function refreshManualFrequency() {
    displayFrequency(beat());
    voice?.update(beat(), volume());
  }
  modeButtons.forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.session;
    carrierInput.value = carriers[mode];
    stop();
  }));
  carrierInput.addEventListener('change', () => {
    carriers[mode] = carrier();
    displayFrequency(beat());
  });
  roundsInput.addEventListener('change', resetStudyDisplay);
  playButton.addEventListener('click', () => voice ? stop() : start());
  $('pause').addEventListener('click', togglePause);
  $('test-left').addEventListener('click', () => start('left'));
  $('test-right').addEventListener('click', () => start('right'));
  beatInput.addEventListener('input', refreshManualFrequency);
  volumeInput.addEventListener('input', () => {
    $('volume-value').textContent = `${volumeInput.value}%`;
    voice?.setVolume(volume());
  });
  presetButtons.forEach(button => button.addEventListener('click', () => {
    beatInput.value = button.dataset.beat;
    refreshManualFrequency();
  }));
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('pagehide', () => { stop(); context?.close(); });
  resetStudyDisplay();
  refreshControls();
})();
