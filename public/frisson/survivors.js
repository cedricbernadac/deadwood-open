// Frisson part: survivors (art/frisson/SURVIVORS.md). Blender-modelled
// survivors from survivors.glb replace the players' storybook figures
// through world.js setSurvivorStyle, and the raiders' too when the file has
// Raider characters. The rig stays Famille's: groups, pivots, animation,
// weapons, backpack, umbrella, torch and fuel can. Each part is merged once
// per colour (the model's cloth grey times the player colour, plus its true
// colours) into one geometry, shared by every survivor wearing it and drawn
// with one material, the program of the heads' detail material: no upload
// per survivor, no new shader, never more meshes than Famille.
// With no survivors.glb (or a broken one) the survivors stay Famille.
import * as THREE from '/vendor/three.module.js';
import { readGlb } from './glb.js';
import { withRim } from '../zombies.js';
import { setSurvivorStyle, getSurvivorStyle, createSurvivor } from '../world.js';
import { hashSeed } from '../zombie-looks.js';

export const SURVIVOR_PREFIX = 'FrissonSurvivor';
// Each part, and where a character finds it (SURVIVORS.md section 4): its
// own root only, its own or the _Common one, or optional (own or _Common;
// Gear is its own only).
export const SURVIVOR_PARTS = Object.freeze({
  Head: 'own', Torso: 'own', Gear: 'optional', Hips: 'shared', Arm: 'shared', ArmL: 'optional',
  Hand: 'shared', HandL: 'optional', Thigh: 'shared', Shin: 'shared', Boot: 'shared',
});
export const CHANNELS = Object.freeze({ Cloth: 'cloth', Detail: 'detail', Glow: 'glow' });
export const CHARACTERS = Object.freeze(['Father', 'Daughter', 'Max', 'Lea', 'Sam', 'Man', 'Woman', 'Elder']);
// Companions by their name (accents stripped, lower case); any other human
// from the pool by the hash of their id.
export const COMPANIONS = Object.freeze({ max: 'Max', lea: 'Lea', sam: 'Sam' });
export const HUMAN_POOL = Object.freeze(['Father', 'Daughter', 'Man', 'Woman', 'Elder']);
export const RAIDER = 'Raider';
export const COMMON = 'Common';
// Where the code puts each part's origin (SURVIVORS.md sections 1 and 4):
// torso, gear and hips on their Famille origins (the crouch squashes the
// torso about its own), the hand on the grip, the shin on the knee pivot,
// the boot on the centre it turns about (all in hip pivot space).
export const FRAMES = Object.freeze({
  torso: Object.freeze([0, 1.17, 0]), gear: Object.freeze([0, 1.2, 0]), hips: Object.freeze([0, .9, 0]),
  grip: Object.freeze([0, -.51, 0]), knee: Object.freeze([0, -.38, 0]), boot: Object.freeze([0, -.76, -.05]), bootOnKnee: Object.freeze([0, -.38, -.05]),
});
const NAME = /^FrissonSurvivor(Head|Torso|Gear|Hips|ArmL|Arm|HandL|Hand|Thigh|Shin|Boot)_([A-Za-z]+?)(\d*)$/;
const COMPILE_TIMEOUT = 5000;

// A root name's { part, character, key } (the key is the character without
// its trailing digits: Woman2 is an alternate Woman), or null.
export function survivorRootName(name) {
  const match = NAME.exec(name);
  return match ? { part: match[1], character: match[2] + match[3], key: match[2] } : null;
}

