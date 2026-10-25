import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CompanionHub } from '../companions/hub.mjs';

// The hub's map options (map choice in the LAN menu): the welcome names the
// server's map and lists the gateway's maps, every request carries mapId, and
// a gateway hub only seats a brain that knows one guide per map. Fake sockets,
// as in companions-director.test.mjs: no server, no port.
const MAPS = [
  { id: 'cabin', root: '/', port: 50001, ready: true },
  { id: 'supermarket', root: '/maps/supermarket/', port: 50002, ready: true },
  { id: 'hospital', root: '/maps/hospital/', port: 50003, ready: false },
];
const ROOTS = [{ id: 'cabin', root: '/' }, { id: 'supermarket', root: '/maps/supermarket/' }, { id: 'hospital', root: '/maps/hospital/' }];
const UPDATE = 'Cerveau à mettre à jour : relance companions.cmd.';
function fakeSocket() {
  return Object.assign(new EventEmitter(), { sent: [], closed: null,
    send(data) { this.sent.push(JSON.parse(data)); },
    close(code, reason) { this.closed = { code, reason }; } });
}
const say = (socket, message) => socket.emit('message', Buffer.from(JSON.stringify(message)));
const hello = capabilities => ({ type: 'brain-hello', name: 'test-brain', version: 2, ...(capabilities ? { capabilities } : {}) });
const answer = (socket, request, extra = {}) => say(socket, { type: request.type === 'plan' ? 'team-plan' : 'decision', id: request.id, ...extra });

test('without options the hub welcomes exactly as before and its requests carry no mapId', async () => {
  const hub = new CompanionHub({ timeout: 1000 });
  const socket = fakeSocket();
  hub.attach(socket);
  say(socket, hello(['team-plan-v1', 'map-guide-v1', 'future-v9']));
  assert.equal(hub.connected, true);
  assert.deepEqual(socket.sent, [{ type: 'brain-welcome' }]);
  assert.deepEqual(hub.brain.capabilities, ['team-plan-v1', 'map-guide-v1'], 'only the capabilities the game knows');
  const decided = hub.request({ room: 'ABC123', actions: [] });
  const decide = socket.sent.at(-1);
  assert.equal(decide.type, 'decide'); assert.equal(Object.hasOwn(decide, 'mapId'), false);
  answer(socket, decide, { action: 'hold' });
  assert.equal((await decided).action, 'hold');
  const planned = hub.requestPlan({ room: 'ABC123', questions: [] });
  const plan = socket.sent.at(-1);
  assert.equal(plan.type, 'plan'); assert.equal(Object.hasOwn(plan, 'mapId'), false);
  answer(socket, plan, { choices: {} });
  assert.deepEqual((await planned).choices, {});
  const legacy = fakeSocket();
  hub.attach(legacy);
  say(legacy, hello());
  assert.deepEqual(legacy.sent, [{ type: 'brain-welcome' }], 'an older brain without capabilities still takes the seat');
  assert.deepEqual(hub.brain.capabilities, []);
  assert.deepEqual(socket.closed, { code: 1000, reason: 'Un autre cerveau a pris la place.' });
  hub.close();
});

test('a map hub names its map and the gateway maps in the welcome, and in every request', async () => {
  const hub = new CompanionHub({ timeout: 1000, mapId: 'hospital', maps: MAPS });
  const socket = fakeSocket();
  hub.attach(socket);
  say(socket, hello(['team-plan-v1']));
  assert.deepEqual(socket.sent, [{ type: 'brain-welcome', mapId: 'hospital', maps: ROOTS }], 'only id and root leave the server');
  const decided = hub.request({ room: 'H1A2B', actions: [{ value: 'hold' }] });
  const decide = socket.sent.at(-1);
  assert.equal(decide.type, 'decide'); assert.equal(decide.mapId, 'hospital'); assert.equal(decide.room, 'H1A2B');
  answer(socket, decide, { action: 'hold' });
  assert.equal((await decided).action, 'hold');
  const planned = hub.requestPlan({ room: 'H1A2B', questions: [] });
  const plan = socket.sent.at(-1);
  assert.equal(plan.type, 'plan'); assert.equal(plan.mapId, 'hospital');
  answer(socket, plan, { choices: { bot1_role: 'medic' } });
  assert.deepEqual((await planned).choices, { bot1_role: 'medic' });

  const lone = new CompanionHub({ mapId: 'supermarket' }), alone = fakeSocket();
  lone.attach(alone); say(alone, hello());
  assert.deepEqual(alone.sent, [{ type: 'brain-welcome', mapId: 'supermarket' }], 'a lone server names its map, without a maps list');
  const asked = lone.request({ room: 'S1A2B' });
  assert.equal(alone.sent.at(-1).mapId, 'supermarket');
  answer(alone, alone.sent.at(-1), { action: 'keep' });
  assert.equal((await asked).action, 'keep');
  hub.close(); lone.close();
});

