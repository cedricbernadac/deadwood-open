// Frisson plumbing (art/frisson/DESIGN.md): the room's ambiance in the shared
// rules and the simulation, the loader in public/ambiance.js, and the guard
// that nothing outside public/frisson/ but that loader names the pack.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AMBIANCES, ambianceOf, FRISSON_AMBIANCES, isFrissonLike } from '../public/rules.js';
import { RoomSimulation } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { createAmbianceLoader, applyAmbiance, FRISSON_BASE, FRISSON_VARIANTS } from '../public/ambiance.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('rules: three ambiances in the picker order, anything else is Famille; both Frisson ones are Frisson-like', () => {
  assert.deepEqual(AMBIANCES, ['family', 'frisson-leger', 'frisson']);
  assert.ok(Object.isFrozen(AMBIANCES));
  assert.equal(ambianceOf('frisson'), 'frisson');
  assert.equal(ambianceOf('frisson-leger'), 'frisson-leger');
  assert.equal(ambianceOf('family'), 'family');
  for (const value of [undefined, null, '', 'FRISSON', 'Frisson', ' frisson', 'nightmare', 'gore', 1, {}, ['frisson'], { toString: () => 'frisson' },
    'frisson-léger', 'frisson_leger', 'Frisson-leger', 'frisson-leger ', 'leger', 'light', ['frisson-leger'], { toString: () => 'frisson-leger' }]) assert.equal(ambianceOf(value), 'family');
  // The pack's ambiances: the wounds, the loader and the lock treat them alike.
  assert.deepEqual(FRISSON_AMBIANCES, ['frisson-leger', 'frisson']); assert.ok(Object.isFrozen(FRISSON_AMBIANCES));
  assert.deepEqual(AMBIANCES.filter(isFrissonLike), ['frisson-leger', 'frisson']);
  for (const value of [undefined, null, '', 'family', 'FRISSON', 'frisson-léger', ['frisson'], { toString: () => 'frisson' }]) assert.equal(isFrissonLike(value), false, String(value));
  // The loader knows the same two, and nothing else.
  assert.deepEqual(Object.keys(FRISSON_VARIANTS).sort(), [...FRISSON_AMBIANCES].sort());
});

test('simulation: the ambiance is a validated constructor option, in every snapshot, fixed for the room', () => {
  assert.equal(new RoomSimulation('FAM001').snapshot().ambiance, 'family');
  assert.equal(new RoomSimulation('FAM002', { ambiance: 'gore' }).snapshot().ambiance, 'family');
  const room = new RoomSimulation('FRI001', { ambiance: 'frisson' });
  room.addPlayer('host', 'Hôte'); room.addPlayer('guest', 'Invité');
  assert.equal(room.snapshot().ambiance, 'frisson');
  // Difficulty, start and restart leave it alone.
  assert.equal(room.setDifficulty('host', 'hard'), true);
  room.start('host'); assert.equal(room.snapshot().ambiance, 'frisson');
  room.phase = 'gameover'; room.start('host'); assert.equal(room.snapshot().ambiance, 'frisson');
  // The stand may preview Frisson too.
  const practice = new RoomSimulation('PRA001', { practice: true, ambiance: 'frisson' });
  assert.equal(practice.snapshot().practice, true); assert.equal(practice.snapshot().ambiance, 'frisson');
  // The online room passes the option and the field through.
  assert.equal(new OnlineRoomSimulation('ONL001', { ambiance: 'frisson' }).snapshot().ambiance, 'frisson');
  assert.equal(new OnlineRoomSimulation('ONL002').snapshot().ambiance, 'family');
  // Frisson léger the same way, practice and online included.
  const light = new RoomSimulation('LEG001', { ambiance: 'frisson-leger' });
  light.addPlayer('host', 'Hôte'); light.start('host'); light.phase = 'gameover'; light.start('host');
  assert.equal(light.snapshot().ambiance, 'frisson-leger');
  assert.equal(new RoomSimulation('LEG002', { practice: true, ambiance: 'frisson-leger' }).snapshot().ambiance, 'frisson-leger');
  assert.equal(new OnlineRoomSimulation('ONL003', { ambiance: 'frisson-leger' }).snapshot().ambiance, 'frisson-leger');
  assert.equal(new RoomSimulation('LEG003', { ambiance: 'frisson-léger' }).snapshot().ambiance, 'family');
});

