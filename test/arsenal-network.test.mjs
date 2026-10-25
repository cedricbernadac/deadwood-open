import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../', import.meta.url));
async function isolatedServer() {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Arsenal child did not start: ${output}`)); }, 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Arsenal child exited ${code}: ${output}`)); });
    const collect = chunk => { output += chunk; const match = output.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
  });
  return { address, async close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, 'exit'); child.kill(); await closed;
  } };
}
class Peer {
  constructor(address) {
    this.socket = new WebSocket(address.replace('http:', 'ws:') + '/ws'); this.messages = []; this.waiters = new Set();
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
    this.socket.on('error', () => {});
  }
  async open() { await once(this.socket, 'open'); return this; }
  mark() { return this.messages.length; }
  send(message) { const since = this.mark(); this.socket.send(JSON.stringify(message)); return since; }
  wait(predicate, { since = 0, timeout = 5000 } = {}) {
    const existing = this.messages.slice(since).findLast(predicate); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(new Error(`Arsenal message timed out: ${JSON.stringify(this.messages.at(-1))}`)); }, timeout);
      this.waiters.add(waiter);
    });
  }
  state(predicate, options) { return this.wait(message => message.type === 'state' && predicate(message), options); }
  async close() { if (this.socket.readyState === WebSocket.CLOSED) return; const closed = once(this.socket, 'close'); this.socket.close(); await closed; }
}
const player = (state, id) => state.players.find(item => item.id === id);
async function setup(t, practice = false) {
  const server = await isolatedServer(), peers = [];
  t.after(async () => { await Promise.all(peers.map(peer => peer.close())); await server.close(); });
  const connect = async () => { const peer = new Peer(server.address); peers.push(peer); return peer.open(); };
  const build = (await (await fetch(server.address + '/version.json')).json()).build;
  const owner = await connect(), guest = await connect();
  let since = owner.send({ type: 'join', name: 'Arsenal owner', build, practice, weapon: 'magnum', wave: 20, points: 99999, bonus: 'extended' });
  const host = await owner.wait(message => message.type === 'welcome', { since });
  since = guest.send({ type: 'join', room: host.room, name: 'Arsenal guest', build, weapon: 'hammer', points: 99999 });
  const visitor = await guest.wait(message => message.type === 'welcome', { since });
  return { server, owner, guest, host, visitor };
}

test('two real sockets receive the expanded arsenal and cannot forge supplies, uniqueness, prices or room progress', { timeout: 20000 }, async t => {
  const { server, owner, guest, host, visitor } = await setup(t);
  const config = await (await fetch(server.address + '/world.json')).json();
  assert.equal(Object.keys(config.weapons).length, 14); assert.equal(config.world.armory.length, 14);
  const sniper = config.weapons.sniper, drag = 1.225 * sniper.bulletPhysics.dragArea / (2 * sniper.bulletPhysics.mass);
  assert.ok(Math.abs(sniper.damage * Math.exp(-2 * drag * 10) - 350) < 1e-8);
  assert.equal(sniper.bulletPhysics.muzzleSpeed, 382.5); assert.equal(config.ballistics.maxLife, 4);
  assert.equal(config.weapons.hammer.attacks.heavy.damage, 900);
  assert.equal(config.weapons.fireaxe.attacks.light.damage, 160);
  assert.equal(config.weapons.fireaxe.attacks.heavy.maxTargets, 2);
  for (const asset of ['/ballistics.js', '/bullet-profiles.js', '/weapon-upgrades.js']) {
    const response = await fetch(server.address + asset); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
  }
  let state = await owner.state(state => state.players.length === 2);
  for (const survivor of state.players) {
    assert.equal(survivor.weapon, 'pistol'); assert.equal(survivor.points, 0); assert.equal(survivor.bonus, null); assert.deepEqual(survivor.supplyPurchases, []);
  }
  assert.equal(state.magnumAvailable, true); assert.equal(state.supplyCrate, null); assert.equal(state.wave, 0);
  let since = owner.send({ type: 'supply-claim', id: visitor.id, crateId: 'supply-6', bonus: 'stone', points: 99999, wave: 6 });
  const denied = await owner.wait(message => message.type === 'event' && message.event === 'supply-denied' && message.id === host.id, { since });
  assert.equal(denied.id, host.id); assert.equal(denied.reason, 'missing');
  since = guest.send({ type: 'supply-buy', id: host.id, service: 'ammo', price: 0, ammo: 99999, wave: 15 });
  const rejected = await guest.wait(message => message.type === 'event' && message.event === 'supply-denied' && message.id === visitor.id, { since });
  assert.equal(rejected.id, visitor.id); assert.equal(rejected.reason, 'unavailable');

  since = owner.mark(); owner.socket.send('{ definitely not JSON');
  await owner.wait(message => message.type === 'error' && /JSON/.test(message.message), { since });
  for (const malformed of [null, false, 7, {}, [], ['ammo'], { toString: null, valueOf: null }, '__proto__', 'constructor']) {
    owner.send({ type: 'supply-buy', service: malformed, id: visitor.id });
    guest.send({ type: 'supply-claim', bonus: malformed, crateId: 'supply-16', id: host.id });
  }
  owner.socket.send('null'); owner.socket.send('[]'); owner.socket.send('"ignored"');
  owner.send({ type: 'input', forward: 0, strafe: 0, yaw: 0, pitch: 0,
    wave: 16, points: 99999, x: -16, z: 10, bonus: 'extended', magnumAvailable: false,
    inventory: { magnum: { ammo: 99, reserve: 99 } }, supplyPurchases: [], supplyCrate: { id: 'supply-16', claimed: [] } });
  const before = state.time;
  state = await guest.state(state => state.time >= before + .2, { since: guest.mark() });
  for (const survivor of state.players) {
    assert.equal(survivor.weapon, 'pistol'); assert.equal(survivor.ammo, 12); assert.equal(survivor.reserve, 36);
    assert.equal(survivor.points, 0); assert.equal(survivor.bonus, null); assert.deepEqual(survivor.supplyPurchases, []);
  }
  assert.equal(state.wave, 0); assert.equal(state.magnumAvailable, true); assert.equal(state.supplyCrate, null);
  since = owner.send({ type: 'ping' }); await owner.wait(message => message.type === 'pong', { since });
  const health = await (await fetch(server.address + '/health')).json(); assert.equal(health.rooms, 1); assert.equal(health.players, 2);
});

