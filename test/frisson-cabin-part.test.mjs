// The cabin part of the Frisson pack (art/frisson/CABIN.md section 4.5):
// public/frisson/cabin.js reads cabin-surfaces.js and cabin.glb through
// ctx.fetchAsset, dresses the world for the graphics preset, honours
// ctx.signal, and comes off leaving Famille exactly and nothing allocated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';
import { writeFrissonGlb } from '../tools/frisson-glb-write.mjs';

const { createWorld } = await importPublicModule('world.js');
const cabin = await importPublicModule('frisson/cabin.js');
const pack = await importPublicModule('frisson/index.js');
const parts = await Promise.all(['heads', 'bodies', 'markers', 'survivors', 'weapons', 'pickups', 'atmosphere', 'cabin', 'blood', 'sounds', 'feedback'].map(name => importPublicModule(`frisson/${name}.js`)));

const bytes = name => { const data = readFileSync(new URL(`../public/frisson/${name}`, import.meta.url)); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); };
const FILES = Object.freeze({ 'cabin-surfaces.js': bytes('cabin-surfaces.js'), 'cabin.glb': bytes('cabin.glb') });
const text = value => new TextEncoder().encode(value).buffer;
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// Canvases that remember their size and every fill.
const canvases = [];
const page = { createElement: () => { const canvas = { width: 0, height: 0, fills: 0 }; canvas.getContext = () => ({ fillStyle: '', fillRect() { canvas.fills++; }, measureText: value => ({ width: value.length * 20 }) }); canvases.push(canvas); return canvas; } };
function setup() {
  const old = globalThis.document; globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
  try { const scene = new THREE.Scene(); return { scene, world: createWorld(scene), camera: new THREE.PerspectiveCamera() }; }
  finally { globalThis.document = old; }
}
function fingerprint(world) {
  const found = new Map(), tree = [];
  world.root.traverse(node => { tree.push([node.type, node.name, node.visible]); for (const material of [node.material].flat().filter(Boolean)) found.set(material.uuid, material); });
  return { tree, materials: [...found.values()].map(material => [material.uuid, material.color?.getHex() ?? null, material.roughness ?? null, material.metalness ?? null, material.opacity, material.map?.uuid ?? null, material.version]) };
}
function context(game, { quality = 'high', files = FILES, asked = [], fetchAsset, renderer } = {}) {
  return { THREE, world: game.world, scene: game.scene, camera: game.camera, quality, document: page,
    renderer: renderer ?? { compiled: [], async compileAsync(object, camera, scene) { this.compiled.push([object, camera, scene]); } },
    fetchAsset: fetchAsset ?? (async path => { asked.push(path); if (!files[path]) throw new Error(`no ${path}`); return files[path]; }) };
}
function quietly() {
  const warn = console.warn, warnings = []; console.warn = (...args) => warnings.push(args.join(' '));
  return { warnings, restore: () => { console.warn = warn; } };
}
// Dispose events of everything the part made.
function watchDisposal(props, textures) {
  const freed = new Set(), all = new Set();
  props?.traverse(node => { if (node.isMesh) for (const resource of [node.geometry, node.material]) { all.add(resource); resource.addEventListener('dispose', () => freed.add(resource)); } });
  for (const texture of textures) { all.add(texture); texture.addEventListener('dispose', () => freed.add(texture)); }
  return { freed, all };
}

test('the pack installs the cabin after the night, before the blood', () => {
  assert.deepEqual(pack.PARTS, parts);
  assert.deepEqual(cabin.DRESS_PRESETS.low.roots, ['Dress_Core', 'Dress_Door_North', 'Dress_Door_South', 'Dress_Door_West', 'Dress_Door_East']);
  // Section 4.6: at most 9, 13 and 16 extra draw calls.
  assert.deepEqual(Object.values(cabin.DRESS_PRESETS).map(preset => [preset.drawCalls, preset.triangles]), [[9, 7600], [13, 12600], [16, 16600]]);
  for (const preset of Object.values(cabin.DRESS_PRESETS)) {
    assert.equal(preset.roots.reduce((sum, root) => sum + cabin.DRESS_ROOTS[root].meshes, 0), preset.drawCalls);
    assert.equal(preset.roots.reduce((sum, root) => sum + cabin.DRESS_ROOTS[root].triangles, 0), preset.triangles);
  }
});

