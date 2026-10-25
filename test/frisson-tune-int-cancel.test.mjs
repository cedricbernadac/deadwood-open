// Frisson pack, called off on its way (art/frisson/DESIGN.md): with the real
// parts (heads, bodies, markers, survivors, weapons, pickups, atmosphere,
// cabin, blood, sounds, feedback) and a part that hangs, on a fetch that
// never settles or on a wait that is not a fetch.
// Leaving during a load never keeps the grim night, a hook, a zombie or a
// survivor style, the cabin's dressing or the feedback look; install rejects
// with an AbortError at once; a part that lands later comes straight off.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { createAmbianceLoader } from '../public/ambiance.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWorld, getSurvivorStyle, getPickupStyle } = await importPublicModule('world.js');
const zombies = await importPublicModule('zombies.js');
const pack = await importPublicModule('frisson/index.js');
const heads = await importPublicModule('frisson/heads.js');
const bodies = await importPublicModule('frisson/bodies.js');
const survivors = await importPublicModule('frisson/survivors.js');
const weapons = await importPublicModule('frisson/weapons.js');
const pickups = await importPublicModule('frisson/pickups.js');
const markers = await importPublicModule('frisson/markers.js');
const atmosphere = await importPublicModule('frisson/atmosphere.js');
const cabin = await importPublicModule('frisson/cabin.js');
const blood = await importPublicModule('frisson/blood.js');
const sounds = await importPublicModule('frisson/sounds.js');
const feedback = await importPublicModule('frisson/feedback.js');
const { getImpactStyle } = await importPublicModule('shot-fx.js');

