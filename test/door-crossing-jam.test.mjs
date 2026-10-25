import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { waveBalance } from '../public/rules.js';

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

// The opposite barricade stays intact. A legal route may converge on the
// already-open entrance, but its front ranks must not clog the real jambs.
// Remove bodies only after completed entry to isolate outside crowd routing;
// this fixture is not a combat-balance or real player survival experiment.
for (const { open, seed } of [{ open: 'west', seed: 1 }, { open: 'east', seed: 20261011 }]) {
  test(`a full late solo crowd crosses the ${open} breach without a permanent jamb blockage`, () => {
    const sim = new RoomSimulation('JAMB', { random: seeded(seed) });
    const player = sim.addPlayer('player'); sim.start(player.id);
    sim.wave = 19; sim.beginWave();
    Object.assign(player, { x: -2.8, y: 0, z: 1.7 });
    sim.damagePlayer = () => false;
    sim.doors.find(door => door.id === open).hp = 0;
    const births = { west: 0, east: 0 }, crossings = { west: 0, east: 0 };
    const materialize = sim.materializeZombie.bind(sim);
    sim.materializeZombie = zombie => { births[zombie.doorId]++; return materialize(zombie); };
    const total = waveBalance(20, 1).total;
    while (sim.phase === 'wave' && sim.time < 120) {
      sim.tick(1 / 30);
      for (const zombie of sim.zombies.values()) {
        if (Math.abs(zombie.x) >= 7.65 || Math.abs(zombie.z) >= 5.65) continue;
        assert.equal(sim.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29 * (zombie.scale ?? 1)), true,
          'the fix must preserve solid walls, barricades and the body envelope');
        crossings[zombie.x > 0 ? 'east' : 'west']++;
        sim.zombies.delete(zombie.id);
      }
    }
    assert.ok(births.west > 0 && births.east > 0, 'appearances still originate on both defended sides');
    assert.equal(births.west + births.east, total);
    assert.equal(crossings.west + crossings.east, total, `only ${crossings.west + crossings.east}/${total} crossed within 120 seconds`);
    assert.equal(sim.toSpawn + sim.spawnWarnings.size + sim.zombies.size, 0);
    assert.equal(sim.phase, 'extraction');
  });
}
