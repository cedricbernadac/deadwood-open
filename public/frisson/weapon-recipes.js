// Frisson part: weapon material recipes and the deterministic weathering
// pass (art/frisson/WEAPONS.md, section 2). One white vertex-coloured
// material per Famille weapon material (the zombieRim program, no new
// shader); the absolute per-vertex colours are baked per weapon type and
// quality tier into shared geometries, in linear space, from the recipe's
// base colour, its weathering class and a seeded value noise. Pure data and
// arithmetic around the Famille build: two runs are bit-identical.
import * as THREE from '/vendor/three.module.js';
import { buildWeapon } from '../world.js';
import { withRim } from '../zombies.js';
import { hashSeed } from '../zombie-looks.js';
import { mixHash } from './pick.js';

export const WEAPON_TYPES = Object.freeze(['pistol', 'magnum', 'smg', 'assault', 'rifle', 'shotgun', 'sniper', 'minigun', 'rocket', 'flamethrower', 'bat', 'fireaxe', 'hammer', 'katana']);

// The recipe table (WEAPONS.md 2.2, the shipped column): Famille material
// name → Frisson base colour (sRGB), roughness, metalness and weathering
// class. `rim` scales the shared rim light's strength (a per-material
// uniform; the program is unchanged): off on the magnum's golds and halved
// on the katana blade, whose inside and outside R3 ratios it pulled apart
// (2.2, "Beyond the window" d and e).
const recipe = (color, roughness, metalness, weatheringClass, rim = 1) => Object.freeze({ color, roughness, metalness, class: weatheringClass, rim });
export const RECIPES = Object.freeze({
  pistolSlide: recipe(0x586068, .50, .76, 'steel'),
  pistolFrame: recipe(0x384043, .62, .35, 'gunmetal'),
  pistolGrip: recipe(0x4a473e, .93, 0, 'cloth'),
  goldGun: recipe(0xa48440, .45, .80, 'brass', 0),
  goldGunSteel: recipe(0xba9a58, .42, .80, 'brass', 0),
  magnumWalnutGrip: recipe(0x3a2a20, .88, 0, 'wood'),
  smgGun: recipe(0x464943, .62, .35, 'gunmetal'),
  smgSteel: recipe(0x7c7f7a, .50, .72, 'steel'),
  smgGrip: recipe(0x2c2b26, .95, 0, 'cloth'),
  smgCasing: recipe(0x4f5a50, .78, .35, 'paint'),
  specialGunDark: recipe(0x464943, .62, .45, 'gunmetal'),
  specialGunSteel: recipe(0x7b7e79, .50, .72, 'steel'),
  specialGunOlive: recipe(0x626a4c, .88, .10, 'paint'),
  rocketWarning: recipe(0xcfaa62, .75, 0, 'paint'),
  flameFuelTank: recipe(0x6e5732, .70, .45, 'paint'),
  gun: recipe(0x444743, .60, .35, 'gunmetal'),
  gunSteel: recipe(0x72756f, .50, .72, 'steel'),
  gunStock: recipe(0x544739, .90, 0, 'wood'),
  shotgunWood: recipe(0x573429, .90, 0, 'wood'),
  sniperStock: recipe(0x605240, .92, 0, 'wood'),
  sniperSteel: recipe(0x767a75, .50, .72, 'steel'),
  sniperAction: recipe(0x464943, .62, .35, 'gunmetal'),
  katanaSteel: recipe(0x7e827c, .55, .85, 'blade', .5),
  katanaCuttingEdge: recipe(0xd3d6cd, .30, .90, 'blade', .5),
  katanaSpine: recipe(0x4c504b, .50, .75, 'steel', .5),
  katanaGuard: recipe(0x464943, .60, .60, 'gunmetal'),
  katanaWrap: recipe(0x2f312a, .96, 0, 'cloth'),
  katanaTrim: recipe(0x8f7d55, .55, .60, 'brass'),
  hammerForgedIron: recipe(0x5a5d59, .68, .40, 'gunmetal'),
  hammerSpikes: recipe(0x9a9e97, .45, .78, 'blade'),
  hammerShaft: recipe(0x624e39, .93, 0, 'wood'),
  hammerGrip: recipe(0x2e2a24, .96, 0, 'cloth'),
  batAshWood: recipe(0x997d5c, .90, 0, 'wood'),
  batWoodGrain: recipe(0x68503a, .95, 0, 'wood'),
  batGripTape: recipe(0x34342c, .98, 0, 'cloth'),
  batMakerStamp: recipe(0x543f2e, .95, 0, 'wood'),
  fireaxeHickory: recipe(0x8c6d4c, .90, 0, 'wood'),
  fireaxeWoodGrain: recipe(0x664d36, .95, 0, 'wood'),
  fireaxeRedEnamel: recipe(0x9a1a0d, .62, .35, 'paint'),
  fireaxePolishedEdge: recipe(0xb1b4ab, .35, .85, 'blade'),
  fireaxeGrip: recipe(0x2d2b25, .96, 0, 'cloth'),
  firstPersonHand: recipe(0x524032, .85, 0, 'glove'),
  firstPersonSleeve: recipe(0x3b3e34, .95, 0, 'cloth'),
});

