const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function plan(options) {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync('study.js', 'utf8'), sandbox);
  return sandbox.window.StudyCycle.createPlan(options);
}

test('25/5 study rounds hold focus, ramp inside the break, and return to focus', () => {
  const cycle = plan({ rounds: 4 });
  assert.equal(cycle.duration, 7200);
  for (const [time, phase, beat, round] of [
    [0, 'focus', 40, 1], [1499, 'focus', 40, 1],
    [1500, 'break', 40, 1], [1515, 'break', 25, 1],
    [1530, 'break', 10, 1], [1769, 'break', 10, 1],
    [1785, 'break', 25, 1], [1800, 'focus', 40, 2],
    [5400, 'focus', 40, 4], [7200, 'complete', 40, 4],
  ]) {
    const state = cycle.stateAt(time);
    assert.equal(state.phase, phase, `phase at ${time}`);
    assert.equal(state.beat, beat, `beat at ${time}`);
    assert.equal(state.round, round, `round at ${time}`);
  }
  assert.equal(cycle.stateAt(1500).remaining, 300);
  assert.equal(cycle.stateAt(1800).remaining, 1500);
  assert.equal(cycle.stateAt(9000).remaining, 0);
});

test('invalid study schedules are rejected', () => {
  for (const options of [{ rounds: 0 }, { rounds: 1.5 }, { rounds: 9 },
    { focusSeconds: NaN }, { breakSeconds: 0 }, { transitionSeconds: 0 },
    { transitionSeconds: 151 }, { focusBeat: 41 }, { breakBeat: -1 }]) {
    assert.throws(() => plan(options));
  }
});
