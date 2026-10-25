import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { RoomSimulation, WORLD } from '../simulation.mjs';
import { MELEE_WEAPONS } from '../public/rules.js';
import { meleeDirection, meleeTargetPoint, meleeTargets, sightClear, sightDoors, sightBoxes, SIGHT_COVERS } from '../public/melee-reach.js';
import { meleeScenarios, meleeRoom, serverMelee, seededRandom } from './helpers/melee-scenarios.mjs';

// Recorded on the untouched server (81c72f3, 13 October 2026) before the
// targeting moved to public/melee-reach.js: 2400 seeded blows, every target
// point and every resolved impact, damage and kill.
const BASELINE = Object.freeze({ sha256: '3923c58f4a11aae0ca7d680e4d6850fc6d0d9f06b6315270e9a9197d6ca10b92',
  hitSwings: 1759, missSwings: 641, impacts: 2780, kills: 847, pointsInReach: 3589, bodies: 8402 });

test('the server resolves 2400 seeded blows exactly as before the targeting was shared', () => {
  const room = meleeRoom(RoomSimulation), results = meleeScenarios(2400).map(scenario => serverMelee(room, scenario));
  const stats = { hitSwings: results.filter(result => result.hits > 0).length, missSwings: results.filter(result => result.hits === 0).length,
    impacts: results.reduce((sum, result) => sum + result.hits, 0), kills: results.reduce((sum, result) => sum + result.kills, 0),
    pointsInReach: results.reduce((sum, result) => sum + result.points.filter(Boolean).length, 0), bodies: results.reduce((sum, result) => sum + result.points.length, 0) };
  const { sha256, ...expected } = BASELINE;
  assert.deepEqual(stats, expected);
  assert.equal(createHash('sha256').update(JSON.stringify(results)).digest('hex'), sha256);
});

test('the client predicts the server’s exact targets from snapshot data: survivor pose, bodies, planks and seals', () => {
  const room = meleeRoom(RoomSimulation);
  let hits = 0, misses = 0, blocked = 0;
  for (const scenario of meleeScenarios(2400)) {
    const server = serverMelee(room, scenario), snapshot = room.sim.snapshot(), self = snapshot.players.find(player => player.id === 'p');
    const { player } = scenario, origin = { x: player.x, y: player.y + self.eyeHeight, z: player.z };
    const zombies = scenario.zombies.map(({ id, kind, scale, boss, crouched, x, y, z }) => ({ id, kind, scale, boss, crouched, x, y, z }));
    // The client's own profile (meleeProfile): the same reach, arc and target count as the server's.
    const doors = sightDoors(snapshot.doors), profile = MELEE_WEAPONS[scenario.weapon][scenario.attack];
    const direction = meleeDirection(player.yaw, player.pitch);
    const predicted = meleeTargets(origin, direction, profile, zombies, (from, point) => sightClear(from, point, doors));
    assert.equal(predicted.length, server.hits);
    assert.deepEqual(predicted.map(({ zombie }) => zombie.id), server.impacts.map(impact => impact.zombieId));
    for (const { zombie, point } of predicted) assert.deepEqual(point, server.points[scenario.zombies.findIndex(item => item.id === zombie.id)]);
    if (server.hits) hits++; else misses++;
    if (zombies.some((zombie, index) => !server.points[index] && meleeTargetPoint(origin, direction, zombie, profile, () => true))) blocked++;
  }
  assert.ok(hits > 1500 && misses > 500 && blocked > 250, `${hits} hits, ${misses} misses, ${blocked} swings with a body behind cover`);
});

test('the client sight lines are the server’s blast sight lines for every wall, cover, tread, roof, plank and seal', () => {
  const room = meleeRoom(RoomSimulation), random = seededRandom(0x7369676e), between = (a, b) => a + (b - a) * random();
  assert.deepEqual(SIGHT_COVERS, WORLD.covers);
  let clear = 0, walls = 0, planks = 0;
  for (let round = 0; round < 60; round++) {
    for (const door of room.sim.doors) {
      door.sealed = random() < .2; door.sealPending = false;
      door.boards = door.boards.map(() => random() < .3 ? 0 : Math.round(between(1, 60)));
    }
    const doors = sightDoors(room.sim.snapshot().doors);
    assert.deepEqual(sightBoxes(doors), room.sim.solidBoxes());
    for (let index = 0; index < 400; index++) {
      const door = room.sim.doors[index % 4], across = index % 3 === 0;
      // A third straddle a doorway; the rest anywhere in and around the cabin, up to the roof.
      const origin = across ? { x: door.x - door.outX * between(.2, 1.5) + door.outZ * between(-1.6, 1.6), y: between(0, 3), z: door.z - door.outZ * between(.2, 1.5) + door.outX * between(-1.6, 1.6) }
        : { x: between(-10, 10), y: between(0, 9), z: between(-8, 8) };
      const target = across ? { x: door.x + door.outX * between(.2, 1.5) + door.outZ * between(-1.6, 1.6), y: between(0, 3), z: door.z + door.outZ * between(.2, 1.5) + door.outX * between(-1.6, 1.6) }
        : random() < .5 ? { x: origin.x + between(-2.5, 2.5), y: origin.y + between(-2, 2), z: origin.z + between(-2.5, 2.5) } : { x: between(-10, 10), y: between(0, 9), z: between(-8, 8) };
      const expected = room.sim.grenadeBlastVisible(origin, target);
      assert.equal(sightClear(origin, target, doors), expected, JSON.stringify({ origin, target, doors }));
      if (expected) clear++;
      else if (sightClear(origin, target, doors.map(item => ({ ...item, boards: item.boards.map(() => 0) })))) planks++;
      else walls++;
    }
  }
  assert.ok(clear > 4000 && walls > 4000 && planks > 800, `${clear} clear, ${walls} walls, ${planks} planks`);
});
