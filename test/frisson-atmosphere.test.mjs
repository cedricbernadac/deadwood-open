import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { GENERATOR } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWorld } = await importPublicModule('world.js');
const { install, GRIM_NIGHT, circuitFlicker } = await importPublicModule('frisson/atmosphere.js');
const css = readFileSync(new URL('../public/frisson/frisson.css', import.meta.url), 'utf8');
const atmosphereSource = readFileSync(new URL('../public/frisson/atmosphere.js', import.meta.url), 'utf8');

const canvasDocument = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
function setup(options) {
  const old = globalThis.document; globalThis.document = canvasDocument;
  try { const scene = new THREE.Scene(), world = createWorld(scene, options); return { scene, world, camera: new THREE.PerspectiveCamera() }; }
  finally { globalThis.document = old; }
}
const player = { id: 'me', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: true, downed: false, umbrella: { open: false, remaining: 100, max: 100 } };
const snapshot = (wave = 1, power = 1) => ({ wave, players: [player], spawnWarnings: [], expedition: { enabled: true, generator: { ...GENERATOR, power, active: false }, fuel: null } });
const STEPS = [[0, null], [1.25, snapshot(1, 1)], [7.5, snapshot(10, .6)], [33.3, snapshot(20, .2)], [60.1, snapshot(5, 1)]];
const MOOD = { ambient: .5, moon: .7, fill: .4, lamps: .8, windowGlow: .6, sky: .5, fireflies: 0, fogColor: 0x2e423b, exposure: .9,
  colors: { ambientSky: 0x8aa3bd, ambientGround: 0x4a4c43, moon: 0xa4c8e2, fill: 0x768c7d, lamps: 0xffbf82 } };
// The game hands its renderer to prewarm (client.js); zombies need the canvas stub.
function prewarm({ world, camera }, renderer) {
  const old = globalThis.document; globalThis.document = canvasDocument;
  try { return world.prewarm(renderer, camera); } finally { globalThis.document = old; }
}

// Every light, material colour, emissive and opacity, the sky and firefly
// buffers, fog and exposure. The fx engine is a module singleton that moves
// to the newest world's scene, so it is left out.
function fingerprint(scene, renderer = { toneMappingExposure: 1.3 }) {
  const rows = [], color = c => c ? c.toArray() : null;
  const visit = node => {
    if (node.name === 'fx') return;
    const row = [node.type, node.name, node.visible];
    if (node.isLight) row.push(node.intensity, color(node.color), color(node.groundColor), node.distance ?? null);
    for (const material of [node.material].flat().filter(Boolean)) row.push(color(material.color), color(material.emissive), material.emissiveIntensity ?? null, material.opacity);
    if (node.geometry?.attributes?.color && (node.isPoints || node.name === 'skyDome')) row.push(Array.from(node.geometry.attributes.color.array));
    if (node.name === 'fireflies') row.push(Array.from(node.geometry.attributes.position.array));
    rows.push(row); node.children.forEach(visit);
  };
  visit(scene);
  rows.push([scene.fog.density, color(scene.fog.color), color(scene.background), renderer.toneMappingExposure]);
  return rows;
}

// A tiny DOM: enough for install() and for proving nothing is left behind.
function stubDocument({ reducedMotion = false } = {}) {
  const make = tag => {
    const classes = new Set(), props = new Map();
    return {
      tagName: tag.toUpperCase(), id: '', className: '', children: [], parentNode: null, attributes: {},
      style: { setProperty: (name, value) => props.set(name, String(value)), getPropertyValue: name => props.get(name) ?? '', props },
      classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name), values: () => [...classes].sort() },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      appendChild(child) { child.parentNode?.removeChild(child); this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; },
      remove() { this.parentNode?.removeChild(this); },
    };
  };
  const documentElement = make('html'), head = make('head'), body = make('body');
  documentElement.appendChild(head); documentElement.appendChild(body);
  for (const [tag, id, className] of [['link', '', ''], ['canvas', 'game', ''], ['div', '', 'grain'], ['div', 'vignette', ''], ['div', 'damage-flash', ''], ['div', 'hud', '']]) {
    const node = make(tag); node.id = id; node.className = className; (tag === 'link' ? head : body).appendChild(node);
  }
  const all = node => [node, ...node.children.flatMap(all)];
  const defaultView = { matchMedia: query => ({ matches: reducedMotion && query === '(prefers-reduced-motion: reduce)' }) };
  return { documentElement, head, body, defaultView, createElement: make, getElementById: id => all(documentElement).find(node => node.id === id) ?? null };
}
const domTree = node => ({ tag: node.tagName, id: node.id, className: node.className, classes: node.classList.values(), attributes: { ...node.attributes }, style: [...node.style.props], children: node.children.map(domTree) });

