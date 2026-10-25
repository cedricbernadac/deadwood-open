// Bounded optional-levels smoke. Reads HTTP, creates only its own temporary
// WebSocket rooms, explicitly leaves them, and never starts/stops a server.
// Public/local use requires --run; default target is localhost, not production.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { splitSaveText } from '../public/save-game.js';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = data => createHash('sha256').update(data).digest('hex');

export async function runOptionalLevelsSmoke({ origin = 'http://127.0.0.1:3000', output = null } = {}) {
  const home = new URL(origin); assert.ok(['http:', 'https:'].includes(home.protocol) && home.pathname === '/' && !home.search && !home.hash, 'Use a gateway origin, without map path.');
  const report = { startedAt: new Date().toISOString(), origin: home.origin, mode: 'automatic online WebSocket smoke; four simulated humans; no paid API',
    apiCalls: 0, checks: [], contexts: {}, cellarRoute: { stages: [], minimumY: 0, samples: 0 }, limits: [
      'Automatic protocol and authority checks, not a browser interaction or human keyboard/mouse game.',
      'Four WebSocket clients share one process/computer; no real multi-PC Wi-Fi or GPU/listening validation.',
      'Requires an empty gateway. Only owned clients send leave/close; no server shutdown or external room deletion.',
      'Global capacity, reservation, origin and failed-worker behavior have separate architecture tests.'
    ] };
  const peers = [], timers = new Set(), contexts = new Map(); let watcherError = null;
  const check = (name, passed, detail = {}) => { report.checks.push({ name, passed: Boolean(passed), ...detail }); assert.ok(passed, name); };
  async function json(url) { const response = await fetch(url, { signal: AbortSignal.timeout(8000) }); assert.equal(response.status, 200, String(url)); return response.json(); }
  async function health() { return json(new URL('health', home)); }
  async function open(context, fields = {}) {
    const url = new URL('ws', context.base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const peer = new Peer(url); peers.push(peer); await peer.open();
    const mark = peer.send({ type: 'join', protocol: 1, build: context.version.build, name: fields.name ?? 'Optional-Smoke', ...fields });
    const welcome = await peer.wait(message => ['welcome', 'error', 'outdated'].includes(message.type), mark);
    return { peer, welcome, mark };
  }
  async function join(context, fields = {}) {
    const connection = await open(context, fields); assert.equal(connection.welcome.type, 'welcome', JSON.stringify(connection.welcome));
    connection.peer.welcome = connection.welcome;
    const room = connection.welcome.room;
    connection.peer.subscribe(message => {
      if (message.type === 'state' && (message.room !== room || (message.mapId ?? 'cabin') !== context.id)) watcherError ??= `Cross-map/room packet on ${context.id}`;
    });
    return connection.peer;
  }
  async function pause(peer, value = true) { const mark = peer.send({ type: 'pause', paused: value }); return peer.state(state => state.paused === value, mark); }
  async function save(peer) { const mark = peer.send({ type: 'save-game' }); const reply = await peer.wait(message => ['save-game', 'save-denied'].includes(message.type), mark); assert.equal(reply.type, 'save-game', JSON.stringify(reply)); return reply.save; }
  async function upload(peer, value) {
    const text = JSON.stringify(value), chunks = splitSaveText(text), mark = peer.messages.length;
    peer.send({ type: 'load-begin', size: text.length, chunks: chunks.length });
    for (const [index, data] of chunks.entries()) peer.send({ type: 'load-chunk', index, data });
    return peer.wait(message => message.type === 'load-result', mark, 10000);
  }
  async function leaveAll() { await Promise.all(peers.map(peer => peer.leaveAndClose())); }
  try {
    report.before = await health();
    check('empty multi-map gateway before room mutations', report.before.ok && report.before.multiMap === true && report.before.rooms === 0 && report.before.players === 0 && report.before.connections === 0, { health: report.before });
    const catalogue = await json(new URL('maps.json', home)); report.catalogue = catalogue;
    check('cabin is default and supermarket is optional', catalogue.multiMap === true && catalogue.defaultMap === 'cabin'
      && catalogue.maps.some(map => map.id === 'cabin' && map.root === '/') && catalogue.maps.some(map => map.id === 'supermarket' && map.root === '/maps/supermarket/'));
    for (const id of ['cabin', 'supermarket']) {
      const entry = catalogue.maps.find(map => map.id === id), base = new URL(entry.root, home); assert.equal(base.origin, home.origin);
      const [world, version, connection] = await Promise.all(['world.json', 'version.json', 'connection.json'].map(path => json(new URL(path, base))));
      const context = { id, base, world, version }; contexts.set(id, context);
      report.contexts[id] = { root: entry.root, build: version.build, width: world.world.width, depth: world.world.depth };
      check(`${id}: relative world/version identify own map`, world.mapId === id && version.mapId === id);
      check(`${id}: online protocol remains bounded`, connection.mode === 'online' && connection.protocol === 1 && connection.maxRooms === 5 && connection.maxPlayers === 20);
      const identity = await fetch(new URL('level-id.js', base)); assert.equal(identity.status, 200);
      check(`${id}: browser module selects own map`, (await identity.text()).includes(JSON.stringify(id)) && identity.headers.get('cache-control') === 'no-store');
    }
    const cabin = contexts.get('cabin'), market = contexts.get('supermarket');
    check('two maps retain distinct builds and dimensions', cabin.version.build !== market.version.build && cabin.world.world.width === 16 && cabin.world.world.depth === 12 && market.world.world.width === 28 && market.world.world.depth === 22);
    const asset = await fetch(new URL('levels/supermarket.glb', market.base), { signal: AbortSignal.timeout(15000) }); assert.equal(asset.status, 200);
    const served = Buffer.from(await asset.arrayBuffer()), local = readFileSync(resolve(workspace, 'public/levels/supermarket.glb'));
    report.glb = { servedSha256: sha256(served), localSha256: sha256(local), bytes: served.length, contentType: asset.headers.get('content-type') };
    check('prefixed GLB is exact local Blender export', report.glb.servedSha256 === report.glb.localSha256 && report.glb.contentType?.includes('model/gltf-binary'), report.glb);
    for (const [target, wrong] of [[cabin, market], [market, cabin]]) {
      const result = await open(target, { build: wrong.version.build });
      check(`${target.id}: reject other-map browser build before room creation`, result.welcome.type === 'outdated'); await result.peer.leaveAndClose();
    }
    const a = await join(cabin, { name: 'Optional-Cabin-A' }), b = await join(cabin, { name: 'Optional-Cabin-B', room: a.welcome.room });
    const c = await join(market, { name: 'Optional-Market-A' }), d = await join(market, { name: 'Optional-Market-B', room: c.welcome.room });
    check('map codes cannot collide', /^[0-9A-F]{6}$/.test(a.welcome.room) && /^S[0-9A-Z]{5}$/.test(c.welcome.room) && a.welcome.room !== c.welcome.room,
      { cabinRoom: a.welcome.room, supermarketRoom: c.welcome.room });
    for (const [context, wrongRoom] of [[cabin, c.welcome.room], [market, a.welcome.room]]) {
      const result = await open(context, { room: wrongRoom }); check(`${context.id}: refuse room code belonging to other map`, result.welcome.type === 'error'); await result.peer.leaveAndClose();
    }
    const lobbyCabin = await a.state(state => state.players.length === 2), lobbyMarket = await c.state(state => state.players.length === 2);
    check('two clients join their same-map room', b.welcome.room === a.welcome.room && d.welcome.room === c.welcome.room && lobbyCabin.players.length === 2 && lobbyMarket.players.length === 2);
    report.parallelHealth = await health(); check('two parallel rooms and four participants aggregate globally', report.parallelHealth.rooms === 2 && report.parallelHealth.players === 4);
    const cabinIds = new Set(lobbyCabin.players.map(player => player.id)), marketIds = new Set(lobbyMarket.players.map(player => player.id));
    check('room snapshots contain no other-map players', lobbyCabin.players.every(player => !marketIds.has(player.id)) && lobbyMarket.players.every(player => !cabinIds.has(player.id)));
    let markA = a.send({ type: 'start' }), markC = c.send({ type: 'start' });
    await Promise.all([a.state(state => state.phase === 'countdown', markA), c.state(state => state.phase === 'countdown', markC)]);
    const cabinPaused = await pause(a); report.partialPause = { cabinTime: cabinPaused.time };
    const path = [{ x: 3.7, y: 0, z: .3 }, { x: 3.7, y: -3.4, z: -8.7 }];
    let pose = c.latestState()?.players.find(player => player.id === c.welcome.id), next = 0, sequence = 0;
    c.subscribe(message => { if (message.type === 'state') { pose = message.players.find(player => player.id === c.welcome.id) ?? pose; if (pose) { report.cellarRoute.minimumY = Math.min(report.cellarRoute.minimumY, pose.y); report.cellarRoute.samples++; } } });
    const driving = setInterval(() => {
      const target = path[next];
      if (target && pose && Math.hypot(pose.x - target.x, pose.z - target.z) < .34 && Math.abs(pose.y - target.y) < .2) { report.cellarRoute.stages.push({ index: next++, x: pose.x, y: pose.y, z: pose.z }); }
      const goal = path[next], yaw = goal && pose ? Math.atan2(pose.x - goal.x, pose.z - goal.z) : 0;
      c.send({ type: 'input', seq: ++sequence, dt: 1 / 30, forward: goal ? 1 : 0, strafe: 0, yaw, pitch: 0, sprint: true, crouch: false, jump: false });
    }, 1000 / 30); timers.add(driving);
    const caveState = await c.state(state => state.players.some(player => player.id === c.welcome.id && player.y <= -3.35) && next === path.length, c.messages.length, 18000);
    clearInterval(driving); timers.delete(driving); c.send({ type: 'input', seq: ++sequence, dt: 1 / 30, forward: 0, strafe: 0, yaw: 0, pitch: 0, sprint: false, crouch: false, jump: false });
    check('online commands carry player down real cellar stairs', report.cellarRoute.minimumY <= -3.35 && report.cellarRoute.stages.length === path.length, report.cellarRoute);
    const wave = await c.state(state => state.phase === 'wave' && state.wave === 1, markC, 10000);
    await sleep(160); const stillCabin = a.latestState();
    check('pausing cabin does not pause optional level', stillCabin.paused && stillCabin.time === cabinPaused.time && wave.time > cabinPaused.time + 2 && !wave.paused,
      { cabinBefore: cabinPaused.time, cabinAfter: stillCabin.time, marketTime: wave.time });
    const marketPaused = await pause(c); await sleep(180);
    check('both own rooms can pause independently', c.latestState().time === marketPaused.time && a.latestState().time === cabinPaused.time);
    check('two maps remain isolated throughout command stream', !watcherError, { watcherError });
    const [cabinSave, marketSave] = await Promise.all([save(a), save(c)]);
    check('cellar save retains identity and negative position', marketSave.mapId === 'supermarket' && marketSave.spaceId === 'supermarket-depth' && marketSave.players.some(player => player.name === 'Optional-Market-A' && player.y <= -3.35));
    report.saved = { cabin: { mapId: cabinSave.mapId, wave: cabinSave.wave }, supermarket: { mapId: marketSave.mapId, spaceId: marketSave.spaceId, wave: marketSave.wave } };
    await Promise.all([a.leaveAndClose(), b.leaveAndClose(), c.leaveAndClose(), d.leaveAndClose()]);
    const restoreCabin = await join(cabin, { name: 'Optional-Cabin-A' }), restoreMarket = await join(market, { name: 'Optional-Market-A' });
    const wrongCabin = await upload(restoreCabin, marketSave), wrongMarket = await upload(restoreMarket, cabinSave);
    check('cross-map saved nights refused without transplant', wrongCabin.ok === false && wrongCabin.reason === 'map' && wrongMarket.ok === false && wrongMarket.reason === 'map');
    const legacy = { ...cabinSave }; delete legacy.mapId; delete legacy.spaceId;
    const wrongLegacy = await upload(restoreMarket, legacy), wrongSpace = await upload(restoreMarket, { ...marketSave, spaceId: 'supermarket-mezzanine' });
    check('legacy cabin and old supermarket geometry refused on depth map', wrongLegacy.ok === false && wrongLegacy.reason === 'map' && wrongSpace.ok === false && wrongSpace.reason === 'map');
    const restored = await upload(restoreMarket, marketSave); assert.equal(restored.ok, true, JSON.stringify(restored));
    const restoredState = await restoreMarket.state(state => state.paused && state.players.some(player => player.id === restoreMarket.welcome.id && player.y <= -3.35));
    check('same-map cellar saved night restores paused at negative height', restoredState.mapId === 'supermarket' && restoredState.paused && restoredState.players.some(player => player.id === restoreMarket.welcome.id && player.y <= -3.35));
    const oldRestored = await upload(restoreCabin, legacy); check('pre-map-id cabin saves still load on default cabin', oldRestored.ok === true);
    const oldState = await restoreCabin.state(state => state.paused); check('restored legacy cabin remains in its own context', (oldState.mapId ?? 'cabin') === 'cabin' && oldState.players.every(player => player.y >= 0));
    for (const [id, context] of contexts) { const version = await json(new URL('version.json', context.base)); check(`${id}: build stayed frozen`, version.build === context.version.build); }
    check('local GLB stayed frozen', sha256(readFileSync(resolve(workspace, 'public/levels/supermarket.glb'))) === report.glb.localSha256);
    report.passed = true;
  } catch (error) { report.passed = false; report.error = { name: error.name, message: error.message, stack: error.stack }; }
  finally {
    for (const timer of timers) clearInterval(timer);
    await leaveAll();
    try { for (let attempt = 0; attempt < 25; attempt++) { report.after = await health(); if (report.after.rooms === 0 && report.after.players === 0 && report.after.connections === 0) break; await sleep(100); }
      const cleaned = report.after.rooms === 0 && report.after.players === 0 && report.after.connections === 0;
      report.checks.push({ name: 'owned clients explicitly left; gateway stays alive and empty', passed: cleaned, health: report.after }); if (!cleaned) report.passed = false;
    } catch (error) { report.passed = false; report.cleanupError = error.message; }
    report.finishedAt = new Date().toISOString(); if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

class Peer {
  constructor(url) {
    this.socket = new WebSocket(url); this.messages = []; this.waiters = new Set(); this.listeners = new Set(); this.joined = false;
    this.socket.on('error', () => {});
    this.socket.on('message', raw => { const message = JSON.parse(raw.toString()); this.messages.push(message); if (message.type === 'welcome') this.joined = true; if (message.type === 'left') this.joined = false;
      if (message.type === 'net-ping') this.send({ type: 'net-pong', nonce: message.nonce });
      for (const listener of this.listeners) listener(message); for (const waiter of [...this.waiters]) if (this.messages.length - 1 >= waiter.mark && waiter.predicate(message)) waiter.finish(message);
    });
  }
  open() { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('WebSocket open timed out')), 8000); this.socket.once('open', () => { clearTimeout(timer); resolve(this); }); this.socket.once('error', error => { clearTimeout(timer); reject(error); }); }); }
  subscribe(listener) { this.listeners.add(listener); }
  send(message) { const mark = this.messages.length; if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); return mark; }
  wait(predicate, mark = 0, timeout = 8000) { const existing = this.messages.slice(mark).find(predicate); if (existing) return Promise.resolve(existing); return new Promise((resolve, reject) => {
    const waiter = { mark, predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } }; const timer = setTimeout(() => { this.waiters.delete(waiter); reject(Error('Network state timed out.')); }, timeout); this.waiters.add(waiter);
  }); }
  state(predicate, mark = 0, timeout = 8000) { return this.wait(message => message.type === 'state' && predicate(message), mark, timeout); }
  latestState() { return this.messages.findLast(message => message.type === 'state'); }
  async leaveAndClose() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    if (this.joined && this.socket.readyState === WebSocket.OPEN) { const mark = this.send({ type: 'leave' }); try { await this.wait(message => message.type === 'left', mark, 1800); } catch {} }
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise(resolve => { const timer = setTimeout(() => { this.socket.terminate(); resolve(); }, 1500); this.socket.once('close', () => { clearTimeout(timer); resolve(); }); this.socket.close(1000, 'Owned optional-levels smoke complete.'); });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--run')) console.log('Prepared only. node validation/optional-levels-smoke.mjs --run [--origin http://127.0.0.1:PORT]');
  else {
    const index = process.argv.indexOf('--origin'), origin = index >= 0 ? process.argv[index + 1] : 'http://127.0.0.1:3000';
    const output = resolve(workspace, 'validation/optional-levels-smoke-2026-10-19.json');
    const report = await runOptionalLevelsSmoke({ origin, output });
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(check => !check.passed).map(check => check.name), error: report.error?.message, contexts: report.contexts, glb: report.glb?.servedSha256, output }));
    if (!report.passed) process.exitCode = 1;
  }
}