test('two real practice sockets share sniper fire, hammer wind-up and an exact-stock ground exchange', { timeout: 20000 }, async t => {
  const { owner, guest, host, visitor } = await setup(t, true);
  let since = owner.send({ type: 'practice', action: 'weapon', weapon: 'sniper', id: visitor.id, ammo: 99999, damage: 99999 });
  let state = await owner.state(state => player(state, host.id)?.weapon === 'sniper', { since });
  assert.equal(player(state, host.id).ammo, 5); assert.equal(player(state, host.id).reserve, 10);
  assert.equal(player(state, visitor.id).weapon, 'assault'); assert.equal(state.supplyCrate, null);
  const armedAt = state.time; await owner.state(state => state.time >= armedAt + .3, { since: owner.mark() });
  const guestMark = guest.mark(); since = owner.send({ type: 'shoot', id: visitor.id, damage: 99999, ammo: 99999 }); owner.send({ type: 'shoot' });
  const shot = await owner.wait(message => message.type === 'event' && message.event === 'shot' && message.id === host.id, { since });
  assert.equal(shot.weapon, 'sniper');
  assert.equal(shot.ballistic, true); assert.equal(shot.projectiles.length, 1);
  assert.equal(shot.hits, 0, 'a firing event never invents a future impact');
  state = await guest.state(state => player(state, host.id)?.ammo === 4, { since: guestMark });
  assert.equal(player(state, visitor.id).ammo, 24, 'forged actor does not consume teammate ammunition');
  assert.equal(player(state, host.id).reserve, 10);

  since = guest.send({ type: 'practice', action: 'weapon', weapon: 'hammer', id: host.id });
  state = await guest.state(state => player(state, visitor.id)?.weapon === 'hammer', { since });
  const hammerAt = state.time; await guest.state(state => state.time >= hammerAt + .3, { since: guest.mark() });
  const ownerMark = owner.mark(); since = guest.send({ type: 'shoot', attack: 'heavy', id: host.id, damage: 99999, windup: 0 });
  const swing = await owner.wait(message => message.type === 'event' && message.event === 'melee-start' && message.id === visitor.id, { since: ownerMark });
  assert.equal(swing.weapon, 'hammer'); assert.equal(swing.windup, .75); assert.equal(swing.duration, 2.2);
  const bothMark = guest.mark(); since = owner.send({ type: 'drop-weapon' });
  const dropped = await owner.wait(message => message.type === 'event' && message.event === 'weapon-drop' && message.id === host.id && message.weapon === 'sniper', { since });
  state = await guest.state(state => state.pickups.some(item => item.id === dropped.pickupId), { since: bothMark });
  const gun = state.pickups.find(item => item.id === dropped.pickupId); assert.equal(gun.ammo, 4); assert.equal(gun.reserve, 10);
  since = guest.send({ type: 'interact', ammo: 99999, pickupId: 'forged', id: host.id });
  await guest.wait(message => message.type === 'event' && message.event === 'weapon-pickup' && message.id === visitor.id && message.weapon === 'sniper', { since });
  state = await owner.state(state => player(state, visitor.id)?.weapon === 'sniper' && !state.pickups.some(item => item.id === dropped.pickupId), { since: owner.mark() });
  assert.equal(player(state, visitor.id).ammo, 4); assert.equal(player(state, visitor.id).reserve, 10);
  assert.equal(state.pickups.filter(item => item.kind === 'weapon' && item.weapon === 'hammer').length, 1);
  const leaveSince = guest.mark(); await owner.close();
  state = await guest.state(state => state.players.length === 1 && state.hostId === visitor.id, { since: leaveSince });
  assert.equal(player(state, visitor.id).ammo, 4); assert.equal(player(state, visitor.id).reserve, 10);
  assert.equal(state.pickups.filter(item => item.kind === 'weapon' && item.weapon === 'hammer').length, 1);
});