// Sorts the GLB's roots into characters (file order): { characters:
// Map(name -> { name, key, parts: { Head: { root, part, character,
// channels: { Cloth, Detail, Glow } } … } }), roots }. _Common is a
// character of its own. Names and channels follow the contract; anything
// else fails loudly, so a bad export never draws.
export function survivorsFromGlb({ roots }) {
  const characters = new Map(), seen = new Set();
  for (const root of roots) {
    const parsed = survivorRootName(root.name);
    if (!parsed) throw new Error(`GLB: root ${root.name} is not a Frisson survivor part (FrissonSurvivor<Part>_<Character>, Part one of ${Object.keys(SURVIVOR_PARTS).join(', ')}, the character letters then digits)`);
    if (seen.has(root.name)) throw new Error(`GLB: ${root.name} appears twice`);
    seen.add(root.name);
    const glow = parsed.part === 'Head' && parsed.key === RAIDER, allowed = glow ? ['Cloth', 'Detail', 'Glow'] : ['Cloth', 'Detail'];
    if (root.mesh) throw new Error(`GLB: ${root.name} must be an empty with ${allowed.map(channel => `_${channel}`).join(', ')} children`);
    const channels = {};
    for (const child of root.children) {
      const channel = child.name.startsWith(`${root.name}_`) ? child.name.slice(root.name.length + 1) : null;
      if (!allowed.includes(channel)) throw new Error(`GLB: ${child.name} is not a channel of ${root.name} (${allowed.map(name => `_${name}`).join(', ')})`);
      if (channels[channel]) throw new Error(`GLB: ${child.name} appears twice`);
      if (!child.mesh || child.children.length) throw new Error(`GLB: ${child.name} must be a mesh without children`);
      if (channel !== 'Glow' && !child.mesh.geometry.attributes.color) throw new Error(`GLB: ${child.name} has no COLOR_0`);
      channels[channel] = child.mesh.geometry;
    }
    if (!channels.Cloth && !channels.Detail) throw new Error(`GLB: ${root.name} needs a _Cloth or a _Detail child`);
    if (!characters.has(parsed.character)) characters.set(parsed.character, { name: parsed.character, key: parsed.key, parts: {} });
    characters.get(parsed.character).parts[parsed.part] = Object.freeze({ root: root.name, part: parsed.part, character: parsed.character, channels: Object.freeze(channels) });
  }
  if (!seen.size) throw new Error('GLB: no Frisson survivor part');
  for (const character of characters.values()) { Object.freeze(character.parts); Object.freeze(character); }
  return Object.freeze({ characters, roots: Object.freeze(roots.map(root => root.name)) });
}

// A companion's name as a character: "Léa" -> Lea; null for any other name.
export function companionCharacter(name) {
  const plain = String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return Object.hasOwn(COMPANIONS, plain) ? COMPANIONS[plain] : null;
}
export const survivorPick = (id, slot, count) => hashSeed(`${id}|frisson|${slot}`) % count;

// The parts a character wears, or null when one it needs is missing (then
// the whole survivor stays Famille: never a Frisson head on storybook boxes).
export function partsOf(survivors, name) {
  const character = survivors.characters.get(name);
  if (!character || name === COMMON) return null;
  const own = character.parts, common = survivors.characters.get(COMMON)?.parts ?? {}, raider = character.key === RAIDER;
  const shared = part => own[part] ?? common[part] ?? null;
  const parts = {
    head: own.Head ?? null, torso: own.Torso ?? null, gear: own.Gear ?? null, hips: shared('Hips'),
    arm: shared('Arm'), armL: raider ? own.ArmL ?? null : shared('ArmL'), hand: shared('Hand'), handL: shared('HandL'),
    thigh: shared('Thigh'), shin: shared('Shin'), boot: shared('Boot'),
  };
  if (!['head', 'torso', 'hips', 'arm', 'hand', 'thigh', 'shin', 'boot'].every(part => parts[part])) return null;
  // A raider: its glowing goggles and its own left arm (the armband).
  if (raider && (!parts.head.channels.Glow || !parts.armL)) return null;
  return Object.freeze(parts);
}