test('simulation: Famille rooms play exactly as before, the snapshot only gains the ambiance field', () => {
  const play = options => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const room = new RoomSimulation('SAME01', { random, ...options });
    room.addPlayer('host', 'Hôte'); room.start('host');
    for (let tick = 0; tick < 30 * 20; tick++) room.tick(1 / 30);
    const { ambiance, ...rest } = room.snapshot();
    return { ambiance, rest: JSON.stringify(rest) };
  };
  const plain = play({}), frisson = play({ ambiance: 'frisson' }), light = play({ ambiance: 'frisson-leger' });
  assert.equal(plain.ambiance, 'family'); assert.equal(frisson.ambiance, 'frisson'); assert.equal(light.ambiance, 'frisson-leger');
  assert.equal(frisson.rest, plain.rest, 'the ambiance never reaches gameplay');
  assert.equal(light.rest, plain.rest, 'Frisson léger neither');
});

// A path to the pack: 'frisson/…', '/frisson', './frisson'. A design-note
// path (art/frisson/DESIGN.md) is no load; a served one is.
const namesPack = text => /frisson\/|\/frisson\b/i.test(text.replaceAll('art/frisson/', ''));
// Every run-time import outside the pack: a fixed module, never a built path.
const RUNTIME_IMPORTS = { 'ambiance.js': ["import('./frisson/index.js')"], 'index.html': ["import('/client.js')"], 'online.html': ["import('/online-client.js')"], 'world-supermarket.js': ["import('/vendor/GLTFLoader.js')"],
  'world.js': ["import('./world-hospital.js')", "import('./world-funfair.js')"], 'funfair-mirrors.js': ["import('/vendor/Reflector.js')"] };

test('static: only ambiance.js, outside the pack, names the frisson folder; Famille assets never reference it', () => {
  const texts = ['.js', '.mjs', '.html', '.css', '.json', '.md', '.txt', '.svg'];
  const offenders = [], imports = {};
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = directory + sep + entry.name, name = relative(publicRoot, path).split(sep).join('/');
      if (entry.isDirectory()) { if (name !== 'frisson') visit(path); continue; }
      if (!texts.includes(extname(entry.name))) continue;
      const text = readFileSync(path, 'utf8');
      const found = text.match(/\bimport\s*\([^)]*\)/g);
      if (found) imports[name] = found;
      if (name !== 'ambiance.js' && namesPack(text)) offenders.push(name);
    }
  };
  visit(publicRoot.replace(/[\\/]$/, ''));
  assert.deepEqual(offenders, []);
  assert.deepEqual(imports, RUNTIME_IMPORTS, 'no module path is built at run time');
  // The guard sees every spelling of the folder, not only 'frisson/'.
  for (const spelling of ["import('./frisson/index.js')", "fetch('/frisson')", "import('./frisson')", '<link href="frisson/frisson.css">', "'/FRISSON/heads.glb'"]) assert.ok(namesPack(spelling), spelling);
  for (const text of ['// (art/frisson/DESIGN.md)', "ambiance: 'frisson'", "t('ambiance.frisson')", 'Frisson (15+)', 'frisson-desaturate']) assert.ok(!namesPack(text), text);
  const loader = readFileSync(new URL('../public/ambiance.js', import.meta.url), 'utf8');
  assert.doesNotMatch(loader, /^import /m, 'the loader has no static import: no three, no assets');
  assert.equal(loader.match(/import\(/g)?.length, 1);
  assert.match(loader, /import\('\.\/frisson\/index\.js'\)/, 'relative, no query string: one module instance');
  const client = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8');
  assert.match(client, /^import \{ applyAmbiance \} from '\.\/ambiance\.js';$/m);
  assert.doesNotMatch(client, /\bimport\(/, 'client.js never imports anything at run time');
  assert.doesNotMatch(JSON.stringify(JSON.parse(readFileSync(new URL('../public/audio/manifest.json', import.meta.url), 'utf8'))), /frisson/i);
  for (const server of ['../server.mjs', '../online-server.mjs'])
    assert.match(readFileSync(new URL(server, import.meta.url), 'utf8'), /'\.glb': 'model\/gltf-binary'/, server);
});

