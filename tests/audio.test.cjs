const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
let browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

test('rendered stereo contains the selected carrier left and offset right, without crosstalk', async () => {
  const page = await browser.newPage();
  await page.addScriptTag({ path: resolve('audio.js') });
  for (const [carrier, beat] of [[200, 1], [200, 2], [200, 6], [200, 10], [200, 20], [200, 40], [320, 40], [320, 10]]) {
    const result = await page.evaluate(async ({ carrier, beat }) => {
      const context = new OfflineAudioContext(2, 48000, 48000);
      const voice = BinauralAudio.createVoice(context, { carrier, beat, volume: 0.2 });
      voice.start();
      const buffer = await context.startRendering();
      function magnitude(samples, frequency) {
        let real = 0, imaginary = 0;
        for (let i = 0; i < samples.length; i++) {
          const phase = 2 * Math.PI * frequency * i / 48000;
          real += samples[i] * Math.cos(phase);
          imaginary += samples[i] * Math.sin(phase);
        }
        return 2 * Math.hypot(real, imaginary) / samples.length;
      }
      const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      return { left: magnitude(left, carrier), right: magnitude(right, carrier + beat),
        leakLeft: magnitude(left, carrier + beat), leakRight: magnitude(right, carrier) };
    }, { carrier, beat });
    assert.ok(result.left > 0.18 && result.right > 0.18, JSON.stringify({ beat, result }));
    assert.ok(result.leakLeft < 0.015 && result.leakRight < 0.015, JSON.stringify({ beat, result }));
  }
  await page.close();
});

test('headphone checks isolate the selected ear and stop fades to silence', async () => {
  const page = await browser.newPage();
  await page.addScriptTag({ path: resolve('audio.js') });
  for (const ear of ['left', 'right']) {
    const result = await page.evaluate(async (ear) => {
      const context = new OfflineAudioContext(2, 48000, 48000);
      const voice = BinauralAudio.createVoice(context, { beat: 40, volume: 0.2, ear });
      voice.start(); voice.stop(0.5);
      const buffer = await context.startRendering();
      const energy = (channel, from, to) => buffer.getChannelData(channel).slice(from, to).reduce((sum, v) => sum + v * v, 0);
      return { left: energy(0, 4800, 19200), right: energy(1, 4800, 19200), tail: energy(0, 33600, 48000) + energy(1, 33600, 48000) };
    }, ear);
    assert.ok(result[ear] > 1);
    assert.equal(result[ear === 'left' ? 'right' : 'left'], 0);
    assert.equal(result.tail, 0);
  }
  await page.close();
});

test('invalid audio settings are rejected before creating a voice', async () => {
  const page = await browser.newPage();
  await page.addScriptTag({ path: resolve('audio.js') });
  const rejected = await page.evaluate(() => {
    const context = new OfflineAudioContext(2, 100, 48000);
    return [{ beat: 0 }, { beat: 41 }, { beat: NaN }, { volume: -1 }, { volume: 2 }, { ear: 'other' }, { carrier: NaN }, { carrier: 0 }, { carrier: 1001 }].map(options => {
      try { BinauralAudio.createVoice(context, options); return false; } catch { return true; }
    });
  });
  assert.ok(rejected.every(Boolean));
  await page.close();
});

