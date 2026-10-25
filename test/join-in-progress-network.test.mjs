import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createOnlineServer } from '../online-server.mjs';

class Peer {
  constructor(url) {
    this.socket = new WebSocket(url.replace(/^http/, 'ws') + '/ws');
    this.messages = []; this.waiters = new Set(); this.socket.on('error', () => {});
    this.socket.on('message', raw => {
      const message = JSON.parse(raw); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
  }
  async open() { await once(this.socket, 'open'); return this; }
  send(message) { const mark = this.messages.length; this.socket.send(JSON.stringify(message)); return mark; }
  wait(predicate, mark = 0) {
    const old = this.messages.slice(mark).findLast(predicate); if (old) return Promise.resolve(old);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(Error(`Late-join message timed out: ${JSON.stringify(this.messages.at(-1))}`)); }, 8000);
      const waiter = { predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      this.waiters.add(waiter);
    });
  }
  state(predicate, mark = 0) { return this.wait(message => message.type === 'state' && predicate(message), mark); }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close'); this.socket.close(); await closed;
  }
}
const player = (state, id) => state.players.find(value => value.id === id);

async function online(t) {
  let now = 1000;
  const server = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false, clock: () => now });
  const address = await server.listen(), peers = [], url = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await Promise.all(peers.map(peer => peer.close())); await server.close(); });
  const connect = async fields => {
    const peer = await new Peer(url).open(); peers.push(peer);
    const mark = peer.send({ type: 'join', protocol: 1, build: server.build, name: 'Join QA', ...fields });
    return { peer, ...await peer.wait(message => ['welcome', 'error'].includes(message.type), mark) };
  };
  const socket = async () => { const peer = await new Peer(url).open(); peers.push(peer); return peer; };
  const barrier = async peer => { const nonce = `barrier-${peer.messages.length}`, mark = peer.send({ type: 'ping', nonce }); await peer.wait(message => message.type === 'pong' && message.nonce === nonce, mark); };
  return { server, connect, socket, barrier, now: value => { now = value; } };
}

test('online production joins are spectators; Ready and reconnection preserve identity without changing the live wave', { timeout: 15000 }, async t => {
  const { server, connect, socket, barrier } = await online(t);
  const host = await connect(), room = server.rooms.get(host.room), sim = room.simulation;
  sim.start(host.id); sim.beginWave();
  const late = await connect({ room: host.room });
  let state = await late.peer.state(value => player(value, late.id)?.waiting);
  assert.equal(player(state, late.id).alive, false); assert.equal(state.wavePlayerCount, 1);
  assert.equal(player(state, late.id).points, 0);
  let mark = late.peer.send({ type: 'shoot', shotId: 10, yaw: 1, pitch: .5 });
  assert.equal((await late.peer.wait(message => message.type === 'shot-ack', mark)).accepted, false);
  late.peer.send({ type: 'input', seq: 1, dt: 1 / 30, forward: 1, strafe: 0, yaw: 1, pitch: .5 });
  await barrier(late.peer); server.step();
  assert.equal(sim.inputs.get(late.id).queue.length, 0); assert.equal(sim.inputs.get(late.id).received, 0);
  mark = host.peer.send({ type: 'pause', paused: true }); await host.peer.state(value => value.paused, mark);
  mark = late.peer.send({ type: 'ready', id: host.id });
  state = await late.peer.state(value => player(value, late.id)?.ready, mark);
  assert.equal(player(state, late.id).waiting, true); assert.equal(player(state, late.id).alive, false);
  const reserved = sim.players.get(late.id), closed = once(server.sessions.get(late.resumeToken).socket, 'close');
  await late.peer.close(); await closed;
  const resumedPeer = await socket();
  mark = resumedPeer.send({ type: 'resume', protocol: 1, build: server.build, token: late.resumeToken });
  const resumed = await resumedPeer.wait(message => message.type === 'welcome', mark);
  assert.equal(resumed.id, late.id); assert.equal(resumed.resumed, true);
  state = await resumedPeer.state(value => player(value, late.id)?.connected && player(value, late.id)?.ready, mark);
  assert.equal(player(state, late.id).waiting, true); assert.equal(sim.players.get(late.id), reserved);
  assert.equal(sim.wavePlayerCount, 1);
  sim.setPause(host.id, false); sim.spawnWarnings.clear(); sim.toSpawn = 0; sim.finishWave();
  mark = resumedPeer.send({ type: 'ready' });
  state = await resumedPeer.state(value => player(value, late.id)?.waiting === false, mark);
  assert.equal(player(state, late.id).alive, true); assert.equal(player(state, late.id).ammo, 12);
  assert.equal(player(state, late.id).reserve, 36); assert.equal(player(state, late.id).points, 0);
  assert.equal(player(state, late.id).grenades, 0); assert.equal(state.wavePlayerCount, 1);
  sim.beginWave(); assert.equal(sim.wavePlayerCount, 2);
  const third = await connect({ room: host.room }), fourth = await connect({ room: host.room });
  assert.equal(sim.players.get(third.id).waiting, true); assert.equal(sim.players.get(fourth.id).waiting, true);
  const full = await connect({ room: host.room }); assert.equal(full.code, 'room-full');
  assert.equal(sim.wavePlayerCount, 2);
  sim.endGame();
  mark = third.peer.send({ type: 'ready' });
  state = await third.peer.state(value => value.phase === 'gameover', mark);
  assert.equal(player(state, third.id).waiting, true); assert.equal(player(state, third.id).ready, false);
});