// --- Geometry --------------------------------------------------------------------
const triangleCount = geometry => (geometry.index ? geometry.index.count : geometry.attributes.position.count);
// Cloth (times the colour, linear, as the shader would multiply it) and
// Detail merged into one geometry, moved by `offset`, mirrored in x for a
// left limb (the triangles turned over, so faces stay wound outward). The
// first userData.cloth vertices come from the cloth.
export function mergeChannels({ Cloth: cloth = null, Detail: detail = null }, tint, { offset = [0, 0, 0], mirror = false } = {}) {
  const parts = [cloth && { geometry: cloth, tint }, detail && { geometry: detail, tint: null }].filter(Boolean);
  const vertices = parts.reduce((sum, part) => sum + part.geometry.attributes.position.count, 0), indexCount = parts.reduce((sum, part) => sum + triangleCount(part.geometry), 0);
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), colors = new Float32Array(vertices * 3);
  const indices = new (vertices > 65535 ? Uint32Array : Uint16Array)(indexCount), sign = mirror ? -1 : 1;
  let vertex = 0, offsetIndex = 0;
  for (const { geometry, tint: color } of parts) {
    const { position, normal, color: shade } = geometry.attributes, count = position.count;
    for (let index = 0; index < count; index++) {
      const at = (vertex + index) * 3;
      positions[at] = sign * position.getX(index) + offset[0]; positions[at + 1] = position.getY(index) + offset[1]; positions[at + 2] = position.getZ(index) + offset[2];
      if (normal) { normals[at] = sign * normal.getX(index); normals[at + 1] = normal.getY(index); normals[at + 2] = normal.getZ(index); }
      colors[at] = shade.getX(index) * (color ? color.r : 1); colors[at + 1] = shade.getY(index) * (color ? color.g : 1); colors[at + 2] = shade.getZ(index) * (color ? color.b : 1);
    }
    const total = triangleCount(geometry), corner = index => vertex + (geometry.index ? geometry.index.getX(index) : index);
    for (let index = 0; index < total; index += 3) {
      indices[offsetIndex + index] = corner(index);
      indices[offsetIndex + index + 1] = corner(index + (mirror ? 2 : 1));
      indices[offsetIndex + index + 2] = corner(index + (mirror ? 1 : 2));
    }
    vertex += count; offsetIndex += total;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.cloth = cloth ? cloth.attributes.position.count : 0;
  return geometry;
}

