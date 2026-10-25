import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineTransport } from '../public/online/transport.js';
import { RoomSimulation } from '../simulation.mjs';

const config = { mode: 'online', protocol: 1, inputRate: 30, resumeGraceMs: 30000 };
const turn = () => new Promise(resolve => setImmediate(resolve));
function event(type, data) { const value = new Event(type); for (const [key, item] of Object.entries(data ?? {})) Object.defineProperty(value, key, { value: item }); return value; }
class FakeSocket extends EventTarget {
  static instances = [];
  constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; FakeSocket.instances.push(this); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  send(raw) { if (this.readyState !== 1) throw new Error('Socket not open'); this.sent.push(JSON.parse(raw)); }
  receive(message) { this.dispatchEvent(event('message', { data: typeof message === 'string' ? message : JSON.stringify(message) })); }
  close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(event('close', { code, reason })); }
  cut() { this.close(1006, 'network failure'); }
}
function clock() {
  let now = 0, serial = 0;
  const jobs = new Map();
  return { now: () => now, setTimeout(callback, ms) { const id = ++serial; jobs.set(id, { callback, at: now + ms }); return id; },
    clearTimeout(id) { jobs.delete(id); }, advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; jobs.delete(next[0]); next[1].callback();
      }
      now = end;
    }, get count() { return jobs.size; } };
}
function welcome(changes = {}) {
  return { type: 'welcome', id: 'a', room: 'ABC123', build: 'build-one', resumeToken: 'token-first', resumed: false,
    network: { ...config, epoch: 'epoch-one', serverTime: 1000 }, ...changes };
}
function state(serverTime = 1000) {
  const room = new RoomSimulation('ABC123', { practice: true }); room.addPlayer('a'); room.phase = 'wave'; room.zombies.clear();
  const snapshot = room.snapshot();
  snapshot.players[0].vy = 0; snapshot.players[0].fallStartY = null;
  return { ...snapshot, net: { serverTime, epoch: 'epoch-one', acks: { a: 0 } } };
}
async function fixture(options = {}) {
  FakeSocket.instances = [];
  const time = clock(), transport = new OnlineTransport('wss://deadwood.example/ws', {
    WebSocket: FakeSocket, ...time, loadConfiguration: async () => ({ config, build: 'build-one' }), ...options });
  const messages = [], statuses = [], closes = [], opens = [], restored = [], interrupted = [];
  transport.addEventListener('message', value => messages.push(JSON.parse(value.data)));
  transport.addEventListener('online-status', value => statuses.push(value.detail));
  transport.addEventListener('open', value => opens.push(value)); transport.addEventListener('close', value => closes.push(value));
  transport.addEventListener('online-restored', value => restored.push(value)); transport.addEventListener('online-disconnected', value => interrupted.push(value));
  await turn();
  const socket = FakeSocket.instances.at(-1);
  return { transport, time, socket, messages, statuses, closes, opens, restored, interrupted,
    join() { socket.open(); transport.send(JSON.stringify({ type: 'join', name: 'Nilo' })); socket.receive(welcome()); socket.receive(state()); } };
}

