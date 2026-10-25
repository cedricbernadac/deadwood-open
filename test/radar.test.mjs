import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { RADAR, radarBlipSeconds } from '../public/radar-rules.js';
import { MAX_BONUS_LEVEL, SUPPLY_WAVES } from '../public/weapon-upgrades.js';
import { PICKUPS } from '../public/rules.js';

function room(wave = RADAR.unlockWave, practice = false) {
  const events = [], sim = new RoomSimulation('RADAR', { random: () => .5, practice, onEvent: event => events.push(event) });
  const a = sim.addPlayer('a'), b = sim.addPlayer('b');
  if (!practice) { sim.wave = wave - 1; sim.beginWave(); sim.toSpawn = 1; sim.spawnTimer = 999; }
  return { sim, a, b, events };
}
function at(player, target, extra = {}) {
  Object.assign(player, { x: target.x, y: target.y ?? 0, z: target.z, yaw: 0, pitch: 0,
    grounded: true, interactAfter: 0, shotAfter: 0, meleeAfter: 0, reloadUntil: 0, throwAfter: 0, ...extra });
}
function claim(sim, player, bonus = 'radar') {
  at(player, sim.supplyCrate);
  assert.equal(sim.claimSupply(player.id, bonus, sim.supplyCrate.id), true);
  return player.bonus;
}
function indoor(player) { at(player, { x: -5, y: 0, z: 1.7 }); }
function invariant(sim) {
  for (const player of sim.players.values()) {
    for (const [kind, level] of Object.entries(player.bonus ?? {})) {
      assert.ok(Object.hasOwn({ stone: 1, perforating: 1, extended: 1, radar: 1 }, kind), 'known bonus kind');
      assert.ok(level >= 1 && level <= MAX_BONUS_LEVEL);
    }
  }
}

test('the radar is a personal crate choice from the first crate, without points or ammunition', () => {
  const early = room(1);
  assert.equal(early.sim.supplyCrate.active, false, 'the fixed crate has no claim before wave 2');
  const { sim, a, b } = room();
  const before = structuredClone(a.inventory); a.points = 71;
  assert.deepEqual(claim(sim, a), { radar: 1 });
  assert.equal(a.points, 71); assert.deepEqual(a.inventory, before);
  assert.equal(sim.claimSupply('a', 'perforating', sim.supplyCrate.id), false, 'one choice per crate');
  // Unlike the old shared device, each teammate may carry their own radar.
  assert.deepEqual(claim(sim, b), { radar: 1 });
  invariant(sim);
});

test('re-claiming the radar at each crate raises its level and shortens the blip', () => {
  const { sim, a } = room();
  claim(sim, a);
  for (const wave of SUPPLY_WAVES.slice(1, MAX_BONUS_LEVEL)) {
    sim.wave = wave - 1; sim.beginWave(); sim.toSpawn = 1; sim.spawnTimer = 999;
    claim(sim, a);
  }
  assert.deepEqual(a.bonus, { radar: MAX_BONUS_LEVEL });
  assert.equal(radarBlipSeconds(MAX_BONUS_LEVEL), .2);
  assert.equal(sim.bonusEligible(a, 'radar'), false, 'the maximum level closes further radar claims');
  assert.equal(radarBlipSeconds(MAX_BONUS_LEVEL), .2);
  assert.equal(radarBlipSeconds(MAX_BONUS_LEVEL + 5), .2, 'out-of-range levels clamp');
  assert.equal(radarBlipSeconds(0), 8);
  invariant(sim);
});

test('the personal radar survives waves, intermission and the next wave start', () => {
  const { sim, a } = room();
  claim(sim, a, 'radar'); a.bonus.radar = 3;
  sim.toSpawn = 0; sim.zombies.clear(); sim.spawnWarnings.clear(); sim.finishWave();
  for (let tick = 0; tick < 119; tick++) sim.tick(.1);
  assert.equal(sim.phase, 'intermission');
  assert.deepEqual(a.bonus, { radar: 3 }, 'the break preserves the radar');
  sim.tick(.1); sim.tick(.1);
  assert.equal(sim.wave, RADAR.unlockWave + 1);
  assert.deepEqual(a.bonus, { radar: 3 }, 'no battery expiry at the next wave');
  invariant(sim);
});

