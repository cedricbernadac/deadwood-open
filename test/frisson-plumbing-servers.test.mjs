// Frisson plumbing on both servers: the join that creates a room sets its
// ambiance for good, a joiner's value is ignored, the welcome and every
// snapshot carry it, and the pack's folder is served (LAN and online).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import WebSocket from 'ws';
import { createOnlineServer } from '../online-server.mjs';
import { onlineConfig } from '../online-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

class Peer {
  constructor(url) {
    this.socket = new WebSocket(url.replace(/^http/, 'ws') + '/ws');
    this.messages = []; this.waiters = new Set();
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
    this.socket.on('error', () => {});
  }
  async open() { await once(this.socket, 'open'); return this; }
  wait(predicate, since = 0) {
    const existing = this.messages.slice(since).find(predicate); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.waiters.delete(waiter); reject(new Error(`Timed out; last ${JSON.stringify(this.messages.at(-1))}`)); }, 5000);
      const waiter = { predicate, finish: message => { clearTimeout(timeout); this.waiters.delete(waiter); resolve(message); } };
      this.waiters.add(waiter);
    });
  }
  // The welcome, then the first snapshot after it.
  async join(fields) {
    const since = this.messages.length;
    this.socket.send(JSON.stringify({ type: 'join', name: 'Test', ...fields }));
    const welcome = await this.wait(message => ['welcome', 'error', 'outdated'].includes(message.type), since);
    assert.equal(welcome.type, 'welcome', JSON.stringify(welcome));
    const state = await this.wait(message => message.type === 'state' && message.room === welcome.room, since);
    return { welcome, state };
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close'); this.socket.close(); await closed;
  }
}

// The same story on each server: create in Frisson, join with another value,
// create without one, with a bad one, the stand in Frisson, join Famille asking Frisson.
async function createVersusJoin(t, url, extra = {}) {
  const peers = [];
  t.after(() => Promise.all(peers.map(peer => peer.close())));
  const peer = async () => { const created = await new Peer(url).open(); peers.push(created); return created; };
  const host = await peer(), frisson = await host.join({ ...extra, ambiance: 'frisson' });
  assert.equal(frisson.welcome.ambiance, 'frisson'); assert.equal(frisson.state.ambiance, 'frisson');
  const guest = await peer(), joined = await guest.join({ ...extra, room: frisson.welcome.room, ambiance: 'family' });
  assert.equal(joined.welcome.room, frisson.welcome.room);
  assert.equal(joined.welcome.ambiance, 'frisson'); assert.equal(joined.state.ambiance, 'frisson');
  const plain = await (await peer()).join(extra);
  assert.equal(plain.welcome.ambiance, 'family'); assert.equal(plain.state.ambiance, 'family');
  const odd = await (await peer()).join({ ...extra, ambiance: 'gore' });
  assert.equal(odd.welcome.ambiance, 'family'); assert.equal(odd.state.ambiance, 'family');
  const stand = await (await peer()).join({ ...extra, practice: true, ambiance: 'frisson' });
  assert.equal(stand.welcome.practice, true); assert.equal(stand.welcome.ambiance, 'frisson'); assert.equal(stand.state.ambiance, 'frisson');
  const asked = await (await peer()).join({ ...extra, room: plain.welcome.room, ambiance: 'frisson' });
  assert.equal(asked.welcome.ambiance, 'family'); assert.equal(asked.state.ambiance, 'family');
  // Frisson léger the same way: set by its creator, kept against a joiner's Frisson, the stand too.
  const light = await (await peer()).join({ ...extra, ambiance: 'frisson-leger' });
  assert.equal(light.welcome.ambiance, 'frisson-leger'); assert.equal(light.state.ambiance, 'frisson-leger');
  const lightGuest = await (await peer()).join({ ...extra, room: light.welcome.room, ambiance: 'frisson' });
  assert.equal(lightGuest.welcome.ambiance, 'frisson-leger'); assert.equal(lightGuest.state.ambiance, 'frisson-leger');
  const lightStand = await (await peer()).join({ ...extra, practice: true, ambiance: 'frisson-leger' });
  assert.equal(lightStand.welcome.ambiance, 'frisson-leger'); assert.equal(lightStand.state.ambiance, 'frisson-leger');
  const near = await (await peer()).join({ ...extra, ambiance: 'frisson-léger' });
  assert.equal(near.welcome.ambiance, 'family');
}

