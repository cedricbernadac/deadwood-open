// The Famille guard, checked for coverage (art/frisson/DESIGN.md): every
// file outside public/frisson/ is scanned or plainly binary, every file inside
// it is accounted for (the runtime parts, bodies and cabin included, their assets, the
// lookdev and audition pages, the proposals copies), the Famille pages never
// reach the pack by a static import, and a whole Famille night fetches
// nothing under /frisson/.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { extname, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { SoundEngine } from '../public/audio.js';
import { settle, recordingPack, clientHarness, snapshotFor, walker } from './helpers/frisson-client.mjs';
import { importPublicModule } from './helpers/public-modules.mjs';

const { getImpactStyle } = await importPublicModule('shot-fx.js');
const { getDeathStyle } = await importPublicModule('zombies.js');

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url)).replace(/[\\/]$/, '');
// The spelling frisson-plumbing.test.mjs forbids outside the pack (kept equal
// to it: a design-note path under art/frisson/ is no load).
const namesPack = text => /frisson\/|\/frisson\b/i.test(text.replaceAll('art/frisson/', ''));
// What frisson-plumbing.test.mjs reads as text; anything else must be binary media.
const SCANNED = ['.js', '.mjs', '.html', '.css', '.json', '.md', '.txt', '.svg'];
const BINARY = ['.mp3', '.wav', '.ogg', '.glb', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2'];

function files(directory = publicRoot) {
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = directory + sep + entry.name;
    if (entry.isDirectory()) out.push(...files(path)); else out.push(relative(publicRoot, path).split(sep).join('/'));
  }
  return out;
}
const ALL = files();
const read = name => readFileSync(publicRoot + sep + name.split('/').join(sep), 'utf8');
// Static import and export specifiers (as test/helpers/public-modules.mjs reads them).
const SPECIFIER = /\b(?:import(?!\s*\()|export)\b[^;]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\1/g;
const staticImports = text => [...text.matchAll(SPECIFIER)].map(match => match[2] ?? match[4]);
const dynamicImports = text => [...text.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g)].map(match => match[2]);
// A specifier as a path under public/ ('/x' from the root, './x' from the file), or null (three, node).
function resolve(specifier, from) {
  if (specifier === '/vendor/three.module.js') return null;
  if (specifier.startsWith('/')) return specifier.slice(1);
  if (specifier.startsWith('./') || specifier.startsWith('../')) return posix.normalize(posix.join(posix.dirname(from), specifier));
  return null;
}
// The module scripts of a page: src attributes, then inline imports.
function pageEntries(name) {
  const html = read(name), entries = [];
  for (const [, src] of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) entries.push(resolve(src, name));
  for (const [, body] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) for (const specifier of [...staticImports(body), ...dynamicImports(body)]) entries.push(resolve(specifier, name));
  return entries.filter(Boolean);
}
// Every module reached by static imports from `entries`; dynamic imports are listed apart.
function closure(entries) {
  const seen = new Set(), dynamic = [];
  const visit = name => {
    if (seen.has(name)) return;
    assert.ok(ALL.includes(name), `${name} is imported but missing`);
    seen.add(name);
    const text = read(name);
    for (const specifier of dynamicImports(text)) dynamic.push([name, specifier]);
    for (const specifier of staticImports(text)) { const target = resolve(specifier, name); if (target) visit(target); }
  };
  entries.forEach(visit);
  return { modules: seen, dynamic };
}
const inPack = name => name.startsWith('frisson/');
// Level 2 loads only the fixed, locally served GLTF reader after map selection.
const SUPERMARKET_ART_IMPORT = ['world-supermarket.js', '/vendor/GLTFLoader.js'];
// Levels 3 and 4 load their fixed world modules only on their own map.
const HOSPITAL_WORLD_IMPORT = ['world.js', './world-hospital.js'];
const FUNFAIR_WORLD_IMPORT = ['world.js', './world-funfair.js'];
// The funfair's mirror maze loads three.js's fixed local Reflector on medium and high quality.
const FUNFAIR_MIRRORS_IMPORT = ['funfair-mirrors.js', '/vendor/Reflector.js'];

test('every file outside the pack is either scanned by the guard or binary media, and no scanned file names the pack', () => {
  const unknown = [], offenders = [];
  for (const name of ALL.filter(name => !inPack(name))) {
    const extension = extname(name).toLowerCase();
    if (BINARY.includes(extension)) continue;
    if (!SCANNED.includes(extension)) { unknown.push(name); continue; }
    if (name !== 'ambiance.js' && namesPack(read(name))) offenders.push(name);
  }
  assert.deepEqual(unknown, [], 'a new kind of text file outside the pack: add its extension to the guard in frisson-plumbing.test.mjs and here');
  assert.deepEqual(offenders, []);
  // The guard's spelling still catches every way of naming the folder, the
  // dev pages and the proposals included.
  for (const spelling of ['/frisson/lookdev.html', 'frisson/audition.html', '/frisson/proposals/rodeurs.glb', './frisson/bodies.js', '/frisson/bodies.glb', 'href="/FRISSON/frisson.css"'])
    assert.ok(namesPack(spelling), spelling);
  // The sound engine can only ever fetch under /audio/.
  const engine = new SoundEngine();
  for (const src of ['/frisson/heads.glb', '/audio/../frisson/sounds.js', '//example.com/audio/x.wav']) assert.equal(engine.localAsset(src), null, src);
  assert.equal(engine.localAsset('/audio/smg-3.wav'), '/audio/smg-3.wav');
});