test('waiting joins, Ready spam, rejected inputs and resume cannot keep an idle paused room alive', { timeout: 15000 }, async t => {
  const { server, connect, socket, barrier, now } = await online(t);
  const host = await connect(), room = server.rooms.get(host.room), sim = room.simulation;
  sim.start(host.id); sim.beginWave();
  let mark = host.peer.send({ type: 'pause', paused: true }); await host.peer.state(value => value.paused, mark);
  const lastActivity = room.lastActivity;
  now(lastActivity + 2 * 60 * 60 * 1000 - 1000);
  const late = await connect({ room: host.room });
  assert.equal(room.lastActivity, lastActivity, 'a waiting connection is not gameplay activity');
  for (let index = 0; index < 4; index++) {
    late.peer.send({ type: 'ready' });
    late.peer.send({ type: 'input', seq: index + 1, dt: 1 / 30, forward: 1, strafe: 0, yaw: 1, pitch: 0 });
  }
  await barrier(late.peer);
  assert.equal(room.lastActivity, lastActivity);
  const closed = once(server.sessions.get(late.resumeToken).socket, 'close'); await late.peer.close(); await closed;
  const replacement = await socket();
  mark = replacement.send({ type: 'resume', protocol: 1, build: server.build, token: late.resumeToken });
  await replacement.wait(message => message.type === 'welcome', mark);
  assert.equal(room.lastActivity, lastActivity);
  now(lastActivity + 2 * 60 * 60 * 1000 + 1);
  mark = host.peer.messages.length; server.heartbeat();
  assert.equal((await host.peer.wait(message => message.type === 'server-shutdown', mark)).reason, 'room-idle-expired');
  assert.equal(server.rooms.size, 0);
});

