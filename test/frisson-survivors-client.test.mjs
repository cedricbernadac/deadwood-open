// The survivors' plumbing in the browser client (art/frisson/SURVIVORS.md
// section 10): each teammate's model is made with who it is (id, name,
// companion, chosen look), raiders with their server id, and the models
// already in the room are made again when the pack comes on or off.
// client.js runs in a vm (test/helpers/frisson-client.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { settle, clientHarness, snapshotFor } from './helpers/frisson-client.mjs';

const raider = (id, x = 3) => ({ id, kind: 'raider', boss: false, x, y: 0, z: -6, yaw: 0, pitch: 0, hp: 175, maxHp: 175, weapon: 'smg' });
function room({ ambiance, raiders = [] }) {
  const state = snapshotFor({ ambiance, phase: 'lobby' });
  state.players.push({ ...state.players[0], id: 'max', name: 'Max', companion: true });
  state.zombies = raiders;
  return state;
}

test('teammates carry who they are; raiders their id; the pack coming on and off makes them again', async () => {
  // A pack whose style answers for survivors and, when asked, for raiders.
  let style = null, dressRaiders = true;
  const fake = { plan: ({ raider: isRaider }) => (isRaider && !dressRaiders ? null : { character: isRaider ? 'Raider' : 'Survivor' }) };
  const module = { async install() { style = fake; return { uninstall() { style = null; } }; } };
  const client = clientHarness({ importer: () => Promise.resolve(module), survivorStyle: () => style });
  client.join('guest');
  client.update(room({ ambiance: 'family', raiders: [raider('r1')] }));
  await settle();
  assert.deepEqual(client.state().playerIds.sort(), ['host', 'max']);
  // Copied out of the client's realm, so deepEqual compares values only.
  const identities = JSON.parse(JSON.stringify(client.survivors.map(mesh => mesh.userData.identity))).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(identities, [{ id: 'host', name: 'Hôte', companion: false, look: null }, { id: 'max', name: 'Max', companion: true, look: null }]);
  assert.ok(client.survivors.every(mesh => !mesh.userData.character));
  assert.deepEqual(client.raiders.map(mesh => mesh.userData.id), ['r1']);
  // The pack comes on: both teammates and the raider are made again, dressed.
  client.update(room({ ambiance: 'frisson', raiders: [raider('r1')] }));
  await settle(); await settle(); await settle();
  assert.equal(client.state().ambianceReady, true);
  assert.equal(client.survivors.length, 4); assert.equal(client.raiders.length, 2);
  assert.ok(client.survivors.slice(2).every(mesh => mesh.userData.character === 'Survivor'));
  assert.equal(client.raiders[1].userData.character, 'Raider');
  assert.ok(client.disposed.includes(client.raiders[0]), 'the Famille raider went');
  assert.deepEqual(client.state().playerIds.sort(), ['host', 'max']);
  // Off again (« Famille uniquement » on this PC): Famille models once more.
  client.storage('deadwood-family-lock', '1'); await settle(); await settle(); await settle();
  assert.equal(client.survivors.length, 6); assert.ok(client.survivors.slice(4).every(mesh => !mesh.userData.character));
  assert.equal(client.raiders.length, 3); assert.equal(client.raiders[2].userData.character, undefined);
  // A pack that leaves raiders to Famille never touches the Famille raiders.
  dressRaiders = false;
  client.storage('deadwood-family-lock', '0'); await settle(); await settle(); await settle();
  assert.equal(client.raiders.length, 3, 'the Famille raider stays');
  assert.equal(client.survivors.length, 8);
});

test('a Famille night never makes its teammates again', async () => {
  const client = clientHarness({ survivorStyle: () => null });
  client.join('guest');
  client.update(room({ ambiance: 'family' }));
  client.update(room({ ambiance: 'family' }));
  await settle(); await settle();
  assert.equal(client.survivors.length, 2);
});