test('study audio renders 400/440 Hz focus and 400/410 Hz breaks on the audio clock', async () => {
  const page = await browser.newPage();
  await page.addScriptTag({ path: resolve('study.js') });
  await page.addScriptTag({ path: resolve('audio.js') });
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(2, 48000 * 12, 48000);
    const plan = StudyCycle.createPlan({ rounds: 2, focusSeconds: 2, breakSeconds: 4, transitionSeconds: 1 });
    const voice = BinauralAudio.createVoice(context, { carrier: 400, volume: 0.2 });
    voice.start(); voice.scheduleStudy(plan); voice.stop(plan.duration);
    // Rendering finishes without UI timers or callbacks driving phase changes.
    const buffer = await context.startRendering();
    function magnitude(channel, from, to, frequency) {
      let real = 0, imaginary = 0;
      for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++) {
        const value = buffer.getChannelData(channel)[i];
        const phase = 2 * Math.PI * frequency * i / 48000;
        real += value * Math.cos(phase); imaginary += value * Math.sin(phase);
      }
      return 2 * Math.hypot(real, imaginary) / ((to - from) * 48000);
    }
    return { focus: magnitude(1, 0.25, 0.75, 440), rest: magnitude(1, 3, 4, 410),
      returnFocus: magnitude(1, 6, 7, 440), secondRest: magnitude(1, 9, 10, 410),
      left: magnitude(0, 3, 4, 400), leak: magnitude(0, 3, 4, 410),
      // A 30 Hz downward sweep lasts one second. At its midpoint the tone is ~425 Hz.
      transition: magnitude(1, 2.45, 2.55, 425), returnTransition: magnitude(1, 5.45, 5.55, 425) };
  });
  for (const key of ['focus', 'rest', 'returnFocus', 'secondRest', 'left', 'transition', 'returnTransition']) assert.ok(result[key] > 0.18, JSON.stringify(result));
  assert.ok(result.leak < 0.001);
  await page.close();
});

test('study audio stays continuous before breaks, through transitions, and across rounds', async () => {
  const page = await browser.newPage();
  await page.addScriptTag({ path: resolve('study.js') });
  await page.addScriptTag({ path: resolve('audio.js') });
  for (const carrier of [200, 320, 400]) {
    const result = await page.evaluate(async carrier => {
      const context = new OfflineAudioContext(2, 48000 * 25, 48000);
      const plan = StudyCycle.createPlan({ rounds: 2, focusSeconds: 10, breakSeconds: 2, transitionSeconds: 0.5 });
      const voice = BinauralAudio.createVoice(context, { carrier, volume: 0.2 });
      voice.start(); voice.scheduleStudy(plan); voice.stop(plan.duration);
      const buffer = await context.startRendering();
      // Check every 10 ms window, including the former cue and every transition.
      // Exclude only the intentional start and final stop fades.
      return [0, 1].map(channel => {
        const samples = buffer.getChannelData(channel);
        let minimumPower = Infinity, weakestWindow = 0;
        for (let start = 4800; start + 480 <= plan.duration * 48000; start += 480) {
          let power = 0;
          for (let i = start; i < start + 480; i++) power += samples[i] * samples[i];
          power /= 480;
          if (power < minimumPower) { minimumPower = power; weakestWindow = start / 48000; }
        }
        return { minimumPower, weakestWindow };
      });
    }, carrier);
    for (const ear of result) assert.ok(ear.minimumPower > 0.015, JSON.stringify({ carrier, ...ear }));
  }
  await page.close();
});