test('with no mood, or after setMood(null), update() gives exactly the Famille values', () => {
  for (const options of [undefined, { quality: { id: 'low', shadows: false, fireflies: 40, groundDetail: .35, rainFraction: .5 } }]) {
    const famille = setup(options), mooded = setup(options);
    const renderer = { toneMappingExposure: 1.3 };
    for (const [index, [time, state]] of STEPS.entries()) {
      mooded.world.setMood(MOOD, { renderer });
      if (index % 2) mooded.world.update(time, { snapshot: state, myId: 'me', active: true, camera: mooded.camera });
      mooded.world.setMood(null);
      famille.world.update(time, { snapshot: state, myId: 'me', active: true, camera: famille.camera });
      const expected = fingerprint(famille.scene);
      mooded.world.update(time, { snapshot: state, myId: 'me', active: true, camera: mooded.camera });
      assert.deepEqual(fingerprint(mooded.scene, renderer), expected, `step ${index}`);
    }
  }
  // Today's formulas, to the last bit, at wave 20 with the generator at its minimum.
  const { world } = setup(), { ambient, moon, fill, lamps } = world.atmosphere;
  world.update(33.3, { snapshot: snapshot(20, .2), myId: 'me', active: true });
  assert.equal(ambient.intensity, 1.15 * (1 - .5)); assert.equal(moon.intensity, 2.4 * (1 - .5)); assert.equal(fill.intensity, .5 * (1 - .35));
  lamps.forEach((lamp, i) => assert.equal(lamp.light.intensity, lamp.intensity * .2 * (.96 + .025 * Math.sin(33.3 * 5.7 + i * 2) + .015 * Math.sin(33.3 * 13.1 + i))));
});

test('the Famille night is pinned: sky gradient, tree lines, moon, fog and light colours as before setMood existed', () => {
  const { scene, world } = setup(), { ambient, moon, fill, lamps, sky, fireflies } = world.atmosphere;
  // The sky dome's gradient, recomputed with the pre-Frisson loop and colours.
  const dome = sky.getObjectByName('skyDome'), position = dome.geometry.attributes.position, color = new THREE.Color(), next = new THREE.Color(), colors = [];
  const stops = [[-1, 0x1b3640], [-.02, 0x284c58], [.04, 0x284c58], [.16, 0x203761], [.42, 0x131b45], [1, 0x080c27]];
  for (let index = 0; index < position.count; index++) {
    const y = position.getY(index) / 112;
    let stop = 0; while (stop < stops.length - 2 && y > stops[stop + 1][0]) stop++;
    const [from, low] = stops[stop], [to, high] = stops[stop + 1], t = THREE.MathUtils.clamp((y - from) / (to - from), 0, 1);
    color.setHex(low).lerp(next.setHex(high), t * t * (3 - 2 * t)); colors.push(color.r, color.g, color.b);
  }
  assert.deepEqual(Array.from(dome.geometry.attributes.color.array), Array.from(new Float32Array(colors)));
  const hex = name => sky.getObjectByName(name).material.color.getHex();
  assert.deepEqual(['farTreeline', 'nearTreeline', 'stars', 'moon', 'moonHalo'].map(hex), [0x1d3a47, 0x132a35, 0xffffff, 0xf4efd6, 0x9cbcf0]);
  assert.equal(sky.getObjectByName('moonHalo').material.opacity, .42);
  assert.ok(scene.fog.isFogExp2); assert.equal(scene.fog.density, .017); assert.equal(scene.fog.color.getHex(), 0x284c58); assert.equal(scene.background.getHex(), 0x284c58);
  assert.deepEqual([ambient.color, ambient.groundColor, moon.color, fill.color].map(c => c.getHex()), [0x8aa6d6, 0x5a4a3a, 0xa9c6f0, 0x8c7fc4]);
  assert.ok(lamps.length === 9 && lamps.every(lamp => lamp.light.color.getHex() === 0xffc48c));
  assert.equal(fireflies.visible, true); assert.equal(fireflies.material.opacity, 1);
});