async function launchLan() {
  // Port 0: the system picks a free port; 3000 and 3002 are never touched.
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited with ${code}: ${output}`)); });
    const collect = chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
  });
  return { address, async close() { if (child.exitCode !== null) return; const exited = once(child, 'exit'); child.kill(); await exited; } };
}

test('LAN server: the creator sets the ambiance, joiners keep it, the pack is served', { timeout: 60000 }, async t => {
  const server = await launchLan();
  t.after(() => server.close());
  await createVersusJoin(t, server.address);
  const pack = await fetch(server.address + '/frisson/index.js'), loader = await fetch(server.address + '/ambiance.js');
  assert.equal(pack.status, 200); assert.match(pack.headers.get('content-type'), /javascript/);
  assert.equal(loader.status, 200); assert.match(await loader.text(), /export function applyAmbiance/);
  const weapons = await fetch(server.address + '/frisson/weapons.glb');
  assert.equal(weapons.status, 200); assert.match(weapons.headers.get('content-type'), /model\/gltf-binary/);
  const lightHeads = await fetch(server.address + '/frisson/heads-b.glb');
  assert.equal(lightHeads.status, 200); assert.match(lightHeads.headers.get('content-type'), /model\/gltf-binary/);
});

test('online server: the creator sets the ambiance, joiners keep it, resume and the pack too', async t => {
  const server = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false, config: { ...onlineConfig({}), maxRooms: 20, createsPerMinute: 20 } });
  const address = await server.listen(), url = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());
  await createVersusJoin(t, url, { protocol: 1, build: server.build });
  const pack = await fetch(url + '/frisson/index.js');
  assert.equal(pack.status, 200); assert.match(pack.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(url + '/ambiance.js')).status, 200);
  const weapons = await fetch(url + '/frisson/weapons.glb');
  assert.equal(weapons.status, 200); assert.match(weapons.headers.get('content-type'), /model\/gltf-binary/);
  const lightHeads = await fetch(url + '/frisson/heads-b.glb');
  assert.equal(lightHeads.status, 200); assert.match(lightHeads.headers.get('content-type'), /model\/gltf-binary/);
  // A resumed survivor is welcomed with the room's ambiance again.
  const first = await new Peer(url).open(), created = await first.join({ protocol: 1, build: server.build, ambiance: 'frisson' });
  await first.close();
  const again = await new Peer(url).open();
  t.after(() => again.close());
  const since = again.messages.length;
  again.socket.send(JSON.stringify({ type: 'resume', protocol: 1, build: server.build, token: created.welcome.resumeToken }));
  const resumed = await again.wait(message => message.type === 'welcome', since);
  assert.equal(resumed.resumed, true); assert.equal(resumed.ambiance, 'frisson');
});

// The pickups part's GLB (art/frisson/PICKUPS.md), served as every other GLB.
test('LAN server: the pickups GLB is served as a binary glTF', { timeout: 60000 }, async t => {
  const server = await launchLan();
  t.after(() => server.close());
  const pickups = await fetch(server.address + '/frisson/pickups.glb');
  assert.equal(pickups.status, 200); assert.match(pickups.headers.get('content-type'), /model\/gltf-binary/);
});

test('online server: the pickups GLB is served as a binary glTF', async t => {
  const server = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false, config: { ...onlineConfig({}), maxRooms: 20, createsPerMinute: 20 } });
  const address = await server.listen();
  t.after(() => server.close());
  const pickups = await fetch(`http://127.0.0.1:${address.port}/frisson/pickups.glb`);
  assert.equal(pickups.status, 200); assert.match(pickups.headers.get('content-type'), /model\/gltf-binary/);
});