function fakePack(log, { failInstall = false } = {}) {
  let installs = 0;
  return {
    get installs() { return installs; },
    async install(ctx) {
      const index = ++installs; log.push(`install${index}`);
      if (failInstall) throw new Error('install failed');
      await ctx.wait?.(index);
      log.push(`installed${index}`);
      return { uninstall() { log.push(`uninstall${index}`); } };
    },
  };
}

test('loader: Famille never imports; Frisson imports once, installs with the context and comes off', async () => {
  const log = [], pack = fakePack(log), loader = createAmbianceLoader();
  let imports = 0, given = null;
  const importer = () => { imports++; return Promise.resolve({ install: ctx => { given = ctx; return pack.install(ctx); } }); };
  assert.deepEqual(await loader.apply('family', {}, importer), { id: 'family' });
  assert.deepEqual(await loader.apply('anything', {}, importer), { id: 'family' });
  assert.equal(imports, 0);
  const hooks = { impact: null, death: null, frame: null, hurt: null }, world = {};
  assert.deepEqual(await loader.apply('frisson', { hooks, world, quality: 'low' }, importer), { id: 'frisson' });
  assert.equal(loader.id, 'frisson');
  assert.equal(imports, 1); assert.equal(given.world, world); assert.equal(given.quality, 'low');
  assert.equal(given.base, '/frisson/'); assert.equal(FRISSON_BASE, '/frisson/'); assert.equal(typeof given.fetchAsset, 'function');
  // The pack fills slots of its own, copied to the game's once it is in place.
  assert.notEqual(given.hooks, hooks); assert.deepEqual(given.hooks, hooks);
  assert.equal(given.signal.aborted, false);
  // Asked again while on: nothing more.
  assert.deepEqual(await loader.apply('frisson', {}, importer), { id: 'frisson' });
  assert.equal(pack.installs, 1);
  // Off at once, before the promise settles; the load is called off.
  const off = loader.apply('family', {}, importer);
  assert.deepEqual(log, ['install1', 'installed1', 'uninstall1']); assert.equal(loader.id, 'family');
  assert.equal(given.signal.aborted, true);
  assert.deepEqual(await off, { id: 'family' });
  // On again: the module is not imported twice.
  assert.deepEqual(await loader.apply('frisson', {}, importer), { id: 'frisson' });
  assert.equal(imports, 1); assert.equal(pack.installs, 2);
  // The page-wide entry point is one shared loader with the same API.
  assert.equal(typeof applyAmbiance, 'function');
});