test('setMood multiplies what update() computes, at once and every frame, without compounding', () => {
  const { scene, world } = setup(), { ambient, moon, fill, lamps, fireflies } = world.atmosphere;
  const halo = world.root.getObjectByName('lampHalo').material;
  let glow; world.root.traverse(node => { for (const material of [node.material].flat()) if (material?.emissive?.getHex() === 0xffa04a) glow = material; });
  const base = () => ({ ambient: ambient.intensity, moon: moon.intensity, fill: fill.intensity, halo: halo.opacity, glow: glow.emissiveIntensity, lamps: lamps.map(lamp => lamp.light.intensity) });
  const check = (before, label) => {
    assert.equal(ambient.intensity, before.ambient * MOOD.ambient, label); assert.equal(moon.intensity, before.moon * MOOD.moon, label);
    assert.equal(fill.intensity, before.fill * MOOD.fill, label); assert.equal(halo.opacity, before.halo * MOOD.lamps, label);
    assert.equal(glow.emissiveIntensity, before.glow * MOOD.windowGlow, label);
    lamps.forEach((lamp, i) => assert.equal(lamp.light.intensity, before.lamps[i] * MOOD.lamps, label));
  };
  world.update(7.5, { snapshot: snapshot(10, .6), myId: 'me', active: true });
  const famille = base();
  world.setMood(MOOD); check(famille, 'applied at once');
  world.setMood(MOOD); world.setMood({ ...MOOD }); check(famille, 'a repeated mood does not compound');
  world.update(7.5, { snapshot: snapshot(10, .6), myId: 'me', active: true }); check(famille, 'update() re-applies it');
  // A later frame with another wave and power: the multipliers follow update()'s new values.
  const later = setup().world; later.update(33.3, { snapshot: snapshot(20, .2), myId: 'me', active: true });
  const { atmosphere: { ambient: a, moon: m, fill: f, lamps: l } } = later;
  world.update(33.3, { snapshot: snapshot(20, .2), myId: 'me', active: true });
  check({ ambient: a.intensity, moon: m.intensity, fill: f.intensity, halo: later.root.getObjectByName('lampHalo').material.opacity, glow: .42 * .2, lamps: l.map(lamp => lamp.light.intensity) }, 'a new frame');
  world.update(7.5, { snapshot: snapshot(10, .6), myId: 'me', active: true });
  world.setMood(null); assert.deepEqual(base(), famille, 'null restores update() values before the next frame');
  // Fog density is gameplay; unknown keys and bad values change nothing.
  world.setMood({ fogDensity: 4, ambient: -1, moon: NaN, fill: 'dark', lamps: Infinity, fogColor: 0x1000000, exposure: 0 });
  assert.equal(scene.fog.density, .017); assert.deepEqual(base(), famille);
  assert.equal(scene.fog.color.getHex(), 0x284c58);
  // No fireflies: hidden and no longer updated (positions stay put).
  world.setMood(MOOD);
  const positions = Array.from(fireflies.geometry.attributes.position.array);
  world.update(20, { snapshot: snapshot(), myId: 'me', active: true });
  assert.equal(fireflies.visible, false); assert.deepEqual(Array.from(fireflies.geometry.attributes.position.array), positions);
  world.setMood({ fireflies: .5 }); assert.equal(fireflies.visible, true); assert.equal(fireflies.material.opacity, .5);
  world.setMood(null); assert.equal(fireflies.material.opacity, 1); assert.equal(scene.fog.density, .017);
  // The teammates' flashlight cones dim with `beams` and restore exactly.
  const beams = [0, 1, 2].map(index => scene.getObjectByName(`teammateBeam-${index}`).material);
  assert.ok(beams.every(material => material.opacity === .035));
  world.setMood({ beams: .5 }); assert.ok(beams.every(material => material.opacity === .035 * .5));
  world.setMood({ beams: 2 }); assert.ok(beams.every(material => material.opacity === .035 * 2));
  world.setMood({ beams: 'dim' }); assert.ok(beams.every(material => material.opacity === .035), 'a bad value changes nothing');
  world.setMood(null); assert.ok(beams.every(material => material.opacity === .035));
});