test('the pack folder holds its runtime (bodies included), the assets that runtime names, the dev pages and the proposals copies, nothing else', () => {
  const pack = ALL.filter(inPack);
  const runtime = closure(['frisson/index.js']);
  const runtimePack = [...runtime.modules].filter(inPack).sort();
  for (const part of ['index', 'heads', 'glb', 'bodies', 'atmosphere', 'cabin', 'blood', 'blood-floor', 'blood-spray', 'sounds', 'weapons', 'weapon-recipes', 'pickups', 'feedback']) assert.ok(runtimePack.includes(`frisson/${part}.js`), part);
  assert.deepEqual(runtime.dynamic.filter(([name]) => inPack(name)), [], 'the pack imports nothing at run time');
  assert.deepEqual(runtime.dynamic, [HOSPITAL_WORLD_IMPORT, FUNFAIR_WORLD_IMPORT, SUPERMARKET_ART_IMPORT], 'the only deferred imports of shared scenery are the large level worlds and the fixed local GLTF reader');
  // One exception, in the cabin part: the surface recipes, a pure data module
  // fetched from the pack's own folder (CABIN.md section 4.3), run from their
  // bytes. They import nothing, so nothing else can come in that way.
  const computed = runtimePack.flatMap(name => [...read(name).matchAll(/\bimport\s*\(/g)].map(() => name));
  assert.deepEqual(computed, ['frisson/cabin.js'], 'the only import() of the runtime is the recipes module');
  assert.match(read('frisson/cabin.js'), /import\(`data:text\/javascript;charset=utf-8,\$\{encodeURIComponent\(text\)\}`\)/);
  assert.deepEqual(staticImports(read('frisson/cabin-surfaces.js')), [], 'the recipes import nothing');
  assert.deepEqual(dynamicImports(read('frisson/cabin-surfaces.js')), []);
  assert.equal(/\bimport\s*\(/.test(read('frisson/cabin-surfaces.js')), false);
  // Outside the pack, the runtime uses Famille modules only (they never import it back: first test).
  for (const name of runtime.modules) if (!inPack(name)) assert.match(name, /^[\w-]+\.js$/, name);
  const runtimeText = runtimePack.map(read).join('\n');
  // The lookdev, the audition and the proposals are for choosing, never for a
  // game: no string of the runtime names them (comments may).
  assert.deepEqual([...runtimeText.matchAll(/(['"`])[^'"`\n]*?(?:lookdev|audition|proposals\/)[^'"`\n]*?\1/g)].map(match => match[0]), []);
  const dev = pack.filter(name => name.endsWith('.html'));
  assert.deepEqual(dev.sort(), ['frisson/audition.html', 'frisson/lookdev.html']);
  const devModules = new Set(dev.flatMap(page => [...closure(pageEntries(page)).modules]));
  const unaccounted = [];
  for (const name of pack) {
    const base = name.slice('frisson/'.length);
    if (runtime.modules.has(name) || dev.includes(name) || devModules.has(name)) continue;
    if (base.startsWith('proposals/') ? base.endsWith('.glb') && !base.slice('proposals/'.length).includes('/') : runtimeText.includes(`'${base}'`) || runtimeText.includes(`}${base}\``)) continue;
    unaccounted.push(name);
  }
  assert.deepEqual(unaccounted, [], 'every file of the pack is runtime, an asset it names, a dev page or a proposal copy');
  // The dev modules are not the runtime's.
  for (const name of ['frisson/lookdev.js', 'frisson/lookdev-lineup.js']) { assert.ok(devModules.has(name), name); assert.equal(runtime.modules.has(name), false, name); }
  // The runtime's assets: the GLBs, the stylesheets and the cabin's recipes.
  for (const asset of ['heads.glb', 'heads-b.glb', 'bodies.glb', 'weapons.glb', 'pickups.glb', 'frisson.css', 'cabin.glb', 'cabin-surfaces.js', 'feedback.css']) {
    assert.ok(existsSync(`${publicRoot}${sep}frisson${sep}${asset}`), asset);
    assert.ok(runtimeText.includes(`'${asset}'`) || runtimeText.includes(`}${asset}\``), `${asset} is named by the runtime`);
  }
  // The pickups part's GLB (art/frisson/PICKUPS.md), the artist's file
  // installed provisionally: named by the runtime as a string literal.
  assert.ok(runtimeText.includes(`'pickups.glb'`), 'pickups.glb is named by the runtime');
  assert.ok(ALL.includes('frisson/pickups.glb'), 'pickups.glb is in the pack folder');
  // The proposals' sources and the bodies' photo bench live under art/, which
  // neither server serves: both serve public/ alone.
  for (const server of ['../server.mjs', '../online-server.mjs'])
    assert.match(readFileSync(new URL(server, import.meta.url), 'utf8'), /^const publicRoot = resolve\(root, 'public'\);$/m, server);
});

test('the Famille pages never reach the pack by a static import: the only way in is ambiance.js', () => {
  const pages = ALL.filter(name => name.endsWith('.html') && !inPack(name));
  assert.ok(pages.includes('index.html') && pages.includes('online.html'));
  for (const page of pages) {
    const { modules, dynamic } = closure(pageEntries(page));
    assert.deepEqual([...modules].filter(inPack), [], page);
    for (const [from, specifier] of dynamic) {
      if (from === SUPERMARKET_ART_IMPORT[0]) assert.deepEqual([from, specifier], SUPERMARKET_ART_IMPORT, page);
      else if (from === HOSPITAL_WORLD_IMPORT[0]) assert.ok(specifier === HOSPITAL_WORLD_IMPORT[1] || specifier === FUNFAIR_WORLD_IMPORT[1], page);
      else assert.deepEqual([from, specifier], ['ambiance.js', './frisson/index.js'], page);
    }
  }
  // The large worlds, loaded only on their own map, never reach the pack either.
  const hospital = closure(['world-hospital.js']), funfair = closure(['world-funfair.js']);
  assert.deepEqual([...hospital.modules].filter(inPack), [], 'world-hospital.js');
  assert.deepEqual(hospital.dynamic, [SUPERMARKET_ART_IMPORT], 'world-hospital.js defers only the GLTF reader (through world-supermarket.js)');
  assert.deepEqual([...funfair.modules].filter(inPack), [], 'world-funfair.js');
  assert.deepEqual(funfair.dynamic, [SUPERMARKET_ART_IMPORT, FUNFAIR_MIRRORS_IMPORT], 'world-funfair.js defers only the mirror maze Reflector and the GLTF reader (through world-supermarket.js)');
  // Both clients come through ambiance.js, which imports nothing statically.
  for (const page of ['index.html', 'online.html']) assert.ok(closure(pageEntries(page)).modules.has('ambiance.js'), page);
  assert.deepEqual(staticImports(read('ambiance.js')), []);
});

test('a whole Famille night, and a PC kept on Famille in a Frisson or Frisson léger room, fetch nothing under /frisson/ and never call the loader', async () => {
  const before = globalThis.fetch, asked = [];
  // The real modules client.js imports run in this realm: their fetches land here.
  globalThis.fetch = async url => { asked.push(String(url)); return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; };
  try {
    for (const [ambiance, locked] of [['family', false], ['frisson', true], ['frisson-leger', true]]) {
      const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log, locked });
      client.join('guest');
      client.update(snapshotFor({ ambiance, zombies: [walker(5)] }));
      client.enter();
      const wave = snapshotFor({ ambiance, phase: 'wave', zombies: [walker(5), walker(6, 3)] });
      client.update(wave);
      client.event({ type: 'event', event: 'shot', id: 'host', weapon: 'pistol', x: 0, y: 1.5, z: 0, yaw: 0, pitch: 0, hits: 1, kills: 0, headshots: 0, pellets: [{ yaw: 0, pitch: 0, distance: 4, stop: 'zombie' }] });
      client.event({ type: 'event', event: 'kill', id: 'host', zombieId: 5, headshot: true, boss: false, x: 2, y: 0, z: -4, dirX: 1, dirZ: 0, weapon: 'pistol', score: 10, chain: 1 });
      client.event({ type: 'event', event: 'hit', id: 'guest', damage: 14, absorbed: 0, armor: 0, zombieId: 6 });
      wave.players.find(player => player.id === 'guest').hp = 86; client.update(wave);
      for (let now = 16; now < 400; now += 16) { client.time(now); client.frame(now); }
      client.update(snapshotFor({ ambiance, phase: 'gameover', zombies: [] }));
      client.leave(); await settle(); await settle();
      assert.deepEqual(client.loaderCalls, [], ambiance);
      assert.equal(pack.imports, 0, ambiance);
      assert.deepEqual(client.hooks(), { impact: null, death: null, frame: null, hurt: null }, ambiance);
      assert.deepEqual(client.fetched.filter(url => /frisson/i.test(url)), [], `${ambiance}: client.js`);
      // No feedback look either (art/frisson/UI-SOUND.md): Famille's bursts,
      // puff, HUD words and stylesheet.
      assert.equal(getImpactStyle(), null, `${ambiance}: impact style`); assert.equal(getDeathStyle(), null, `${ambiance}: death style`);
      assert.equal(client.feedbackStyle(), null, `${ambiance}: HUD style`);
      assert.deepEqual(client.linked(), [], `${ambiance}: no stylesheet linked (#frisson-feedback-css)`);
    }
    assert.deepEqual(asked.filter(url => /frisson/i.test(url)), [], 'the modules client.js imports');
  } finally { globalThis.fetch = before; }
});
