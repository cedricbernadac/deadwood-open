#!/usr/bin/env node
// Checks a Frisson heads GLB against art/frisson/DESIGN.md ("Heads: GLB
// contract"): the game's own reader must accept it (one JSON and one BIN
// chunk, identity nodes, one indexed triangle primitive per mesh, no
// textures, skins, animations or other extensions), then names, materials,
// vertex colours, triangle budgets, bounds and the variant count. With
// --bodies (or a file whose roots are body parts), it checks a bodies GLB
// against art/frisson/BODIES.md instead; in a file with several sets (the
// final bodies.glb: A and B), each set must be complete and keep the budget.
// With --survivors (or a file whose roots are FrissonSurvivor parts) a
// survivors GLB is checked against art/frisson/SURVIVORS.md. With --markers
// (or a file whose roots are all FrissonMark_*), it checks a markers GLB
// against art/frisson/MARKERS.md: names, required roots, channels and
// materials, the colour rules, budgets, bounds, the front/side area bands,
// the crown, and the fitted gap (M5) against every reference head and body it
// is given. With --weapons (or a file whose roots are all FrissonWeapon_*),
// it checks a weapons dressing GLB against art/frisson/WEAPONS.md section 3:
// names, channels and materials, winding, the budgets of 3.5, the bounds of
// G3, the sight corridors and muzzle clearance of G4, the envelopes of G5
// (built through public/world.js), the replacements of G6, the solids of D1,
// the single material of D2, the muted colours of D4 and the pixel blood of
// D6. Every failure prints the excess in millimetres and the direction.
// With --pickups (or a file whose roots are all FrissonPickup_*), it checks a
// pickups GLB against art/frisson/PICKUPS.md section 2: the fourteen roots
// and their _Body/_Glint channels and materials (K2), the envelopes and size
// floors (K3), the ammo fill keep-outs and their dark backing measured with
// ray grids (K4), the budgets (K5), the muted colours (K6), the cue shares
// (K7) and glint (K8), the pixel blood (K9) and the solids (K10).
// With --cabin (or a file whose roots are Dress_ roots), the cabin
// dressing against art/frisson/CABIN.md section 4.4 and the cabin space; with
// --surfaces, a cabin-surfaces.js recipes module against sections 1 and 4.3.
//   node tools/frisson-glb-check.mjs <file.glb> [--min-variants 8]
//   node tools/frisson-glb-check.mjs <bodies.glb> [--bodies]
//   node tools/frisson-glb-check.mjs <survivors.glb> [--survivors]
//   node tools/frisson-glb-check.mjs <markers.glb> --markers [--heads h.glb …] [--bodies b.glb …]
//   node tools/frisson-glb-check.mjs <weapons.glb> [--weapons]
//   node tools/frisson-glb-check.mjs <pickups.glb> [--pickups]
//   node tools/frisson-glb-check.mjs <cabin.glb> [--cabin] [--space <cabin-space.json>]
//   node tools/frisson-glb-check.mjs <cabin-surfaces.js> --surfaces
// Exit code 1 when the file breaks the contract (warnings never fail), 2 on
// bad usage.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { importPublicModule } from '../test/helpers/public-modules.mjs';

export const CONTRACT = Object.freeze({
  prefix: 'FrissonHead_', boss: 'FrissonHead_Boss', parts: Object.freeze(['Skin', 'Detail', 'Eyes']),
  materials: Object.freeze({ Skin: 'skin', Detail: 'detail', Eyes: 'eyes' }),
  // Head-local metres: the zombieHead group at y 1.68 and the server's
  // head zone 1.48-1.82 for a walker.
  bounds: Object.freeze({ min: Object.freeze([-.30, -.25, -.32]), max: Object.freeze([.30, .26, .26]) }),
  triangles: 1600, bossTriangles: 2400, target: Object.freeze([900, 1400]), minVariants: 8,
});
const NAME = /^FrissonHead_[A-Za-z0-9_]+$/;
// An ordinary head's eyes: `eyes`, or `eyes_<Set>` in a file that mixes
// sets (each set keeps its own glow); crawlers and the overlord may have
// their own (DESIGN.md, eye tints per kind).
const WALKER_EYES = /^eyes(?:_[A-Z][A-Za-z0-9]*)?$/, KIND_EYES = ['eyes_crawler', 'eyes_boss'];
// The skin's COLOR_0 multiplies the family colour (the toughness cue): grey,
// or barely tinted (a rot patch); a real colour belongs on the Detail mesh.
const GREY_TOLERANCE = 2 / 255, TINT_LIMIT = .08;

const triangles = geometry => geometry.index.count / 3;

export async function checkFrissonGlb(input, { minVariants = CONTRACT.minVariants } = {}) {
  if (!Number.isInteger(minVariants) || minVariants < 1) throw new TypeError(`minVariants must be a whole number of heads, got ${minVariants}`);
  const errors = [], warnings = [], heads = [];
  const { readGlb } = await importPublicModule('frisson/glb.js');
  let glb;
  try { glb = readGlb(input); } catch (error) { return { errors: [error.message], warnings, heads }; }
  const names = new Set();
  for (const root of glb.roots) {
    const where = root.name;
    if (!NAME.test(root.name)) { errors.push(`${where}: root names must be FrissonHead_<Name> (letters, digits, underscores; no dots)`); continue; }
    if (names.has(root.name)) errors.push(`${where}: duplicate root`);
    names.add(root.name);
    if (root.mesh) errors.push(`${where}: the root must be an empty, not a mesh`);
    const extra = root.children.filter(child => !CONTRACT.parts.some(part => child.name === `${root.name}_${part}`));
    if (extra.length || root.children.length !== CONTRACT.parts.length) errors.push(`${where}: expected exactly ${CONTRACT.parts.map(part => `${root.name}_${part}`).join(', ')}${extra.length ? ` (found ${extra.map(child => child.name).join(', ')})` : ''}`);
    const head = { name: root.name, boss: root.name === CONTRACT.boss, triangles: {}, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const part of CONTRACT.parts) {
      const child = root.children.find(node => node.name === `${root.name}_${part}`);
      if (!child) continue;
      if (child.children.length) errors.push(`${child.name}: parts have no children`);
      if (!child.mesh) { errors.push(`${child.name}: no mesh`); continue; }
      const { geometry, material } = child.mesh;
      const named = part === 'Eyes' ? WALKER_EYES.test(material?.name ?? '') || (head.boss && material?.name === 'eyes_boss') : material?.name === CONTRACT.materials[part];
      if (!named) errors.push(`${child.name}: material "${material?.name ?? 'none'}", expected "${CONTRACT.materials[part]}"${part === 'Eyes' ? ` (or eyes_<Set>${head.boss ? ', eyes_boss' : ''})` : ''}`);
      if (material?.doubleSided) errors.push(`${child.name}: materials are single-sided (every face wound outward)`);
      if (!geometry.attributes.normal) warnings.push(`${child.name}: no NORMAL (the contract exports smooth normals)`);
      const color = geometry.attributes.color;
      if (part !== 'Eyes' && !color) errors.push(`${child.name}: COLOR_0 is missing`);
      if (part === 'Skin' && color) {
        let worst = 0;
        for (let index = 0; index < color.count; index++) worst = Math.max(worst, Math.abs(color.getX(index) - color.getY(index)), Math.abs(color.getY(index) - color.getZ(index)));
        const tint = `${child.name}: COLOR_0 multiplies the family colour, found a ${(worst * 255).toFixed(0)}/255 tint (linear)`;
        if (worst > TINT_LIMIT) errors.push(`${tint}; keep it grey`);
        else if (worst > GREY_TOLERANCE) warnings.push(tint);
      }
      head.triangles[part] = triangles(geometry);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      ['x', 'y', 'z'].forEach((axis, index) => { head.min[index] = Math.min(head.min[index], box.min[axis]); head.max[index] = Math.max(head.max[index], box.max[axis]); });
      if (part === 'Eyes') {
        const centre = box.getCenter(box.min.clone());
        if (centre.z >= 0) errors.push(`${child.name}: the eyes sit behind the centre (z ${centre.z.toFixed(3)}); the face must look down -Z`);
      }
    }
    head.triangles.total = Object.values(head.triangles).reduce((sum, value) => sum + value, 0);
    const budget = head.boss ? CONTRACT.bossTriangles : CONTRACT.triangles;
    if (head.triangles.total > budget) errors.push(`${where}: ${head.triangles.total} triangles, budget ${budget}`);
    else if (!head.boss && (head.triangles.total < CONTRACT.target[0] || head.triangles.total > CONTRACT.target[1])) warnings.push(`${where}: ${head.triangles.total} triangles, target ${CONTRACT.target.join('-')}`);
    ['x', 'y', 'z'].forEach((axis, index) => {
      // Written so that NaN fails too.
      if (!(head.min[index] >= CONTRACT.bounds.min[index] - 1e-6 && head.max[index] <= CONTRACT.bounds.max[index] + 1e-6))
        errors.push(`${where}: ${axis} spans ${head.min[index].toFixed(3)}..${head.max[index].toFixed(3)}, allowed ${CONTRACT.bounds.min[index]}..${CONTRACT.bounds.max[index]}`);
    });
    heads.push(head);
  }
  const variants = heads.filter(head => !head.boss).length;
  if (variants < minVariants) errors.push(`${variants} ordinary head${variants === 1 ? '' : 's'}, the contract asks for at least ${minVariants}`);
  for (const material of glb.materials) if (!Object.values(CONTRACT.materials).includes(material.name) && !WALKER_EYES.test(material.name) && !KIND_EYES.includes(material.name)) warnings.push(`material "${material.name}" is not used by the contract`);
  return { errors, warnings, heads };
}

// --- Bodies (art/frisson/BODIES.md) -------------------------------------------------
export const BODIES_CONTRACT = Object.freeze({
  materials: Object.freeze({ Cloth: 'cloth', Skin: 'skin', Pants: 'pants', Tie: 'tie', Detail: 'detail' }),
  // Triangles per root (all channels), and per assembled body.
  triangles: Object.freeze({ torso: 1100, arm: 450, leg: 450, crawlerTorso: 900, crawlerArm: 250, crawlerLeg: 300 }),
  totals: Object.freeze({ standing: 3000, crawler: 2000 }), target: Object.freeze([2000, 2800]),
  // Unit build, body space for torsos and pivot space for limbs.
  bounds: Object.freeze({
    torso: Object.freeze({ min: [-.27, .80, -.20], max: [.27, 1.62, .24] }), arm: Object.freeze({ min: [-.09, -.74, -.14], max: [.09, .08, .10] }),
    leg: Object.freeze({ min: [-.10, -.93, -.22], max: [.10, .09, .13] }), crawlerTorso: Object.freeze({ min: [-.24, .22, -.30], max: [.24, .60, .42] }),
    crawlerArm: Object.freeze({ min: [-.07, -.40, -.13], max: [.07, .05, .07] }), crawlerLeg: Object.freeze({ min: [-.085, -.32, -.16], max: [.085, .06, .10] }),
  }),
  cloth: Object.freeze({ low: .35, high: 1, mean: .7 }), skin: Object.freeze({ low: .4, high: 1 }),
  sole: Object.freeze([-.93, -.91]), toe: -.17,
  chest: Object.freeze({ torso: Object.freeze({ x: .12, y: [1.05, 1.40], z: [-.175, -.145] }), crawlerTorso: Object.freeze({ x: .12, y: [.32, .48], z: [-.25, -.20] }) }),
  // The heads' neck stumps end at body y 1.433-1.455: the torso closes round them.
  neck: Object.freeze([1.445, 1.47]),
  // A crawler leg at rest: pivot (.18, .29, .13), turned -.65 about X.
  crawlerLegRest: Object.freeze({ y: .29, angle: -.65, floor: -.02 }),
  // Per set: a file with two sets (BODIES.md section 3) may be twice as big.
  bytes: Object.freeze({ target: 600_000, cap: 1_000_000 }),
});
const GREY_CHANNELS = ['Cloth', 'Skin', 'Pants', 'Tie'];
const fmt = value => value.toFixed(3);

