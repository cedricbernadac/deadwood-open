import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, EXTRACTION_DURATION } from '../simulation.mjs';
import { ARMORY, MAX_WAVES } from '../public/rules.js';

function room() {
  const events = [];
  const simulation = new RoomSimulation('EXIT20', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a', 'Alice');
  simulation.start('a');
  simulation.wave = MAX_WAVES - 1;
  simulation.beginWave();
  return { simulation, player, events };
}

function clearWave(simulation) {
  simulation.toSpawn = 0;
  simulation.zombies.clear();
  simulation.tick(0);
}

function extract(simulation) {
  for (let tick = 0; tick < EXTRACTION_DURATION * 30; tick++) simulation.tick(1 / 30);
}

test('the last actual kill at wave 20 starts one timed extraction then one victory', () => {
  const { simulation, player, events } = room();
  simulation.toSpawn = 0;
  Object.assign(player, { x: -4.4, y: 0, z: 1, yaw: 0, pitch: 0, score: 789, points: 321, kills: 12 });
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: -4.4, y: .4, z: -3, hp: 1, kind: 'walker', scale: 1 });
  assert.equal(simulation.phase, 'wave');
  assert.equal(simulation.shoot('a'), true); advanceBallisticFlight(simulation, .1);
  assert.equal(simulation.zombies.size, 0);
  const score = player.score, points = player.points;
  simulation.tick(0);
  assert.equal(simulation.phase, 'extraction');
  assert.equal(simulation.timeLeft, EXTRACTION_DURATION);
  assert.equal(simulation.wave, MAX_WAVES);
  assert.equal(events.filter(event => event.event === 'extraction').length, 1);
  for (let tick = 0; tick < 100; tick++) simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'extraction');
  assert.ok(simulation.timeLeft > 0);
  extract(simulation);
  assert.equal(simulation.phase, 'victory');
  assert.equal(simulation.timeLeft, 0);
  assert.equal(simulation.wave, MAX_WAVES);
  assert.equal(player.score, score);
  assert.equal(player.points, points);
  assert.equal(player.kills, 13);
  assert.equal(events.filter(event => event.event === 'victory').length, 1);
  assert.equal(events.filter(event => event.event === 'resupply').length, 0);
  const state = simulation.snapshot();
  assert.equal(state.maxWaves, 20);
  assert.equal(state.extractionDuration, 12);
});

test('wave 19 still gives an intermission and wave 20 cannot finish with a pending threat', () => {
  const { simulation } = room();
  assert.equal(simulation.beginExtraction(), false);
  simulation.toSpawn = 0;
  simulation.spawnZombie();
  assert.equal(simulation.beginExtraction(), false);
  simulation.wave = MAX_WAVES - 1;
  clearWave(simulation);
  assert.equal(simulation.phase, 'intermission');
  for (let tick = 0; tick < 360; tick++) simulation.tick(1 / 30);
  // Floating point countdown can retain a tiny remainder for one tick.
  simulation.tick(1 / 30);
  assert.equal(simulation.phase, 'wave');
  assert.equal(simulation.wave, MAX_WAVES);
});

test('extraction and victory freeze movement, combat, spending and revives', () => {
  const { simulation, player } = room();
  const crate = ARMORY.find(item => item.weapon === 'shotgun');
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: 10000, vy: -4, jumpRequested: true });
  player.inventory.pistol.ammo = 1;
  clearWave(simulation);
  const before = structuredClone({ x: player.x, y: player.y, z: player.z, points: player.points, inventory: player.inventory });
  for (const phase of ['extraction', 'victory']) {
    assert.equal(simulation.phase, phase);
    assert.equal(simulation.setInput('a', { forward: 1, strafe: 1, yaw: 2, pitch: .5, jump: true }), false);
    assert.equal(simulation.shoot('a'), false);
    assert.equal(simulation.reload('a'), false);
    assert.equal(simulation.buyWeapon('a', crate.id), false);
    assert.equal(simulation.interact('a'), false);
    assert.equal(simulation.chooseWeapon('a', 'pistol'), false);
    assert.equal(simulation.start('missing'), false);
    if (phase === 'extraction') assert.equal(simulation.start('a'), false);
    assert.equal(simulation.endGame(), false);
    simulation.tick(.1);
    assert.deepEqual({ x: player.x, y: player.y, z: player.z, points: player.points, inventory: player.inventory }, before);
    extract(simulation);
  }
});

test('host transfer during rescue preserves victory even when the remaining player is downed', () => {
  const { simulation, player } = room();
  const teammate = simulation.addPlayer('b', 'Bob', 'smg');
  Object.assign(teammate, { hp: 0, downed: true, bleedOutAt: simulation.time + 1 });
  clearWave(simulation);
  simulation.removePlayer(player.id);
  assert.equal(simulation.hostId, teammate.id);
  assert.equal(simulation.phase, 'extraction');
  extract(simulation);
  assert.equal(simulation.phase, 'victory');
  assert.equal(teammate.alive, true, 'Bleed-out must stop once rescue has begun');
  const late = simulation.addPlayer('c', 'Claire');
  assert.equal(simulation.start(late.id), false);
  assert.equal(simulation.start(teammate.id), true);
  assert.equal(simulation.phase, 'countdown');
  assert.equal(simulation.wave, 0);
  assert.equal(teammate.downed, false);
  assert.equal(teammate.hp, 100);
  assert.equal(teammate.weapon, 'pistol');
  assert.deepEqual(Object.keys(teammate.inventory), ['pistol']);
});

test('a defeat at wave 20 remains a defeat and cannot accidentally run extraction', () => {
  const { simulation, player, events } = room();
  player.downed = true;
  player.hp = 0;
  clearWave(simulation);
  assert.equal(simulation.phase, 'gameover');
  extract(simulation);
  assert.equal(simulation.phase, 'gameover');
  assert.equal(events.some(event => ['extraction', 'victory'].includes(event.event)), false);
  assert.equal(simulation.beginWave(), false);
  assert.equal(simulation.wave, MAX_WAVES);
});

test('no command or countdown can create wave 21 after the final clear', () => {
  const { simulation } = room();
  clearWave(simulation);
  assert.equal(simulation.beginWave(), false);
  extract(simulation);
  assert.equal(simulation.beginWave(), false);
  for (let tick = 0; tick < 1000; tick++) simulation.tick(.1);
  assert.equal(simulation.phase, 'victory');
  assert.equal(simulation.wave, MAX_WAVES);
  assert.equal(simulation.toSpawn, 0);
  assert.equal(simulation.zombies.size, 0);
});
