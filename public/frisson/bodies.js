// Frisson part: bodies (art/frisson/BODIES.md). Blender-modelled torsos,
// arms and legs from bodies.glb replace the storybook capsules through the
// body hooks of zombies.js setZombieStyle. The procedural pivots, armour,
// health markers, animation, death and damage stay as in Famille; the
// family cloth and skin keep their colours (the toughness cue) times the
// model's grey, in their corpse version (palette.js). Cloth and skin are
// drawn on shared geometry; trousers, ties and details are merged once per
// colour combination and shared too, so a body costs no upload per spawn
// and never more draw calls than Famille.
// With no bodies.glb (or a broken one) the bodies stay procedural.
import * as THREE from '/vendor/three.module.js';
import { readGlb } from './glb.js';
import { skinColor, clothColor } from './palette.js';
import { setZombieStyle, getZombieStyle, withRim, createZombie, disposeZombie } from '../zombies.js';
import { frissonPick, mixHash } from './pick.js';

// Kinds of root, their channels (required first) and required variants.
export const BODY_SLOTS = Object.freeze({
  torso: Object.freeze({ prefix: 'FrissonTorso_', required: ['Cloth', 'Detail', 'Pants'], optional: ['Skin', 'Tie'], variants: ['Shirt', 'Tie', 'Overalls', 'Hoodie', 'Torn', 'Vest', 'Flannel', 'Tracksuit'] }),
  arm: Object.freeze({ prefix: 'FrissonArm_', required: ['Skin'], optional: ['Cloth'], variants: ['LongHand', 'LongClaw', 'ShortHand', 'ShortClaw', 'TornHand', 'TornClaw'] }),
  leg: Object.freeze({ prefix: 'FrissonLeg_', required: ['Pants', 'Detail'], optional: ['Skin'], variants: ['Boot', 'Sneaker', 'Bare', 'TrackSneaker'] }),
  crawlerTorso: Object.freeze({ prefix: 'FrissonCrawler_', required: ['Cloth', 'Detail', 'Pants'], optional: ['Skin'], variants: ['Shirt', 'Torn', 'Hoodie'] }),
  crawlerArm: Object.freeze({ prefix: 'FrissonCrawlerArm_', required: ['Skin'], optional: ['Cloth', 'Detail'], variants: ['Hand'] }),
  crawlerLeg: Object.freeze({ prefix: 'FrissonCrawlerLeg_', required: ['Pants', 'Detail'], optional: ['Skin'], variants: ['Boot', 'Sneaker', 'Bare'] }),
});
// Optional torsos for brutes and the overlord (BODIES.md section 3).
export const BRUTE_TORSOS = Object.freeze(['BruteFlannel', 'BruteOveralls']);
export const REQUIRED_ROOTS = Object.freeze(Object.values(BODY_SLOTS).flatMap(slot => slot.variants.map(variant => slot.prefix + variant)));
// The same roots in a set (BODIES.md section 3): FrissonTorso_A_Shirt.
export const requiredRoots = (set = null) => (set ? REQUIRED_ROOTS.map(name => name.replace('_', `_${set}_`)) : REQUIRED_ROOTS);
// Longest prefixes first: FrissonCrawlerArm_ before FrissonCrawler_.
const SLOT_ORDER = Object.entries(BODY_SLOTS).sort(([, a], [, b]) => b.prefix.length - a.prefix.length);
// An optional set (a capital, then letters or digits, and an underscore),
// then the variant: letters, then digits.
const VARIANT = /^(?:([A-Z][A-Za-z0-9]*)_)?([A-Za-z]+)(\d*)$/;
// The contract's planes (unit build): the chest the markers sit on, and the
// shin the overlord's leg guards sit on.
export const CHEST_REGION = Object.freeze({ standing: Object.freeze({ x: .1, y: [1.05, 1.35] }), crawler: Object.freeze({ x: .12, y: [.32, .48] }) });
export const SHIN_Y = -.45;
// The hip point the hunch turns the torso about.
export const HIP_Y = .93;
// The armoured back plate's footprint (zombies.js buildArmor: .235·w wide,
// y 1.18 ± .25). The back it rests on is measured over its full width, on
// every channel (a vest's shirt is Detail), or its sides sink into the
// shoulder blades; but only up to BACK_PLATE_REST, below the collar: the
// hump behind the neck (B) and the hood (A) stand 2 to 6 cm further back
// than the back itself, and a plate pushed out to clear them stood 3 to 9
// cm off the middle of the back. Its top edge tucks under them instead.
export const BACK_PLATE = Object.freeze({ x: .235, y: Object.freeze([.93, 1.43]) });
export const BACK_PLATE_REST = Object.freeze({ x: .235, y: Object.freeze([.93, 1.37]) });
const COMPILE_TIMEOUT = 5000;
// A baked Detail colour brighter than this (a white sneaker, a pale bandage)
// reads as a lamp in the grim night: it is dimmed to the luma cap, hue kept.
export const DETAIL_MAX_LUMA = .18;
// The armour a style re-dresses (dressArmor): every rigid plate of the
// armoured kind and the colossi, one merged, owned geometry each.
const ARMOR_MESHES = new Set(['zombieArmor', 'zombieChestPlate', 'zombieHeavyArmor', 'zombieArmorPadLeft', 'zombieArmorPadRight', 'zombieLegGuard', 'zombieHelmet']);
// A hammered dent per vertex, from its place rounded to 1 mm: shared corners
// of the merged piece get the same push, so the dents never open a seam.
const dent = (x, y, z) => mixHash((Math.round(x * 1000) * 73856093 ^ Math.round(y * 1000) * 19349663 ^ Math.round(z * 1000) * 83492791) >>> 0) / 4294967296;