// --- The style -------------------------------------------------------------------
export function createSurvivorsStyle(survivors) {
  const plans = new Map(), baked = new Map();
  const people = [...survivors.characters.values()];
  const pool = people.filter(character => HUMAN_POOL.includes(character.key)), raiders = people.filter(character => character.key === RAIDER);
  // One material for every Frisson survivor: the heads' detail program
  // (zombies.js withRim, vertex colours, flat shading over smooth normals).
  const material = withRim(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: .9 }));
  material.name = 'frissonSurvivor';

  // Who a survivor is (SURVIVORS.md section 3): the chosen look, a
  // companion by name, anyone else by the hash of their id; raiders among
  // the Raider characters. Deterministic, the same on every screen.
  function characterFor(identity, raider) {
    const id = String(identity?.id ?? '');
    if (raider) return raiders.length ? raiders[survivorPick(id, 'raider', raiders.length)].name : null;
    const look = identity?.look;
    if (typeof look === 'string' && look !== COMMON && survivors.characters.get(look)?.key !== RAIDER && survivors.characters.has(look)) return look;
    const companion = identity?.companion === true ? companionCharacter(identity.name) : null;
    const own = companion ? people.filter(character => character.key === companion) : [];
    if (own.length) return own[survivorPick(id, 'companion', own.length)].name;
    return pool.length ? pool[survivorPick(id, 'survivor', pool.length)].name : null;
  }
  function plan({ color, identity = null, raider = false } = {}) {
    const name = characterFor(identity, raider === true);
    if (!name) return null;
    const hex = new THREE.Color(color ?? 0xffffff).getHex(), key = `${name}|${hex}`;
    if (!plans.has(key)) {
      const parts = partsOf(survivors, name);
      plans.set(key, parts ? Object.freeze({ character: name, key: survivors.characters.get(name).key, raider: raider === true, color: hex, tint: new THREE.Color(hex), parts }) : null);
    }
    return plans.get(key);
  }
  // A part merged for one colour, placed and mirrored once, then shared.
  function bake(part, colorPlan, { offset = [0, 0, 0], mirror = false } = {}) {
    const key = `${part.root}|${colorPlan.color}|${mirror ? 'L' : 'R'}|${offset.join(',')}`;
    if (!baked.has(key)) { const geometry = mergeChannels(part.channels, colorPlan.tint, { offset, mirror }); geometry.name = key; baked.set(key, geometry); }
    return baked.get(key);
  }
  const negative = point => point.map(value => (value ? -value : 0));
  // Shared geometry: never userData.ownedGeometry. Shadows as Famille's
  // survivor boxes (createRaider turns them off for raiders).
  function add(parent, geometry, name, part, position = null) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    if (position) mesh.position.fromArray(position);
    mesh.userData.survivorPart = part.root;
    parent.add(mesh);
    return mesh;
  }

  return {
    survivors, material, plan, bake, characterFor,
    buildHead(head, colorPlan, { glow = null } = {}) {
      const part = colorPlan.parts.head, mesh = add(head, bake(part, colorPlan), 'survivorHead', part);
      mesh.userData.character = colorPlan.character;
      if (glow && part.channels.Glow) {
        // The raider's goggles in the game's own glow (raiderGoggles).
        const lamps = new THREE.Mesh(part.channels.Glow, glow);
        lamps.name = 'survivorGlow'; lamps.castShadow = false; lamps.receiveShadow = false; lamps.userData.survivorPart = part.root;
        head.add(lamps);
      }
      return { head: mesh };
    },
    buildTorso(body, colorPlan) {
      const { torso: torsoPart, gear: gearPart } = colorPlan.parts;
      // The torso first: body.children[0] is still userData.torso.
      const torso = add(body, bake(torsoPart, colorPlan, { offset: negative(FRAMES.torso) }), 'survivorTorso', torsoPart, FRAMES.torso);
      let vest;
      if (gearPart) vest = add(body, bake(gearPart, colorPlan, { offset: negative(FRAMES.gear) }), 'survivorGear', gearPart, FRAMES.gear);
      else {
        // Nothing to draw, but the crouch still moves and squashes it.
        vest = new THREE.Object3D(); vest.name = 'survivorVest'; vest.position.fromArray(FRAMES.gear); body.add(vest);
      }
      return { torso, vest };
    },
    buildHips(body, colorPlan) {
      const part = colorPlan.parts.hips;
      return { belt: add(body, bake(part, colorPlan, { offset: negative(FRAMES.hips) }), 'survivorHips', part, FRAMES.hips) };
    },
    buildArm(arm, colorPlan, { side = 1 } = {}) {
      const left = side < 0, { arm: right, armL, hand: rightHand, handL } = colorPlan.parts;
      const sleevePart = left && armL ? armL : right, handPart = left && handL ? handL : rightHand;
      const sleeve = add(arm, bake(sleevePart, colorPlan, { mirror: left && !armL }), 'survivorSleeve', sleevePart);
      // On the grip, at true size: world.js scales it back as the arm stretches.
      const hand = add(arm, bake(handPart, colorPlan, { mirror: left && !handL, offset: negative(FRAMES.grip) }), 'survivorHand', handPart, FRAMES.grip);
      return { sleeve, hand };
    },
    buildLeg(leg, knee, colorPlan, { side = 1 } = {}) {
      const mirror = side < 0, { thigh: thighPart, shin: shinPart, boot: bootPart } = colorPlan.parts;
      const thigh = add(leg, bake(thighPart, colorPlan, { mirror }), 'survivorThigh', thighPart);
      // The thigh first, as Famille's leg box, then the knee.
      leg.remove(knee); leg.add(knee);
      const shin = add(knee, bake(shinPart, colorPlan, { mirror, offset: negative(FRAMES.knee) }), 'survivorShin', shinPart);
      const boot = add(knee, bake(bootPart, colorPlan, { mirror, offset: negative(FRAMES.boot) }), 'survivorBoot', bootPart, FRAMES.bootOnKnee);
      return { thigh, shin, boot };
    },
    // Every baked geometry, for tests and tools.
    get baked() { return [...baked.values()]; },
    dispose() {
      for (const geometry of baked.values()) geometry.dispose();
      for (const character of survivors.characters.values()) for (const part of Object.values(character.parts)) for (const geometry of Object.values(part.channels)) geometry.dispose();
      material.dispose();
      baked.clear(); plans.clear();
    },
  };
}