test('the exposure multiplier uses the renderer passed once and is restored exactly by null', () => {
  const { world } = setup(), renderer = { toneMappingExposure: 1.3 };
  world.setMood({ exposure: .9 }); assert.equal(renderer.toneMappingExposure, 1.3, 'no renderer known yet');
  world.setMood({ exposure: .9 }, { renderer }); assert.equal(renderer.toneMappingExposure, 1.3 * .9);
  world.setMood({ exposure: .5 }); assert.equal(renderer.toneMappingExposure, 1.3 * .5, 'from the base, not compounded');
  world.setMood({ ambient: .5 }); assert.equal(renderer.toneMappingExposure, 1.3);
  world.setMood(null); assert.equal(renderer.toneMappingExposure, 1.3);
  world.setMood({ exposure: .8 }); assert.equal(renderer.toneMappingExposure, 1.3 * .8, 'the renderer is remembered');
  const other = { toneMappingExposure: 1.1 };
  world.setMood({ exposure: .8 }, { renderer: other });
  assert.equal(renderer.toneMappingExposure, 1.3, 'switching renderers restores the first'); assert.equal(other.toneMappingExposure, 1.1 * .8);
  world.setMood(null); assert.equal(other.toneMappingExposure, 1.1);
});

test('the fog colour also recolours the background and the sky horizon, seamlessly, and comes back exactly', () => {
  const { scene, world } = setup(), { sky } = world.atmosphere;
  const dome = sky.getObjectByName('skyDome'), colors = dome.geometry.attributes.color, position = dome.geometry.attributes.position;
  const parts = ['farTreeline', 'nearTreeline', 'stars', 'moon'].map(name => sky.getObjectByName(name).material), halo = sky.getObjectByName('moonHalo').material;
  const original = { dome: Array.from(colors.array), parts: parts.map(material => material.color.toArray()), halo: halo.opacity, background: scene.background.toArray(), fog: scene.fog.color.toArray() };
  const version = colors.version;
  world.setMood({ fogColor: 0x2e423b, sky: .5 });
  const fog = new THREE.Color(0x2e423b);
  assert.deepEqual(scene.fog.color.toArray(), fog.toArray()); assert.deepEqual(scene.background.toArray(), fog.toArray());
  let horizon = 0;
  for (let index = 0; index < position.count; index++) {
    const y = position.getY(index) / 112;
    if (y < -.02 || y > .04) continue;
    horizon++;
    assert.deepEqual(Array.from(colors.array.subarray(index * 3, index * 3 + 3)), fog.toArray().map(Math.fround));
  }
  assert.ok(horizon > 30, 'the horizon band holds vertices');
  assert.ok(colors.version > version, 'the GPU copy is refreshed');
  assert.ok(colors.array[2] < original.dome[2] && colors.array[1] < original.dome[1], 'the zenith is darker');
  assert.ok(Math.abs(halo.opacity - original.halo * .5) < 1e-12);
  assert.ok(parts[2].color.r === .5 && parts[3].color.g < original.parts[3][1]);
  // Tree lines get the fog/horizon filter (no darkening of their own): they keep their contrast with the fog.
  const Famille = new THREE.Color(0x284c58);
  for (const [index, channel] of ['r', 'g', 'b'].entries()) assert.equal(parts[0].color[channel], original.parts[0][index] * Math.min(3, fog[channel] / Famille[channel]));
  const updates = colors.version; world.setMood({ fogColor: 0x2e423b, sky: .5, lamps: .7 });
  assert.equal(colors.version, updates, 'an unchanged sky is not repainted every frame');
  world.setMood(null);
  assert.deepEqual(Array.from(colors.array), original.dome); assert.deepEqual(parts.map(material => material.color.toArray()), original.parts);
  assert.equal(halo.opacity, original.halo); assert.deepEqual(scene.background.toArray(), original.background); assert.deepEqual(scene.fog.color.toArray(), original.fog);
});

