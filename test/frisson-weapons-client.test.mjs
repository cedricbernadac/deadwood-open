// The weapons restyle in the browser client (art/frisson/WEAPONS.md section
// 4.3): where rebuildZombieMeshes runs, restyleWeapons remakes the
// first-person gun in place (visibility, the bolt's shot time, the rotor
// angle and a hot minigun's glow carry over; none of equip()'s side
// effects), re-arms the teammates and raiders rebuildZombieMeshes left
// standing, and drops the weapon pickups so syncActors makes them again in
// the current style. A Famille night never restyles.
// client.js runs in a vm without a GPU (test/helpers/frisson-client.mjs).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { settle, deferred, recordingPack, clientHarness, snapshotFor } from './helpers/frisson-client.mjs';

const raider = (id, x = 3) => ({ id, kind: 'raider', boss: false, x, y: 0, z: -6, yaw: 0, pitch: 0, hp: 175, maxHp: 175, weapon: 'smg' });
// A wave snapshot where the local survivor ('guest') holds `weapon`.
function wave({ ambiance = 'family', weapon = 'sniper', zombies = [], pickups = [] } = {}) {
  const state = snapshotFor({ ambiance, phase: 'wave', zombies });
  state.players.find(player => player.id === 'guest').weapon = weapon;
  state.pickups = pickups;
  return state;
}
// A confirmed local shot, heard by no one (a miss far away).
const shot = weapon => ({ type: 'event', event: 'shot', id: 'guest', weapon, x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, hits: 0, kills: 0, headshots: 0, pellets: [{ yaw: 0, pitch: 0, distance: 12, stop: 'range' }] });

test('the first-person gun is made again in place: type, the bolt\'s shot time and visibility carry over, without equip()', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('guest');
  client.update(wave({ weapon: 'sniper' }));
  client.enter();
  assert.equal(client.state().inGame, true);
  assert.equal(client.gunType(), 'sniper'); assert.equal(client.guns.length, 1, 'equip made the gun');
  // A confirmed local sniper shot sets the bolt's shot time on the gun.
  for (let now = 16; now <= 48; now += 16) { client.time(now); client.frame(now); }
  client.event(shot('sniper'));
  const before = client.gun(), shotAt = before.userData.shotAt;
  assert.ok(shotAt > 0, 'the shot time is on the gun');
  before.visible = false;
  client.update(wave({ ambiance: 'frisson', weapon: 'sniper' }));
  await settle(); await settle(); await settle();
  assert.equal(client.state().ambianceReady, true);
  assert.equal(client.guns.length, 2, 'one new gun; an equip() would have made yet another');
  const remade = client.gun();
  assert.notEqual(remade, before);
  assert.equal(remade.userData.type, 'sniper');
  assert.equal(remade.userData.shotAt, shotAt, 'the bolt keeps its shot time');
  assert.equal(remade.visible, false, 'visibility carries over');
  assert.equal(client.gunType(), 'sniper');
});

test('a hot minigun keeps its rotor angle, and its heat is set again on the new gun', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('guest');
  client.update(wave({ weapon: 'minigun' }));
  client.enter();
  assert.equal(client.gunType(), 'minigun');
  client.event(shot('minigun')); // warms the barrel
  const before = client.gun();
  before.userData.rotor.rotation.z = 1.23;
  client.heatCalls.length = 0;
  client.update(wave({ ambiance: 'frisson', weapon: 'minigun' }));
  await settle(); await settle(); await settle();
  assert.equal(client.guns.length, 2, 'one new gun');
  const remade = client.gun();
  assert.notEqual(remade, before);
  assert.equal(remade.userData.rotor.rotation.z, 1.23, 'the rotor angle carries over');
  // equip() would have reset the barrel heat instead.
  assert.deepEqual(client.heatCalls.filter(([mesh, level]) => mesh === remade && level > 0).length, 1, 'setWeaponHeat re-applied once, while hot');
  assert.equal(client.heatCalls.filter(([mesh]) => mesh === before).length, 0, 'never on the gun that went');
});

