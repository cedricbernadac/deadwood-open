import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createOnlineServer } from '../online-server.mjs';

class Peer {
  constructor(url) {
    this.socket = new WebSocket(url); this.messages = []; this.waiters = new Set();
    this.socket.on('error', () => {});
    this.socket.on('message', raw => {
      const message = JSON.parse(raw); this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.predicate(message)) waiter.finish(message);
    });
  }
  send(message) { const mark = this.messages.length; this.socket.send(JSON.stringify(message)); return mark; }
  wait(predicate, mark = 0) {
    const found = this.messages.slice(mark).find(predicate); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.waiters.delete(waiter); reject(Error('Bonus socket timeout')); }, 3000);
      const waiter = { predicate, finish: message => { clearTimeout(timeout); this.waiters.delete(waiter); resolve(message); } };
      this.waiters.add(waiter);
    });
  }
}

test('real peers claim personal bonuses independently, receive effective stats, and cannot forge identity or wave', async t => {
  const app = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false });
  t.after(() => app.close());
  const address = await app.listen(), url = `ws://127.0.0.1:${address.port}/ws`;
  const a = new Peer(url), b = new Peer(url);
  await Promise.all([once(a.socket, 'open'), once(b.socket, 'open')]);
  a.send({ type: 'join', protocol: 1, build: app.build, name: 'A' });
  const first = await a.wait(message => message.type === 'welcome');
  b.send({ type: 'join', protocol: 1, build: app.build, name: 'B', room: first.room });
  const second = await b.wait(message => message.type === 'welcome');
  const sim = app.rooms.get(first.room).simulation;
  Object.assign(sim, { wave: 2, phase: 'wave', toSpawn: 1, spawnTimer: 999 }); sim.beginSupplyWave();
  const host = sim.players.get(first.id), guest = sim.players.get(second.id);
  for (const player of [host, guest]) Object.assign(player, { x: sim.supplyCrate.x, y: 0, z: sim.supplyCrate.z,
    alive: true, downed: false, waiting: false, hp: 100 });
  const claim = async (peer, bonus, fields = {}) => {
    const mark = peer.send({ type: 'supply-claim', bonus, crateId: sim.supplyCrate.id, ...fields });
    return peer.wait(message => message.id === (peer === a ? first.id : second.id)
      && (message.event === 'supply-claimed' || message.event === 'supply-denied'), mark);
  };
  const claimed = await claim(a, 'vitamins', { id: second.id, level: 8 });
  assert.equal(claimed.event, 'supply-claimed', JSON.stringify(claimed)); assert.equal(claimed.id, first.id);
  assert.deepEqual(host.bonus, { vitamins: 1 }); assert.equal(guest.bonus, null);
  assert.equal((await claim(a, 'reload')).reason, 'claimed');
  assert.equal((await claim(b, 'vitality')).event, 'supply-claimed');
  assert.deepEqual(guest.bonus, { vitality: 1 }); assert.equal(guest.hp, 110);
  const mark = a.messages.length; app.step(); app.step();
  const snapshot = await a.wait(message => message.type === 'state' && message.wave === 2, mark);
  assert.equal(snapshot.players.find(player => player.id === second.id).maxHp, 110);
  assert.equal(snapshot.players.find(player => player.id === first.id).bonus.vitamins, 1);
  const previous = sim.supplyCrate.id;
  sim.wave = 3; sim.beginSupplyWave();
  assert.equal((await claim(a, 'reload', { crateId: previous })).reason, 'missing');
  assert.equal((await claim(a, 'reload')).event, 'supply-claimed');
  sim.wave = 19; sim.beginSupplyWave();
  assert.equal((await claim(b, 'frostaura', { wave: 2 })).reason, 'unavailable');
  assert.deepEqual(guest.bonus, { vitality: 1 });
});