// Horizontal slices of geometries at y: the points where edges cross it.
function slice(geometries, y) {
  const points = [], a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const geometry of geometries) {
    const position = geometry.attributes.position, index = geometry.index;
    for (let face = 0; face < index.count; face += 3) for (const [p, q] of [[0, 1], [1, 2], [2, 0]]) {
      a.fromBufferAttribute(position, index.getX(face + p)); b.fromBufferAttribute(position, index.getX(face + q));
      if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
      const t = (y - a.y) / (b.y - a.y);
      points.push([a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t]);
    }
  }
  return points;
}
// The largest |x| (or z, toward one side) of a slice band.
function widest(geometries, [low, high], measure) {
  let worst = -Infinity;
  for (let step = 0; step <= 10; step++) for (const point of slice(geometries, low + (high - low) * step / 10)) worst = Math.max(worst, measure(point));
  return worst;
}
const twoSided = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
// Rays from `origin` along each direction: the share that hit the surface
// within `reach`.
function enclosed(geometries, origin, directions, reach = .35) {
  const meshes = geometries.map(geometry => new THREE.Mesh(geometry, twoSided));
  meshes.forEach(mesh => mesh.updateMatrixWorld(true));
  const ray = new THREE.Raycaster(); ray.far = reach;
  return directions.filter(direction => { ray.set(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize()); return ray.intersectObjects(meshes, false).length > 0; }).length / directions.length;
}
function greyStats(geometry) {
  const color = geometry.attributes.color, position = geometry.attributes.position, index = geometry.index;
  let spread = 0, low = Infinity, high = -Infinity, weighted = 0, area = 0;
  for (let vertex = 0; vertex < color.count; vertex++) {
    const r = color.getX(vertex), g = color.getY(vertex), b = color.getZ(vertex);
    spread = Math.max(spread, Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
    low = Math.min(low, r, g, b); high = Math.max(high, r, g, b);
  }
  const p = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3();
  for (let face = 0; face < index.count; face += 3) {
    const [i, j, k] = [index.getX(face), index.getX(face + 1), index.getX(face + 2)];
    p.fromBufferAttribute(position, i); q.fromBufferAttribute(position, j); r.fromBufferAttribute(position, k);
    const size = q.sub(p).cross(r.sub(p)).length() / 2;
    const value = [i, j, k].reduce((sum, vertex) => sum + (color.getX(vertex) + color.getY(vertex) + color.getZ(vertex)) / 3, 0) / 3;
    weighted += size * value; area += size;
  }
  return { spread, low, high, mean: area > 0 ? weighted / area : 0 };
}

// { errors, warnings, parts: [{ name, slot, triangles, min, max, … }] }.
// Every check of BODIES.md the files can show: names and the 25 required
// roots, channels and materials, the grey rule, budgets, bounds, the chest
// plane, the neck, soles and toes. Warnings name softer rules and targets.
export async function checkFrissonBodiesGlb(input) {
  const errors = [], warnings = [], parts = [];
  const { readGlb } = await importPublicModule('frisson/glb.js');
  const { BODY_SLOTS, BRUTE_TORSOS, requiredRoots, bodyRootName, frontOf } = await importPublicModule('frisson/bodies.js');
  let glb;
  try { glb = readGlb(input); } catch (error) { return { errors: [error.message], warnings, parts }; }
  const sets = [...new Set(glb.roots.map(root => bodyRootName(root.name)).filter(Boolean).map(parsed => parsed.set))];
  if (sets.length > 1 && sets.includes(null)) errors.push('either every root names its set (FrissonTorso_A_Shirt) or none does');
  const bytes = input.byteLength ?? input.length, perSet = Math.max(1, sets.length), cap = BODIES_CONTRACT.bytes.cap * perSet, target = BODIES_CONTRACT.bytes.target * perSet;
  const inSets = perSet > 1 ? ` for ${perSet} sets` : '';
  if (bytes > cap) errors.push(`${bytes} bytes, the cap is ${cap}${inSets}`);
  else if (bytes > target) warnings.push(`${bytes} bytes, the target is ${target}${inSets}`);
  const names = new Set();
  for (const root of glb.roots) {
    const where = root.name, parsed = bodyRootName(root.name);
    if (!parsed) { errors.push(`${where}: not a body root name (FrissonTorso_, FrissonArm_, FrissonLeg_, FrissonCrawler_, FrissonCrawlerArm_, FrissonCrawlerLeg_, an optional set and an underscore, then letters and optional digits; no dots)`); continue; }
    if (names.has(root.name)) errors.push(`${where}: duplicate root`);
    names.add(root.name);
    const spec = BODY_SLOTS[parsed.slot], allowed = [...spec.required, ...spec.optional];
    if (!spec.variants.includes(parsed.key) && !(parsed.slot === 'torso' && BRUTE_TORSOS.includes(parsed.key))) warnings.push(`${where}: ${parsed.key} is not a variant the game picks (${spec.variants.join(', ')}${parsed.slot === 'torso' ? `, ${BRUTE_TORSOS.join(', ')}` : ''})`);
    if (root.mesh) errors.push(`${where}: the root must be an empty, not a mesh`);
    const part = { name: root.name, slot: parsed.slot, key: parsed.key, set: parsed.set, triangles: {}, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const geometries = {};
    for (const child of root.children) {
      const channel = child.name.startsWith(`${root.name}_`) ? child.name.slice(root.name.length + 1) : null;
      if (!allowed.includes(channel)) { errors.push(`${child.name}: not a channel of ${root.name} (${allowed.map(name => `_${name}`).join(', ')})`); continue; }
      if (geometries[channel]) { errors.push(`${child.name}: duplicate channel`); continue; }
      if (child.children.length) errors.push(`${child.name}: channels have no children`);
      if (!child.mesh) { errors.push(`${child.name}: no mesh`); continue; }
      const { geometry, material } = child.mesh;
      geometries[channel] = geometry;
      if (material?.name !== BODIES_CONTRACT.materials[channel]) errors.push(`${child.name}: material "${material?.name ?? 'none'}", expected "${BODIES_CONTRACT.materials[channel]}"`);
      if (!geometry.attributes.normal) warnings.push(`${child.name}: no NORMAL (the contract exports smooth normals)`);
      part.triangles[channel] = geometry.index.count / 3;
      geometry.computeBoundingBox();
      ['x', 'y', 'z'].forEach((axis, index) => { part.min[index] = Math.min(part.min[index], geometry.boundingBox.min[axis]); part.max[index] = Math.max(part.max[index], geometry.boundingBox.max[axis]); });
      if (!geometry.attributes.color) { errors.push(`${child.name}: COLOR_0 is missing`); continue; }
      if (!GREY_CHANNELS.includes(channel)) continue;
      const stats = greyStats(geometry);
      const tint = `${child.name}: COLOR_0 multiplies a colour of the look, found a ${(stats.spread * 255).toFixed(0)}/255 tint (linear)`;
      if (stats.spread > TINT_LIMIT) errors.push(`${tint}; keep it grey`);
      else if (stats.spread > GREY_TOLERANCE) warnings.push(tint);
      const range = channel === 'Cloth' ? BODIES_CONTRACT.cloth : channel === 'Skin' ? BODIES_CONTRACT.skin : null;
      if (range && !(stats.low >= range.low - 1e-6 && stats.high <= range.high + 1e-6)) errors.push(`${child.name}: greys ${fmt(stats.low)}..${fmt(stats.high)}, allowed ${range.low}..${range.high}`);
      if (channel === 'Cloth' && !(stats.mean >= BODIES_CONTRACT.cloth.mean)) errors.push(`${child.name}: area-weighted grey ${fmt(stats.mean)}, at least ${BODIES_CONTRACT.cloth.mean} so the family cloth still reads`);
      part[`${channel.toLowerCase()}Grey`] = +stats.mean.toFixed(3);
    }
    for (const channel of spec.required) if (!geometries[channel] && !root.children.some(child => child.name === `${root.name}_${channel}`)) errors.push(`${root.name}_${channel} is missing (required)`);
    part.triangles.total = Object.values(part.triangles).reduce((sum, value) => sum + value, 0);
    if (part.triangles.total > BODIES_CONTRACT.triangles[parsed.slot]) errors.push(`${where}: ${part.triangles.total} triangles, budget ${BODIES_CONTRACT.triangles[parsed.slot]}`);
    const bounds = BODIES_CONTRACT.bounds[parsed.slot];
    ['x', 'y', 'z'].forEach((axis, index) => {
      if (!(part.min[index] >= bounds.min[index] - 1e-3 && part.max[index] <= bounds.max[index] + 1e-3))
        errors.push(`${where}: ${axis} spans ${fmt(part.min[index])}..${fmt(part.max[index])}, allowed ${bounds.min[index]}..${bounds.max[index]}`);
    });
    const all = Object.values(geometries);
    if (all.length) checkShape(parsed.slot, where, geometries, all, part, { errors, warnings, frontOf });
    parts.push(part);
  }
  // Every set is complete, and a body is assembled from one set: the
  // heaviest body of each set keeps the budget.
  const totals = { standing: 0, crawler: 0, sets: {} };
  for (const set of sets.length ? sets : [null]) {
    const label = set === null ? '' : ` of set ${set}`, required = requiredRoots(set);
    for (const name of required) if (!glb.roots.some(root => root.name === name)) errors.push(`${name} is missing (one of the ${required.length} required roots${label})`);
    const heaviest = slot => Math.max(0, ...parts.filter(part => part.slot === slot && part.set === set).map(part => part.triangles.total));
    const standing = heaviest('torso') + 2 * heaviest('arm') + 2 * heaviest('leg'), crawler = heaviest('crawlerTorso') + 2 * heaviest('crawlerArm') + 2 * heaviest('crawlerLeg');
    if (standing > BODIES_CONTRACT.totals.standing) errors.push(`the heaviest standing body${label} has ${standing} triangles, budget ${BODIES_CONTRACT.totals.standing}`);
    else if (standing && (standing < BODIES_CONTRACT.target[0] || standing > BODIES_CONTRACT.target[1])) warnings.push(`the heaviest standing body${label} has ${standing} triangles, target ${BODIES_CONTRACT.target.join('-')}`);
    if (crawler > BODIES_CONTRACT.totals.crawler) errors.push(`the heaviest crawler body${label} has ${crawler} triangles, budget ${BODIES_CONTRACT.totals.crawler}`);
    totals.standing = Math.max(totals.standing, standing); totals.crawler = Math.max(totals.crawler, crawler);
    if (set !== null) totals.sets[set] = { standing, crawler };
  }
  for (const material of glb.materials) if (!Object.values(BODIES_CONTRACT.materials).includes(material.name)) warnings.push(`material "${material.name}" is not used by the contract`);
  return { errors, warnings, parts, totals, sets: sets.filter(set => set !== null) };
}

function checkShape(slot, where, geometries, all, part, { errors, warnings, frontOf }) {
  const C = BODIES_CONTRACT;
  if (slot === 'torso' || slot === 'crawlerTorso') {
    const chest = C.chest[slot], front = geometries.Cloth ? frontOf([geometries.Cloth], chest) : null;
    part.chest = front === null ? null : +front.toFixed(4);
    if (front === null) errors.push(`${where}: no cloth over the chest (|x| <= ${chest.x}, y ${chest.y.join('-')})`);
    else if (!(front >= chest.z[0] - 1e-4 && front <= chest.z[1] + 1e-4)) errors.push(`${where}: the chest front is at z ${fmt(front)}, the markers and armour expect ${chest.z[0]}..${chest.z[1]}`);
  }
  if (slot === 'torso') {
    // Heads must not float: the collar closes round the neck stumps.
    const around = Array.from({ length: 8 }, (_, index) => [Math.sin(index / 8 * Math.PI * 2), 0, -Math.cos(index / 8 * Math.PI * 2)]);
    for (const y of C.neck) {
      const share = enclosed(all, [0, y, 0], around);
      if (share < 1) errors.push(`${where}: at y ${y} the torso does not close round the neck (${Math.round(share * 8)}/8 directions)`);
    }
    const cloth = geometries.Cloth ? [geometries.Cloth] : [];
    const chestWidth = widest(cloth, [1.15, 1.40], ([x]) => Math.abs(x)), waist = widest(cloth, [.95, 1.10], ([x]) => Math.abs(x)), back = widest(cloth, [.95, 1.40], ([, z]) => z);
    if (chestWidth > .235 + 1e-3) warnings.push(`${where}: the cloth is ${fmt(chestWidth)} half-wide at y 1.15-1.40 (contract .235)`);
    if (waist > .19 + 1e-3) warnings.push(`${where}: the cloth is ${fmt(waist)} half-wide at the waist, y .95-1.10 (contract .19)`);
    if (back > .15 + 1e-3) warnings.push(`${where}: the cloth's back reaches z ${fmt(back)} at y .95-1.40 (contract .15, the armoured back plate)`);
    const pelvis = widest(all, [.82, 1.02], ([x]) => Math.abs(x)), pelvisDepth = widest(all, [.82, 1.02], ([, z]) => Math.abs(z));
    if (pelvis > .215 + 1e-3 || pelvisDepth > .15 + 1e-3) warnings.push(`${where}: pelvis and belt reach |x| ${fmt(pelvis)}, |z| ${fmt(pelvisDepth)} at y .82-1.02 (contract .215 and .15)`);
    const scarfX = widest(all, [1.47, 1.47], ([x]) => Math.abs(x)), scarfZ = widest(all, [1.47, 1.47], ([, z]) => Math.abs(z));
    if (scarfX > .24 + 1e-3 || scarfZ > .18 + 1e-3) warnings.push(`${where}: at y 1.47 the torso reaches |x| ${fmt(scarfX)}, |z| ${fmt(scarfZ)}: it would swallow the scarf (contract .24, .18)`);
    let shoulder = -Infinity;
    if (geometries.Cloth) {
      const position = geometries.Cloth.attributes.position;
      for (let index = 0; index < position.count; index++) if (Math.abs(position.getX(index)) >= .12 && Math.abs(position.getX(index)) <= .25) shoulder = Math.max(shoulder, position.getY(index));
    }
    if (shoulder > 1.50 + 1e-3) warnings.push(`${where}: the shoulders rise to y ${fmt(shoulder)} at |x| .12-.25 (contract 1.50)`);
  }
  if (slot === 'crawlerTorso') {
    const share = enclosed(all, [0, .52, -.11], [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [1, 0, 1], [-1, 0, 1]], .3);
    if (share < 1) warnings.push(`${where}: the shoulders do not surround the neck at (0, .52, -.11) (${Math.round(share * 5)}/5 directions)`);
  }
  if (slot === 'leg' || slot === 'crawlerLeg') {
    if (slot === 'leg') {
      if (!(part.min[1] >= C.sole[0] - 1e-4 && part.min[1] <= C.sole[1] + 1e-4)) errors.push(`${where}: the sole is at y ${fmt(part.min[1])}, the contract puts it at -.92 +- .01`);
      // The toe: the most forward point of the foot (below y -.8) points down -Z.
      let toe = Infinity;
      for (const geometry of all) { const position = geometry.attributes.position; for (let index = 0; index < position.count; index++) if (position.getY(index) < -.8) toe = Math.min(toe, position.getZ(index)); }
      if (!(toe <= C.toe)) errors.push(`${where}: the toe reaches z ${Number.isFinite(toe) ? fmt(toe) : 'nothing'}, it must point forward to z <= ${C.toe}`);
    } else {
      // At rest the crawler drags it behind: it must stay above the floor.
      const { y: pivot, angle, floor } = C.crawlerLegRest, cos = Math.cos(angle), sin = Math.sin(angle);
      let lowest = Infinity;
      for (const geometry of all) { const position = geometry.attributes.position; for (let index = 0; index < position.count; index++) lowest = Math.min(lowest, pivot + position.getY(index) * cos - position.getZ(index) * sin); }
      if (!(lowest >= floor - 1e-4)) errors.push(`${where}: at rest the leg reaches body y ${fmt(lowest)}, below the floor (${floor})`);
    }
  }
}

// --- Survivors (art/frisson/SURVIVORS.md) -----------------------------------------------
export const SURVIVORS_CONTRACT = Object.freeze({
  materials: Object.freeze({ Cloth: 'cloth', Detail: 'detail', Glow: 'glow' }),
  // Triangles per root (Torso and Gear together, per character), and per survivor.
  triangles: Object.freeze({ Head: 1400, Torso: 1200, Hips: 250, Arm: 200, ArmL: 200, Hand: 150, HandL: 150, Thigh: 150, Shin: 150, Boot: 150 }),
  total: 4500, target: Object.freeze([2800, 3800]),
  // Head-local for heads, body space (standing) for Torso, Gear and Hips,
  // arm pivot space for Arm and Hand, hip pivot space for Thigh, Shin, Boot.
  bounds: Object.freeze({
    Head: Object.freeze({ min: [-.21, -.21, -.24], max: [.21, .23, .22] }), Torso: Object.freeze({ min: [-.25, .86, -.21], max: [.25, 1.54, .17] }),
    Gear: Object.freeze({ min: [-.25, .86, -.21], max: [.25, 1.54, .17] }), Hips: Object.freeze({ min: [-.22, .80, -.16], max: [.22, 1.00, .15] }),
    Arm: Object.freeze({ min: [-.075, -.44, -.075], max: [.075, .08, .075] }), ArmL: Object.freeze({ min: [-.075, -.44, -.075], max: [.075, .08, .075] }),
    Hand: Object.freeze({ min: [-.065, -.575, -.07], max: [.065, -.40, .07] }), HandL: Object.freeze({ min: [-.065, -.575, -.07], max: [.065, -.40, .07] }),
    Thigh: Object.freeze({ min: [-.10, -.44, -.10], max: [.10, .09, .10] }), Shin: Object.freeze({ min: [-.09, -.73, -.09], max: [.09, -.31, .09] }),
    Boot: Object.freeze({ min: [-.10, -.81, -.21], max: [.10, -.66, .10] }),
  }),
  raiderHeadTop: .24,
  cloth: Object.freeze({ low: .40, high: 1, mean: .75 }),
  // The head swings ±0.495 rad with the aim: below -.10 it stays within .215 of its pivot.
  nod: Object.freeze({ below: -.10, radius: .215 }),
  sole: Object.freeze([-.815, -.805]), toe: -.17,
  grip: Object.freeze([0, -.51, 0]), cuff: Object.freeze({ top: -.40, radius: .052 }),
  // The teammate torch beside the collar, and the floor under a downed survivor.
  torch: Object.freeze({ x: [.10, .22], y: [1.42, 1.54], z: -.13 }),
  downed: Object.freeze({ lift: .16, cos: .0937, sin: .9956, floor: .01, head: 1.67 }),
  neck: Object.freeze([1.44, 1.51]), backpack: Object.freeze({ back: .155, chest: -.185, shoulder: 1.415 }),
  meshes: Object.freeze({ survivor: 14, raider: 15 }),
  raiderRed: 0xd8453b,
  bytes: Object.freeze({ target: 600_000, cap: 1_000_000 }),
});

// Shells (faces joined by shared positions) whose faces look inward: from
// just off each face, a ray along its normal crosses the rest of its shell
// an odd number of times when the face looks into the solid.
export function inwardShare(geometry) {
  const position = geometry.attributes.position, index = geometry.index, faces = index.count / 3;
  const weld = new Map(), ids = new Int32Array(position.count);
  for (let vertex = 0; vertex < position.count; vertex++) {
    const label = `${Math.round(position.getX(vertex) * 1e5)},${Math.round(position.getY(vertex) * 1e5)},${Math.round(position.getZ(vertex) * 1e5)}`;
    if (!weld.has(label)) weld.set(label, weld.size);
    ids[vertex] = weld.get(label);
  }
  const parent = Array.from({ length: weld.size }, (_, value) => value), root = value => { while (parent[value] !== value) value = parent[value] = parent[parent[value]]; return value; };
  for (let face = 0; face < faces; face++) {
    const [a, b, c] = [0, 1, 2].map(corner => root(ids[index.getX(face * 3 + corner)]));
    parent[b] = a; parent[root(c)] = root(a);
  }
  const shells = new Map(), corners = face => [0, 1, 2].map(corner => new THREE.Vector3().fromBufferAttribute(position, index.getX(face * 3 + corner)));
  for (let face = 0; face < faces; face++) {
    const shell = root(ids[index.getX(face * 3)]);
    if (!shells.has(shell)) shells.set(shell, []);
    shells.get(shell).push(corners(face));
  }
  let inward = 0, total = 0, worst = 0;
  const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3(), s = new THREE.Vector3();
  const crosses = (origin, direction, [a, b, c]) => {
    edge1.subVectors(b, a); edge2.subVectors(c, a); p.crossVectors(direction, edge2);
    const det = edge1.dot(p);
    if (Math.abs(det) < 1e-12) return false;
    s.subVectors(origin, a);
    const u = s.dot(p) / det; if (u < 0 || u > 1) return false;
    q.crossVectors(s, edge1);
    const v = direction.dot(q) / det; if (v < 0 || u + v > 1) return false;
    return edge2.dot(q) / det > 1e-6;
  };
  for (const list of shells.values()) {
    let shellInward = 0, shellArea = 0;
    for (const triangle of list) {
      const normal = new THREE.Vector3().crossVectors(edge1.subVectors(triangle[1], triangle[0]), edge2.subVectors(triangle[2], triangle[0]));
      const area = normal.length() / 2;
      if (area < 1e-10) continue;
      normal.normalize();
      const origin = new THREE.Vector3().addVectors(triangle[0], triangle[1]).add(triangle[2]).divideScalar(3).addScaledVector(normal, 1e-5);
      // A slightly skewed ray, so it never runs exactly along an edge.
      const direction = normal.clone().add(new THREE.Vector3(.0123, .0071, -.0097)).normalize();
      const hits = list.reduce((count, other) => count + (other !== triangle && crosses(origin, direction, other) ? 1 : 0), 0);
      if (hits % 2) shellInward += area;
      shellArea += area;
    }
    inward += shellInward; total += shellArea;
    if (shellArea > 0) worst = Math.max(worst, shellInward / shellArea);
  }
  return { share: total > 0 ? inward / total : 0, worst, shells: shells.size };
}

// The parts a character assembles (its own, or _Common), as the game does.
function assembled(roots, name) {
  const own = roots.get(name) ?? {}, common = roots.get('Common') ?? {}, raider = /^Raider\d*$/.test(name);
  const shared = part => own[part] ?? common[part] ?? null;
  return { Head: own.Head ?? null, Torso: own.Torso ?? null, Gear: own.Gear ?? null, Hips: shared('Hips'), Arm: shared('Arm'), ArmL: raider ? own.ArmL ?? null : shared('ArmL'),
    Hand: shared('Hand'), HandL: shared('HandL'), Thigh: shared('Thigh'), Shin: shared('Shin'), Boot: shared('Boot') };
}
const hueOfRgb = ([r, g, b]) => { const max = Math.max(r, g, b), min = Math.min(r, g, b); if (max - min < 1e-6) return null; const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4; return (h * 60 + 360) % 360; };

// { errors, warnings, parts, characters }: every rule of SURVIVORS.md the
// files can show: names, the 8 required characters and their parts (own or
// _Common), channels and materials, the grey rule, budgets per part and per
// survivor, bounds, the head's nod, the collar, the torch and backpack fit,
// the floor when downed, the sole and toe, the grip-centred hand and its
// cuff, faces wound outward, and a raider's hostile cues.
export async function checkFrissonSurvivorsGlb(input) {
  const C = SURVIVORS_CONTRACT, errors = [], warnings = [], parts = [], characters = [];
  const { readGlb } = await importPublicModule('frisson/glb.js');
  const { survivorRootName, SURVIVOR_PARTS, CHARACTERS, HUMAN_POOL, RAIDER, COMMON } = await importPublicModule('frisson/survivors.js');
  let glb;
  try { glb = readGlb(input); } catch (error) { return { errors: [error.message], warnings, parts, characters }; }
  const bytes = input.byteLength ?? input.length;
  if (bytes > C.bytes.cap) errors.push(`${bytes} bytes, the cap is ${C.bytes.cap}`);
  else if (bytes > C.bytes.target) warnings.push(`${bytes} bytes, the target is ${C.bytes.target}`);
  const byCharacter = new Map(), names = new Set();
  for (const root of glb.roots) {
    const where = root.name, parsed = survivorRootName(root.name);
    if (!parsed) { errors.push(`${where}: not a survivor root name (FrissonSurvivor<Part>_<Character>, Part one of ${Object.keys(SURVIVOR_PARTS).join(', ')}; the character letters then digits, or Common)`); continue; }
    if (names.has(root.name)) errors.push(`${where}: duplicate root`);
    names.add(root.name);
    const { part: kind, character, key } = parsed, raider = key === RAIDER;
    if (character === COMMON && SURVIVOR_PARTS[kind] === 'own') errors.push(`${where}: ${kind} belongs to each character, never to _Common`);
    if (character === COMMON && kind === 'Gear') warnings.push(`${where}: Gear is per character; _Common Gear is never used`);
    if (character !== COMMON && !CHARACTERS.includes(key) && key !== RAIDER) warnings.push(`${where}: ${key} is not a character the game picks (${CHARACTERS.join(', ')}, ${RAIDER}; alternates add digits)`);
    if (root.mesh) errors.push(`${where}: the root must be an empty, not a mesh`);
    const part = { name: root.name, part: kind, character, triangles: {}, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const geometries = {};
    const allowed = kind === 'Head' && raider ? ['Cloth', 'Detail', 'Glow'] : ['Cloth', 'Detail'];
    for (const child of root.children) {
      const channel = child.name.startsWith(`${root.name}_`) ? child.name.slice(root.name.length + 1) : null;
      if (!allowed.includes(channel)) { errors.push(`${child.name}: not a channel of ${root.name} (${allowed.map(name => `_${name}`).join(', ')}${channel === 'Glow' ? '; _Glow is for raider heads only' : ''})`); continue; }
      if (geometries[channel]) { errors.push(`${child.name}: duplicate channel`); continue; }
      if (child.children.length) errors.push(`${child.name}: channels have no children`);
      if (!child.mesh) { errors.push(`${child.name}: no mesh`); continue; }
      const { geometry, material } = child.mesh;
      geometries[channel] = geometry;
      if (material?.name !== C.materials[channel]) errors.push(`${child.name}: material "${material?.name ?? 'none'}", expected "${C.materials[channel]}"`);
      if (material?.doubleSided) errors.push(`${child.name}: materials are single-sided (every face wound outward)`);
      if (!geometry.attributes.normal) warnings.push(`${child.name}: no NORMAL (the contract exports smooth normals)`);
      part.triangles[channel] = geometry.index.count / 3;
      geometry.computeBoundingBox();
      ['x', 'y', 'z'].forEach((axis, index) => { part.min[index] = Math.min(part.min[index], geometry.boundingBox.min[axis]); part.max[index] = Math.max(part.max[index], geometry.boundingBox.max[axis]); });
      const winding = inwardShare(geometry);
      if (winding.worst > .5) errors.push(`${child.name}: a shell is wound inward (${Math.round(winding.worst * 100)} % of its area faces in; the game draws front faces only)`);
      else if (winding.share > .05) warnings.push(`${child.name}: ${Math.round(winding.share * 100)} % of the area faces inward`);
      if (channel === 'Glow') continue;
      if (!geometry.attributes.color) { errors.push(`${child.name}: COLOR_0 is missing`); continue; }
      if (channel !== 'Cloth') continue;
      const stats = greyStats(geometry);
      const tint = `${child.name}: COLOR_0 multiplies the player colour, found a ${(stats.spread * 255).toFixed(0)}/255 tint (linear)`;
      if (stats.spread > TINT_LIMIT) errors.push(`${tint}; keep it grey`);
      else if (stats.spread > GREY_TOLERANCE) warnings.push(tint);
      if (!(stats.low >= C.cloth.low - 1e-6 && stats.high <= C.cloth.high + 1e-6)) errors.push(`${child.name}: greys ${fmt(stats.low)}..${fmt(stats.high)}, allowed ${C.cloth.low}..${C.cloth.high}`);
      if (!(stats.mean >= C.cloth.mean)) errors.push(`${child.name}: area-weighted grey ${fmt(stats.mean)}, at least ${C.cloth.mean} so the player colour still reads`);
      part.clothGrey = +stats.mean.toFixed(3);
    }
    if (!geometries.Cloth && !geometries.Detail) errors.push(`${where}: needs a _Cloth or a _Detail child`);
    part.triangles.total = Object.values(part.triangles).reduce((sum, value) => sum + value, 0);
    if (kind !== 'Torso' && kind !== 'Gear' && part.triangles.total > C.triangles[kind]) errors.push(`${where}: ${part.triangles.total} triangles, budget ${C.triangles[kind]}`);
    const bounds = C.bounds[kind], top = kind === 'Head' && raider ? C.raiderHeadTop : bounds.max[1];
    ['x', 'y', 'z'].forEach((axis, index) => {
      const high = index === 1 ? top : bounds.max[index];
      if (!(part.min[index] >= bounds.min[index] - 1e-3 && part.max[index] <= high + 1e-3))
        errors.push(`${where}: ${axis} spans ${fmt(part.min[index])}..${fmt(part.max[index])}, allowed ${bounds.min[index]}..${high}`);
    });
    const all = Object.values(geometries);
    if (all.length) checkSurvivorShape(kind, where, all, geometries, part, { errors, warnings, raider });
    parts.push(part);
    if (!byCharacter.has(character)) byCharacter.set(character, {});
    byCharacter.get(character)[kind] = part;
  }
  // Characters: the 8 required ones, alternates and raiders, each complete.
  const present = [...byCharacter.keys()].filter(name => name !== COMMON);
  for (const name of CHARACTERS) if (!byCharacter.has(name)) errors.push(`${name} is missing (one of the ${CHARACTERS.length} required characters)`);
  for (const name of present) {
    const key = survivorRootName(`FrissonSurvivorHead_${name}`)?.key, raider = key === RAIDER, wears = assembled(byCharacter, name);
    const missing = ['Head', 'Torso', 'Hips', 'Arm', 'Hand', 'Thigh', 'Shin', 'Boot'].filter(kind => !wears[kind]);
    if (raider && !wears.ArmL) missing.push('ArmL (its own: the armband)');
    if (missing.length) errors.push(`${name}: no ${missing.join(', ')} (its own${raider ? '' : ' or _Common'}); the game keeps it all Famille`);
    if (raider && wears.Head && !wears.Head.triangles.Glow) errors.push(`${name}: the head has no _Glow (the goggle lenses and side lamps)`);
    const torso = (wears.Torso?.triangles.total ?? 0) + (wears.Gear?.triangles.total ?? 0);
    if (torso > C.triangles.Torso) errors.push(`${name}: Torso and Gear have ${torso} triangles, budget ${C.triangles.Torso}`);
    const limb = (right, left) => (wears[left] ?? wears[right])?.triangles.total ?? 0;
    const total = (wears.Head?.triangles.total ?? 0) + torso + (wears.Hips?.triangles.total ?? 0)
      + (wears.Arm?.triangles.total ?? 0) + limb('Arm', 'ArmL') + (wears.Hand?.triangles.total ?? 0) + limb('Hand', 'HandL') + 2 * ((wears.Thigh?.triangles.total ?? 0) + (wears.Shin?.triangles.total ?? 0) + (wears.Boot?.triangles.total ?? 0));
    const meshes = 1 + (raider && wears.Head?.triangles.Glow ? 1 : 0) + 1 + (wears.Gear ? 1 : 0) + 1 + 10;
    if (total > C.total) errors.push(`${name}: ${total} triangles for a whole survivor, budget ${C.total}`);
    else if (!missing.length && (total < C.target[0] || total > C.target[1])) warnings.push(`${name}: ${total} triangles, target ${C.target.join('-')}`);
    if (meshes > (raider ? C.meshes.raider : C.meshes.survivor)) errors.push(`${name}: ${meshes} meshes, at most ${raider ? C.meshes.raider : C.meshes.survivor}`);
    if (raider) {
      if (wears.Head && !wears.Head.red) errors.push(`${name}: no red mask (0xd8453b within 8° of hue) in the head's _Detail`);
      if (wears.ArmL && !wears.ArmL.red) errors.push(`${name}: no red armband in ArmL's _Detail`);
      if (wears.Head && wears.Head.skin) errors.push(`${name}: a raider shows no face (skin tones found in the head's _Detail)`);
    }
    characters.push({ name, raider, triangles: total, meshes, complete: !missing.length });
  }
  if (!present.some(name => HUMAN_POOL.includes(survivorRootName(`FrissonSurvivorHead_${name}`)?.key))) errors.push(`no character for the players outside the companions (${HUMAN_POOL.join(', ')})`);
  for (const material of glb.materials) if (!Object.values(C.materials).includes(material.name)) warnings.push(`material "${material.name}" is not used by the contract`);
  return { errors, warnings, parts, characters };
}

function checkSurvivorShape(kind, where, all, geometries, part, { errors, warnings, raider }) {
  const C = SURVIVORS_CONTRACT, point = new THREE.Vector3();
  const each = visit => { for (const geometry of all) { const position = geometry.attributes.position; for (let index = 0; index < position.count; index++) visit(point.fromBufferAttribute(position, index)); } };
  const downed = (y, z) => C.downed.lift + C.downed.cos * y - C.downed.sin * z;
  if (kind === 'Head') {
    let far = 0, low = Infinity;
    each(p => { if (p.y < C.nod.below) far = Math.max(far, p.length()); low = Math.min(low, downed(C.downed.head + p.y, p.z)); });
    if (far > C.nod.radius + 1e-3) errors.push(`${where}: below head-local ${C.nod.below} it reaches ${fmt(far)} from the pivot (at most ${C.nod.radius}: the aim nods the head ±0.495 rad)`);
    if (low < C.downed.floor - 1e-4) errors.push(`${where}: downed, it goes ${fmt(C.downed.floor - low)} into the floor`);
    // Colours: a raider's red mask, and no face.
    const detail = geometries.Detail?.attributes.color;
    if (detail) {
      const red = hueOfRgb(lin(C.raiderRed));
      for (let index = 0; index < detail.count; index++) {
        const rgb = [detail.getX(index), detail.getY(index), detail.getZ(index)], hue = hueOfRgb(rgb), bright = Math.max(...rgb);
        if (hue !== null && bright > .2 && Math.abs(((hue - red + 540) % 360) - 180) <= 8 && rgb[0] > 2 * rgb[1]) part.red = true;
        if (hue !== null && hue >= 15 && hue <= 40 && bright > .25 && rgb[0] > rgb[2] * 1.4 && rgb[0] < rgb[1] * 2.6) part.skin = true;
      }
    }
  }
  if (kind === 'Torso' || kind === 'Gear' || kind === 'Hips') {
    let torch = 0, back = -Infinity, chest = Infinity, shoulder = -Infinity, low = Infinity;
    each(p => {
      if (p.x >= C.torch.x[0] && p.x <= C.torch.x[1] && p.y >= C.torch.y[0] && p.y <= C.torch.y[1] && p.z < C.torch.z) torch++;
      if (Math.abs(p.x) <= .2 && p.y >= .95 && p.y <= 1.42) back = Math.max(back, p.z);
      if (Math.abs(p.x) >= .14 && Math.abs(p.x) <= .18 && p.y >= 1.0 && p.y <= 1.42) { chest = Math.min(chest, p.z); shoulder = Math.max(shoulder, p.y); }
      low = Math.min(low, downed(p.y, p.z));
    });
    if (torch) errors.push(`${where}: ${torch} point(s) where the teammate torch hangs (x ${C.torch.x.join('..')}, y ${C.torch.y.join('..')}, z < ${C.torch.z})`);
    if (back > C.backpack.back + 1e-3) warnings.push(`${where}: the back reaches z ${fmt(back)} where the backpack sits (at most ${C.backpack.back})`);
    if (chest < C.backpack.chest - 1e-3) warnings.push(`${where}: at |x| .14-.18 the chest comes forward to z ${fmt(chest)}, over the pack's straps (at most ${C.backpack.chest})`);
    if (kind !== 'Hips' && shoulder > C.backpack.shoulder + 1e-3) warnings.push(`${where}: at |x| .14-.18 the shoulders rise to ${fmt(shoulder)} where the pack's straps loop (at most ${C.backpack.shoulder})`);
    if (low < C.downed.floor - 1e-4) errors.push(`${where}: downed, it goes ${fmt(C.downed.floor - low)} into the floor`);
  }
  if (kind === 'Torso') {
    // The collar or scarf closes round the neck, so a full nod shows no gap.
    const around = Array.from({ length: 8 }, (_, index) => [Math.sin(index / 8 * Math.PI * 2), 0, -Math.cos(index / 8 * Math.PI * 2)]);
    for (const y of C.neck) {
      const share = enclosed(all, [0, y, 0], around, .2);
      if (share < 1) errors.push(`${where}: at y ${y} the collar does not close round the neck (${Math.round(share * 8)}/8 directions)`);
    }
  }
  if (kind === 'Hand' || kind === 'HandL') {
    const [gx, gy, gz] = C.grip, centre = [(part.min[0] + part.max[0]) / 2, (part.min[2] + part.max[2]) / 2];
    if (!(part.min[1] <= gy && part.max[1] >= gy) || Math.hypot(centre[0] - gx, centre[1] - gz) > .02) errors.push(`${where}: the hand is not centred on the grip (0, ${gy}, 0): bounds centre x ${fmt(centre[0])}, z ${fmt(centre[1])}, y ${fmt(part.min[1])}..${fmt(part.max[1])}`);
    if (part.max[1] < C.cuff.top - .005) errors.push(`${where}: the cuff stops at y ${fmt(part.max[1])}; it must reach ${C.cuff.top} to tuck into the sleeve at every stretch`);
    let wide = 0;
    each(p => { if (p.y > -.46) wide = Math.max(wide, Math.hypot(p.x, p.z)); });
    if (wide > C.cuff.radius + 1e-3) errors.push(`${where}: the cuff is ${fmt(wide)} wide above y -.46 (at most ${C.cuff.radius}: it slides into the sleeve)`);
  }
  if (kind === 'ArmL' && raider) {
    const color = geometries.Detail?.attributes.color, red = hueOfRgb(lin(C.raiderRed));
    if (color) for (let index = 0; index < color.count; index++) { const rgb = [color.getX(index), color.getY(index), color.getZ(index)], hue = hueOfRgb(rgb); if (hue !== null && Math.abs(((hue - red + 540) % 360) - 180) <= 8 && rgb[0] > 2 * rgb[1]) part.red = true; }
  }
  if (kind === 'Boot') {
    if (!(part.min[1] >= C.sole[0] - 1e-4 && part.min[1] <= C.sole[1] + 1e-4)) errors.push(`${where}: the sole is at y ${fmt(part.min[1])}, the contract puts it at -.81 +- .005 (body .09)`);
    let toe = Infinity;
    each(p => { if (p.y < -.75) toe = Math.min(toe, p.z); });
    if (!(toe <= C.toe)) errors.push(`${where}: the toe reaches z ${Number.isFinite(toe) ? fmt(toe) : 'nothing'}, it must point forward to z <= ${C.toe}`);
  }
}
const lin = hex => { const color = new THREE.Color(hex); return [color.r, color.g, color.b]; };

// --- Markers (art/frisson/MARKERS.md) ----------------------------------------
export const MARKERS_CONTRACT = Object.freeze({
  // Triangles per family, standing set; the crawler set stays under 70 %.
  triangles: Object.freeze({ sallow: 500, rust: 600, scarlet: 700, umber: 900, charcoal: 900, hulk: 900, iron: 1200, dread: 1500, overlord: 1800 }),
  crawlerShare: .7,
  // Front-projected area bands (m²); the side shows at least half the front.
  front: Object.freeze({ sallow: [.015, .030], rust: [.024, .040], scarlet: [.040, .065], umber: [.070, .110], charcoal: [.080, .130], hulk: [.020, .040], iron: [.045, .075], dread: [.080, .120], overlord: [.090, .140] }),
  // Bounds per anchor, in the anchor's reference frame: [min, max] per axis.
  bounds: Object.freeze({
    Torso: Object.freeze([[-.30, .80, -.23], [.30, 1.62, .30]]), Shoulders: Object.freeze([[-.30, .80, -.23], [.30, 1.62, .30]]),
    Neck: Object.freeze([[-.20, 1.40, -.24], [.20, 1.62, .20]]),
    Skull: Object.freeze([[-.30, -.25, -.32], [.30, .20, .30]]), Face: Object.freeze([[-.30, -.25, -.32], [.30, .20, .30]]), Jaw: Object.freeze([[-.30, -.25, -.32], [.30, .20, .30]]),
    Helmet: Object.freeze([[-.29, .12, -.29], [.29, .225, .29]]),
    ArmR: Object.freeze([[-.10, -.62, -.12], [.10, -.30, .10]]),
    CrawlerTorso: Object.freeze([[-.26, .20, -.32], [.26, .62, .45]]), CrawlerArmR: Object.freeze([[-.09, -.40, -.15], [.09, -.20, .09]]),
  }),
  // M3: never pastel; metal glints and buckles may reach 0xCC on 6 % of a root.
  glint: Object.freeze({ high: 0xcc, limit: 0xb4, share: .06 }),
  // M7: embers a deep red-orange, the overlord's nail tips amber (0xFFB060).
  glowHue: Object.freeze({ charcoal: [10, 25], overlord: [25, 40] }), glowArea: .15,
  // M5 on the measured variants: 2 cm off the surface, 1 cm into it. The
  // nearest-triangle measure on faceted thin limbs reads about a centimetre
  // above the radial-envelope numbers the contract was calibrated with, so
  // the floating error fires at 2 cm + that noise; 1.5-2.5 cm is a warning.
  gap: .02, gapNoise: .005, penetration: .01,
  bytes: Object.freeze({ target: 400_000, cap: 800_000 }),
});
const WALKER_FAMILIES = new Set(['sallow', 'rust', 'scarlet', 'umber', 'charcoal']);
const COLOSSUS_FAMILIES = new Set(['hulk', 'iron', 'dread', 'overlord']);
// The build the colossi wear (zombies.js BUILDS.hulking); their pieces are
// authored at its unit size (MARKERS.md section 1).
const HULKING = Object.freeze({ w: 1.16, d: 1.12, hunch: .14 });
const HEAD_ANCHORS = new Set(['Skull', 'Face', 'Jaw']);
const BODY_ANCHORS = new Set(['Torso', 'Shoulders', 'Neck']);
const capitalOf = id => id[0].toUpperCase() + id.slice(1);
// COLOR_0 is linear (glTF); the contract's colour rules are in sRGB bytes.
const srgb8 = value => Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055));
const hueOf = (r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  if (max === r) return (60 * (g - b) / (max - min) + 360) % 360;
  return max === g ? 60 * (b - r) / (max - min) + 120 : 60 * (r - g) / (max - min) + 240;
};

// The triangles of a mesh as [[x, y, z] x 3], shifted into the unit build
// (heads sit at y 1.68, the right arm's pivot at (.30, 1.42, 0)).
const soup = (geometry, shift = [0, 0, 0]) => {
  const position = geometry.attributes.position, index = geometry.index, out = [];
  const at = vertex => [0, 1, 2].map(axis => position.getComponent(vertex, axis) + shift[axis]);
  for (let face = 0; face < index.count; face += 3) out.push([at(index.getX(face)), at(index.getX(face + 1)), at(index.getX(face + 2))]);
  return out;
};

// The area the player sees, as test/frisson-marks-a.test.mjs measures it: a
// depth raster at 2.5 mm cells per view (front from -Z, sides from +-X), with
// the unit body and the reference head as occluders (8 mm tolerance). The
// occluders are the contract's reference envelopes (MARKERS.md section 3),
// not a proposal's tables.
const CELL = .0025, SEEN_TOL = .008;
const VIEWS = { front: p => [p[0], p[1], p[2]], sideR: p => [p[2], p[1], -p[0]], sideL: p => [-p[2], p[1], p[0]] };
function depthRaster(tris, view, buffer = new Map()) {
  const project = VIEWS[view];
  for (const tri of tris) {
    const [a, b, c] = tri.map(project);
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-14) continue;
    const i0 = Math.floor(Math.min(a[0], b[0], c[0]) / CELL), i1 = Math.ceil(Math.max(a[0], b[0], c[0]) / CELL);
    const j0 = Math.floor(Math.min(a[1], b[1], c[1]) / CELL), j1 = Math.ceil(Math.max(a[1], b[1], c[1]) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = (i + .5) * CELL, y = (j + .5) * CELL;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      const z = u * a[2] + v * b[2] + w * c[2], key = i * 100003 + j;
      if (z < (buffer.get(key) ?? Infinity)) buffer.set(key, z);
    }
  }
  return buffer;
}
// The unit torso envelope (chest front -.160, shoulders half .235 at y
// 1.38-1.50, waist .19, collar to 1.55), the reference skull (temple .150,
// top .210, brow -.215, back .220) at y 1.68 and the right forearm.
function occluderTriangles() {
  const out = [], ths = Array.from({ length: 24 }, (_, j) => j * 15 * Math.PI / 180);
  // Elliptical torso profile: [top y, rx, rz] about the axis (0, y, -.01).
  const profile = [[.80, .19, .16], [1.00, .19, .16], [1.05, .21, .15], [1.38, .21, .15], [1.50, .235, .15], [1.55, .14, .12], [1.62, .09, .09]];
  const at = (y, th, rx, rz) => [rx * Math.sin(th), y, -.01 - rz * Math.cos(th)];
  let prev = null;
  for (let row = 0; row < profile.length; row++) {
    const [y, rx, rz] = profile[row], ring = ths.map(th => at(y, th, rx, rz));
    if (prev) for (let j = 0; j < 24; j++) {
      const k = (j + 1) % 24;
      out.push([prev[j], prev[k], ring[k]], [prev[j], ring[k], ring[j]]);
    }
    prev = ring;
  }
  for (const [ring, y] of [[ths.map(th => at(profile[0][0], th, profile[0][1], profile[0][2])), profile[0][0]], [prev, profile.at(-1)[0]]])
    for (let j = 0; j < 24; j++) out.push([ring[j], ring[(j + 1) % 24], [0, y, -.01]]);
  // The reference skull: an ellipsoid at (0, 1.68, 0).
  const skull = (th, ph) => [Math.cos(ph) * Math.sin(th) * .150, 1.68 + Math.sin(ph) * .205, -Math.cos(ph) * Math.cos(th) * .2175];
  const phs = Array.from({ length: 17 }, (_, i) => (-75 + 10 * i) * Math.PI / 180);
  let rows = phs.map(ph => ths.map(th => skull(th, ph)));
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < 24; j++) {
    const k = (j + 1) % 24;
    out.push([rows[i][j], rows[i][k], rows[i + 1][k]], [rows[i][j], rows[i + 1][k], rows[i + 1][j]]);
  }
  for (const [ring, sign] of [[rows[0], -1], [rows[rows.length - 1], 1]]) {
    const pole = [0, 1.68 + sign * .205, 0];
    for (let j = 0; j < 24; j++) out.push([ring[j], ring[(j + 1) % 24], pole]);
  }
  // The right forearm: a 5 cm capsule from the pivot (.30, 1.42, 0) down.
  rows = [[.80, .05], [1.42, .05]].map(([y, r]) => ths.map(th => [.30 + r * Math.sin(th), y, -.02 - r * Math.cos(th)]));
  for (let j = 0; j < 24; j++) {
    const k = (j + 1) % 24;
    out.push([rows[0][j], rows[0][k], rows[1][k]], [rows[0][j], rows[1][k], rows[1][j]]);
    out.push([rows[0][j], rows[1][j], [.30, .80, -.02]], [rows[1][j], rows[1][k], [.30, 1.42, -.02]]);
  }
  return out;
}
let OCCLUDERS = null;
const occluderDepth = view => (OCCLUDERS ??= Object.fromEntries(Object.keys(VIEWS).map(name => [name, depthRaster(occluderTriangles(), name)])))[view];
const AREA_OFFSET = anchor => HEAD_ANCHORS.has(anchor) || anchor === 'Helmet' ? [0, 1.68, 0] : anchor === 'ArmR' ? [.3, 1.42, 0] : [0, 0, 0];
// What the player sees of a family's standing pieces: { front, side, glow }.
function visibleAreas(standing) {
  const out = { glow: 0 };
  for (const view of Object.keys(VIEWS)) {
    const mark = new Map(), glow = new Map();
    for (const record of standing) for (const [channel, { geometry }] of Object.entries(record.channels))
      depthRaster(soup(geometry, AREA_OFFSET(record.anchor)), view, channel === 'Glow' ? glow : mark);
    const occ = occluderDepth(view), seen = new Set();
    for (const buffer of [mark, glow]) for (const [key, z] of buffer) if (z < (occ.get(key) ?? Infinity) + SEEN_TOL) seen.add(key);
    out[view] = seen.size * CELL * CELL;
    if (view === 'front') for (const [key, z] of glow) if (seen.has(key) && z <= (mark.get(key) ?? Infinity) + 1e-9) out.glow += CELL * CELL;
  }
  return { front: out.front, side: (out.sideR + out.sideL) / 2, glow: out.glow };
}

