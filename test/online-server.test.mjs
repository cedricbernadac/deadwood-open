import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createOnlineServer, scheduleOnlineTicks } from '../online-server.mjs';
import { onlineConfig } from '../online-config.mjs';

class Peer {
  constructor(url, options) {
    this.socket = new WebSocket(url.replace(/^http/, 'ws') + '/ws', options);
    this.messages = []; this.waiters = new Set();
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
    this.socket.on('error', () => {});
  }
  async open() { await once(this.socket, 'open'); return this; }
  send(message) { const since = this.messages.length; this.socket.send(JSON.stringify(message)); return since; }
  wait(predicate, since = 0) {
    const existing = this.messages.slice(since).find(predicate); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.waiters.delete(waiter); reject(new Error('WebSocket response timed out.')); }, 3000);
      const waiter = { predicate, finish: message => { clearTimeout(timeout); this.waiters.delete(waiter); resolve(message); } };
      this.waiters.add(waiter);
    });
  }
  async join(server, fields = {}) {
    const mark = this.send({ type: 'join', protocol: 1, build: server.build, name: 'Test', ...fields });
    return this.wait(message => message.type === 'welcome' || message.type === 'error' || message.type === 'outdated', mark);
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close'); this.socket.close(); await closed;
  }
}

async function fixture(t, overrides = {}) {
  let now = 1000;
  const server = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false, clock: () => now,
    config: { ...onlineConfig({}), ...overrides } });
  const address = await server.listen(), url = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());
  return { server, url, now: value => { now = value; }, peer: async options => new Peer(url, options).open() };
}

test('online server leaves the hospital art out until the hospital is an online map', async t => {
  const { url } = await fixture(t);
  assert.equal((await fetch(url + '/levels/hospital.glb', { method: 'HEAD' })).status, 404);
  assert.equal((await fetch(url + '/levels/hospital-preview.html', { method: 'HEAD' })).status, 404);
  assert.equal((await fetch(url + '/levels/supermarket.glb', { method: 'HEAD' })).status, 200);
  // The shared space module still reaches the hospital geometry it imports.
  assert.equal((await fetch(url + '/level-space-hospital.js', { method: 'HEAD' })).status, 200);
});