test('loader: both Frisson ambiances load the one pack, each with its variant; going from one to the other installs it again', async () => {
  const log = [], pack = fakePack(log), loader = createAmbianceLoader(), given = [];
  let imports = 0;
  const importer = () => { imports++; return Promise.resolve({ install: ctx => { given.push(ctx); return pack.install(ctx); } }); };
  // What each asks of the pack: Frisson exactly as before, Frisson léger the B heads, half the blood and the light pickups.
  assert.deepEqual(FRISSON_VARIANTS, { frisson: { id: 'frisson', heads: 'heads.glb', blood: 1 }, 'frisson-leger': { id: 'frisson-leger', heads: 'heads-b.glb', blood: .5, pickups: 'light' } });
  assert.ok(Object.isFrozen(FRISSON_VARIANTS) && Object.values(FRISSON_VARIANTS).every(Object.isFrozen));
  assert.deepEqual(await loader.apply('frisson-leger', { quality: 'low' }, importer), { id: 'frisson-leger' });
  assert.equal(loader.id, 'frisson-leger');
  assert.equal(given[0].variant, FRISSON_VARIANTS['frisson-leger']); assert.equal(given[0].quality, 'low'); assert.equal(given[0].base, '/frisson/');
  // Asked again while on: nothing more.
  assert.deepEqual(await loader.apply('frisson-leger', {}, importer), { id: 'frisson-leger' });
  assert.equal(pack.installs, 1);
  // The other Frisson: the pack comes off and goes on again, with Frisson's variant, imported once.
  assert.deepEqual(await loader.apply('frisson', {}, importer), { id: 'frisson' });
  assert.deepEqual(log, ['install1', 'installed1', 'uninstall1', 'install2', 'installed2']);
  assert.equal(given[0].signal.aborted, true); assert.equal(given[1].variant, FRISSON_VARIANTS.frisson);
  assert.equal(loader.id, 'frisson'); assert.equal(imports, 1);
  // A caller's own variant never wins over the ambiance's.
  await loader.apply('family', {});
  await loader.apply('frisson', { variant: { heads: '../secret.glb', blood: 2 } }, importer);
  assert.equal(given[2].variant, FRISSON_VARIANTS.frisson);
  assert.deepEqual(await loader.apply('family', {}), { id: 'family' }); assert.equal(loader.id, 'family');
  // Near misses are Famille: no import, no install.
  for (const id of ['frisson-léger', 'Frisson-leger', 'frisson_leger', 'leger', 'toString', '__proto__', 'hasOwnProperty']) assert.deepEqual(await loader.apply(id, {}, importer), { id: 'family' }, id);
  assert.equal(pack.installs, 3);
});

test('loader: a load that lands after the player left takes itself off (generation token)', async () => {
  // The import resolves after leaving: no install at all.
  {
    const log = [], pack = fakePack(log), loader = createAmbianceLoader(), module = deferred();
    const loading = loader.apply('frisson', {}, () => module.promise);
    const left = loader.apply('family', {});
    module.resolve(pack);
    assert.deepEqual(await loading, { id: 'family', stale: true });
    assert.deepEqual(await left, { id: 'family' });
    assert.equal(pack.installs, 0); assert.equal(loader.id, 'family');
  }
  // The install resolves after leaving: it is uninstalled at once.
  {
    const log = [], pack = fakePack(log), loader = createAmbianceLoader(), gate = deferred();
    const loading = loader.apply('frisson', { wait: () => gate.promise }, () => Promise.resolve(pack));
    await settle();
    assert.deepEqual(log, ['install1']);
    const left = loader.apply('family', {});
    gate.resolve();
    assert.deepEqual(await loading, { id: 'family', stale: true, undone: true });
    assert.deepEqual(await left, { id: 'family' });
    assert.deepEqual(log, ['install1', 'installed1', 'uninstall1']); assert.equal(loader.id, 'family');
  }
});

// Shaped like frisson/index.js: the slots are filled and the first part is in
// place before the next one waits (for an asset, or something else).
function indexLikePack(log, wait) {
  return {
    async install(ctx) {
      log.push('install');
      const undo = () => { ctx.world.mood = null; for (const name of Object.keys(ctx.hooks)) ctx.hooks[name] = null; log.push('undo'); };
      for (const name of Object.keys(ctx.hooks)) { const fan = () => log.push(`hook:${name}`); fan.frisson = true; ctx.hooks[name] = fan; }
      ctx.world.mood = 'frisson';
      try { await wait(ctx); } catch (error) { undo(); throw error; }
      log.push('installed');
      return { uninstall: undo };
    },
  };
}
const gameHooks = () => ({ impact: null, death: null, frame: null, hurt: null });