// Ericson's closest point on a triangle (Real-Time Collision Detection 5.1.5).
function closestOnTriangle(px, py, pz, tri, out) {
  const ax = tri[0], ay = tri[1], az = tri[2], bx = tri[3], by = tri[4], bz = tri[5], cx = tri[6], cy = tri[7], cz = tri[8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); out[0] = ax + t * abx; out[1] = ay + t * aby; out[2] = az + t * abz; return; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); out[0] = ax + t * acx; out[1] = ay + t * acy; out[2] = az + t * acz; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + d5 - d6); out[0] = bx + t * (cx - bx); out[1] = by + t * (cy - by); out[2] = bz + t * (cz - bz); return; }
  const v = vb / (va + vb + vc), w = vc / (va + vb + vc);
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}

// A triangle soup with nearest-point queries on a uniform grid, for the M5
// fit checks. The query answers within a 4 cm reach; past it a piece floats.
const REACH = .04;
// A torso build as a Matrix4 (bodies.js torsoTransform), for the surfaces
// the colossus pieces are fitted to (the hulking build).
const buildMatrix = ({ scale, rotationX = 0, position }) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotationX, 0, 0)), new THREE.Vector3(...scale));
function buildSurface(geometries, matrix = null) {
  const cell = .05, tris = [], grid = new Map();
  const p = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
  const cells = (min, max) => [Math.floor((min - REACH) / cell), Math.floor((max + REACH) / cell)];
  for (const geometry of geometries) {
    const position = geometry.attributes.position, index = geometry.index, count = index ? index.count : position.count;
    for (let face = 0; face < count; face += 3) {
      const at = (target, offset) => { target.fromBufferAttribute(position, index ? index.getX(face + offset) : face + offset); if (matrix) target.applyMatrix4(matrix); };
      at(p, 0); at(q, 1); at(r, 2);
      n.subVectors(q, p).cross(e.subVectors(r, p));
      if (n.lengthSq() < 1e-16) continue;
      n.normalize();
      const tri = [p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z, n.x, n.y, n.z], slot = tris.length;
      tris.push(tri);
      const [i0, i1] = cells(Math.min(p.x, q.x, r.x), Math.max(p.x, q.x, r.x)), [j0, j1] = cells(Math.min(p.y, q.y, r.y), Math.max(p.y, q.y, r.y)), [k0, k1] = cells(Math.min(p.z, q.z, r.z), Math.max(p.z, q.z, r.z));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const key = `${i},${j},${k}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(slot);
      }
    }
  }
  const point = [0, 0, 0], best = [0, 0, 0];
  // { distance, outside } of the nearest triangle, or null past the reach.
  const query = (px, py, pz) => {
    let nearest = Infinity, normal = null;
    const [i0, i1] = cells(px, px), [j0, j1] = cells(py, py), [k0, k1] = cells(pz, pz);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      for (const slot of grid.get(`${i},${j},${k}`) ?? []) {
        const tri = tris[slot];
        closestOnTriangle(px, py, pz, tri, point);
        const distance = Math.hypot(px - point[0], py - point[1], pz - point[2]);
        if (distance < nearest) { nearest = distance; normal = tri; best[0] = point[0]; best[1] = point[1]; best[2] = point[2]; }
      }
    }
    if (!normal) return null;
    return { distance: nearest, outside: (px - best[0]) * normal[9] + (py - best[1]) * normal[10] + (pz - best[2]) * normal[11] >= 0 };
  };
  return { query };
}
// Groups of touching pieces of a root (4 mm welds, as the survey measures
// M5): each group must come within 2 cm of the surface it sits on, so a chain
// may hang clear of the chest as long as it joins the collar that carries it.
function pieceComponents(record) {
  const count = record.points.length, parent = Array.from({ length: count }, (_, index) => index);
  const find = index => { while (parent[index] !== index) index = parent[index] = parent[parent[index]]; return index; };
  const join = (a, b) => { parent[find(a)] = find(b); };
  const weld = new Map();
  record.points.forEach((point, index) => {
    const key = point.map(value => value.toFixed(4)).join(',');
    if (weld.has(key)) join(index, weld.get(key)); else weld.set(key, index);
  });
  let base = 0;
  for (const { geometry } of Object.values(record.channels)) {
    const index = geometry.index;
    for (let face = 0; face < index.count; face += 3) { join(base + index.getX(face), base + index.getX(face + 1)); join(base + index.getX(face), base + index.getX(face + 2)); }
    base += geometry.attributes.position.count;
  }
  const box = new Map();
  record.points.forEach((point, index) => {
    const root = find(index), [lo, hi] = box.get(root) ?? [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (let axis = 0; axis < 3; axis++) { lo[axis] = Math.min(lo[axis], point[axis]); hi[axis] = Math.max(hi[axis], point[axis]); }
    box.set(root, [lo, hi]);
  });
  for (let changed = true; changed;) {
    changed = false;
    outer: for (const a of [...box.keys()]) for (const b of [...box.keys()]) {
      if (a === b || !box.has(a) || !box.has(b)) continue;
      const [alo, ahi] = box.get(a), [blo, bhi] = box.get(b);
      if ([0, 1, 2].every(axis => alo[axis] - .004 <= bhi[axis] && blo[axis] - .004 <= ahi[axis])) {
        join(a, b);
        const root = find(a);
        box.set(root, [alo.map((value, axis) => Math.min(value, blo[axis])), ahi.map((value, axis) => Math.max(value, bhi[axis]))]);
        if (a !== root) box.delete(a);
        if (b !== root) box.delete(b);
        changed = true;
        break outer;
      }
    }
  }
  const components = new Map();
  record.points.forEach((_, index) => {
    const root = find(index);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(index);
  });
  return [...components.values()];
}

// The fit of one root on one surface: the closest approach of each group of
// touching pieces (0 when it touches or sinks in; a group floats when even
// that is past 2 cm) and how buried the most sunken group is (the median
// signed distance of its vertices; a group is buried when most of it is
// inside the surface, while a strap end clipping a hollow stays a warning).
function measureFit(surface, points, components, transform) {
  const hits = points.map(point => { const [x, y, z] = transform(point); return surface.query(x, y, z); });
  let gap = 0, buried = 0;
  for (const component of components) {
    let approach = Infinity;
    const signed = [];
    for (const index of component) {
      const hit = hits[index];
      if (!hit) { signed.push(REACH); continue; } // past the reach: floating, not buried
      const s = hit.outside ? hit.distance : -hit.distance;
      signed.push(s);
      approach = Math.min(approach, Math.max(s, 0));
    }
    gap = Math.max(gap, approach === Infinity ? REACH : approach);
    signed.sort((a, b) => a - b);
    buried = Math.min(buried, signed[Math.floor((signed.length - 1) / 2)]);
  }
  return { gap, buried: -buried };
}

// A reference GLB entry: plain bytes, or { name, input } for messages.
const asRef = (entry, fallback) => entry !== null && typeof entry === 'object' && !(entry instanceof ArrayBuffer) && !ArrayBuffer.isView(entry)
  ? { name: entry.name ?? fallback, input: entry.input ?? entry.bytes } : { name: fallback, input: entry };

// { errors, warnings, families, fit }. Every check of MARKERS.md the file can
// show (section 4 item 5): names, the whole ladder of required roots,
// channels and materials, the colour rules M3/M7, budgets, bounds, the area
// bands, the plate window and the crown, and the fitted gap and penetration
// (M5) on every reference head and body given. Warnings never fail.
export async function checkFrissonMarkersGlb(input, { heads = [], bodies = [] } = {}) {
  const errors = [], warnings = [], families = [];
  const { readGlb } = await importPublicModule('frisson/glb.js');
  const { MARK_PREFIX, CHANNELS, ANCHOR_PARENT, STANDING_ROOTS, CRAWLER_ROOTS, markersFromGlb, headMetrics, forearmSection, bodyFit, crawlerFit, armFit, headFit } = await importPublicModule('frisson/markers.js');
  const { bodiesFromGlb, frontOf, torsoTransform, CHEST_REGION, BRUTE_TORSOS } = await importPublicModule('frisson/bodies.js');
  const { headsFromGlb } = await importPublicModule('frisson/heads.js');
  let glb;
  try { glb = readGlb(input); } catch (error) { return { errors: [error.message], warnings, families }; }
  const bytes = input.byteLength ?? input.length;
  if (bytes > MARKERS_CONTRACT.bytes.cap) errors.push(`${bytes} bytes, the cap is ${MARKERS_CONTRACT.bytes.cap}`);
  else if (bytes > MARKERS_CONTRACT.bytes.target) warnings.push(`${bytes} bytes, the target is ${MARKERS_CONTRACT.bytes.target}`);

  // Names and channels: FrissonMark_<Family>_<Anchor> empties with
  // <Root>_<Channel> mesh children (Detail/Skin/Glow, lowercase materials).
  const byFamily = new Map(), seen = new Set(), records = [];
  for (const root of glb.roots) {
    const where = root.name;
    if (where.includes('.')) { errors.push(`${where}: no dots in root names`); continue; }
    if (!where.startsWith(MARK_PREFIX)) { errors.push(`${where}: root names must be ${MARK_PREFIX}<Family>_<Anchor>`); continue; }
    const rest = where.slice(MARK_PREFIX.length);
    const anchor = Object.keys(ANCHOR_PARENT).find(name => rest.endsWith(`_${name}`));
    const part = anchor && rest.slice(0, -(anchor.length + 1)), family = part?.toLowerCase();
    if (!anchor || !STANDING_ROOTS[family] || part !== capitalOf(family)) { errors.push(`${where}: not ${MARK_PREFIX}<Family>_<Anchor> with a known family and anchor`); continue; }
    if (seen.has(where)) errors.push(`${where}: duplicate root`);
    seen.add(where);
    if (root.mesh) errors.push(`${where}: the root must be an empty, not a mesh`);
    const record = { name: where, family, anchor, channels: {}, triangles: 0, points: [] };
    for (const child of root.children) {
      const channel = child.name.startsWith(`${where}_`) ? child.name.slice(where.length + 1) : null;
      if (!CHANNELS[channel]) { errors.push(`${child.name}: not a channel of ${where} (_Detail, _Skin or _Glow)`); continue; }
      if (record.channels[channel]) { errors.push(`${child.name}: duplicate channel`); continue; }
      if (child.children.length) errors.push(`${child.name}: channels have no children`);
      if (!child.mesh) { errors.push(`${child.name}: no mesh`); continue; }
      const { geometry, material } = child.mesh;
      if (material?.name !== CHANNELS[channel]) errors.push(`${child.name}: material "${material?.name ?? 'none'}", expected "${CHANNELS[channel]}"`);
      if (!geometry.attributes.normal) warnings.push(`${child.name}: no NORMAL (the contract exports smooth normals)`);
      if (!geometry.attributes.color) { errors.push(`${child.name}: COLOR_0 is missing`); continue; }
      record.channels[channel] = { name: child.name, geometry, material };
      record.triangles += geometry.index.count / 3;
      const position = geometry.attributes.position;
      for (let index = 0; index < position.count; index++) record.points.push([position.getX(index), position.getY(index), position.getZ(index)]);
    }
    if (!record.channels.Detail && !record.channels.Glow) errors.push(`${where}: needs a _Detail or a _Glow channel`);
    if (!byFamily.has(family)) byFamily.set(family, new Map());
    const anchors = byFamily.get(family);
    if (anchors.has(anchor)) errors.push(`${where}: the ${family} ${anchor} appears twice`);
    else anchors.set(anchor, record);
    records.push(record);
  }
  // The whole ladder: every family, all its standing and crawler roots.
  for (const [family, standing] of Object.entries(STANDING_ROOTS)) {
    const present = byFamily.get(family);
    for (const anchor of [...standing, ...(CRAWLER_ROOTS[family] ?? [])])
      if (!present?.has(anchor)) errors.push(`${MARK_PREFIX}${capitalOf(family)}_${anchor} is missing (the file carries the whole ladder)`);
  }

  // The colour rules (M3, the channel table, M7) and the materials.
  for (const record of records) for (const [channel, { name, geometry, material }] of Object.entries(record.channels)) {
    const color = geometry.attributes.color, index = geometry.index;
    if (channel === 'Detail') {
      let total = 0, bright = 0, worst = 0;
      for (let face = 0; face < index.count; face += 3) {
        const corners = [index.getX(face), index.getX(face + 1), index.getX(face + 2)];
        const top = Math.max(...corners.flatMap(vertex => [srgb8(color.getX(vertex)), srgb8(color.getY(vertex)), srgb8(color.getZ(vertex))]));
        worst = Math.max(worst, top);
        const [a, b, c] = corners.map(vertex => [geometry.attributes.position.getX(vertex), geometry.attributes.position.getY(vertex), geometry.attributes.position.getZ(vertex)]);
        const size = Math.hypot(...[0, 1, 2].map(axis => (b[(axis + 1) % 3] - a[(axis + 1) % 3]) * (c[(axis + 2) % 3] - a[(axis + 2) % 3]) - (b[(axis + 2) % 3] - a[(axis + 2) % 3]) * (c[(axis + 1) % 3] - a[(axis + 1) % 3]))) / 2;
        total += size;
        if (top > MARKERS_CONTRACT.glint.limit) bright += size;
      }
      if (worst > MARKERS_CONTRACT.glint.high) errors.push(`${name}: a colour channel at 0x${worst.toString(16)} is above 0xCC (M3)`);
      if (total && bright > MARKERS_CONTRACT.glint.share * total + 1e-9) errors.push(`${name}: ${(100 * bright / total).toFixed(1)} % of the area above 0xB4; glints and buckles may take 6 % (M3)`);
    }
    if (channel === 'Skin') {
      const stats = greyStats(geometry);
      const tint = `${name}: COLOR_0 multiplies the family skin colour, found a ${(stats.spread * 255).toFixed(0)}/255 tint (linear)`;
      if (stats.spread > TINT_LIMIT) errors.push(`${tint}; keep it grey`);
      else if (stats.spread > GREY_TOLERANCE) warnings.push(tint);
      if (!(stats.low >= .4 - 1e-6 && stats.high <= 1 + 1e-6)) errors.push(`${name}: greys ${fmt(stats.low)}..${fmt(stats.high)}, allowed 0.4..1`);
    }
    if (channel === 'Glow') {
      if (!['charcoal', 'overlord'].includes(record.family)) errors.push(`${name}: only Charcoal and Overlord glow`);
      const [low, high] = MARKERS_CONTRACT.glowHue[record.family] ?? [10, 25];
      for (let vertex = 0; vertex < color.count; vertex++) {
        const hue = hueOf(srgb8(color.getX(vertex)), srgb8(color.getY(vertex)), srgb8(color.getZ(vertex)));
        if (hue < low - .5 || hue > high + .5) { errors.push(`${name}: a glow hue of ${hue.toFixed(1)}°, the band is ${low}-${high}° (M7)`); break; }
      }
    }
    const emissive = (material.emissive.r + material.emissive.g + material.emissive.b) * material.emissiveIntensity;
    if (channel !== 'Glow' && emissive > 1e-3) errors.push(`${name}: the ${CHANNELS[channel]} material is emissive; only the glow material may glow`);
    if (channel === 'Glow' && material.emissiveIntensity > 1 + 1e-6) warnings.push(`${name}: emissive strength ${material.emissiveIntensity}; the game's glow lives in its shader`);
  }
  for (const material of glb.materials) if (!Object.values(CHANNELS).includes(material.name)) warnings.push(`material "${material.name}" is not used by the contract`);

  // Bounds per anchor, and the sub-rules of the bounds table: the neck
  // clearance, the hat zone, walkers off the chest, the colossus plate
  // window (M5) and the crown (Helmet y <= 0.225, so shots at it count).
  for (const record of records) {
    const bounds = MARKERS_CONTRACT.bounds[record.anchor], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const point of record.points) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
    if (record.points.length) ['x', 'y', 'z'].forEach((axis, index) => {
      if (!(min[index] >= bounds[0][index] - 1e-3 && max[index] <= bounds[1][index] + 1e-3))
        errors.push(`${record.name}: ${axis} spans ${fmt(min[index])}..${fmt(max[index])}, allowed ${bounds[0][index]}..${bounds[1][index]}`);
    });
    for (const [x, y, z] of record.points) {
      if (record.anchor === 'Neck' && y >= 1.43 && y <= 1.56 && Math.hypot(x, z) < .13 - 1e-4) { errors.push(`${record.name}: (${fmt(x)}, ${fmt(y)}, ${fmt(z)}) inside the neck clearance (0.13 from the axis, y 1.43-1.56)`); break; }
      if (HEAD_ANCHORS.has(record.anchor) && y > .15 + 1e-4 && Math.abs(x) < .1 && z < 0) { errors.push(`${record.name}: (${fmt(x)}, ${fmt(y)}, ${fmt(z)}) in the hat zone`); break; }
      if (BODY_ANCHORS.has(record.anchor) && record.anchor !== 'Neck' && WALKER_FAMILIES.has(record.family) && z < -.21 - 1e-4) { errors.push(`${record.name}: z ${fmt(z)} is more than 5 cm off the chest (walker pieces stay at z >= -0.21)`); break; }
      if (BODY_ANCHORS.has(record.anchor) && COLOSSUS_FAMILIES.has(record.family) && Math.abs(x) <= .24 && y >= .98 && y <= 1.4 && z < -.14) { errors.push(`${record.name}: (${fmt(x)}, ${fmt(y)}, ${fmt(z)}) in the chest plate's window; a chain enters it only from above y 1.40 (M5)`); break; }
    }
  }

  // Per family: budgets, and the visible front/side areas against the bands.
  // The bands are a soft check (the proposals' NOTES.md: three families
  // cannot meet them at the sizes M4 asks for); the side ratio and the glow
  // share are hard rules.
  for (const family of Object.keys(STANDING_ROOTS)) {
    const anchors = byFamily.get(family);
    if (!anchors) continue;
    const own = [...anchors.values()];
    const standing = own.filter(record => !record.anchor.startsWith('Crawler'));
    const crawlerSet = own.filter(record => record.anchor.startsWith('Crawler') || HEAD_ANCHORS.has(record.anchor));
    const standingTris = standing.reduce((sum, record) => sum + record.triangles, 0);
    const crawlerTris = crawlerSet.reduce((sum, record) => sum + record.triangles, 0);
    if (standingTris > MARKERS_CONTRACT.triangles[family]) errors.push(`${family}: ${standingTris} standing triangles, budget ${MARKERS_CONTRACT.triangles[family]}`);
    if (crawlerSet.length && crawlerTris > MARKERS_CONTRACT.crawlerShare * standingTris) errors.push(`${family}: the crawler set has ${crawlerTris} triangles, over 70 % of the standing ${standingTris}`);
    const areas = visibleAreas(standing), [low, high] = MARKERS_CONTRACT.front[family];
    if (!(areas.front >= low - 1e-4 && areas.front <= high + 1e-4)) warnings.push(`${family}: visible front ${areas.front.toFixed(4)} m², the band is ${low}-${high} (a soft check)`);
    if (areas.side < .5 * areas.front - 1e-6) errors.push(`${family}: the side shows ${areas.side.toFixed(4)} m², under half the front ${areas.front.toFixed(4)}`);
    if (areas.glow > MARKERS_CONTRACT.glowArea * areas.front + 1e-6) errors.push(`${family}: glow on ${(100 * areas.glow / areas.front).toFixed(1)} % of the visible front, over 15 %`);
    families.push({ name: family, roots: own.map(record => record.name), triangles: { standing: standingTris, crawler: crawlerTris, total: own.reduce((sum, record) => sum + record.triangles, 0) }, front: +areas.front.toFixed(4), side: +areas.side.toFixed(4), glow: +areas.glow.toFixed(4) });
  }

  // The fitted gap and penetration (M5) on every reference head and body.
  // Walker pieces sit on the ordinary torsos at the unit build; colossus
  // pieces on the brute torsos at the hulking build they are authored for.
  const headRefs = [], torsoRefs = [], bruteRefs = [], crawlerRefs = [], armRefs = [], crawlerArmRefs = [];
  for (const [index, entry] of heads.entries()) {
    const { name, input: refInput } = asRef(entry, `heads #${index + 1}`);
    let parsed;
    try { parsed = headsFromGlb(readGlb(refInput)); } catch (error) { warnings.push(`${name}: cannot measure the fit on it (${error.message})`); continue; }
    for (const head of parsed.variants) headRefs.push({ label: `${name}/${head.name}`, metrics: headMetrics(head.skin, head.detail, head.eyes), surface: buildSurface([head.skin, head.detail, head.eyes].filter(Boolean)) });
  }
  for (const [index, entry] of bodies.entries()) {
    const { name, input: refInput } = asRef(entry, `bodies #${index + 1}`);
    let parsed;
    try { parsed = bodiesFromGlb(readGlb(refInput)); } catch (error) { warnings.push(`${name}: cannot measure the fit on it (${error.message})`); continue; }
    for (const [key, list] of parsed.torso) for (const variant of list) {
      const brute = BRUTE_TORSOS.includes(key), build = brute ? HULKING : { w: 1, d: 1, hunch: 0 };
      const matrix = buildMatrix(torsoTransform(build)), all = Object.values(variant.channels);
      let shoulderHalf = -Infinity;
      const point = new THREE.Vector3();
      for (const geometry of all) {
        const position = geometry.attributes.position;
        for (let vertex = 0; vertex < position.count; vertex++) {
          point.fromBufferAttribute(position, vertex).applyMatrix4(matrix);
          if (point.y >= 1.38 && point.y <= 1.50) shoulderHalf = Math.max(shoulderHalf, Math.abs(point.x));
        }
      }
      (brute ? bruteRefs : torsoRefs).push({ label: `${name}/${variant.root}`, build, front: frontOf([variant.channels.Cloth], CHEST_REGION.standing, matrix), shoulderHalf: Number.isFinite(shoulderHalf) ? shoulderHalf : .235 * build.w, surface: buildSurface(all, matrix) });
    }
    for (const list of parsed.crawlerTorso.values()) for (const variant of list) {
      const all = Object.values(variant.channels);
      crawlerRefs.push({ label: `${name}/${variant.root}`, front: frontOf([variant.channels.Cloth], CHEST_REGION.crawler), surface: buildSurface(all) });
    }
    for (const list of parsed.arm.values()) for (const variant of list) {
      const all = Object.values(variant.channels);
      armRefs.push({ label: `${name}/${variant.root}`, section: forearmSection(all, -.46), surface: buildSurface(all) });
    }
    for (const list of parsed.crawlerArm.values()) for (const variant of list) {
      const all = Object.values(variant.channels);
      crawlerArmRefs.push({ label: `${name}/${variant.root}`, section: forearmSection(all, -.3), surface: buildSurface(all) });
    }
  }
  const anchorsPresent = new Set(records.map(record => record.anchor));
  if (!headRefs.length && [...HEAD_ANCHORS].some(anchor => anchorsPresent.has(anchor))) warnings.push('no reference heads (--heads): the head fit (M5) is unchecked');
  if (!torsoRefs.length && !crawlerRefs.length && [...BODY_ANCHORS, 'CrawlerTorso'].some(anchor => anchorsPresent.has(anchor))) warnings.push('no reference bodies (--bodies): the torso fit (M5) is unchecked');
  if (!bruteRefs.length && records.some(record => COLOSSUS_FAMILIES.has(record.family) && BODY_ANCHORS.has(record.anchor))) warnings.push('no brute torsos in the reference bodies: the colossus fit (M5) is unchecked');
  const vec = new THREE.Vector3();
  const byMatrix = (p, matrix) => { vec.set(p[0], p[1], p[2]).applyMatrix4(matrix); return [vec.x, vec.y, vec.z]; };
  const byHeadFit = (p, { kx, ky, kf, kb, size }) => [p[0] * kx, p[1] > 0 ? p[1] * ky : p[1] * size, p[2] < 0 ? p[2] * kf : p[2] * kb];
  for (const record of records) {
    const components = pieceComponents(record);
    const worst = { gap: 0, gapAt: null, penetrations: [] };
    const run = (refs, fitOf, transform = byMatrix) => {
      for (const ref of refs) {
        const fit = fitOf(ref), result = measureFit(ref.surface, record.points, components, point => transform(point, fit));
        if (result.gap > worst.gap) { worst.gap = result.gap; worst.gapAt = ref.label; }
        worst.penetrations.push({ label: ref.label, value: result.buried });
      }
    };
    if (BODY_ANCHORS.has(record.anchor)) {
      const refs = COLOSSUS_FAMILIES.has(record.family) ? bruteRefs : torsoRefs;
      run(refs, ref => bodyFit(record.anchor, { ...ref.build, front: ref.front ?? -.159 * ref.build.d, shoulderHalf: ref.shoulderHalf }));
    }
    else if (record.anchor === 'CrawlerTorso') run(crawlerRefs, ref => crawlerFit(ref.front ?? -.22));
    else if (record.anchor === 'ArmR') run(armRefs, ref => armFit(ref.section));
    else if (record.anchor === 'CrawlerArmR') run(crawlerArmRefs, ref => armFit(ref.section));
    else if (HEAD_ANCHORS.has(record.anchor)) run(headRefs, ref => headFit(record.anchor, ref.metrics, 1), byHeadFit);
    if (worst.gapAt) {
      if (worst.gap > MARKERS_CONTRACT.gap + MARKERS_CONTRACT.gapNoise) errors.push(`${record.name}: floats ${fmt(worst.gap)} m off ${worst.gapAt} (M5: 2 cm)`);
      else if (worst.gap > .015) warnings.push(`${record.name}: stands ${fmt(worst.gap)} m off ${worst.gapAt}; the seating is 0.006-0.015`);
    }
    if (worst.penetrations.length) {
      // Buried on the median target breaks the seating (M5); one odd head or
      // torso swallowing a piece is a warning, as the fit surveys allow.
      const values = worst.penetrations.map(entry => entry.value).sort((a, b) => a - b);
      const median = values[Math.floor((values.length - 1) / 2)], top = values[values.length - 1];
      if (median > MARKERS_CONTRACT.penetration) errors.push(`${record.name}: buried ${fmt(median)} m inside the surfaces it sits on (M5)`);
      else if (median > .003) warnings.push(`${record.name}: sits ${fmt(median)} m deep on the median surface; the seating is a standoff of 0.006-0.015`);
      if (top > .02) warnings.push(`${record.name}: buried up to ${fmt(top)} m inside ${worst.penetrations.find(entry => entry.value === top).label}`);
    }
  }
  // The game reads this file or nothing: the runtime parser must agree.
  if (!errors.length) { try { markersFromGlb(glb); } catch (error) { errors.push(`the game would refuse it: ${error.message}`); } }
  return { errors, warnings, families, fit: { heads: headRefs.length, torsos: torsoRefs.length + bruteRefs.length, crawlers: crawlerRefs.length, arms: armRefs.length + crawlerArmRefs.length } };
}

