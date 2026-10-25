import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../', import.meta.url));

// A disposable child on an OS-assigned port; never restart the owner's server.
async function launchServer() {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root, env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Isolated expedition server did not start: ${output}`));
    }, 10000);
    const fail = error => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.once('exit', code => fail(new Error(`Isolated server exited ${code}: ${output}`)));
    const collect = chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
  });
  return { address, async close() {
    if (child.exitCode !== null) return;
    const closed = once(child, 'exit'); child.kill(); await closed;
  } };
}

class Peer {
  constructor(address) {
    this.socket = new WebSocket(address.replace(/^http/, 'ws') + '/ws');
    this.messages = []; this.waiters = new Set();
    this.socket.on('message', raw => {
      const message = JSON.parse(raw.toString()); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
    this.socket.on('error', () => {});
  }
  async open() { await once(this.socket, 'open'); return this; }
  mark() { return this.messages.length; }
  send(message) { const since = this.mark(); this.socket.send(JSON.stringify(message)); return since; }
  waitFor(predicate, { since = 0, timeout = 5000 } = {}) {
    const existing = this.messages.slice(since).findLast(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, finish: message => {
        clearTimeout(timer); this.waiters.delete(waiter); resolve(message);
      } };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Expedition message timed out. Last: ${JSON.stringify(this.messages.at(-1))}`));
      }, timeout);
      this.waiters.add(waiter);
    });
  }
  state(predicate, options) { return this.waitFor(message => message.type === 'state' && predicate(message), options); }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close'); this.socket.close(); await closed;
  }
}

const player = (state, id) => state.players.find(item => item.id === id);

