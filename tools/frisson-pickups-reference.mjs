// The Famille pickups reference GLB (art/frisson/PICKUPS.md section 4.1): the
// three Famille pickups as built by `createPickup` in public/world.js, each
// mesh walked into the `pickupModel` frame at rest by composing local
// position/quaternion/scale between mesh and model — never matrixWorld, so a
// group pose never leaks in. One mesh per Famille part, the ammo fill bars
// (the ammoFill children) included. The Blender artist imports this file
// read-only and models the six FrissonPickup roots around it.
//
// Roots:
//   FamillePickup_<Kind>        one mesh per Famille part, named
//                               <kind>_<ordinal>_<material> (ordinal = index
//                               among meshes with the same Famille material).
//   Reference_Envelope_<Kind>   the K3 envelope cylinder (Points, and Ammo
//                               which AmmoSpecial shares), floor at y 0.
//   Reference_KeepOut_Ammo      the three K4 fill keep-out boxes (front, back,
//                               top).
//   Reference_Halo              the halo ring at its smallest pulse (the .935
//                               scale), at its rest height y .014.
//
// Colours: COLOR_0 on every mesh, muted tones per Famille material, the
// envelopes green, the keep-outs red-brown, the halo sand. Material colours
// in the file are previews and are ignored by the game (K2). Normals smooth.
// Deterministic: two runs give byte-identical GLBs.
//
//   node tools/frisson-pickups-reference.mjs [--out <file.glb>] [--stats]
//
// Default --out: art/frisson/pickups/reference/pickups-famille.glb.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { writeFrissonGlb } from './frisson-glb-write.mjs';
import { PICKUPS_CONTRACT } from './frisson-glb-check.mjs';

// world.js is a browser module; the test helper loads it in Node. The
// appended export only maps a cached material back to its Famille name
// (materials built by `material()` carry no name today).
const ROOT = new URL('../', import.meta.url);
const { importPublicSource, importPublicModule } = await import(new URL('test/helpers/public-modules.mjs', ROOT));
const famille = await importPublicSource(
  readFileSync(new URL('public/world.js', ROOT), 'utf8') +
  "\nexport function __familleMaterialName(material) { for (const [name, mat] of Object.entries(mats)) if (mat === material) return name; return material?.name || 'unknown'; }\n",
  { name: 'world.js' });

const KINDS = [['points', false, 'Points'], ['ammo', false, 'Ammo'], ['ammo', true, 'AmmoSpecial']];

const localOf = node => new THREE.Matrix4().compose(node.position, node.quaternion, node.scale);
const chainUp = (node, stop) => { const matrix = new THREE.Matrix4(); for (let n = node; n && n !== stop; n = n.parent) matrix.premultiply(localOf(n)); return matrix; };

const lin = hex => { const color = new THREE.Color(hex); return [color.r, color.g, color.b]; };
// Muted reference tones per Famille material.
function classColor(name) {
  if (name === 'pickupCoins') return lin(0xa8935e);
  if (name === 'pickupCoinRim') return lin(0x8a7444);
  if (name === 'pickupAmmoMarking') return lin(0x5f8a84);
  if (name === 'pickupAmmoSpecialMarking') return lin(0xa08446);
  if (name === 'pickupAmmoBrass') return lin(0x8f7d55);
  if (name === 'pickupAmmoCasing') return lin(0x5d6250);
  return lin(0x565b57); // pickupMetal and the rest
}
const ENVELOPE_COLOR = lin(0x4e5d4c), KEEPOUT_COLOR = lin(0x61484a), HALO_COLOR = lin(0x6e6238);

// One Famille pickup as GLB children, in the pickupModel frame at rest.
function pickupChildren(kind, special, label) {
  const group = famille.createPickup(kind, special), model = group.userData.model;
  const children = [], ordinals = new Map();
  const vector = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  model.traverse(node => {
    if (!node.isMesh) return;
    const materialName = famille.__familleMaterialName(node.material);
    const ordinal = ordinals.get(materialName) ?? 0;
    ordinals.set(materialName, ordinal + 1);
    const relative = chainUp(node, model);
    normalMatrix.getNormalMatrix(relative);
    const source = node.geometry, positions = source.attributes.position, normals = source.attributes.normal;
    const points = [], normalList = [];
    for (let index = 0; index < positions.count; index++) {
      vector.fromBufferAttribute(positions, index).applyMatrix4(relative);
      points.push([Math.fround(vector.x), Math.fround(vector.y), Math.fround(vector.z)]);
      if (normals) {
        vector.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize();
        normalList.push([Math.fround(vector.x), Math.fround(vector.y), Math.fround(vector.z)]);
      }
    }
    const indices = source.index ? Array.from(source.index.array) : Array.from({ length: positions.count }, (_, index) => index);
    children.push({
      name: `${label}_${ordinal}_${materialName}`, material: materialName,
      positions: points, normals: normalList.length ? normalList : undefined,
      indices, colors: points.map(() => classColor(materialName)),
    });
  });
  return children;
}

// A centred reference box, wound outward (8 corners, 12 triangles).
function boxMesh(name, material, centre, [w, h, d], color) {
  const positions = [], indices = [];
  for (const xi of [0, 1]) for (const yi of [0, 1]) for (const zi of [0, 1])
    positions.push([centre[0] + (xi - .5) * w, centre[1] + (yi - .5) * h, centre[2] + (zi - .5) * d].map(value => Math.fround(value)));
  const id = (xi, yi, zi) => xi * 4 + yi * 2 + zi;
  for (const [a, b, c, e] of [
    [id(0, 0, 0), id(0, 1, 0), id(0, 1, 1), id(0, 0, 1)], [id(1, 0, 0), id(1, 0, 1), id(1, 1, 1), id(1, 1, 0)],
    [id(0, 0, 0), id(0, 0, 1), id(1, 0, 1), id(1, 0, 0)], [id(0, 1, 0), id(1, 1, 0), id(1, 1, 1), id(0, 1, 1)],
    [id(0, 0, 0), id(1, 0, 0), id(1, 1, 0), id(0, 1, 0)], [id(0, 0, 1), id(0, 1, 1), id(1, 1, 1), id(1, 0, 1)],
  ]) indices.push(a, b, c, a, c, e);
  return { name, material, positions, indices, colors: positions.map(() => color) };
}