test('mood.colors recolours the lights, only when a colour changes, and null brings back the originals exactly', () => {
  const { world } = setup(), { ambient, moon, fill, lamps } = world.atmosphere, { colors: wanted } = MOOD;
  const colors = () => [ambient.color, ambient.groundColor, moon.color, fill.color, ...lamps.map(lamp => lamp.light.color)].map(color => color.toArray());
  const famille = colors(), withoutMoon = list => list.filter((_, index) => index !== 2);
  world.setMood(MOOD);
  assert.deepEqual([ambient.color, ambient.groundColor, moon.color, fill.color].map(color => color.getHex()), [wanted.ambientSky, wanted.ambientGround, wanted.moon, wanted.fill]);
  assert.ok(lamps.length === 9 && lamps.every(lamp => lamp.light.color.getHex() === wanted.lamps));
  world.setMood({ ...MOOD, colors: { moon: wanted.moon } });
  assert.equal(moon.color.getHex(), wanted.moon); assert.deepEqual(withoutMoon(colors()), withoutMoon(famille), 'colours left out come back');
  world.setMood({ ...MOOD, colors: { moon: -1, fill: 0x1000000, lamps: 1.5, ambientSky: '0x8aa3bd' } });
  assert.deepEqual(colors(), famille, 'bad values change nothing');
  // Same colours on the next frame: not rewritten (a stray write survives until null).
  world.setMood(MOOD); moon.color.setHex(0x123456); world.setMood(MOOD); assert.equal(moon.color.getHex(), 0x123456);
  world.setMood(null); assert.deepEqual(colors(), famille);
});

test('the circuit flicker is bounded, deterministic, smooth and never strobes', () => {
  const { breathe, depth, slot, gap } = GRIM_NIGHT.flicker, floor = 1 - breathe - depth[1];
  let fullPower = 0;
  assert.equal(circuitFlicker(NaN), 1); assert.equal(circuitFlicker(undefined), 1);
  for (const power of [1, .6, GENERATOR.minPower]) {
    let previous = circuitFlicker(0, power), dips = [], inDip = false, slots = new Map();
    for (let step = 1; step <= 600 * 120; step++) {
      const time = step / 120, value = circuitFlicker(time, power);
      assert.ok(value >= floor - 1e-12 && value <= 1, `bounded at ${time}`);
      assert.equal(circuitFlicker(time, power), value, 'a pure function of time');
      assert.ok(Math.abs(value - previous) < .03, `no jump at ${time}`); // 1/120 s apart: under .06 per 60 Hz frame
      previous = value;
      const sagging = value < 1 - breathe - .015;
      if (sagging && !inDip) { dips.push(time); const at = Math.floor(time / slot); slots.set(at, (slots.get(at) ?? 0) + 1); }
      inDip = sagging;
    }
    assert.ok(dips.length > 20, `sags happen (${dips.length} at power ${power})`);
    for (let i = 1; i < dips.length; i++) assert.ok(dips[i] - dips[i - 1] >= gap, 'at least a second of steady light between sags');
    assert.ok([...slots.values()].every(count => count === 1), 'one sag per slot at most');
    if (power === 1) fullPower = dips.length; else if (power === GENERATOR.minPower) assert.ok(dips.length > fullPower * 1.6, 'a failing generator sputters more');
  }
  for (let step = 0; step < 600 * 30; step++) assert.ok(circuitFlicker(step / 30, 1, true) >= 1 - breathe, 'reduced motion: the breath only');
});