// --- Weapons (art/frisson/WEAPONS.md) -------------------------------------------
// §3.2: one root per weapon, an empty with mesh children authored in the
// anchor's frame (the gun group, or the named frame). The bounds below are
// the Famille bounds in that frame, hands excluded, and the muzzle point.
// §3.4 G3: a gun's dressing keeps clear of the muzzle side (z >= muzzle +
// .03) and grows .045 in x, .035 below, .015 above and .02 behind (+Z) on the
// other sides; a melee weapon's dressing grows .035 all round. G4 gives the
// sight corridors (null = unbounded on that side) and the 3 cm muzzle
// clearance. §3.5 gives the triangle and byte budgets.
export const WEAPONS_CONTRACT = Object.freeze({
  prefix: 'FrissonWeapon_',
  weapons: Object.freeze({
    Pistol: Object.freeze({ min: Object.freeze([-.052, -.293, -.311]), max: Object.freeze([.059, .116, .152]), muzzle: Object.freeze([0, .018, -.315]), dress: 500 }),
    Magnum: Object.freeze({ min: Object.freeze([-.082, -.235, -.458]), max: Object.freeze([.082, .124, .168]), muzzle: Object.freeze([0, .059, -.460]), dress: 500 }),
    Smg: Object.freeze({ min: Object.freeze([-.056, -.340, -.630]), max: Object.freeze([.057, .120, .458]), muzzle: Object.freeze([0, .012, -.621]), dress: 800, anchor: 'smgCompactFrame' }),
    Assault: Object.freeze({ min: Object.freeze([-.054, -.335, -.825]), max: Object.freeze([.054, .182, .460]), muzzle: Object.freeze([0, .025, -.830]), dress: 800 }),
    Rifle: Object.freeze({ min: Object.freeze([-.085, -.353, -.840]), max: Object.freeze([.130, .213, .460]), muzzle: Object.freeze([0, .012, -.860]), dress: 800 }),
    Shotgun: Object.freeze({ min: Object.freeze([-.060, -.236, -.990]), max: Object.freeze([.060, .127, .460]), muzzle: Object.freeze([0, .012, -1.010]), dress: 1000 }),
    Sniper: Object.freeze({ min: Object.freeze([-.063, -.234, -1.152]), max: Object.freeze([.162, .305, .500]), muzzle: Object.freeze([0, .055, -1.154]), dress: 800 }),
    Minigun: Object.freeze({ min: Object.freeze([-.145, -.280, -.920]), max: Object.freeze([.145, .187, .460]), muzzle: Object.freeze([0, .012, -.940]), dress: 1000 }),
    Rocket: Object.freeze({ min: Object.freeze([-.132, -.290, -.740]), max: Object.freeze([.156, .200, .440]), muzzle: Object.freeze([0, .035, -.755]), dress: 800 }),
    Flamethrower: Object.freeze({ min: Object.freeze([-.192, -.235, -.702]), max: Object.freeze([.192, .126, .276]), muzzle: Object.freeze([0, .015, -.715]), dress: 1000 }),
    Bat: Object.freeze({ min: Object.freeze([-.057, -.057, -.740]), max: Object.freeze([.057, .057, .350]), dress: 1000, anchor: 'batStrikeFrame', melee: true, bloodBefore: -.45 }),
    Fireaxe: Object.freeze({ min: Object.freeze([-.335, -.052, -.950]), max: Object.freeze([.330, .052, .413]), dress: 900, anchor: 'fireaxeEdgeFrame', melee: true, bloodBefore: -.60 }),
    Hammer: Object.freeze({ min: Object.freeze([-.139, -.138, -.935]), max: Object.freeze([.145, .145, .403]), dress: 900, anchor: 'hammerStrikeFrame', melee: true, bloodBefore: -.64 }),
    Katana: Object.freeze({ min: Object.freeze([-.092, -.060, -1.175]), max: Object.freeze([.112, .060, .313]), dress: 900, anchor: 'katanaEdgeFrame', melee: true, bloodBefore: -.925 }),
  }),
  // G4 sight corridors, anchor-frame boxes: [low, high] per axis, null open.
  corridors: Object.freeze({
    Pistol: Object.freeze({ x: Object.freeze([-.025, .025]), y: Object.freeze([.085, null]), z: Object.freeze([-.31, .06]) }),
    Magnum: Object.freeze({ x: Object.freeze([-.025, .025]), y: Object.freeze([.095, null]), z: Object.freeze([-.46, .06]) }),
    Smg: Object.freeze({ x: Object.freeze([-.025, .025]), y: Object.freeze([.055, null]), z: Object.freeze([-.63, .11]) }),
    Assault: Object.freeze({ x: Object.freeze([-.04, .04]), y: Object.freeze([.10, null]), z: Object.freeze([-.56, .02]) }),
    Rifle: Object.freeze({ x: Object.freeze([-.04, .04]), y: Object.freeze([.055, null]), z: Object.freeze([-.86, .11]) }),
    Shotgun: Object.freeze({ x: Object.freeze([-.03, .03]), y: Object.freeze([.055, null]), z: Object.freeze([-1.01, .11]) }),
    Minigun: Object.freeze({ x: Object.freeze([-.03, .03]), y: Object.freeze([.055, null]), z: Object.freeze([-.94, .11]) }),
    Sniper: Object.freeze({ x: Object.freeze([-.075, .075]), y: Object.freeze([.11, .31]), z: Object.freeze([-.54, .07]) }),
    Rocket: Object.freeze({ x: Object.freeze([.09, .16]), y: Object.freeze([.055, null]), z: Object.freeze([-.25, .15]) }),
    Flamethrower: Object.freeze({ x: Object.freeze([-.07, .07]), y: Object.freeze([-.06, .09]), z: Object.freeze([null, -.48]) }),
  }),
  // The only replaceable parts (G6), with the Famille material of each.
  replacements: Object.freeze({
    Fireaxe: Object.freeze({ part: 'fireaxeCuttingEdge', material: 'fireaxePolishedEdge' }),
    Katana: Object.freeze({ part: 'katanaBlade', material: 'katanaSteel' }),
  }),
  muzzleClearance: .03,
  replaceTriangles: 600, fileTriangles: 16_000,
  bytes: Object.freeze({ target: 400_000, cap: 700_000 }),
  // D1: closed solids, >= 1.5 mm thick (pixel-blood tiles 0.8 mm), lying
  // 0.3-0.8 mm off the Famille surface (the standoff is a warning: a nail
  // driven through the bat legitimately pierces it).
  thickness: Object.freeze({ solid: .0015, tile: .0008 }), standoff: Object.freeze([.0003, .0008]),
  // D6: tiles of 10-16 mm (measured in each tile's own frame, 0.5 mm slack
  // for float rounding), at most 6 and 6 cm² of footprint (the tile's
  // outward face, what can be seen; never the whole slab's surface).
  blood: Object.freeze({ grid: .004, tile: Object.freeze([.010, .016]), slack: .0005, tiles: 6, area: 6e-4, tolerance: .02 }),
  // D4: OKLCh chroma caps; brass hues run warmer, the shotgun hulls redder.
  chroma: Object.freeze({ base: .10, brass: .13, brassHue: Object.freeze([55, 115]), hulls: .14, hullsWeapon: 'Shotgun' }),
  envelopeSlack: .001,
  rackBox: Object.freeze({ min: Object.freeze([-.65, .90, 0]), max: Object.freeze([.65, 2.15, .22]) }),
});

// Millimetres for the artist's fixes.
const mm = value => `${(value * 1000).toFixed(1)} mm`;

// The G3 box a dressing channel must stay inside.
function dressLimits(weapon) {
  const spec = WEAPONS_CONTRACT.weapons[weapon];
  if (spec.melee) return { min: spec.min.map(value => value - .035), max: spec.max.map(value => value + .035) };
  return {
    min: [spec.min[0] - .045, spec.min[1] - .035, spec.muzzle[2] + WEAPONS_CONTRACT.muzzleClearance],
    max: [spec.max[0] + .045, spec.max[1] + .015, spec.max[2] + .02],
  };
}

// Connected pieces of a mesh (positions welded at 1e-5 m): per piece the
// signed volume (positive when wound outward), the open-edge count, the
// bounds and the vertex indices. `pieceOf` maps a vertex to its piece.
function meshPieces(geometry) {
  const position = geometry.attributes.position, index = geometry.index, faceCount = index.count / 3;
  const weld = new Map(), ids = new Int32Array(position.count);
  for (let vertex = 0; vertex < position.count; vertex++) {
    const label = `${Math.round(position.getX(vertex) * 1e5)},${Math.round(position.getY(vertex) * 1e5)},${Math.round(position.getZ(vertex) * 1e5)}`;
    if (!weld.has(label)) weld.set(label, weld.size);
    ids[vertex] = weld.get(label);
  }
  const parent = Array.from({ length: weld.size }, (_, value) => value);
  const find = value => { while (parent[value] !== value) value = parent[value] = parent[parent[value]]; return value; };
  const join = (a, b) => { parent[find(a)] = find(b); };
  const edgeCount = new Map(), edgePiece = new Map();
  for (let face = 0; face < faceCount; face++) {
    const tri = [0, 1, 2].map(corner => ids[index.getX(face * 3 + corner)]);
    join(tri[0], tri[1]); join(tri[1], tri[2]);
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const key = tri[a] < tri[b] ? `${tri[a]},${tri[b]}` : `${tri[b]},${tri[a]}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      edgePiece.set(key, tri[a]);
    }
  }
  const byRoot = new Map(), pieceOf = new Int32Array(position.count);
  const pieceOfRoot = root => {
    if (!byRoot.has(root)) byRoot.set(root, { volume: 0, faces: 0, boundary: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], vertices: [] });
    return byRoot.get(root);
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let face = 0; face < faceCount; face++) {
    const piece = pieceOfRoot(find(ids[index.getX(face * 3)]));
    a.fromBufferAttribute(position, index.getX(face * 3)); b.fromBufferAttribute(position, index.getX(face * 3 + 1)); c.fromBufferAttribute(position, index.getX(face * 3 + 2));
    piece.volume += (a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x)) / 6;
    piece.faces++;
  }
  for (const [key, count] of edgeCount) if (count !== 2) pieceOfRoot(find(edgePiece.get(key))).boundary++;
  for (let vertex = 0; vertex < position.count; vertex++) {
    const root = find(ids[vertex]), piece = pieceOfRoot(root);
    piece.vertices.push(vertex);
    for (const [axis, get] of [[0, 'getX'], [1, 'getY'], [2, 'getZ']]) {
      piece.min[axis] = Math.min(piece.min[axis], position[get](vertex));
      piece.max[axis] = Math.max(piece.max[axis], position[get](vertex));
    }
  }
  const pieces = [...byRoot.values()];
  for (let vertex = 0; vertex < position.count; vertex++) pieceOf[vertex] = pieces.indexOf(pieceOfRoot(find(ids[vertex])));
  return { pieces, pieceOf };
}

// Linear-sRGB to OKLCh (the D4 chroma caps).
function oklchOf(r, g, b) {
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const alpha = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s;
  const beta = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  const hue = Math.atan2(beta, alpha) * 180 / Math.PI;
  return { chroma: Math.hypot(alpha, beta), hue: hue < 0 ? hue + 360 : hue };
}
const bloodLinearOf = palette => palette.map(hex => lin(hex));

// The matrix from a mesh's local frame to its anchor's, composed from the
// rest transforms of the nodes between them (never matrixWorld, §2.4.2).
function meshToAnchor(mesh, anchor) {
  const matrix = new THREE.Matrix4(), step = new THREE.Matrix4();
  for (let node = mesh; node && node !== anchor; node = node.parent) matrix.premultiply(step.compose(node.position, node.quaternion, node.scale));
  return matrix;
}
// Every Famille mesh of a weapon in its anchor frame, hands and sleeve out.
function familleGeometries(build, weapon) {
  const spec = WEAPONS_CONTRACT.weapons[weapon], gun = build(weapon.toLowerCase());
  const anchor = spec.anchor ? gun.getObjectByName(spec.anchor) : gun;
  const geometries = [];
  gun.traverse(node => {
    if (!node.isMesh || !anchor) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (materials.some(material => material?.name === 'firstPersonHand' || material?.name === 'firstPersonSleeve')) return;
    for (let parent = node; parent; parent = parent.parent) if (parent === anchor) {
      geometries.push(node.geometry.clone().applyMatrix4(meshToAnchor(node, anchor)));
      return;
    }
  });
  return geometries;
}

// One box of an envelope check: the error names the excess and the side.
function checkEnvelope(label, box, min, max, slack, errors) {
  ['x', 'y', 'z'].forEach((axis, index) => {
    if (box.min[axis] < min[index] - slack) errors.push(`${label}: ${axis} ${fmt(box.min[axis])} is ${mm(min[index] - box.min[axis])} past the -${axis} envelope (${fmt(min[index])})`);
    if (box.max[axis] > max[index] + slack) errors.push(`${label}: ${axis} ${fmt(box.max[axis])} is ${mm(box.max[axis] - max[index])} past the +${axis} envelope (${fmt(max[index])})`);
  });
}

// G5: the dressed ground and rack weapons, built through the real engine.
async function checkWeaponEnvelopes(engine, glb, weaponNames, errors, warnings) {
  const { world } = engine;
  if (typeof world.setWeaponStyle !== 'function' || typeof world.createGroundWeapon !== 'function' || typeof world.createArmoryRack !== 'function') {
    warnings.push('world.js has no weapon style hook yet: the G5 envelopes are unchecked');
    return;
  }
  let pack;
  try { pack = await importPublicModule('frisson/weapons.js'); }
  catch (error) { warnings.push(`public/frisson/weapons.js does not load (${error.message}): the G5 envelopes are unchecked`); return; }
  if (typeof pack.createWeaponsStyle !== 'function') { warnings.push('public/frisson/weapons.js has no createWeaponsStyle: the G5 envelopes are unchecked'); return; }
  const { GROUND_WEAPON_BOUNDS } = await import('../public/rules.js');
  let style;
  try { style = pack.createWeaponsStyle({ roots: glb, quality: 'high' }); }
  catch (error) { errors.push(`the style refuses the file (${error.message})`); return; }
  const slack = WEAPONS_CONTRACT.envelopeSlack;
  world.setWeaponStyle(style);
  try {
    for (const weapon of weaponNames) {
      const type = weapon.toLowerCase(), profile = GROUND_WEAPON_BOUNDS[type];
      const ground = world.createGroundWeapon(type);
      ground.updateMatrixWorld(true);
      const groundBox = new THREE.Box3().setFromObject(ground.userData.model ?? ground);
      checkEnvelope(`${weapon} dressed on the ground`, groundBox,
        [-profile.halfWidth, profile.floorOffset, -profile.halfLength], [profile.halfWidth, profile.floorOffset + profile.height, profile.halfLength], slack, errors);
      const rack = world.createArmoryRack(type);
      rack.updateMatrixWorld(true);
      const gun = rack.getObjectByName(`rackWeapon-${type}`) ?? rack;
      const rackBox = new THREE.Box3().setFromObject(gun);
      checkEnvelope(`${weapon} dressed on a rack`, rackBox, WEAPONS_CONTRACT.rackBox.min, WEAPONS_CONTRACT.rackBox.max, slack, errors);
    }
  } finally {
    world.setWeaponStyle(null);
    style.dispose?.();
  }
}

// G6: a replacement stays inside the replaced part's Famille bounds and keeps
// its striking side, its tip and at least 80 % of its edge length.
function checkWeaponReplacement(engine, weapon, channel, errors) {
  const spec = WEAPONS_CONTRACT.replacements[weapon], anchorSpec = WEAPONS_CONTRACT.weapons[weapon];
  const gun = engine.build(weapon.toLowerCase());
  const anchor = anchorSpec.anchor ? gun.getObjectByName(anchorSpec.anchor) : gun;
  const mesh = gun.getObjectByName(spec.part);
  if (!anchor || !mesh) { errors.push(`${channel.name}: the Famille ${spec.part} cannot be measured`); return; }
  const matrix = meshToAnchor(mesh, anchor);
  mesh.geometry.computeBoundingBox();
  const famBox = mesh.geometry.boundingBox, corner = new THREE.Vector3();
  const famMin = [Infinity, Infinity, Infinity], famMax = [-Infinity, -Infinity, -Infinity];
  for (const x of [famBox.min.x, famBox.max.x]) for (const y of [famBox.min.y, famBox.max.y]) for (const z of [famBox.min.z, famBox.max.z]) {
    corner.set(x, y, z).applyMatrix4(matrix);
    famMin[0] = Math.min(famMin[0], corner.x); famMin[1] = Math.min(famMin[1], corner.y); famMin[2] = Math.min(famMin[2], corner.z);
    famMax[0] = Math.max(famMax[0], corner.x); famMax[1] = Math.max(famMax[1], corner.y); famMax[2] = Math.max(famMax[2], corner.z);
  }
  const famVerts = [], position = mesh.geometry.attributes.position;
  for (let vertex = 0; vertex < position.count; vertex++) famVerts.push(corner.fromBufferAttribute(position, vertex).applyMatrix4(matrix).clone());
  const replacement = channel.geometry.attributes.position;
  const repMin = [Infinity, Infinity, Infinity], repMax = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < replacement.count; vertex++) for (const [axis, get] of [[0, 'getX'], [1, 'getY'], [2, 'getZ']]) {
    repMin[axis] = Math.min(repMin[axis], replacement[get](vertex));
    repMax[axis] = Math.max(repMax[axis], replacement[get](vertex));
  }
  ['x', 'y', 'z'].forEach((axis, index) => {
    if (repMin[index] < famMin[index] - .0005) errors.push(`${channel.name}: ${axis} ${fmt(repMin[index])} is ${mm(famMin[index] - repMin[index])} past the Famille part's -${axis} bound (G6 allows +0.5 mm)`);
    if (repMax[index] > famMax[index] + .0005) errors.push(`${channel.name}: ${axis} ${fmt(repMax[index])} is ${mm(repMax[index] - famMax[index])} past the Famille part's +${axis} bound (G6 allows +0.5 mm)`);
  });
  // The striking side is -X on both replaceable parts.
  if (repMin[0] > famMin[0] + .003) errors.push(`${channel.name}: the striking side (-X) retreats ${mm(repMin[0] - famMin[0])} from the Famille edge (${fmt(famMin[0])})`);
  const famEdgeVerts = famVerts.filter(point => point.x <= famMin[0] + .01);
  const famLength = famEdgeVerts.length ? Math.max(...famEdgeVerts.map(point => point.z)) - Math.min(...famEdgeVerts.map(point => point.z)) : 0;
  const repEdgeVerts = [];
  for (let vertex = 0; vertex < replacement.count; vertex++) if (replacement.getX(vertex) <= repMin[0] + .01) repEdgeVerts.push(replacement.getZ(vertex));
  const repLength = repEdgeVerts.length ? Math.max(...repEdgeVerts) - Math.min(...repEdgeVerts) : 0;
  if (repLength < .8 * famLength - 1e-6) errors.push(`${channel.name}: the edge spans ${mm(repLength)}, ${famLength ? Math.round(100 * repLength / famLength) : 0} % of the Famille edge (${mm(famLength)}; G6 asks for at least 80 %)`);
  if (weapon === 'Katana') {
    if (repMin[2] > -1.170) errors.push(`${channel.name}: the tip stops at z ${fmt(repMin[2])}, ${mm(repMin[2] + 1.175)} short of the Famille tip (-1.175 +- 5 mm)`);
    if (repMin[2] < -1.180) errors.push(`${channel.name}: the tip reaches z ${fmt(repMin[2])}, ${mm(-1.180 - repMin[2])} past the Famille tip (-1.175 +- 5 mm)`);
  } else if (weapon === 'Fireaxe' && repMin[0] > -.285) {
    errors.push(`${channel.name}: the edge stops at x ${fmt(repMin[0])}, ${mm(repMin[0] + .285)} short of the Famille edge band (-0.335 .. -0.285)`);
  }
}