// A K3 envelope: a closed 24-gon cylinder from the floor to the y cap.
function envelopeMesh(name, material, radius, height, color, sides = 24) {
  const positions = [], indices = [];
  const ring = y => Array.from({ length: sides }, (_, j) => {
    positions.push([Math.fround(radius * Math.cos(Math.PI * 2 * j / sides)), Math.fround(y), Math.fround(radius * Math.sin(Math.PI * 2 * j / sides))]);
    return positions.length - 1;
  });
  const bottom = ring(0), top = ring(height);
  const bottomCentre = positions.push([0, 0, 0]) - 1, topCentre = positions.push([0, Math.fround(height), 0]) - 1;
  for (let j = 0; j < sides; j++) {
    const k = (j + 1) % sides;
    indices.push(bottom[j], bottom[k], top[k], bottom[j], top[k], top[j]); // side, wound outward
    indices.push(bottomCentre, bottom[k], bottom[j], topCentre, top[j], top[k]); // caps
  }
  return { name, material, positions, indices, colors: positions.map(() => color) };
}

// The halo ring at its smallest pulse, at its rest height, wound both ways
// (Famille's halo is double-sided).
function haloRingMesh(name, material, inner, outer, y, color, sides = 48) {
  const positions = [], indices = [];
  for (const radius of [inner, outer]) for (let j = 0; j < sides; j++)
    positions.push([Math.fround(radius * Math.cos(Math.PI * 2 * j / sides)), y, Math.fround(radius * Math.sin(Math.PI * 2 * j / sides))]);
  const at = (r, j) => r * sides + (j % sides);
  for (let j = 0; j < sides; j++) indices.push(at(0, j), at(1, j), at(1, j + 1), at(0, j), at(1, j + 1), at(0, j + 1), at(0, j), at(1, j + 1), at(1, j), at(0, j), at(0, j + 1), at(1, j + 1));
  return { name, material, positions, indices, colors: positions.map(() => color) };
}

export function referenceRoots() {
  const C = PICKUPS_CONTRACT, roots = [];
  for (const [kind, special, label] of KINDS)
    roots.push({ name: `FamillePickup_${label}`, children: pickupChildren(kind, special, label) });
  // The K3 envelopes (AmmoSpecial shares Ammo's).
  for (const [label, env] of [['Points', C.envelope.Points], ['Ammo', C.envelope.Ammo]])
    roots.push({ name: `Reference_Envelope_${label}`, children: [envelopeMesh(`Reference_Envelope_${label}_cylinder`, 'referenceEnvelope', env.radius, env.y[1], ENVELOPE_COLOR)] });
  // The K4 keep-out boxes (the side one mirrored for the back bar).
  roots.push({ name: 'Reference_KeepOut_Ammo', children: keepOutBoxesOf(C).map(box => boxMesh(`Reference_KeepOut_Ammo_${box.label}`, 'referenceKeepOut',
    [0, 1, 2].map(axis => (box.min[axis] + box.max[axis]) / 2), [0, 1, 2].map(axis => box.max[axis] - box.min[axis]), KEEPOUT_COLOR)) });
  // The halo ring at its smallest pulse (.935), at rest height (y .014).
  roots.push({ name: 'Reference_Halo', children: [haloRingMesh('Reference_Halo_ring', 'referenceHalo', .29 * .935, .325 * .935, .014, HALO_COLOR)] });
  return roots;
}

// The three K4 boxes as { label, min, max }, mirrored as the checker's.
function keepOutBoxesOf(C) {
  const { side, top } = C.keepOut;
  return [
    { label: 'front', min: [side.x[0], side.y[0], side.z[0]], max: [side.x[1], side.y[1], side.z[1]] },
    { label: 'back', min: [side.x[0], side.y[0], -side.z[1]], max: [side.x[1], side.y[1], -side.z[0]] },
    { label: 'top', min: [top.x[0], top.y[0], top.z[0]], max: [top.x[1], top.y[1], top.z[1]] },
  ];
}

export function referenceGlb(roots = referenceRoots()) {
  return writeFrissonGlb(roots, { generator: 'frisson-pickups-reference.mjs' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--out');
  const out = resolve(at >= 0 && args[at + 1] ? args[at + 1] : fileURLToPath(new URL('art/frisson/pickups/reference/pickups-famille.glb', ROOT)));
  const roots = referenceRoots(), bytes = referenceGlb(roots);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  // Prove the game's own reader accepts the file.
  const { readGlb } = await importPublicModule('frisson/glb.js');
  const parsed = readGlb(bytes);
  console.log(`${out}: ${bytes.length} bytes, ${parsed.roots.length} roots, ${parsed.meshes.length} meshes (readGlb OK)`);
  if (args.includes('--stats')) for (const root of roots) {
    const triangles = root.children.reduce((sum, child) => sum + child.indices.length / 3, 0);
    console.log(`  ${root.name.padEnd(28)} ${String(root.children.length).padStart(3)} meshes, ${String(triangles).padStart(5)} triangles`);
  }
}