// Sights, bores and the optic glass keep the Famille material and program:
// never swapped, never given a colour attribute.
export const KEEP_MATERIALS = Object.freeze(new Set(['pistolSight', 'magnumSight', 'sight', 'pistolBore', 'magnumBore', 'sniperBore', 'specialGunBore', 'sniperOpticGlass']));

// Weathering classes (WEAPONS.md 2.3, sRGB targets, converted to linear
// below). wear: the colour rubbed edges take; grime: packed dirt, base +
// cavity/down/noise; rust: null for the classes that never rust.
const weatheringClass = (wearColor, wearAmount, grimeColor, grimeBase, grimeAmount, rust) => Object.freeze({
  wear: Object.freeze({ color: wearColor, amount: wearAmount }),
  grime: Object.freeze({ color: grimeColor, base: grimeBase, amount: grimeAmount }),
  rust: rust && Object.freeze({ color: rust[0], density: rust[1], amount: rust[2] }),
});
export const CLASSES = Object.freeze({
  gunmetal: weatheringClass(0xadb0a7, .95, 0x161512, .20, .55, [0x5e3420, .10, .65]),
  steel: weatheringClass(0xcdcec5, 1.0, 0x1f1d19, .15, .50, [0x6e3d22, .14, .70]),
  blade: weatheringClass(0xf2f3ec, .60, 0x2e2a25, .05, .35, [0x5a321d, .05, .55]),
  paint: weatheringClass(0x8f9186, .80, 0x1b1a16, .20, .55, [0x63361f, .12, .60]),
  brass: weatheringClass(0xd9be7c, .70, 0x2a2414, .25, .60, [0x3f4a37, .08, .50]),
  wood: weatheringClass(0xa58c6c, .45, 0x22190f, .25, .60, null),
  cloth: weatheringClass(0x77705f, .35, 0x191713, .30, .60, null),
  glove: weatheringClass(0x7d6a55, .50, 0x1d1914, .20, .40, null),
});

// The node whose local frame the weathering is computed in (WEAPONS.md
// 3.2): the whole melee weapon rides its strike frame and the SMG
// metalwork its compact frame, so dressing and weathering follow the swing
// and the scale. null = the gun group itself.
const ANCHOR_NAMES = Object.freeze({ smg: 'smgCompactFrame', bat: 'batStrikeFrame', fireaxe: 'fireaxeEdgeFrame', hammer: 'hammerStrikeFrame', katana: 'katanaEdgeFrame' });
export function anchorNameFor(type) { return ANCHOR_NAMES[type] ?? null; }

// The shared rim light, in a warm neutral grey for the weapons (a uniform of
// the same zombieRim program; zombies and survivors keep the cool 0x8fb2ff):
// on near-black flat-shaded steel seen at grazing angles the cool rim
// outweighed the base and turned gunmetal navy, wood purple and pixel blood
// magenta (review of 14 October 2026).
export const WEAPON_RIM_COLOR = 0xbdb6a8;
const weaponRim = () => new THREE.Color().setHex(WEAPON_RIM_COLOR, THREE.SRGBColorSpace);

export function createRecipeMaterials() {
  const materials = new Map(), rim = weaponRim();
  for (const [name, r] of Object.entries(RECIPES)) {
    const material = withRim(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: r.roughness, metalness: r.metalness }), r.rim, rim);
    material.name = 'frisson:' + name;
    material.userData.frissonWeapon = true;
    materials.set(name, material);
  }
  return materials;
}

export function createDressMaterial() {
  const material = withRim(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: .80, metalness: .20 }), 1, weaponRim());
  material.name = 'frissonWeaponDress';
  return material;
}