test('study pause freezes the audio clock and break countdown, resumes, and stops cleanly', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.testAudioContext = this; }
    };
  });
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await page.evaluate(() => {
    const createPlan = StudyCycle.createPlan;
    StudyCycle.createPlan = options => createPlan({ ...options, focusSeconds: 2, breakSeconds: 4, transitionSeconds: 0.5 });
  });
  await page.getByRole('button', { name: 'Study · 25/5', exact: true }).click();
  await page.getByRole('button', { name: 'Start study', exact: true }).click();
  await page.getByRole('button', { name: 'Pause session', exact: true }).click({ timeout: 1500 });
  await page.waitForFunction(() => testAudioContext.state === 'suspended');
  const focusTime = await page.evaluate(() => testAudioContext.currentTime);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => testAudioContext.currentTime), focusTime);
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Break · round 1 of 4');
  await page.getByRole('button', { name: 'Pause session', exact: true }).click();
  await page.waitForFunction(() => testAudioContext.state === 'suspended');
  const pausedTime = await page.evaluate(() => testAudioContext.currentTime);
  const remaining = await page.locator('#study-timer').textContent();
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => testAudioContext.currentTime), pausedTime);
  assert.equal(await page.locator('#study-timer').textContent(), remaining);
  assert.match(await page.locator('#status').textContent(), /Paused.*Break/);
  await page.locator('#volume').fill('30');
  await page.getByRole('button', { name: 'Resume session', exact: true }).click();
  await page.waitForFunction(() => testAudioContext.state === 'running');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Focus · round 2 of 4');
  await page.getByRole('button', { name: 'Pause session', exact: true }).click();
  await page.getByRole('button', { name: 'Resume session', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop session', exact: true }).click();
  await page.waitForFunction(() => testAudioContext.state === 'closed');
  await page.getByRole('button', { name: 'Start study', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Focus · round 1 of 4');
  await page.getByRole('button', { name: 'Stop session', exact: true }).click();
  assert.deepEqual(errors, []);
  await page.close();
});

test('study mode starts with 400/440, locks manual controls, stops and restores manual mode', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('index.html')).href);
  await page.getByRole('button', { name: 'Study · 25/5', exact: true }).click();
  await page.locator('#carrier').selectOption('320', { timeout: 1000 });
  assert.equal(await page.locator('#left-frequency').textContent(), '320 Hz');
  assert.equal(await page.locator('#right-frequency').textContent(), '360 Hz');
  await page.getByRole('button', { name: 'Start study', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Focus · round 1'));
  assert.equal(await page.locator('#right-frequency').textContent(), '360 Hz');
  await page.getByRole('button', { name: 'Stop session', exact: true }).click();
  await page.locator('#carrier').selectOption('400');
  assert.equal(await page.locator('#left-frequency').textContent(), '400 Hz');
  assert.equal(await page.locator('#right-frequency').textContent(), '440 Hz');
  await page.locator('#rounds').selectOption('2');
  await page.getByRole('button', { name: 'Start study', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Focus · round 1 of 2'));
  assert.ok(await page.locator('#beat').isDisabled());
  assert.ok(await page.locator('#carrier').isDisabled());
  assert.ok(await page.locator('#rounds').isDisabled());
  await page.locator('#volume').fill('30');
  await page.getByRole('button', { name: 'Stop session', exact: true }).click();
  assert.ok(await page.locator('#rounds').isEnabled());
  await page.getByRole('button', { name: 'Manual', exact: true }).click();
  assert.ok(await page.locator('#beat').isEnabled());
  assert.equal(await page.locator('#left-frequency').textContent(), '200 Hz');
  assert.equal(await page.locator('#right-frequency').textContent(), '240 Hz');
  await page.getByRole('button', { name: 'Study · 25/5', exact: true }).click();
  await page.locator('#carrier').selectOption('200');
  assert.equal(await page.locator('#right-frequency').textContent(), '240 Hz');
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/study-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'test-results/study-desktop.png', fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
});

test('study UI follows focus, break, return, completion, and a fresh restart', async () => {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve('index.html')).href);
  // Exercise the real plan/audio/UI with shorter durations at the plan boundary.
  // Production still uses 1500/300/30 seconds, covered in study.test.cjs.
  await page.evaluate(() => {
    const createPlan = StudyCycle.createPlan;
    StudyCycle.createPlan = options => createPlan({ ...options, focusSeconds: 2, breakSeconds: 2, transitionSeconds: 0.5 });
  });
  await page.getByRole('button', { name: 'Study · 25/5', exact: true }).click();
  await page.locator('#rounds').selectOption('2');
  await page.getByRole('button', { name: 'Start study', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Focus · round 1 of 2');
  await page.waitForFunction(() => document.querySelector('#right-frequency').textContent === '410 Hz');
  assert.equal(await page.locator('#status').textContent(), 'Break · round 1 of 2');
  assert.ok(await page.locator('body').evaluate(body => body.classList.contains('resting')));
  await page.locator('#volume').fill('35');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Focus · round 2 of 2');
  assert.equal(await page.locator('#right-frequency').textContent(), '440 Hz');
  await page.waitForFunction(() => document.querySelector('#study-phase').textContent === 'All rounds complete');
  assert.equal(await page.locator('#study-timer').textContent(), '00:00');
  assert.equal(await page.title(), 'Still — Binaural Beats');
  await page.getByRole('button', { name: 'Start study', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Focus · round 1 of 2');
  await page.getByRole('button', { name: 'Stop session', exact: true }).click();
  await page.close();
});

test('study volume changes preserve the frequency schedule and stopping cancels later sound', async () => {
  const page = await browser.newPage();
  await page.addScriptTag({ path: resolve('study.js') });
  await page.addScriptTag({ path: resolve('audio.js') });
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(2, 48000 * 9, 48000);
    const plan = StudyCycle.createPlan({ rounds: 2, focusSeconds: 2, breakSeconds: 2, transitionSeconds: 0.5 });
    const voice = BinauralAudio.createVoice(context, { carrier: 400, volume: 0.2 });
    voice.start(); voice.scheduleStudy(plan); voice.stop(plan.duration);
    const suspended = context.suspend(1);
    const rendering = context.startRendering();
    await suspended;
    voice.setVolume(0.1);
    voice.stop(5);
    await context.resume();
    const buffer = await rendering;
    const right = buffer.getChannelData(1);
    let real = 0, imaginary = 0;
    for (let i = 3 * 48000; i < 3.5 * 48000; i++) {
      real += right[i] * Math.cos(2 * Math.PI * 410 * i / 48000);
      imaginary += right[i] * Math.sin(2 * Math.PI * 410 * i / 48000);
    }
    return { amplitude: 2 * Math.hypot(real, imaginary) / 24000,
      tail: [0, 1].map(channel => buffer.getChannelData(channel).slice(6 * 48000).reduce((sum, value) => sum + value * value, 0)) };
  });
  assert.ok(result.amplitude > 0.095 && result.amplitude < 0.105, JSON.stringify(result));
  assert.deepEqual(result.tail, [0, 0]);
  await page.close();
});

test('a timed voice can change frequency and volume and still stop early', async () => {
  const page = await browser.newPage();
  await page.addScriptTag({ path: resolve('audio.js') });
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(2, 48000, 48000);
    const voice = BinauralAudio.createVoice(context, { beat: 40, volume: 0.1 });
    voice.start(); voice.stop(0.9);
    const suspended = context.suspend(0.2);
    const rendering = context.startRendering();
    await suspended;
    voice.update(10, 0.3);
    voice.stop(0.6);
    await context.resume();
    const buffer = await rendering;
    const samples = buffer.getChannelData(1);
    let real = 0, imaginary = 0;
    for (let i = 19200; i < 28800; i++) {
      real += samples[i] * Math.cos(2 * Math.PI * 210 * i / 48000);
      imaginary += samples[i] * Math.sin(2 * Math.PI * 210 * i / 48000);
    }
    return { amplitude: 2 * Math.hypot(real, imaginary) / 9600,
      tail: samples.slice(33600).reduce((sum, v) => sum + v * v, 0) };
  });
  assert.ok(result.amplitude > 0.28, JSON.stringify(result));
  assert.equal(result.tail, 0);
  await page.close();
});

test('app opens directly, switches modes, plays, stops, and runs ear checks', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('index.html')).href);
  assert.equal(await page.locator('#beat-value').textContent(), '40');
  await page.getByRole('button', { name: /Alpha/ }).click();
  assert.equal(await page.locator('#right-frequency').textContent(), '210 Hz');
  await page.locator('#beat').fill('7.5');
  assert.equal(await page.locator('#right-frequency').textContent(), '207.5 Hz');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.getByRole('button', { name: 'Stop session', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop session', exact: true }).click();
  await page.getByRole('button', { name: 'Start session', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Test left ear', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Left ear'));
  await page.waitForFunction(() => document.querySelector('#play').textContent.includes('Start session'));
  await page.setViewportSize({ width: 375, height: 812 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.close();
});