// D1's standoff, measured per piece against the Famille surfaces.
function checkWeaponStandoff(name, pieces, surface, position, warnings) {
  const [low, high] = WEAPONS_CONTRACT.standoff;
  for (const piece of pieces) {
    const step = Math.max(1, Math.floor(piece.vertices.length / 10));
    let nearest = Infinity;
    for (let index = 0; index < piece.vertices.length; index += step) {
      const vertex = piece.vertices[index];
      const hit = surface.query(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      if (hit) nearest = Math.min(nearest, hit.distance);
    }
    if (!Number.isFinite(nearest)) warnings.push(`${name}: a piece floats more than 4 cm from any Famille surface (D1: 0.3-0.8 mm off it)`);
    else if (nearest > high + .0001) warnings.push(`${name}: a piece floats ${mm(nearest)} off the Famille surface (D1: 0.3-0.8 mm)`);
    else if (nearest < low - .0001) warnings.push(`${name}: a piece lies ${mm(nearest)} from the Famille surface (D1: 0.3-0.8 mm; a nail driven through still pierces it)`);
  }
}

// D4 and D6: muted colours everywhere, pixel blood on melee _Dress only.
function checkWeaponColours(name, channel, weapon, geometry, pieces, bloodLinear, errors) {
  const color = geometry.attributes.color, position = geometry.attributes.position, spec = WEAPONS_CONTRACT.weapons[weapon];
  const C = WEAPONS_CONTRACT.chroma, B = WEAPONS_CONTRACT.blood;
  const blood = new Uint8Array(color.count);
  for (let vertex = 0; vertex < color.count; vertex++) {
    const rgb = [color.getX(vertex), color.getY(vertex), color.getZ(vertex)];
    blood[vertex] = bloodLinear.some(([r, g, b]) => Math.hypot(rgb[0] - r, rgb[1] - g, rgb[2] - b) <= B.tolerance) ? 1 : 0;
    if (blood[vertex]) continue;
    const { chroma, hue } = oklchOf(...rgb);
    let cap = C.base, why = 'muted colours';
    if (hue >= C.brassHue[0] && hue <= C.brassHue[1]) { cap = C.brass; why = 'brass'; }
    else if (weapon === C.hullsWeapon && (hue <= 40 || hue >= 330)) { cap = C.hulls; why = 'the red hulls'; }
    if (chroma > cap + 1e-3) { errors.push(`${name}: a vertex at chroma ${chroma.toFixed(3)}, the cap is ${cap} (${why}, D4)`); break; }
  }
  const bloodCount = blood.reduce((sum, value) => sum + value, 0);
  if (!bloodCount) return false;
  if (!spec.melee) { errors.push(`${name}: ${bloodCount} blood-coloured vertices on a gun (D6: pixel blood is for melee weapons only)`); return true; }
  if (channel !== 'Dress') { errors.push(`${name}: blood belongs on _Dress only, never on ${channel === 'DressFlat' ? '_DressFlat' : 'a replacement'} (D6)`); return true; }
  for (let vertex = 0; vertex < position.count; vertex++) {
    if (!blood[vertex]) continue;
    if (position.getZ(vertex) >= spec.bloodBefore) { errors.push(`${name}: blood at z ${fmt(position.getZ(vertex))}, off the striking end (D6: ${weapon === 'Bat' ? 'the barrel past z -0.45' : weapon === 'Fireaxe' ? 'the head' : weapon === 'Hammer' ? 'the ball and collar' : 'the blade within 0.25 m of the tip'})`); break; }
  }
  const { tiles, area } = bloodTiles(geometry, blood);
  if (tiles.length > B.tiles) errors.push(`${name}: ${tiles.length} blood tiles, at most ${B.tiles} (D6)`);
  if (area > B.area + 1e-6) errors.push(`${name}: ${(area * 1e4).toFixed(1)} cm² of blood, at most 6 cm² (D6)`);
  for (const tile of tiles) {
    if (tile.size[0] < B.tile[0] - B.slack || tile.size[1] > B.tile[1] + B.slack)
      errors.push(`${name}: a blood tile spans ${mm(tile.size[0])} x ${mm(tile.size[1])} (D6: squares of 10-16 mm on the 4 mm grid)`);
  }
  return true;
}

// The pixel-blood tiles of a channel (D6): clusters of blood vertices joined
// by all-blood faces. Each tile is measured in its own frame — the normal of
// its largest face, and that face's shortest edge for the first side — so a
// slab laid on a slanted facet reads its true size, not its world box. Its
// area is its outward face alone (the faces within 30° of that normal): the
// footprint the camera can see, never the slab's whole closed surface.
// { tiles: [{ size: [short, long], thickness, area }], area }.
export function bloodTiles(geometry, blood) {
  const position = geometry.attributes.position, index = geometry.index, count = position.count;
  const parent = Array.from({ length: count }, (_, value) => value);
  const find = value => { while (parent[value] !== value) value = parent[value] = parent[parent[value]]; return value; };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), faces = [];
  const faceCount = index ? index.count : count;
  for (let face = 0; face < faceCount; face += 3) {
    const tri = index ? [index.getX(face), index.getX(face + 1), index.getX(face + 2)] : [face, face + 1, face + 2];
    if (!tri.every(vertex => blood[vertex])) continue;
    parent[find(tri[1])] = find(tri[0]); parent[find(tri[2])] = find(tri[0]);
    a.fromBufferAttribute(position, tri[0]); b.fromBufferAttribute(position, tri[1]); c.fromBufferAttribute(position, tri[2]);
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]].map(([p, q]) => new THREE.Vector3().fromBufferAttribute(position, q).sub(new THREE.Vector3().fromBufferAttribute(position, p)));
    faces.push({ tri, area: normal.length() / 2, normal: normal.normalize(), edges });
  }
  const clusters = new Map();
  for (let vertex = 0; vertex < count; vertex++) {
    if (!blood[vertex]) continue;
    const root = find(vertex);
    if (!clusters.has(root)) clusters.set(root, { vertices: [], faces: [] });
    clusters.get(root).vertices.push(vertex);
  }
  for (const face of faces) clusters.get(find(face.tri[0])).faces.push(face);
  const tiles = [];
  let area = 0;
  for (const { vertices, faces: own } of clusters.values()) {
    if (!own.length) { tiles.push({ size: [0, 0], thickness: 0, area: 0, vertices }); continue; }
    const largest = own.reduce((best, face) => face.area > best.area ? face : best);
    const normal = largest.normal.clone();
    const side = largest.edges.reduce((best, edge) => edge.lengthSq() < best.lengthSq() ? edge : best).clone();
    side.addScaledVector(normal, -side.dot(normal)).normalize();
    const other = new THREE.Vector3().crossVectors(normal, side);
    const span = axis => { let low = Infinity, high = -Infinity; for (const vertex of vertices) { const d = a.fromBufferAttribute(position, vertex).dot(axis); low = Math.min(low, d); high = Math.max(high, d); } return high - low; };
    const sides = [span(side), span(other)].sort((x, y) => x - y);
    const outward = own.filter(face => face.normal.dot(normal) >= Math.cos(Math.PI / 6)).reduce((sum, face) => sum + face.area, 0);
    tiles.push({ size: sides, thickness: span(normal), area: outward, vertices });
    area += outward;
  }
  return { tiles, area };
}