test('online server leaves funfair art out until the funfair is an online map', async t => {
  const { url } = await fixture(t);
  assert.equal((await fetch(url + '/levels/funfair.glb', { method: 'HEAD' })).status, 404);
  assert.equal((await fetch(url + '/levels/funfair-preview.html', { method: 'HEAD' })).status, 404);
  assert.equal((await fetch(url + '/levels/supermarket.glb', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(url + '/level-space-funfair.js', { method: 'HEAD' })).status, 200);
});

test('online HTTP advertises explicit mode/caps with no LAN addresses or tokens', async t => {
  const { url, server } = await fixture(t);
  const config = await (await fetch(url + '/connection.json')).json();
  assert.equal(config.mode, 'online'); assert.equal(config.protocol, 1); assert.equal(config.resumeGraceMs, 30000);
  assert.equal(config.inputRate, 30); assert.equal(config.maxRewindMs, 200);
  assert.deepEqual(await (await fetch(url + '/network.json')).json(), { mode: 'online', urls: [] });
  const health = await (await fetch(url + '/health')).json();
  assert.equal(health.build, server.build); assert.equal(health.rooms, 0); assert.equal(health.players, 0);
  assert.ok(!JSON.stringify(health).includes('token'));
  assert.equal((await fetch(url + '/online-server.mjs')).status, 404);
  assert.equal((await fetch(url + '/connection.json', { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + '/vendor/three.module.js')).status, 200);
  const raids = await fetch(url + '/raids.js');
  assert.equal(raids.status, 200); assert.match(raids.headers.get('content-type'), /javascript/);
  assert.match(await raids.text(), /export const RAIDS/);
  assert.equal((await fetch(url + '/raiders.mjs')).status, 404, 'server AI is fingerprinted but never published');
});

test('join requires matching online protocol/build before making a room', async t => {
  const { peer, server } = await fixture(t); const p = await peer();
  assert.equal((await p.join(server, { protocol: undefined })).code, 'protocol');
  assert.equal((await p.join(server, { build: 'stale' })).type, 'outdated');
  assert.equal(server.rooms.size, 0);
  const joined = await p.join(server);
  assert.equal(joined.type, 'welcome'); assert.equal(joined.network.mode, 'online'); assert.equal(joined.network.protocol, 1);
  assert.equal(joined.resumeToken.length, 43); assert.equal(joined.resumed, false);
  const state = await p.wait(message => message.type === 'state');
  assert.equal(state.net.epoch, joined.network.epoch); assert.equal(state.net.acks[joined.id], 0);
});

test('two independent rooms stay isolated and room join is capped at four', async t => {
  const { peer, server } = await fixture(t); const a = await peer(), b = await peer();
  const first = await a.join(server), second = await b.join(server);
  assert.notEqual(first.room, second.room);
  for (let index = 0; index < 3; index++) assert.equal((await (await peer()).join(server, { room: first.room })).type, 'welcome');
  assert.equal((await (await peer()).join(server, { room: first.room })).code, 'room-full');
  assert.equal(server.rooms.get(first.room).simulation.players.size, 4);
  assert.equal(server.rooms.get(second.room).simulation.players.size, 1);
  const aState = server.rooms.get(first.room).simulation.snapshot();
  assert.ok(!aState.players.some(player => player.id === second.id));
});

test('room and global player quotas fail safely without ghost rooms', async t => {
  const { peer, server } = await fixture(t, { maxRooms: 1, maxPlayers: 2 });
  const a = await peer(), first = await a.join(server);
  assert.equal((await (await peer()).join(server)).code, 'room-capacity');
  assert.equal((await (await peer()).join(server, { room: first.room })).type, 'welcome');
  assert.equal((await (await peer()).join(server, { room: first.room })).code, 'player-capacity');
  assert.equal(server.rooms.size, 1); assert.equal(server.sessions.size, 2);
});

test('explicit leave destroys reservation and permits a fresh room on the same socket', async t => {
  const { peer, server } = await fixture(t); const a = await peer(), first = await a.join(server);
  const mark = a.send({ type: 'leave' }); await a.wait(message => message.type === 'left', mark);
  assert.equal(server.rooms.size, 0); assert.equal(server.sessions.has(first.resumeToken), false);
  assert.equal((await a.join(server)).type, 'welcome');
});

test('reconnect restores same survivor/host/inventory and rotates its secret', async t => {
  const { peer, server } = await fixture(t); const a = await peer(), first = await a.join(server, { practice: true });
  const room = server.rooms.get(first.room), player = room.simulation.players.get(first.id);
  player.points = 1234; player.inventory.assault.ammo = 7;
  const disconnected = once(server.sessions.get(first.resumeToken).socket, 'close'); await a.close(); await disconnected;
  assert.equal(room.simulation.players.get(first.id), player); assert.equal(player.input.forward, 0);
  assert.equal(room.simulation.snapshot().players[0].connected, false);
  const b = await peer(), mark = b.send({ type: 'resume', protocol: 1, build: server.build, token: first.resumeToken });
  const resumed = await b.wait(message => message.type === 'welcome', mark);
  assert.equal(resumed.id, first.id); assert.equal(resumed.hostId, first.id); assert.equal(resumed.resumed, true);
  assert.notEqual(resumed.resumeToken, first.resumeToken); assert.equal(resumed.network.epoch, first.network.epoch);
  assert.equal(player.points, 1234); assert.equal(player.inventory.assault.ammo, 7);
  assert.equal(server.sessions.has(first.resumeToken), false);
  const other = await peer(); const failed = other.send({ type: 'resume', protocol: 1, build: server.build, token: resumed.resumeToken });
  assert.equal((await other.wait(message => message.type === 'error', failed)).code, 'resume-expired');
});

test('reservation expires after 30 seconds and transfers host through normal simulation removal', async t => {
  const { peer, server, now } = await fixture(t); const a = await peer(), first = await a.join(server);
  const b = await peer(), second = await b.join(server, { room: first.room });
  const disconnected = once(server.sessions.get(first.resumeToken).socket, 'close'); await a.close(); await disconnected;
  now(30999); server.step();
  assert.equal(server.rooms.get(first.room).simulation.hostId, first.id);
  now(31001); server.step();
  assert.equal(server.rooms.get(first.room).simulation.hostId, second.id);
  assert.equal(server.sessions.has(first.resumeToken), false);
  const reconnect = await peer(), mark = reconnect.send({ type: 'resume', protocol: 1, build: server.build, token: first.resumeToken });
  assert.equal((await reconnect.wait(message => message.type === 'error', mark)).code, 'resume-expired');
});

test('WebSocket command acknowledgments are per player and malformed input is rejected', async t => {
  const { peer, server } = await fixture(t); const a = await peer(), first = await a.join(server, { practice: true });
  const b = await peer(), second = await b.join(server, { room: first.room });
  const room = server.rooms.get(first.room);
  a.send({ type: 'input', seq: 1, dt: 1e8, forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  let mark = a.send({ type: 'ping', nonce: 'barrier', clientTime: 10 }); await a.wait(message => message.type === 'pong' && message.nonce === 'barrier', mark);
  server.step(); assert.equal(room.simulation.snapshot().net.acks[first.id], 0);
  a.send({ type: 'input', seq: 1, dt: 1 / 30, forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  mark = a.send({ type: 'ping', nonce: 'barrier2' }); await a.wait(message => message.type === 'pong' && message.nonce === 'barrier2', mark);
  server.step(); const state = room.simulation.snapshot();
  assert.equal(state.net.acks[first.id], 1); assert.equal(state.net.acks[second.id], 0);
});

test('shoot IDs echo on authoritative events and duplicates cannot consume another cartridge', async t => {
  const { peer, server } = await fixture(t); const p = await peer(), welcome = await p.join(server, { practice: true });
  const room = server.rooms.get(welcome.room), player = room.simulation.players.get(welcome.id), ammo = player.inventory.assault.ammo;
  let mark = p.send({ type: 'shoot', shotId: 1, yaw: 0, pitch: 0, viewTime: 1000 });
  const ack = await p.wait(message => message.type === 'shot-ack', mark); assert.equal(ack.accepted, true);
  assert.equal((await p.wait(message => message.event === 'shot', mark)).shotId, 1);
  assert.equal(player.inventory.assault.ammo, ammo - 1);
  room.simulation.time += 1;
  mark = p.send({ type: 'shoot', shotId: 1 });
  assert.equal((await p.wait(message => message.type === 'shot-ack', mark)).accepted, false);
  assert.equal(player.inventory.assault.ammo, ammo - 1);
});

test('online weapon commands select an owned duplicate by instance id and reject forged copies', async t => {
  const { peer, server } = await fixture(t), p = await peer(), welcome = await p.join(server, { practice: true });
  const simulation = server.rooms.get(welcome.room).simulation, player = simulation.players.get(welcome.id);
  Object.assign(player, { weapon: 'pistol', weaponId: 'pistol',
    inventory: { pistol: { ammo: 2, reserve: 5 }, 'pistol#2': { ammo: 9, reserve: 17 } } });
  p.send({ type: 'weapon', weapon: 'pistol', weaponId: 'pistol#2' });
  let mark = p.send({ type: 'ping', nonce: 'duplicate-selected' });
  await p.wait(message => message.type === 'pong' && message.nonce === 'duplicate-selected', mark);
  let visible = simulation.snapshot().players.find(value => value.id === player.id);
  assert.equal(visible.weapon, 'pistol'); assert.equal(visible.weaponId, 'pistol#2');
  assert.deepEqual([visible.ammo, visible.reserve], [9, 17]);
  assert.deepEqual(visible.weapons.map(slot => slot.id), ['pistol', 'pistol#2']);
  mark = p.send({ type: 'weapon', weapon: 'pistol', weaponId: 'pistol#999' });
  assert.equal((await p.wait(message => message.type === 'error', mark)).code, 'weapon-unavailable');
  assert.equal(player.weaponId, 'pistol#2', 'an invalid instance cannot fall back to a valid type');
  p.send({ type: 'weapon', weapon: 'pistol' });
  mark = p.send({ type: 'ping', nonce: 'first-selected' });
  await p.wait(message => message.type === 'pong' && message.nonce === 'first-selected', mark);
  visible = simulation.snapshot().players.find(value => value.id === player.id);
  assert.equal(visible.weaponId, 'pistol'); assert.deepEqual([visible.ammo, visible.reserve], [2, 5]);
});

test('online practice drill spawns and replicates two raiders, pauses cleanly and stays out of ordinary rooms', async t => {
  const { peer, server } = await fixture(t);
  const p = await peer(), welcome = await p.join(server, { practice: true });
  const sim = server.rooms.get(welcome.room).simulation;
  let mark = p.send({ type: 'practice', action: 'raiders' });
  await p.wait(message => message.event === 'practice' && message.action === 'raiders', mark);
  server.step();
  const state = await p.wait(message => message.type === 'state' && message.zombies.some(actor => actor.kind === 'raider'), mark);
  const raiders = state.zombies.filter(actor => actor.kind === 'raider');
  assert.equal(raiders.length, 2); assert.equal(state.practice, true);
  for (const actor of raiders) {
    assert.equal(actor.faction, 'raider'); assert.ok(['smg', 'assault'].includes(actor.weapon));
    assert.equal(typeof actor.crouched, 'boolean'); assert.equal(typeof actor.reloading, 'boolean');
    assert.ok(Number.isFinite(actor.pitch));
  }
  mark = p.send({ type: 'pause', paused: true });
  await p.wait(message => message.type === 'state' && message.paused, mark);
  p.send({ type: 'practice', action: 'raiders' });
  const barrier = p.send({ type: 'ping', nonce: 'drill-paused' });
  await p.wait(message => message.type === 'pong' && message.nonce === 'drill-paused', barrier);
  const atPause = sim.time; server.step(); assert.equal(sim.time, atPause);
  assert.deepEqual([...sim.zombies.values()].filter(actor => actor.kind === 'raider').map(actor => actor.id), raiders.map(actor => actor.id));
  const other = await peer(), ordinary = await other.join(server);
  other.send({ type: 'practice', action: 'raiders' });
  const ordinaryBarrier = other.send({ type: 'ping', nonce: 'ordinary-no-drill' });
  await other.wait(message => message.type === 'pong' && message.nonce === 'ordinary-no-drill', ordinaryBarrier);
  assert.equal([...server.rooms.get(ordinary.room).simulation.zombies.values()].some(actor => actor.kind === 'raider'), false);
});

test('online wave-five raid is shared by two survivors and must settle before intermission', async t => {
  const { peer, server } = await fixture(t);
  const host = await peer(), welcome = await host.join(server);
  const guest = await peer(); await guest.join(server, { room: welcome.room });
  const sim = server.rooms.get(welcome.room).simulation;
  sim.start(welcome.id); sim.wave = 4; sim.beginWave();
  // Isolate the raid transition after the wave's infected tail, without
  // weakening spawn gates or waiting through unrelated zombie combat.
  sim.toSpawn = 0; sim.spawnWarnings.clear(); sim.zombies.clear();
  const hostMark = host.messages.length, guestMark = guest.messages.length;
  for (let tick = 0; tick < 80; tick++) server.step();
  const announced = await host.wait(message => message.event === 'raid', hostMark);
  const guestNotice = await guest.wait(message => message.event === 'raid', guestMark);
  assert.equal(announced.index, 1); assert.equal(announced.total, 3); assert.equal(guestNotice.total, announced.total);
  const raidState = await guest.wait(message => message.type === 'state' && message.zombies.some(actor => actor.kind === 'raider'), guestMark);
  assert.equal(raidState.phase, 'wave'); assert.equal(raidState.raid.remaining, 3);
  assert.equal(raidState.zombiesRemaining, 0); assert.equal(raidState.remaining, 3);
  assert.equal(raidState.zombies.filter(actor => actor.kind === 'raider').length, 2);
  for (let tick = 0; tick < 200 && sim.phase === 'wave'; tick++) {
    for (const raider of [...sim.zombies.values()]) if (raider.kind === 'raider')
      sim.damageSpecialZombie(raider, 1e6, welcome.id, { x: 1, y: 0, z: 0 }, 'pistol');
    server.step();
  }
  assert.equal(sim.phase, 'intermission'); assert.equal(sim.raid.killed, 3); assert.equal(sim.raid.cleared, true);
  const cleared = await guest.wait(message => message.event === 'raid-cleared', guestMark);
  assert.equal(cleared.killed, 3); assert.equal(cleared.retreated, 0);
});

test('clock ping echoes nonce/client timestamp with a server monotonic timestamp', async t => {
  const { peer, now } = await fixture(t); const p = await peer(); now(1234.567);
  const mark = p.send({ type: 'ping', nonce: 12, clientTime: 999 });
  assert.deepEqual(await p.wait(message => message.type === 'pong', mark), { type: 'pong', nonce: 12, clientTime: 999, serverTime: 1234.567 });
});

test('native server RTT probes expire a client that never answers without extending their timeout', async t => {
  const { peer, server, now } = await fixture(t); const p = await peer({ autoPong: false });
  const connection = [...server.connections.values()][0]; assert.ok(connection.peer.probe);
  now(11000); server.heartbeat(); assert.equal(connection.peer.probe.at, 1000);
  const closed = once(p.socket, 'close'); now(17001); server.heartbeat(); await closed;
});

test('idle results expire despite neutral inputs and ping; live waves stay intact for hours', async t => {
  const { peer, server, now } = await fixture(t); const p = await peer(), welcome = await p.join(server, { practice: true });
  const room = server.rooms.get(welcome.room); room.simulation.phase = 'gameover';
  now(1000 + 3 * 60 * 60 * 1000);
  p.send({ type: 'input', seq: 1, dt: 1 / 30, forward: 0, strafe: 0, yaw: 0, pitch: 0 });
  let mark = p.send({ type: 'ping', nonce: 'idle-barrier' }); await p.wait(message => message.type === 'pong', mark);
  const expired = p.wait(message => message.type === 'server-shutdown'); server.heartbeat();
  assert.equal((await expired).reason, 'room-idle-expired'); assert.equal(server.rooms.size, 0);
  const active = await peer(), activeWelcome = await active.join(server, { practice: true });
  const activeRoom = server.rooms.get(activeWelcome.room); now(1000 + 6 * 60 * 60 * 1000); server.heartbeat();
  assert.equal(server.rooms.get(activeWelcome.room), activeRoom); assert.equal(activeRoom.simulation.phase, 'wave');
});

test('paused rooms expire after two idle hours while neutral lobby packets cannot hold quotas forever', async t => {
  const { peer, server, now } = await fixture(t); const p = await peer(), welcome = await p.join(server, { practice: true });
  const room = server.rooms.get(welcome.room); room.simulation.setPause(welcome.id, true);
  now(1000 + 2 * 60 * 60 * 1000 + 1); const notice = p.wait(message => message.type === 'server-shutdown'); server.heartbeat();
  await notice; assert.equal(server.rooms.size, 0);
  const lobby = await peer(), entered = await lobby.join(server);
  now(1000 + 4 * 60 * 60 * 1000 + 2);
  lobby.send({ type: 'input', seq: 1, dt: 1 / 30, forward: 0, strafe: 0, yaw: 0, pitch: 0 });
  const mark = lobby.send({ type: 'ping', nonce: 'lobby-idle' }); await lobby.wait(message => message.type === 'pong', mark);
  const expired = lobby.wait(message => message.type === 'server-shutdown'); server.heartbeat(); await expired;
  assert.equal(server.rooms.has(entered.room), false);
});

test('online compression negotiates optionally and is isolated from the LAN entry', async t => {
  const { peer, server } = await fixture(t); const p = await peer();
  assert.equal(server.config.compression, true); assert.ok(p.socket.extensions.includes('permessage-deflate'));
  assert.equal((await p.join(server)).type, 'welcome');
  assert.equal(onlineConfig({ ONLINE_WS_COMPRESSION: 'false' }).compression, false);
});

test('cross-origin upgrade is rejected and matching/explicitly allowed origins work', async t => {
  const { peer, server, url } = await fixture(t, { allowedOrigins: ['https://allowed.example'] });
  const denied = new WebSocket(url.replace('http', 'ws') + '/ws', { origin: 'https://evil.example', headers: { 'X-Forwarded-For': '203.0.113.1' } });
  denied.on('error', () => {});
  const status = await new Promise(resolve => denied.once('unexpected-response', (_request, response) => { response.resume(); denied.terminate(); resolve(response.statusCode); }));
  assert.equal(status, 403); assert.equal(server.connections.size, 0);
  assert.equal((await (await peer({ origin: url })).join(server)).type, 'welcome');
  assert.equal((await (await peer({ origin: 'https://allowed.example' })).join(server)).type, 'welcome');
});

test('create rate applies across sockets behind same real address regardless of forged headers', async t => {
  const { peer, server } = await fixture(t, { createsPerMinute: 1 });
  const a = await peer({ headers: { 'X-Forwarded-For': '203.0.113.1' } }); await a.join(server);
  const b = await peer({ headers: { 'X-Forwarded-For': '203.0.113.2' } });
  assert.equal((await b.join(server)).code, 'create-rate'); assert.equal(server.rooms.size, 1);
});

test('connection address cap cannot be bypassed by forged forwarding addresses', async t => {
  const { peer, server, url } = await fixture(t, { maxConnectionsPerAddress: 1 }); await peer();
  const denied = new WebSocket(url.replace('http', 'ws') + '/ws', { headers: { 'X-Forwarded-For': '198.51.100.42' } });
  denied.on('error', () => {});
  const status = await new Promise(resolve => denied.once('unexpected-response', (_request, response) => { response.resume(); denied.terminate(); resolve(response.statusCode); }));
  assert.equal(status, 429); assert.equal(server.connections.size, 1);
});

test('oversized WebSocket payload closes only that connection and creates no room', async t => {
  const { peer, server } = await fixture(t); const p = await peer(); const closed = once(p.socket, 'close');
  p.socket.send('x'.repeat(4097));
  const [code] = await closed; assert.ok([1006, 1009].includes(code));
  assert.equal(server.rooms.size, 0);
});

test('a full-size malformed input burst never advances beyond server-owned tick time', async t => {
  const { peer, server } = await fixture(t); const p = await peer(), welcome = await p.join(server, { practice: true });
  const sim = server.rooms.get(welcome.room).simulation, player = sim.players.get(welcome.id);
  Object.assign(player, { x: 20, y: 0, z: 20 }); const start = player.z;
  for (let seq = 1; seq <= 64; seq++) p.send({ type: 'input', seq, dt: .05, forward: 1, strafe: 0, yaw: 0, pitch: 0, sprint: true });
  const barrier = p.send({ type: 'ping', nonce: 'all-inputs-arrived' }); await p.wait(message => message.type === 'pong' && message.nonce === 'all-inputs-arrived', barrier);
  server.step(); assert.ok(start - player.z <= 5.4 / 30 + 1e-8);
  assert.equal(sim.snapshot().net.acks[welcome.id], 0);
});

test('malformed JSON is recoverable but sustained message flooding closes the socket', async t => {
  const { peer, server } = await fixture(t, { maxMessagesPerSecond: 5 }); const p = await peer();
  p.socket.send('{broken'); assert.equal((await p.wait(message => message.type === 'error')).code, 'invalid-json');
  const closed = once(p.socket, 'close');
  for (let i = 0; i < 6; i++) p.send({ type: 'ping', nonce: i });
  const [code] = await closed; assert.equal(code, 1008); assert.equal(server.rooms.size, 0);
});

test('graceful shutdown warns clients that their room cannot resume on a new process', async t => {
  const { peer, server } = await fixture(t); const p = await peer(); await p.join(server);
  const notice = p.wait(message => message.type === 'server-shutdown');
  const close = server.close();
  assert.deepEqual(await notice, { type: 'server-shutdown', reason: 'server-restarting', resume: false });
  await close; assert.equal(server.rooms.size, 0); assert.equal(server.sessions.size, 0);
});

test('online configuration rejects invalid numeric caps and malformed allow-list origins', () => {
  for (const env of [{ ONLINE_MAX_ROOMS: '0' }, { ONLINE_MAX_PLAYERS: '2.5' }, { ONLINE_MAX_CONNECTIONS: 'NaN' },
    { ONLINE_ALLOWED_ORIGINS: '*' }, { ONLINE_ALLOWED_ORIGINS: 'https://example.com/path' }]) assert.throws(() => onlineConfig(env));
  assert.deepEqual(onlineConfig({ ONLINE_ALLOWED_ORIGINS: 'https://example.com,http://localhost:3000' }).allowedOrigins, ['https://example.com', 'http://localhost:3000']);
});

test('deadline scheduler keeps 30 Hz under coarse timers and skips a long stall without bursts', () => {
  let now = 0, nextTimer = null, calls = 0;
  const scheduled = scheduleOnlineTicks(() => { calls++; }, { clock: () => now,
    schedule: (callback, delay) => { nextTimer = { callback, at: now + Math.ceil(delay / 15.625) * 15.625 }; return nextTimer; },
    cancel: timer => { if (nextTimer === timer) nextTimer = null; } });
  while (nextTimer?.at <= 1000) { const timer = nextTimer; now = timer.at; timer.callback(); }
  assert.ok(calls >= 29 && calls <= 30, `Expected 30 Hz, saw ${calls}`);
  now += 1000; const before = calls; nextTimer.callback();
  assert.equal(calls, before + 1); assert.ok(nextTimer.at > now, 'No immediate catch-up burst');
  scheduled.stop(); assert.equal(nextTimer, null);
});