// Which slot a root name belongs to: { slot, variant, key, set } or null.
// The variant is the name after the slot's prefix (A_Torn2 in a set); the
// key is the variant without its set and trailing digits (Torn2 is an
// alternate Torn); set is null in a file without sets.
export function bodyRootName(name) {
  for (const [slot, { prefix }] of SLOT_ORDER) {
    if (!name.startsWith(prefix)) continue;
    const match = VARIANT.exec(name.slice(prefix.length));
    return match ? { slot, variant: match[0], key: match[2], set: match[1] ?? null } : null;
  }
  return null;
}

// Sorts the GLB's roots into slots: { torso: Map(key -> [variant]) …, sets,
// roots }. A variant is { name, root, key, set, slot, channels: { Cloth:
// geometry … }, shin } (shin: the unit leg's front at y -.45). The slot maps
// hold every set's variants, in file order; sets lists each set (file order)
// as { name, torso: Map … } with its own variants: one set, named null, in a
// file without sets. Names and channels follow the contract; anything else
// fails loudly, so a bad export never draws.
export function bodiesFromGlb({ roots }) {
  const slotMaps = () => Object.fromEntries(Object.keys(BODY_SLOTS).map(slot => [slot, new Map()]));
  const slots = slotMaps(), sets = new Map();
  const seen = new Set();
  let count = 0;
  for (const root of roots) {
    const parsed = bodyRootName(root.name);
    if (!parsed) throw new Error(`GLB: root ${root.name} is not a Frisson body part (FrissonTorso_, FrissonArm_, FrissonLeg_, FrissonCrawler_, FrissonCrawlerArm_ or FrissonCrawlerLeg_, an optional set and an underscore, then a variant of letters, then digits)`);
    if (seen.has(root.name)) throw new Error(`GLB: ${root.name} appears twice`);
    if (sets.size && sets.has(null) !== (parsed.set === null)) throw new Error(`GLB: ${root.name}: either every root names its set or none does`);
    seen.add(root.name);
    const spec = BODY_SLOTS[parsed.slot], allowed = [...spec.required, ...spec.optional];
    if (root.mesh) throw new Error(`GLB: ${root.name} must be an empty with ${allowed.map(channel => `_${channel}`).join(', ')} children`);
    const channels = {};
    for (const child of root.children) {
      const channel = child.name.startsWith(`${root.name}_`) ? child.name.slice(root.name.length + 1) : null;
      if (!allowed.includes(channel)) throw new Error(`GLB: ${child.name} is not a channel of ${root.name} (${allowed.map(name => `_${name}`).join(', ')})`);
      if (channels[channel]) throw new Error(`GLB: ${child.name} appears twice`);
      if (!child.mesh || child.children.length) throw new Error(`GLB: ${child.name} must be a mesh without children`);
      if (!child.mesh.geometry.attributes.color) throw new Error(`GLB: ${child.name} has no COLOR_0`);
      channels[channel] = child.mesh.geometry;
    }
    for (const channel of spec.required) if (!channels[channel]) throw new Error(`GLB: ${root.name}_${channel} is missing`);
    const variant = { name: parsed.variant, root: root.name, key: parsed.key, set: parsed.set, slot: parsed.slot, channels: Object.freeze(channels), shin: null };
    if (parsed.slot === 'leg') variant.shin = frontAt(Object.values(channels), SHIN_Y);
    Object.freeze(variant);
    if (!sets.has(parsed.set)) sets.set(parsed.set, slotMaps());
    for (const maps of [slots, sets.get(parsed.set)]) {
      const list = maps[parsed.slot].get(parsed.key) ?? [];
      list.push(variant);
      maps[parsed.slot].set(parsed.key, list);
    }
    count++;
  }
  if (!count) throw new Error('GLB: no Frisson body part');
  for (const maps of [slots, ...sets.values()]) for (const slot of Object.keys(BODY_SLOTS)) for (const [key, list] of maps[slot]) maps[slot].set(key, Object.freeze(list));
  return Object.freeze({ ...slots, sets: Object.freeze([...sets].map(([name, maps]) => Object.freeze({ name, ...maps }))), roots: Object.freeze(roots.map(root => root.name)) });
}

