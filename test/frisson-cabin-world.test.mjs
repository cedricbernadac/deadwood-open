// The cabin's world hook (art/frisson/CABIN.md section 4.2): world.setDressing
// restyles world.js's cached materials with uniforms only, hangs the props
// outside the ray blockers, shows a door's channel only while that door is
// not sealed, and null is the exact Famille restore.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWorld, DRESSING_SURFACE_KEYS, DRESSING_OBJECT_KEYS, DRESSING_DOOR_CHANNELS } = await importPublicModule('world.js');

const canvasDocument = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
function setup(options) {
  const old = globalThis.document; globalThis.document = canvasDocument;
  try { const scene = new THREE.Scene(), world = createWorld(scene, options); return { scene, world }; }
  finally { globalThis.document = old; }
}
// Every material the world draws with (the module cache included), by uuid:
// colour, roughness, metalness, opacity, map, version; and the tree.
function materials(world) {
  const found = new Map();
  world.root.traverse(node => { for (const material of [node.material].flat().filter(Boolean)) found.set(material.uuid, material); });
  return [...found.values()];
}
function fingerprint(world, { maps = 'uuid' } = {}) {
  const rows = materials(world).map(material => [material.uuid, material.type, material.color?.toArray() ?? null, material.roughness ?? null, material.metalness ?? null,
    material.opacity, material.transparent, maps === 'uuid' ? material.map?.uuid ?? null : material.map?.image ?? null, material.version]);
  const tree = [];
  const visit = node => { tree.push([node.type, node.name, node.visible, node.children.length]); node.children.forEach(visit); };
  visit(world.root);
  return { rows, tree, blockers: world.rayBlockers.map(mesh => mesh.uuid) };
}
function texture(name = 'test') { const map = new THREE.Texture(); map.name = name; return map; }
// A dressing over every key, with maps where Famille has them.
function fullDressing({ props = null } = {}) {
  const surfaces = {};
  DRESSING_SURFACE_KEYS.forEach((key, index) => { surfaces[key] = { color: 0x101010 + index, roughness: .5, metalness: .25, opacity: .3, map: texture(key) }; });
  return { surfaces, objects: { decorFlowerHeads: { visible: false }, decorFlowerStems: { visible: false }, decorGlowingCaps: { color: 0x2b3a33 } }, props };
}
function dressingProps() {
  const props = new THREE.Group();
  for (const name of ['Dress_Core', ...Object.values(DRESSING_DOOR_CHANNELS)]) { const node = new THREE.Group(); node.name = name; node.add(new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1), new THREE.MeshBasicMaterial())); props.add(node); }
  return props;
}
function quietly(run) {
  const warn = console.warn, warnings = []; console.warn = message => warnings.push(String(message));
  try { return { value: run(), warnings }; } finally { console.warn = warn; }
}
// The cached material behind a key, found by a probe dressing that marks it.
function keyed(world) {
  const surfaces = Object.fromEntries(DRESSING_SURFACE_KEYS.map((key, index) => [key, { color: 0x010000 + index }]));
  world.setDressing({ surfaces });
  const byKey = {};
  for (const material of materials(world)) {
    const hex = material.color?.getHex();
    if (hex >= 0x010000 && hex < 0x010000 + DRESSING_SURFACE_KEYS.length) byKey[DRESSING_SURFACE_KEYS[hex - 0x010000]] = material;
  }
  world.setDressing(null);
  return byKey;
}

test('the hook lists exactly the keys of section 1 and the three decor objects', () => {
  const { world } = setup();
  assert.equal(world.surfaceKeys, DRESSING_SURFACE_KEYS); assert.ok(Object.isFrozen(world.surfaceKeys) && Object.isFrozen(world.objectKeys));
  assert.equal(DRESSING_SURFACE_KEYS.length, 32);
  assert.deepEqual([...world.objectKeys], ['decorFlowerHeads', 'decorFlowerStems', 'decorGlowingCaps']);
  // Every key is a material the cabin draws with; nothing of gameplay is one.
  const byKey = keyed(world);
  assert.deepEqual(Object.keys(byKey).sort(), [...DRESSING_SURFACE_KEYS].sort());
  for (const key of ['glow', 'boardedGlow', 'supplyCrateTimber', 'pickupMetal', 'culvertDark', 'fallenSpawnTwigs', 'gun', 'humanSkin']) assert.equal(DRESSING_SURFACE_KEYS.includes(key), false, key);
  for (const name of DRESSING_OBJECT_KEYS) assert.ok(world.root.getObjectByName(name), name);
});

