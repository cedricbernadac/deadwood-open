// The hurt hook's source (art/frisson/DESIGN.md): client.js names what took
// the local survivor's health, from the server's own hit events, so the
// blood part bleeds for a bite and never for the rain, a fall or a raider's
// blow, without guessing. The hook stays additive: { amount, hp, maxHp } as
// before, plus source ('zombie' | 'raider' | 'outside' | 'fall' | null).
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation } from '../simulation.mjs';
import { importPublicModule } from './helpers/public-modules.mjs';
import { settle, recordingPack, clientHarness, snapshotFor, walker } from './helpers/frisson-client.mjs';

const blood = await importPublicModule('frisson/blood.js');

// A Frisson room on this PC, in the night, with the importer's pack.
async function inTheNight(importer, log = []) {
  const client = clientHarness({ importer, log });
  client.join('guest');
  client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5)] }));
  await settle(); await settle();
  client.enter();
  assert.equal(client.state().inGame, true);
  return client;
}
// The next snapshot, with the local survivor at `hp`.
function healthAt(client, hp, extra = {}) {
  const state = snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5)] });
  Object.assign(state.players.find(player => player.id === 'guest'), { hp }, extra);
  client.update(state);
}
const hit = (fields, id = 'guest') => ({ type: 'event', event: 'hit', id, absorbed: 0, armor: 0, ...fields });
const BITE = { damage: 14, zombieId: 5 }, RAIDER = { damage: 12, source: 'raider', raiderId: 'r1', fromX: 3, fromZ: 9 };
const RAIN = { damage: 3, source: 'outside' }, FALL = { damage: 20, source: 'fall' };

test('each blow names its source in hurt; the old fields are unchanged', async () => {
  const pack = recordingPack([]), client = await inTheNight(pack.importer);
  const hurts = () => pack.events.filter(([name]) => name === 'hurt').map(([, event]) => event);
  let hp = 100;
  for (const [blow, source] of [[BITE, 'zombie'], [RAIDER, 'raider'], [RAIN, 'outside'], [FALL, 'fall']]) {
    client.event(hit(blow)); hp -= blow.damage; healthAt(client, hp);
    assert.deepEqual(hurts().at(-1), { amount: blow.damage, hp, maxHp: 100, source }, source);
  }
  assert.equal(hurts().length, 4);
});

test('several blows between two snapshots: a bite wins, else the one that took most; a stopped blow and a teammate\'s do not count', async () => {
  const pack = recordingPack([]), client = await inTheNight(pack.importer);
  const last = () => pack.events.filter(([name]) => name === 'hurt').at(-1)[1];
  // The rain ticks, then a small bite: the bite is the wound.
  client.event(hit(RAIN)); client.event(hit({ damage: 2, zombieId: 5 })); healthAt(client, 95);
  assert.equal(last().source, 'zombie'); assert.equal(last().amount, 5);
  // A bite first, then a fall: still the bite.
  client.event(hit(BITE)); client.event(hit(FALL)); healthAt(client, 61);
  assert.equal(last().source, 'zombie');
  // A raider's blow and a fall: the fall took more.
  client.event(hit({ ...RAIDER, damage: 8 })); client.event(hit({ damage: 10, source: 'fall' })); healthAt(client, 43);
  assert.equal(last().source, 'fall');
  // The vest stops a bite whole, the rain ticks: only the rain took health.
  client.event(hit({ ...BITE, absorbed: 14 })); client.event(hit(RAIN)); healthAt(client, 40);
  assert.equal(last().source, 'outside');
  // A teammate bitten: not this survivor's blow.
  client.event(hit(BITE, 'host')); healthAt(client, 37);
  assert.equal(last().source, null, 'a drop with no hit heard has no source');
});

test('the source is used once: a snapshot without a drop clears it, and leaving clears it', async () => {
  const pack = recordingPack([]), client = await inTheNight(pack.importer);
  const hurts = () => pack.events.filter(([name]) => name === 'hurt').map(([, event]) => event);
  client.event(hit(BITE)); healthAt(client, 100);
  assert.equal(hurts().length, 0);
  healthAt(client, 90);
  assert.equal(hurts().at(-1).source, null, 'the earlier bite does not leak into a later drop');
  // Heard just before leaving: the next room starts clean.
  client.event(hit(FALL)); client.leave(); await settle();
  client.join('guest'); client.update(snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5)] })); await settle(); await settle();
  client.enter(); healthAt(client, 80);
  assert.deepEqual(hurts().at(-1), { amount: 20, hp: 80, maxHp: 100, source: null });
});

