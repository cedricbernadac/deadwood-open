import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createOnlineServer } from '../online-server.mjs';
import { onlineConfig } from '../online-config.mjs';
import { splitSaveText } from '../public/save-game.js';
import { receiveSaveUpload, SAVE_TRANSFER } from '../save-transfer.mjs';

// Real sockets on both servers (ephemeral ports): save while paused, refuse
// otherwise, and load a night back in chunks into a new room's lobby.
class Peer {
  constructor(url) {
    this.socket = new WebSocket(url.replace(/^http/, 'ws') + '/ws'); this.messages = []; this.waiters = new Set();
    this.socket.on('error', () => {});
    this.socket.on('message', raw => {
      const value = JSON.parse(raw.toString()); this.messages.push(value);
      for (const waiter of [...this.waiters]) if (waiter.predicate(value)) waiter.resolve(value);
    });
  }
  async open() { await once(this.socket, 'open'); return this; }
  mark() { return this.messages.length; }
  send(value) { const mark = this.mark(); this.socket.send(JSON.stringify(value)); return mark; }
  wait(predicate, mark = 0, label = 'message') {
    const found = this.messages.slice(mark).find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(Error(`Timed out waiting for ${label}: ${JSON.stringify(this.messages.at(-1))?.slice(0, 300)}`)); }, 6000);
      const waiter = { predicate, resolve: value => { clearTimeout(timer); this.waiters.delete(waiter); resolve(value); } };
      this.waiters.add(waiter);
    });
  }
  state(predicate, mark = 0) { return this.wait(value => value.type === 'state' && predicate(value), mark, 'state'); }
  async upload(save) {
    const chunks = splitSaveText(JSON.stringify(save)), mark = this.mark();
    this.socket.send(JSON.stringify({ type: 'load-begin', chunks: chunks.length, size: JSON.stringify(save).length }));
    chunks.forEach((data, index) => this.socket.send(JSON.stringify({ type: 'load-chunk', index, data })));
    return this.wait(value => value.type === 'load-result', mark, 'load-result');
  }
  async close() { if (this.socket.readyState === WebSocket.CLOSED) return; const ended = once(this.socket, 'close'); this.socket.close(); await ended; }
}

