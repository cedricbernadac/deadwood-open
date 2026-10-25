import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

// The LAN server with a fake companion brain on /companions (companions/DESIGN.md).
const root = fileURLToPath(new URL('../', import.meta.url));

async function launchServer() {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited with ${code}: ${output}`)); });
    const collect = chunk => { output += chunk.toString(); const match = output.match(/http:\/\/localhost:(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
  });
  return { port, output: () => output, async close() { if (child.exitCode !== null) return; const exited = once(child, 'exit'); child.kill(); await exited; } };
}

class Socket {
  constructor(url, options) {
    this.socket = new WebSocket(url, options);
    this.messages = []; this.waiters = new Set();
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
    this.socket.on('error', () => {});
  }
  open() { return new Promise((resolve, reject) => { this.socket.once('open', () => resolve(this)); this.socket.once('error', reject); this.socket.once('unexpected-response', () => reject(new Error('refused'))); }); }
  send(message) { this.socket.send(JSON.stringify(message)); }
  waitFor(predicate, timeout = 6000) {
    const existing = this.messages.findLast(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, finish: message => { clearTimeout(timer); this.waiters.delete(waiter); resolve(message); } };
      const timer = setTimeout(() => { this.waiters.delete(waiter); reject(new Error(`timed out; last ${JSON.stringify(this.messages.at(-1))?.slice(0, 300)}`)); }, timeout);
      this.waiters.add(waiter);
    });
  }
  state(predicate) { return this.waitFor(message => message.type === 'state' && predicate(message)); }
  close() { this.socket.close(); }
}
const companions = state => state.players.filter(player => player.companion === true);

test('a local brain makes companions available; the host picks them; they ask the brain and leave with it', async () => {
  const server = await launchServer();
  const host = await new Socket(`ws://127.0.0.1:${server.port}/ws`).open();
  try {
    host.send({ type: 'join', name: 'Papa' });
    const welcome = await host.waitFor(message => message.type === 'welcome');
    assert.equal((await host.state(() => true)).companionsAvailable, false);
    host.send({ type: 'companions', count: 2 });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(companions(host.messages.findLast(message => message.type === 'state')).length, 0, 'no brain, no companion');
    await assert.rejects(new Socket(`ws://127.0.0.1:${server.port}/companions`, { origin: 'http://evil.example' }).open(), 'a web page cannot be a brain');
    const brain = await new Socket(`ws://127.0.0.1:${server.port}/companions`).open();
    brain.send({ type: 'brain-hello', name: 'test-brain', version: 1 });
    await brain.waitFor(message => message.type === 'brain-welcome');
    await host.state(state => state.companionsAvailable === true);
    host.send({ type: 'companions', count: 2 });
    const withTwo = await host.state(state => companions(state).length === 2);
    assert.deepEqual(companions(withTwo).map(player => player.name), ['Max', 'Léa']);
    assert.equal(withTwo.hostId, welcome.id);
    host.send({ type: 'start' });
    const decide = await brain.waitFor(message => message.type === 'decide');
    assert.equal(decide.room, welcome.room);
    assert.ok(['Max', 'Léa'].includes(decide.companion.name));
    assert.ok(decide.situation.length > 50 && decide.actions.length > 0);
    assert.doesNotMatch(JSON.stringify(decide), /sk-[A-Za-z0-9]/, 'never a key');
    const defend = decide.actions.find(action => action.value.startsWith('defend:')) ?? decide.actions[0];
    brain.send({ type: 'decision', id: decide.id, action: defend.value, confidence: .9 });
    if (defend.value.startsWith('defend:')) {
      const callout = await host.waitFor(message => message.type === 'event' && message.event === 'companion-callout');
      assert.equal(callout.order, 'defend'); assert.equal(callout.id, decide.companion.id);
    }
    brain.close();
    await host.waitFor(message => message.type === 'event' && message.event === 'companions-offline');
    const after = await host.state(state => companions(state).length === 0 && state.companionsAvailable === false);
    assert.equal(after.players.length, 1);
  } finally { host.close(); await server.close(); }
});

test('a fourth human takes a companion seat', async () => {
  const server = await launchServer();
  const host = await new Socket(`ws://127.0.0.1:${server.port}/ws`).open();
  const brain = await new Socket(`ws://127.0.0.1:${server.port}/companions`).open();
  const guests = [];
  try {
    brain.send({ type: 'brain-hello', name: 'test-brain', version: 1 });
    await brain.waitFor(message => message.type === 'brain-welcome');
    host.send({ type: 'join', name: 'Papa' });
    const { room } = await host.waitFor(message => message.type === 'welcome');
    await host.state(state => state.companionsAvailable === true);
    host.send({ type: 'companions', count: 3 });
    await host.state(state => state.players.length === 4);
    const guest = await new Socket(`ws://127.0.0.1:${server.port}/ws`).open(); guests.push(guest);
    guest.send({ type: 'join', room, name: 'Jules' });
    await guest.waitFor(message => message.type === 'welcome');
    const full = await host.state(state => state.players.some(player => player.name === 'Jules'));
    assert.equal(full.players.length, 4); assert.equal(companions(full).length, 2);
  } finally { for (const guest of guests) guest.close(); brain.close(); host.close(); await server.close(); }
});

test('archetype selections cross the real LAN protocol; guests and malformed commands cannot change them', async () => {
  const server = await launchServer();
  const host = await new Socket(`ws://127.0.0.1:${server.port}/ws`).open();
  const brain = await new Socket(`ws://127.0.0.1:${server.port}/companions`).open();
  let guest;
  try {
    brain.send({ type: 'brain-hello', name: 'test-brain', version: 1 });
    await brain.waitFor(message => message.type === 'brain-welcome');
    host.send({ type: 'join', name: 'Papa' });
    const { room } = await host.waitFor(message => message.type === 'welcome');
    await host.state(state => state.companionsAvailable === true);
    const profiles = ['veteran', 'timid', 'veteran'];
    host.send({ type: 'companions', count: 2, profiles });
    const state = await host.state(state => companions(state).length === 2 && state.companionSelections?.[0] === 'veteran');
    assert.deepEqual(state.companionSelections, profiles);
    assert.deepEqual(companions(state).map(player => player.companionProfile.archetype), profiles.slice(0, 2));
    assert.deepEqual(companions(state).map(player => player.companionSlot), [0, 1]);
    assert.doesNotMatch(JSON.stringify(state.players), /tremor|variation|teamwork/);
    guest = await new Socket(`ws://127.0.0.1:${server.port}/ws`).open();
    guest.send({ type: 'join', room, name: 'Jules' });
    await guest.waitFor(message => message.type === 'welcome');
    await host.state(state => state.players.length === 4);
    guest.send({ type: 'companions', count: 0, profiles: ['timid', 'timid', 'timid'] });
    host.send({ type: 'companions', count: 0, profiles: ['veteran', { aim: 0 }, 'random'] });
    const marker = Date.now(); host.send({ type: 'ping', now: marker });
    await host.waitFor(message => message.type === 'pong' && message.time >= marker);
    await new Promise(resolve => setTimeout(resolve, 100));
    const latest = host.messages.findLast(message => message.type === 'state');
    assert.equal(companions(latest).length, 2);
    assert.deepEqual(latest.companionSelections, profiles);
    host.send({ type: 'start' });
    const decide = await brain.waitFor(message => message.type === 'decide');
    assert.match(decide.situation, /YOUR PROFILE/);
    assert.match(decide.situation, /Veteran|Timid/);
  } finally { guest?.close(); brain.close(); host.close(); await server.close(); }
});
