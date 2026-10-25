import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createOnlineServer } from '../online-server.mjs';

// Both servers pass the optional character sheet through, on real sockets
// and ephemeral ports: at join, with the `sheet` message, and with its locks.
const root = fileURLToPath(new URL('../', import.meta.url));
const lumberjack = { preset: 'lumberjack', name: '', stats: { strength: 2, agility: 0, ballistics: 0, tinkering: -1, chemistry: -1 } };
const custom = { preset: null, name: 'Robin', stats: { strength: 0, agility: 1, ballistics: 1, tinkering: 0, chemistry: -2 } };
const standard = { preset: 'standard', name: '', stats: { strength: 0, agility: 0, ballistics: 0, tinkering: 0, chemistry: 0 } };

class Peer {
  constructor(url) {
    this.socket = new WebSocket(url); this.messages = []; this.waiters = new Set();
    this.socket.on('error', () => {});
    this.socket.on('message', raw => {
      const message = JSON.parse(raw); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
  }
  async open() { await once(this.socket, 'open'); return this; }
  send(message) { const mark = this.messages.length; this.socket.send(JSON.stringify(message)); return mark; }
  wait(predicate, mark = 0, timeout = 5000) {
    const found = this.messages.slice(mark).find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(Error(`Sheet socket timeout; last ${JSON.stringify(this.messages.at(-1))?.slice(0, 300)}`)); }, timeout);
      const waiter = { predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      this.waiters.add(waiter);
    });
  }
  async close() { if (this.socket.readyState === WebSocket.CLOSED) return; const closed = once(this.socket, 'close'); this.socket.close(); await closed; }
}
const state = (peer, id, predicate, mark) => peer.wait(message => message.type === 'state' && predicate(message.players.find(player => player.id === id), message), mark);

test('the online server passes the sheet at join and on change, and locks it during a night', async t => {
  const app = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const address = await app.listen(), url = `ws://127.0.0.1:${address.port}/ws`;
  const host = await new Peer(url).open(), guest = await new Peer(url).open(), practice = await new Peer(url).open();
  t.after(() => Promise.all([host, guest, practice].map(peer => peer.close())));
  host.send({ type: 'join', protocol: 1, build: app.build, name: 'Host', sheet: { preset: 'lumberjack', stats: lumberjack.stats } });
  const first = await host.wait(message => message.type === 'welcome');
  guest.send({ type: 'join', protocol: 1, build: app.build, name: 'Guest', room: first.room, sheet: { stats: { strength: 2, agility: 2, chemistry: -4 } } });
  const second = await guest.wait(message => message.type === 'welcome');
  const sim = app.rooms.get(first.room).simulation;
  assert.deepEqual(sim.players.get(first.id).sheet, lumberjack);
  assert.deepEqual(sim.players.get(second.id).sheet, standard, 'a forged sheet is the standard one');
  let mark = host.messages.length; app.step(); app.step();
  const joined = await state(host, first.id, (self, message) => self?.character?.preset === 'lumberjack' && message.players.some(player => player.id === second.id), mark);
  assert.deepEqual(joined.players.find(player => player.id === first.id).sheetDebt, { extended: 1, radar: 1, grenadier: 1, frostaura: 1, medic: 1 });
  assert.equal(joined.players.find(player => player.id === first.id).maxHp, 100);
  assert.deepEqual(joined.players.find(player => player.id === second.id).character, standard);
  // A change in the lobby reaches every peer at once.
  mark = guest.messages.length;
  host.send({ type: 'sheet', sheet: { name: 'Robin', stats: custom.stats } });
  const changed = await state(guest, first.id, self => self?.character?.name === 'Robin', mark);
  assert.deepEqual(changed.players.find(player => player.id === first.id).character, custom);
  assert.deepEqual(changed.players.find(player => player.id === first.id).sheetDebt, { grenadier: 2, frostaura: 2, medic: 2 });
  // Once the night runs, a change is refused and nothing moves.
  host.send({ type: 'start' });
  await state(host, first.id, (self, message) => message.phase === 'countdown');
  host.send({ type: 'sheet', sheet: { preset: 'pyro' } });
  guest.send({ type: 'sheet', sheet: { preset: 'scout' } });
  host.send({ type: 'ping', nonce: 'after-sheet' }); await host.wait(message => message.type === 'pong' && message.nonce === 'after-sheet');
  guest.send({ type: 'ping', nonce: 'after-sheet' }); await guest.wait(message => message.type === 'pong' && message.nonce === 'after-sheet');
  assert.equal(sim.players.get(first.id).sheet.name, 'Robin');
  assert.equal(sim.players.get(second.id).sheet.preset, 'standard');
  mark = host.messages.length; app.step(); app.step();
  const locked = await state(host, first.id, self => Boolean(self), mark);
  assert.equal(locked.players.find(player => player.id === first.id).character.name, 'Robin');
  // The weapon stand ignores sheets.
  practice.send({ type: 'join', protocol: 1, build: app.build, name: 'Stand', practice: true, sheet: { preset: 'pyro' } });
  const stand = await practice.wait(message => message.type === 'welcome');
  assert.deepEqual(app.rooms.get(stand.room).simulation.players.get(stand.id).sheet, standard);
  practice.send({ type: 'sheet', sheet: { preset: 'pyro' } });
  practice.send({ type: 'ping', nonce: 'stand' }); await practice.wait(message => message.type === 'pong' && message.nonce === 'stand');
  assert.equal(app.rooms.get(stand.room).simulation.players.get(stand.id).sheet.preset, 'standard');
});