test('install darkens the night and uninstall leaves the world, the renderer and the page exactly as before', async () => {
  for (const quality of ['high', 'medium', 'low']) {
    const { scene, world } = setup(), famille = setup(), renderer = { toneMappingExposure: 1.3 }, hooks = { impact: null, death: null, frame: null, hurt: null };
    const doc = stubDocument(), before = domTree(doc.documentElement);
    const { ambient, moon, fill, lamps, fireflies } = world.atmosphere;
    const colors = () => [ambient.color, ambient.groundColor, moon.color, fill.color, ...lamps.map(lamp => lamp.light.color)].map(color => color.toArray());
    const lightColors = colors();
    const update = (target, time = 7.5) => target.world.update(time, { snapshot: snapshot(10, .6), myId: 'me', active: true, camera: target.camera });
    update({ world }); update(famille);
    const handle = await install({ world, renderer, hooks, document: doc, quality, base: '/frisson/' });
    assert.equal(renderer.toneMappingExposure, 1.3 * GRIM_NIGHT.mood.exposure);
    assert.equal(ambient.intensity, famille.world.atmosphere.ambient.intensity * GRIM_NIGHT.mood.ambient);
    assert.equal(fireflies.visible, false); assert.equal(scene.fog.color.getHex(), GRIM_NIGHT.mood.fogColor); assert.equal(scene.fog.density, .017);
    assert.equal(moon.color.getHex(), GRIM_NIGHT.mood.colors.moon); assert.equal(lamps[0].light.color.getHex(), GRIM_NIGHT.mood.colors.lamps);
    assert.equal(typeof hooks.frame, 'function'); assert.equal(typeof hooks.hurt, 'function');
    const link = doc.getElementById('frisson-css');
    assert.equal(link.parentNode, doc.head); assert.equal(link.rel, 'stylesheet'); assert.equal(link.href, '/frisson/frisson.css');
    for (const id of ['frisson-vignette', 'frisson-grain']) { assert.equal(doc.getElementById(id).parentNode, doc.body); assert.equal(doc.getElementById(id).attributes['aria-hidden'], 'true'); }
    assert.equal(doc.documentElement.classList.contains('frisson-desaturate'), quality === 'high');
    handle.uninstall(); handle.uninstall();
    assert.deepEqual(domTree(doc.documentElement), before, 'no element, class or style left');
    assert.deepEqual(colors(), lightColors); assert.equal(renderer.toneMappingExposure, 1.3);
    assert.deepEqual(hooks, { impact: null, death: null, frame: null, hurt: null });
    update({ world }, 9); update(famille, 9);
    assert.deepEqual(fingerprint(scene, renderer), fingerprint(famille.scene));
  }
  // No document (a lookdev page or a test): the lights still change, nothing throws.
  const { world } = setup(), handle = await install({ world });
  assert.equal(world.atmosphere.fireflies.visible, false); handle.uninstall(); assert.equal(world.atmosphere.fireflies.visible, true);
});

test('the contract alone gives the whole grim night: setMood(GRIM_NIGHT.mood) on a prewarmed world equals install()', async () => {
  const contract = setup(), part = setup(), famille = setup();
  const [mine, theirs, plain] = [contract, part, famille].map(target => { const renderer = { toneMappingExposure: 1.3, compile() {} }; prewarm(target, renderer); return renderer; });
  const update = target => target.world.update(7.5, { snapshot: snapshot(10, .6), myId: 'me', active: true, camera: target.camera });
  contract.world.setMood(GRIM_NIGHT.mood); // DESIGN.md's call: no renderer, no install
  const handle = await install({ world: part.world, renderer: theirs });
  update(contract); update(part); update(famille);
  assert.equal(mine.toneMappingExposure, 1.3 * GRIM_NIGHT.mood.exposure, 'the exposure acts on the prewarmed renderer');
  assert.equal(contract.world.atmosphere.moon.color.getHex(), GRIM_NIGHT.mood.colors.moon, 'the colder colours come with the mood');
  assert.deepEqual(fingerprint(contract.scene, mine), fingerprint(part.scene, theirs));
  contract.world.setMood(null); handle.uninstall(); update(contract); update(part);
  assert.deepEqual(fingerprint(contract.scene, mine), fingerprint(famille.scene, plain));
  assert.deepEqual(fingerprint(part.scene, theirs), fingerprint(famille.scene, plain));
});

