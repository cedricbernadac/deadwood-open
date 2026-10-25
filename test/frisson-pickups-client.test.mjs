// The pickups restyle in the browser client (art/frisson/PICKUPS.md section
// 3.2): where restyleWeapons runs, restylePickups drops the styled kinds'
// pickup meshes (world.js STYLED_PICKUP_KINDS: points, ammo, health, armor,
// grenade, revive) so syncActors makes them again in the current style —
// same ids, same positions, the fill from the snapshot — while the bonus
// keeps its mesh and the weapon pickups are restyleWeapons' business, as
// before. A Famille night never restyles.
// client.js runs in a vm without a GPU (test/helpers/frisson-client.mjs); its
// createPickup stub records every mesh with its kind, special and fill.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { settle, deferred, recordingPack, clientHarness, snapshotFor } from './helpers/frisson-client.mjs';

// A wave snapshot carrying every pickup kind; the styled ones (PICKUPS.md)
// and the ones a restyle must never touch.
const PICKUPS = [
  { id: 'c1', kind: 'points', x: 1, y: 0, z: 2, fill: 1 },
  { id: 'a1', kind: 'ammo', x: -1, y: 0, z: 2, fill: .5 },
  { id: 'a2', kind: 'ammo', special: true, x: 0, y: 0, z: 3, fill: .8 },
  { id: 'h1', kind: 'health', x: 2, y: 0, z: 1, fill: 1 },
  { id: 'v1', kind: 'armor', x: -2, y: 0, z: 1, fill: 1 },
  { id: 'g1', kind: 'grenade', x: 3, y: 0, z: 1, fill: 1 },
  { id: 'r1', kind: 'revive', x: -3, y: 0, z: 1, fill: 1 },
  { id: 'b1', kind: 'bonus', bonus: 'ammo', x: 1, y: 0, z: -2, fill: 1 },
  { id: 'w1', kind: 'weapon', weapon: 'shotgun', x: -1, y: 0, z: -2, fill: 1 },
];
function wave({ ambiance = 'family' } = {}) {
  const state = snapshotFor({ ambiance, phase: 'wave' });
  state.pickups = PICKUPS.map(pickup => ({ ...pickup }));
  return state;
}
// The meshes of each kind the client made, in creation order.
const byKind = (client, kind, special) => client.pickups.filter(mesh => mesh.userData.kind === kind && (special === undefined || mesh.userData.special === special));

test('a Frisson ambiance settling remakes the styled pickups in place; the bonus keeps its mesh', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('guest');
  client.update(wave());
  await settle();
  assert.equal(client.pickups.length, 8, 'one mesh per non-weapon pickup');
  assert.equal(client.groundWeapons.length, 1);
  const bonus = byKind(client, 'bonus');
  assert.equal(bonus.length, 1);
  // The snapshot that asks for Frisson changes nothing by itself.
  client.update(wave({ ambiance: 'frisson' }));
  assert.equal(client.pickups.length, 8, 'the snapshot reuses the standing pickups');
  await settle(); await settle(); await settle();
  assert.equal(client.state().ambianceReady, true);
  assert.deepEqual([...client.state().pickupIds].sort(), PICKUPS.map(pickup => pickup.id).sort(), 'the same ids');
  // The seven styled pickups were made again, in the snapshot's order.
  assert.equal(client.pickups.length, 15);
  const remade = client.pickups.slice(8);
  assert.deepEqual(remade.map(mesh => [mesh.userData.kind, mesh.userData.special]),
    [['points', false], ['ammo', false], ['ammo', true], ['health', false], ['armor', false], ['grenade', false], ['revive', false]]);
  for (const [index, pickup] of PICKUPS.slice(0, 7).entries()) {
    const mesh = remade[index];
    assert.deepEqual([mesh.position.x, mesh.position.y, mesh.position.z], [pickup.x, pickup.y, pickup.z], `${pickup.id}: same position`);
  }
  assert.equal(remade[1].userData.fill, .5, 'the fill comes from the snapshot');
  assert.equal(remade[2].userData.fill, .8, 'the special\'s fill too');
  // The bonus kept its mesh; the ground weapon is restyleWeapons'.
  assert.equal(byKind(client, 'bonus').length, 1, 'the bonus: never remade');
  assert.equal(client.groundWeapons.length, 2, 'the weapon pickup remade as before');
  assert.equal(client.groundWeapons[1].userData.weapon, 'shotgun');
});

test('a load called off after the room went back to Famille restyles too, once what it put on is off again', async () => {
  const log = [], gate = deferred(), pack = recordingPack(log, { gate: gate.promise }), client = clientHarness({ importer: pack.importer, log });
  client.join('guest');
  client.update(wave());
  await settle();
  assert.equal(client.pickups.length, 8);
  client.update(wave({ ambiance: 'frisson' }));
  await settle();
  assert.equal(client.pickups.length, 8, 'still loading: nothing restyled yet');
  // The room goes back to Famille mid-load: the load is called off, and its
  // stale-and-undone landing restyles, then so does the Famille settle.
  client.update(wave());
  gate.resolve(); await settle(); await settle(); await settle(); await settle();
  assert.deepEqual(log.filter(entry => entry !== 'prewarm'), ['import', 'install', 'uninstall']);
  assert.equal(client.state().ambianceReady, true);
  assert.deepEqual([...client.state().pickupIds].sort(), PICKUPS.map(pickup => pickup.id).sort());
  // Every styled kind was made again once the load was off; the bonus never.
  for (const [kind, special] of [['points', false], ['ammo', false], ['ammo', true], ['health', false], ['armor', false], ['grenade', false], ['revive', false]])
    assert.ok(byKind(client, kind, special).length >= 2, `${kind}${special ? ' special' : ''}: made again`);
  assert.equal(byKind(client, 'bonus').length, 1, 'the bonus: never remade');
});

test('a Famille night never restyles: no pickup is made again', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('guest');
  client.update(wave());
  await settle(); await settle();
  assert.equal(client.pickups.length, 8);
  client.update(wave());
  await settle(); await settle();
  assert.deepEqual(client.loaderCalls, []); assert.equal(pack.imports, 0);
  assert.equal(client.pickups.length, 8, 'every pickup mesh is the same object');
  assert.equal(client.groundWeapons.length, 1);
});

test('the online client build passes', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync(process.execPath, ['online-client-build.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