// --- Measures ----------------------------------------------------------------
const point = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
function corners(geometry, index, matrix) {
  const position = geometry.attributes.position, read = (target, offset) => {
    target.fromBufferAttribute(position, geometry.index ? geometry.index.getX(index + offset) : index + offset);
    if (matrix) target.applyMatrix4(matrix);
  };
  read(a, 0); read(b, 1); read(c, 2);
}
const triangleCount = geometry => (geometry.index ? geometry.index.count : geometry.attributes.position.count);

// The most forward z (smallest) of the surface over a front region (x: a
// half width about the middle, or [left, right]): rays along +Z on a grid of
// (x, y) samples, plus the vertices inside it. matrix places the geometry in
// the frame the region is given in. null when the surface misses the
// region. side 1 gives the back instead (the largest z).
export function frontOf(geometries, { x: across, y: [low, high] }, matrix = null, side = -1) {
  let front = Infinity;
  const [left, right] = Array.isArray(across) ? across : [-across, across], samples = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 6; j++) samples.push([Array.isArray(across) ? left + (right - left) * i / 4 : -across + i * across / 2, low + (high - low) * j / 6]);
  for (const geometry of geometries) {
    for (let index = 0; index < triangleCount(geometry); index += 3) {
      corners(geometry, index, matrix);
      for (const [x, y] of samples) {
        const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        if (Math.abs(d) < 1e-12) continue;
        const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d, v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d, w = 1 - u - v;
        if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
        front = Math.min(front, side * -(u * a.z + v * b.z + w * c.z));
      }
    }
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index); if (matrix) point.applyMatrix4(matrix);
      if (point.x >= left && point.x <= right && point.y >= low && point.y <= high) front = Math.min(front, side * -point.z);
    }
  }
  return Number.isFinite(front) ? -side * front : null;
}

// The most forward z where the surface crosses the plane at height y: the
// shin a leg guard sits on.
export function frontAt(geometries, y) {
  let front = Infinity;
  for (const geometry of geometries) for (let index = 0; index < triangleCount(geometry); index += 3) {
    corners(geometry, index, null);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if ((p.y - y) * (q.y - y) > 0 || p.y === q.y) continue;
      const t = (y - p.y) / (q.y - p.y);
      front = Math.min(front, p.z + (q.z - p.z) * t);
    }
  }
  return Number.isFinite(front) ? front : null;
}

// The torso's transform for a build: scale (w, 1, d), then the hunch's lean
// about the hip point (BODIES.md section 3).
export function torsoTransform({ w = 1, d = 1, hunch = 0 } = {}) {
  const angle = -.245 * hunch;
  return { scale: [w, 1, d], rotationX: angle, position: [0, HIP_Y * (1 - Math.cos(angle)), -HIP_Y * Math.sin(angle)] };
}
function place(mesh, { scale, rotationX = 0, position = [0, 0, 0] }) {
  mesh.scale.set(...scale); mesh.rotation.x = rotationX; mesh.position.set(...position);
  return mesh;
}