async function launchLanServer() {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited with ${code}: ${output}`)); });
    const collect = chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`127.0.0.1:${match[1]}`); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
  });
  return { address, async close() { if (child.exitCode !== null) return; const exited = once(child, 'exit'); child.kill(); await exited; } };
}

test('the Wi-Fi server passes the sheet at join and on change, serves the new modules, and locks it during a night', { timeout: 60000 }, async t => {
  const server = await launchLanServer();
  t.after(() => server.close());
  for (const file of ['character-sheet.js', 'character-sheet-ui.js']) {
    const response = await fetch(`http://${server.address}/${file}`);
    assert.equal(response.status, 200, file); assert.match(response.headers.get('content-type'), /javascript/);
  }
  const host = await new Peer(`ws://${server.address}/ws`).open(), guest = await new Peer(`ws://${server.address}/ws`).open();
  t.after(() => Promise.all([host.close(), guest.close()]));
  host.send({ type: 'join', name: 'Host', weapon: 'pistol', sheet: { preset: 'nurse' } });
  const first = await host.wait(message => message.type === 'welcome');
  guest.send({ type: 'join', name: 'Guest', weapon: 'pistol', room: first.room });
  const second = await guest.wait(message => message.type === 'welcome');
  const joined = await state(guest, first.id, self => self?.character?.preset === 'nurse');
  assert.deepEqual(joined.players.find(player => player.id === first.id).character.stats, { strength: -1, agility: 1, ballistics: -1, tinkering: 0, chemistry: 1 });
  assert.equal(joined.players.find(player => player.id === first.id).maxHp, 90);
  assert.deepEqual(joined.players.find(player => player.id === second.id).character, standard, 'no sheet field is the standard character');
  let mark = host.messages.length;
  guest.send({ type: 'sheet', sheet: { preset: 'mechanic' } });
  const changed = await state(host, second.id, self => self?.character?.preset === 'mechanic', mark);
  assert.equal(changed.players.find(player => player.id === second.id).maxHp, 90);
  host.send({ type: 'start' });
  await state(host, first.id, (self, message) => message.phase === 'countdown');
  mark = host.messages.length;
  guest.send({ type: 'sheet', sheet: { preset: 'pyro' } });
  // Several later snapshots still show the locked character.
  for (let count = 0; count < 3; count++) {
    const later = await state(host, second.id, self => Boolean(self), mark);
    assert.equal(later.players.find(player => player.id === second.id).character.preset, 'mechanic');
    mark = host.messages.indexOf(later) + 1;
  }
});