// A staged survivor wearing the style, compiled for the scene's lights and
// fog (as heads.js does for zombies). Never rejects; settles when three is
// done with the material. null without a renderer.
function precompile({ renderer, scene, camera }) {
  if (!renderer?.compileAsync || !camera) return null;
  const model = createSurvivor(0x809fac, { backpack: false, weapon: null, identity: { id: 'prewarm' } });
  const stage = new THREE.Group(); stage.name = 'frissonSurvivorsPrewarm'; stage.add(model);
  let compiling;
  try { compiling = Promise.resolve(renderer.compileAsync(stage, camera, scene ?? null)); } catch (error) { compiling = Promise.reject(error); }
  return compiling.catch(() => {}).finally(() => {
    const flash = model.userData.flash;
    flash.traverse(node => { node.geometry?.dispose(); });
    flash.children[0]?.material?.dispose();
  });
}
function waitFor(compiled, signal) {
  let timer, stop;
  const enough = new Promise(resolve => { stop = resolve; timer = setTimeout(resolve, COMPILE_TIMEOUT); signal?.addEventListener('abort', resolve, { once: true }); });
  return Promise.race([compiled, enough]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', stop); });
}

// ctx: art/frisson/DESIGN.md. Installed after the bodies (index.js PARTS).
// A missing or broken survivors.glb is not an error: the survivors stay
// Famille, the rest of the pack goes on, and the handle says why
// ({ survivors: null, error }). ctx.signal works as for the heads: called
// off, nothing stays on, and its AbortError is never swallowed.
export async function install(ctx = {}) {
  const { signal } = ctx;
  signal?.throwIfAborted();
  const base = ctx.base ?? '/frisson/';
  const fetchAsset = ctx.fetchAsset ?? (async path => {
    const response = await fetch(base + path, { signal });
    if (!response.ok) throw new Error(`${base}${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  let survivors;
  try { survivors = survivorsFromGlb(readGlb(await fetchAsset('survivors.glb'))); }
  catch (error) {
    signal?.throwIfAborted();
    globalThis.console?.warn?.(`Frisson survivors stay Famille: ${error?.message ?? error}`);
    return { style: null, survivors: null, error, uninstall() {} };
  }
  const style = createSurvivorsStyle(survivors);
  if (signal?.aborted) { style.dispose(); signal.throwIfAborted(); }
  let active = true, compiling = null;
  const uninstall = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', uninstall);
    if (getSurvivorStyle() === style) setSurvivorStyle(null);
    // Mid-compile, three still polls the material.
    if (compiling) compiling.then(() => style.dispose()); else style.dispose();
  };
  setSurvivorStyle(style);
  signal?.addEventListener('abort', uninstall, { once: true });
  const compiled = precompile(ctx);
  if (compiled) {
    compiling = compiled; compiled.then(() => { compiling = null; });
    await waitFor(compiled, signal);
  }
  signal?.throwIfAborted();
  return { style, survivors, uninstall };
}