// { errors, warnings, weapons, info, triangles }: every check of WEAPONS.md
// section 3 the file can show. opts.engine === false skips the checks that
// build the Famille weapons (D1 standoff, G5, G6).
export async function checkFrissonWeaponsGlb(input, opts = {}) {
  const C = WEAPONS_CONTRACT, errors = [], warnings = [], info = [], weapons = [];
  const { readGlb } = await importPublicModule('frisson/glb.js');
  let glb;
  try { glb = readGlb(input); } catch (error) { return { errors: [error.message], warnings, weapons, info, triangles: 0 }; }
  const bytes = input.byteLength ?? input.length;
  if (bytes > C.bytes.cap) errors.push(`${bytes} bytes, the cap is ${C.bytes.cap} (3.5)`);
  else if (bytes > C.bytes.target) warnings.push(`${bytes} bytes, the target is ${C.bytes.target} (3.5)`);
  const { BLOOD_PALETTE } = await importPublicModule('frisson/blood.js');
  const bloodLinear = bloodLinearOf(BLOOD_PALETTE);
  const weaponNames = Object.keys(C.weapons), seen = new Set();
  let triangles = 0;
  const surfaces = {};
  for (const root of glb.roots) {
    const where = root.name;
    if (where.includes('.') || !where.startsWith(C.prefix) || !weaponNames.includes(where.slice(C.prefix.length))) {
      errors.push(`${where}: root names must be FrissonWeapon_<Weapon>, <Weapon> one of ${weaponNames.join(', ')} (no dots)`);
      continue;
    }
    const weapon = where.slice(C.prefix.length), spec = C.weapons[weapon];
    if (seen.has(where)) errors.push(`${where}: duplicate root`);
    seen.add(where);
    if (root.mesh) errors.push(`${where}: the root must be an empty, not a mesh`);
    const record = { name: where, weapon, triangles: {}, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const channels = {}, replacement = C.replacements[weapon];
    for (const child of root.children) {
      const channel = child.name.startsWith(`${where}_`) ? child.name.slice(where.length + 1) : null;
      const allowed = channel === 'Dress' || channel === 'DressFlat' || (replacement && channel === `Replace_${replacement.part}`);
      if (child.name.includes('.')) errors.push(`${child.name}: no dots in names (G2)`);
      if (!allowed) { errors.push(`${child.name}: not a channel of ${where} (_Dress, _DressFlat${replacement ? `, _Replace_${replacement.part}` : ''}; a root may be absent, its weapon then gets recipes only)`); continue; }
      if (channels[channel]) { errors.push(`${child.name}: duplicate channel`); continue; }
      if (child.children.length) errors.push(`${child.name}: channels have no children`);
      if (!child.mesh) { errors.push(`${child.name}: no mesh`); continue; }
      const { geometry, material } = child.mesh;
      const expected = channel.startsWith('Replace_') ? replacement.material : 'dress';
      if (material?.name !== expected) errors.push(`${child.name}: material "${material?.name ?? 'none'}", expected "${expected}" (G2)`);
      if (material?.doubleSided) errors.push(`${child.name}: single-sided, every face wound outward (G1)`);
      if (!geometry.attributes.normal) errors.push(`${child.name}: no NORMAL (the contract exports smooth normals, G1)`);
      if (!geometry.attributes.color) errors.push(`${child.name}: COLOR_0 is missing (G1)`);
      record.triangles[channel] = geometry.index.count / 3;
      triangles += record.triangles[channel];
      geometry.computeBoundingBox();
      ['x', 'y', 'z'].forEach((axis, index) => { record.min[index] = Math.min(record.min[index], geometry.boundingBox.min[axis]); record.max[index] = Math.max(record.max[index], geometry.boundingBox.max[axis]); });
      const { pieces } = meshPieces(geometry);
      const bloodPieces = new Set();
      if (geometry.attributes.color) {
        for (const piece of pieces) {
          const coloured = piece.vertices.every(vertex => bloodLinear.some(([r, g, b]) => Math.hypot(geometry.attributes.color.getX(vertex) - r, geometry.attributes.color.getY(vertex) - g, geometry.attributes.color.getZ(vertex) - b) <= C.blood.tolerance));
          if (coloured) bloodPieces.add(piece);
        }
      }
      for (const piece of pieces) {
        if (piece.volume < -1e-9 && Math.abs(piece.volume) > 1e-9) errors.push(`${child.name}: a solid is wound inward (signed volume ${(piece.volume * 1e9).toFixed(1)} mm³; the game draws front faces only, G1)`);
        if (channel.startsWith('Replace_')) continue;
        if (piece.boundary) errors.push(`${child.name}: a piece is not a closed solid (${piece.boundary} open edge${piece.boundary === 1 ? '' : 's'}, D1)`);
        else if (Math.abs(piece.volume) <= 1e-9) errors.push(`${child.name}: a piece has no volume (a zero-thickness plane, D1)`);
        const size = [0, 1, 2].map(axis => piece.max[axis] - piece.min[axis]).sort((x, y) => x - y);
        const thick = bloodPieces.has(piece) ? C.thickness.tile : C.thickness.solid;
        if (size[0] < thick - 1e-6) errors.push(`${child.name}: a piece is ${mm(size[0])} thick (D1 asks for at least ${mm(thick)}${bloodPieces.has(piece) ? ' on a blood tile' : ''})`);
      }
      if (channel === 'Dress' && record.triangles.Dress > spec.dress) errors.push(`${child.name}: ${record.triangles.Dress} triangles, the ${weapon} _Dress budget is ${spec.dress} (3.5)`);
      if (channel.startsWith('Replace_') && record.triangles[channel] > C.replaceTriangles) errors.push(`${child.name}: ${record.triangles[channel]} triangles, a replacement's budget is ${C.replaceTriangles} (3.5)`);
      if (channel === 'Dress' || channel === 'DressFlat') {
        // G3 bounds and the G4 sight corridor and muzzle clearance.
        const limits = dressLimits(weapon), position = geometry.attributes.position, worst = {};
        const corridor = C.corridors[weapon];
        for (let vertex = 0; vertex < position.count; vertex++) {
          const point = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
          for (let axis = 0; axis < 3; axis++) {
            if (point[axis] < limits.min[axis] - 1e-6) worst[`-${'xyz'[axis]}`] = Math.max(worst[`-${'xyz'[axis]}`] ?? 0, limits.min[axis] - point[axis]);
            if (point[axis] > limits.max[axis] + 1e-6) worst[`+${'xyz'[axis]}`] = Math.max(worst[`+${'xyz'[axis]}`] ?? 0, point[axis] - limits.max[axis]);
          }
          if (corridor && ['x', 'y', 'z'].every((axis, index) => {
            const range = corridor[axis];
            return (range[0] === null || point[index] >= range[0]) && (range[1] === null || point[index] <= range[1]);
          })) errors.push(`${child.name}: a vertex (${point.map(fmt).join(', ')}) inside the sight corridor (G4: the line of sight stays clear)`);
          if (spec.muzzle) {
            const distance = Math.hypot(point[0] - spec.muzzle[0], point[1] - spec.muzzle[1], point[2] - spec.muzzle[2]);
            if (distance < C.muzzleClearance - 1e-6) errors.push(`${child.name}: a vertex (${point.map(fmt).join(', ')}) ${mm(C.muzzleClearance - distance)} too close to the muzzle (G4: nothing within ${mm(C.muzzleClearance)})`);
          }
        }
        for (const [direction, excess] of Object.entries(worst))
          errors.push(`${child.name}: ${mm(excess)} past the ${direction} bound (G3: the dressing stays inside the Famille bounds${spec.melee ? ' + 35 mm' : ', expanded but never toward the muzzle'})`);
      }
      if (geometry.attributes.color) checkWeaponColours(child.name, channel, weapon, geometry, pieces, bloodLinear, errors);
      channels[channel] = { name: child.name, geometry, pieces };
    }
    if (!channels.Dress) errors.push(`${where}_Dress is missing (required when the root exists, 3.2)`);
    if (channels.DressFlat && channels.Dress && record.triangles.DressFlat > record.triangles.Dress)
      errors.push(`${where}: _DressFlat has ${record.triangles.DressFlat} triangles, more than _Dress's ${record.triangles.Dress} (3.5)`);
    record.triangles.total = Object.values(record.triangles).reduce((sum, value) => sum + value, 0);
    weapons.push(record);
    // Engine checks per weapon: the D1 standoff and the G6 replacements.
    if (opts.engine === false) continue;
    surfaces[weapon] = channels;
  }
  if (!glb.roots.length) errors.push(`no weapon roots (FrissonWeapon_<Weapon>)`);
  if (triangles > C.fileTriangles) errors.push(`${triangles} triangles in the whole file, the budget is ${C.fileTriangles} (3.5)`);
  // D2: one material, and nothing glows.
  for (const material of glb.materials) {
    if (material.name !== 'dress' && !Object.values(C.replacements).some(entry => entry.material === material.name)) warnings.push(`material "${material.name}" is not used by the contract`);
    if ((material.emissive.r + material.emissive.g + material.emissive.b) * material.emissiveIntensity > 1e-3) errors.push(`material "${material.name}" glows (D2: nothing emissive; the file's colours are previews anyway)`);
  }
  if ((glb.json.extensionsUsed ?? []).includes('KHR_materials_emissive_strength')) errors.push('the emissive strength extension is not used here (G1/D2)');
  info.push('G7: sniperBolt and minigunRotor carry no dressing in this lot (the recipes weather them); a _Dress_<Node> channel would show here as an unknown channel');
  info.push('G8 (determinism) cannot be checked from the file: two runs of the generator must give byte-identical GLBs (see the artist\'s NOTES.md)');

  // The engine checks: D1 standoff on the Famille surfaces, G6 replacements
  // measured against the Famille parts, and the G5 envelopes built dressed.
  let engine = null;
  if (opts.engine !== false && weapons.length) {
    try {
      const world = await importPublicModule('world.js');
      engine = { world, build: world.buildWeapon ?? world.createWeapon };
      if (typeof engine.build !== 'function') throw new Error('no buildWeapon/createWeapon');
    } catch (error) { warnings.push(`world.js does not load (${error.message}): the D1 standoff, the G6 replacements and the G5 envelopes are unchecked`); }
  }
  if (engine) {
    for (const root of glb.roots) {
      const weapon = root.name.slice(C.prefix.length), channels = surfaces[weapon];
      if (!channels) continue;
      let surface = null;
      const dressChannels = [channels.Dress, channels.DressFlat].filter(Boolean);
      if (dressChannels.length) {
        try { surface = buildSurface(familleGeometries(engine.build, weapon)); }
        catch (error) { warnings.push(`${weapon}: the Famille build failed (${error.message}): the D1 standoff is unchecked`); }
      }
      if (surface) for (const channel of dressChannels) checkWeaponStandoff(channel.name, channel.pieces, surface, channel.geometry.attributes.position, warnings);
      for (const [channel, entry] of Object.entries(channels)) if (channel.startsWith('Replace_')) checkWeaponReplacement(engine, weapon, entry, errors);
    }
    await checkWeaponEnvelopes(engine, glb, weapons.map(record => record.weapon), errors, warnings);
  }
  return { errors, warnings, weapons, info, triangles };
}

// --- The cabin (art/frisson/CABIN.md) -------------------------------------------------
export const CABIN_SPACE_PATH = fileURLToPath(new URL('../art/frisson/cabin/cabin-space.json', import.meta.url));
export const readCabinSpace = (path = CABIN_SPACE_PATH) => JSON.parse(readFileSync(path, 'utf8'));
export const CABIN_CONTRACT = Object.freeze({
  bytes: Object.freeze({ target: 500_000, cap: 1_000_000 }),
  // A grime multiplier never darkens a pixel below 45 % (sRGB).
  grimeFloor: .45,
  // Pixel blood: 2.5 cm tiles, at most 60 per door, only in the door channels.
  bloodTile: .025, bloodTiles: 60,
  // A door channel stays near its doorway (horizontal metres from its centre).
  doorReach: 2.6,
  // Frame margin around the cabin space (metres): beyond it, an axis is swapped.
  margin: .02,
});
const EPSILON = 1e-4;
// sRGB <-> linear, per channel.
export const srgbToLinear = value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
export const linearToSrgb = value => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
const hexRgb = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(channel => channel / 255);
const rgbHex = rgb => '#' + rgb.map(value => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0')).join('');
// Relative luminance of an sRGB colour (0-1 channels).
export const luminance = srgb => { const [r, g, b] = srgb.map(srgbToLinear); return .2126 * r + .7152 * g + .0722 * b; };
export const contrastRatio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
// Hue (degrees), saturation and value of an sRGB colour.
function hsv([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta > 0) hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return [(hue + 360) % 360, max ? delta / max : 0, max];
}
// Dark red, the colour of the Frisson blood (BLOOD_PALETTE and its dried tone).
export const isBloodRed = ([r, g, b]) => r > .1 && r > 3 * g && r > 3 * b;
// Rule 6 of CABIN.md section 2: the hues of pickups and halos.
export const isLootHue = srgb => { const [hue, saturation, value] = hsv(srgb); return saturation > .5 && value > .4 && hue >= 40 && hue <= 200; };

const inside = (point, region, epsilon = 0) => [0, 1, 2].every(axis => point[axis] >= region.min[axis] - epsilon && point[axis] <= region.max[axis] + epsilon);
const strictlyInside = (point, region) => [0, 1, 2].every(axis => point[axis] > region.min[axis] + EPSILON && point[axis] < region.max[axis] - EPSILON);
const AXES = { x: 0, y: 1, z: 2 };
// Placement tests on a cabin space (cabin-space.json), shared with the
// placeholder generator. A mark or grime vertex is on a plane when it lies
// within its tolerance of the plane along the axis and inside the plane's
// rectangle grown by tolerance.plane (1 cm).
export function cabinPlacement(space) {
  const { anchors, keepouts, planes, roofUnderside, tolerance } = space;
  const all = keepouts.filter(item => item.forbid === 'all'), props = keepouts.filter(item => item.forbid === 'props');
  const slabs = roofUnderside.slabs.map(slab => ({ ...slab, cos: Math.cos(slab.rotationZ), sin: Math.sin(slab.rotationZ) }));
  const onPlane = (point, slack) => planes.find(plane => {
    const axis = AXES[plane.axis];
    if (Math.abs(point[axis] - plane.value) > slack + EPSILON) return false;
    return [0, 1, 2].every(other => other === axis || (point[other] >= plane.min[other] - tolerance.plane && point[other] <= plane.max[other] + tolerance.plane));
  }) ?? null;
  // The layer under a roof slab: at most `depth` below its underside, over
  // its footprint, inside the walls.
  const underRoof = point => inside(point, roofUnderside.inside, EPSILON) && slabs.some(slab => {
    const dx = point[0] - slab.center[0], dy = point[1] - slab.center[1];
    const x = slab.cos * dx + slab.sin * dy, y = -slab.sin * dx + slab.cos * dy, z = point[2] - slab.center[2];
    const bottom = -slab.size[1] / 2;
    return Math.abs(x) <= slab.size[0] / 2 + EPSILON && Math.abs(z) <= slab.size[2] / 2 + EPSILON && y <= bottom + EPSILON && y >= bottom - roofUnderside.depth - EPSILON;
  });
  const anchorOf = (point, kinds) => anchors.find(item => kinds.includes(item.kind) && inside(point, item, EPSILON)) ?? null;
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const region of [...anchors, ...planes, roofUnderside.inside]) for (const axis of [0, 1, 2]) { bounds.min[axis] = Math.min(bounds.min[axis], region.min[axis]); bounds.max[axis] = Math.max(bounds.max[axis], region.max[axis]); }
  return {
    bounds, onPlane, underRoof, anchorOf,
    allKeepout: point => all.find(item => strictlyInside(point, item)) ?? null,
    propsKeepout: point => props.find(item => strictlyInside(point, item)) ?? null,
    // Where a vertex of `material` may go: null when it fits, else why not.
    problem(point, material) {
      const blocked = all.find(item => strictlyInside(point, item));
      if (blocked) return `in keep-out ${blocked.id} (nothing may go there: ${blocked.why})`;
      if (material === 'mark' || material === 'grime') return onPlane(point, tolerance[material]) ? null : `on no decal plane within ${tolerance[material] * 1000} mm`;
      if (material === 'web') { if (!anchorOf(point, ['web'])) return 'outside every web anchor'; }
      else if (!anchorOf(point, ['floor', 'lean', 'sill', 'table', 'loft', 'ring']) && !underRoof(point)) return 'outside every prop anchor and the roof layer';
      const crowded = props.find(item => strictlyInside(point, item));
      return crowded ? `in keep-out ${crowded.id} (no prop, cobweb or debris: ${crowded.why})` : null;
    },
  };
}
const fmtPoint = point => `(${point.map(value => value.toFixed(3)).join(', ')})`;
function triangleArea(position, a, b, c) {
  const ux = position.getX(b) - position.getX(a), uy = position.getY(b) - position.getY(a), uz = position.getZ(b) - position.getZ(a);
  const vx = position.getX(c) - position.getX(a), vy = position.getY(c) - position.getY(a), vz = position.getZ(c) - position.getZ(a);
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

// { errors, warnings, roots: [{ name, triangles, meshes: [{ name, material,
// triangles }] }], presets: { low|medium|high: { drawCalls, triangles } },
// bytes }. Every check of CABIN.md section 4.4 the file can show.
export async function checkFrissonCabinGlb(input, { space = readCabinSpace() } = {}) {
  const errors = [], warnings = [], roots = [], presets = {};
  const { readGlb } = await importPublicModule('frisson/glb.js');
  const { DRESS_ROOTS, DRESS_PRESETS, DRESS_DOORS } = await importPublicModule('frisson/cabin.js');
  const bytes = input.byteLength ?? input.length;
  let glb;
  try { glb = readGlb(input); } catch (error) { return { errors: [error.message], warnings, roots, presets, bytes }; }
  if (bytes > CABIN_CONTRACT.bytes.cap) errors.push(`${bytes} bytes, the cap is ${CABIN_CONTRACT.bytes.cap}`);
  else if (bytes > CABIN_CONTRACT.bytes.target) warnings.push(`${bytes} bytes, the target is ${CABIN_CONTRACT.bytes.target}`);
  // Nothing glows and nothing is extended: no extension at all.
  if (glb.json.extensionsUsed?.length) errors.push(`extensions ${glb.json.extensionsUsed.join(', ')}: the cabin layout allows none`);
  const MATERIALS = DRESS_ROOTS.Dress_Core.materials;
  for (const material of glb.materials) if (!MATERIALS.includes(material.name)) errors.push(`material "${material.name}" is not one of ${MATERIALS.join(', ')}`);
  const placement = cabinPlacement(space), margin = CABIN_CONTRACT.margin;
  const frame = { min: placement.bounds.min.map(value => value - margin), max: placement.bounds.max.map(value => value + margin) };
  const doorOf = Object.fromEntries(Object.entries(DRESS_DOORS).map(([id, name]) => [name, id]));
  const doorCentre = id => { const wall = space.keepouts.find(item => item.id === `door-${id}-aperture`); return [(wall.min[0] + wall.max[0]) / 2, (wall.min[2] + wall.max[2]) / 2]; };
  const seen = new Set(), point = [0, 0, 0];
  for (const root of glb.roots) {
    const spec = DRESS_ROOTS[root.name];
    if (!spec) { errors.push(`${root.name}: not a root of the cabin layout (${Object.keys(DRESS_ROOTS).join(', ')})`); continue; }
    if (seen.has(root.name)) { errors.push(`${root.name}: duplicate root`); continue; }
    seen.add(root.name);
    if (root.mesh) errors.push(`${root.name}: the root must be an empty, not a mesh`);
    const entry = { name: root.name, triangles: 0, meshes: [] }, materials = new Set();
    const door = doorOf[root.name] ?? null, centre = door ? doorCentre(door) : null;
    let blood = 0;
    for (const child of root.children) {
      const material = child.name.startsWith(`${root.name}_`) ? child.name.slice(root.name.length + 1) : null;
      if (!spec.materials.includes(material)) { errors.push(`${child.name}: not a mesh of ${root.name} (${spec.materials.map(name => `${root.name}_${name}`).join(', ')})`); continue; }
      if (materials.has(material)) { errors.push(`${child.name}: duplicate (one mesh per material per root)`); continue; }
      materials.add(material);
      if (child.children.length) errors.push(`${child.name}: meshes have no children`);
      if (!child.mesh) { errors.push(`${child.name}: no mesh`); continue; }
      const { geometry, material: own } = child.mesh;
      if (own?.name !== material) errors.push(`${child.name}: material "${own?.name ?? 'none'}", expected "${material}"`);
      if (!geometry.attributes.normal) errors.push(`${child.name}: NORMAL is missing`);
      const color = geometry.attributes.color, position = geometry.attributes.position, index = geometry.index;
      if (!color) { errors.push(`${child.name}: COLOR_0 is missing`); continue; }
      const triangles = index.count / 3;
      entry.meshes.push({ name: child.name, material, triangles, vertices: position.count });
      entry.triangles += triangles;
      // Every vertex: inside the cabin frame, then where its material may go.
      const misplaced = [];
      let outside = null;
      for (let vertex = 0; vertex < position.count; vertex++) {
        point[0] = position.getX(vertex); point[1] = position.getY(vertex); point[2] = position.getZ(vertex);
        if (!inside(point, frame)) { outside ??= [...point]; continue; }
        const problem = placement.problem(point, material);
        if (problem) misplaced.push(`${fmtPoint(point)} ${problem}`);
        else if (centre && Math.hypot(point[0] - centre[0], point[2] - centre[1]) > CABIN_CONTRACT.doorReach) misplaced.push(`${fmtPoint(point)} is more than ${CABIN_CONTRACT.doorReach} m from the ${door} doorway`);
      }
      if (outside) errors.push(`${child.name}: a vertex at ${fmtPoint(outside)} is outside the cabin space (did the export swap Y and Z?)`);
      if (misplaced.length) errors.push(`${child.name}: ${misplaced.length} vertices misplaced, e.g. ${misplaced.slice(0, 3).join('; ')}`);
      // Colours, read as sRGB.
      const bad = { grime: 0, loot: 0, bright: 0, blood: 0, web: 0 };
      for (let vertex = 0; vertex < color.count; vertex++) {
        const srgb = [color.getX(vertex), color.getY(vertex), color.getZ(vertex)].map(linearToSrgb);
        if (material === 'grime') { if (Math.min(...srgb) < CABIN_CONTRACT.grimeFloor - 1e-3) bad.grime++; continue; }
        if (isBloodRed(srgb) && srgb[0] > .56) bad.bright++;
        else if (isBloodRed(srgb) && !door) bad.blood++;
        if (isLootHue(srgb)) bad.loot++;
        if (material === 'web' && hsv(srgb)[1] > .25) bad.web++;
      }
      if (bad.grime) errors.push(`${child.name}: ${bad.grime} grime colours below ${CABIN_CONTRACT.grimeFloor} sRGB (a multiplier never darkens more than that)`);
      if (bad.bright) errors.push(`${child.name}: ${bad.bright} bright red vertex colours (blood stays BLOOD_PALETTE dark)`);
      if (bad.blood) errors.push(`${child.name}: ${bad.blood} blood-red vertex colours outside a door channel`);
      if (bad.loot) errors.push(`${child.name}: ${bad.loot} vertex colours in the yellow, green or teal of pickups and halos`);
      if (bad.web) warnings.push(`${child.name}: ${bad.web} cobweb colours are not pale grey`);
      if (door && material === 'mark') for (let face = 0; face < index.count; face += 3) {
        const [a, b, c] = [index.getX(face), index.getX(face + 1), index.getX(face + 2)];
        if ([a, b, c].every(vertex => isBloodRed([color.getX(vertex), color.getY(vertex), color.getZ(vertex)].map(linearToSrgb)))) blood += triangleArea(position, a, b, c);
      }
      // Faces wound outward: the winding should agree with the normals.
      if (geometry.attributes.normal && material !== 'web') {
        const normal = geometry.attributes.normal;
        let reversed = 0;
        for (let face = 0; face < index.count; face += 3) {
          const [a, b, c] = [index.getX(face), index.getX(face + 1), index.getX(face + 2)];
          const ux = position.getX(b) - position.getX(a), uy = position.getY(b) - position.getY(a), uz = position.getZ(b) - position.getZ(a);
          const vx = position.getX(c) - position.getX(a), vy = position.getY(c) - position.getY(a), vz = position.getZ(c) - position.getZ(a);
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          if (nx * normal.getX(a) + ny * normal.getY(a) + nz * normal.getZ(a) < 0) reversed++;
        }
        if (reversed) warnings.push(`${child.name}: ${reversed} faces are wound against their normals (the game draws front faces only)`);
      }
    }
    const tiles = blood / CABIN_CONTRACT.bloodTile ** 2;
    if (door) entry.bloodTiles = Math.round(tiles * 10) / 10;
    if (tiles > CABIN_CONTRACT.bloodTiles + .5) errors.push(`${root.name}: about ${Math.round(tiles)} tiles of blood, at most ${CABIN_CONTRACT.bloodTiles} per door`);
    if (entry.meshes.length > spec.meshes) errors.push(`${root.name}: ${entry.meshes.length} meshes, at most ${spec.meshes}`);
    if (entry.triangles > spec.triangles) errors.push(`${root.name}: ${entry.triangles} triangles, budget ${spec.triangles}`);
    roots.push(entry);
  }
  if (!seen.has('Dress_Core')) errors.push('Dress_Core is missing (required)');
  for (const [id, preset] of Object.entries(DRESS_PRESETS)) {
    const kept = roots.filter(root => preset.roots.includes(root.name));
    const drawCalls = kept.reduce((sum, root) => sum + root.meshes.length, 0), triangles = kept.reduce((sum, root) => sum + root.triangles, 0);
    presets[id] = { drawCalls, triangles };
    if (drawCalls > preset.drawCalls) errors.push(`${id}: ${drawCalls} extra draw calls, budget ${preset.drawCalls}`);
    if (triangles > preset.triangles) errors.push(`${id}: ${triangles} triangles, budget ${preset.triangles}`);
  }
  return { errors, warnings, roots, presets, bytes };
}

// --- The cabin surfaces (CABIN.md sections 1 and 4.3) --------------------------------
// Section 1, measured in Famille (material colour x mean texel, sRGB) and
// the luminance each family should keep against it (warnings).
export const CABIN_LOOK = Object.freeze({
  wood: { famille: 0x704c32, luminance: [.8, .88] }, gable: { famille: 0x704c32, luminance: [.8, .88] }, interiorTimber: { famille: 0x704c32, luminance: [.8, .88] },
  floor: { famille: 0x815c3e, luminance: [.8, .9] }, boards: { famille: 0xba8550, luminance: [.85, 1] }, trim: { famille: 0x2a2523 },
  roof: { famille: 0x4e5c6e, luminance: [.75, .95] }, interiorPlaster: { famille: 0x74705d, luminance: [.75, .9] },
  interiorWainscot: { famille: 0x63573a, luminance: [.75, .9] }, interiorSkirting: { famille: 0x63573a, luminance: [.75, .9] },
  foundation: { famille: 0x464846 }, brokenGlass: { famille: 0x9cc3c6 }, boardedGap: { famille: 0x0f1211, luminance: [0, 1] }, metal: { famille: 0x343c3e },
  sofa: { famille: 0x405247, luminance: [.75, .9] }, cushion: { famille: 0x566454, luminance: [.75, .9] }, paper: { famille: 0xb6b19b },
  rackTimber: { famille: 0x514533 }, rackTrim: { famille: 0x302a24 }, rackIron: { famille: 0x70716a }, lateSupplyTimber: { famille: 0x4c5143 }, lateSupplyMetal: { famille: 0x687367 },
  generatorChassis: { famille: 0x333d38 }, generatorPaint: { famille: 0xa18a43, luminance: [.85, 1.1] },
  ground: { famille: 0x223b2f, luminance: [.9, 1.05] }, clearingEarth: { famille: 0x294737, luminance: [.9, 1.05] },
  escapeTrail: { famille: 0x55503c }, distantRunoff: { famille: 0x323e35 }, trunk: { famille: 0x302c27 }, needles: { famille: 0x153b32 }, needletips: { famille: 0x245046 }, rock: { famille: 0x41504d },
});
// The readability ratios of CABIN.md sections 1 and 2 ((L + .05) ratios of
// albedos): errors, since they carry gameplay.
export const CABIN_RATIOS = Object.freeze([
  Object.freeze({ light: 'boards', dark: 'wood', min: 2, why: 'the barricade planks stay the lightest wood, their state must read (section 2.2)' }),
  Object.freeze({ light: 'wood', dark: 'rackTimber', min: 1.22, why: 'the rack board stays darker than the wall behind it (section 1)' }),
  Object.freeze({ light: 'escapeTrail', dark: 'clearingEarth', min: 1.25, why: 'the escape trail stands out of the clearing (section 1)' }),
]);
export const CABIN_RECIPES = Object.freeze({ logs: [512, 512], floorboards: [512, 512], board: [256, 32], shingles: [256, 256], wainscot: [512, 512], deadgrass: [256, 256], mudgrass: [256, 256] });
const TRANSPARENT_KEYS = Object.freeze(['brokenGlass']);
export const MAP_KEYS = Object.freeze(['wood', 'gable', 'floor', 'boards', 'roof', 'ground', 'clearingEarth', 'interiorWainscot', 'interiorSkirting', 'interiorTimber']);
const SURFACE_PROPERTIES = ['color', 'roughness', 'metalness', 'opacity', 'texture'];
// The tests' fake 2D context: fillStyle and fillRect only, each call recorded.
export function recordingContext() {
  const calls = [];
  return { calls, fillStyle: '#000000', fillRect(x, y, w, h) { calls.push([this.fillStyle, x, y, w, h]); } };
}
// Words a pure data module never needs (comments and strings aside).
const IMPURE = /\b(import|require|document|window|globalThis|self|THREE|fetch|XMLHttpRequest|eval|Function|Date|performance|crypto)\b|Math\.random/;
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');

// { errors, warnings, surfaces: [{ key, albedo, luminance, ratio }],
// textures: [{ name, size, grid, mean, cells }] } for a recipes module (its
// exports) and, when given, its source text.
export async function checkFrissonCabinSurfaces(module, { text = null } = {}) {
  const errors = [], warnings = [], surfaces = [], textures = [];
  const { DRESSING_SURFACE_KEYS, DRESSING_OBJECT_KEYS } = await importPublicModule('world.js');
  const { drawRecipe, recipeShape, cssColour } = await importPublicModule('frisson/cabin.js');
  if (text !== null) {
    const match = IMPURE.exec(code(text));
    if (match) errors.push(`the module uses "${match[0]}": a recipes module is pure data (no imports, THREE, DOM, network, clock or Math.random)`);
  }
  const recipes = module?.CABIN_SURFACES, recipeTextures = module?.CABIN_TEXTURES ?? {}, objects = module?.CABIN_OBJECTS ?? {};
  if (!recipes || typeof recipes !== 'object') return { errors: [...errors, 'CABIN_SURFACES is missing'], warnings, surfaces, textures };
  // Every recipe: its shape, both sizes through the real helpers, the same
  // calls twice, every fill inside the canvas, the low draw half the high one.
  const means = new Map();
  for (const [name, recipe] of Object.entries(recipeTextures)) {
    try {
      const { size, grid } = recipeShape(name, recipe);
      if (CABIN_RECIPES[name] && (size[0] !== CABIN_RECIPES[name][0] || size[1] !== CABIN_RECIPES[name][1])) warnings.push(`texture ${name}: ${size.join('x')} px, Famille's is ${CABIN_RECIPES[name].join('x')}`);
      const full = recordingContext(), again = recordingContext(), half = recordingContext();
      drawRecipe(name, recipe, full); drawRecipe(name, recipe, again); drawRecipe(name, recipe, half, { half: true });
      if (!full.calls.length) errors.push(`texture ${name}: draws nothing`);
      if (JSON.stringify(full.calls) !== JSON.stringify(again.calls)) errors.push(`texture ${name}: two draws differ (not deterministic)`);
      if (JSON.stringify(half.calls) !== JSON.stringify(full.calls.map(([style, ...box]) => [style, ...box.map(value => value / 2)]))) errors.push(`texture ${name}: the half-size draw is not the full one at half scale`);
      const outside = full.calls.find(([, x, y, w, h]) => x < 0 || y < 0 || x + w > size[0] + EPSILON || y + h > size[1] + EPSILON);
      if (outside) errors.push(`texture ${name}: a fill at ${outside.slice(1).join(', ')} leaves the ${size.join('x')} canvas`);
      // The mean texel, in linear light, cell by cell (later fills win).
      const [columns, rows] = grid, cellX = size[0] / columns, cellY = size[1] / rows, cells = new Float64Array(columns * rows * 3);
      for (const [style, x, y, w, h] of full.calls) {
        const linear = cssColour(style).map(channel => srgbToLinear(channel / 255));
        for (let row = Math.round(y / cellY); row < Math.round((y + h) / cellY); row++) for (let column = Math.round(x / cellX); column < Math.round((x + w) / cellX); column++) cells.set(linear, (row * columns + column) * 3);
      }
      const mean = [0, 0, 0];
      for (let cell = 0; cell < columns * rows; cell++) for (let channel = 0; channel < 3; channel++) mean[channel] += cells[cell * 3 + channel] / (columns * rows);
      means.set(name, mean);
      textures.push({ name, size, grid, calls: full.calls.length, mean: rgbHex(mean.map(linearToSrgb)) });
    } catch (error) { errors.push(String(error?.message ?? error)); }
  }
  for (const name of Object.keys(CABIN_RECIPES)) if (!Object.hasOwn(recipeTextures, name)) warnings.push(`texture ${name} is not in CABIN_TEXTURES`);
  const albedo = {};
  for (const [key, look] of Object.entries(recipes)) {
    if (!DRESSING_SURFACE_KEYS.includes(key)) { errors.push(`surface ${key} is not one of world.surfaceKeys`); continue; }
    if (!look || typeof look !== 'object') { errors.push(`surface ${key}: not an object`); continue; }
    for (const property of Object.keys(look)) if (!SURFACE_PROPERTIES.includes(property)) errors.push(`surface ${key}: unknown property ${property}`);
    const { color = null, roughness, metalness, opacity, texture } = look;
    if (color !== null && !(Number.isInteger(color) && color >= 0 && color <= 0xffffff)) errors.push(`surface ${key}: color must be a 0xrrggbb number`);
    for (const [name, value] of [['roughness', roughness], ['metalness', metalness], ['opacity', opacity]]) if (value !== undefined && !(Number.isFinite(value) && value >= 0 && value <= 1)) errors.push(`surface ${key}: ${name} must be 0..1`);
    if (opacity !== undefined && !TRANSPARENT_KEYS.includes(key)) errors.push(`surface ${key}: opacity only where Famille is transparent (${TRANSPARENT_KEYS.join(', ')})`);
    if (texture !== undefined) {
      if (!MAP_KEYS.includes(key)) errors.push(`surface ${key}: a texture only where Famille has a map (${MAP_KEYS.join(', ')})`);
      else if (!means.has(texture)) errors.push(`surface ${key}: texture ${texture} is not a working recipe of CABIN_TEXTURES`);
    }
    // The albedo: the material colour times the mean texel (Famille's own
    // map when the recipe keeps it: unknown here, so no albedo).
    if (texture === undefined && MAP_KEYS.includes(key)) { warnings.push(`surface ${key}: no texture, the Famille map stays under the new colour`); continue; }
    const base = color === null ? null : hexRgb(color).map(srgbToLinear);
    if (!base) continue;
    const linear = texture !== undefined && means.has(texture) ? base.map((value, channel) => value * means.get(texture)[channel]) : base;
    albedo[key] = linear.map(linearToSrgb);
  }
  for (const key of DRESSING_SURFACE_KEYS) if (!Object.hasOwn(recipes, key)) warnings.push(`surface ${key} is not restyled (keeps its Famille look)`);
  for (const [key, srgb] of Object.entries(albedo)) {
    const famille = CABIN_LOOK[key]?.famille, entry = { key, albedo: rgbHex(srgb), luminance: +luminance(srgb).toFixed(4) };
    if (famille !== undefined) {
      entry.famille = rgbHex(hexRgb(famille)); entry.ratio = +(luminance(srgb) / luminance(hexRgb(famille))).toFixed(3);
      const range = CABIN_LOOK[key].luminance;
      if (range && !(entry.ratio >= range[0] - 1e-3 && entry.ratio <= range[1] + 1e-3)) warnings.push(`surface ${key}: albedo ${entry.albedo} has ${Math.round(entry.ratio * 100)} % of Famille's luminance, section 1 aims at ${range.map(value => Math.round(value * 100)).join('-')} %`);
    }
    surfaces.push(entry);
  }
  const L = key => albedo[key] ? luminance(albedo[key]) : null;
  for (const { light, dark, min, why } of CABIN_RATIOS) {
    if (L(light) === null || L(dark) === null) continue;
    const ratio = (L(light) + .05) / (L(dark) + .05);
    if (ratio < min) errors.push(`${light} over ${dark}: (L + .05) ratio ${ratio.toFixed(2)}, at least ${min}: ${why}`);
  }
  if (L('boardedGap') !== null && L('boardedGap') > luminance(hexRgb(CABIN_LOOK.boardedGap.famille)) + 1e-6) errors.push('boardedGap may only get darker');
  for (const [name, look] of Object.entries(objects)) {
    if (!DRESSING_OBJECT_KEYS.includes(name)) { errors.push(`object ${name} is not one of world.objectKeys`); continue; }
    for (const [property, value] of Object.entries(look ?? {})) {
      if (property === 'visible' ? typeof value !== 'boolean' : property === 'color' ? !(Number.isInteger(value) && value >= 0 && value <= 0xffffff) : true) errors.push(`object ${name}: bad ${property}`);
    }
  }
  return { errors, warnings, surfaces, textures };
}

// --- Pickups (art/frisson/PICKUPS.md section 2) -----------------------------------
// Fourteen roots FrissonPickup_<Kind>_<Tier> (Kind Points, Ammo, AmmoSpecial,
// Health, Armor, Grenade or Revive; Tier Light or Full), each an identity
// empty with a required _Body mesh (material pickup) and an optional _Glint
// (pickup_glint — the Grenade has none: Famille's grenade has no emissive
// part), authored in the pickupModel frame at rest: metres, +Y up, the
// origin on the floor under the spin axis.
const { BLOOD_PALETTE: PICKUPS_BLOOD } = await importPublicModule('frisson/blood.js');
export const PICKUPS_CONTRACT = Object.freeze({
  prefix: 'FrissonPickup_',
  kinds: Object.freeze(['Points', 'Ammo', 'AmmoSpecial', 'Health', 'Armor', 'Grenade', 'Revive']),
  tiers: Object.freeze(['Light', 'Full']),
  materials: Object.freeze({ Body: 'pickup', Glint: 'pickup_glint' }),
  // K3: the envelope per kind (AmmoSpecial shares Ammo's), the Famille size
  // floors, the floor contact and the spin-axis centring.
  envelope: Object.freeze({
    Points: Object.freeze({ y: Object.freeze([0, .254]), radius: .180, floorRadius: .141, floorHeight: .197 }),
    Ammo: Object.freeze({ y: Object.freeze([0, .3565]), radius: .270, floorRadius: .223, floorHeight: .265 }),
    Health: Object.freeze({ y: Object.freeze([0, .3525]), radius: .2511, floorRadius: .2016, floorHeight: .2656 }),
    Armor: Object.freeze({ y: Object.freeze([0, .162]), radius: .3354, floorRadius: .2851, floorHeight: .0995 }),
    Grenade: Object.freeze({ y: Object.freeze([0, .2045]), radius: .0695, floorRadius: .0472, floorHeight: .1507 }),
    Revive: Object.freeze({ y: Object.freeze([0, .298]), radius: .2331, floorRadius: .1862, floorHeight: .2108 }),
  }),
  // The centring allowance is per kind: Famille's vest already reaches
  // r .3354, past the halo ring's .271 inner edge, and sits .05 off-axis, so
  // the Frisson vest stays inside Famille's own envelope instead of growing —
  // Armor's radius cap is Famille's .3354 and its centre keeps the Famille
  // offset (art/frisson/pickups-more/NOTES.md, « L'armure, à savoir »).
  floor: .03,
  centre: Object.freeze({ default: .03, Armor: .06 }),
  // K4 (the ammo kinds only): the fill bars' keep-out boxes (the side one
  // mirrored for the back bar) and, per bar, the ray grid whose first Body
  // hit must land on a dark backing in the hit range (relative luminance,
  // linear).
  keepOut: Object.freeze({
    side: Object.freeze({ x: Object.freeze([-.135, .135]), y: Object.freeze([.05, .10]), z: Object.freeze([.1515, .30]) }),
    top: Object.freeze({ x: Object.freeze([-.135, .135]), y: Object.freeze([.3065, .40]), z: Object.freeze([.0375, .0925]) }),
  }),
  backing: Object.freeze({
    front: Object.freeze({ axis: 'z', from: .30, dir: -1, u: Object.freeze({ axis: 'x', range: Object.freeze([-.12, .12]), steps: 9 }), v: Object.freeze({ axis: 'y', range: Object.freeze([.063, .087]), steps: 3 }), hit: Object.freeze([.140, .1515]) }),
    back: Object.freeze({ axis: 'z', from: -.30, dir: 1, u: Object.freeze({ axis: 'x', range: Object.freeze([-.12, .12]), steps: 9 }), v: Object.freeze({ axis: 'y', range: Object.freeze([.063, .087]), steps: 3 }), hit: Object.freeze([-.1515, -.140]) }),
    top: Object.freeze({ axis: 'y', from: .40, dir: -1, u: Object.freeze({ axis: 'x', range: Object.freeze([-.12, .12]), steps: 9 }), v: Object.freeze({ axis: 'z', range: Object.freeze([.053, .077]), steps: 3 }), hit: Object.freeze([.295, .3065]) }),
    luminance: .05,
  }),
  // K5: the file budgets doubled with the merged file, which now holds both
  // artists' lots (money/ammo and health/armor/grenade/revive — 12,992
  // triangles, 551,720 bytes as installed).
  triangles: Object.freeze({ body: 1000, glint: 300, root: 1200, file: 14400 }),
  bytes: Object.freeze({ target: 500_000, cap: 800_000 }),
  // K6: OKLCh chroma caps per vertex (linear, as the weapons' D4; blood
  // vertices exempt).
  chroma: Object.freeze({ base: .10, warm: .13, warmHue: Object.freeze([55, 115]), teal: .08, tealHue: Object.freeze([170, 200]) }),
  // K7: the cue definitions (OKLCh of a triangle's mean colour) and the
  // area-weighted shares per root; K8: the Glint carries the kind's cue and
  // covers at most 40 % of the root's area.
  cue: Object.freeze({
    gold: Object.freeze({ hue: Object.freeze([70, 100]), chroma: .06, lightness: .50, pointsShare: Object.freeze({ Light: .40, Full: .25 }) }),
    teal: Object.freeze({ hue: Object.freeze([170, 200]), chroma: .034, lightness: .50, ammoShare: .04, specialMax: .005 }),
    ochre: Object.freeze({ hue: Object.freeze([70, 100]), chroma: .052, lightness: .55, margin: .04 }),
    // The four new kinds' cues (art/frisson/pickups-more/NOTES.md), minima
    // per root in both tiers; the hearts are the one desaturated cue.
    cross: Object.freeze({ hue: Object.freeze([140, 170]), chroma: .05, lightness: .50, share: .04 }),
    chevron: Object.freeze({ hue: Object.freeze([225, 255]), chroma: .035, lightness: .55, share: .01 }),
    amber: Object.freeze({ hue: Object.freeze([60, 90]), chroma: .06, lightness: .50, share: .20 }),
    orange: Object.freeze({ hue: Object.freeze([40, 70]), chroma: .07, lightness: .45, share: .25 }),
    hearts: Object.freeze({ chromaMax: .03, lightness: .75, share: .02 }),
  }),
  glintShare: .40,
  // K9: pixel blood on the Body, tiles as bloodTiles measures them (caps in
  // count and area, m²). The two darkest palette colours are indices 0 and 1;
  // the windows are the K4 backing zones a tile never enters (centroid test,
  // the ammo kinds only, as the keep-outs).
  blood: Object.freeze({
    palette: Object.freeze([...PICKUPS_BLOOD]),
    tolerance: .02, darkestShare: .60, cueDistance: .0015,
    // Each tile a square slab of 8-14 mm (measured in its own frame by
    // bloodTiles, .5 mm slack for float rounding) and .8-2 mm thick.
    tile: Object.freeze([.008, .014]), slack: .0005, tileThickness: Object.freeze([.0008, .002]),
    caps: Object.freeze({
      Points: Object.freeze({ Light: Object.freeze({ tiles: 3, area: 3e-4, darkestOnly: true }), Full: Object.freeze({ tiles: 8, area: 8e-4 }) }),
      Ammo: Object.freeze({ Light: Object.freeze({ tiles: 3, area: 3e-4, darkestOnly: true }), Full: Object.freeze({ tiles: Object.freeze([15, 36]), area: 50e-4 }) }),
    }),
    sideWindow: Object.freeze({ x: .135, y: Object.freeze([.05, .10]), z: .135 }),
    topWindow: Object.freeze({ x: .135, z: Object.freeze([.0375, .0925]), y: .29 }),
  }),
  // K10 (the weapons' D1 numbers).
  thickness: Object.freeze({ solid: .0015, tile: .0008 }),
});

// OKLCh with the lightness, for the K7/K8 cue windows.
function oklchLight(r, g, b) {
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const alpha = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s;
  const beta = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  const hue = Math.atan2(beta, alpha) * 180 / Math.PI;
  return { lightness: .2104542553 * l + .7936177850 * m - .0040720468 * s, chroma: Math.hypot(alpha, beta), hue: hue < 0 ? hue + 360 : hue };
}

// The K7 cue classes of a linear colour.
function cueOfColor(rgb) {
  const { lightness, chroma, hue } = oklchLight(...rgb), cue = PICKUPS_CONTRACT.cue;
  const inHue = window => hue >= window[0] && hue <= window[1];
  return {
    gold: inHue(cue.gold.hue) && chroma >= cue.gold.chroma && lightness >= cue.gold.lightness,
    teal: inHue(cue.teal.hue) && chroma >= cue.teal.chroma && lightness >= cue.teal.lightness,
    ochre: inHue(cue.ochre.hue) && chroma >= cue.ochre.chroma && lightness >= cue.ochre.lightness,
    cross: inHue(cue.cross.hue) && chroma >= cue.cross.chroma && lightness >= cue.cross.lightness,
    chevron: inHue(cue.chevron.hue) && chroma >= cue.chevron.chroma && lightness >= cue.chevron.lightness,
    amber: inHue(cue.amber.hue) && chroma >= cue.amber.chroma && lightness >= cue.amber.lightness,
    orange: inHue(cue.orange.hue) && chroma >= cue.orange.chroma && lightness >= cue.orange.lightness,
    hearts: chroma <= cue.hearts.chromaMax && lightness >= cue.hearts.lightness,
  };
}

// K4 (the fill bars, their keep-outs, backing grids and blood windows)
// belongs to the ammo kinds only; the other kinds have no fill bars.
const AMMO_KINDS = Object.freeze(['Ammo', 'AmmoSpecial']);
// The cue classes each kind answers to: K9's blood clearance (and the CLI's
// per-root shares). K8's Glint colour is the one class it glows with.
const KIND_CUES = Object.freeze({
  Points: Object.freeze(['gold']), Ammo: Object.freeze(['teal', 'ochre']), AmmoSpecial: Object.freeze(['teal', 'ochre']),
  Health: Object.freeze(['cross']), Armor: Object.freeze(['chevron']), Grenade: Object.freeze(['amber']), Revive: Object.freeze(['orange', 'hearts']),
});
const GLINT_CUE = Object.freeze({ Points: 'gold', Ammo: 'teal', AmmoSpecial: 'ochre', Health: 'cross', Armor: 'chevron', Revive: 'hearts' });

const crossOf = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Exact triangle/box overlap (the thirteen separating axes), for the K4
// keep-outs.
function triHitsBox(tri, min, max) {
  const centre = [0, 1, 2].map(axis => (min[axis] + max[axis]) / 2), half = [0, 1, 2].map(axis => (max[axis] - min[axis]) / 2);
  const v = tri.map(point => [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]]);
  const edges = [[1, 0], [2, 1], [0, 2]].map(([p, q]) => [v[p][0] - v[q][0], v[p][1] - v[q][1], v[p][2] - v[q][2]]);
  const separates = axis => {
    const r = half[0] * Math.abs(axis[0]) + half[1] * Math.abs(axis[1]) + half[2] * Math.abs(axis[2]);
    const p = v.map(point => point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2]);
    return Math.min(...p) > r + 1e-12 || Math.max(...p) < -r - 1e-12;
  };
  for (let axis = 0; axis < 3; axis++) {
    const values = v.map(point => point[axis]);
    if (Math.min(...values) > half[axis] + 1e-12 || Math.max(...values) < -half[axis] - 1e-12) return false;
  }
  const normal = crossOf(edges[0], edges[1]);
  if (Math.hypot(...normal) > 1e-14 && separates(normal)) return false;
  for (const edge of edges) for (let axis = 0; axis < 3; axis++) {
    const unit = [0, 0, 0]; unit[axis] = 1;
    const product = crossOf(edge, unit);
    if (Math.hypot(...product) > 1e-14 && separates(product)) return false;
  }
  return true;
}