test('each preset gets its roots, within its budget, the surfaces on and the props compiled', async () => {
  for (const quality of ['low', 'medium', 'high']) {
    const game = setup(), before = fingerprint(game.world), ctx = context(game, { quality });
    canvases.length = 0;
    const handle = await cabin.install(ctx);
    try {
    const props = game.world.root.getObjectByName('frissonDressing');
    assert.equal(props, handle.props);
    assert.deepEqual(props.children.map(node => node.name), cabin.DRESS_PRESETS[quality].roots.filter(name => props.getObjectByName(name)), quality);
    assert.deepEqual(handle.dressing.roots, cabin.DRESS_PRESETS[quality].roots, `${quality}: the placeholder has every root`);
    assert.ok(handle.dressing.meshes <= cabin.DRESS_PRESETS[quality].drawCalls && handle.dressing.triangles <= cabin.DRESS_PRESETS[quality].triangles, quality);
    assert.equal(handle.surfaces.length, 32);
    props.traverse(node => { if (node.isMesh) { assert.equal(node.castShadow, false); assert.equal(node.receiveShadow, /_(prop|metal)$/.test(node.name), node.name); assert.match(node.name, /^Dress_(Core|Full|High|Door_(North|South|West|East))_(prop|metal|mark|grime|web)$/); } });
    assert.equal(props.getObjectByName('Dress_Core_grime').renderOrder, -1);
    const grime = props.getObjectByName('Dress_Core_grime').material;
    assert.ok(grime.blending === THREE.MultiplyBlending && grime.premultipliedAlpha && grime.transparent && !grime.depthWrite && !grime.fog && !grime.toneMapped);
    assert.deepEqual(ctx.renderer.compiled.map(([object, camera, scene]) => [object, camera, scene]), [[props, game.camera, game.scene]], 'the dressing compiles before the first wave');
    // Low draws the recipes at half size, on the same grid.
    const sizes = canvases.map(canvas => `${canvas.width}x${canvas.height}`).sort();
    assert.deepEqual(sizes, (quality === 'low' ? ['128x16', '128x128', '128x128', '128x128', '256x256', '256x256', '256x256'] : ['256x256', '256x256', '256x256', '256x32', '512x512', '512x512', '512x512']).sort(), quality);
    assert.ok(canvases.every(canvas => canvas.fills > 0));
    } finally { handle.uninstall(); }
    assert.equal(game.world.dressing, null);
    assert.deepEqual(fingerprint(game.world), before, `${quality}: Famille exactly`);
  }
});

