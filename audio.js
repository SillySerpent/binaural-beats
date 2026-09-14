/* Shared by the live player and OfflineAudioContext audio tests. */
'use strict';
window.BinauralAudio = (() => {
  function validate(beat, volume, ear, carrier) {
    if (!Number.isFinite(beat) || beat < 1 || beat > 40) throw new RangeError('Beat must be between 1 and 40 Hz.');
    if (!Number.isFinite(volume) || volume < 0 || volume > 0.5) throw new RangeError('Volume must be between 0 and 0.5.');
    if (!['both', 'left', 'right'].includes(ear)) throw new RangeError('Unknown ear selection.');
    if (!Number.isFinite(carrier) || carrier < 100 || carrier > 1000) throw new RangeError('Carrier must be between 100 and 1000 Hz.');
  }

  function createVoice(context, { beat = 40, volume = 0.1, ear = 'both', carrier = 200 } = {}) {
    validate(beat, volume, ear, carrier);
    const merger = context.createChannelMerger(2);
    const master = context.createGain();
    const envelope = context.createGain();
    const transportGain = context.createGain();
    master.gain.value = volume;
    envelope.gain.value = 0;
    // Each mono oscillator has exactly one destination channel. No mono mix.
    const oscillators = ['left', 'right'].map((side, index) => {
      const oscillator = context.createOscillator();
      const channelGain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = index === 0 ? carrier : carrier + beat;
      channelGain.gain.value = ear === 'both' || ear === side ? 1 : 0;
      oscillator.connect(channelGain);
      channelGain.connect(merger, 0, index);
      return oscillator;
    });
    merger.connect(master);
    master.connect(envelope);
    envelope.connect(transportGain);
    transportGain.connect(context.destination);
    let started = false;
    let startAt = 0;
    let stopAt = Infinity;
    let studyScheduled = false;
    return {
      start(at = context.currentTime) {
        if (started) return;
        started = true;
        startAt = at;
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(1, at + 0.04);
        oscillators.forEach(oscillator => oscillator.start(at));
      },
      update(nextBeat, nextVolume) {
        validate(nextBeat, nextVolume, ear, carrier);
        if (context.currentTime >= stopAt) return;
        if (studyScheduled) throw new Error('Stop the study session before changing its frequency.');
        oscillators[1].frequency.setTargetAtTime(carrier + nextBeat, context.currentTime, 0.025);
        master.gain.setTargetAtTime(nextVolume, context.currentTime, 0.025);
      },
      setVolume(nextVolume) {
        validate(beat, nextVolume, ear, carrier);
        if (context.currentTime < stopAt) master.gain.setTargetAtTime(nextVolume, context.currentTime, 0.025);
      },
      setMuted(muted) {
        const at = context.currentTime;
        transportGain.gain.cancelAndHoldAtTime(at);
        transportGain.gain.linearRampToValueAtTime(muted ? 0 : 1, at + 0.04);
      },
      scheduleStudy(plan) {
        if (!started || studyScheduled || context.currentTime >= stopAt) throw new Error('Study scheduling requires a fresh, started voice.');
        studyScheduled = true;
        const frequency = oscillators[1].frequency;
        frequency.cancelScheduledValues(startAt);
        for (const { time, beat: targetBeat, ramp } of plan.transitions) {
          if (ramp) frequency.linearRampToValueAtTime(carrier + targetBeat, startAt + time);
          else frequency.setValueAtTime(carrier + targetBeat, startAt + time);
        }
      },
      stop(at = context.currentTime) {
        if (!started || at >= stopAt) return;
        stopAt = at;
        envelope.gain.cancelAndHoldAtTime(at);
        // Anchor the fade explicitly. A future ramp must not begin at the
        // previous automation event (which could be the session's fade-in).
        envelope.gain.setValueAtTime(Math.min(1, Math.max(0, (at - startAt) / 0.04)), at);
        envelope.gain.linearRampToValueAtTime(0, at + 0.06);
        oscillators.forEach(oscillator => oscillator.stop(at + 0.07));
        oscillators[1].onended = () => {
          oscillators.forEach(oscillator => oscillator.disconnect());
          merger.disconnect(); master.disconnect(); envelope.disconnect();
          transportGain.disconnect();
        };
      },
    };
  }
  return { createVoice };
})();