test('the frame hook flickers the lamp circuit whichever side of world.update it runs', async () => {
  const { world } = setup(), hooks = {}, { lamps } = world.atmosphere, state = snapshot(1, 1);
  let sag = 0; while (circuitFlicker(sag) > .85) sag += .01;
  const level = Math.round(circuitFlicker(sag) * 500) / 500;
  world.update(sag, { snapshot: state, myId: 'me', active: true });
  const famille = lamps.map(lamp => lamp.light.intensity);
  const handle = await install({ world, hooks });
  const expected = famille.map(value => value * (GRIM_NIGHT.mood.lamps * level));
  hooks.frame({ time: sag, snapshot: state }); world.update(sag, { snapshot: state, myId: 'me', active: true });
  assert.deepEqual(lamps.map(lamp => lamp.light.intensity), expected, 'hook before update');
  hooks.frame({ time: 0, snapshot: state }); world.update(sag, { snapshot: state, myId: 'me', active: true }); hooks.frame({ time: sag, snapshot: state });
  assert.deepEqual(lamps.map(lamp => lamp.light.intensity), expected, 'hook after update');
  hooks.frame({ time: sag, snapshot: state }); assert.deepEqual(lamps.map(lamp => lamp.light.intensity), expected, 'paused time holds still');
  handle.uninstall();
  world.update(sag, { snapshot: state, myId: 'me', active: true }); assert.deepEqual(lamps.map(lamp => lamp.light.intensity), famille);
  // Reduced motion: no sag, only the slow breath.
  const calm = setup(), calmHooks = {}, calmHandle = await install({ world: calm.world, hooks: calmHooks, document: stubDocument({ reducedMotion: true }) });
  calm.world.update(sag, { snapshot: state, myId: 'me', active: true }); calmHooks.frame({ time: sag, snapshot: state });
  assert.ok(calm.world.atmosphere.lamps[0].light.intensity >= famille[0] * GRIM_NIGHT.mood.lamps * (1 - GRIM_NIGHT.flicker.breathe - .002));
  calmHandle.uninstall();
});

test('the frame hook re-applies one mood with one options object: nothing allocated per frame', async () => {
  const { world } = setup(), hooks = {}, renderer = { toneMappingExposure: 1.3 }, calls = [], setMood = world.setMood;
  world.setMood = (...args) => { calls.push(args); return setMood(...args); };
  const handle = await install({ world, renderer, hooks }), state = snapshot(10, .2);
  for (let step = 0; step < 60 * 20; step++) hooks.frame({ time: step / 60, snapshot: state });
  assert.ok(calls.length > 60, `the circuit moved (${calls.length} calls)`);
  for (const [mood, options] of calls) { assert.equal(mood, calls[0][0]); assert.equal(options, calls[0][1]); }
  assert.equal(calls[0][1].renderer, renderer);
  handle.uninstall(); assert.deepEqual(calls.at(-1), [null]);
});

test('the hurt hook pulses the vignette darker, harder when the blow is big or health is low, and leaves no timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = stubDocument(), hooks = {}, handle = await install({ world: setup().world, hooks, document: doc });
  const vignette = doc.getElementById('frisson-vignette');
  const pulse = event => { hooks.hurt(event); return Number(vignette.style.getPropertyValue('--frisson-hurt')); };
  const light = pulse({ amount: 5, hp: 95, maxHp: 100 });
  assert.ok(vignette.classList.contains('hurt'));
  t.mock.timers.tick(GRIM_NIGHT.hurt.hold - 1); assert.ok(vignette.classList.contains('hurt'));
  t.mock.timers.tick(1); assert.ok(!vignette.classList.contains('hurt'));
  const heavy = pulse({ amount: 30, hp: 60, maxHp: 100 }), dying = pulse({ amount: 5, hp: 8, maxHp: 100 });
  assert.ok(light >= GRIM_NIGHT.hurt.min && heavy > light && dying > light && heavy <= GRIM_NIGHT.hurt.max);
  assert.ok(Math.abs(pulse({}) - (GRIM_NIGHT.hurt.min + (GRIM_NIGHT.hurt.max - GRIM_NIGHT.hurt.min) * .5)) < .006, 'missing fields stay finite');
  t.mock.timers.tick(GRIM_NIGHT.hurt.hold / 2); pulse({ amount: 5, hp: 50 });
  t.mock.timers.tick(GRIM_NIGHT.hurt.hold - 1); assert.ok(vignette.classList.contains('hurt'), 'a new blow restarts the hold');
  handle.uninstall();
  assert.equal(doc.getElementById('frisson-vignette'), null); assert.equal(hooks.hurt, null);
  t.mock.timers.tick(1000); assert.ok(vignette.classList.contains('hurt'), 'the pending hold timer was cleared, not run');
});