// The K4 keep-out boxes (the side one mirrored for the back bar).
function keepOutBoxes() {
  const { side, top } = PICKUPS_CONTRACT.keepOut;
  return [
    { label: 'front', min: [side.x[0], side.y[0], side.z[0]], max: [side.x[1], side.y[1], side.z[1]] },
    { label: 'back', min: [side.x[0], side.y[0], -side.z[1]], max: [side.x[1], side.y[1], -side.z[0]] },
    { label: 'top', min: [top.x[0], top.y[0], top.z[0]], max: [top.x[1], top.y[1], top.z[1]] },
  ];
}

// The triangles of a geometry as position/colour triples, for K4, K7 and K9.
function trianglesOf(geometry) {
  const position = geometry.attributes.position, color = geometry.attributes.color, index = geometry.index, out = [];
  for (let face = 0; face < index.count; face += 3) {
    const ids = [index.getX(face), index.getX(face + 1), index.getX(face + 2)];
    out.push({
      points: ids.map(vertex => [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]),
      colors: color ? ids.map(vertex => [color.getX(vertex), color.getY(vertex), color.getZ(vertex)]) : null,
    });
  }
  return out;
}
const triAreaOf = ({ points: [a, b, c] }) => {
  const n = crossOf([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  return Math.hypot(...n) / 2;
};

// K4's backing: the first Body hit of each ray of one bar's grid (Möller–
// Trumbore), its coordinate inside the hit range and its colour dark.
function backingFailures(geometry, bar) {
  const tris = trianglesOf(geometry), axisOf = { x: 0, y: 1, z: 2 };
  const rayAxis = axisOf[bar.axis], uAxis = axisOf[bar.u.axis], vAxis = axisOf[bar.v.axis];
  const dir = [0, 0, 0]; dir[rayAxis] = bar.dir;
  const failures = [];
  for (let i = 0; i < bar.u.steps; i++) for (let j = 0; j < bar.v.steps; j++) {
    const origin = [0, 0, 0];
    origin[rayAxis] = bar.from;
    origin[uAxis] = bar.u.range[0] + (bar.u.range[1] - bar.u.range[0]) * i / (bar.u.steps - 1);
    origin[vAxis] = bar.v.range[0] + (bar.v.range[1] - bar.v.range[0]) * j / (bar.v.steps - 1);
    let best = null;
    for (const { points, colors } of tris) {
      const [a, b, c] = points;
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const p = crossOf(dir, e2), det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-12) continue;
      const s = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
      const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      const q = crossOf(s, e1), v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
      if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
      if (t > 1e-9 && (!best || t < best.t)) best = { t, u, v, colors };
    }
    if (!best) { failures.push({ range: Infinity }); continue; }
    const hit = origin[rayAxis] + bar.dir * best.t;
    if (hit < bar.hit[0] - 1e-9 || hit > bar.hit[1] + 1e-9) {
      failures.push({ range: hit < bar.hit[0] ? bar.hit[0] - hit : hit - bar.hit[1], hit });
      continue;
    }
    if (best.colors) {
      const w = 1 - best.u - best.v;
      const rgb = [0, 1, 2].map(channel => w * best.colors[0][channel] + best.u * best.colors[1][channel] + best.v * best.colors[2][channel]);
      const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
      if (luminance > PICKUPS_CONTRACT.backing.luminance + 1e-9) failures.push({ luminance });
    }
  }
  return failures;
}

// The distance from a point to the nearest of a list of triangles.
function nearestTriangle(point, tris) {
  const out = [0, 0, 0], flat = [];
  let nearest = Infinity;
  for (const { points } of tris) {
    flat.length = 0;
    for (const p of points) flat.push(p[0], p[1], p[2]);
    closestOnTriangle(point[0], point[1], point[2], flat, out);
    nearest = Math.min(nearest, Math.hypot(point[0] - out[0], point[1] - out[1], point[2] - out[2]));
  }
  return nearest;
}

// { errors, warnings, roots, info, triangles }: every check of PICKUPS.md
// section 2 the file can show (K1-K10). roots maps each root name to
// { triangles: { body, glint }, y, radius, centre, cue: { gold, teal, ochre,
// cross, chevron, amber, orange, hearts }, blood: { tiles, area, colours } }.
export async function checkFrissonPickupsGlb(input) {
  const C = PICKUPS_CONTRACT, errors = [], warnings = [], roots = {}, info = [];
  const { readGlb } = await importPublicModule('frisson/glb.js');
  let glb;
  try { glb = readGlb(input); } catch (error) { return { errors: [error.message], warnings, roots, info, triangles: 0 }; }
  const bytes = input.byteLength ?? input.length;
  if (bytes > C.bytes.cap) errors.push(`${bytes} bytes, the cap is ${C.bytes.cap} (K5)`);
  else if (bytes > C.bytes.target) warnings.push(`${bytes} bytes, the target is ${C.bytes.target} (K5)`);
  if ((glb.json.extensionsUsed ?? []).length) errors.push(`extensions ${glb.json.extensionsUsed.join(', ')}: the pickups layout allows none (K1)`);
  const bloodLinear = bloodLinearOf(C.blood.palette);
  const isBlood = rgb => bloodLinear.some(([r, g, b]) => Math.hypot(rgb[0] - r, rgb[1] - g, rgb[2] - b) <= C.blood.tolerance);
  const expected = C.kinds.flatMap(kind => C.tiers.map(tier => `${C.prefix}${kind}_${tier}`));
  const kindOf = name => name.slice(C.prefix.length).replace(/_(Light|Full)$/, ''), tierOf = name => name.endsWith('_Light') ? 'Light' : 'Full';
  const seen = new Set(), records = new Map();
  let triangles = 0;

  // K2: exactly the fourteen roots, _Body (required) and _Glint (optional,
  // refused on the Grenade at K8), the two materials, no dots; K1's layout
  // refusals come from readGlb above.
  for (const root of glb.roots) {
    const where = root.name;
    if (where.includes('.') || !expected.includes(where)) {
      errors.push(`${where}: root names must be FrissonPickup_<Kind>_<Tier>, Kind one of ${C.kinds.join(', ')}, Tier ${C.tiers.join(' or ')} (no dots)`);
      continue;
    }
    if (seen.has(where)) errors.push(`${where}: duplicate root`);
    seen.add(where);
    if (root.mesh) errors.push(`${where}: the root must be an empty, not a mesh`);
    const record = { kind: kindOf(where), tier: tierOf(where), triangles: {}, geometries: {} };
    records.set(where, record);
    for (const child of root.children) {
      const channel = child.name === `${where}_Body` ? 'Body' : child.name === `${where}_Glint` ? 'Glint' : null;
      if (child.name.includes('.')) errors.push(`${child.name}: no dots in names (K2)`);
      if (!channel) { errors.push(`${child.name}: not a channel of ${where} (_Body, required, and _Glint, optional; K2)`); continue; }
      if (record.geometries[channel]) { errors.push(`${child.name}: duplicate channel`); continue; }
      if (child.children.length) errors.push(`${child.name}: channels have no children`);
      if (!child.mesh) { errors.push(`${child.name}: no mesh`); continue; }
      const { geometry, material } = child.mesh;
      if (material?.name !== C.materials[channel]) errors.push(`${child.name}: material "${material?.name ?? 'none'}", expected "${C.materials[channel]}" (K2)`);
      if (material?.doubleSided) errors.push(`${child.name}: single-sided, every face wound outward (K1)`);
      if (!geometry.attributes.normal) errors.push(`${child.name}: NORMAL is missing (the contract exports smooth normals, K1)`);
      if (!geometry.attributes.color) errors.push(`${child.name}: COLOR_0 is missing (K1)`);
      record.triangles[channel.toLowerCase()] = geometry.index.count / 3;
      record.geometries[channel] = { name: child.name, geometry };
      triangles += geometry.index.count / 3;
    }
    if (!record.geometries.Body && !root.children.some(child => child.name === `${where}_Body`)) errors.push(`${where}_Body is missing (required, K2)`);
  }
  for (const name of expected) if (!glb.roots.some(root => root.name === name)) errors.push(`${name} is missing (one of the fourteen required roots, K2)`);
  for (const material of glb.materials) if (!Object.values(C.materials).includes(material.name)) errors.push(`material "${material.name}" is not one of ${Object.values(C.materials).join(', ')} (K2)`);
  if (triangles > C.triangles.file) errors.push(`${triangles} triangles in the whole file, the budget is ${C.triangles.file} (K5)`);

  for (const [where, record] of records) {
    const { kind, tier } = record, env = C.envelope[kind] ?? C.envelope.Ammo; // AmmoSpecial shares Ammo's envelope
    const centreCap = C.centre[kind] ?? C.centre.default;
    const body = record.geometries.Body, glint = record.geometries.Glint;
    const entries = Object.values(record.geometries);
    const bodyTris = record.triangles.body ?? 0, glintTris = record.triangles.glint ?? 0;
    if (bodyTris > C.triangles.body) errors.push(`${where}: the Body has ${bodyTris} triangles, the budget is ${C.triangles.body} (K5)`);
    if (glintTris > C.triangles.glint) errors.push(`${where}: the Glint has ${glintTris} triangles, the budget is ${C.triangles.glint} (K5)`);
    if (bodyTris + glintTris > C.triangles.root) errors.push(`${where}: ${bodyTris + glintTris} triangles, the root budget is ${C.triangles.root} (K5)`);
    if (!entries.length) continue;

    // K3: the envelope (every vertex), the size floors, the floor contact and
    // the spin-axis centring.
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let radius = 0;
    for (const entry of entries) {
      const position = entry.geometry.attributes.position;
      let below = 0, above = 0, far = 0;
      for (let vertex = 0; vertex < position.count; vertex++) {
        const point = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)];
        for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
        if (point[1] < env.y[0] - 1e-6) below = Math.max(below, env.y[0] - point[1]);
        if (point[1] > env.y[1] + 1e-6) above = Math.max(above, point[1] - env.y[1]);
        far = Math.max(far, Math.hypot(point[0], point[2]));
      }
      radius = Math.max(radius, far);
      if (below) errors.push(`${entry.name}: a vertex ${mm(below)} below the floor (K3: y ${env.y[0]}..${env.y[1]})`);
      if (above) errors.push(`${entry.name}: a vertex ${mm(above)} above the envelope (K3: y ${env.y[0]}..${env.y[1]})`);
      if (far > env.radius + 1e-6) errors.push(`${entry.name}: a vertex at swept radius ${fmt(far)}, ${mm(far - env.radius)} past the ${env.radius} cap (K3: the halo ring stays clear)`);
    }
    const height = max[1] - min[1];
    if (radius < env.floorRadius - 1e-6) errors.push(`${where}: swept radius ${fmt(radius)}, ${mm(env.floorRadius - radius)} under the Famille size floor ${env.floorRadius} (K3)`);
    if (height < env.floorHeight - 1e-6) errors.push(`${where}: height ${fmt(height)}, ${mm(env.floorHeight - height)} under the Famille size floor ${env.floorHeight} (K3)`);
    if (min[1] > C.floor + 1e-6) errors.push(`${where}: the lowest vertex is at y ${fmt(min[1])}, ${mm(min[1] - C.floor)} above the ${C.floor} allowance (K3: it sits on the floor)`);
    record.y = [min[1], max[1]]; record.radius = radius; record.centre = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
    for (const [axis, value] of [['x', record.centre[0]], ['z', record.centre[1]]])
      if (Math.abs(value) > centreCap + 1e-6) errors.push(`${where}: the bounding box centre sits at ${axis} ${fmt(value)}, ${mm(Math.abs(value) - centreCap)} past the ${centreCap} allowance (K3: the spin must not wobble)`);

    // K4 (the ammo kinds): the fill bars' keep-outs and the dark backing
    // behind them.
    if (AMMO_KINDS.includes(kind)) {
      const boxes = keepOutBoxes(), counts = new Map(), depth = new Map();
      for (const entry of entries) for (const tri of trianglesOf(entry.geometry)) {
        const triMin = [0, 1, 2].map(axis => Math.min(tri.points[0][axis], tri.points[1][axis], tri.points[2][axis]));
        const triMax = [0, 1, 2].map(axis => Math.max(tri.points[0][axis], tri.points[1][axis], tri.points[2][axis]));
        for (const box of boxes) if (triHitsBox(tri.points, box.min, box.max)) {
          counts.set(box.label, (counts.get(box.label) ?? 0) + 1);
          const overlap = Math.min(...[0, 1, 2].map(axis => Math.min(triMax[axis], box.max[axis]) - Math.max(triMin[axis], box.min[axis])));
          depth.set(box.label, Math.max(depth.get(box.label) ?? 0, overlap));
        }
      }
      for (const box of boxes) if (counts.get(box.label))
        errors.push(`${where}: ${counts.get(box.label)} triangle${counts.get(box.label) === 1 ? '' : 's'} overlap the ${box.label} fill keep-out by up to ${mm(depth.get(box.label))} (K4: the fill bars stay readable)`);
      if (body) for (const barName of ['front', 'back', 'top']) {
        const bar = C.backing[barName], failures = backingFailures(body.geometry, bar), total = bar.u.steps * bar.v.steps;
        if (!failures.length) continue;
        const parts = [], misses = failures.filter(failure => failure.range === Infinity).length;
        const worstRange = Math.max(0, ...failures.map(failure => Number.isFinite(failure.range) ? failure.range : 0));
        const worstLuminance = Math.max(0, ...failures.map(failure => failure.luminance ?? 0));
        if (misses) parts.push(`${misses} ray${misses === 1 ? '' : 's'} hit nothing`);
        if (worstRange) parts.push(`the worst first hit lands ${mm(worstRange)} outside ${bar.hit.join('..')}`);
        if (worstLuminance) parts.push(`a hit's luminance ${worstLuminance.toFixed(3)} is over ${C.backing.luminance} (the bar needs a dark backing)`);
        errors.push(`${where}: the ${barName} fill backing fails ${failures.length}/${total} rays (${parts.join('; ')}, K4)`);
      }
    }

    // K6: muted colours per vertex (blood exempt).
    for (const entry of entries) {
      const color = entry.geometry.attributes.color;
      if (!color) continue;
      for (let vertex = 0; vertex < color.count; vertex++) {
        const rgb = [color.getX(vertex), color.getY(vertex), color.getZ(vertex)];
        if (isBlood(rgb)) continue;
        const { chroma, hue } = oklchOf(...rgb);
        let cap = C.chroma.base, why = 'muted colours';
        if (hue >= C.chroma.warmHue[0] && hue <= C.chroma.warmHue[1]) { cap = C.chroma.warm; why = 'the gold, brass and ochre hues'; }
        else if (hue >= C.chroma.tealHue[0] && hue <= C.chroma.tealHue[1]) { cap = C.chroma.teal; why = 'the teal hues'; }
        if (chroma > cap + 1e-3) { errors.push(`${entry.name}: a vertex at chroma ${chroma.toFixed(3)}, the cap is ${cap} (${why}, K6)`); break; }
      }
    }

    // K7: the area-weighted cue shares over every triangle of the root.
    const share = { gold: 0, teal: 0, ochre: 0, cross: 0, chevron: 0, amber: 0, orange: 0, hearts: 0 };
    let area = 0;
    const cueTriangles = [];
    for (const entry of entries) for (const tri of trianglesOf(entry.geometry)) {
      const size = triAreaOf(tri);
      area += size;
      if (!tri.colors) continue;
      const mean = [0, 1, 2].map(channel => (tri.colors[0][channel] + tri.colors[1][channel] + tri.colors[2][channel]) / 3);
      const cues = cueOfColor(mean);
      for (const key of Object.keys(share)) if (cues[key]) share[key] += size;
      cueTriangles.push({ points: tri.points, cues });
    }
    for (const key of Object.keys(share)) share[key] = area > 0 ? share[key] / area : 0;
    record.cue = share; record.area = area; record.cueTriangles = cueTriangles;
    const points = value => `${(value * 100).toFixed(1)} %`;
    const under = (key, label, verb = 'covers') => {
      const need = C.cue[key].share;
      if (share[key] < need - 1e-4) errors.push(`${where}: ${label} ${verb} ${points(share[key])} of the root, ${((need - share[key]) * 100).toFixed(1)} points under the ${points(need)} floor (K7)`);
    };
    if (kind === 'Points') {
      const need = C.cue.gold.pointsShare[tier];
      if (share.gold < need - 1e-4) errors.push(`${where}: coin gold covers ${points(share.gold)} of the root, ${((need - share.gold) * 100).toFixed(1)} points under the ${points(need)} floor (K7)`);
    } else if (kind === 'Ammo') {
      if (share.teal < C.cue.teal.ammoShare - 1e-4) errors.push(`${where}: the teal stencil covers ${points(share.teal)} of the root, ${((C.cue.teal.ammoShare - share.teal) * 100).toFixed(1)} points under the ${points(C.cue.teal.ammoShare)} floor (K7)`);
    } else if (kind === 'AmmoSpecial') {
      if (share.teal > C.cue.teal.specialMax + 1e-4)
        errors.push(`${where}: teal covers ${points(share.teal)} of a special box, ${((share.teal - C.cue.teal.specialMax) * 100).toFixed(1)} points over the ${points(C.cue.teal.specialMax)} cap (K7: special reads gold-ochre)`);
    } else if (kind === 'Health') under('cross', 'the green cross');
    else if (kind === 'Armor') under('chevron', 'the pale chevron');
    else if (kind === 'Grenade') under('amber', 'the amber bands', 'cover');
    else if (kind === 'Revive') { under('orange', 'the orange kit'); under('hearts', 'the white hearts', 'cover'); }

    // K8: the Glint carries the kind's cue colour and stays a garnish. The
    // grenade has none: Famille's grenade has no emissive part.
    if (kind === 'Grenade' && glint) errors.push(`${glint.name}: a grenade root has no Glint (Famille's grenade has no emissive part, K8)`);
    if (glint && kind !== 'Grenade') {
      const color = glint.geometry.attributes.color, cueKind = GLINT_CUE[kind];
      if (color) {
        let off = 0, bloody = 0;
        for (let vertex = 0; vertex < color.count; vertex++) {
          const rgb = [color.getX(vertex), color.getY(vertex), color.getZ(vertex)];
          if (isBlood(rgb)) bloody++;
          else if (!cueOfColor(rgb)[cueKind]) off++;
        }
        if (bloody) errors.push(`${glint.name}: ${bloody} blood-coloured vertices on a Glint (K8: the glow stays the cue colour)`);
        if (off) errors.push(`${glint.name}: ${off} vertices off the ${cueKind} cue colour (K8: every Glint vertex carries the kind's cue)`);
      }
      let glintArea = 0;
      for (const tri of trianglesOf(glint.geometry)) glintArea += triAreaOf(tri);
      if (area > 0 && glintArea > C.glintShare * area + 1e-9)
        errors.push(`${where}: the Glint covers ${points(glintArea / area)} of the root's area, ${((glintArea / area - C.glintShare) * 100).toFixed(1)} points over 40 % (K8)`);
    }

    // K9: the pixel blood, tiles as bloodTiles measures them.
    if (body && body.geometry.attributes.color) {
      const color = body.geometry.attributes.color, position = body.geometry.attributes.position;
      const mask = new Uint8Array(color.count);
      for (let vertex = 0; vertex < color.count; vertex++)
        mask[vertex] = isBlood([color.getX(vertex), color.getY(vertex), color.getZ(vertex)]) ? 1 : 0;
      const { tiles, area: bloodArea } = bloodTiles(body.geometry, mask);
      const list = tiles.map(tile => {
        const verts = tile.vertices ?? [], centroid = [0, 0, 0], mean = [0, 0, 0];
        for (const vertex of verts) for (let axis = 0; axis < 3; axis++) {
          centroid[axis] += position.getComponent(vertex, axis) / Math.max(1, verts.length);
          mean[axis] += color.getComponent(vertex, axis) / Math.max(1, verts.length);
        }
        let colour = 0, nearest = Infinity;
        bloodLinear.forEach((target, index) => {
          const distance = Math.hypot(mean[0] - target[0], mean[1] - target[1], mean[2] - target[2]);
          if (distance < nearest) { nearest = distance; colour = index; }
        });
        return { tile, centroid, colour };
      });
      record.blood = { tiles: tiles.length, area: bloodArea, colours: [...new Set(list.map(entry => entry.colour))].sort((a, b) => a - b).map(index => `#${C.blood.palette[index].toString(16).padStart(6, '0')}`) };
      const caps = C.blood.caps[AMMO_KINDS.includes(kind) ? 'Ammo' : 'Points'][tier];
      if (Array.isArray(caps.tiles)) {
        if (tiles.length < caps.tiles[0]) errors.push(`${where}: ${tiles.length} blood tiles, ${caps.tiles[0] - tiles.length} short of the handprint's ${caps.tiles[0]}-${caps.tiles[1]} (K9)`);
        else if (tiles.length > caps.tiles[1]) errors.push(`${where}: ${tiles.length} blood tiles, ${tiles.length - caps.tiles[1]} over the ${caps.tiles[0]}-${caps.tiles[1]} allowance (K9)`);
      } else if (tiles.length > caps.tiles) errors.push(`${where}: ${tiles.length} blood tiles, ${tiles.length - caps.tiles} over the ${caps.tiles} cap (K9)`);
      if (bloodArea > caps.area + 1e-6) errors.push(`${where}: ${(bloodArea * 1e4).toFixed(1)} cm² of blood, ${((bloodArea - caps.area) * 1e4).toFixed(1)} cm² over the ${caps.area * 1e4} cm² cap (K9)`);
      const B = C.blood, odd = tiles.find(tile => tile.size[0] < B.tile[0] - B.slack || tile.size[1] > B.tile[1] + B.slack);
      if (odd) errors.push(`${where}: a blood tile spans ${mm(odd.size[0])} x ${mm(odd.size[1])} (K9: squares of 8-14 mm on the 4 mm grid)`);
      const thick = tiles.find(tile => tile.thickness > B.tileThickness[1] + 1e-4);
      if (thick) errors.push(`${where}: a blood tile is ${mm(thick.thickness)} thick, ${mm(thick.thickness - B.tileThickness[1])} over the ${mm(B.tileThickness[1])} slab (K9; K10 checks the .8 mm floor)`);
      if (list.length) {
        const dark = list.filter(entry => entry.colour <= 1).length;
        if (caps.darkestOnly && dark < list.length) errors.push(`${where}: ${list.length - dark} tile${list.length - dark === 1 ? '' : 's'} in the lighter reds; the light tier uses the two darkest only (K9)`);
        if (dark / list.length < C.blood.darkestShare - 1e-9)
          errors.push(`${where}: ${Math.round(100 * dark / list.length)} % of the tiles in the two darkest reds, ${Math.round(C.blood.darkestShare * 100 - 100 * dark / list.length)} points under 60 % (K9)`);
        if (AMMO_KINDS.includes(kind)) {
          const { sideWindow, topWindow } = C.blood;
          for (const { centroid } of list) {
            const box = keepOutBoxes().find(({ min: lo, max: hi }) => [0, 1, 2].every(axis => centroid[axis] >= lo[axis] && centroid[axis] <= hi[axis]));
            if (box) { errors.push(`${where}: a blood tile at ${fmtPoint(centroid)} is inside the ${box.label} fill keep-out (K9)`); continue; }
            if (Math.abs(centroid[0]) <= sideWindow.x && centroid[1] >= sideWindow.y[0] && centroid[1] <= sideWindow.y[1] && Math.abs(centroid[2]) >= sideWindow.z)
              errors.push(`${where}: a blood tile at ${fmtPoint(centroid)} is inside the ${centroid[2] > 0 ? 'front' : 'back'} backing window (K9)`);
            else if (Math.abs(centroid[0]) <= topWindow.x && centroid[2] >= topWindow.z[0] && centroid[2] <= topWindow.z[1] && centroid[1] >= topWindow.y)
              errors.push(`${where}: a blood tile at ${fmtPoint(centroid)} is inside the top backing window (K9)`);
          }
          const stencils = cueTriangles.filter(tri => tri.cues.teal || tri.cues.ochre);
          for (const { centroid } of list) {
            const gap = nearestTriangle(centroid, stencils);
            if (gap < C.blood.cueDistance) { errors.push(`${where}: a blood tile sits ${mm(gap)} from a stencil triangle, ${mm(C.blood.cueDistance - gap)} under the ${mm(C.blood.cueDistance)} clearance (K9: the cue colours stay whole)`); break; }
          }
        } else if (kind === 'Points') {
          const gold = cueTriangles.filter(tri => tri.cues.gold);
          for (const { centroid } of list) {
            const gap = nearestTriangle(centroid, gold);
            if (gap < C.blood.cueDistance) { warnings.push(`${where}: a blood tile sits ${mm(gap)} from a coin-gold triangle: check it sits on a coin edge, not a face centre (K9)`); break; }
          }
        } else {
          // The clearance keeps each kind's cue mark whole: the cross, the
          // chevron, the amber bands, the hearts (NOTES.md « Sang au pixel »:
          // « jamais sur un repère (croix, chevron, cœurs) »). The Revive
          // kit's orange body is excepted — it covers about half the root,
          // so a tile lying on the kit, as the artist's four do, would
          // always be within the clearance.
          const CLEARANCE = { Health: 'cross', Armor: 'chevron', Grenade: 'amber', Revive: 'hearts' };
          const cues = cueTriangles.filter(tri => tri.cues[CLEARANCE[kind]]);
          for (const { centroid } of list) {
            const gap = nearestTriangle(centroid, cues);
            if (gap < C.blood.cueDistance) { errors.push(`${where}: a blood tile sits ${mm(gap)} from a cue triangle, ${mm(C.blood.cueDistance - gap)} under the ${mm(C.blood.cueDistance)} clearance (K9: the cue colours stay whole)`); break; }
          }
        }
      }
    }

    // K10 (with K1's winding): every piece a closed solid, thick enough.
    for (const entry of entries) {
      const color = entry.geometry.attributes.color;
      const { pieces } = meshPieces(entry.geometry);
      for (const piece of pieces) {
        if (piece.volume < -1e-9 && Math.abs(piece.volume) > 1e-9) errors.push(`${entry.name}: a solid is wound inward (signed volume ${(piece.volume * 1e9).toFixed(1)} mm³; the game draws front faces only, K1)`);
        if (piece.boundary) errors.push(`${entry.name}: a piece is not a closed solid (${piece.boundary} open edge${piece.boundary === 1 ? '' : 's'}, K10)`);
        else if (Math.abs(piece.volume) <= 1e-9) errors.push(`${entry.name}: a piece has no volume (a zero-thickness plane, K10)`);
        const size = [0, 1, 2].map(axis => piece.max[axis] - piece.min[axis]).sort((a, b) => a - b);
        const bloody = color && piece.vertices.every(vertex => isBlood([color.getX(vertex), color.getY(vertex), color.getZ(vertex)]));
        const thick = bloody ? C.thickness.tile : C.thickness.solid;
        if (size[0] < thick - 1e-6) errors.push(`${entry.name}: a piece is ${mm(size[0])} thick (K10 asks for at least ${mm(thick)}${bloody ? ' on a blood tile' : ''})`);
      }
    }
  }

  // K7: the special box reads ochre against the plain box of the same tier.
  for (const tier of C.tiers) {
    const plain = records.get(`${C.prefix}Ammo_${tier}`), special = records.get(`${C.prefix}AmmoSpecial_${tier}`);
    if (!plain?.cue || !special?.cue) continue;
    const need = plain.cue.ochre + C.cue.ochre.margin;
    if (special.cue.ochre < need - 1e-4)
      errors.push(`${C.prefix}AmmoSpecial_${tier}: ochre covers ${(special.cue.ochre * 100).toFixed(1)} %, ${((need - special.cue.ochre) * 100).toFixed(1)} points under the same tier's Ammo plus ${C.cue.ochre.margin * 100} (K7)`);
  }

  for (const [name, record] of records) roots[name] = {
    triangles: { body: record.triangles.body ?? 0, glint: record.triangles.glint ?? 0 },
    y: record.y ?? [0, 0], radius: record.radius ?? 0, centre: record.centre ?? [0, 0],
    cue: record.cue ?? { gold: 0, teal: 0, ochre: 0, cross: 0, chevron: 0, amber: 0, orange: 0, hearts: 0 },
    blood: record.blood ?? { tiles: 0, area: 0, colours: [] },
  };
  info.push('K7 compares each AmmoSpecial tier with the same tier\'s Ammo; the backing rays of K4 measure the Body only');
  info.push('determinism cannot be checked from the file: two generator runs must give byte-identical GLBs (PICKUPS.md section 2)');
  return { errors, warnings, roots, info, triangles };
}