test('two real practice sockets receive the bat wind-up and authoritative impact without forged ammo or timing', { timeout: 20000 }, async t => {
  const { owner, guest, host, visitor } = await setup(t, true);
  let since = owner.send({ type: 'practice', action: 'weapon', weapon: 'bat', id: visitor.id, damage: 99999, ammo: 999 });
  let state = await owner.state(state => player(state, host.id)?.weapon === 'bat', { since });
  assert.equal(player(state, host.id).ammo, 0); assert.equal(player(state, host.id).reserve, 0);
  assert.equal(player(state, visitor.id).weapon, 'assault');
  const armedAt = state.time; await owner.state(state => state.time >= armedAt + .3, { since: owner.mark() });
  const guestMark = guest.mark(); since = owner.send({ type: 'shoot', attack: 'heavy', id: visitor.id, windup: 0, duration: 0, damage: 99999 });
  for (let index = 0; index < 10; index++) owner.send({ type: 'shoot', attack: 'heavy' });
  const start = await guest.wait(message => message.type === 'event' && message.event === 'melee-start' && message.id === host.id, { since: guestMark });
  assert.deepEqual([start.weapon, start.windup, start.duration], ['bat', .35, 1]);
  const hit = await guest.wait(message => message.type === 'event' && message.event === 'melee-hit' && message.id === host.id, { since: guestMark });
  assert.ok(hit.time - start.time >= .35 - 1e-8); assert.ok(hit.hits <= 1); assert.equal(hit.attackId, start.attackId);
  assert.equal(guest.messages.slice(guestMark).filter(message => message.event === 'melee-start' && message.id === host.id).length, 1);
  state = await owner.state(state => state.time >= hit.time, { since });
  assert.equal(player(state, host.id).ammo, 0); assert.equal(player(state, host.id).reserve, 0);
  assert.equal(player(state, visitor.id).ammo, 24);
});

test('two real practice sockets share both fire axe swings with server timing, two-target cap and no invented ammunition', { timeout: 20000 }, async t => {
  const { owner, guest, host, visitor } = await setup(t, true);
  let since = owner.send({ type: 'practice', action: 'weapon', weapon: 'fireaxe', id: visitor.id, damage: 99999, ammo: 999 });
  let state = await owner.state(state => player(state, host.id)?.weapon === 'fireaxe', { since });
  assert.equal(player(state, host.id).ammo, 0); assert.equal(player(state, host.id).reserve, 0);
  assert.equal(player(state, visitor.id).weapon, 'assault');
  const armedAt = state.time; await owner.state(state => state.time >= armedAt + .3, { since: owner.mark() });
  for (const [attack, windup, duration] of [['light', .4, .6], ['heavy', .55, 1.4]]) {
    const guestMark = guest.mark(); since = owner.send({ type: 'shoot', attack, id: visitor.id, windup: 0, duration: 0, damage: 99999 });
    for (let index = 0; index < 10; index++) owner.send({ type: 'shoot', attack });
    const start = await guest.wait(message => message.type === 'event' && message.event === 'melee-start' && message.id === host.id, { since: guestMark });
    assert.deepEqual([start.weapon, start.attack, start.windup, start.duration], ['fireaxe', attack, windup, duration]);
    const hit = await guest.wait(message => message.type === 'event' && message.event === 'melee-hit' && message.id === host.id, { since: guestMark });
    assert.ok(hit.time - start.time >= windup - 1e-8); assert.ok(hit.hits <= 2); assert.equal(hit.attackId, start.attackId);
    assert.equal(guest.messages.slice(guestMark).filter(message => message.event === 'melee-start' && message.id === host.id).length, 1);
    state = await owner.state(state => state.time >= start.time + duration + .05, { since });
    assert.equal(player(state, host.id).ammo, 0); assert.equal(player(state, host.id).reserve, 0);
    assert.equal(player(state, visitor.id).ammo, 24);
  }
});