test('null is the exact Famille restore, and nothing recompiles on or off', () => {
  for (const options of [undefined, { quality: { id: 'low', shadows: false, fireflies: 40, groundDetail: .35, rainFraction: .5 } }]) {
    const { world } = setup(options), before = fingerprint(world), tracked = materials(world), versionsBefore = tracked.map(material => material.version);
    const dressing = fullDressing({ props: dressingProps() });
    assert.equal(quietly(() => world.setDressing(dressing)).value, true);
    assert.equal(world.dressing, dressing);
    assert.notDeepEqual(fingerprint(world).rows, before.rows, 'the dressing shows');
    assert.deepEqual(tracked.map(material => material.version), versionsBefore, 'no material version changes on');
    assert.equal(world.setDressing(null), false);
    assert.equal(world.dressing, null);
    assert.deepEqual(fingerprint(world), before, 'every colour, value, map, visibility and the tree back');
    assert.deepEqual(tracked.map(material => material.version), versionsBefore, 'no material version changes off');
  }
});

test('uniforms only: maps where Famille has one (clones with its repeats), opacity where transparent', () => {
  const { world } = setup(), byKey = keyed(world), given = fullDressing();
  const famille = Object.fromEntries(Object.entries(byKey).map(([key, material]) => [key, { map: material.map, opacity: material.opacity, transparent: material.transparent }]));
  const { warnings } = quietly(() => world.setDressing(given));
  for (const [key, material] of Object.entries(byKey)) {
    const before = famille[key];
    assert.equal(material.color.getHex(), given.surfaces[key].color, key);
    assert.equal(material.roughness, .5, key); assert.equal(material.metalness, .25, key);
    assert.equal(material.opacity, before.transparent ? .3 : before.opacity, `${key}: opacity only where transparent`);
    assert.equal(material.transparent, before.transparent, key);
    if (!before.map) { assert.equal(material.map, null, `${key}: no map added`); continue; }
    assert.notEqual(material.map, given.surfaces[key].map, `${key}: a clone, not the caller's texture`);
    assert.equal(material.map.source, given.surfaces[key].map.source, `${key}: the caller's image`);
    for (const property of ['wrapS', 'wrapT', 'anisotropy', 'colorSpace', 'channel']) assert.equal(material.map[property], before.map[property], `${key}.${property}`);
    assert.deepEqual(material.map.repeat.toArray(), before.map.repeat.toArray(), `${key}: repeat`);
    assert.deepEqual(material.map.offset.toArray(), before.map.offset.toArray(), `${key}: offset`);
  }
  // The grass keeps its 74 x 36 repeat; the caller's texture is untouched.
  assert.deepEqual(byKey.ground.map.repeat.toArray(), [74, 36]); assert.deepEqual(given.surfaces.ground.map.repeat.toArray(), [1, 1]);
  assert.equal(byKey.wood.map.image, given.surfaces.wood.map.image);
  // Opacity on an opaque key and a map on a key without one are refused, one warning each.
  const refused = warnings.filter(text => /opacity|\.map/.test(text));
  assert.equal(refused.length, DRESSING_SURFACE_KEYS.filter(key => !famille[key].transparent).length + DRESSING_SURFACE_KEYS.filter(key => !famille[key].map).length);
  // The clones are freed when the dressing comes off; the caller's textures are not.
  const freed = new Set();
  for (const [key, material] of Object.entries(byKey)) if (material.map !== famille[key].map) material.map.addEventListener('dispose', () => freed.add(key));
  const kept = new Set();
  for (const look of Object.values(given.surfaces)) look.map.addEventListener('dispose', () => kept.add(look.map));
  world.setDressing(null);
  assert.deepEqual([...freed].sort(), Object.keys(byKey).filter(key => famille[key].map).sort());
  assert.equal(kept.size, 0);
  for (const [key, material] of Object.entries(byKey)) assert.equal(material.map, famille[key].map, key);
});

test('apply, null, apply: the same look each time; a second call replaces the first', () => {
  const { world } = setup(), before = fingerprint(world, { maps: 'image' });
  const dressing = fullDressing({ props: dressingProps() });
  quietly(() => world.setDressing(dressing));
  const first = fingerprint(world, { maps: 'image' });
  world.setDressing(null); quietly(() => world.setDressing(dressing));
  assert.deepEqual(fingerprint(world, { maps: 'image' }), first);
  // Another dressing on top: restore, then apply (nothing compounds).
  const other = { surfaces: { trim: { color: 0x112233 } } };
  world.setDressing(other);
  assert.equal(world.root.getObjectByName('frissonDressing'), undefined, 'the first props came off');
  const byKey = keyed(world);
  world.setDressing(other);
  assert.equal(byKey.trim.color.getHex(), 0x112233);
  assert.equal(byKey.wood.color.getHex(), new THREE.Color(0xbea690).getHex(), 'wood is Famille again');
  world.setDressing(null);
  assert.deepEqual(fingerprint(world, { maps: 'image' }), before);
});