// One file and the options, in any order; { error } on bad usage. With
// --markers, --heads and --bodies each take one or more GLB paths (the
// reference heads and bodies the fit checks run against); without it,
// --bodies stays the bodies-mode flag.
export function parseArguments(argv) {
  const files = [], options = {}, markers = argv.includes('--markers');
  for (let index = 0; index < argv.length; index++) {
    const [flag, inline] = argv[index].split(/=(.*)/s);
    if (flag === '--min-variants') {
      const value = inline ?? argv[++index];
      if (!/^[1-9]\d*$/.test(value ?? '')) return { error: `--min-variants needs a whole number of heads (1 or more), got ${value === undefined ? 'nothing' : `"${value}"`}` };
      options.minVariants = Number(value);
    } else if (markers && (flag === '--heads' || flag === '--bodies')) {
      const list = inline === undefined ? [] : [inline];
      while (index + 1 < argv.length && !argv[index + 1].startsWith('-')) list.push(argv[++index]);
      if (!list.length) return { error: `${flag} needs at least one GLB` };
      const key = flag.slice(2);
      options[key] = [...(options[key] ?? []), ...list];
    } else if (flag === '--space') {
      const value = inline ?? argv[++index];
      if (!value) return { error: '--space needs a cabin-space.json' };
      options.space = value;
    } else if (argv[index] === '--markers') options.markers = true;
    else if (argv[index] === '--bodies') options.bodies = true;
    else if (argv[index] === '--survivors') options.survivors = true;
    else if (argv[index] === '--weapons') options.weapons = true;
    else if (argv[index] === '--pickups') options.pickups = true;
    else if (argv[index] === '--cabin') options.cabin = true;
    else if (argv[index] === '--surfaces') options.surfaces = true;
    else if (argv[index].startsWith('-')) return { error: `unknown option ${argv[index]}` };
    else files.push(argv[index]);
  }
  if (files.length !== 1) return { error: files.length ? `one file at a time (got ${files.join(', ')})` : 'no file given' };
  const modes = ['bodies', 'survivors', 'markers', 'weapons', 'pickups', 'cabin', 'surfaces'].filter(mode => options[mode] === true);
  if (modes.length > 1) return { error: `${modes.map(mode => `--${mode}`).join(', ')} are separate modes` };
  if (options.bodies === true && options.minVariants !== undefined) return { error: '--min-variants counts heads; a bodies file has its 25 required roots' };
  if (options.markers && options.minVariants !== undefined) return { error: '--min-variants counts heads; the markers file has its own ladder' };
  if (options.pickups && options.minVariants !== undefined) return { error: '--min-variants counts heads; a pickups file has its six required roots' };
  if ((options.survivors || options.weapons || options.cabin || options.surfaces) && options.minVariants !== undefined) return { error: '--min-variants counts heads' };
  if (options.space && !options.cabin) return { error: '--space goes with --cabin' };
  return { file: files[0], options };
}

// True when the file's roots are body parts (and none is a head).
async function looksLikeBodies(bytes) {
  try {
    const { readGlbChunks } = await importPublicModule('frisson/glb.js');
    const { json } = readGlbChunks(bytes), roots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map(index => String(json.nodes?.[index]?.name ?? ''));
    return roots.length > 0 && roots.every(name => /^Frisson(Torso|Arm|Leg|Crawler|CrawlerArm|CrawlerLeg)_/.test(name));
  } catch { return false; }
}

// True when the file's roots are all family markers.
async function looksLikeMarkers(bytes) {
  try {
    const { readGlbChunks } = await importPublicModule('frisson/glb.js');
    const { json } = readGlbChunks(bytes), roots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map(index => String(json.nodes?.[index]?.name ?? ''));
    return roots.length > 0 && roots.every(name => name.startsWith('FrissonMark_'));
  } catch { return false; }
}

async function mainBodies(file, bytes) {
  const { errors, warnings, parts, totals, sets } = await checkFrissonBodiesGlb(bytes);
  console.log(`${file}: ${bytes.length} bytes, ${parts.length} body roots${sets?.length ? ` in sets ${sets.join(', ')}` : ''}${totals ? `; heaviest standing body ${totals.standing} triangles, crawler ${totals.crawler}` : ''}`);
  for (const part of parts) console.log(`  ${part.name.padEnd(28)} ${String(part.triangles.total).padStart(5)} triangles (${Object.entries(part.triangles).filter(([key]) => key !== 'total').map(([key, value]) => `${key.toLowerCase()} ${value}`).join(', ')})  y ${fmt(part.min[1])}..${fmt(part.max[1])}${part.chest !== undefined && part.chest !== null ? `  chest z ${fmt(part.chest)}` : ''}${part.clothGrey ? `  cloth grey ${part.clothGrey}` : ''}`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  for (const error of errors) console.log(`  ERROR: ${error}`);
  console.log(errors.length ? `FAIL: ${errors.length} contract error${errors.length === 1 ? '' : 's'}` : 'OK: the file follows the bodies contract');
  return errors.length ? 1 : 0;
}

// True when the file's roots are all survivor parts.
async function looksLikeSurvivors(bytes) {
  try {
    const { readGlbChunks } = await importPublicModule('frisson/glb.js');
    const { json } = readGlbChunks(bytes), roots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map(index => String(json.nodes?.[index]?.name ?? ''));
    return roots.length > 0 && roots.every(name => name.startsWith('FrissonSurvivor'));
  } catch { return false; }
}

async function mainSurvivors(file, bytes) {
  const { errors, warnings, parts, characters } = await checkFrissonSurvivorsGlb(bytes);
  console.log(`${file}: ${bytes.length} bytes, ${parts.length} survivor roots, ${characters.length} characters`);
  for (const part of parts) console.log(`  ${part.name.padEnd(36)} ${String(part.triangles.total).padStart(5)} triangles (${Object.entries(part.triangles).filter(([key]) => key !== 'total').map(([key, value]) => `${key.toLowerCase()} ${value}`).join(', ')})  y ${fmt(part.min[1])}..${fmt(part.max[1])}${part.clothGrey ? `  cloth grey ${part.clothGrey}` : ''}`);
  for (const character of characters) console.log(`  ${character.name.padEnd(12)} ${String(character.triangles).padStart(5)} triangles, ${character.meshes} meshes${character.raider ? ' (raider)' : ''}${character.complete ? '' : ' INCOMPLETE'}`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  for (const error of errors) console.log(`  ERROR: ${error}`);
  console.log(errors.length ? `FAIL: ${errors.length} contract error${errors.length === 1 ? '' : 's'}` : 'OK: the file follows the survivors contract');
  return errors.length ? 1 : 0;
}

async function mainMarkers(file, bytes, options) {
  const read = paths => {
    const out = [];
    for (const path of paths ?? []) {
      try { out.push({ name: path, input: readFileSync(path) }); }
      catch (error) { console.error(`${path}: ${error.message}`); return null; }
    }
    return out;
  };
  const heads = read(options.heads); if (!heads) return 1;
  const bodies = read(Array.isArray(options.bodies) ? options.bodies : []); if (!bodies) return 1;
  const { errors, warnings, families, fit } = await checkFrissonMarkersGlb(bytes, { heads, bodies });
  const roots = families.reduce((sum, family) => sum + family.roots.length, 0);
  console.log(`${file}: ${bytes.length} bytes, ${roots} marker roots in ${families.length} families; the fit measured on ${fit.heads} heads, ${fit.torsos} torsos, ${fit.crawlers} crawler torsos and ${fit.arms} arms`);
  for (const family of families) console.log(`  ${family.name.padEnd(10)} ${String(family.triangles.total).padStart(5)} triangles (standing ${family.triangles.standing}, crawler ${family.triangles.crawler})  front ${family.front.toFixed(4)} m², side ${family.side.toFixed(4)} m²${family.glow ? `, glow ${(100 * family.glow / family.front).toFixed(1)} % of the front` : ''}`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  for (const error of errors) console.log(`  ERROR: ${error}`);
  console.log(errors.length ? `FAIL: ${errors.length} contract error${errors.length === 1 ? '' : 's'}` : 'OK: the file follows the markers contract');
  return errors.length ? 1 : 0;
}

// True when the file's roots are all weapon dressing roots.
async function looksLikeWeapons(bytes) {
  try {
    const { readGlbChunks } = await importPublicModule('frisson/glb.js');
    const { json } = readGlbChunks(bytes), roots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map(index => String(json.nodes?.[index]?.name ?? ''));
    return roots.length > 0 && roots.every(name => name.startsWith(WEAPONS_CONTRACT.prefix));
  } catch { return false; }
}

async function mainWeapons(file, bytes) {
  const { errors, warnings, weapons, info, triangles } = await checkFrissonWeaponsGlb(bytes);
  console.log(`${file}: ${bytes.length} bytes, ${weapons.length} weapon roots, ${triangles} triangles in all`);
  for (const weapon of weapons) console.log(`  ${weapon.name.padEnd(34)} ${String(weapon.triangles.total).padStart(5)} triangles (${Object.entries(weapon.triangles).filter(([key]) => key !== 'total').map(([key, value]) => `${key.toLowerCase()} ${value}`).join(', ')})  x ${fmt(weapon.min[0])}..${fmt(weapon.max[0])}  y ${fmt(weapon.min[1])}..${fmt(weapon.max[1])}  z ${fmt(weapon.min[2])}..${fmt(weapon.max[2])}`);
  for (const line of info) console.log(`  info: ${line}`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  for (const error of errors) console.log(`  ERROR: ${error}`);
  console.log(errors.length ? `FAIL: ${errors.length} contract error${errors.length === 1 ? '' : 's'}` : 'OK: the file follows the weapons contract');
  return errors.length ? 1 : 0;
}

// True when the file's roots are all pickup roots.
async function looksLikePickups(bytes) {
  try {
    const { readGlbChunks } = await importPublicModule('frisson/glb.js');
    const { json } = readGlbChunks(bytes), roots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map(index => String(json.nodes?.[index]?.name ?? ''));
    return roots.length > 0 && roots.every(name => name.startsWith(PICKUPS_CONTRACT.prefix));
  } catch { return false; }
}

async function mainPickups(file, bytes) {
  const { errors, warnings, roots, info, triangles } = await checkFrissonPickupsGlb(bytes);
  const names = Object.keys(roots);
  console.log(`${file}: ${bytes.length} bytes, ${names.length} pickup roots, ${triangles} triangles in all`);
  for (const name of names) {
    const record = roots[name];
    const kind = name.slice(PICKUPS_CONTRACT.prefix.length).replace(/_(Light|Full)$/, '');
    const cue = (KIND_CUES[kind] ?? []).map(key => `${key} ${(record.cue[key] * 100).toFixed(1)} %`).join(' ');
    console.log(`  ${name.padEnd(32)} ${String(record.triangles.body + record.triangles.glint).padStart(5)} triangles (body ${record.triangles.body}, glint ${record.triangles.glint})  y ${fmt(record.y[0])}..${fmt(record.y[1])}  radius ${fmt(record.radius)}  ${cue}  blood ${record.blood.tiles} tiles, ${(record.blood.area * 1e4).toFixed(1)} cm²`);
  }
  for (const line of info) console.log(`  info: ${line}`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  for (const error of errors) console.log(`  ERROR: ${error}`);
  console.log(errors.length ? `FAIL: ${errors.length} contract error${errors.length === 1 ? '' : 's'}` : 'OK: the file follows the pickups contract');
  return errors.length ? 1 : 0;
}

// True when the file's roots are cabin dressing roots.
async function looksLikeCabin(bytes) {
  try {
    const { readGlbChunks } = await importPublicModule('frisson/glb.js');
    const { json } = readGlbChunks(bytes), roots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map(index => String(json.nodes?.[index]?.name ?? ''));
    return roots.length > 0 && roots.every(name => name.startsWith('Dress_'));
  } catch { return false; }
}

async function mainCabin(file, bytes, options) {
  let space;
  try { space = options.space ? readCabinSpace(options.space) : readCabinSpace(); } catch (error) { console.error(`cabin space: ${error.message}`); return 1; }
  const { errors, warnings, roots, presets } = await checkFrissonCabinGlb(bytes, { space });
  console.log(`${file}: ${bytes.length} bytes, ${roots.length} dressing roots`);
  for (const root of roots) console.log(`  ${root.name.padEnd(18)} ${String(root.triangles).padStart(5)} triangles in ${root.meshes.length} mesh${root.meshes.length === 1 ? '' : 'es'} (${root.meshes.map(mesh => `${mesh.material} ${mesh.triangles}`).join(', ')})${root.bloodTiles !== undefined ? `  blood ~${root.bloodTiles} tiles` : ''}`);
  for (const [id, cost] of Object.entries(presets)) console.log(`  ${id.padEnd(6)} +${cost.drawCalls} draw calls, ${cost.triangles} triangles`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  for (const error of errors) console.log(`  ERROR: ${error}`);
  console.log(errors.length ? `FAIL: ${errors.length} contract error${errors.length === 1 ? '' : 's'}` : 'OK: the file follows the cabin contract');
  return errors.length ? 1 : 0;
}

async function mainSurfaces(file) {
  let module, text;
  try { text = readFileSync(file, 'utf8'); module = await import(pathToFileURL(file).href); }
  catch (error) { console.error(`${file}: ${error.message}`); return 1; }
  const { errors, warnings, surfaces, textures } = await checkFrissonCabinSurfaces(module, { text });
  console.log(`${file}: ${surfaces.length} surfaces, ${textures.length} textures`);
  for (const texture of textures) console.log(`  texture ${texture.name.padEnd(12)} ${texture.size.join('x').padEnd(8)} grid ${texture.grid.join('x').padEnd(8)} ${String(texture.calls).padStart(5)} fills, mean ${texture.mean}`);
  for (const surface of surfaces) console.log(`  ${surface.key.padEnd(18)} albedo ${surface.albedo}${surface.famille ? `  Famille ${surface.famille}  luminance ${Math.round(surface.ratio * 100)} %` : ''}`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  for (const error of errors) console.log(`  ERROR: ${error}`);
  console.log(errors.length ? `FAIL: ${errors.length} contract error${errors.length === 1 ? '' : 's'}` : 'OK: the module follows the surfaces contract');
  return errors.length ? 1 : 0;
}

async function main(argv) {
  const { file, options, error } = parseArguments(argv);
  if (error) { console.error(`${error}\nusage: node tools/frisson-glb-check.mjs <file.glb> [--min-variants N] [--bodies] [--survivors] [--weapons] [--pickups] [--markers [--heads h.glb …] [--bodies b.glb …]] [--cabin [--space <cabin-space.json>]] | <cabin-surfaces.js> --surfaces`); return 2; }
  if (options.surfaces) return mainSurfaces(file);
  let bytes;
  try { bytes = readFileSync(file); } catch (error) { console.error(`${file}: ${error.message}`); return 1; }
  const pickupsMode = options.pickups || (!options.bodies && !options.markers && !options.survivors && !options.cabin && !options.weapons && await looksLikePickups(bytes));
  if (pickupsMode) {
    if (options.minVariants !== undefined) { console.error('--min-variants counts heads; a pickups file has its six required roots'); return 2; }
    return mainPickups(file, bytes);
  }
  if (options.weapons || (options.minVariants === undefined && !options.bodies && !options.markers && !options.survivors && !options.cabin && await looksLikeWeapons(bytes))) return mainWeapons(file, bytes);
  if (options.cabin || (options.minVariants === undefined && !options.bodies && !options.markers && !options.survivors && await looksLikeCabin(bytes))) return mainCabin(file, bytes, options);
  if (options.survivors || (!options.bodies && !options.markers && options.minVariants === undefined && await looksLikeSurvivors(bytes))) return mainSurvivors(file, bytes);
  if (options.markers || (options.minVariants === undefined && options.bodies === undefined && await looksLikeMarkers(bytes))) return mainMarkers(file, bytes, options);
  if (options.bodies || (options.minVariants === undefined && await looksLikeBodies(bytes))) return mainBodies(file, bytes);
  const { errors, warnings, heads } = await checkFrissonGlb(bytes, options);
  console.log(`${file}: ${bytes.length} bytes, ${heads.length} heads`);
  for (const head of heads) console.log(`  ${head.name.padEnd(28)} ${String(head.triangles.total).padStart(5)} triangles (skin ${head.triangles.Skin ?? '-'}, detail ${head.triangles.Detail ?? '-'}, eyes ${head.triangles.Eyes ?? '-'})  y ${head.min[1].toFixed(3)}..${head.max[1].toFixed(3)}`);
  for (const warning of warnings) console.log(`  warning: ${warning}`);
  for (const error of errors) console.log(`  ERROR: ${error}`);
  console.log(errors.length ? `FAIL: ${errors.length} contract error${errors.length === 1 ? '' : 's'}` : 'OK: the file follows the heads contract');
  return errors.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main(process.argv.slice(2));