test('loader: a load called off cuts its fetches at once, so the parts already in place come off with it', async () => {
  const log = [], loader = createAmbianceLoader(), hooks = gameHooks(), world = { mood: null }, asked = [];
  const stalled = (path, signal) => { asked.push([path, signal]); return new Promise(() => {}); };
  const pack = indexLikePack(log, ctx => ctx.fetchAsset('heads.glb'));
  const loading = loader.apply('frisson', { hooks, world, fetchAsset: stalled }, () => Promise.resolve(pack));
  await settle();
  assert.equal(world.mood, 'frisson'); assert.deepEqual(asked.map(([path]) => path), ['heads.glb']);
  assert.deepEqual(hooks, gameHooks(), 'a load in progress never reaches the game');
  const left = loader.apply('family', {});
  assert.equal(asked[0][1].aborted, true, 'the fetcher is told too');
  await settle();
  assert.equal(world.mood, null, 'off at once, not when the fetch would have ended');
  assert.deepEqual(await loading, { id: 'family', stale: true, undone: true });
  assert.deepEqual(await left, { id: 'family' });
  assert.deepEqual(hooks, gameHooks()); assert.deepEqual(log, ['install', 'undo']);
  // A fetch asked after the call-off fails at once.
  const late = createAmbianceLoader();
  let fetchAsset = null;
  await late.apply('frisson', { fetchAsset: async () => new ArrayBuffer(2) }, () => Promise.resolve({ install: ctx => { fetchAsset = ctx.fetchAsset; return { uninstall() {} }; } }));
  assert.equal((await fetchAsset('a.glb')).byteLength, 2);
  late.apply('family', {});
  await assert.rejects(fetchAsset('b.glb'), { name: 'AbortError' });
});

test('loader: the game\'s hooks are filled only by an install that landed and is still wanted', async () => {
  const log = [], hooks = gameHooks(), world = { mood: null };
  // Called off while a part waits on something else than a fetch: the slots
  // never reach the game; the part takes itself off when it lands.
  {
    const loader = createAmbianceLoader(), gate = deferred();
    const loading = loader.apply('frisson', { hooks, world }, () => Promise.resolve(indexLikePack(log, () => gate.promise)));
    await settle();
    assert.deepEqual(hooks, gameHooks());
    loader.apply('family', {});
    gate.resolve();
    assert.deepEqual(await loading, { id: 'family', stale: true, undone: true });
    assert.deepEqual(hooks, gameHooks()); assert.equal(world.mood, null);
  }
  // Wanted: filled once it lands, emptied when it comes off.
  {
    const loader = createAmbianceLoader(), gate = deferred();
    const loading = loader.apply('frisson', { hooks, world }, () => Promise.resolve(indexLikePack(log, () => gate.promise)));
    await settle();
    assert.deepEqual(hooks, gameHooks());
    gate.resolve();
    assert.deepEqual(await loading, { id: 'frisson' });
    for (const name of Object.keys(hooks)) assert.equal(hooks[name]?.frisson, true, name);
    loader.apply('family', {});
    assert.deepEqual(hooks, gameHooks()); assert.equal(world.mood, null);
  }
});

