// The Famille weapons reference GLB (art/frisson/WEAPONS.md 3.2 'Reference
// geometry', section 6 deliverable 1): every one of the 14 Famille weapons as
// built by `buildWeapon` in public/world.js, walked into its ANCHOR frame
// (`smgCompactFrame`, `batStrikeFrame`, `fireaxeEdgeFrame`, `hammerStrikeFrame`,
// `katanaEdgeFrame`, else the gun group) by composing local
// position/quaternion/scale between mesh and anchor — never matrixWorld, so
// the gun group's first-person pose never leaks in. The Blender artist imports
// this file read-only and models the dressing around it.
//
// Roots:
//   FamilleWeapon_<Weapon>          one mesh per Famille part, named
//                                   <type>_<ordinal>_<material> (ordinal = index
//                                   among meshes with the same material name —
//                                   array materials joined by '+' — counted over
//                                   the full first-person build, hands included).
//                                   The katana blade (3 material groups) emits
//                                   one mesh per group, named
//                                   <type>_<ordinal>_<groupMaterialName>.
//   Reference_Ground_<Weapon>       the G5 ground envelope: a centred box of
//                                   2*halfWidth x height x 2*halfLength
//                                   (GROUND_WEAPON_BOUNDS in public/rules.js),
//                                   floor at y 0.
//   Reference_Rack_<Weapon>         the G5 rack box: x +-0.65, y 0.90..2.15,
//                                   z 0..0.22.
//   Reference_Sight_<Weapon>        (guns only) the G4 sight-corridor boxes of
//                                   WEAPONS.md 3.4, plus a 60 mm muzzle-
//                                   clearance cube at the muzzle point.
//
// Colours: COLOR_0 on every mesh, neutral muted tones per material class
// (steel, gunmetal, wood, cloth, brass, hands…), envelopes green/brown, sight
// corridors red, the muzzle cube sand. Normals smooth. Material colours in the
// file are previews and are ignored by the game (G2).
// Deterministic: two runs give byte-identical GLBs.
//
//   node tools/frisson-weapons-reference.mjs [--out <file.glb>] [--stats]
//
// Default --out: art/frisson/weapons/reference/weapons-famille.glb.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { writeFrissonGlb } from './frisson-glb-write.mjs';

// world.js is a browser module; the test helper loads it in Node. The appended
// export only maps a cached material back to its Famille name (materials built
// by `material()` carry no name today). buildWeapon is the post-hook name;
// createWeapon is its pre-hook equivalent.
const ROOT = new URL('../', import.meta.url);
const { importPublicSource, importPublicModule } = await import(new URL('test/helpers/public-modules.mjs', ROOT));
const famille = await importPublicSource(
  readFileSync(new URL('public/world.js', ROOT), 'utf8') +
  "\nexport function __familleMaterialName(material) { for (const [name, mat] of Object.entries(mats)) if (mat === material) return name; return material?.name || 'unknown'; }\n",
  { name: 'world.js' });
const buildWeapon = famille.buildWeapon ?? famille.createWeapon;
const { GROUND_WEAPON_BOUNDS } = await importPublicModule('rules.js');

const TYPES = ['pistol', 'magnum', 'smg', 'assault', 'rifle', 'shotgun', 'sniper', 'minigun', 'rocket', 'flamethrower', 'bat', 'fireaxe', 'hammer', 'katana'];
const NAME = type => type[0].toUpperCase() + type.slice(1);
const ANCHORS = { smg: 'smgCompactFrame', bat: 'batStrikeFrame', fireaxe: 'fireaxeEdgeFrame', hammer: 'hammerStrikeFrame', katana: 'katanaEdgeFrame' };
// WEAPONS.md 3.2: hands-free anchor-frame Famille bounds and the muzzle point.
const CONTRACT = {
  pistol: { min: [-.052, -.293, -.311], max: [.059, .116, .152], muzzle: [0, .018, -.315] },
  magnum: { min: [-.082, -.235, -.458], max: [.082, .124, .168], muzzle: [0, .059, -.460] },
  smg: { min: [-.056, -.340, -.630], max: [.057, .120, .458], muzzle: [0, .012, -.621] },
  assault: { min: [-.054, -.335, -.825], max: [.054, .182, .460], muzzle: [0, .025, -.830] },
  rifle: { min: [-.085, -.353, -.840], max: [.130, .213, .460], muzzle: [0, .012, -.860] },
  shotgun: { min: [-.060, -.236, -.990], max: [.060, .127, .460], muzzle: [0, .012, -1.010] },
  sniper: { min: [-.063, -.234, -1.152], max: [.162, .305, .500], muzzle: [0, .055, -1.154] },
  minigun: { min: [-.145, -.280, -.920], max: [.145, .187, .460], muzzle: [0, .012, -.940] },
  rocket: { min: [-.132, -.290, -.740], max: [.156, .200, .440], muzzle: [0, .035, -.755] },
  flamethrower: { min: [-.192, -.235, -.702], max: [.192, .126, .276], muzzle: [0, .015, -.715] },
  bat: { min: [-.057, -.057, -.740], max: [.057, .057, .350] },
  fireaxe: { min: [-.335, -.052, -.950], max: [.330, .052, .413] },
  hammer: { min: [-.139, -.138, -.935], max: [.145, .145, .403] },
  katana: { min: [-.092, -.060, -1.175], max: [.112, .060, .313] },
};
// WEAPONS.md 3.4 sight corridors, anchor frame [x0, x1, y0, y1, z0, z1]
// (y1 is the Famille bounds top for the 'y >=' corridors).
const CORRIDORS = {
  pistol: [[-.025, .025, .085, .116, -.31, .06]],
  magnum: [[-.025, .025, .095, .124, -.46, .06]],
  smg: [[-.025, .025, .055, .120, -.63, .11]],
  assault: [[-.04, .04, .10, .182, -.56, .02]],
  rifle: [[-.04, .04, .055, .213, -.86, .11]],
  shotgun: [[-.03, .03, .055, .127, -1.01, .11]],
  minigun: [[-.03, .03, .055, .187, -.94, .11]],
  sniper: [[-.075, .075, .11, .31, -.54, .07]],
  rocket: [[.09, .16, .055, .200, -.25, .15]],
  flamethrower: [[-.07, .07, -.06, .09, -.702, -.48]],
};