test('online paused host transfer skips an earlier spectator and survives the new host reconnecting', { timeout: 15000 }, async t => {
  const { server, connect, socket } = await online(t), host = await connect();
  const sim = server.rooms.get(host.room).simulation;
  sim.start(host.id); sim.beginWave();
  const waiting = await connect({ room: host.room }), admitted = await connect({ room: host.room });
  let mark = admitted.peer.send({ type: 'ready' }); await admitted.peer.state(state => player(state, admitted.id)?.ready, mark);
  sim.toSpawn = 0; sim.finishWave(); sim.beginWave();
  mark = host.peer.send({ type: 'pause', paused: true }); await host.peer.state(state => state.paused, mark);
  mark = host.peer.send({ type: 'leave' }); await host.peer.wait(message => message.type === 'left', mark);
  let state = await admitted.peer.state(value => value.hostId === admitted.id && value.paused);
  assert.equal(state.pauseById, admitted.id); assert.equal(player(state, waiting.id).waiting, true);
  mark = waiting.peer.send({ type: 'pause', paused: false });
  state = await waiting.peer.state(value => value.hostId === admitted.id && value.paused, mark);
  assert.equal(state.pauseById, admitted.id);
  const closed = once(server.sessions.get(admitted.resumeToken).socket, 'close'); await admitted.peer.close(); await closed;
  const resumed = await socket();
  mark = resumed.send({ type: 'resume', protocol: 1, build: server.build, token: admitted.resumeToken });
  const welcome = await resumed.wait(message => message.type === 'welcome', mark);
  assert.equal(welcome.id, admitted.id); assert.equal(welcome.hostId, admitted.id); assert.equal(welcome.resumed, true);
  state = await resumed.state(value => value.paused && value.hostId === admitted.id, mark);
  assert.equal(player(state, admitted.id).waiting, false);
  mark = resumed.send({ type: 'pause', paused: false });
  state = await resumed.state(value => !value.paused && value.hostId === admitted.id, mark);
  assert.equal(state.phase, 'wave'); assert.equal(state.pauseById, null);
});

test('LAN production admits explicit Ready in paused countdown, waits during a wave, and leaves finished runs on results', { timeout: 20000 }, async t => {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } });
  let output = '';
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(output || 'LAN test server did not start')), 10000);
    const collect = chunk => { output += chunk; const match = output.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`LAN test server exited ${code}: ${output}`)); });
  });
  const peers = []; t.after(() => Promise.all(peers.map(peer => peer.close())));
  const { build } = await (await fetch(origin + '/version.json')).json();
  const connect = async room => {
    const peer = await new Peer(origin).open(); peers.push(peer);
    const mark = peer.send({ type: 'join', build, name: 'LAN Join QA', ...(room ? { room } : {}) });
    return { peer, ...await peer.wait(message => message.type === 'welcome', mark) };
  };
  const host = await connect();
  let mark = host.peer.send({ type: 'start' }); await host.peer.state(value => value.phase === 'countdown', mark);
  mark = host.peer.send({ type: 'pause', paused: true }); await host.peer.state(value => value.paused, mark);
  const late = await connect(host.room);
  let state = await late.peer.state(value => player(value, late.id)?.waiting);
  assert.equal(player(state, late.id).alive, false);
  mark = late.peer.send({ type: 'ready', id: host.id });
  state = await late.peer.state(value => player(value, late.id)?.waiting === false, mark);
  assert.equal(state.paused, true); assert.equal(player(state, late.id).alive, true);
  mark = host.peer.send({ type: 'pause', paused: false });
  await host.peer.state(value => value.phase === 'wave', mark);
  const pending = await connect(host.room);
  state = await pending.peer.state(value => player(value, pending.id)?.waiting);
  assert.equal(state.wavePlayerCount, 2);
  mark = pending.peer.send({ type: 'ready' });
  state = await pending.peer.state(value => player(value, pending.id)?.ready, mark);
  assert.equal(player(state, pending.id).alive, false); assert.equal(state.wavePlayerCount, 2);
  pending.peer.send({ type: 'input', forward: 1, strafe: 0, yaw: 2, pitch: .5 }); pending.peer.send({ type: 'shoot' });
  state = await pending.peer.state(value => player(value, pending.id)?.ready, pending.peer.messages.length);
  assert.equal(player(state, pending.id).ammo, 12); assert.equal(player(state, pending.id).yaw, 0);
  await host.peer.close(); await late.peer.close();
  state = await pending.peer.state(value => value.phase === 'gameover');
  assert.equal(state.hostId, pending.id); assert.equal(player(state, pending.id).waiting, true);
  mark = pending.peer.send({ type: 'ready' });
  state = await pending.peer.state(value => value.phase === 'gameover', mark);
  assert.equal(player(state, pending.id).alive, false);
  mark = pending.peer.send({ type: 'restart' });
  state = await pending.peer.state(value => value.phase === 'countdown', mark);
  assert.equal(player(state, pending.id).waiting, false); assert.equal(player(state, pending.id).alive, true);
});