test('loader: Famille is answered once a load called off has landed; a stuck one holds things for the grace only', async () => {
  const log = [], world = { mood: null };
  {
    const loader = createAmbianceLoader(), gate = deferred();
    loader.apply('frisson', { hooks: gameHooks(), world }, () => Promise.resolve(indexLikePack(log, () => gate.promise)));
    await settle();
    let answered = false;
    const left = loader.apply('family', {}).then(result => { answered = true; return result; });
    for (let step = 0; step < 5; step++) await settle();
    assert.equal(answered, false, 'Famille waits while the called-off part is still on');
    assert.equal(world.mood, 'frisson');
    gate.resolve();
    assert.deepEqual(await left, { id: 'family' });
    assert.equal(world.mood, null);
  }
  // A part that never lands: the next answers come after the grace.
  {
    const loader = createAmbianceLoader({ grace: 30 }), hooks = gameHooks();
    let installs = 0;
    const pack = { async install(ctx) {
      if (++installs === 1) await new Promise(() => {});
      for (const name of Object.keys(ctx.hooks)) ctx.hooks[name] = () => {};
      return { uninstall() {} };
    } };
    const stuck = loader.apply('frisson', { hooks }, () => Promise.resolve(pack));
    await settle();
    const started = Date.now();
    assert.deepEqual(await loader.apply('family', {}), { id: 'family' });
    assert.deepEqual(await loader.apply('frisson', { hooks }, () => Promise.resolve(pack)), { id: 'frisson' });
    assert.ok(Date.now() - started >= 25, 'it waited for the grace');
    assert.equal(installs, 2); assert.equal(typeof hooks.frame, 'function');
    let settled = false; stuck.then(() => { settled = true; });
    await settle(); assert.equal(settled, false);
  }
});

test('loader: installs never overlap, so a stale pack comes off before the next goes on', async () => {
  const log = [], pack = fakePack(log), loader = createAmbianceLoader(), gates = [deferred(), deferred()];
  const ctx = { wait: index => gates[index - 1].promise };
  const first = loader.apply('frisson', ctx, () => Promise.resolve(pack));
  await settle();
  loader.apply('family', ctx);
  const second = loader.apply('frisson', ctx, () => Promise.resolve(pack));
  await settle();
  assert.deepEqual(log, ['install1'], 'the second install waits for the first');
  gates[0].resolve(); gates[1].resolve();
  assert.deepEqual(await first, { id: 'family', stale: true, undone: true });
  assert.deepEqual(await second, { id: 'frisson' });
  assert.deepEqual(log, ['install1', 'installed1', 'uninstall1', 'install2', 'installed2']);
  assert.equal(loader.id, 'frisson');
});

test('loader: a failure falls back to Famille and can be tried again', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const log = [], loader = createAmbianceLoader();
    let imports = 0;
    const broken = () => { imports++; return Promise.reject(new Error('404')); };
    const failed = await loader.apply('frisson', {}, broken);
    assert.equal(failed.id, 'family'); assert.equal(failed.failed, true); assert.match(failed.error.message, /404/);
    assert.equal(loader.id, 'family');
    // A failed import is not cached.
    const pack = fakePack(log);
    assert.deepEqual(await loader.apply('frisson', {}, () => { imports++; return Promise.resolve(pack); }), { id: 'frisson' });
    assert.equal(imports, 2);
    // A failing install leaves Famille; the imported module is kept.
    const other = createAmbianceLoader(), bad = fakePack(log, { failInstall: true });
    let count = 0;
    const importer = () => { count++; return Promise.resolve(bad); };
    assert.equal((await other.apply('frisson', {}, importer)).failed, true);
    assert.equal((await other.apply('frisson', {}, importer)).failed, true);
    assert.equal(count, 1); assert.equal(other.id, 'family');
    // A throwing uninstall never blocks going back to Famille.
    const stubborn = createAmbianceLoader();
    await stubborn.apply('frisson', {}, () => Promise.resolve({ install: () => ({ uninstall() { throw new Error('stuck'); } }) }));
    assert.deepEqual(await stubborn.apply('family', {}), { id: 'family' });
    assert.equal(stubborn.id, 'family');
  } finally { console.warn = warn; }
});