// The Famille materials are cached by name in world.js's `mats` table but
// the helper never writes material.name (only the katana blade's edge and
// spine are named). The name is recovered from the exact constructor triple
// instead: colour, roughness, metalness as createWeapon passes them.
const FAMILLE_PROPS = Object.freeze({
  pistolSlide: [0x616e70, .3, .8], pistolFrame: [0x242e30, .48, .55], pistolGrip: [0x343a32, .9, 0],
  goldGun: [0xe3b550, .25, .85], goldGunSteel: [0xffd47c, .2, .85], magnumWalnutGrip: [0x38221b, .85, 0],
  smgGun: [0x293536, .55, .65], smgSteel: [0x899996, .4, .8], smgGrip: [0x182626, .94, 0], smgCasing: [0x576d68, .75, .35],
  specialGunDark: [0x283334, .5, .65], specialGunSteel: [0x85928d, .35, .8], specialGunOlive: [0x64704d, .85, 0],
  rocketWarning: [0xe9be66, .7, 0], flameFuelTank: [0x826638, .72, .45],
  gun: [0x242c30, .4, .75], gunSteel: [0x697577, .3, .8], gunStock: [0x514538, .85, 0], shotgunWood: [0x592a21, .85, 0],
  sniperStock: [0x635443, .9, 0], sniperSteel: [0x7e8e8b, .36, .8], sniperAction: [0x263436, .52, .65],
  katanaSteel: [0xc5d7d6, .2, .92], katanaCuttingEdge: [0xe6f1ee, .15, .95], katanaSpine: [0x586966, .38, .8],
  katanaGuard: [0x313b38, .4, .75], katanaWrap: [0x2d3b32, .95, 0], katanaTrim: [0xbaa371, .45, .65],
  hammerForgedIron: [0x5d6667, .58, .78], hammerSpikes: [0xb3beb5, .36, .85], hammerShaft: [0x695138, .92, 0], hammerGrip: [0x302b25, .96, 0],
  batAshWood: [0xb48a55, .86, 0], batWoodGrain: [0x7a5635, .95, 0], batGripTape: [0x34392f, .98, 0], batMakerStamp: [0x583c27, .95, 0],
  fireaxeHickory: [0xb2834e, .88, 0], fireaxeWoodGrain: [0x79542e, .95, 0], fireaxeRedEnamel: [0xa92118, .5, .45],
  fireaxePolishedEdge: [0xc9d5cf, .25, .9], fireaxeGrip: [0x292d29, .96, 0],
  firstPersonHand: [0xb89171, .85, 0], firstPersonSleeve: [0x3e4a43, .85, 0],
  pistolSight: [0xdfb883, .4, 0], magnumSight: [0xdfb883, .4, 0], sight: [0xdfb883, .4, 0],
  pistolBore: [0x0b1415, .85, 0], magnumBore: [0x191a18, .9, 0], sniperBore: [0x081215, .95, 0], specialGunBore: [0x0a1416, .9, 0],
  sniperOpticGlass: [0x4d9a99, .16, .7],
});
const TRIPLE_NAMES = new Map();
for (const [name, triple] of Object.entries(FAMILLE_PROPS)) {
  const key = triple.join('|');
  if (!TRIPLE_NAMES.has(key)) TRIPLE_NAMES.set(key, []);
  TRIPLE_NAMES.get(key).push(name);
}
// The three sight materials share one triple; all are keep, so the pick
// only matters for readability of keys. null when the material is not a
// Famille weapon material.
export function familleMaterialName(material, type = null) {
  if (!material) return null;
  if (material.name && FAMILLE_PROPS[material.name]) return material.name;
  const names = TRIPLE_NAMES.get(`${material.color.getHex()}|${material.roughness}|${material.metalness}`);
  if (!names) return null;
  if (names.length === 1) return names[0];
  return type === 'pistol' ? 'pistolSight' : type === 'magnum' ? 'magnumSight' : 'sight';
}

const SKIN = 0x7d6250; // dirty fingers round a gun's grip (WEAPONS.md 2.4.5)
const MELEE_TYPES = new Set(['bat', 'fireaxe', 'hammer', 'katana']);
// Wear scales of an extrusion's lids and side walls (WEAPONS.md 2.4.4).
const LID_WEAR = .15, WALL_WEAR = .35;
const clamp01 = value => Math.min(1, Math.max(0, value));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const linearColor = hex => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

let colourTables = null;
function tables() {
  if (colourTables) return colourTables;
  const bases = new Map(), classes = new Map();
  for (const [name, r] of Object.entries(RECIPES)) bases.set(name, linearColor(r.color));
  for (const [name, c] of Object.entries(CLASSES)) {
    classes.set(name, {
      wear: { color: linearColor(c.wear.color), amount: c.wear.amount },
      grime: { color: linearColor(c.grime.color), base: c.grime.base, amount: c.grime.amount },
      rust: c.rust ? { color: linearColor(c.rust.color), density: c.rust.density, amount: c.rust.amount } : null,
    });
  }
  colourTables = { bases, classes, skin: linearColor(SKIN) };
  return colourTables;
}