const localOf = node => new THREE.Matrix4().compose(node.position, node.quaternion, node.scale);
const chainUp = (node, stop) => { const matrix = new THREE.Matrix4(); for (let n = node; n && n !== stop; n = n.parent) matrix.premultiply(localOf(n)); return matrix; };
const anchorOf = (gun, type) => (ANCHORS[type] ? gun.getObjectByName(ANCHORS[type]) : gun);
const frameOf = (mesh, gun, anchor) => chainUp(anchor, gun).invert().multiply(chainUp(mesh, gun));

const lin = hex => { const color = new THREE.Color(hex); return [color.r, color.g, color.b]; };
// Neutral, muted reference tones per material class.
function classColor(name) {
  if (name === 'firstPersonHand') return lin(0x8f7a64);
  if (name === 'firstPersonSleeve') return lin(0x565a4c);
  if (/sight|Bore|OpticGlass/.test(name)) return lin(0x2e3134);
  if (/gold|Trim|Warning/.test(name)) return lin(0xa8935e);
  if (/Grip|Tape|Wrap/.test(name)) return lin(0x4a463c);
  if (/[Ww]ood|Stock|Hickory|Shaft|Ash|Walnut|Stamp/.test(name)) return lin(0x7d6547);
  if (/Steel|Slide|Spikes|Edge/.test(name)) return lin(0x82857e);
  if (/Olive|Enamel|Casing|Tank/.test(name)) return lin(0x5d6250);
  return lin(0x565b57); // gunmetal and the rest
}
const GROUND_COLOR = lin(0x4e5d4c), RACK_COLOR = lin(0x5d5346), CORRIDOR_COLOR = lin(0x61484a), MUZZLE_COLOR = lin(0x6e6238);

// A centred reference box, wound outward (8 corners, 12 triangles).
function boxMesh(name, material, centre, [w, h, d], color) {
  const positions = [], indices = [];
  for (const xi of [0, 1]) for (const yi of [0, 1]) for (const zi of [0, 1])
    positions.push([centre[0] + (xi - .5) * w, centre[1] + (yi - .5) * h, centre[2] + (zi - .5) * d].map(v => Math.fround(v)));
  const id = (xi, yi, zi) => xi * 4 + yi * 2 + zi;
  for (const [a, b, c, e] of [
    [id(0, 0, 0), id(0, 1, 0), id(0, 1, 1), id(0, 0, 1)], [id(1, 0, 0), id(1, 0, 1), id(1, 1, 1), id(1, 1, 0)],
    [id(0, 0, 0), id(0, 0, 1), id(1, 0, 1), id(1, 0, 0)], [id(0, 1, 0), id(1, 1, 0), id(1, 1, 1), id(0, 1, 1)],
    [id(0, 0, 0), id(1, 0, 0), id(1, 1, 0), id(0, 1, 0)], [id(0, 0, 1), id(0, 1, 1), id(1, 1, 1), id(1, 0, 1)],
  ]) indices.push(a, b, c, a, c, e);
  return { name, material, positions, indices, colors: positions.map(() => color) };
}

const HAND_NAMES = new Set(['firstPersonHand', 'firstPersonSleeve']);