const HOOKS = ['impact', 'death', 'frame', 'hurt'];
const NO_HOOKS = Object.freeze({ impact: null, death: null, frame: null, hurt: null });
const settle = () => new Promise(resolve => setImmediate(resolve));
const settleMany = async (count = 6) => { for (let step = 0; step < count; step++) await settle(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const file = name => { const bytes = readFileSync(new URL(`../public/frisson/${name}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); };
const FILES = Object.freeze({ 'heads.glb': file('heads.glb'), 'bodies.glb': file('bodies.glb'), 'survivors.glb': file('survivors.glb'), 'cabin-surfaces.js': file('cabin-surfaces.js'), 'cabin.glb': file('cabin.glb') });
// Settles within `ms`, or says it is still pending.
const within = (promise, ms = 250) => Promise.race([promise.then(value => ({ value }), error => ({ error })), new Promise(resolve => setTimeout(() => resolve({ pending: true }), ms))]);

// The page as atmosphere.js and blood.js use it: what they add is tracked.
function pageStub() {
  const attached = new Set(), classes = new Set();
  const element = () => {
    const node = { style: { setProperty() {} }, dataset: {}, width: 0, height: 0, classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, remove() { attached.delete(node); }, append() {}, appendChild() {},
      getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) };
    return node;
  };
  const parent = () => ({ ...element(), appendChild(node) { attached.add(node); return node; } });
  return { attached, classes, document: { head: parent(), body: parent(), createElement: element, getElementById: () => null, querySelector: () => null,
    documentElement: { classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); } } } } };
}

// The context client.js builds, with the game's own three and world. The
// world's look (lights, fog, sky, fireflies, exposure) is read back to say
// whether the grim night is on.
function gameContext({ fetchAsset } = {}) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(76, 16 / 9, .06, 130), page = pageStub();
  const previous = globalThis.document; globalThis.document = { createElement: page.document.createElement };
  let world;
  try { world = createWorld(scene); } finally { globalThis.document = previous; }
  const renderer = { toneMappingExposure: 1.3, compile() {}, async compileAsync() {}, getPixelRatio: () => 1 };
  const sound = { style: null, setStyle(style) { this.style = style; }, heartbeat() {} };
  const hud = { style: null, setStyle(style) { this.style = style; } };
  const ctx = { THREE, world, scene, camera, renderer, sound, feedback: hud, quality: 'low', document: page.document,
    fetchAsset: fetchAsset ?? (async path => { if (!FILES[path]) throw new Error(`no ${path}`); return FILES[path]; }) };
  const look = () => {
    const { ambient, moon, fill, lamps, fireflies } = world.atmosphere;
    return { fog: scene.fog.color.getHex(), background: scene.background.getHex(), exposure: renderer.toneMappingExposure, fireflies: fireflies.visible,
      lights: [ambient, moon, fill, ...lamps.map(lamp => lamp.light)].map(light => [light.intensity, light.color.getHex()]) };
  };
  const famille = look();
  return { ctx, page, look, famille, scene, sound };
}
// Nothing of the pack is left on: no style, no mood, no hook, no blood, no
// page overlay, no sound style, no feedback look (bursts, puff, HUD).
function assertFamille(game, hooks, label) {
  assert.equal(zombies.getZombieStyle(), null, `${label}: zombie style`);
  assert.equal(getSurvivorStyle(), null, `${label}: survivor style`);
  assert.equal(getPickupStyle(), null, `${label}: pickup style`);
  assert.deepEqual(game.look(), game.famille, `${label}: the Famille night`);
  assert.equal(game.ctx.world.dressing, null, `${label}: the cabin's dressing`);
  if (hooks) assert.deepEqual({ ...hooks }, NO_HOOKS, `${label}: hooks`);
  assert.equal(game.scene.getObjectByName('frissonBlood'), undefined, `${label}: blood pools`);
  assert.equal(game.page.attached.size, 0, `${label}: page overlays`);
  assert.equal(game.page.classes.size, 0, `${label}: page classes`);
  assert.equal(game.sound.style, null, `${label}: sound style`);
  assert.equal(getImpactStyle(), null, `${label}: impact style`);
  assert.equal(zombies.getDeathStyle(), null, `${label}: death style`);
  assert.equal(game.ctx.feedback.style, null, `${label}: HUD style`);
}
// A part that waits after the parts before it are on: its own fetch that
// never settles (it ignores the signal), or something else than a fetch.
function hangingPart(log, wait) {
  return {
    async install(ctx) {
      log.push('hang:install');
      ctx.hooks.frame = () => log.push('hang:frame');
      await wait(ctx);
      log.push('hang:landed');
      return { uninstall() { log.push('hang:uninstall'); ctx.hooks.frame = null; } };
    },
  };
}
const withHangAfter = (part, hang) => { const parts = [...pack.PARTS], at = parts.indexOf(part) + 1; parts.splice(at, 0, hang); return parts; };

test('the pack is the eleven real parts; install reads ctx.signal before each one', () => {
  assert.deepEqual(pack.PARTS, [heads, bodies, markers, survivors, weapons, pickups, atmosphere, cabin, blood, sounds, feedback]);
  const source = readFileSync(new URL('../public/frisson/index.js', import.meta.url), 'utf8');
  assert.match(source, /signal\?\.addEventListener\('abort', undo, \{ once: true \}\)/);
  assert.match(source, /for \(const part of parts\) \{\s*signal\?\.throwIfAborted\(\);/);
});

test('a signal already aborted: install rejects at once and touches nothing', async () => {
  const game = gameContext(), hooks = { ...NO_HOOKS }, controller = new AbortController();
  controller.abort();
  await assert.rejects(pack.install({ ...game.ctx, hooks, signal: controller.signal }), { name: 'AbortError' });
  assertFamille(game, hooks, 'aborted before');
});

test('heads.glb never arrives: aborting rejects at once with nothing on, and the late file installs nothing', async () => {
  const late = deferred(), asked = [];
  const game = gameContext({ fetchAsset: path => { asked.push(path); return path === 'heads.glb' ? late.promise : Promise.resolve(FILES[path]); } });
  const hooks = { ...NO_HOOKS }, controller = new AbortController();
  const installing = pack.install({ ...game.ctx, hooks, signal: controller.signal });
  await settleMany();
  assert.deepEqual(asked, ['heads.glb']);
  controller.abort();
  const result = await within(installing);
  assert.equal(result.error?.name, 'AbortError', 'rejects at once, not when the fetch would end');
  assertFamille(game, hooks, 'after the call-off');
  // The file turns up after all: the heads see the abort and stay off.
  late.resolve(FILES['heads.glb']); await settleMany();
  assertFamille(game, hooks, 'after the late file');
});

test('bodies.glb never arrives (heads on): the call-off takes the heads off and the late bodies stay off', async () => {
  const late = deferred();
  const game = gameContext({ fetchAsset: path => path === 'bodies.glb' ? late.promise : Promise.resolve(FILES[path]) });
  const hooks = { ...NO_HOOKS }, controller = new AbortController();
  const installing = pack.install({ ...game.ctx, hooks, signal: controller.signal });
  await settleMany(12);
  assert.ok(zombies.getZombieStyle()?.buildHead, 'the heads are on while the bodies load');
  assert.deepEqual(game.look(), game.famille, 'the night is not dark yet');
  controller.abort();
  assert.equal(zombies.getZombieStyle(), null, 'the heads come off at the call-off itself');
  assert.equal((await within(installing)).error?.name, 'AbortError');
  assertFamille(game, hooks, 'after the call-off');
  late.resolve(FILES['bodies.glb']); await settleMany();
  assertFamille(game, hooks, 'after the late bodies');
  // A zombie made now is the storybook one.
  assert.equal(zombies.createZombie('walker', false, 80, 'z3').userData.head.children[0].userData.headVariant, undefined);
});

test('a part after the grim night hangs on a fetch: leaving takes the night, the hooks, the blood and the style off', async () => {
  const log = [], late = deferred(), hooks = { ...NO_HOOKS }, controller = new AbortController();
  const game = gameContext();
  const own = game.ctx.fetchAsset;
  game.ctx.fetchAsset = path => path === 'later.bin' ? late.promise : own(path);
  const parts = withHangAfter(blood, hangingPart(log, ctx => ctx.fetchAsset('later.bin')));
  const installing = pack.installParts({ ...game.ctx, hooks, signal: controller.signal }, parts);
  await settleMany(12);
  // Heads, bodies, atmosphere and blood are on; the hanging part waits.
  assert.ok(zombies.getZombieStyle()?.buildTorso, 'heads and bodies');
  assert.notDeepEqual(game.look(), game.famille, 'the grim night');
  assert.ok(game.scene.getObjectByName('frissonBlood'));
  for (const name of HOOKS) assert.equal(hooks[name]?.frisson, true, name);
  hooks.frame({ delta: .016, time: 1 });
  assert.deepEqual(log, ['hang:install', 'hang:frame']);
  assert.equal(game.sound.style, null, 'sounds come after the hang');
  assert.equal(getImpactStyle(), null, 'and the feedback after them');
  controller.abort();
  assert.equal((await within(installing)).error?.name, 'AbortError');
  assertFamille(game, hooks, 'after the call-off');
  // The fetch lands at last: the part comes straight off again.
  late.resolve(new ArrayBuffer(1)); await settleMany();
  assert.deepEqual(log, ['hang:install', 'hang:frame', 'hang:landed', 'hang:uninstall']);
  assertFamille(game, hooks, 'after the late landing');
});

test('a part after the grim night waits on something else than a fetch: same, and its late landing comes off', async () => {
  const log = [], gate = deferred(), hooks = { ...NO_HOOKS }, controller = new AbortController(), game = gameContext();
  const parts = withHangAfter(atmosphere, hangingPart(log, () => gate.promise));
  const installing = pack.installParts({ ...game.ctx, hooks, signal: controller.signal }, parts);
  await settleMany(12);
  assert.notDeepEqual(game.look(), game.famille, 'the grim night is on');
  assert.ok(zombies.getZombieStyle());
  controller.abort();
  assert.equal((await within(installing)).error?.name, 'AbortError', 'no wait for the gate');
  assertFamille(game, hooks, 'after the call-off');
  gate.resolve(); await settleMany();
  assert.deepEqual(log, ['hang:install', 'hang:landed', 'hang:uninstall']);
  assertFamille(game, hooks, 'after the late landing');
  // A late failure is swallowed: no unhandled rejection.
  const failing = deferred(), again = new AbortController(), game2 = gameContext(), hooks2 = { ...NO_HOOKS };
  const second = pack.installParts({ ...game2.ctx, hooks: hooks2, signal: again.signal }, withHangAfter(atmosphere, hangingPart([], () => failing.promise)));
  await settleMany(12); again.abort();
  assert.equal((await within(second)).error?.name, 'AbortError');
  failing.reject(new Error('late failure')); await settleMany();
  assertFamille(game2, hooks2, 'after a late failure');
});

test('called off as a part lands, just before or just after: it comes off with the rest, and no later part starts', async () => {
  // Before: the part's own promise settles after the call-off.
  // After: the call-off comes once its install has handed back its handle.
  const lands = {
    before: (controller, handle) => { queueMicrotask(() => controller.abort()); return handle; },
    after: (controller, handle) => new Promise(resolve => setTimeout(() => { resolve(handle); queueMicrotask(() => controller.abort()); })),
  };
  for (const [when, land] of Object.entries(lands)) for (const followed of [false, true]) {
    const controller = new AbortController(), hooks = { ...NO_HOOKS }, game = gameContext(), log = [], label = `${when}${followed ? ', a part after it' : ', the last part'}`;
    // A plain function: its promise is the one install waits on, tick for tick.
    const landing = { install() { log.push('landing:install'); return land(controller, { uninstall() { log.push('landing:uninstall'); } }); } };
    const next = { async install() { log.push('next:install'); return { uninstall() { log.push('next:uninstall'); } }; } };
    const parts = followed ? [...pack.PARTS, landing, next] : [...pack.PARTS, landing];
    await assert.rejects(pack.installParts({ ...game.ctx, hooks, signal: controller.signal }, parts), { name: 'AbortError' }, label);
    assert.deepEqual(log, ['landing:install', 'landing:uninstall'], label);
    assertFamille(game, hooks, label);
  }
});

test('installed, then the signal aborts (the next request): everything comes off, and the handle\'s uninstall is harmless after', async () => {
  const controller = new AbortController(), hooks = { ...NO_HOOKS }, game = gameContext();
  const handle = await pack.install({ ...game.ctx, hooks, signal: controller.signal });
  assert.ok(zombies.getZombieStyle()?.buildTorso); assert.notDeepEqual(game.look(), game.famille); assert.ok(game.sound.style);
  assert.ok(getImpactStyle()); assert.ok(zombies.getDeathStyle()); assert.equal(game.ctx.feedback.style, feedback.FEEDBACK_STYLE);
  controller.abort();
  assertFamille(game, hooks, 'after the abort');
  handle.uninstall();
  assertFamille(game, hooks, 'after a second uninstall');
  // Without a signal (lookdev, tests) install and uninstall work as before.
  const plain = await pack.install({ ...game.ctx, hooks });
  assert.ok(zombies.getZombieStyle()); plain.uninstall();
  assertFamille(game, hooks, 'without a signal');
});

test('through the real loader: leaving while a part hangs is Famille at once (no grace), and the next Frisson room installs whole', async () => {
  for (const wait of [ctx => ctx.fetchAsset('later.bin'), () => new Promise(() => {})]) {
    const log = [], hooks = { ...NO_HOOKS }, game = gameContext(), never = new Promise(() => {});
    const own = game.ctx.fetchAsset;
    game.ctx.fetchAsset = path => path === 'later.bin' ? never : own(path);
    // A grace far longer than the test: only the pack honouring the signal settles it.
    const loader = createAmbianceLoader({ grace: 60000 });
    // The loader imports once: the first install hangs, the next is the plain pack.
    let installs = 0;
    const module = { install: ctx => ++installs === 1 ? pack.installParts(ctx, withHangAfter(blood, hangingPart(log, wait))) : pack.install(ctx) };
    const importer = () => Promise.resolve(module);
    const loading = loader.apply('frisson', { ...game.ctx, hooks }, importer);
    await settleMany(12);
    assert.notDeepEqual(game.look(), game.famille); assert.deepEqual({ ...hooks }, NO_HOOKS, 'a load in progress never reaches the game');
    const left = loader.apply('family', {});
    assert.deepEqual(await within(loading), { value: { id: 'family', stale: true, undone: true } });
    assert.deepEqual(await within(left), { value: { id: 'family' } });
    assertFamille(game, hooks, 'Famille');
    assert.equal(log.includes('hang:frame'), false, 'its frame hook never ran');
    // The next Frisson room: the whole pack, then off again.
    const result = await loader.apply('frisson', { ...game.ctx, hooks }, importer);
    assert.deepEqual(result, { id: 'frisson' });
    for (const name of HOOKS) assert.equal(typeof hooks[name], 'function', name);
    assert.ok(zombies.getZombieStyle()?.buildTorso); assert.ok(game.sound.style);
    await loader.apply('family', {});
    assertFamille(game, hooks, 'after the second room');
  }
});