// Value noise on an integer lattice, trilinear with smoothstep weights
// (WEAPONS.md 2.4.4).
function lattice(i, j, k, s) {
  return mixHash((s ^ Math.imul(i, 0x8da6b343) ^ Math.imul(j, 0xd8163841) ^ Math.imul(k, 0xcb1ab31f)) >>> 0) / 4294967296;
}
function vnoise(x, y, z, s) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const c00 = lattice(i, j, k, s) + ux * (lattice(i + 1, j, k, s) - lattice(i, j, k, s));
  const c10 = lattice(i, j + 1, k, s) + ux * (lattice(i + 1, j + 1, k, s) - lattice(i, j + 1, k, s));
  const c01 = lattice(i, j, k + 1, s) + ux * (lattice(i + 1, j, k + 1, s) - lattice(i, j, k + 1, s));
  const c11 = lattice(i, j + 1, k + 1, s) + ux * (lattice(i + 1, j + 1, k + 1, s) - lattice(i, j + 1, k + 1, s));
  const c0 = c00 + uy * (c10 - c00), c1 = c01 + uy * (c11 - c01);
  return c0 + uz * (c1 - c0);
}

// The mesh-to-anchor transform composed from local position/quaternion/
// scale alone, never matrixWorld (WEAPONS.md 2.4.2). The anchor's own pose
// (swing, roll, compact scale) is inverted out.
function relativeMatrix(root, node) {
  const chain = [];
  for (let n = node; n && n !== root; n = n.parent) chain.push(n);
  const matrix = new THREE.Matrix4(), local = new THREE.Matrix4();
  for (let i = chain.length - 1; i >= 0; i--) matrix.multiply(local.compose(chain[i].position, chain[i].quaternion, chain[i].scale));
  return matrix;
}

// A closed cylinder with edge bands (WEAPONS.md 2.4.3): an open-ended side
// of three rows whose two inner rings sit 4 mm inside the caps (±0.3·h when
// h < 0.02) and stay ON the side (radii rescaled to the cone, so a tapered
// part keeps its exact silhouette), plus per cap an outer ring b = min(4 mm,
// 0.2·r) wide around an inner disc. The cap's rim vertices are those of the
// side (the same formula as three), so crease flags only the rim and the
// disc centre never inherits rim wear. Groups as three's: side 0, top 1,
// bottom 2.
function bandedCylinder({ radiusTop: rt, radiusBottom: rb, height, radialSegments: segments, thetaStart = 0, thetaLength = Math.PI * 2 }) {
  const half = height / 2, inner = height < .02 ? .3 * height : half - .004;
  const side = new THREE.CylinderGeometry(rt, rb, height, segments, 3, true, thetaStart, thetaLength);
  const radiusAt = y => rt + (rb - rt) * (half - y) / height;
  const sidePosition = side.attributes.position;
  for (let v = 0; v < sidePosition.count; v++) {
    const y = sidePosition.getY(v);
    if (Math.abs(y) >= half - 1e-6) continue;
    const target = Math.sign(y) * inner, from = radiusAt(y), to = radiusAt(target);
    sidePosition.setY(v, target);
    if (from > 0) { sidePosition.setX(v, sidePosition.getX(v) * to / from); sidePosition.setZ(v, sidePosition.getZ(v) * to / from); }
  }
  const positions = [...sidePosition.array], normals = [...side.attributes.normal.array], uvs = [...side.attributes.uv.array], indices = [...side.index.array];
  const groups = [[0, side.index.count, 0]];
  for (const top of [true, false]) {
    const radius = top ? rt : rb;
    if (!(radius > 0)) continue;
    const sign = top ? 1 : -1, y = half * sign, band = Math.min(.004, .2 * radius), start = indices.length, first = positions.length / 3;
    for (const r of [radius, radius - band]) {
      for (let x = 0; x <= segments; x++) {
        const theta = x / segments * thetaLength + thetaStart, sin = Math.sin(theta), cos = Math.cos(theta);
        positions.push(r * sin, y, r * cos); normals.push(0, sign, 0); uvs.push(cos * .5 * r / radius + .5, sin * .5 * sign * r / radius + .5);
      }
    }
    const centre = positions.length / 3;
    positions.push(0, y, 0); normals.push(0, sign, 0); uvs.push(.5, .5);
    for (let x = 0; x < segments; x++) {
      const o0 = first + x, o1 = o0 + 1, n0 = first + segments + 1 + x, n1 = n0 + 1;
      // three's cap winding (top: ring x, x + 1, centre; bottom reversed).
      if (top) indices.push(o0, o1, n0, n0, o1, n1, n0, n1, centre);
      else indices.push(o1, o0, n0, o1, n0, n1, n1, n0, centre);
    }
    groups.push([start, indices.length - start, top ? 1 : 2]);
  }
  side.dispose();
  const banded = new THREE.BufferGeometry();
  banded.setIndex(indices);
  banded.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  banded.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  banded.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  for (const [start, count, materialIndex] of groups) banded.addGroup(start, count, materialIndex);
  return banded;
}

