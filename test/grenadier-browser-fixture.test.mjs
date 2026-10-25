import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { seedGrenadierView } from '../validation/grenadier-browser.mjs';
import { SUPPLY_BONUSES } from '../public/weapon-upgrades.js';

test('the Grenadier browser seed starts from zero and earns its first grenade only through real ticks, up to five', () => {
  const sim = new RoomSimulation('GRENQA'); sim.addPlayer('qa');
  const seeded = seedGrenadierView(sim, 'grenadier'), player = sim.players.get('qa');
  assert.equal(seeded.wave, 2); assert.equal(seeded.grenades, 0); assert.equal(seeded.grenadierLeft, 10);
  assert.equal(seeded.stats.maxGrenades, 5); assert.equal(seeded.stats.grenadeIntervalSeconds, 10);
  assert.equal(seeded.stats.grenadeDamageMultiplier, 1.5);
  assert.ok(player.reviveShieldUntil > sim.time + 1000);
  for (let tick = 0; tick < 299; tick++) sim.tick(1 / 30);
  assert.equal(player.grenades, 0); sim.tick(1 / 30); assert.equal(player.grenades, 1);
  for (let tick = 0; tick < 1200; tick++) sim.tick(1 / 30);
  assert.equal(player.grenades, 5); assert.equal(sim.grenadierLeft(player), null);
  seedGrenadierView(sim, 'grenadier'); assert.equal(player.grenades, 0); assert.equal(sim.grenadierLeft(player), 10);
  seedGrenadierView(sim, 'all'); assert.equal(Object.keys(player.bonus).length, Object.keys(SUPPLY_BONUSES).length); assert.equal(player.dualWield, true);
  seedGrenadierView(sim, 'crate'); assert.equal(player.bonus, null); assert.equal(player.dualWield, false); assert.equal(sim.supplyCrate.active, true); assert.equal(sim.grenadierLeft(player), null);
});