test('loader: the default fetchAsset reads base + path and refuses an HTTP error', async () => {
  const fetchBefore = globalThis.fetch, urls = [], signals = [];
  globalThis.fetch = async (url, options) => { urls.push(url); signals.push(options?.signal); return url.endsWith('missing.glb') ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; };
  try {
    let fetchAsset = null, given = null;
    const loader = createAmbianceLoader();
    await loader.apply('frisson', {}, () => Promise.resolve({ install: ctx => { ({ fetchAsset } = given = ctx); return { uninstall() {} }; } }));
    assert.equal((await fetchAsset('heads.glb')).byteLength, 4);
    await assert.rejects(fetchAsset('missing.glb'), /missing\.glb: HTTP 404/);
    assert.deepEqual(urls, ['/frisson/heads.glb', '/frisson/missing.glb']);
    // The network request itself is cut when the load is called off.
    assert.ok(signals.every(signal => signal === given.signal));
    loader.apply('family', {}); assert.equal(signals[0].aborted, true);
    // A context may bring its own (tests inject files): it is the one asked.
    let injected = null;
    const own = async path => new ArrayBuffer(path.length);
    await createAmbianceLoader().apply('frisson', { fetchAsset: own }, () => Promise.resolve({ install: ctx => { injected = ctx.fetchAsset; return { uninstall() {} }; } }));
    assert.equal((await injected('abc')).byteLength, 3);
    assert.deepEqual(urls, ['/frisson/heads.glb', '/frisson/missing.glb']);
  } finally { globalThis.fetch = fetchBefore; }
});

test('loader: the real pack composes its four parts behind the shared hook slots', async () => {
  // The context client.js builds, with the game's own three and world; the
  // pack's files come from disk instead of the network.
  const THREE = await import('three'), { createWorld, getWeaponStyle } = await importPublicModule('world.js');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(76, 16 / 9, .06, 130);
  const element = () => ({ style: {}, dataset: {}, width: 0, height: 0, setAttribute() {}, remove() {}, append() {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {} },
    getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) });
  const previous = globalThis.document; globalThis.document = { createElement: element };
  let world;
  try { world = createWorld(scene); } finally { globalThis.document = previous; }
  const ctx = {
    THREE, world, scene, camera,
    renderer: { toneMappingExposure: 1.3, compile() {}, async compileAsync() {}, getPixelRatio: () => 1 },
    sound: { setStyle() {} }, quality: 'low',
    document: { head: element(), body: element(), createElement: element, getElementById: () => null, querySelector: () => null },
    fetchAsset: async path => { const bytes = readFileSync(new URL(`../public/frisson/${path}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
  const loader = createAmbianceLoader(), hooks = { impact: null, death: null, frame: null, hurt: null };
  const { getImpactStyle } = await importPublicModule('shot-fx.js'), { getDeathStyle } = await importPublicModule('zombies.js');
  const result = await loader.apply('frisson', { ...ctx, hooks }, () => importPublicModule('frisson/index.js'));
  assert.deepEqual(result, { id: 'frisson' });
  assert.ok(getWeaponStyle()?.dress, 'the weapons part set its style');
  // No HUD in this context (ctx.feedback): the feedback part still puts its
  // bursts and its puff on, and takes them off again.
  assert.equal('feedback' in ctx, false); assert.ok(getImpactStyle()); assert.ok(getDeathStyle());
  for (const name of Object.keys(hooks)) {
    assert.equal(typeof hooks[name], 'function', name);
    assert.doesNotThrow(() => hooks[name]({}));
  }
  await loader.apply('family', {});
  assert.equal(getWeaponStyle(), null, 'back to Famille, the weapon style is off');
  assert.deepEqual(hooks, { impact: null, death: null, frame: null, hurt: null });
  assert.equal(getImpactStyle(), null); assert.equal(getDeathStyle(), null);
  // Called off on its way (the player left at once): nothing reaches the game.
  const loading = loader.apply('frisson', { ...ctx, hooks }, () => importPublicModule('frisson/index.js'));
  const left = loader.apply('family', {});
  assert.equal((await loading).stale, true); assert.deepEqual(await left, { id: 'family' });
  assert.deepEqual(hooks, { impact: null, death: null, frame: null, hurt: null });
});