test('two real WebSocket survivors share authoritative expedition state and umbrella attack exclusion', { timeout: 25000 }, async t => {
  const server = await launchServer();
  const peers = [];
  t.after(async () => { await Promise.all(peers.map(peer => peer.close())); await server.close(); });
  const connect = async () => { const peer = new Peer(server.address); peers.push(peer); return peer.open(); };
  const [versionResponse, expeditionModule, worldResponse] = await Promise.all([
    fetch(server.address + '/version.json'), fetch(server.address + '/expedition.js'), fetch(server.address + '/world.json'),
  ]);
  assert.equal(versionResponse.status, 200); assert.equal(expeditionModule.status, 200); assert.equal(worldResponse.status, 200);
  assert.match(expeditionModule.headers.get('content-type'), /javascript/);
  assert.ok((await expeditionModule.text()).length > 100);
  const { build } = await versionResponse.json(), config = await worldResponse.json();
  assert.match(build, /^[0-9a-f]{12}$/);
  const owner = await connect(), guest = await connect();
  let since = owner.send({ type:'join', name:'Umbrella owner', build });
  const host = await owner.waitFor(message => message.type === 'welcome', { since });
  since = guest.send({ type:'join', room:host.room, name:'Umbrella guest', build });
  const visitor = await guest.waitFor(message => message.type === 'welcome', { since });
  assert.equal(host.build, build); assert.equal(visitor.build, build);

  const lobby = await owner.state(state => state.phase === 'lobby' && state.players.length === 2);
  assert.ok(lobby.expedition && Object.hasOwn(lobby.expedition, 'generator') && Object.hasOwn(lobby.expedition, 'fuel'));
  for (const survivor of lobby.players) {
    assert.deepEqual(survivor.umbrella, { open:false, remaining:100, max:100 });
    assert.equal(survivor.carryingFuel, false); assert.equal(survivor.rainExposed, false);
    assert.ok(Object.hasOwn(survivor, 'expeditionAction'));
  }
  since = owner.send({ type:'start' });
  await owner.state(state => state.phase === 'countdown', { since });
  const firstWave = await owner.state(state => state.phase === 'wave' && state.wave === 1, { since, timeout:8000 });
  const startingExpedition = structuredClone(firstWave.expedition);
  assert.equal(player(firstWave, host.id).ammo, config.weapons.pistol.magazine);
  assert.equal(player(firstWave, visitor.id).ammo, config.weapons.pistol.magazine);

  // Only the socket's actor and the strict boolean are accepted. Client health,
  // supplies, exposure and generator state cannot replace server state.
  const guestMark = guest.mark();
  since = owner.send({ type:'umbrella', open:true, id:visitor.id,
    remaining:99999, max:99999, durability:99999, hp:99999, damage:99999,
    carryingFuel:true, rainExposed:true, expeditionAction:'deliver',
    generator:{ power:99999 }, fuel:{ carrierId:host.id } });
  let state = await owner.state(state => player(state, host.id)?.umbrella?.open === true, { since });
  const mirrored = await guest.state(state => player(state, host.id)?.umbrella?.open === true, { since:guestMark });
  for (const snapshot of [state, mirrored]) {
    assert.deepEqual(player(snapshot, host.id).umbrella, { open:true, remaining:100, max:100 });
    assert.equal(player(snapshot, visitor.id).umbrella.open, false, 'Forged id cannot open a teammate umbrella');
    assert.equal(player(snapshot, host.id).hp, 100); assert.equal(player(snapshot, host.id).carryingFuel, false);
    assert.equal(player(snapshot, host.id).rainExposed, false, 'Client exposure cannot override the real roof');
    assert.deepEqual(snapshot.expedition, startingExpedition, 'Forged generator and fuel fields have no effect');
  }

  const blockedSince = owner.mark(), blockedAt = state.time;
  for (const open of ['false', 0, null, {}, []]) owner.send({ type:'umbrella', open });
  for (const open of ['true', 1, {}]) guest.send({ type:'umbrella', open, id:host.id });
  owner.send({ type:'input', forward:0, strafe:0, yaw:0, pitch:1.2,
    hp:99999, ammo:99999, umbrella:{ open:false, remaining:99999 }, carryingFuel:true,
    x:99999, y:99999, z:99999 });
  owner.send({ type:'shoot', id:visitor.id, damage:99999, ammo:99999 });
  state = await owner.state(state => state.time >= blockedAt + .25, { since:blockedSince });
  assert.deepEqual(player(state, host.id).umbrella, { open:true, remaining:100, max:100 });
  assert.equal(player(state, visitor.id).umbrella.open, false, 'Truthy non-booleans are not accepted as open commands');
  assert.equal(player(state, host.id).ammo, config.weapons.pistol.magazine, 'Open umbrella consumes no bullet');
  assert.equal(player(state, host.id).hp, 100); assert.equal(player(state, host.id).carryingFuel, false);
  assert.equal(player(state, host.id).x, player(firstWave, host.id).x);
  assert.equal(player(state, host.id).y, player(firstWave, host.id).y);
  assert.equal(player(state, host.id).z, player(firstWave, host.id).z);
  assert.ok(!owner.messages.slice(blockedSince).some(message => message.type === 'event' && message.event === 'shot' && message.id === host.id));
  assert.deepEqual(state.expedition, startingExpedition);

  // The second survivor may operate its own umbrella, including when a
  // forged target id names the host; it cannot mutate the host's equipment.
  since = guest.send({ type:'umbrella', open:true, id:host.id, remaining:0 });
  state = await owner.state(state => player(state, visitor.id)?.umbrella?.open === true, { since:owner.mark() });
  assert.deepEqual(player(state, visitor.id).umbrella, { open:true, remaining:100, max:100 });
  assert.equal(player(state, host.id).umbrella.open, true);

  since = owner.send({ type:'umbrella', open:false });
  await owner.state(state => player(state, host.id)?.umbrella?.open === false, { since });
  since = owner.send({ type:'shoot', id:visitor.id, damage:99999, ammo:99999 });
  const shot = await owner.waitFor(message => message.type === 'event' && message.event === 'shot' && message.id === host.id, { since });
  assert.equal(shot.weapon, 'pistol');
  state = await guest.state(state => player(state, host.id)?.ammo === config.weapons.pistol.magazine - 1, { since:guest.mark() });
  assert.equal(player(state, visitor.id).ammo, config.weapons.pistol.magazine);
  assert.equal(player(state, visitor.id).umbrella.open, true);
  assert.equal(player(state, host.id).hp, 100);
  assert.deepEqual(state.expedition, startingExpedition);

  // A disconnect retains the generator mission and the remaining actor's
  // equipment while applying the existing host-transfer rule.
  const leaveSince = guest.mark();
  await owner.close();
  state = await guest.state(state => state.players.length === 1 && state.hostId === visitor.id, { since:leaveSince });
  assert.equal(player(state, visitor.id).umbrella.open, true);
  assert.equal(player(state, visitor.id).umbrella.remaining, 100);
  assert.deepEqual(state.expedition, startingExpedition);
});