// The geometries step 3 bands (WEAPONS.md 2.4.3): a box whose smallest side
// is at least 8 mm and largest at least 3 cm, and a closed cylinder of one
// height segment. null for every other geometry.
function bandKind(geometry) {
  const p = geometry.parameters;
  if (!p) return null;
  if (geometry.type === 'BoxGeometry') {
    const sides = [p.width, p.height, p.depth];
    return Math.min(...sides) < .008 || Math.max(...sides) < .03 ? null : 'box';
  }
  if (geometry.type === 'CylinderGeometry' && p.openEnded === false && p.heightSegments === 1) return 'cylinder';
  return null;
}

// Edge bands, tier full only (WEAPONS.md 2.4.3): boxes and closed cylinders
// gain inner vertices pulled just inside the faces, so the wear colour can
// break at the edges. Box face coordinates are snapped to the exact half
// size: the silhouette and the bounds stay those of the Famille part.
// Banded layouts repeat across the 28 bakes, so each is generated once per
// weathering instance and cloned.
function bandGeometry(geometry, tier, templates) {
  const p = geometry.parameters, kind = tier === 'full' ? bandKind(geometry) : null;
  if (!kind) return geometry.clone();
  if (kind === 'box') {
    const sides = [p.width, p.height, p.depth];
    const key = `box|${sides.join('|')}`;
    if (!templates.has(key)) {
      const banded = new THREE.BoxGeometry(p.width, p.height, p.depth, 3, 3, 3);
      const position = banded.attributes.position;
      for (let v = 0; v < position.count; v++) {
        for (let axis = 0; axis < 3; axis++) {
          const half = sides[axis] / 2, c = position.getComponent(v, axis);
          if (Math.abs(c) < half - 1e-6) position.setComponent(v, axis, Math.sign(c) * (half - Math.min(.004, .2 * 2 * half)));
          else position.setComponent(v, axis, Math.sign(c) * half);
        }
      }
      templates.set(key, banded);
    }
    return templates.get(key).clone();
  }
  const key = `cylinder|${p.radiusTop}|${p.radiusBottom}|${p.height}|${p.radialSegments}|${p.thetaStart}|${p.thetaLength}`;
  if (!templates.has(key)) templates.set(key, bandedCylinder(p));
  return templates.get(key).clone();
}

// Band coverage of an un-banded box or closed cylinder (WEAPONS.md 2.4.4):
// in tier plain every box and cylinder, in tier full the boxes under the
// band threshold. Such a part has no inner vertex, so every vertex is
// creased and full wear and the crease's grime cut flooded whole faces (the
// medium racks and ground cream white, the low first-person guns pale grey,
// the pistol's front-sight post beige; review of 14 October 2026). Each
// vertex's crease is scaled by the mean crease the bands of step 3 give its
// face, so the face keeps the banded part's mean wear and grime:
// - a box face with in-plane sides a, b: 1 − (1 − f(a))·(1 − f(b));
// - a cylinder's side, height h: f(h) (exact for a cone too);
// - a cap of radius r: 1.5·(f(r) − f(r)²/3) on its rim (the fan's centre is
//   not creased, so the fan's mean is two thirds of the rim's value);
// with f(s) = min(0.004, 0.2·s) / s, the band's share of a side (≤ 0.2).
// null (scale 1) for banded parts and every other geometry.
const bandShare = size => size > 0 ? Math.min(.004, .2 * size) / size : 1;
function bandCoverage(geometry) {
  const p = geometry.parameters, kind = geometry.type === 'BoxGeometry' ? 'box' : geometry.type === 'CylinderGeometry' ? 'cylinder' : null;
  if (!kind || !p) return null;
  if (kind === 'box' && (p.widthSegments !== 1 || p.heightSegments !== 1 || p.depthSegments !== 1)) return null;
  if (kind === 'cylinder' && (p.openEnded !== false || p.heightSegments !== 1)) return null;
  const count = geometry.attributes.position.count, scale = new Float32Array(count).fill(1), index = geometry.index;
  const sides = kind === 'box' ? [p.width, p.height, p.depth] : null;
  for (const group of geometry.groups) {
    let value;
    if (kind === 'box') {
      // three's box groups: ±x, ±y, ±z; the face's in-plane sides are the
      // other two.
      const axis = group.materialIndex >> 1, [a, b] = sides.filter((_, i) => i !== axis);
      value = 1 - (1 - bandShare(a)) * (1 - bandShare(b));
    } else if (group.materialIndex === 0) value = bandShare(p.height);
    else {
      const share = bandShare(group.materialIndex === 1 ? p.radiusTop : p.radiusBottom);
      value = 1.5 * (share - share * share / 3);
    }
    for (let i = group.start; i < group.start + group.count && i < (index ? index.count : count); i++) scale[index ? index.getX(i) : i] = value;
  }
  return scale;
}