test('a gateway hub closes an outdated brain with 4002 and keeps the brain already seated', async () => {
  const hub = new CompanionHub({ timeout: 1000, mapId: 'cabin', maps: MAPS, requireCapability: 'map-guide-v1' }), changes = [];
  hub.onChange(connected => changes.push(connected));
  const seated = fakeSocket();
  hub.attach(seated);
  say(seated, hello(['team-plan-v1', 'map-guide-v1']));
  assert.equal(hub.connected, true);
  assert.deepEqual(seated.sent, [{ type: 'brain-welcome', mapId: 'cabin', maps: ROOTS }]);
  const waiting = hub.request({ room: 'ABC123', actions: [] });

  for (const capabilities of [['team-plan-v1'], undefined, 'map-guide-v1']) {
    const outdated = fakeSocket();
    hub.attach(outdated);
    say(outdated, { ...hello(), ...(capabilities ? { capabilities } : {}) });
    assert.deepEqual(outdated.closed, { code: 4002, reason: UPDATE }, JSON.stringify(capabilities));
    assert.deepEqual(outdated.sent, [], 'no welcome for an outdated brain');
    assert.equal(hub.connected, true); assert.equal(hub.socket, seated);
    assert.equal(seated.closed, null, 'the seated brain keeps its seat');
    outdated.emit('close');
    assert.equal(hub.connected, true, 'the outdated socket closing changes nothing');
  }
  assert.equal(Buffer.byteLength(UPDATE) <= 123, true, 'a WebSocket close reason fits in 123 bytes');
  const pending = seated.sent.at(-1);
  assert.equal(pending.type, 'decide'); assert.equal(pending.mapId, 'cabin');
  answer(seated, pending, { action: 'hold' });
  assert.equal((await waiting).action, 'hold', 'the pending question was still answered by the seated brain');
  const next = hub.request({ room: 'ABC123', actions: [] });
  const decide = seated.sent.at(-1);
  assert.equal(decide.type, 'decide'); assert.notEqual(decide.id, pending.id);
  answer(seated, decide, { action: 'repair:west' });
  assert.equal((await next).action, 'repair:west', 'the seated brain still receives the next question');

  const unanswered = hub.request({ room: 'ABC123', actions: [] });
  const newer = fakeSocket();
  hub.attach(newer);
  say(newer, hello(['team-plan-v1', 'map-guide-v1']));
  assert.deepEqual(seated.closed, { code: 1000, reason: 'Un autre cerveau a pris la place.' }, 'a newer brain replaces it as today');
  assert.deepEqual(newer.sent, [{ type: 'brain-welcome', mapId: 'cabin', maps: ROOTS }]);
  assert.equal((await unanswered).error, 'replaced');
  assert.equal(hub.socket, newer); assert.deepEqual(hub.brain.capabilities, ['team-plan-v1', 'map-guide-v1']);
  assert.deepEqual(changes, [true], 'the companions never left the game');
  const after = hub.request({ room: 'ABC123', actions: [] });
  assert.equal(newer.sent.at(-1).mapId, 'cabin');
  answer(newer, newer.sent.at(-1), { action: 'keep' });
  assert.equal((await after).action, 'keep');
  hub.close();
});