test('missing or broken files: one warning each, the other half stays, and with neither nothing changes', { skip: 'needs the art and audio originals, kept out of the open edition' }, async () => {
  const brokenGlb = writeFrissonGlb([{ name: 'Dress_Attic', children: [] }]);
  const cases = [
    { files: { 'cabin.glb': FILES['cabin.glb'] }, surfaces: false, dressing: true },
    { files: { 'cabin-surfaces.js': FILES['cabin-surfaces.js'] }, surfaces: true, dressing: false },
    { files: { 'cabin-surfaces.js': FILES['cabin-surfaces.js'], 'cabin.glb': brokenGlb.buffer.slice(brokenGlb.byteOffset, brokenGlb.byteOffset + brokenGlb.byteLength) }, surfaces: true, dressing: false },
    { files: { 'cabin-surfaces.js': text('export const CABIN_SURFACES = ;'), 'cabin.glb': FILES['cabin.glb'] }, surfaces: false, dressing: true },
    { files: { 'cabin-surfaces.js': text("import x from '/vendor/three.module.js'; export const CABIN_SURFACES = {};") }, surfaces: false, dressing: false },
    { files: {}, surfaces: false, dressing: false },
  ];
  for (const [index, { files, surfaces, dressing }] of cases.entries()) {
    const game = setup(), before = fingerprint(game.world), quiet = quietly();
    let handle;
    try { handle = await cabin.install(context(game, { files })); } finally { quiet.restore(); }
    assert.equal(quiet.warnings.length, Number(!surfaces) + Number(!dressing), `case ${index}: ${quiet.warnings.join(' | ')}`);
    assert.ok(quiet.warnings.every(warning => warning.startsWith('Frisson cabin: ')));
    assert.equal(Boolean(handle.surfaces), surfaces, `case ${index}`); assert.equal(Boolean(handle.dressing), dressing, `case ${index}`);
    if (!surfaces && !dressing) { assert.equal(game.world.dressing, null, `case ${index}`); assert.deepEqual(fingerprint(game.world), before, `case ${index}`); }
    handle.uninstall();
    assert.deepEqual(fingerprint(game.world), before, `case ${index}: off`);
  }
  // A recipe that breaks the rules leaves its keys in Famille, the rest goes on.
  // The placeholder fixture still has the exact line this case edits; the
  // installed cabin-surfaces.js (a real proposal) does not.
  const recipes = readFileSync(new URL('../art/frisson/placeholder/cabin-surfaces-placeholder.js', import.meta.url), 'utf8').replace("rect(0, 0, width, height, rgb(look.base));", "rect(0, 0, width, height, 'rgba(1,2,3,.5)');");
  const game = setup(), quiet = quietly();
  let handle;
  try { handle = await cabin.install(context(game, { files: { 'cabin-surfaces.js': text(recipes) } })); } finally { quiet.restore(); }
  assert.ok(!handle.surfaces.includes('ground') && !handle.surfaces.includes('clearingEarth') && handle.surfaces.includes('wood'));
  assert.equal(quiet.warnings.filter(warning => /not an opaque/.test(warning)).length, 2, 'one warning per broken texture');
  handle.uninstall();
});

test('without a world that takes a dressing there is nothing to dress and nothing is fetched', async () => {
  const asked = [];
  for (const world of [undefined, {}, { setMood() {} }]) {
    const handle = await cabin.install({ world, fetchAsset: async path => { asked.push(path); return FILES[path]; } });
    assert.equal(handle.surfaces, null); assert.equal(handle.dressing, null); handle.uninstall();
  }
  assert.deepEqual(asked, []);
});