// --- Picks ----------------------------------------------------------------------
const capital = text => text ? text[0].toUpperCase() + text.slice(1) : '';
export function sleeveOf(top) { return top === 'torn' ? 'Torn' : ['hoodie', 'tracksuit', 'flannel'].includes(top) ? 'Long' : 'Short'; }
export function legKey(look, side, crawler = false) {
  if (!crawler && look.top === 'tracksuit') return 'TrackSneaker';
  if (look.shoes === 'oneBare') return side < 0 ? 'Bare' : 'Boot';
  return look.shoes === 'sneakers' ? 'Sneaker' : 'Boot';
}
// Among a key's variants (file order), the server id picks one per slot from
// its own mixed hash (pick.js), apart from the head and the other slots: a
// patched knee or a rolled sleeve may come on one side only. The storybook
// look's random sequence is never touched.
export const bodyPick = (id, slot, count) => frissonPick(id, `|${slot}`, count);
// The set a zombie wears every part from, among `count` (file order), from
// its own mixed hash too: every head wears every set.
export const bodySetPick = (id, count) => frissonPick(id, '|set', count);
// The sets a zombie may wear: colossi (brutes and the overlord) only the
// sets with a brute torso, when any has one; everyone else every set.
export function setsFor(bodies, kind) {
  const colossal = kind === 'brute' ? bodies.sets.filter(set => BRUTE_TORSOS.some(key => set.torso.has(key))) : [];
  return colossal.length ? colossal : bodies.sets;
}

