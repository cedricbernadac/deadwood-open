import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RoomSimulation } from '../simulation.mjs';
import { CompanionDirector, COMPANION_NAMES, COMPANION_TIMING } from '../companions/director.mjs';
import { CompanionHub } from '../companions/hub.mjs';

// The director with a fake brain and a fake body (companions/DESIGN.md).
function fakeHub() {
  const hub = { connected: true, requests: [], answer: null };
  hub.request = payload => new Promise(resolve => hub.requests.push({ payload, resolve }));
  return hub;
}
function fakeBody() {
  const body = { orders: [], status: 'idle', ticks: 0 };
  body.setOrder = order => { body.orders.push(order); body.status = order ? 'running' : 'idle'; };
  body.tick = () => { body.ticks++; return body.status; };
  return body;
}
const SITUATION = {
  text: 'You are Max.', actions: [{ value: 'hold', description: 'Stay.' }, { value: 'defend:west', description: 'Hold the west door.' }, { value: 'keep', description: 'Keep.' }],
  orders: { hold: { kind: 'hold' }, 'defend:west': { kind: 'defend', doorId: 'west' }, keep: null },
};
function room({ humans = 1 } = {}) {
  const events = [], bodies = [], hub = fakeHub();
  let director = null;
  const simulation = new RoomSimulation('DIRECT', { random: () => .5, onEvent: message => { events.push(message); director?.onEvent(message); } });
  for (let index = 0; index < humans; index++) simulation.addPlayer(`h${index}`, index ? 'Jules' : 'Papa');
  director = new CompanionDirector(simulation, hub, { createBody: () => { const body = fakeBody(); bodies.push(body); return body; }, describe: () => SITUATION });
  return { simulation, director, hub, bodies, events };
}
const named = (events, name) => events.filter(event => event.event === name);
const flush = () => new Promise(resolve => setImmediate(resolve));
const run = (simulation, director, seconds) => { for (let i = 0; i < Math.round(seconds * 30); i++) { director.step(1 / 30); simulation.time += 1 / 30; } };

test('the host adds up to three named companions between nights, never past four survivors', () => {
  const { simulation, director, hub } = room({ humans: 2 });
  assert.equal(director.setCount(1, 'h1'), false, 'only the host');
  assert.equal(director.setCount(3, 'h0'), true);
  assert.equal(director.count, 2, 'two humans leave two seats');
  const companions = [...simulation.players.values()].filter(player => player.companion);
  assert.deepEqual(companions.map(player => player.name), COMPANION_NAMES.slice(0, 2));
  assert.equal(simulation.hostId, 'h0');
  assert.equal(director.setCount(1, 'h0'), true); assert.equal(director.count, 1);
  assert.equal([...simulation.players.values()].find(player => player.companion).name, 'Max', 'the last one leaves first');
  simulation.start('h0');
  assert.equal(director.setCount(2, 'h0'), false, 'not during the night');
  simulation.phase = 'gameover'; hub.connected = false;
  assert.equal(director.setCount(2, 'h0'), false, 'no brain, no new companion');
  assert.equal(director.setCount(0, 'h0'), true, 'removing still works');
  assert.equal(director.setCount(4, 'h0'), false);
});

test('a fourth human takes a companion seat; a lost brain logs every companion out', () => {
  const { simulation, director, events } = room({ humans: 1 });
  director.setCount(3, 'h0');
  assert.equal(simulation.players.size, 4);
  assert.equal(director.makeRoomForHuman(), true);
  assert.equal(simulation.players.size, 3); assert.equal(director.count, 2);
  assert.equal(director.removeAll('offline'), true);
  assert.equal(director.count, 0); assert.equal(simulation.players.size, 1);
  assert.equal(named(events, 'companions-offline').length, 1);
});