test('unknown keys are ignored with one warning each', () => {
  const { world } = setup(), byKey = keyed(world), before = fingerprint(world);
  const { warnings, value } = quietly(() => world.setDressing({
    surfaces: { nope: { color: 0xff0000 }, glow: { color: 0 }, wood: { color: 0x123456, emissive: 0xffffff, roughness: 2 } },
    objects: { decorGrassTufts: { visible: false }, decorFlowerHeads: { visible: false, scale: 2 } },
    props: 'not an object',
  }));
  assert.equal(value, true);
  assert.deepEqual(warnings.map(text => text.replace(/^world\.setDressing: | is not part.*$/g, '')).sort(),
    ['object decorFlowerHeads.scale', 'object decorGrassTufts', 'props', 'surface glow', 'surface nope', 'surface wood.emissive', 'surface wood.roughness'].sort());
  assert.equal(byKey.wood.color.getHex(), 0x123456);
  assert.equal(world.root.getObjectByName('decorGrassTufts').visible, true);
  assert.equal(world.root.getObjectByName('decorFlowerHeads').visible, false);
  world.setDressing(null);
  assert.deepEqual(fingerprint(world), before);
});

test('door channels show exactly while their door is not sealed, at once and on every setDoor', () => {
  const { world } = setup();
  world.setDoor('south', 1, null, true);
  const props = dressingProps();
  world.setDressing({ props });
  const channel = id => props.getObjectByName(DRESSING_DOOR_CHANNELS[id]);
  assert.deepEqual(['north', 'south', 'west', 'east'].map(id => channel(id).visible), [true, false, true, true], 'at once');
  world.setDoor('north', .4, [1, 1, 0, 0, 0], true); assert.equal(channel('north').visible, false);
  world.setDoor('north', 1, null, false); assert.equal(channel('north').visible, true);
  world.setDoor('south', 1, null, false); assert.equal(channel('south').visible, true);
  world.setDoor('west', 0, null); assert.equal(channel('west').visible, true, 'a broken door is not sealed');
  assert.equal(props.getObjectByName('Dress_Core').visible, true, 'the other roots never follow a door');
  // Off: setDoor no longer touches the caller's props.
  world.setDressing(null);
  world.setDoor('east', 1, null, true); assert.equal(channel('east').visible, true);
});

test('props hang under the root as frissonDressing: never a ray blocker, never merged, no matrix updates', () => {
  const { world } = setup(), blockers = [...world.rayBlockers], props = dressingProps();
  world.setDressing({ props });
  assert.equal(props.parent, world.root); assert.equal(props.name, 'frissonDressing'); assert.equal(props.matrixAutoUpdate, false);
  assert.deepEqual(world.rayBlockers, blockers, 'the ray blockers (shots, sight) are the same objects');
  props.traverse(node => assert.equal(world.rayBlockers.includes(node), false));
  assert.equal(world.root.children.filter(child => child.userData.staticMerge).some(mesh => props.children.includes(mesh)), false);
  world.setDressing(null);
  assert.equal(props.parent, null); assert.deepEqual(world.rayBlockers, blockers);
});

test('one dressing per page: a call on another world takes the first one off', () => {
  const a = setup(), b = setup(), beforeA = fingerprint(a.world, { maps: 'image' }), propsA = dressingProps(), propsB = dressingProps();
  quietly(() => a.world.setDressing({ ...fullDressing(), props: propsA }));
  b.world.setDressing({ surfaces: { trim: { color: 0x445566 } }, props: propsB });
  assert.equal(a.world.dressing, null); assert.equal(propsA.parent, null);
  assert.equal(propsB.parent, b.world.root);
  // The shared cache now carries B's dressing only.
  const trim = keyed(b.world).trim;
  b.world.setDressing({ surfaces: { trim: { color: 0x445566 } } });
  assert.equal(trim.color.getHex(), 0x445566);
  b.world.setDressing(null);
  assert.deepEqual(fingerprint(a.world, { maps: 'image' }), beforeA, 'world A is Famille again');
});