// --- The style --------------------------------------------------------------------
// shared: the heads' materials ({ skin(appearance), detail() }), so neck,
// hands and head match exactly and no shader program is added; without
// heads the bodies make their own, with the same settings.
export function createBodiesStyle(bodies, { materials: shared = null } = {}) {
  const materials = new Map(), baked = new Map(), fronts = new Map();
  const cached = (store, name, create) => { if (!store.has(name)) store.set(name, create()); return store.get(name); };
  // The game's skin, cloth and detail roughness and moonlit rim; facets come
  // from flat shading over the model's smooth normals.
  const faceted = (color, roughness) => withRim(new THREE.MeshStandardMaterial({ color, roughness, vertexColors: true, flatShading: true }));
  const skinMaterial = appearance => shared?.skin?.(appearance) ?? cached(materials, `skin-${appearance.id}`, () => faceted(skinColor(appearance), .82));
  const detailMaterial = () => shared?.detail?.() ?? cached(materials, 'detail', () => faceted(0xffffff, .86));
  const clothMaterial = appearance => cached(materials, `cloth-${appearance.id}`, () => faceted(clothColor(appearance), .96));

  // Everything a zombie wears, all from one set (setsFor, bodySetPick), or
  // null when a variant it needs is missing from that set (then every hook
  // answers null: no Frisson torso on storybook limbs, nor a torso of one
  // set on the limbs of another).
  function planFor(look, { kind, id, crawler }) {
    if (kind === 'raider' || !look) return null;
    const sets = setsFor(bodies, kind), set = sets[bodySetPick(id, sets.length)];
    const pick = (slot, key, which) => { const list = set[slot].get(key); return list?.length ? list[bodyPick(id, which, list.length)] : null; };
    if (crawler) {
      const plan = { torso: pick('crawlerTorso', capital(look.top), 'torso'), armL: pick('crawlerArm', 'Hand', 'armL'), armR: pick('crawlerArm', 'Hand', 'armR'),
        legL: pick('crawlerLeg', legKey(look, -1, true), 'legL'), legR: pick('crawlerLeg', legKey(look, 1, true), 'legR') };
      return Object.values(plan).every(Boolean) ? plan : null;
    }
    const top = capital(look.top), hand = look.arms === 'claw' ? 'Claw' : 'Hand', sleeve = sleeveOf(look.top);
    const plan = {
      torso: (kind === 'brute' && pick('torso', `Brute${top}`, 'torso')) || pick('torso', top, 'torso'),
      armL: pick('arm', sleeve + hand, 'armL'), armR: pick('arm', sleeve + hand, 'armR'),
      legL: pick('leg', legKey(look, -1), 'legL'), legR: pick('leg', legKey(look, 1), 'legR'),
    };
    return Object.values(plan).every(Boolean) ? plan : null;
  }

  // Detail, trousers, tie and (for limbs) skin merged into one geometry with
  // their colours multiplied in (linear, as the shader would), shared by
  // every zombie with the same combination.
  function bake(variant, tints) {
    const used = ['Detail', 'Pants', 'Tie', 'Skin', 'Cloth'].filter(channel => variant.channels[channel] && (channel === 'Detail' || tints[channel] !== undefined));
    const key = `${variant.root}|${used.map(channel => `${channel}:${channel === 'Detail' ? '' : tints[channel]}`).join('|')}`;
    return cached(baked, key, () => {
      const parts = used.map(channel => ({ geometry: variant.channels[channel], tint: channel === 'Detail' ? null : new THREE.Color(tints[channel]), cap: channel === 'Detail' }));
      const vertices = parts.reduce((sum, part) => sum + part.geometry.attributes.position.count, 0), indexCount = parts.reduce((sum, part) => sum + triangleCount(part.geometry), 0);
      const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), colors = new Float32Array(vertices * 3);
      const indices = new (vertices > 65535 ? Uint32Array : Uint16Array)(indexCount);
      let vertex = 0, offset = 0;
      for (const { geometry, tint, cap } of parts) {
        const { position, normal, color } = geometry.attributes, count = position.count;
        positions.set(position.array, vertex * 3);
        if (normal) normals.set(normal.array, vertex * 3);
        for (let index = 0; index < count; index++) {
          let r = color.getX(index), g = color.getY(index), b = color.getZ(index);
          if (cap) {
            const luma = .2126 * r + .7152 * g + .0722 * b;
            if (luma > DETAIL_MAX_LUMA) { const dim = DETAIL_MAX_LUMA / luma; r *= dim; g *= dim; b *= dim; }
          }
          colors[(vertex + index) * 3] = r * (tint ? tint.r : 1);
          colors[(vertex + index) * 3 + 1] = g * (tint ? tint.g : 1);
          colors[(vertex + index) * 3 + 2] = b * (tint ? tint.b : 1);
        }
        const total = triangleCount(geometry);
        for (let index = 0; index < total; index++) indices[offset + index] = vertex + (geometry.index ? geometry.index.getX(index) : index);
        vertex += count; offset += total;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      geometry.name = key;
      return geometry;
    });
  }

  const add = (parent, geometry, material, name, transform, variant) => {
    // Shared geometry: never userData.ownedGeometry, so disposeZombie leaves
    // it alone; shadows are set here as zombies.js mesh() would.
    const part = place(new THREE.Mesh(geometry, material), transform);
    part.name = name; part.castShadow = true; part.receiveShadow = true;
    part.userData.bodyVariant = variant.name;
    parent.add(part);
    return part;
  };

  return {
    bodies, planFor, bake,
    buildTorso(body, appearance, look, { kind, boss = false, id, crawler = false, w = 1, d = 1, hunch = 0 } = {}) {
      const plan = planFor(look, { kind, boss, id, crawler });
      if (!plan) return null;
      const variant = plan.torso, transform = crawler ? torsoTransform() : torsoTransform({ w, d, hunch });
      const torso = add(body, variant.channels.Cloth, clothMaterial(appearance), 'zombieTorso', transform, variant);
      if (variant.channels.Skin) add(body, variant.channels.Skin, skinMaterial(appearance), 'zombieSkin', transform, variant);
      add(body, bake(variant, { Pants: look.pantsColor, ...(variant.channels.Tie ? { Tie: look.tieColor } : {}) }), detailMaterial(), 'zombieClothes', transform, variant);
      // The chest the markers and armour sit on, and the back the armoured
      // back plate sits on, for this build.
      const key = `${variant.root}|${transform.scale.join(',')}|${transform.rotationX}`;
      const { front, back, matrix } = cached(fronts, key, () => {
        const object = place(new THREE.Object3D(), transform); object.updateMatrix();
        const region = crawler ? CHEST_REGION.crawler : CHEST_REGION.standing, plate = { x: BACK_PLATE_REST.x * transform.scale[0], y: BACK_PLATE_REST.y };
        return { front: frontOf([variant.channels.Cloth], region, object.matrix), back: crawler ? null : frontOf(Object.values(variant.channels), plate, object.matrix, 1), matrix: object.matrix };
      });
      // A strip off the chest's middle (the sallow family's) lies on the
      // chest under it: a rounder chest falls away from the front there.
      const frontAt = (x, y) => cached(fronts, `${key}|${x}|${y}`, () => frontOf([variant.channels.Cloth], { x, y }, matrix));
      return { torso, front: Number.isFinite(front) ? front : null, back: Number.isFinite(back) ? back : null, ...(crawler ? {} : { frontAt }) };
    },
    buildArm(pivot, appearance, look, { side = 1, length = .52, thickness = 1, kind, boss = false, id, crawler = false } = {}) {
      const plan = planFor(look, { kind, boss, id, crawler });
      if (!plan) return null;
      const variant = side < 0 ? plan.armL : plan.armR;
      const transform = { scale: crawler ? [side < 0 ? -1 : 1, 1, 1] : [(side < 0 ? -1 : 1) * thickness, length / .52, thickness] };
      if (crawler && (variant.channels.Cloth || variant.channels.Detail)) {
        add(pivot, bake(variant, { Skin: skinColor(appearance), Cloth: clothColor(appearance) }), detailMaterial(), 'zombieHand', transform, variant);
        return {};
      }
      if (variant.channels.Cloth) add(pivot, variant.channels.Cloth, clothMaterial(appearance), 'zombieSleeve', transform, variant);
      add(pivot, variant.channels.Skin, skinMaterial(appearance), 'zombieHand', transform, variant);
      return {};
    },
    buildLeg(pivot, appearance, look, { side = 1, thickness = 1, kind, boss = false, id, crawler = false } = {}) {
      const plan = planFor(look, { kind, boss, id, crawler });
      if (!plan) return null;
      const variant = side < 0 ? plan.legL : plan.legR, t = crawler ? 1 : thickness;
      const transform = { scale: [(side < 0 ? -1 : 1) * t, 1, t] };
      add(pivot, bake(variant, { Pants: look.pantsColor, ...(variant.channels.Skin ? { Skin: skinColor(appearance) } : {}) }), detailMaterial(), 'zombieLeg', transform, variant);
      return Number.isFinite(variant.shin) ? { shinFront: variant.shin * t } : {};
    },
    // The storybook armour, re-dressed after the build (zombies.js calls this
    // last): the family's scavenged steel becomes dark faceted iron, hammered
    // (the dents are in the zombie's own geometry, one per zombie), and the
    // overlord's carapace turns to near-black plates, tilted apart so the
    // seams read. Famille never sees it: with no style nothing is called.
    dressArmor(zombie, appearance) {
      const plates = [];
      zombie.traverse(part => { if (part.isMesh && ARMOR_MESHES.has(part.name)) plates.push(part); });
      if (plates.length) {
        const iron = cached(materials, `armor-${appearance.id}`, () => withRim(new THREE.MeshStandardMaterial({ color: new THREE.Color(clothColor(appearance)).lerp(new THREE.Color(0x2e2b28), .35), roughness: .62, metalness: .5, flatShading: true })));
        for (const plate of plates) {
          plate.material = iron;
          const { position, normal } = plate.geometry.attributes;
          for (let index = 0; index < position.count; index++) {
            const push = (dent(position.getX(index), position.getY(index), position.getZ(index)) - .5) * .008;
            position.setXYZ(index, position.getX(index) + normal.getX(index) * push, position.getY(index) + normal.getY(index) * push, position.getZ(index) + normal.getZ(index) * push);
          }
          position.needsUpdate = true;
          plate.geometry.computeVertexNormals();
        }
      }
      const carapace = zombie.userData.carapace;
      if (!carapace) return;
      carapace.colors = { base: 0x3c3a36, hurt: 0x5a2e22 };
      const shell = cached(materials, 'carapace', () => withRim(new THREE.MeshStandardMaterial({ color: 0x3c3a36, roughness: .6, metalness: .55, flatShading: true })));
      // One overlord at a time: a reused shell may still wear the last one's hurt.
      shell.color.setHex(0x3c3a36);
      carapace.material.dispose();
      carapace.material = shell;
      carapace.styleMaterial = true;
      carapace.plates.forEach((plate, index) => {
        plate.material = shell;
        plate.scale.x = .225; plate.scale.z = .045;
        plate.rotation.x = (index % 2 ? 1 : -1) * .05;
        plate.rotation.y = (index < 2 ? -1 : 1) * .08;
      });
    },
    dispose() {
      for (const slot of Object.keys(BODY_SLOTS)) for (const list of bodies[slot].values()) for (const variant of list) for (const geometry of Object.values(variant.channels)) geometry.dispose();
      for (const geometry of baked.values()) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      baked.clear(); materials.clear(); fronts.clear();
    },
  };
}

