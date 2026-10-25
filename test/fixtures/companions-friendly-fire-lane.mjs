import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../../simulation.mjs';
import { seededRandom } from '../../validation/balance-report.mjs';
import { createCompanionBody } from '../../companions/body.mjs';
import { findLane } from './friendly-fire-scenarios.mjs';

// The companion's friendly fire guards on either map (run on the supermarket
// by test/companions-friendly-fire.test.mjs in a child process): the bodies
// stand in a clear lane found on the map itself, the server applies the real
// friendly fire, and what counts is that the teammate is never hurt while the
// companion still fires or throws when friendly fire is off.
const TICK = 1 / 30;
const STEADY = { aim: { tremorYaw: 0, tremorPitch: 0, reaction: [0, 0] } };

function room(friendlyFire) {
  const sim = new RoomSimulation('FFLANE', { random: seededRandom(5), raids: false, onEvent: () => {} });
  const papa = sim.addPlayer('papa', 'Papa'), max = sim.addPlayer('max', 'Max', undefined, { companion: true });
  if (friendlyFire) assert.equal(sim.setFriendlyFire('papa', friendlyFire), true);
  sim.start('papa');
  Object.assign(sim, { phase: 'wave', wave: 3, toSpawn: 1, spawnTimer: 1e9 });
  const lane = findLane(sim);
  const put = (player, t) => Object.assign(player, { ...lane.at(t), y: 0, vy: 0, grounded: true, crouched: false });
  const body = createCompanionBody(sim, 'max', { random: seededRandom(6), profile: STEADY });
  const pulled = { shots: 0, throws: 0 };
  const shoot = sim.shoot.bind(sim), throwGrenade = sim.throwGrenade.bind(sim);
  sim.shoot = (...args) => { const ok = shoot(...args); if (ok && args[0] === 'max') pulled.shots++; return ok; };
  sim.throwGrenade = (...args) => { const ok = throwGrenade(...args); if (ok && args[0] === 'max') pulled.throws++; return ok; };
  const run = (seconds, until = () => false) => {
    for (let index = 0; index < Math.round(seconds * 30); index++) {
      if (papa.alive && !papa.downed) sim.setInput('papa', { forward: 0, strafe: 0, yaw: lane.yaw, pitch: 0 });
      body.tick(TICK); sim.tick(TICK);
      if (until()) return true;
    }
    return false;
  };
  const statue = t => Object.assign(sim.spawnZombie(), { ...lane.at(t), y: 0, speed: 0, attackAfter: Infinity, entered: true, hp: 1e6, maxHp: 1e6 });
  return { sim, papa, max, lane, put, body, run, pulled, statue };
}

export const LANE_SCENARIOS = {
  'a piercing gun never wounds a teammate standing behind its target'() {
    for (const friendlyFire of [null, 'full']) {
      const { papa, max, put, body, run, pulled, statue } = room(friendlyFire);
      Object.assign(max, { weapon: 'rifle', weaponId: 'rifle', inventory: { rifle: { ammo: WEAPONS.rifle.magazine, reserve: 400 } } });
      put(max, 0); statue(5); put(papa, 7.5);
      body.setOrder({ kind: 'hold' });
      run(6);
      if (friendlyFire) assert.equal(papa.hp, 100, 'on: the teammate behind is never hit');
      else assert.ok(pulled.shots > 0, 'off: it fires down the lane');
    }
  },
  'a grenade order near a teammate is refused when friendly fire is on'() {
    for (const friendlyFire of [null, 'full']) {
      const { papa, max, put, body, run, pulled, statue } = room(friendlyFire);
      put(max, 0); max.grenades = 2;
      const [first] = [statue(7), statue(7.4), statue(6.7)];
      put(papa, 9.8);
      body.setOrder({ kind: 'grenade', zombieId: first.id });
      run(4, () => body.status !== 'running');
      if (friendlyFire) { assert.equal(body.status, 'failed'); assert.equal(pulled.throws, 0); assert.equal(papa.hp, 100); }
      else { assert.equal(body.status, 'done'); assert.equal(pulled.throws, 1); }
    }
  },
};

export function runLaneScenarios() {
  for (const scenario of Object.values(LANE_SCENARIOS)) scenario();
  return Object.keys(LANE_SCENARIOS).length;
}