test('the server\'s own hit events: bite, raider, rain and fall reach hurt with their source', async () => {
  const events = [], simulation = new RoomSimulation('ABC123', { ambiance: 'frisson', onEvent: event => events.push(event) });
  simulation.addPlayer('host', 'Hôte'); simulation.addPlayer('guest', 'Invité');
  simulation.phase = 'wave';
  const guest = simulation.players.get('guest');
  const pack = recordingPack([]), client = await inTheNight(pack.importer);
  const sources = [];
  const blows = {
    zombie: () => simulation.damagePlayer(guest, 14, { id: 5, kind: 'walker', x: 1, z: 1 }),
    raider: () => simulation.damagePlayer(guest, 12, { id: 'r1', kind: 'raider', source: 'raider', x: 3, z: 9 }),
    outside: () => simulation.damagePlayer(guest, 3, { source: 'outside' }),
    fall: () => simulation.damagePlayer(guest, 9, { source: 'fall' }),
  };
  for (const [expected, blow] of Object.entries(blows)) {
    const from = events.length;
    blow();
    const sent = events.slice(from);
    assert.equal(sent.filter(event => event.event === 'hit').length, 1, expected);
    for (const event of sent) client.event(event);
    const state = simulation.snapshot(); state.zombies = [walker(5)]; state.remaining = 9;
    client.update(state);
    const hurt = pack.events.filter(([name]) => name === 'hurt').at(-1)?.[1];
    assert.equal(hurt?.hp, guest.hp, expected);
    sources.push(hurt.source);
  }
  assert.deepEqual(sources, ['zombie', 'raider', 'outside', 'fall']);
});

// The real blood part behind the client: screen splats for wounds only.
function canvasDocument() {
  const pen = () => new Proxy({ globalAlpha: 1, fillStyle: '#000', imageSmoothingEnabled: true }, { get: (object, key) => key in object ? object[key] : () => {} });
  const body = { appendChild(node) { node.parentNode = body; return node; }, removeChild() {} };
  return { body, defaultView: { innerWidth: 1920, innerHeight: 1080 },
    createElement: () => ({ width: 300, height: 150, style: {}, setAttribute() {}, getContext(kind) { return kind === '2d' ? (this.pen ??= pen()) : null; }, remove() {} }) };
}
async function withBlood() {
  let handle = null;
  const module = { async install(ctx) {
    // The client's THREE and scene are stubs here: blood takes the real three and keeps its pools off-scene.
    handle = await blood.install({ ...ctx, THREE: undefined, scene: null, world: null, renderer: null, camera: null, document: canvasDocument(), random: () => .5 });
    return handle;
  } };
  const client = await inTheNight(() => Promise.resolve(module));
  return { client, splats: () => handle.stats().splats };
}

test('with the real blood part: a bite splats; the rain, a fall and a raider\'s blow never do, even when large', async () => {
  for (const [blow, splats] of [[BITE, true], [{ ...RAIN, damage: 9 }, false], [{ ...FALL, damage: 30 }, false], [{ ...RAIDER, damage: 25 }, false]]) {
    const { client, splats: count } = await withBlood();
    client.event(hit(blow)); healthAt(client, 100 - blow.damage);
    assert.equal(count() > 0, splats, JSON.stringify(blow));
    client.leave(); await settle();
  }
});

test('with the real blood part: small bites in the rain add up to a splat (no rain guess for a known bite)', async () => {
  const { client, splats } = await withBlood();
  // Outside in the rain, two 3 HP bites: each is no bigger than the rain's tick.
  client.event(hit({ damage: 3, zombieId: 5 })); healthAt(client, 97, { outsideDamageActive: true });
  for (let now = 16; now < 600; now += 16) { client.time(now); client.frame(now); }
  assert.equal(splats(), 0, 'one small bite stays under the splat threshold');
  client.event(hit({ damage: 3, zombieId: 5 })); healthAt(client, 94, { outsideDamageActive: true });
  assert.ok(splats() > 0, 'the second bite adds up');
  client.leave(); await settle();
});
