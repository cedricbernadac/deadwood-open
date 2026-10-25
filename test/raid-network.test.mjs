import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { RAIDS, raidDamageScale } from '../public/raids.js';

// Real server on PORT=0. Raider gunfire is timing dependent, so these tests
// never wait for a 'raider-shot'; its shape is pinned at simulation level.
const root = fileURLToPath(new URL('../', import.meta.url));
async function setup(t, practice = true) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; } });
  let output = '';
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(output || 'Raid server did not start')), 10000);
    const collect = chunk => { output += chunk; const match = output.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Raid server exited ${code}: ${output}`)); });
  });
  const peers = []; t.after(async () => { await Promise.all(peers.map(peer => peer.close())); });
  const build = (await (await fetch(origin + '/version.json')).json()).build;
  async function connect(room) {
    const peer = new Peer(origin); peers.push(peer); await once(peer.socket, 'open');
    const since = peer.send({ type: 'join', build, name: 'Raid QA', practice, ...(room ? { room } : {}), raid: { index: 3, triggered: true }, raiders: [{ id: 'r1', x: 0, z: 0 }] });
    const welcome = await peer.wait(message => message.type === 'welcome', since);
    return { peer, ...welcome };
  }
  return { connect };
}
class Peer {
  constructor(origin) {
    this.socket = new WebSocket(origin.replace(/^http/, 'ws') + '/ws'); this.messages = []; this.waiters = new Set();
    this.socket.on('error', () => {});
    this.socket.on('message', raw => { const message = JSON.parse(raw); this.messages.push(message); for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.resolve(message); });
  }
  mark() { return this.messages.length; }
  send(message) { const since = this.mark(); this.socket.send(JSON.stringify(message)); return since; }
  wait(predicate, since = 0) {
    const found = this.messages.slice(since).find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(Error(`Raid wait timed out (${predicate.toString()}): ${JSON.stringify(this.messages.at(-1))}`)); }, 5000);
      this.waiters.add(waiter);
    });
  }
  state(predicate, since = 0) { return this.wait(message => message.type === 'state' && predicate(message), since); }
  // The server handles one socket's messages in order, so a pong proves every
  // earlier command was already applied.
  async flush() { const since = this.send({ type: 'ping' }); await this.wait(message => message.type === 'pong', since); return this.mark(); }
  async close() { if (this.socket.readyState === WebSocket.CLOSED) return; const closed = once(this.socket, 'close'); this.socket.close(); await closed; }
}
const raidersOf = state => state.zombies.filter(zombie => zombie.kind === 'raider');
const shape = raider => ({ id: raider.id, x: raider.x, y: raider.y, z: raider.z, yaw: raider.yaw, hp: raider.hp, weapon: raider.weapon, state: raider.state, crouched: raider.crouched });

test('two real peers see the same drill squad and forged drill fields are ignored', { timeout: 30000 }, async t => {
  const { connect } = await setup(t), host = await connect(), guest = await connect(host.room);
  let state = await host.peer.state(state => state.players.length === 2);
  assert.equal(state.practice, true); assert.equal(state.raid, null, 'joining cannot forge a raid');
  assert.deepEqual(raidersOf(state), [], 'joining cannot forge raiders');
  const hostMark = host.peer.mark(), guestMark = guest.peer.mark();
  host.peer.send({ type: 'practice', action: 'raiders', side: 'north', count: 9, index: 3, damageScale: 5, drill: false, loadout: 'rifle', x: 0, z: 0, id: guest.id });
  const [hostRaid, guestRaid] = await Promise.all([host.peer, guest.peer].map((peer, index) => peer.wait(message => message.event === 'raid', [hostMark, guestMark][index])));
  assert.deepEqual(guestRaid, hostRaid);
  const { index, total, squad, side, damageScale, drill } = hostRaid;
  assert.deepEqual({ index, total, squad, side, damageScale, drill }, { index: 1, total: 2, squad: 2, side: 'west', damageScale: raidDamageScale(2), drill: true },
    'the server picks side, size, scale and the drill flag');
  assert.deepEqual(hostRaid.entries, [{ x: -24, z: -2.5 }, { x: -24, z: 2.5 }]);
  const practiceEvent = await host.peer.wait(message => message.event === 'practice' && message.action === 'raiders', hostMark);
  assert.equal(practiceEvent.id, host.id, 'the action belongs to the sender, never to a forged id');
  // Both peers receive the same snapshots: at a shared server time the squad matches exactly.
  state = await host.peer.state(state => raidersOf(state).length === 2, hostMark);
  const twin = await guest.peer.state(other => other.time === state.time, guestMark);
  assert.deepEqual(raidersOf(twin).map(shape), raidersOf(state).map(shape));
  assert.deepEqual(raidersOf(state).map(raider => [raider.id, raider.faction, raider.family, raider.weapon, raider.maxHp]),
    [['r1', 'raider', 'raider', 'smg', RAIDS.hp[0]], ['r2', 'raider', 'raider', 'assault', RAIDS.hp[0]]]);
  assert.equal(state.practiceTargets, state.zombies.length - 2, 'raiders are not practice targets');
  // Forged event-like packets are not commands; a guest press replaces the squad on the other side.
  host.peer.send({ type: 'raid', index: 3, side: 'north', drill: false });
  host.peer.send({ type: 'raider-shot', raiderId: 'r1', hits: 4 });
  host.peer.send({ type: 'practice', action: 'drill-hit', damage: 50 });
  await host.peer.flush();
  const pressMark = guest.peer.mark(), hostPressMark = host.peer.mark();
  guest.peer.send({ type: 'practice', action: 'raiders', side: 'west' });
  const eastRaid = await guest.peer.wait(message => message.event === 'raid', pressMark);
  assert.deepEqual([eastRaid.side, eastRaid.total, eastRaid.drill], ['east', 2, true]);
  assert.deepEqual(eastRaid.entries, [{ x: 24, z: -2.5 }, { x: 24, z: 2.5 }]);
  assert.equal(host.peer.messages.slice(hostMark, hostPressMark).filter(message => message.event === 'raid').length, 1, 'forged packets raise no raid');
  state = await host.peer.state(state => raidersOf(state).some(raider => raider.id === 'r3'), hostPressMark);
  assert.deepEqual(raidersOf(state).map(raider => raider.id), ['r3', 'r4'], 'at most one drill squad exists');
  assert.ok(state.players.every(player => player.hp === 100 && !player.downed), 'drill fire never touches health');
  // The shared practice cooldown has passed by then; 'targets' clears the drill for everybody.
  const resetAt = state.time + .3;
  await guest.peer.state(state => state.time >= resetAt, guest.peer.mark());
  const resetMark = guest.peer.mark();
  host.peer.send({ type: 'practice', action: 'targets' });
  state = await guest.peer.state(state => raidersOf(state).length === 0 && state.zombies.length > 0, resetMark);
  assert.equal(state.practiceTargets, state.zombies.length);
  assert.deepEqual(state.spawnWarnings.filter(warning => warning.kind === 'raider'), []);
});

test('a campaign room rejects the raider drill over the wire', { timeout: 20000 }, async t => {
  const { connect } = await setup(t, false), host = await connect();
  let since = host.peer.send({ type: 'start' });
  let state = await host.peer.state(state => state.phase !== 'lobby', since);
  assert.equal(state.practice, false);
  since = host.peer.mark();
  host.peer.send({ type: 'practice', action: 'raiders' });
  const flushed = await host.peer.flush();
  state = await host.peer.state(() => true, flushed);
  assert.deepEqual(raidersOf(state), []);
  assert.equal(state.raid, null, 'wave one plans no raid');
  assert.equal(host.peer.messages.slice(since).some(message => ['raid', 'practice', 'raid-squad'].includes(message.event)), false);
  assert.ok(Object.hasOwn(state, 'zombiesRemaining') && Object.hasOwn(state, 'nextRaidWave'), 'the campaign snapshot carries the raid fields');
});