test('teammates and raiders left standing are re-armed (off, then on again), not made again', async () => {
  // A weapons-only night: the pack dresses no survivor (survivorStyle null),
  // so rebuildZombieMeshes makes neither the teammate nor the raider again.
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log, survivorStyle: () => null });
  client.join('guest');
  client.update(wave({ zombies: [raider('r1')] }));
  await settle();
  assert.equal(client.survivors.length, 1); assert.equal(client.raiders.length, 1);
  const teammate = client.survivors[0], enemy = client.raiders[0];
  client.update(wave({ ambiance: 'frisson', zombies: [raider('r1')] }));
  client.weaponCalls.length = 0; // the snapshot's own syncActors
  await settle(); await settle(); await settle();
  assert.equal(client.state().ambianceReady, true);
  assert.equal(client.survivors.length, 1, 'the teammate was not made again');
  assert.equal(client.raiders.length, 1, 'the raider was not made again');
  assert.equal(client.disposed.length, 0);
  assert.deepEqual(client.weaponCalls, [[teammate, null], [teammate, 'pistol'], [enemy, null], [enemy, 'smg']]);
});

test('the weapon pickups are built again in the new style, and stay in the room', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  const pickup = { id: 'w1', kind: 'weapon', weapon: 'shotgun', x: 1, y: 0, z: 2, fill: 1 };
  client.join('guest');
  client.update(wave({ pickups: [pickup] }));
  await settle();
  assert.equal(client.groundWeapons.length, 1);
  assert.deepEqual(client.state().pickupIds, ['w1']);
  client.update(wave({ ambiance: 'frisson', pickups: [pickup] }));
  assert.equal(client.groundWeapons.length, 1, 'the snapshot itself reuses the standing pickup');
  await settle(); await settle(); await settle();
  assert.equal(client.groundWeapons.length, 2, 'dropped by restyleWeapons, made again by syncActors');
  assert.deepEqual(client.state().pickupIds, ['w1']);
  assert.equal(client.groundWeapons[1].userData.weapon, 'shotgun');
});

test('a load called off after leaving restyles too, once what it put on is off again', async () => {
  const log = [], gate = deferred(), pack = recordingPack(log, { gate: gate.promise }), client = clientHarness({ importer: pack.importer, log });
  client.join('guest');
  client.update(wave({ weapon: 'sniper' }));
  client.enter();
  client.event(shot('sniper'));
  const before = client.gun(), shotAt = before.userData.shotAt;
  client.update(wave({ ambiance: 'frisson', weapon: 'sniper' }));
  await settle();
  assert.equal(client.guns.length, 1, 'still loading: nothing restyled yet');
  client.leave();
  gate.resolve(); await settle(); await settle(); await settle();
  assert.deepEqual(log.filter(entry => entry !== 'prewarm'), ['import', 'install', 'uninstall']);
  // The stale-and-undone path restyles, and so does the Famille settle that
  // follows it: without the first there would be one gun fewer.
  assert.equal(client.guns.length, 3, 'the undone load restyled before Famille settled');
  assert.notEqual(client.gun(), before);
  assert.equal(client.gun().userData.shotAt, shotAt);
});

test('a Famille night never restyles: no new gun, nobody disarmed', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  const alone = weapon => { const state = wave({ weapon }); state.players = state.players.filter(player => player.id === 'guest'); return state; };
  client.join('guest');
  client.update(alone('sniper'));
  client.enter();
  assert.equal(client.guns.length, 1);
  client.update(alone('sniper'));
  await settle(); await settle();
  assert.deepEqual(client.loaderCalls, []); assert.equal(pack.imports, 0);
  assert.equal(client.guns.length, 1, 'the gun is untouched');
  assert.deepEqual(client.weaponCalls, [], 'nobody disarmed and re-armed');
});

test('the online client build passes', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath, ['online-client-build.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
