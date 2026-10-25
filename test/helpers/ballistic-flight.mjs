import { BALLISTICS } from '../../public/ballistics.js';

// Static-fixture clock: integrate the real projectiles and collect their real
// events, without running AI, movement, burn, reload or grenade updates. This is
// deliberately not a replacement for tick() in moving-world/integration tests.
// The clock only moves forward: callers must not reset time to an older cadence
// deadline after awaiting an impact.
function integrate(simulation, seconds, step, stopWhenEmpty) {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(step) || step <= 0) throw new RangeError('Invalid ballistic duration or step');
  const events = [], previous = simulation.onEvent, startedAt = simulation.time, end = startedAt + seconds;
  simulation.onEvent = function(event) { events.push(event); previous?.call(this, event); };
  try {
    while (simulation.time < end - 1e-12 && (!stopWhenEmpty || simulation.bullets.size)) {
      const delta = Math.min(step, end - simulation.time);
      simulation.time += delta;
      simulation.updateBullets(delta);
    }
  } finally { simulation.onEvent = previous; }
  return { elapsed: simulation.time - startedAt, events, impacts: events.filter(event => event.event === 'bullet-impact'), remaining: simulation.bullets.size };
}

export function advanceBallisticFlight(simulation, seconds, { step = 1 / 120 } = {}) {
  return integrate(simulation, seconds, step, false);
}

export function settleBallisticFlight(simulation, { maxDuration = BALLISTICS.maxLife + 1 / 30, step = 1 / 120 } = {}) {
  return integrate(simulation, maxDuration, step, true);
}