test('the brain decides: one request in flight, legal answers applied, a callout for a real change', async () => {
  const { simulation, director, hub, bodies, events } = room();
  director.setCount(1, 'h0'); simulation.start('h0'); simulation.phase = 'wave';
  run(simulation, director, .1);
  assert.equal(hub.requests.length, 1, 'asks at once: no order yet');
  const [first] = hub.requests;
  assert.deepEqual(Object.keys(first.payload).sort(), ['actions', 'companion', 'current', 'room', 'situation']);
  assert.equal(first.payload.companion.name, 'Max'); assert.equal(first.payload.current, null);
  run(simulation, director, 2);
  assert.equal(hub.requests.length, 1, 'never two in flight');
  first.resolve({ type: 'decision', action: 'defend:west' }); await flush();
  assert.deepEqual(bodies[0].orders.at(-1), { kind: 'defend', doorId: 'west' });
  assert.deepEqual(named(events, 'companion-callout').map(({ id, order, target }) => ({ order, target, id: id.startsWith('ia-') })), [{ order: 'defend', target: 'west', id: true }]);
  run(simulation, director, COMPANION_TIMING.wave - .1);
  assert.equal(hub.requests.length, 1, 'with an order, the next question waits a second');
  run(simulation, director, .2);
  assert.equal(hub.requests.length, 2); assert.equal(hub.requests[1].payload.current, 'defend:west');
  hub.requests[1].resolve({ type: 'decision', action: 'keep' }); await flush();
  assert.equal(bodies[0].orders.length, 1, 'keep changes nothing');
  run(simulation, director, 1.1);
  hub.requests[2].resolve({ type: 'decision', action: 'shoot:z99' }); await flush();
  assert.equal(bodies[0].orders.length, 1, 'an action that was not offered is dropped');
  run(simulation, director, .4);
  assert.equal(hub.requests.length, 4, 'and asked again soon');
});

test('stale answers are dropped; a finished order is reported to the next question; budget warns once', async () => {
  const { simulation, director, hub, bodies, events } = room();
  director.setCount(1, 'h0'); simulation.start('h0'); simulation.phase = 'wave';
  run(simulation, director, .1);
  run(simulation, director, COMPANION_TIMING.stale + .5);
  hub.requests[0].resolve({ type: 'decision', action: 'hold' }); await flush();
  assert.equal(bodies[0].orders.length, 0, 'too old');
  run(simulation, director, .5);
  hub.requests[1].resolve({ type: 'decision', action: 'hold' }); await flush();
  assert.deepEqual(bodies[0].orders, [{ kind: 'hold' }]);
  bodies[0].status = 'done';
  run(simulation, director, .5);
  assert.equal(hub.requests.length, 3, 'a done order asks again at once');
  assert.match(hub.requests[2].payload.situation, /You are Max/);
  for (const index of [2, 3]) {
    hub.requests[index].resolve({ type: 'decision', error: 'budget' }); await flush();
    run(simulation, director, .5);
  }
  assert.equal(named(events, 'companions-budget').length, 1);
});

test('no question, no body tick while paused, in the lobby or after the night', () => {
  const { simulation, director, hub, bodies } = room();
  director.setCount(1, 'h0');
  run(simulation, director, 1);
  assert.equal(bodies[0].ticks, 0); assert.equal(hub.requests.length, 0);
  simulation.start('h0'); simulation.phase = 'wave'; simulation.paused = true;
  run(simulation, director, 1);
  assert.equal(bodies[0].ticks, 0); assert.equal(hub.requests.length, 0);
  simulation.paused = false; simulation.phase = 'gameover';
  run(simulation, director, 1);
  assert.equal(hub.requests.length, 0);
});

test('the hub only answers a brain that said hello, and resolves every pending question when it leaves', async () => {
  const hub = new CompanionHub({ timeout: 50 }), changes = [];
  hub.onChange(connected => changes.push(connected));
  const socket = Object.assign(new EventEmitter(), { sent: [], send(data) { this.sent.push(JSON.parse(data)); }, close() {} });
  hub.attach(socket);
  assert.equal(hub.connected, false);
  assert.deepEqual(await hub.request({ room: 'X' }), { type: 'decision', error: 'offline' });
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'brain-hello', name: 'test-brain' })));
  assert.equal(hub.connected, true); assert.deepEqual(socket.sent.at(-1), { type: 'brain-welcome' }); assert.deepEqual(changes, [true]);
  const answered = hub.request({ room: 'X', actions: [] });
  const decide = socket.sent.at(-1);
  assert.equal(decide.type, 'decide');
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'decision', id: decide.id, action: 'hold' })));
  assert.equal((await answered).action, 'hold');
  assert.equal((await hub.request({ room: 'X' })).error, 'timeout');
  const pending = hub.request({ room: 'X' });
  socket.emit('close');
  assert.equal((await pending).error, 'disconnected');
  assert.equal(hub.connected, false); assert.deepEqual(changes, [true, false]);
});