async function lanServer(t) {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; } });
  let output = '';
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(output || 'Save test server did not start')), 10000);
    const collect = chunk => { output += chunk; const match = output.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Save test server exited ${code}: ${output}`)); });
  });
  const { build } = await (await fetch(origin + '/version.json')).json();
  const peers = [];
  t.after(async () => { await Promise.all(peers.map(peer => peer.close())); });
  const connect = async (name, room, sheet = null) => {
    const peer = await new Peer(origin).open(); peers.push(peer);
    const mark = peer.send({ type: 'join', build, name, ...(room ? { room } : {}), ...(sheet ? { sheet } : {}) });
    return { peer, ...await peer.wait(value => value.type === 'welcome', mark, 'welcome') };
  };
  connect.origin = origin;
  return connect;
}

test('LAN: a paused night saves for any survivor, a running one refuses, and the file loads back into a new paused room', { timeout: 40000 }, async t => {
  const connect = await lanServer(t);
  const host = await connect('Jules'), guest = await connect('Léa', host.room);
  let mark = host.peer.send({ type: 'start' });
  await host.peer.state(state => state.phase === 'countdown', mark);
  mark = guest.peer.send({ type: 'save-game' });
  assert.equal((await guest.peer.wait(value => value.type === 'save-denied', mark)).reason, 'not-paused');
  mark = host.peer.send({ type: 'pause', paused: true });
  await host.peer.state(state => state.paused === true, mark);
  mark = guest.peer.send({ type: 'save-game' });
  const { save } = await guest.peer.wait(value => value.type === 'save-game', mark, 'save');
  assert.equal(save.format, 'deadwood-save'); assert.equal(save.phase, 'countdown');
  assert.deepEqual(save.players.map(player => player.name), ['Jules', 'Léa']);
  assert.equal(typeof save.build, 'string');
  // The loader opens a new room; a guest waiting in its lobby cannot load.
  const loader = await connect('Jules'), early = await connect('Inconnu', loader.room);
  assert.equal((await early.peer.upload(save)).reason, 'host');
  const result = await loader.peer.upload(save);
  assert.deepEqual(result, { type: 'load-result', ok: true, wave: 0, phase: 'countdown' });
  const restoredState = loader.peer.messages.findLast(value => value.type === 'state');
  assert.equal(restoredState.paused, true); assert.equal(restoredState.phase, 'countdown'); assert.equal(restoredState.pauseById, loader.id);
  assert.deepEqual(restoredState.freeSeats.map(seat => seat.name), ['Léa']);
  assert.equal(restoredState.players.find(player => player.id === early.id).waiting, true, 'the lobby guest waits for admission');
  assert.ok(loader.peer.messages.some(value => value.type === 'event' && value.event === 'game-restored' && value.wave === 0));
  assert.equal((await loader.peer.upload(save)).reason, 'phase', 'no second load into a running night');
  // Léa comes back under any case and is in place at once; time stays frozen.
  const lea = await connect('LÉA', loader.room);
  const back = await lea.peer.state(state => state.players.some(player => player.id === lea.id && !player.waiting));
  assert.equal(back.paused, true); assert.equal(back.freeSeats, undefined);
  // The early guest asks for a seat that is no longer free: nothing changes.
  mark = early.peer.send({ type: 'claim-seat', seat: restoredState.freeSeats[0].seat });
  const ping = early.peer.send({ type: 'ping' }); await early.peer.wait(value => value.type === 'pong', ping);
  assert.equal(early.peer.messages.slice(mark).findLast(value => value.type === 'state')?.players.find(player => player.id === early.id).waiting ?? true, true);
  mark = loader.peer.send({ type: 'pause', paused: false });
  await loader.peer.state(state => state.paused === false && state.time > restoredState.time, mark);
});

test('LAN: an unmatched joiner claims a free seat while paused; malformed uploads are refused', { timeout: 30000 }, async t => {
  const connect = await lanServer(t);
  const host = await connect('Jules'), guest = await connect('Léa', host.room);
  let mark = host.peer.send({ type: 'start' });
  await host.peer.state(state => state.phase === 'countdown', mark);
  mark = host.peer.send({ type: 'pause', paused: true });
  await host.peer.state(state => state.paused, mark);
  mark = host.peer.send({ type: 'save-game' });
  const { save } = await host.peer.wait(value => value.type === 'save-game', mark);
  const loader = await connect('Jules');
  // Broken transfers: a bad begin, a chunk out of range, a file that is not JSON.
  mark = loader.peer.send({ type: 'load-begin', chunks: SAVE_TRANSFER.maxChunks + 1, size: 10 });
  assert.equal((await loader.peer.wait(value => value.type === 'load-result', mark)).reason, 'too-large');
  mark = loader.peer.send({ type: 'load-chunk', index: 0, data: '{}' });
  assert.equal((await loader.peer.wait(value => value.type === 'load-result', mark)).reason, 'expired');
  mark = loader.peer.send({ type: 'load-begin', chunks: 1, size: 5 });
  loader.peer.send({ type: 'load-chunk', index: 0, data: '{oops' });
  assert.equal((await loader.peer.wait(value => value.type === 'load-result', mark)).reason, 'format');
  assert.equal((await loader.peer.upload({ ...save, version: 9 })).reason, 'version');
  assert.equal((await loader.peer.upload(save)).ok, true);
  const stranger = await connect('Quelqu’un', loader.room);
  const waiting = await stranger.peer.state(state => state.players.some(player => player.id === stranger.id && player.waiting) && state.freeSeats?.length === 1);
  mark = stranger.peer.send({ type: 'claim-seat', seat: waiting.freeSeats[0].seat });
  const claimed = await stranger.peer.state(state => state.players.some(player => player.id === stranger.id && !player.waiting), mark);
  assert.equal(claimed.players.find(player => player.id === stranger.id).name, 'Quelqu’un');
  assert.equal(claimed.paused, true);
});

async function onlineFixture(t) {
  let now = 1000;
  const server = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false, clock: () => now, config: { ...onlineConfig({}) } });
  const address = await server.listen(), url = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());
  const peers = [];
  t.after(async () => { await Promise.all(peers.map(peer => peer.close())); });
  const connect = async (name, room, sheet = null) => {
    const peer = await new Peer(url).open(); peers.push(peer);
    const mark = peer.send({ type: 'join', protocol: 1, build: server.build, name, ...(room ? { room } : {}), ...(sheet ? { sheet } : {}) });
    return { peer, ...await peer.wait(value => value.type === 'welcome', mark, 'welcome') };
  };
  return { server, connect, advance: ms => { now += ms; } };
}

test('online: the same save and chunked load, a new epoch, and companions left behind with a note', { timeout: 30000 }, async t => {
  const { server, connect } = await onlineFixture(t);
  const host = await connect('Jules'), guest = await connect('Léa', host.room);
  let mark = host.peer.send({ type: 'start' });
  await host.peer.state(state => state.phase === 'countdown', mark);
  for (let tick = 0; tick < 5; tick++) server.step();
  mark = host.peer.send({ type: 'save-game' });
  assert.equal((await host.peer.wait(value => value.type === 'save-denied', mark)).reason, 'not-paused');
  mark = host.peer.send({ type: 'pause', paused: true });
  await host.peer.state(state => state.paused, mark);
  mark = guest.peer.send({ type: 'save-game' });
  const { save } = await guest.peer.wait(value => value.type === 'save-game', mark);
  assert.equal(save.phase, 'countdown'); assert.equal(Object.hasOwn(save, 'epoch'), false);
  // A LAN save with a companion: online has none, so it stays behind.
  const withBot = JSON.parse(JSON.stringify(save));
  withBot.players.push({ ...save.players[1], id: 'ia-ABC123-1', name: 'Max', companion: true, companionSlot: 0,
    companionProfile: { selection: 'random', archetype: 'veteran', variation: { accuracy: 1, reaction: 1, pause: 1 } } });
  const loader = await connect('Jules'), early = await connect('Sam', loader.room);
  assert.equal((await early.peer.upload(save)).reason, 'host');
  const result = await loader.peer.upload(withBot);
  assert.deepEqual(result, { type: 'load-result', ok: true, wave: 0, phase: 'countdown', companions: 'unsupported' });
  const state = loader.peer.messages.findLast(value => value.type === 'state');
  assert.equal(state.paused, true); assert.notEqual(state.net.epoch, loader.network.epoch, 'a new input/rewind epoch');
  assert.equal(state.players.some(player => player.companion), false);
  assert.ok(loader.peer.messages.some(value => value.type === 'event' && value.event === 'game-restored' && value.companions === 'unsupported'));
  assert.equal((await loader.peer.upload(save)).reason, 'phase');
  const lea = await connect('léa', loader.room);
  await lea.peer.state(state => state.players.some(player => player.id === lea.id && !player.waiting && player.name === 'Léa'));
  mark = loader.peer.send({ type: 'pause', paused: false });
  await loader.peer.state(state => state.paused === false, mark);
  server.step();
});

test('the transfer helper caps chunks, sizes and silence, one transfer per peer', () => {
  const peer = {};
  assert.equal(receiveSaveUpload(peer, { type: 'load-begin', chunks: 2, size: 7000 }).reply.reason, 'too-large', 'more than 3000 characters a chunk');
  assert.equal(receiveSaveUpload(peer, { type: 'load-begin', chunks: 1, size: SAVE_TRANSFER.maxSize + 1 }).reply.reason, 'too-large');
  assert.deepEqual(receiveSaveUpload(peer, { type: 'load-begin', chunks: 2, size: 4 }, { now: 0 }), {});
  assert.equal(receiveSaveUpload(peer, { type: 'load-begin', chunks: 2, size: 4 }, { now: 1 }).reply.reason, 'busy');
  assert.deepEqual(receiveSaveUpload(peer, { type: 'load-chunk', index: 1, data: 'cd' }, { now: 2 }), {});
  assert.deepEqual(receiveSaveUpload(peer, { type: 'load-chunk', index: 0, data: 'ab' }, { now: 3 }), { text: 'abcd' }, 'assembled in index order');
  receiveSaveUpload(peer, { type: 'load-begin', chunks: 2, size: 4 }, { now: 10 });
  assert.equal(receiveSaveUpload(peer, { type: 'load-chunk', index: 0, data: 'x'.repeat(SAVE_TRANSFER.chunkChars + 1) }, { now: 11 }).reply.reason, 'invalid');
  receiveSaveUpload(peer, { type: 'load-begin', chunks: 2, size: 4 }, { now: 20 });
  assert.equal(receiveSaveUpload(peer, { type: 'load-chunk', index: 0, data: 'ab' }, { now: 20 + SAVE_TRANSFER.idleMs + 1 }).reply.reason, 'expired');
  receiveSaveUpload(peer, { type: 'load-begin', chunks: 1, size: 2 }, { now: 100 });
  assert.equal(receiveSaveUpload(peer, { type: 'load-chunk', index: 0, data: 'ab' }, { now: 101, refusal: 'host' }).reply.reason, 'host');
  assert.equal(peer.saveUpload, null);
  // Chunks stay under the 4096-byte message limit, even full of quotes and accents.
  const heavy = JSON.stringify({ names: Array.from({ length: 900 }, () => '"Léa" \\ Éloïse 🌲') });
  const chunks = splitSaveText(heavy);
  assert.equal(chunks.join(''), heavy);
  assert.ok(chunks.every(chunk => chunk.length <= 3000 && Buffer.byteLength(JSON.stringify({ type: 'load-chunk', index: 199, data: chunk })) < 4096));
});

test('LAN: with the brain connected, saved companions come back in their slots; without it the room says so', { timeout: 40000 }, async t => {
  const connect = await lanServer(t);
  const brain = new WebSocket(connect.origin.replace(/^http/, 'ws') + '/companions');
  brain.on('error', () => {});
  const brainMessages = [];
  brain.on('message', raw => brainMessages.push(JSON.parse(raw.toString())));
  await once(brain, 'open');
  brain.send(JSON.stringify({ type: 'brain-hello', name: 'test-brain', version: 1 }));
  t.after(() => brain.close());
  const host = await connect('Jules');
  await host.peer.state(state => state.companionsAvailable === true);
  let mark = host.peer.send({ type: 'companions', count: 2, profiles: ['veteran', 'timid', 'random'] });
  const lobbyState = await host.peer.state(state => state.players.filter(player => player.companion).length === 2, mark);
  mark = host.peer.send({ type: 'start' });
  await host.peer.state(state => state.phase === 'countdown', mark);
  mark = host.peer.send({ type: 'pause', paused: true });
  await host.peer.state(state => state.paused, mark);
  mark = host.peer.send({ type: 'save-game' });
  const { save } = await host.peer.wait(value => value.type === 'save-game', mark);
  assert.equal(save.players.filter(player => player.companion).length, 2);
  const loader = await connect('Jules');
  const result = await loader.peer.upload(save);
  assert.deepEqual(result, { type: 'load-result', ok: true, wave: 0, phase: 'countdown' });
  const state = await loader.peer.state(state => state.players.filter(player => player.companion).length === 2);
  const before = lobbyState.players.filter(player => player.companion), after = state.players.filter(player => player.companion);
  assert.deepEqual(after.map(player => [player.name, player.companionSlot, player.companionProfile.archetype]),
    before.map(player => [player.name, player.companionSlot, player.companionProfile.archetype]));
  assert.deepEqual(state.companionSelections, ['veteran', 'timid', 'random']);
  assert.ok(after.every(player => player.id.startsWith(`ia-${loader.room}-`)));
  // The brain leaves: a new load keeps the humans only, with a note for everyone.
  brain.close();
  await loader.peer.state(state => state.companionsAvailable === false);
  const second = await connect('Jules');
  const offline = await second.peer.upload(save);
  assert.equal(offline.ok, true); assert.equal(offline.companions, 'offline');
  assert.ok(second.peer.messages.some(value => value.type === 'event' && value.event === 'game-restored' && value.companions === 'offline'));
  assert.equal(second.peer.messages.findLast(value => value.type === 'state').players.some(player => player.companion), false);
});

// The character sheet travels with the save on both servers: each seat comes
// back with its saved character and debt, whatever its player picked to join.
test('LAN and online: a saved character comes back with its seat, whatever the joiner picked; the free seat names it', { timeout: 40000 }, async t => {
  const online = await onlineFixture(t);
  const chemist = { name: 'Chimiste', stats: { ballistics: 2, chemistry: -2 } };
  for (const [label, connect] of [['LAN', await lanServer(t)], ['online', online.connect]]) {
    const host = await connect('Jules', undefined, { preset: 'lumberjack' }), guest = await connect('Léa', host.room, chemist);
    let mark = host.peer.send({ type: 'start' });
    await host.peer.state(state => state.phase === 'countdown', mark);
    mark = host.peer.send({ type: 'pause', paused: true });
    await host.peer.state(state => state.paused, mark);
    mark = guest.peer.send({ type: 'save-game' });
    const { save } = await guest.peer.wait(value => value.type === 'save-game', mark, `${label} save`);
    assert.deepEqual(save.players.map(player => [player.name, player.sheet.preset, player.sheetDebt]),
      [['Jules', 'lumberjack', { extended: 1, radar: 1, grenadier: 1, frostaura: 1, medic: 1 }], ['Léa', null, { grenadier: 2, frostaura: 2, medic: 2 }]], label);
    const loader = await connect('Jules', undefined, { preset: 'scout' });
    assert.equal((await loader.peer.upload(save)).ok, true, label);
    const restored = loader.peer.messages.findLast(value => value.type === 'state');
    assert.equal(restored.players.find(player => player.id === loader.id).character.preset, 'lumberjack', `${label}: the seat's character, not the Scout`);
    assert.deepEqual(restored.freeSeats.map(seat => [seat.name, seat.character.name, seat.character.stats.chemistry]), [['Léa', 'Chimiste', -2]], label);
    assert.deepEqual(restored.seatHolders, [loader.id], label);
    const lea = await connect('léa', loader.room, { preset: 'scout' });
    const back = await lea.peer.state(state => state.players.some(player => player.id === lea.id && !player.waiting), 0);
    const self = back.players.find(player => player.id === lea.id);
    assert.deepEqual([self.character.name, self.character.stats.chemistry, self.sheetDebt, self.maxGrenades], ['Chimiste', -2, { grenadier: 2, frostaura: 2, medic: 2 }, 1], label);
    assert.deepEqual(back.seatHolders, [loader.id, lea.id], label);
  }
});