// One Famille weapon as GLB children, in its anchor frame.
function weaponChildren(type) {
  const gun = buildWeapon(type), anchor = anchorOf(gun, type), children = [], ordinals = new Map();
  const handsFree = new THREE.Box3(), vector = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  gun.traverse(node => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const names = materials.map(material => famille.__familleMaterialName(material));
    const key = names.join('+'), ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);
    const relative = frameOf(node, gun, anchor);
    normalMatrix.getNormalMatrix(relative);
    const source = node.geometry, positions = source.attributes.position, normals = source.attributes.normal;
    // Anchor-frame positions and normals (smooth: the Famille ones, rotated).
    const points = [], normalList = [];
    for (let i = 0; i < positions.count; i++) {
      vector.fromBufferAttribute(positions, i).applyMatrix4(relative);
      points.push([Math.fround(vector.x), Math.fround(vector.y), Math.fround(vector.z)]);
      if (normals) {
        vector.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
        normalList.push([Math.fround(vector.x), Math.fround(vector.y), Math.fround(vector.z)]);
      }
    }
    if (!HAND_NAMES.has(key)) {
      handsFree.union(new THREE.Box3().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z))));
    }
    const emit = (name, materialName, indices, remap) => children.push({
      name, material: materialName,
      positions: remap ? remap.map(i => points[i]) : points,
      normals: normalList.length ? (remap ? remap.map(i => normalList[i]) : normalList) : undefined,
      indices, colors: Array.from({ length: remap ? remap.length : points.length }, () => classColor(materialName)),
    });
    if (source.groups.length > 1 && materials.length > 1) {
      // One GLB mesh per material group (the katana blade), vertices deduped.
      for (const group of source.groups) {
        const remap = [], remapIndex = new Map(), indices = [];
        const at = i => { if (!remapIndex.has(i)) { remapIndex.set(i, remap.length); remap.push(i); } return remapIndex.get(i); };
        for (let i = group.start; i < group.start + group.count; i++) indices.push(at(source.index.getX(i)));
        emit(`${type}_${ordinal}_${names[group.materialIndex]}`, names[group.materialIndex], indices, remap);
      }
    } else {
      const indices = source.index ? Array.from(source.index.array) : Array.from({ length: positions.count }, (_, i) => i);
      emit(`${type}_${ordinal}_${key}`, key, indices, null);
    }
  });
  return { children, handsFree };
}

export function referenceRoots({ warn = console.warn } = {}) {
  const roots = [];
  for (const type of TYPES) {
    const { children, handsFree } = weaponChildren(type);
    const contract = CONTRACT[type];
    for (const axis of ['x', 'y', 'z']) {
      if (Math.abs(handsFree.min[axis] - contract.min['xyz'.indexOf(axis)]) > 2e-3 || Math.abs(handsFree.max[axis] - contract.max['xyz'.indexOf(axis)]) > 2e-3)
        warn(`${type}: measured hands-free anchor bounds ${axis} ${handsFree.min[axis].toFixed(4)}..${handsFree.max[axis].toFixed(4)} differ from WEAPONS.md 3.2 (${contract.min['xyz'.indexOf(axis)]}..${contract.max['xyz'.indexOf(axis)]})`);
    }
    roots.push({ name: `FamilleWeapon_${NAME(type)}`, children });
    const ground = GROUND_WEAPON_BOUNDS[type];
    roots.push({ name: `Reference_Ground_${NAME(type)}`, children: [boxMesh(`Reference_Ground_${NAME(type)}_box`, 'referenceGround', [0, ground.height / 2, 0], [2 * ground.halfWidth, ground.height, 2 * ground.halfLength], GROUND_COLOR)] });
    roots.push({ name: `Reference_Rack_${NAME(type)}`, children: [boxMesh(`Reference_Rack_${NAME(type)}_box`, 'referenceRack', [0, (.9 + 2.15) / 2, .11], [1.3, 1.25, .22], RACK_COLOR)] });
    if (CORRIDORS[type]) {
      const corridorChildren = CORRIDORS[type].map(([x0, x1, y0, y1, z0, z1], index) =>
        boxMesh(`Reference_Sight_${NAME(type)}_corridor-${index}`, 'referenceSight', [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [x1 - x0, y1 - y0, z1 - z0], CORRIDOR_COLOR));
      corridorChildren.push(boxMesh(`Reference_Sight_${NAME(type)}_muzzle`, 'referenceMuzzle', contract.muzzle, [.06, .06, .06], MUZZLE_COLOR));
      roots.push({ name: `Reference_Sight_${NAME(type)}`, children: corridorChildren });
    }
  }
  return roots;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--out');
  const out = resolve(at >= 0 && args[at + 1] ? args[at + 1] : fileURLToPath(new URL('art/frisson/weapons/reference/weapons-famille.glb', ROOT)));
  const roots = referenceRoots();
  const bytes = writeFrissonGlb(roots, { generator: 'frisson-weapons-reference.mjs' });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  // Prove the game's own reader accepts the file.
  const { readGlb } = await importPublicModule('frisson/glb.js');
  const parsed = readGlb(bytes);
  console.log(`${out}: ${bytes.length} bytes, ${parsed.roots.length} roots, ${parsed.meshes.length} meshes (readGlb OK)`);
  if (args.includes('--stats')) for (const type of TYPES) {
    const root = roots.find(entry => entry.name === `FamilleWeapon_${NAME(type)}`);
    const triangles = root.children.reduce((sum, child) => sum + child.indices.length / 3, 0);
    console.log(`  ${type.padEnd(12)} ${String(root.children.length).padStart(3)} meshes, ${String(triangles).padStart(5)} triangles`);
  }
}