test('a hesitant switch to another target of the same kind is ignored; another kind or a sure answer applies', async () => {
  const { simulation, director, hub, bodies } = room();
  director.setCount(1, 'h0'); simulation.start('h0'); simulation.phase = 'wave';
  const situation = {
    text: 'You are Max.', actions: [{ value: 'shoot:z1', description: '' }, { value: 'shoot:z2', description: '' }, { value: 'hold', description: '' }],
    orders: { 'shoot:z1': { kind: 'shoot', zombieId: 'z1' }, 'shoot:z2': { kind: 'shoot', zombieId: 'z2' }, hold: { kind: 'hold' } },
  };
  director.describe = () => situation;
  const answer = async (action, confidence) => {
    run(simulation, director, 1.1);
    hub.requests.at(-1).resolve({ type: 'decision', action, confidence }); await flush();
    return bodies[0].orders.at(-1);
  };
  assert.deepEqual(await answer('shoot:z1', .3), { kind: 'shoot', zombieId: 'z1' }, 'the first order always applies');
  assert.deepEqual(await answer('shoot:z2', .3), { kind: 'shoot', zombieId: 'z1' }, 'hesitant switch ignored');
  assert.deepEqual(await answer('shoot:z2', .7), { kind: 'shoot', zombieId: 'z2' }, 'a sure switch applies');
  assert.deepEqual(await answer('hold', .2), { kind: 'hold' }, 'another kind of order applies');
});

test('integration review: start time for the order, gone answers dropped, urgent switches allowed, seats', async () => {
  const { simulation, director, hub, bodies } = room();
  director.setCount(2, 'h0'); simulation.start('h0'); simulation.phase = 'wave';
  let current = {
    text: 'You are Max.', actions: [{ value: 'shoot:z1', description: '' }, { value: 'shoot:z2', description: '' }, { value: 'hold', description: '' }],
    orders: { 'shoot:z1': { kind: 'shoot', zombieId: 'z1' }, 'shoot:z2': { kind: 'shoot', zombieId: 'z2' }, hold: { kind: 'hold' } },
  };
  const seen = [];
  director.describe = (sim, id, options) => { seen.push(options); return current; };
  run(simulation, director, .1);
  const maxRequest = () => hub.requests.filter(request => request.payload.companion.name === 'Max').at(-1);
  const answer = async (action, confidence) => {
    maxRequest().resolve({ type: 'decision', action, confidence }); await flush();
    run(simulation, director, 1.1);
  };
  await answer('shoot:z2', .9);
  const since = director.entries.get([...director.entries.keys()][0]).orderSince;
  assert.ok(seen.some(options => options.orderSince === since && since > 0), 'orderSince is the start time');
  // The urgent target (listed first) replaces the current one even when hesitant.
  await answer('shoot:z1', .2);
  assert.deepEqual(bodies[0].orders.at(-1), { kind: 'shoot', zombieId: 'z1' });
  // An answer whose target died meanwhile is dropped.
  current = { ...current, actions: current.actions.filter(action => action.value !== 'shoot:z2'), orders: { 'shoot:z1': current.orders['shoot:z1'], hold: current.orders.hold } };
  const before = bodies[0].orders.length;
  maxRequest().resolve({ type: 'decision', action: 'shoot:z2', confidence: .9 }); await flush();
  assert.equal(bodies[0].orders.length, before, 'a target gone since the question is never ordered');
  // Seats: a downed companion leaves first; the last one fighting never does.
  const ids = [...director.entries.keys()], [first, second] = ids.map(id => simulation.players.get(id));
  simulation.addPlayer('h1', 'Jules', undefined, { defer: true });
  Object.assign(first, { downed: true });
  assert.equal(director.makeRoomForHuman(), true);
  assert.equal(simulation.players.has(first.id), false); assert.equal(simulation.players.has(second.id), true);
  simulation.addPlayer('h2', 'Mamie', undefined, { defer: true });
  Object.assign(simulation.players.get('h0'), { downed: true });
  assert.equal(director.makeRoomForHuman(), false, 'the last companion standing keeps the night going');
});

test('a stray connection never unseats the brain; a second brain takes over on hello without a drop', () => {
  const hub = new CompanionHub({ timeout: 50 }), changes = [];
  hub.onChange(connected => changes.push(connected));
  const socket = () => Object.assign(new EventEmitter(), { sent: [], closed: null, send(data) { this.sent.push(JSON.parse(data)); }, close(code) { this.closed = code; } });
  const first = socket(), stray = socket(), second = socket();
  hub.attach(first); first.emit('message', Buffer.from(JSON.stringify({ type: 'brain-hello', name: 'first' })));
  hub.attach(stray); stray.emit('close');
  assert.equal(hub.connected, true); assert.equal(hub.brain.name, 'first'); assert.deepEqual(changes, [true]);
  hub.attach(second); second.emit('message', Buffer.from(JSON.stringify({ type: 'brain-hello', name: 'second' })));
  assert.equal(hub.brain.name, 'second'); assert.equal(first.closed, 1000);
  assert.deepEqual(changes, [true], 'no disconnection in between: the companions stay');
  first.emit('close');
  assert.equal(hub.connected, true, 'the old brain closing does not unseat the new one');
});