test('the frame hook marks the vignette at low health, and uninstall clears it', async () => {
  const doc = stubDocument(), hooks = {}, handle = await install({ world: setup().world, hooks, document: doc });
  const vignette = doc.getElementById('frisson-vignette');
  const frame = self => hooks.frame({ time: 0, snapshot: snapshot(), self });
  frame({ alive: true, downed: false, hp: 30, maxHp: 100 }); assert.ok(vignette.classList.contains('low'), 'a third of health');
  frame({ alive: true, downed: false, hp: 36, maxHp: 100 }); assert.ok(!vignette.classList.contains('low'), 'back above the threshold');
  frame({ alive: true, downed: true, hp: 10, maxHp: 100 }); assert.ok(!vignette.classList.contains('low'), 'downed');
  frame({ alive: false, downed: false, hp: 0, maxHp: 100 }); assert.ok(!vignette.classList.contains('low'), 'out');
  frame({ alive: true, hp: 35, maxHp: 100 }); assert.ok(vignette.classList.contains('low'), 'the threshold itself');
  frame(); assert.ok(!vignette.classList.contains('low'), 'no self clears it');
  frame({ alive: true, downed: false, hp: 30, maxHp: 100 }); assert.ok(vignette.classList.contains('low'));
  handle.uninstall();
  assert.equal(doc.getElementById('frisson-vignette'), null);
  assert.ok(!vignette.classList.contains('low'), 'the class goes with the uninstall');
  assert.equal(hooks.frame, null);
});

test('frisson.css: overlays under the HUD, never in the way, cheap grain that respects reduced motion', () => {
  const hud = Number(readFileSync(new URL('../public/style.css', import.meta.url), 'utf8').match(/#hud\{[^}]*z-index:(\d+)/)[1]);
  const rule = selector => css.match(new RegExp(`(?:^|\\})${selector.replace(/[#.()]/g, '\\$&')}\\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  for (const id of ['#frisson-vignette', '#frisson-grain']) {
    const z = Number(rule(id).match(/z-index:(\d+)/)[1]);
    assert.ok(z < 3 && z < hud, `${id} sits under #damage-flash and the HUD`);
  }
  assert.match(rule('#frisson-vignette,#frisson-grain'), /pointer-events:none/);
  assert.match(css, /\.grain,#vignette\{display:none\}/, 'Frisson replaces the Famille layers instead of stacking on them');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{#frisson-grain\{animation:none\}#frisson-vignette\.low:not\(\.hurt\)::after\{animation:none;opacity:\.32\}\}/);
  assert.match(css, /#frisson-vignette\.low:not\(\.hurt\)::after\{animation:frisson-low 1\.2s ease-in-out infinite\}/);
  assert.match(css, /@keyframes frisson-low\{0%,100%\{opacity:\.22\}50%\{opacity:\.42\}\}/);
  assert.match(css, /#damage-flash\{background:radial-gradient\(ellipse,transparent 45%,#5c0b10\)\}/, 'the Frisson damage flash is a dark red ring');
  assert.match(rule('#frisson-grain'), /opacity:\.085/);
  assert.match(rule('#frisson-grain'), /steps\(1,end\)/); assert.match(rule('#frisson-grain'), /will-change:transform/);
  for (const offset of css.match(/translate\([^)]*\)/g)) for (const value of offset.match(/-?\d+/g)) assert.ok(Math.abs(Number(value)) < 64, 'the tile never shows its edge');
  assert.match(css, /\.frisson-desaturate #game\{filter:saturate\(\.9\)\}/);
  // The grain is a real 64 x 64 PNG.
  const png = Buffer.from(css.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)[1], 'base64');
  assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), 64); assert.equal(png.readUInt32BE(20), 64);
  const idat = png.indexOf('IDAT'), raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
  assert.equal(raw.length, 64 * (1 + 32));
  assert.ok(png.length < 2600);
  // No per-frame script: the flicker rides the game's frame hook.
  assert.doesNotMatch(atmosphereSource, /requestAnimationFrame|setInterval/);
});
