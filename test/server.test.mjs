import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { MAX_WAVES, waveBalance, BARRICADE_BOARDS, EXTERIOR, ARMORY } from '../public/rules.js';
import { WEAPONS, MINIGUN_WINDUP } from '../simulation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function launchServer() {
  const process = spawn(globalThis.process.execPath, ['server.mjs'], {
    cwd: root, env: { ...globalThis.process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    const fail = error => { clearTimeout(timeout); reject(error); };
    process.once('error', fail);
    process.once('exit', code => fail(new Error(`Server exited with ${code}: ${output}`)));
    const collect = chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    };
    process.stdout.on('data', collect);
    process.stderr.on('data', collect);
  });
  return {
    address,
    async close() {
      if (process.exitCode !== null) return;
      const exited = once(process, 'exit');
      process.kill();
      await exited;
    },
  };
}

class Peer {
  constructor(address) {
    this.socket = new WebSocket(address.replace(/^http/, 'ws') + '/ws');
    this.messages = [];
    this.waiters = new Set();
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) waiter.finish(message);
      }
    });
    this.socket.on('error', () => {});
  }

  async open() { await once(this.socket, 'open'); return this; }
  mark() { return this.messages.length; }
  send(message) { const mark = this.mark(); this.socket.send(JSON.stringify(message)); return mark; }
  waitFor(predicate, { since = 0, timeout = 5000 } = {}) {
    const existing = this.messages.slice(since).findLast(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); },
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for server message. Last message: ${JSON.stringify(this.messages.at(-1))}`));
      }, timeout);
      this.waiters.add(waiter);
    });
  }

  state(predicate, options) { return this.waitFor(message => message.type === 'state' && predicate(message), options); }
  event(event, predicate = () => true, options) { return this.waitFor(message => message.type === 'event' && message.event === event && predicate(message), options); }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close');
    this.socket.close();
    await closed;
  }
}

async function join(peer, options = {}) {
  const since = peer.send({ type: 'join', name: 'Survivant', weapon: 'pistol', ...options });
  return peer.waitFor(message => message.type === 'welcome', { since });
}

async function moveUntil(peer, id, input, predicate) {
  const message = { type: 'input', forward: 0, strafe: 0, yaw: 0, pitch: 0, ...input };
  const since = peer.send(message);
  const interval = setInterval(() => peer.send(message), 50);
  try {
    return await peer.state(state => predicate(state.players.find(player => player.id === id)), { since, timeout: 10000 });
  } finally {
    clearInterval(interval);
    peer.send({ type: 'input', forward: 0, strafe: 0, yaw: 0, pitch: 0 });
  }
}

test('real HTTP/WebSocket server on an isolated local port', { timeout: 90000 }, async t => {
  const server = await launchServer();
  t.after(() => server.close());
  const peers = [];
  t.after(async () => { await Promise.all(peers.map(peer => peer.close())); });
  const connect = async () => { const peer = new Peer(server.address); peers.push(peer); return peer.open(); };

  await t.test('serves the game and Three.js locally, exposes configuration, and rejects unsupported requests', async () => {
    const [index, script, three, core, health, world, network, head, missing, traversal, backslash, post] = await Promise.all([
      fetch(server.address + '/'), fetch(server.address + '/client.js'),
      fetch(server.address + '/vendor/three.module.js'), fetch(server.address + '/vendor/three.core.js'),
      fetch(server.address + '/health'), fetch(server.address + '/world.json'), fetch(server.address + '/network.json'),
      fetch(server.address + '/', { method: 'HEAD' }), fetch(server.address + '/missing-file.js'),
      fetch(server.address + '/..%2fserver.mjs'), fetch(server.address + '/..%5cserver.mjs'),
      fetch(server.address + '/', { method: 'POST' }),
    ]);
    for (const response of [index, script, three, core, health, world, network, head]) assert.equal(response.status, 200);
    assert.match(await index.text(), /DEADWOOD|Deadwood/i);
    for (const response of [script, three, core]) {
      assert.match(response.headers.get('content-type'), /javascript/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.ok((await response.text()).length > 100);
    }
    assert.deepEqual(await health.json(), { ok: true, rooms: 0, players: 0 });
    const config = await world.json();
    assert.equal(config.tickRate, 30);
    assert.equal(config.world.loftY, 3.4);
    assert.deepEqual(Object.keys(config.weapons).sort(), ['assault', 'bat', 'fireaxe', 'flamethrower', 'hammer', 'katana', 'magnum', 'minigun', 'pistol', 'rifle', 'rocket', 'shotgun', 'smg', 'sniper']);
    assert.deepEqual(config.world.armory, ARMORY);
    assert.equal(config.weapons.katana.melee, true);
    assert.equal(config.weapons.katana.attacks.heavy.windup, .7);
    const { urls } = await network.json();
    assert.ok(Array.isArray(urls));
    for (const url of urls) assert.equal(new URL(url).port, new URL(server.address).port);
    assert.equal(await head.text(), '');
    assert.ok(Number(head.headers.get('content-length')) > 0);
    // One build id per server start, returned on every join: an outdated page can tell.
    const version = await fetch(server.address + '/version.json');
    assert.equal(version.headers.get('cache-control'), 'no-store');
    const { build } = await version.json();
    assert.match(build, /^[0-9a-f]{12}$/);
    assert.equal((await (await fetch(server.address + '/version.json')).json()).build, build, 'stable while the server runs');
    const visitor = await connect();
    const welcome = await join(visitor, { name: 'Version' });
    assert.equal(welcome.build, build);
    await visitor.close();
    // An outdated page is refused before admission: no room is made and the
    // host never sees a survivor who arrives and leaves at once.
    const host = await connect();
    const hosted = await join(host, { name: 'Hôte', build });
    const late = await connect();
    const joinSince = late.send({ type: 'join', room: hosted.room, name: 'Ancien', build: '000000000000' });
    assert.deepEqual(await late.waitFor(message => message.type === 'outdated', { since: joinSince }), { type: 'outdated', build });
    const createSince = late.send({ type: 'join', name: 'Ancien', build: '000000000000' });
    await late.waitFor(message => message.type === 'outdated', { since: createSince });
    assert.equal(late.messages.some(message => message.type === 'welcome' || message.type === 'state'), false);
    // The visitor's close handler runs on another socket: wait for it, then only the host's room remains.
    let roomHealth;
    for (let attempt = 0; attempt < 40; attempt++) {
      roomHealth = await (await fetch(server.address + '/health')).json();
      if (roomHealth.rooms === 1 && roomHealth.players === 2) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.deepEqual(roomHealth, { ok: true, rooms: 1, players: 2 });
    assert.equal(host.messages.some(message => message.type === 'event' && message.event === 'join' && message.name === 'Ancien'), false);
    assert.equal(host.messages.some(message => message.type === 'state' && message.players.some(player => player.name === 'Ancien')), false);
    assert.equal((await join(late, { room: hosted.room, name: 'Ancien', build })).room, hosted.room, 'once reloaded, the same survivor joins');
    await late.close(); await host.close();
    assert.equal(missing.status, 404);
    assert.equal(traversal.status, 403);
    assert.equal(backslash.status, 403);
    assert.equal(post.status, 405);
  });

  await t.test('enforces room codes, four players, sanitized names and host transfer', async () => {
    const owner = await connect(), guest = await connect(), third = await connect(), fourth = await connect(), fifth = await connect();
    const invalidSince = fifth.send({ type: 'join', room: 'INVALID', name: 'Bob' });
    assert.match((await fifth.waitFor(message => message.type === 'error', { since: invalidSince })).message, /introuvable/);
    const missingSince = fifth.send({ type: 'join', room: 'ZZZZZZ', name: 'Bob' });
    assert.match((await fifth.waitFor(message => message.type === 'error', { since: missingSince })).message, /introuvable/);
    fifth.socket.send('{broken JSON');
    await fifth.waitFor(message => message.type === 'error' && /JSON/.test(message.message));
    const welcome = await join(owner, { name: '  A\u0000lice  ', weapon: 'constructor' });
    assert.match(welcome.room, /^[A-Z0-9]{6}$/);
    assert.equal(welcome.hostId, welcome.id);
    const guestWelcome = await join(guest, { room: ' ' + welcome.room.toLowerCase() + ' ', name: 'Bob' });
    const thirdWelcome = await join(third, { room: welcome.room, weapon: 'minigun' });
    const fourthWelcome = await join(fourth, { room: welcome.room, weapon: 'magnum' });
    const full = await owner.state(state => state.players.length === 4);
    assert.equal(full.players.find(player => player.id === welcome.id).name, 'Alice');
    assert.equal(full.players.find(player => player.id === welcome.id).weapon, 'pistol');
    for (const bonusStarter of [thirdWelcome, fourthWelcome]) {
      const player = full.players.find(item => item.id === bonusStarter.id);
      assert.equal(player.weapon, 'pistol');
      assert.deepEqual(player.ownedWeapons, ['pistol']);
    }
    const fullSince = fifth.send({ type: 'join', room: welcome.room });
    assert.match((await fifth.waitFor(message => message.type === 'error', { since: fullSince })).message, /4 survivants/);
    const duplicateSince = guest.send({ type: 'join', room: welcome.room });
    assert.match((await guest.waitFor(message => message.type === 'error', { since: duplicateSince })).message, /déjà/);
    owner.send({ type: 'leave' });
    const transferred = await guest.state(state => state.players.length === 3 && state.hostId === guestWelcome.id);
    assert.ok(!transferred.players.some(player => player.id === welcome.id));
    // The same socket can create another room after leaving.
    const secondRoom = await join(owner);
    assert.notEqual(secondRoom.room, welcome.room);
    await Promise.all([owner, guest, third, fourth, fifth].map(peer => peer.close()));
  });

  await t.test('practice rooms are explicit, share their mode with guests and authorize only the requesting survivor', async t => {
    const normal = await connect(), practice = await connect(), guest = await connect();
    t.after(async () => { await Promise.all([normal, practice, guest].map(peer => peer.close())); });
    const normalWelcome = await join(normal, { practice: 'true' });
    assert.equal(normalWelcome.practice, false);
    const guestNormal = await join(guest, { room: normalWelcome.room, practice: true });
    assert.equal(guestNormal.practice, false, 'join cannot convert an existing survival room');
    let since = normal.send({ type: 'practice', action: 'weapon', weapon: 'rocket' });
    const normalState = await normal.state(state => state.players.length === 2, { since });
    assert.equal(normalState.practice, false); assert.equal(normalState.phase, 'lobby');
    assert.equal(normalState.players.find(player => player.id === normalWelcome.id).weapon, 'pistol');

    const ownerWelcome = await join(practice, { practice: true, weapon: 'magnum' });
    assert.equal(ownerWelcome.practice, true);
    let state = await practice.state(state => state.practice === true);
    assert.equal(state.phase, 'wave'); assert.equal(state.wave, 0); assert.equal(state.practiceTargets, 5);
    assert.equal(state.players[0].weapon, 'assault');
    guest.send({ type: 'leave' });
    const guestWelcome = await join(guest, { room: ownerWelcome.room, practice: false });
    assert.equal(guestWelcome.practice, true, 'guests inherit the authoritative room mode');
    state = await practice.state(state => state.players.length === 2 && state.practice === true);
    assert.equal(state.players.find(player => player.id === guestWelcome.id).weapon, 'assault');

    since = practice.send({ type: 'shoot' });
    const shot = await practice.event('shot', event => event.id === ownerWelcome.id, { since });
    assert.equal(shot.weapon, 'assault'); assert.equal(shot.hits, 0); assert.equal(shot.ballistic, true);
    const firstImpact = await practice.event('bullet-impact', event => event.id === ownerWelcome.id && event.stop === 'zombie', { since });
    assert.ok(firstImpact.age > 0);
    await practice.event('bullet-impact', event => event.id === ownerWelcome.id && event.stop === 'zombie' && event.zombieId !== firstImpact.zombieId, { since });
    state = await practice.state(state => state.practiceTargets === 4, { since });
    assert.equal(state.players.find(player => player.id === ownerWelcome.id).ammo, 23);
    assert.equal(state.pickups.length, 0);

    since = practice.send({ type: 'practice', action: 'weapon', weapon: 'flamethrower', id: guestWelcome.id });
    state = await practice.state(state => state.players.find(player => player.id === ownerWelcome.id)?.weapon === 'flamethrower', { since });
    assert.equal(state.players.find(player => player.id === guestWelcome.id).weapon, 'assault', 'forged target id cannot equip a teammate');
    assert.deepEqual(state.players.find(player => player.id === ownerWelcome.id).ownedWeapons, ['flamethrower', 'rocket']);
    const equippedAt = state.time;
    await practice.state(state => state.time >= equippedAt + .3);
    since = practice.send({ type: 'practice', action: 'targets' });
    state = await practice.state(state => state.practiceTargets === 5, { since });
    assert.ok(state.zombies.every(zombie => zombie.hp === zombie.maxHp && !zombie.burning));
    assert.equal(state.players.find(player => player.id === ownerWelcome.id).points, 0);
    since = practice.send({ type: 'start' });
    state = await practice.state(state => state.practice === true, { since });
    assert.equal(state.wave, 0); assert.equal(state.phase, 'wave');
    normal.send({ type: 'start' });
    const countdown = await normal.state(state => state.phase === 'countdown');
    assert.equal(countdown.practice, false); assert.equal(countdown.wave, 0);
    assert.equal(countdown.players.find(player => player.id === normalWelcome.id).weapon, 'pistol');
  });

  await t.test('network katana swings are timed, cannot damage early and cancellation retains recovery', async t => {
    const owner = await connect(); t.after(() => owner.close());
    const welcome = await join(owner, { practice: true });
    let since = owner.send({ type: 'practice', action: 'weapon', weapon: 'katana' });
    let state = await owner.state(state => state.players[0]?.weapon === 'katana', { since });
    const equippedAt = state.time; await owner.state(state => state.time >= equippedAt + .3);
    since = owner.send({ type: 'shoot', attack: 'heavy', damage: 99999, windup: 0, targetId: state.zombies[0].id });
    const swing = await owner.event('melee-start', event => event.id === welcome.id, { since });
    assert.equal(swing.attack, 'heavy'); assert.equal(swing.windup, .7); assert.equal(swing.duration, 1.5);
    state = await owner.state(state => state.players[0]?.meleeAttack === 'heavy', { since });
    assert.equal(state.players[0].ammo, 0); assert.equal(state.players[0].reloading, false);
    assert.ok(state.zombies.every(zombie => zombie.hp === zombie.maxHp));
    assert.ok(state.players[0].meleeWindupLeft > 0);
    owner.send({ type: 'melee-cancel', id: 'forged' });
    const cancelled = await owner.event('melee-cancel', event => event.attackId === swing.attackId, { since });
    assert.equal(cancelled.id, welcome.id);
    owner.send({ type: 'shoot', attack: 'light' });
    state = await owner.state(state => state.players[0]?.meleeAttack === null, { since });
    assert.ok(state.players[0].meleeReadyLeft > 0);
    await owner.state(state => state.players[0]?.meleeReadyLeft === 0 && state.time >= swing.time + swing.duration, { since });
    since = owner.send({ type: 'shoot', attack: 'light' });
    const started = await owner.event('melee-start', event => event.id === welcome.id, { since });
    const hit = await owner.event('melee-hit', event => event.attackId === started.attackId, { since });
    assert.ok(hit.time - started.time >= .16 - 1e-8); assert.equal(hit.hits, 0, 'targets remain outside the short blade reach');
    state = await owner.state(state => state.players[0]?.meleeAttack === null, { since });
    assert.equal(state.players[0].ammo, 0); assert.equal(state.players[0].reserve, 0);
    assert.equal(owner.messages.slice(since).some(message => message.event === 'shot'), false);
  });

  await t.test('network spin requests cannot grant a locked minigun or forge its readiness', async t => {
    const owner = await connect(); t.after(() => owner.close());
    const welcome = await join(owner);
    const since = owner.send({ type: 'start' });
    await owner.state(state => state.phase === 'countdown', { since });
    owner.send({ type: 'weapon', weapon: 'minigun' });
    owner.send({ type: 'minigun-spin', spinning: { ready: true, elapsed: 999 } });
    const forged = owner.send({ type: 'minigun-spin', spinning: true, ready: true, elapsed: 999, until: -999 });
    const state = await owner.state(state => state.time > .1, { since: forged });
    const player = state.players.find(item => item.id === welcome.id);
    assert.equal(state.minigunSpinDuration, MINIGUN_WINDUP);
    assert.equal(player.weapon, 'pistol'); assert.deepEqual(player.ownedWeapons, ['pistol']);
    assert.equal(player.ammo, WEAPONS.pistol.magazine);
    assert.equal(player.minigunSpinning, false); assert.equal(player.minigunReady, false); assert.equal(player.minigunSpinLeft, 0);
  });

  await t.test('two clients share movement, staircase, authoritative actions and host authority', async t => {
    const owner = await connect(), guest = await connect();
    t.after(() => Promise.all([owner.close(), guest.close()]));
    const ownerWelcome = await join(owner, { name: 'Alice' });
    const guestWelcome = await join(guest, { room: ownerWelcome.room, name: 'Bob', weapon: 'smg' });
    const initial = await owner.state(state => state.players.length === 2);
    const startingGuest = initial.players.find(player => player.id === guestWelcome.id);
    assert.equal(startingGuest.points, 0);
    assert.deepEqual(startingGuest.ownedWeapons, ['pistol']);
    const guestStart = guest.send({ type: 'start' });
    await guest.state(state => state.time > initial.time + 0.15 && state.phase === 'lobby', { since: guestStart });

    // Pass the south end of the living-room cover before reaching the stairs.
    // Enter from the bottom landing using normal network inputs.
    await moveUntil(owner, ownerWelcome.id, { forward: -1 }, player => player.z >= 5.0);
    await moveUntil(owner, ownerWelcome.id, { strafe: 1 }, player => player.x >= 3.75);
    await moveUntil(owner, ownerWelcome.id, { forward: 1 }, player => player.y === 3.4 && player.z < -2.3);
    await guest.state(state => state.players.find(player => player.id === ownerWelcome.id).y === 3.4);

    const cheatSince = owner.send({ type: 'input', forward: 0, strafe: 0, yaw: 0, pitch: 0, x: 999, hp: 999, ammo: 999 });
    const verified = await owner.state(state => state.time > initial.time + 0.15, { since: cheatSince });
    const actual = verified.players.find(player => player.id === ownerWelcome.id);
    assert.equal(actual.hp, 100);
    assert.equal(actual.ammo, WEAPONS.pistol.magazine);
    assert.ok(actual.x < 8);

    const startSince = owner.send({ type: 'start' });
    const started = await owner.state(state => state.phase === 'countdown', { since: startSince });
    assert.equal(started.players.find(player => player.id === ownerWelcome.id).y, 0);
    await guest.state(state => state.phase === 'countdown');

    const firstShot = owner.send({ type: 'shoot' });
    owner.send({ type: 'shoot' }); owner.send({ type: 'shoot' });
    const shot = await owner.event('shot', event => event.id === ownerWelcome.id, { since: firstShot });
    const heardShot = await guest.event('shot', event => event.id === ownerWelcome.id);
    assert.equal(heardShot.eventId, shot.eventId);
    const afterShot = await guest.state(state => state.players.find(player => player.id === ownerWelcome.id).ammo === WEAPONS.pistol.magazine - 1);
    assert.equal(afterShot.players.find(player => player.id === guestWelcome.id).ammo, WEAPONS.pistol.magazine);

    const guestReloadSince = guest.mark();
    const reloadSince = owner.send({ type: 'reload' });
    await guest.event('reload', event => event.id === ownerWelcome.id, { since: guestReloadSince });
    await owner.state(state => state.players.find(player => player.id === ownerWelcome.id).reloading, { since: reloadSince });
    await guest.state(state => {
      const player = state.players.find(item => item.id === ownerWelcome.id);
      return player.ammo === WEAPONS.pistol.magazine && player.reserve === WEAPONS.pistol.reserve - 1 && !player.reloading;
    }, { since: guestReloadSince });

    const switchSince = owner.mark();
    guest.send({ type: 'weapon', weapon: 'shotgun' });
    await owner.state(state => {
      const player = state.players.find(item => item.id === guestWelcome.id);
      return player.weapon === 'pistol' && player.ammo === WEAPONS.pistol.magazine && player.reserve === WEAPONS.pistol.reserve;
    }, { since: switchSince });
    const invalidWeaponSince = guest.send({ type: 'weapon', weapon: '__proto__' });
    await guest.state(state => state.players.find(player => player.id === guestWelcome.id).weapon === 'pistol', { since: invalidWeaponSince });

    const wave = await guest.state(state => state.phase === 'wave' && state.wave === 1 && state.zombies.length > 0, { timeout: 10000 });
    assert.equal(wave.remaining, waveBalance(1, 2).total);
    assert.equal(wave.maxWaves, MAX_WAVES);
    assert.equal(wave.extractionDuration, 12);
    assert.equal(wave.headshotMultiplier, waveBalance(1, 2).headshotMultiplier);
    const sharedWave = await owner.state(state => state.time === wave.time);
    assert.deepEqual(sharedWave.zombies, wave.zombies, 'both computers receive the same zombie motion');
    for (const zombie of wave.zombies) {
      assert.ok(Number.isFinite(zombie.pushX));
      assert.ok(Number.isFinite(zombie.pushZ));
    }
    const guestShotSince = guest.send({ type: 'shoot' });
    await owner.event('shot', event => event.id === guestWelcome.id && event.weapon === 'pistol');
    await guest.state(state => state.players.find(player => player.id === guestWelcome.id).ammo === WEAPONS.pistol.magazine - 1, { since: guestShotSince });
    const pingSince = guest.send({ type: 'ping' });
    const pong = await guest.waitFor(message => message.type === 'pong', { since: pingSince });
    assert.ok(Number.isFinite(pong.time));

    await owner.close();
    await guest.event('leave', event => event.id === ownerWelcome.id && event.hostId === guestWelcome.id);
    const remaining = await guest.state(state => state.players.length === 1 && state.hostId === guestWelcome.id);
    assert.equal(remaining.phase, 'wave');
    await guest.close();
  });

  await t.test('two clients see individual boards break and a survivor escape through another door', async t => {
    const owner = await connect(), guest = await connect();
    t.after(() => Promise.all([owner.close(), guest.close()]));
    const welcome = await join(owner, { name: 'Éclaireur' });
    const guestWelcome = await join(guest, { room: welcome.room, name: 'Guetteur' });
    const sinceStart = owner.send({ type: 'start' });
    await owner.state(state => state.phase === 'countdown', { since: sinceStart });
    // Reinforced planks absorb several pistol rounds: fire at each low plank
    // through ordinary aim/shoot packets until it breaks, reloading when empty.
    async function shootLowBoards(peer, id, doorId) {
      let state = await peer.state(state => state.players.some(player => player.id === id));
      let fired = 0;
      for (const board of BARRICADE_BOARDS.slice(0, 4)) {
        while (state.doors.find(item => item.id === doorId).boards[board.index] > 0) {
          assert.ok(fired < 24, 'the low planks must break after a finite number of rounds');
          let current = state.players.find(player => player.id === id);
          if (current.ammo === 0) {
            const reloadSince = peer.send({ type: 'reload' });
            state = await peer.state(state => {
              const self = state.players.find(player => player.id === id);
              return !self.reloading && self.ammo > 0;
            }, { since: reloadSince });
            current = state.players.find(player => player.id === id);
          }
          const door = state.doors.find(item => item.id === doorId);
          const yaw = Math.atan2(current.x - door.x, current.z - door.z);
          const pitch = Math.atan2(board.y - current.y - 1.55, Math.hypot(door.x - current.x, door.z - current.z));
          const aimSince = peer.send({ type: 'input', forward: 0, strafe: 0, yaw, pitch });
          await peer.state(state => Math.abs(state.players.find(player => player.id === id).pitch - pitch) < .001, { since: aimSince });
          const shotSince = peer.send({ type: 'shoot' });
          const shot = await peer.event('shot', event => event.id === id, { since: shotSince });
          fired++;
          state = await peer.state(state => state.time >= shot.time + WEAPONS.pistol.interval + .03, { since: shotSince });
        }
      }
      return fired;
    }
    // Starting a night returns everyone to their spawn. Both survivors walk to
    // a doorway with ordinary input packets and open it at the same time.
    const [ownerRounds, guestRounds] = await Promise.all([
      (async () => {
        await moveUntil(owner, welcome.id, { forward: 1 }, player => player.z <= .03);
        await moveUntil(owner, welcome.id, { forward: 1, yaw: Math.PI / 2 }, player => player.x <= -6.4);
        return shootLowBoards(owner, welcome.id, 'west');
      })(),
      (async () => {
        // Reach the north room through the remaining western opening.
        await moveUntil(guest, guestWelcome.id, { strafe: -1 }, player => player.x <= -4.3);
        await moveUntil(guest, guestWelcome.id, { forward: 1 }, player => player.z <= -3.5);
        await moveUntil(guest, guestWelcome.id, { strafe: 1 }, player => player.x >= -.03);
        return shootLowBoards(guest, guestWelcome.id, 'north');
      })(),
    ]);
    const perPlank = Math.ceil(BARRICADE_BOARDS[0].maxHp / WEAPONS.pistol.damage);
    assert.equal(perPlank, 3);
    assert.equal(ownerRounds, 4 * perPlank);
    assert.equal(guestRounds, 4 * perPlank);
    for (const peer of [owner, guest]) {
      const watched = await peer.state(state => ['west', 'north'].every(doorId => state.doors.find(door => door.id === doorId).boards.slice(0, 4).every(hp => hp === 0)));
      for (const doorId of ['west', 'north']) {
        const door = watched.doors.find(item => item.id === doorId);
        assert.deepEqual(door.boards, [0, 0, 0, 0, BARRICADE_BOARDS[4].maxHp]);
        assert.equal(door.hp, BARRICADE_BOARDS[4].maxHp);
      }
    }
    const escaped = await moveUntil(owner, welcome.id, { forward: 1, yaw: Math.PI / 2, sprint: true }, player => player.x < -9.35);
    assert.equal(escaped.players.find(player => player.id === welcome.id).outside, true);
    assert.equal(escaped.outsideDamagePerSecond, EXTERIOR.damagePerSecond);
    await moveUntil(owner, welcome.id, { forward: 1, yaw: 0, sprint: true }, player => player.z < -7.75);
    const hurt = await guest.event('hit', event => event.id === welcome.id && event.source === 'outside');
    assert.equal(hurt.damage, 3);
    await moveUntil(owner, welcome.id, { strafe: 1, yaw: 0, sprint: true }, player => player.x >= -.03);
    const entered = await moveUntil(owner, welcome.id, { forward: 1, yaw: Math.PI, sprint: true }, player => player.z > -5.5);
    const survivor = entered.players.find(player => player.id === welcome.id);
    assert.equal(survivor.outside, false);
    assert.equal(survivor.outsideDamageActive, false);
    assert.ok(survivor.hp > 0 && survivor.hp < 100);
    const shared = await guest.state(state => {
      const player = state.players.find(item => item.id === welcome.id);
      return !player.outside && player.z > -5.5;
    });
    assert.equal(shared.doors.find(door => door.id === 'west').boards[4], BARRICADE_BOARDS[4].maxHp);
    assert.equal(shared.doors.find(door => door.id === 'north').boards[4], BARRICADE_BOARDS[4].maxHp);
  });

  await t.test('two real clients trade dropped guns with exact ammunition and cannot forge grenade stock', async t => {
    const owner = await connect(), guest = await connect();
    t.after(async () => { await Promise.all([owner.close(), guest.close()]); });
    const a = await join(owner), b = await join(guest, { room: a.room });
    const start = owner.send({ type: 'start' });
    const initial = await owner.state(state => state.phase === 'countdown', { since: start });
    const originalA = initial.players.find(player => player.id === a.id), originalB = initial.players.find(player => player.id === b.id);
    const shot = owner.send({ type: 'shoot' });
    await owner.state(state => state.players.find(player => player.id === a.id).ammo === 11, { since: shot });
    const dropA = owner.send({ type: 'drop-weapon', weapon: 'magnum', ammo: 9999, reserve: 9999 });
    const dropB = guest.send({ type: 'drop-weapon' });
    const empty = await owner.state(state => state.players.every(player => player.weapon === null) && state.pickups.filter(item => item.kind === 'weapon').length === 2, { since: dropA });
    await guest.state(state => state.players.every(player => player.weapon === null), { since: dropB });
    assert.deepEqual(empty.pickups.filter(item => item.kind === 'weapon').map(item => item.ammo).sort((x, y) => x - y), [11, 12]);
    assert.ok(empty.pickups.filter(item => item.kind === 'weapon').every(item => item.weapon === 'pistol' && item.reserve === 36 && item.expiresIn === null));
    await moveUntil(guest, b.id, { strafe: -1 }, player => player.x <= originalA.x + .03);
    const take = guest.send({ type: 'interact', pickupId: 'forged', ammo: 9999 });
    const transferred = await guest.state(state => state.players.find(player => player.id === b.id).weapon === 'pistol', { since: take });
    const received = transferred.players.find(player => player.id === b.id);
    assert.equal(received.ammo, 11); assert.equal(received.reserve, 36);
    await moveUntil(owner, a.id, { strafe: 1 }, player => player.x >= originalB.x - .03);
    const takeBack = owner.send({ type: 'interact' });
    const swapped = await owner.state(state => state.players.find(player => player.id === a.id).weapon === 'pistol' && !state.pickups.some(item => item.kind === 'weapon'), { since: takeBack });
    assert.equal(swapped.players.find(player => player.id === a.id).ammo, 12);
    const forged = owner.send({ type: 'grenade', grenades: 999, damage: 99999, x: 0, y: 0, z: 0 });
    const authoritative = await owner.state(state => state.time > swapped.time + .1, { since: forged });
    assert.equal(authoritative.players.find(player => player.id === a.id).grenades, 0);
    assert.equal(authoritative.grenades.length, 0);
  });

  await t.test('a real client cannot buy a locked unowned weapon with forged wave, price or points', async t => {
    const owner = await connect();
    t.after(() => owner.close());
    const welcome = await join(owner, { name: 'Acheteur', weapon: 'smg' });
    const { world } = await (await fetch(server.address + '/world.json')).json();
    const crate = world.armory.find(item => item.weapon === 'rifle');
    const startSince = owner.send({ type: 'start' });
    await owner.state(state => state.phase === 'countdown', { since: startSince });

    const remoteSince = owner.send({ type: 'buy', crateId: crate.id, wave: crate.unlockWave, price: 0, points: 999999 });
    await owner.state(state => {
      const player = state.players.find(item => item.id === welcome.id);
      return player.points === 0 && player.weapon === 'pistol';
    }, { since: remoteSince });
    // Reach the crate through the west partition doorway using ordinary
    // validated movement. No test-only server endpoint.
    await moveUntil(owner, welcome.id, { strafe: -1 }, player => player.x <= -4.3);
    await moveUntil(owner, welcome.id, { forward: 1 }, player => player.z <= -3.8);
    await moveUntil(owner, welcome.id, { strafe: -1 }, player => player.x <= crate.x + Math.sin(crate.facing) * 1.1);
    await moveUntil(owner, welcome.id, { forward: 1 }, player => player.z <= crate.z + Math.cos(crate.facing) * 1.1);
    const buySince = owner.send({ type: 'buy', crateId: crate.id, wave: crate.unlockWave, price: 0, points: 999999 });
    const denied = await owner.event('purchase-denied', event => event.id === welcome.id, { since: buySince });
    assert.equal(denied.message, `${crate.label} disponible à la vague ${crate.unlockWave}.`);
    const state = await owner.state(snapshot => {
      const player = snapshot.players.find(item => item.id === welcome.id);
      return player.points === 0 && player.weapon === 'pistol';
    }, { since: buySince });
    const player = state.players.find(item => item.id === welcome.id);
    assert.equal(player.score, 0);
    assert.deepEqual(player.ownedWeapons, ['pistol']);
    await owner.close();
  });

  await t.test('bonus purchases remain locked over WebSocket at the ground and loft crates', async t => {
    const owner = await connect();
    t.after(() => owner.close());
    const welcome = await join(owner, { name: 'Bonus' });
    const { world } = await (await fetch(server.address + '/world.json')).json();
    const startSince = owner.send({ type: 'start' });
    await owner.state(state => state.phase === 'countdown', { since: startSince });
    // The return route from the minigun must clear the south end of the cover.
    await moveUntil(owner, welcome.id, { forward: -1 }, player => player.z >= 5.0);
    const minigunRack = world.armory.find(item => item.weapon === 'minigun');
    await moveUntil(owner, welcome.id, { strafe: -1 }, player => player.x <= minigunRack.x + Math.sin(minigunRack.facing) * 1.1);
    async function rejectBonus(weapon) {
      const crate = world.armory.find(item => item.weapon === weapon);
      const since = owner.send({ type: 'buy', crateId: crate.id, price: 0, points: 999999, wave: 999 });
      const denied = await owner.event('purchase-denied', event => event.id === welcome.id, { since });
      assert.match(denied.message, /vague/i);
      const state = await owner.state(snapshot => {
        const player = snapshot.players.find(item => item.id === welcome.id);
        return player.weapon === 'pistol' && player.points === 0;
      }, { since });
      assert.ok(state.wave < crate.unlockWave);
      assert.deepEqual(state.players.find(item => item.id === welcome.id).ownedWeapons, ['pistol']);
    }
    await rejectBonus('minigun');
    await moveUntil(owner, welcome.id, { strafe: 1 }, player => player.x >= 3.75);
    await moveUntil(owner, welcome.id, { forward: 1 }, player => player.y === 3.4 && player.z < -2.3);
    const magnumRack = world.armory.find(item => item.weapon === 'magnum');
    await moveUntil(owner, welcome.id, { strafe: 1 }, player => player.x >= magnumRack.x + Math.sin(magnumRack.facing) * 1.1);
    await moveUntil(owner, welcome.id, { forward: 1 }, player => player.z <= magnumRack.z + Math.cos(magnumRack.facing) * 1.1);
    await rejectBonus('magnum');
    await owner.close();
  });

  await t.test('cleans up rooms and peer accounting after all sockets close', async () => {
    // WebSocket close and HTTP requests use different sockets; wait for close handlers to run.
    let health;
    for (let attempt = 0; attempt < 20; attempt++) {
      health = await (await fetch(server.address + '/health')).json();
      if (health.rooms === 0 && health.players === 0) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.deepEqual(health, { ok: true, rooms: 0, players: 0 });
  });
});

test('two WebSocket peers observe server posture and reject forged crouch dimensions', { timeout: 10000 }, async t => {
  const server = await launchServer();
  const owner = await new Peer(server.address).open(), guest = await new Peer(server.address).open();
  t.after(async () => { await Promise.all([owner.close(), guest.close()]); await server.close(); });
  const welcome = await join(owner);
  await join(guest, { room: welcome.room });
  const guestMark = guest.mark();
  const crouchMark = owner.send({ type: 'input', forward: 0, strafe: 0, yaw: 0, pitch: 0, crouch: true, sprint: true, height: .01, eyeHeight: 99 });
  for (const [peer, since] of [[owner, crouchMark], [guest, guestMark]]) {
    const state = await peer.state(state => state.players.some(player => player.id === welcome.id && player.crouched), { since });
    assert.equal(state.players.find(player => player.id === welcome.id).eyeHeight, .88);
  }
  const releaseMark = owner.send({ type: 'input', forward: 0, strafe: 0, yaw: 0, pitch: 0, crouch: false });
  const state = await owner.state(state => state.players.some(player => player.id === welcome.id && !player.crouched), { since: releaseMark });
  assert.equal(state.players.find(player => player.id === welcome.id).eyeHeight, 1.55);
});