test('a downed survivor keeps the radar; elimination releases it at its level for the team', () => {
  const { sim, a, b } = room();
  claim(sim, a); a.bonus.radar = 4; indoor(a);
  sim.damagePlayer(a, 100);
  assert.equal(a.downed, true);
  assert.deepEqual(a.bonus, { radar: 4 }, 'going down keeps the bonus');
  const dropped = [...sim.pickups.values()].filter(pickup => pickup.kind === 'bonus');
  assert.equal(dropped.length, 0, 'nothing falls while merely downed');
  // Bleed-out with no revive kit drops the levelled bonus on the ground.
  sim.time = a.bleedOutAt + 1; sim.tick(.1);
  assert.equal(a.alive, false);
  const ground = [...sim.pickups.values()].find(pickup => pickup.kind === 'bonus');
  assert.deepEqual(ground.bonus, { kind: 'radar', level: 4 });
  indoor(b); b.interactAfter = 0;
  assert.equal(sim.takeBonus('b', ground.id), true);
  assert.deepEqual(b.bonus, { radar: 4 });
  invariant(sim);
});

test('picking up a new bonus stacks with the radar instead of replacing it', () => {
  const { sim, a } = room();
  claim(sim, a, 'radar'); a.bonus.radar = 2; indoor(a);
  const pickup = { id: 'bonus', kind: 'bonus', bonus: { kind: 'extended', level: 3 }, x: -5, y: 0, z: 1.7, expiresAt: sim.time + PICKUPS.lifetime };
  sim.pickups.set(pickup.id, pickup);
  assert.equal(sim.takeBonus('a', pickup.id), true);
  assert.deepEqual(a.bonus, { radar: 2, extended: 3 }, 'both bonuses are carried at once');
  assert.equal([...sim.pickups.values()].filter(item => item.kind === 'bonus').length, 0, 'nothing falls when choices stack');
  invariant(sim);
});

test('practice grants a continuous level-eight radar to each player and resets keep it', () => {
  const { sim, a, b } = room(0, true);
  assert.equal(sim.practiceAction('a', { action: 'radar', x: 999, level: 1 }), true);
  assert.deepEqual(a.bonus, { radar: MAX_BONUS_LEVEL });
  sim.time += .3;
  assert.equal(sim.practiceAction('a', { action: 'radar' }), false, 'already carried');
  assert.equal(sim.practiceAction('b', { action: 'radar' }), true);
  assert.deepEqual(b.bonus, { radar: MAX_BONUS_LEVEL });
  sim.time += .3;
  assert.equal(sim.practiceAction('b', { action: 'targets' }), true);
  assert.deepEqual(b.bonus, { radar: MAX_BONUS_LEVEL }, 'target reset leaves the radar alone');
  assert.equal(radarBlipSeconds(b.bonus.radar), .2);
  invariant(sim);
});

test('restart rebuilds survivors without their radar; extraction and defeat keep the stale display harmless', () => {
  const { sim, a } = room();
  claim(sim, a);
  sim.phase = 'gameover';
  assert.equal(sim.start('a'), true);
  assert.equal(a.bonus, null);
  invariant(sim);
  const live = room();
  claim(live.sim, live.a, 'radar');
  live.sim.wave = 19; live.sim.beginWave(); live.sim.toSpawn = 0; live.sim.zombies.clear(); live.sim.spawnWarnings.clear();
  live.sim.wave = 20;
  assert.equal(live.sim.beginExtraction(), true);
  assert.deepEqual(live.a.bonus, { radar: 1 }, 'the escape itself never strips bonuses');
  invariant(live.sim);
});

test('the snapshot carries each player’s bonus object and no room-level radar', () => {
  const { sim, a } = room();
  claim(sim, a);
  const state = sim.snapshot();
  assert.equal('radar' in state, false);
  assert.deepEqual(state.players.find(player => player.id === 'a').bonus, { radar: 1 });
  assert.equal(state.players.find(player => player.id === 'b').bonus, null);
});