// crease: 1 when another vertex of the same geometry lies within 1e-5 m
// with a normal more than 30° away (dot < 0.866). Vertices are sorted on a
// 1e-5 m grid: a pair that close sits at most one cell apart per axis, so
// only sorted neighbours are ever compared.
function creaseFlags(px, py, pz, nx, ny, nz) {
  const count = px.length, flags = new Uint8Array(count);
  const qx = new Float64Array(count), qy = new Float64Array(count), qz = new Float64Array(count), order = new Uint32Array(count);
  for (let v = 0; v < count; v++) { qx[v] = Math.round(px[v] * 1e5); qy[v] = Math.round(py[v] * 1e5); qz[v] = Math.round(pz[v] * 1e5); order[v] = v; }
  order.sort((a, b) => qx[a] - qx[b] || qy[a] - qy[b] || qz[a] - qz[b] || a - b);
  for (let i = 0; i < count; i++) {
    const a = order[i];
    for (let j = i + 1; j < count; j++) {
      const b = order[j], dqx = qx[b] - qx[a];
      if (dqx > 1) break;
      const dqy = qy[b] - qy[a], dqz = qz[b] - qz[a];
      if (dqy > 1 || dqy < -1 || dqz > 1 || dqz < -1) continue;
      const dx = px[a] - px[b], dy = py[a] - py[b], dz = pz[a] - pz[b];
      if (dx * dx + dy * dy + dz * dz >= 1e-10) continue;
      if (nx[a] * nx[b] + ny[a] * ny[b] + nz[a] * nz[b] < .866) { flags[a] = 1; flags[b] = 1; }
    }
  }
  return flags;
}

// The material name of each vertex of a multi-material mesh: the first
// triangle in index order wins (the katana blade shares its ridge vertices
// between groups).
function vertexMaterialNames(geometry, names) {
  const count = geometry.attributes.position.count, chosen = new Array(count).fill(null);
  const index = geometry.index, faces = (index ? index.count : count) / 3;
  for (let f = 0; f < faces; f++) {
    let materialIndex = null;
    for (const group of geometry.groups) {
      if (f * 3 >= group.start && f * 3 < group.start + group.count) { materialIndex = group.materialIndex; break; }
    }
    if (materialIndex === null) continue;
    for (let c = 0; c < 3; c++) {
      const v = index ? index.getX(f * 3 + c) : f * 3 + c;
      if (!chosen[v]) chosen[v] = names[materialIndex];
    }
  }
  return chosen;
}

// Wear scale per vertex of an extrusion (WEAPONS.md 2.4.4). An extrusion
// has no inner vertex: every vertex lies on the outline and is creased, so
// full wear would flood whole faces — the axe head's cheeks (its lids,
// group materialIndex 0) and its 7 cm side walls (group 1), which the
// first-person camera looks straight at, turned from fire red to salmon and
// beige. Lids take LID_WEAR, walls WALL_WEAR. null for other geometries.
function extrusionWear(geometry) {
  if (geometry.type !== 'ExtrudeGeometry') return null;
  const count = geometry.attributes.position.count, scale = new Float32Array(count), index = geometry.index;
  for (const group of geometry.groups) {
    const value = group.materialIndex === 0 ? LID_WEAR : WALL_WEAR;
    for (let i = group.start; i < group.start + group.count && i < (index ? index.count : count); i++) scale[index ? index.getX(i) : i] = value;
  }
  return scale;
}