test('called off: before, during either fetch, during the compile, and after; nothing stays on or allocated', async () => {
  // Before: nothing fetched.
  const asked = [];
  await assert.rejects(cabin.install({ ...context(setup(), { asked }), signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.deepEqual(asked, []);
  // During a fetch: the fetch rejects with the reason (as ambiance.js's does), the part frees what it made.
  for (const waitOn of ['cabin-surfaces.js', 'cabin.glb']) {
    const game = setup(), before = fingerprint(game.world), controller = new AbortController(), late = deferred();
    const fetchAsset = path => path === waitOn ? Promise.race([late.promise, new Promise((resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason)))]) : Promise.resolve(FILES[path]);
    const installing = cabin.install({ ...context(game, { fetchAsset }), signal: controller.signal });
    await settle(); await settle();
    controller.abort();
    await assert.rejects(installing, { name: 'AbortError' });
    assert.deepEqual(fingerprint(game.world), before, waitOn);
    assert.equal(game.world.dressing, null, waitOn);
    late.resolve(FILES[waitOn]); await settle();
    assert.equal(game.world.dressing, null, `${waitOn}: the late file installs nothing`);
  }
  // During the compile: it comes off at the call-off itself, and frees once three is done.
  const game = setup(), before = fingerprint(game.world), controller = new AbortController(), compile = deferred();
  const renderer = { compileAsync: () => compile.promise };
  const installing = cabin.install({ ...context(game, { renderer }), signal: controller.signal });
  for (let step = 0; step < 20 && !game.world.dressing; step++) await settle();
  const props = game.world.dressing.props, textures = Object.values(game.world.dressing.surfaces).map(look => look.map).filter(Boolean);
  const { freed, all } = watchDisposal(props, new Set(textures));
  controller.abort();
  await assert.rejects(installing, { name: 'AbortError' });
  assert.equal(game.world.dressing, null); assert.deepEqual(fingerprint(game.world), before);
  assert.equal(freed.size, 0, 'nothing is freed while three still compiles');
  compile.resolve(); await settle(); await settle();
  assert.equal(freed.size, all.size, 'everything is freed once the compile settles');
});

test('uninstall restores Famille and frees every texture, geometry and material it made, once', async () => {
  const game = setup(), before = fingerprint(game.world);
  const handle = await cabin.install(context(game, { quality: 'medium' }));
  const textures = new Set(Object.values(game.world.dressing.surfaces).map(look => look.map).filter(Boolean));
  assert.equal(textures.size, 7);
  const { freed, all } = watchDisposal(handle.props, textures);
  assert.equal(all.size, 7 + handle.dressing.meshes + new Set(handle.props.children.flatMap(node => node.children.map(mesh => mesh.material))).size);
  handle.uninstall(); await settle();
  assert.equal(freed.size, all.size);
  assert.deepEqual(fingerprint(game.world), before);
  handle.uninstall();
  // A dressing another install put on since is not taken off by an old handle.
  const first = await cabin.install(context(game)), second = await cabin.install(context(game));
  first.uninstall();
  assert.equal(game.world.dressing !== null, true, 'the second dressing stays');
  second.uninstall();
  assert.deepEqual(fingerprint(game.world), before);
});

test('the recipes draw through the helpers only: whole cells, opaque colours, wrapped, seeded by name', () => {
  const calls = [], context2d = { fillStyle: '', fillRect(...box) { calls.push([this.fillStyle, ...box]); } };
  const recipe = { size: [64, 32], grid: [16, 8], draw({ rect, random, grid }) { assert.deepEqual(grid, [16, 8]); rect(14, 6, 4, 3, '#102030'); rect(-1, 0, 1, 1, `rgb(${Math.floor(random() * 255)},0,0)`); } };
  cabin.drawRecipe('demo', recipe, context2d);
  assert.deepEqual(calls.slice(0, 4), [['#102030', 56, 24, 8, 8], ['#102030', 56, 0, 8, 4], ['#102030', 0, 24, 8, 8], ['#102030', 0, 0, 8, 4]], 'wrapped into four pieces');
  assert.deepEqual(calls[4].slice(1), [60, 0, 4, 4]);
  const again = []; cabin.drawRecipe('demo', recipe, { fillRect(...box) { again.push([this.fillStyle, ...box]); } });
  assert.deepEqual(again, calls, 'the same name gives the same draw');
  const half = []; cabin.drawRecipe('demo', recipe, { fillRect(...box) { half.push([this.fillStyle, ...box]); } }, { half: true });
  assert.deepEqual(half, calls.map(([style, ...box]) => [style, ...box.map(value => value / 2)]));
  for (const bad of [[.5, 0, 1, 1, '#000000'], [0, 0, 0, 1, '#000000'], [0, 0, 1, 1, 'rgba(0,0,0,.5)'], [0, 0, 1, 1, 'red'], [0, 0, 1, 1, 'rgb(300,0,0)']])
    assert.throws(() => cabin.drawRecipe('bad', { size: [64, 32], grid: [16, 8], draw: ({ rect }) => rect(...bad) }, context2d), /texture bad/, JSON.stringify(bad));
  assert.throws(() => cabin.recipeShape('odd', { size: [60, 32], grid: [16, 8], draw() {} }), /even number of pixels/);
});