test('join carries the online protocol and preserves an older page build for rejection before room allocation', async () => {
  const f = await fixture(); assert.equal(f.transport.readyState, 0); f.socket.open();
  assert.equal(f.transport.send(JSON.stringify({ type: 'join', name: 'Nilo', protocol: 9, build: 'wrong' })), true);
  assert.deepEqual(f.socket.sent[0], { type: 'join', name: 'Nilo', protocol: 1, build: 'wrong' });
  assert.equal(f.transport.send({ type: 'join', name: 'Nilo' }), true);
  assert.deepEqual(f.socket.sent[1], { type: 'join', name: 'Nilo', protocol: 1, build: 'build-one' });
  f.transport.close();
});
test('transport fails closed for a LAN endpoint or wrong online protocol', async () => {
  for (const bad of [{ mode: 'lan', protocol: 1 }, { mode: 'online', protocol: 2 }]) {
    const f = await fixture({ loadConfiguration: async () => ({ config: bad, build: 'build-one' }) });
    assert.equal(FakeSocket.instances.length, 0); assert.equal(f.transport.readyState, 3); assert.equal(f.closes.length, 1);
    assert.equal(f.transport.resumeToken, null); assert.equal(f.time.count, 0);
  }
});
test('only sequenced fixed-step inputs pass; malformed packets cannot throw or poison the client', async () => {
  const f = await fixture(); f.join();
  assert.equal(f.transport.send(JSON.stringify({ type: 'input', forward: 1, yaw: 0 })), false);
  assert.equal(f.transport.send(JSON.stringify({ type: 'input', seq: 1, dt: 1 / 30, forward: 1 })), true);
  assert.equal(f.transport.send('{broken'), false); assert.equal(f.transport.send('[]'), false);
  const count = f.messages.length; f.socket.receive('{broken'); f.socket.receive('[]'); assert.equal(f.messages.length, count);
  f.transport.close();
});
test('welcome initializes prediction and rejects an incompatible identity/build handshake', async () => {
  const f = await fixture(); f.join();
  assert.equal(f.transport.session.playerId, 'a'); assert.equal(f.transport.session.epoch, 'epoch-one');
  assert.ok(f.transport.session.predictedPlayer); assert.equal(f.transport.resumeToken, 'token-first'); f.transport.close();
  const bad = await fixture(); bad.socket.open(); bad.socket.receive(welcome({ build: 'other' }));
  assert.equal(bad.transport.readyState, 3); assert.equal(bad.messages.length, 0);
});
test('a cut suppresses legacy close/open/welcome until authoritative resume, rotates token and clears pending commands', async () => {
  const f = await fixture(); f.join();
  f.transport.session.update(.1, { forward: 1, strafe: 0, yaw: .7, pitch: .2 }); assert.ok(f.transport.session.pendingCount > 0);
  f.socket.cut(); assert.equal(f.interrupted.length, 1); assert.equal(f.closes.length, 0);
  assert.equal(f.transport.session.connected, false); assert.equal(f.transport.session.pendingCount, 0);
  f.time.advance(500); const resumed = FakeSocket.instances.at(-1); assert.notEqual(resumed, f.socket); resumed.open();
  assert.deepEqual(resumed.sent[0], { type: 'resume', protocol: 1, build: 'build-one', token: 'token-first' });
  assert.equal(f.transport.send({ type: 'shoot', shotId: 123 }), false);
  resumed.receive(welcome({ resumed: true, resumeToken: 'token-second' }));
  assert.equal(f.messages.filter(item => item.type === 'welcome').length, 1); assert.equal(f.opens.length, 1);
  assert.equal(f.restored.length, 0, 'welcome alone cannot unlock stale prediction');
  resumed.receive(state(1500));
  assert.equal(f.restored.length, 1); assert.equal(f.transport.reconnecting, false); assert.equal(f.transport.resumeToken, 'token-second');
  assert.equal(f.transport.session.pendingCount, 0); assert.equal(f.transport.send({ type: 'interact' }), true);
  f.transport.close(); assert.equal(f.time.count, 0);
});
test('reconnect uses bounded backoff and gives up after thirty seconds without ghost timers', async () => {
  const f = await fixture(); f.join(); f.socket.cut(); f.time.advance(500);
  const second = FakeSocket.instances.at(-1); second.cut(); f.time.advance(999); assert.equal(FakeSocket.instances.length, 2);
  f.time.advance(1); assert.equal(FakeSocket.instances.length, 3);
  f.time.advance(28500); assert.equal(f.closes.length, 1); assert.equal(f.transport.readyState, 3);
  assert.equal(f.transport.resumeToken, null); assert.equal(f.time.count, 0);
  f.socket.receive(state(31000)); assert.equal(f.restored.length, 0);
});
test('a rejected resume ends cleanly rather than creating a new survivor or room', async () => {
  const f = await fixture(); f.join(); f.socket.cut(); f.time.advance(500);
  const resumed = FakeSocket.instances.at(-1); resumed.open(); resumed.receive({ type: 'error', code: 'resume-expired', message: 'Expired.' });
  assert.equal(f.closes.length, 1); assert.equal(f.transport.resumeToken, null); assert.equal(f.time.count, 0);
  assert.equal(f.messages.filter(item => item.type === 'welcome').length, 1);
});
test('ordinary gameplay errors after a completed resume stay visible and never close the recovered room', async () => {
  const f = await fixture(); f.join(); f.socket.cut(); f.time.advance(500);
  const resumed = FakeSocket.instances.at(-1); resumed.open();
  resumed.receive(welcome({ resumed: true, resumeToken: 'token-second' })); resumed.receive(state(1500));
  resumed.receive({ type: 'error', code: 'weapon-locked', message: 'This weapon is not available yet.' });
  assert.equal(f.transport.readyState, 1); assert.equal(f.transport.ended, false); assert.equal(f.closes.length, 0);
  assert.ok(f.messages.some(message => message.code === 'weapon-locked'));
  assert.equal(f.transport.send({ type: 'interact' }), true); f.transport.close();
});
test('explicit leave invalidates the RAM token and never reconnects', async () => {
  const f = await fixture(); f.join(); f.transport.close();
  assert.deepEqual(f.socket.sent.at(-1), { type: 'leave' }); assert.equal(f.transport.resumeToken, null);
  f.time.advance(40000); assert.equal(FakeSocket.instances.length, 1); assert.equal(f.closes.length, 1); assert.equal(f.time.count, 0);
});
test('server shutdown and build mismatch bypass reconnect with visible messages', async () => {
  for (const message of [{ type: 'server-shutdown', resume: false }, { type: 'outdated', build: 'next-build' }]) {
    const f = await fixture(); f.join(); f.socket.receive(message); f.time.advance(31000);
    assert.ok(f.messages.some(item => item.type === message.type)); assert.equal(f.closes.length, 1); assert.equal(FakeSocket.instances.length, 1);
  }
});
test('ping every two seconds estimates RTT and ignores unsolicited pong samples', async () => {
  const f = await fixture(); f.join(); f.time.advance(2000);
  const ping = f.socket.sent.find(item => item.type === 'ping'); assert.equal(ping.clientTime, 2000);
  f.time.advance(100); f.socket.receive({ type: 'pong', ...ping, type: 'pong', serverTime: 1050 });
  assert.equal(f.transport.session.clock.rtt, 100);
  f.socket.receive({ type: 'pong', nonce: 'unknown', clientTime: 0, serverTime: 999999 }); assert.equal(f.transport.session.clock.rtt, 100);
  f.socket.receive({ type: 'network-ping', nonce: 'probe' }); assert.deepEqual(f.socket.sent.at(-1), { type: 'network-pong', nonce: 'probe' });
  f.transport.close();
});
test('an unresponsive open connection enters recovery without allowing unlimited prediction', async () => {
  const f = await fixture(); f.join(); f.time.advance(10000);
  assert.equal(f.transport.reconnecting, true); assert.equal(f.transport.session.connected, false);
  assert.equal(f.interrupted.length, 1); assert.equal(f.closes.length, 0); f.transport.close();
});
test('OPEN socket with stale game state suspends controls within 1.25s and resumes only after a fresh snapshot event', async () => {
  const f = await fixture(); f.join();
  f.transport.session.update(.05, { forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  assert.ok(f.transport.session.pendingCount > 0);
  f.time.advance(1250);
  assert.equal(f.socket.readyState, 1, 'TCP remains open in this blackhole scenario');
  assert.equal(f.transport.stale, true); assert.equal(f.transport.session.connected, false);
  assert.equal(f.transport.session.pendingCount, 0); assert.equal(f.interrupted.length, 1);
  assert.equal(f.transport.send({ type: 'shoot', shotId: 4 }), false);
  assert.equal(f.transport.send({ type: 'input', seq: 8, dt: 1 / 30 }), false);
  assert.equal(f.transport.send({ type: 'melee-cancel' }), true, 'release commands can still reach an open server');
  assert.equal(f.transport.session.createShot(), null);
  assert.equal(f.transport.session.update(.1, { forward: 1 }).commands.length, 0);
  f.socket.receive({ type: 'pong', nonce: 'unknown', clientTime: 0, serverTime: 2250 });
  assert.equal(f.transport.stale, true, 'pong is not a replacement for fresh authoritative game state');
  f.socket.receive(state(2250));
  assert.equal(f.transport.stale, false); assert.equal(f.transport.session.connected, true); assert.equal(f.restored.length, 1);
  assert.equal(f.transport.session.pendingCount, 0, 'the frozen movement is never replayed');
  assert.equal(FakeSocket.instances.length, 1, 'fresh state can recover without a new TCP connection');
  f.transport.close(); assert.equal(f.time.count, 0);
});


test('default online configuration follows the websocket map namespace',async()=>{
 for(const root of ['/','/maps/supermarket/']){
  const paths=[],time=clock();FakeSocket.instances=[];
  const transport=new OnlineTransport('ws://deadwood.test'+root+'ws',{WebSocket:FakeSocket,now:time.now,setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,
   fetch:async path=>{paths.push(path);return{ok:true,json:async()=>path.endsWith('connection.json')?config:{build:'build-one'}};}});
  await turn();assert.deepEqual(paths,[root+'connection.json',root+'version.json']);assert.equal(FakeSocket.instances[0].url,'ws://deadwood.test'+root+'ws');transport.close();
 }
});
