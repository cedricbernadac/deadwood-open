import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation } from '../simulation.mjs';
import { enemyHitbox } from '../public/enemies.js';
import { MELEE_PREDICTION, meleeDirection, meleeTargets, meleeWillLand, trackMotion, sightClear, sightDoors } from '../public/melee-reach.js';
import { approachScenarios } from './helpers/melee-approach.mjs';

// What the client knows when it decides: the snapshots received so far, the
// local aim, and the server's contact time (event time plus windup).
function clientView(scenario) {
  const zombieMotion = new Map(), playerMotion = new Map();
  for (const snapshot of scenario.received) { trackMotion(zombieMotion, snapshot.zombies, snapshot.time); trackMotion(playerMotion, snapshot.players, snapshot.time); }
  const snapshot = scenario.received.at(-1), self = snapshot.players[0], doors = sightDoors(scenario.doors);
  return { snapshot, visible: (from, point) => sightClear(from, point, doors), direction: meleeDirection(scenario.localYaw, scenario.pitch),
    eye: { x: self.x, y: self.y + self.eyeHeight, z: self.z, ...playerMotion.get(self.id) },
    zombies: snapshot.zombies.map(zombie => ({ ...zombie, ...zombieMotion.get(zombie.id) })) };
}

test('a body walking or running into reach is predicted as a hit from the snapshots the client has when it decides', () => {
  // Real 30 Hz server ticks and 15 Hz snapshots; walkers and runners at
  // 1.15-2.45 m/s, some passing by; the survivor still, walking or sprinting,
  // turning up to 1 rad/s; decisions at the event or 50-140 ms before contact.
  let hits = 0, misses = 0, lagging = 0, wrongHits = 0, farthest = -Infinity;
  for (const scenario of approachScenarios(RoomSimulation, 800)) {
    const view = clientView(scenario), { profile } = scenario;
    const predicted = meleeWillLand(view.eye, view.direction, profile, view.zombies, view.visible, scenario.contact - view.snapshot.time);
    if (scenario.hits > 0) {
      hits++;
      assert.equal(predicted, true, `a blow that lands keeps its impact: ${JSON.stringify({ ...scenario, received: undefined, doors: undefined })}`);
      // The latest snapshot as it stands, with the exact reach, misses it.
      if (!meleeTargets(view.eye, view.direction, profile, view.snapshot.zombies, view.visible).length) lagging++;
    } else {
      misses++;
      if (!predicted) continue;
      // A wrong "hit" keeps the old sound, and only on a near thing.
      wrongHits++;
      const box = enemyHitbox(scenario.body), { x, z } = scenario.hit;
      farthest = Math.max(farthest, Math.hypot(Math.max(box.minX - x, 0, x - box.maxX), Math.max(box.minZ - z, 0, z - box.maxZ)) - profile.range);
    }
  }
  assert.ok(hits > 200 && misses > 500, `${hits} hits, ${misses} misses`);
  assert.ok(lagging > hits * .08, `${lagging} of ${hits} blows land beyond the latest snapshot`);
  assert.ok(wrongHits < misses * .25 && farthest < 1, `${wrongHits} wrong hits, up to ${farthest} m beyond reach`);
});

test('empty air stays a miss: nobody near, a body out of reach, walking away, behind the survivor or behind a wall', () => {
  const profile = { range: 1.8, coneAngle: 40 * Math.PI / 180, maxTargets: 1 }, clear = () => true;
  const eye = { x: 0, y: 1.6, z: 0 }, ahead = meleeDirection(0, 0);
  // A walker straight ahead (-z), its near face `gap` beyond the reach; vz > 0 comes closer.
  const face = (gap, extra = {}) => ({ id: 'z', kind: 'walker', scale: 1, x: 0, y: 0, z: -(profile.range + gap + .32), ...extra });
  const lands = (bodies, horizon = .3, from = eye, visible = clear) => meleeWillLand(from, ahead, profile, bodies, visible, horizon);
  assert.equal(lands([]), false);
  assert.equal(lands([face(.9)]), false, 'standing 0.9 m out of reach');
  assert.equal(lands([face(.35, { vz: -1.5 })]), false, 'walking away');
  assert.equal(lands([{ ...face(0), z: 1 }]), false, 'behind');
  assert.equal(lands([face(-.6)], .3, eye, () => false), false, 'behind a wall');
  // In reach, inside the 0.3 m margin, or walking in by contact: a hit.
  assert.equal(lands([face(-.6)]), true);
  assert.equal(lands([face(.25)], 0), true, 'the reach margin');
  assert.equal(lands([face(.35)], 0), false);
  assert.equal(lands([face(.35, { vz: 2.45 })], 0), true, 'one server tick later');
  assert.equal(lands([face(.8, { vz: 2.45 })], .3), true, 'a runner arriving at contact');
  assert.equal(lands([face(.8, { vz: 2.45 })], 0), false);
  assert.equal(lands([face(.8)], .3, { ...eye, vz: -5.4 }), true, 'a survivor sprinting in');
  assert.equal(lands([face(4, { vz: 6 })], 1), false, 'the horizon is capped');
  assert.equal(lands([face(2.5, { vz: 6 })], .5), true);
  assert.equal(MELEE_PREDICTION.horizon, .5);
});

test('snapshot velocities: same-time snapshots keep them, gaps, jumps and restarts reset them, gone actors are dropped', () => {
  const motion = new Map(), at = (x, z, id = 'z1') => ({ id, x, z });
  trackMotion(motion, [at(0, 0), at(5, 5, 'z2')], 10);
  assert.deepEqual(motion.get('z1'), { x: 0, z: 0, time: 10, vx: 0, vz: 0 });
  trackMotion(motion, [at(.1, -.15), at(5, 5, 'z2')], 10 + 1 / 15);
  assert.ok(Math.abs(motion.get('z1').vx - 1.5) < 1e-9 && Math.abs(motion.get('z1').vz + 2.25) < 1e-9);
  trackMotion(motion, [at(.3, -.15)], 10 + 1 / 15);
  assert.ok(Math.abs(motion.get('z1').vx - 1.5) < 1e-9, 'an out-of-band snapshot of the same tick keeps the estimate');
  assert.equal(motion.has('z2'), false, 'a body gone from the snapshot');
  trackMotion(motion, [at(.4, -.15)], 10.5);
  assert.deepEqual([motion.get('z1').vx, motion.get('z1').vz], [0, 0], 'a gap');
  trackMotion(motion, [at(2, -.15)], 10.5 + 1 / 15);
  assert.deepEqual([motion.get('z1').vx, motion.get('z1').vz], [0, 0], 'a jump');
  trackMotion(motion, [at(2.1, -.15)], 1);
  assert.deepEqual([motion.get('z1').vx, motion.get('z1').vz, motion.get('z1').time], [0, 0, 1], 'a new night');
  trackMotion(motion, [{ id: 'z1', x: NaN, z: 0 }, at(0, 0, 'p')], 1 + 1 / 15);
  assert.deepEqual([...motion.keys()], ['p']);
});