// The heads (or any style already set) with the bodies' hooks on top: one
// style for setZombieStyle. base keeps the style underneath, so its own
// uninstall can tell the bodies sit on it.
export function composeStyle(base, bodiesStyle) {
  return { ...(base ?? {}), buildTorso: bodiesStyle.buildTorso, buildArm: bodiesStyle.buildArm, buildLeg: bodiesStyle.buildLeg, dressArmor: bodiesStyle.dressArmor, bodies: bodiesStyle, base: base ?? null, dispose: () => bodiesStyle.dispose() };
}

// As heads.js: compiles a staged walker and crawler with the bodies on, for
// the scene's lights and fog; never rejects; settles when three is done.
function precompile({ renderer, scene, camera }) {
  if (!renderer?.compileAsync || !camera) return null;
  const models = [createZombie('walker', false, 80, 'prewarm'), createZombie('crawler', false, 80, 'prewarm')];
  const stage = new THREE.Group(); stage.name = 'frissonBodiesPrewarm'; stage.add(...models);
  let compiling;
  try { compiling = Promise.resolve(renderer.compileAsync(stage, camera, scene ?? null)); } catch (error) { compiling = Promise.reject(error); }
  return compiling.catch(() => {}).finally(() => models.forEach(disposeZombie));
}
function waitFor(compiled, signal) {
  let timer, stop;
  const enough = new Promise(resolve => { stop = resolve; timer = setTimeout(resolve, COMPILE_TIMEOUT); signal?.addEventListener('abort', resolve, { once: true }); });
  return Promise.race([compiled, enough]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', stop); });
}

// ctx: art/frisson/DESIGN.md. Installed after heads.js (index.js PARTS), it
// puts the bodies on top of the heads' style. A missing or broken bodies.glb
// is not an error: the bodies stay procedural, the heads stay on, and the
// handle says why ({ bodies: null, error }). ctx.signal works as for heads.
export async function install(ctx = {}) {
  const { signal } = ctx;
  signal?.throwIfAborted();
  const base = ctx.base ?? '/frisson/';
  const fetchAsset = ctx.fetchAsset ?? (async path => {
    const response = await fetch(base + path, { signal });
    if (!response.ok) throw new Error(`${base}${path}: HTTP ${response.status}`);
    return response.arrayBuffer();
  });
  let bodies;
  try { bodies = bodiesFromGlb(readGlb(await fetchAsset('bodies.glb'))); }
  catch (error) {
    signal?.throwIfAborted();
    globalThis.console?.warn?.(`Frisson bodies stay procedural: ${error?.message ?? error}`);
    return { style: null, bodies: null, error, uninstall() {} };
  }
  const previous = getZombieStyle();
  const bodiesStyle = createBodiesStyle(bodies, { materials: previous?.materials });
  if (signal?.aborted) { bodiesStyle.dispose(); signal.throwIfAborted(); }
  const style = composeStyle(previous, bodiesStyle);
  let active = true, compiling = null;
  const uninstall = () => {
    if (!active) return;
    active = false;
    signal?.removeEventListener('abort', uninstall);
    if (getZombieStyle() === style) setZombieStyle(previous ?? null);
    if (compiling) compiling.then(() => bodiesStyle.dispose()); else bodiesStyle.dispose();
  };
  setZombieStyle(style);
  signal?.addEventListener('abort', uninstall, { once: true });
  const compiled = precompile(ctx);
  if (compiled) {
    compiling = compiled; compiled.then(() => { compiling = null; });
    await waitFor(compiled, signal);
  }
  signal?.throwIfAborted();
  return { style, bodies, bodiesStyle, uninstall };
}