// Glove skin faces (WEAPONS.md 2.4.5): whole faces whose anchor-frame
// normal points away from the camera. Box faces own their vertices, so a
// per-face test lands exactly on vertices. Guns only: a melee weapon's hands
// roll with the swing and would turn those faces to the camera.
function skinFlags(entry, nx, ny, nz, type) {
  if (entry.name !== 'firstPersonHand' || MELEE_TYPES.has(type)) return null;
  const geometry = entry.out, count = geometry.attributes.position.count, flags = new Uint8Array(count);
  const index = geometry.index, faces = (index ? index.count : count) / 3;
  for (let f = 0; f < faces; f++) {
    const a = index ? index.getX(f * 3) : f * 3, b = index ? index.getX(f * 3 + 1) : f * 3 + 1, c = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    if ((nz[a] + nz[b] + nz[c]) / 3 < -.7) { flags[a] = 1; flags[b] = 1; flags[c] = 1; }
  }
  return flags;
}

export function createWeathering() {
  const T = tables();
  const cache = new Map(); // type + '|' + tier → Map<meshKey, BufferGeometry>
  const templates = new Map(); // banded edge geometry layouts, shared by every bake

  function bakeWeapon(type, tier) {
    const gun = buildWeapon(type);
    const anchorName = anchorNameFor(type);
    const anchor = (anchorName && gun.getObjectByName(anchorName)) || gun;
    const anchorInverse = relativeMatrix(gun, anchor).invert();

    // Depth-first in children order; the ordinal counts the meshes sharing
    // a material name over the full first-person build, hands included.
    const entries = [], ordinals = new Map();
    const walk = node => {
      if (node.isMesh) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        const names = materials.map(m => familleMaterialName(m, type) ?? '');
        const name = names.join('+'), ordinal = ordinals.get(name) ?? 0;
        ordinals.set(name, ordinal + 1);
        entries.push({ mesh: node, name, names, ordinal });
      }
      for (const child of node.children) walk(child);
    };
    walk(gun);

    // Phase 1: output geometry (or null for keep), anchor-frame positions,
    // normals and bounds.
    for (const entry of entries) {
      entry.keep = entry.names.some(n => !RECIPES[n]);
      entry.out = entry.keep ? null : bandGeometry(entry.mesh.geometry, tier, templates);
      entry.banded = !entry.keep && tier === 'full' && bandKind(entry.mesh.geometry) !== null;
      const source = entry.out ?? entry.mesh.geometry;
      const me = relativeMatrix(gun, entry.mesh).premultiply(anchorInverse).elements;
      const ne = new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().fromArray(me)).elements;
      const position = source.attributes.position.array, normal = source.attributes.normal.array, count = source.attributes.position.count;
      const px = new Float64Array(count), py = new Float64Array(count), pz = new Float64Array(count);
      const nx = new Float64Array(count), ny = new Float64Array(count), nz = new Float64Array(count);
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let v = 0, o = 0; v < count; v++, o += 3) {
        const lx = position[o], ly = position[o + 1], lz = position[o + 2];
        const x = me[0] * lx + me[4] * ly + me[8] * lz + me[12];
        const y = me[1] * lx + me[5] * ly + me[9] * lz + me[13];
        const z = me[2] * lx + me[6] * ly + me[10] * lz + me[14];
        px[v] = x; py[v] = y; pz[v] = z;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        let vx = ne[0] * normal[o] + ne[3] * normal[o + 1] + ne[6] * normal[o + 2];
        let vy = ne[1] * normal[o] + ne[4] * normal[o + 1] + ne[7] * normal[o + 2];
        let vz = ne[2] * normal[o] + ne[5] * normal[o + 1] + ne[8] * normal[o + 2];
        const length = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
        nx[v] = vx / length; ny[v] = vy / length; nz[v] = vz / length;
      }
      entry.bounds = { minX, minY, minZ, maxX, maxY, maxZ };
      entry.small = (maxX - minX) * (maxY - minY) * (maxZ - minZ) < 2e-6 ? 1 : 0;
      entry.hand = entry.name === 'firstPersonHand' || entry.name === 'firstPersonSleeve';
      entry.px = px; entry.py = py; entry.pz = pz; entry.nx = nx; entry.ny = ny; entry.nz = nz;
    }
    // Cavity sources: every mesh of the weapon but the hands and sleeve,
    // bounds pre-expanded by 0.006 m.
    const sources = entries.filter(entry => !entry.hand);

    // Phase 2: per-vertex colours from the recipe base, the class and the
    // seeded noises (WEAPONS.md 2.4.4-5). Class data is flattened once per
    // material name; the cap at 1 lets the cavity scan stop at the first
    // containing mesh.
    const flatClass = new Map();
    const infoFor = name => {
      if (!flatClass.has(name)) {
        const cls = T.classes.get(RECIPES[name].class);
        flatClass.set(name, {
          base: T.bases.get(name),
          grimeBase: cls.grime.base, grimeAmount: cls.grime.amount, grime: cls.grime.color,
          wearAmount: cls.wear.amount, wear: cls.wear.color,
          rustDensity: cls.rust ? cls.rust.density : 0, rustAmount: cls.rust ? cls.rust.amount : 0, rust: cls.rust ? cls.rust.color : null,
        });
      }
      return flatClass.get(name);
    };
    const baked = new Map();
    for (const entry of entries) {
      if (entry.keep) continue;
      const { px, py, pz, nx, ny, nz } = entry, count = px.length;
      const seed = mixHash(hashSeed(`${type}|${entry.name}|${entry.ordinal}`));
      const seed2 = seed ^ 0x9e3779b9, seed3 = seed ^ 0x85ebca6b;
      const crease = creaseFlags(px, py, pz, nx, ny, nz);
      const skin = skinFlags(entry, nx, ny, nz, type), extruded = extrusionWear(entry.out);
      const coverage = entry.banded ? null : bandCoverage(entry.out);
      const perVertex = entry.names.length > 1 ? vertexMaterialNames(entry.out, entry.names) : null;
      const fixed = perVertex ? null : infoFor(entry.names[0]);
      const others = sources.filter(source => source !== entry);
      const sb = new Float64Array(others.length * 6);
      others.forEach((source, i) => {
        const b = source.bounds;
        sb[i * 6] = b.minX - .006; sb[i * 6 + 1] = b.minY - .006; sb[i * 6 + 2] = b.minZ - .006;
        sb[i * 6 + 3] = b.maxX + .006; sb[i * 6 + 4] = b.maxY + .006; sb[i * 6 + 5] = b.maxZ + .006;
      });
      const colors = new Float32Array(count * 3);
      for (let v = 0; v < count; v++) {
        const info = fixed ?? infoFor(perVertex[v] ?? entry.names[0]);
        const base = skin?.[v] ? T.skin : info.base;
        const x = px[v], y = py[v], z = pz[v];
        let cavity = 0;
        for (let s = 0; s < sb.length; s += 6) {
          if (x >= sb[s] && x <= sb[s + 3] && y >= sb[s + 1] && y <= sb[s + 4] && z >= sb[s + 2] && z <= sb[s + 5]) { cavity = 1; break; }
        }
        const down = Math.max(0, -ny[v]);
        const n1 = vnoise(x / .035, y / .035, z / .035, seed);
        const n2 = vnoise(x / .012, y / .012, z / .012, seed2);
        const n3 = vnoise(x / .020, y / .020, z / .020, seed3);
        const edge = coverage ? crease[v] * coverage[v] : crease[v];
        const grime = clamp01(info.grimeBase + .45 * cavity + .25 * down + .5 * (n1 - .5)) * (1 - .65 * edge);
        const wear = edge * clamp01(.55 + .9 * (n2 - .5)) * (extruded ? extruded[v] : 1);
        let r = base.r, g = base.g, b = base.b, t = info.grimeAmount * grime;
        r += (info.grime.r - r) * t; g += (info.grime.g - g) * t; b += (info.grime.b - b) * t;
        t = info.wearAmount * wear;
        r += (info.wear.r - r) * t; g += (info.wear.g - g) * t; b += (info.wear.b - b) * t;
        if (info.rust) {
          const d = info.rustDensity + .15 * entry.small;
          const rust = smoothstep(1 - d - .06, 1 - d + .06, n3) * (.6 + .4 * Math.max(cavity, down));
          t = Math.min(1, info.rustAmount * (entry.small ? 1.8 : 1)) * rust;
          r += (info.rust.r - r) * t; g += (info.rust.g - g) * t; b += (info.rust.b - b) * t;
        }
        colors[v * 3] = r; colors[v * 3 + 1] = g; colors[v * 3 + 2] = b;
      }
      entry.out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      entry.out.userData.frissonShared = true;
      baked.set(`${entry.name}|${entry.ordinal}`, entry.out);
    }
    for (const entry of entries) entry.mesh.geometry.dispose();
    return baked;
  }

  return {
    bake(type, tier = 'full') {
      if (!WEAPON_TYPES.includes(type)) throw new Error(`Unknown weapon type: ${type}`);
      if (tier !== 'full' && tier !== 'plain') throw new Error(`Unknown weathering tier: ${tier}`);
      const key = type + '|' + tier;
      if (!cache.has(key)) cache.set(key, bakeWeapon(type, tier));
      return cache.get(key);
    },
    dispose() {
      for (const baked of cache.values()) for (const geometry of baked.values()) geometry.dispose();
      for (const template of templates.values()) template.dispose();
      cache.clear(); templates.clear();
    },
  };
}
