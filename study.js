'use strict';
window.StudyCycle = (() => {
  function createPlan({ rounds = 4, focusSeconds = 1500, breakSeconds = 300,
    transitionSeconds = 30, focusBeat = 40, breakBeat = 10 } = {}) {
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 8) throw new RangeError('Choose 1–8 study rounds.');
    if (![focusSeconds, breakSeconds, transitionSeconds].every(value => Number.isFinite(value) && value > 0)
      || transitionSeconds * 2 > breakSeconds) throw new RangeError('Transitions must fit inside a positive break duration.');
    if (![focusBeat, breakBeat].every(value => Number.isFinite(value) && value >= 1 && value <= 40)) throw new RangeError('Study frequencies must be between 1 and 40 Hz.');

    const roundSeconds = focusSeconds + breakSeconds;
    const duration = roundSeconds * rounds;
    const transitions = [];
    for (let round = 0; round < rounds; round++) {
      const start = round * roundSeconds;
      transitions.push(
        { time: start, beat: focusBeat, ramp: false },
        { time: start + focusSeconds, beat: focusBeat, ramp: false },
        { time: start + focusSeconds + transitionSeconds, beat: breakBeat, ramp: true },
        { time: start + roundSeconds - transitionSeconds, beat: breakBeat, ramp: false },
        { time: start + roundSeconds, beat: focusBeat, ramp: true },
      );
    }
    return Object.freeze({
      rounds, duration, transitions: Object.freeze(transitions.map(Object.freeze)),
      stateAt(elapsed) {
        if (!Number.isFinite(elapsed)) throw new RangeError('Elapsed time must be finite.');
        if (elapsed >= duration) return { phase: 'complete', round: rounds, beat: focusBeat, remaining: 0, progress: 1 };
        const time = Math.max(0, elapsed);
        const round = Math.floor(time / roundSeconds) + 1;
        const withinRound = time % roundSeconds;
        if (withinRound < focusSeconds) return {
          phase: 'focus', round, beat: focusBeat,
          remaining: focusSeconds - withinRound, progress: withinRound / focusSeconds,
        };
        const rest = withinRound - focusSeconds;
        let beat = breakBeat;
        if (rest < transitionSeconds) beat = focusBeat + (breakBeat - focusBeat) * rest / transitionSeconds;
        else if (rest > breakSeconds - transitionSeconds) beat = breakBeat + (focusBeat - breakBeat) * (rest - breakSeconds + transitionSeconds) / transitionSeconds;
        return { phase: 'break', round, beat, remaining: breakSeconds - rest, progress: rest / breakSeconds };
      },
    });
  }
  return { createPlan };
})();
