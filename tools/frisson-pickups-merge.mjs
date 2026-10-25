#!/usr/bin/env node
// Builds the installed Frisson pickups file, public/frisson/pickups.glb, from
// the two artists' files (art/frisson/PICKUPS.md section 2):
// art/frisson/pickups/pickups.glb (money and ammo, six roots) and
// art/frisson/pickups-more/pickups-more.glb (health, armour, grenade and
// revive, eight roots). Every root is copied exactly — the game's own reader
// (public/frisson/glb.js), then tools/frisson-glb-write.mjs — so the six
// money/ammo roots keep their content byte for byte and two runs give the
// same bytes. The two files share the layout's two materials (pickup,
// pickup_glint); they must carry them identically.
//   node tools/frisson-pickups-merge.mjs           writes public/frisson/pickups.glb
//   node tools/frisson-pickups-merge.mjs --check   rebuilds and compares (exit 1 when they differ)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { writeFrissonGlb } from './frisson-glb-write.mjs';
import { importPublicModule } from '../test/helpers/public-modules.mjs';

export const ROOT = new URL('../', import.meta.url);
export const SOURCES = Object.freeze(['art/frisson/pickups/pickups.glb', 'art/frisson/pickups-more/pickups-more.glb']);
export const OUT = 'public/frisson/pickups.glb';
const GENERATOR = 'tools/frisson-pickups-merge.mjs';
const PREFIX = 'FrissonPickup_';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// A root of the parsed file as the writer takes it, name and data unchanged
// (as frisson-glb-merge.mjs copyRoot, without the rename).
function copyRoot(root) {
  if (root.mesh) throw new Error(`${root.name}: the root must be an empty`);
  return { name: root.name, children: root.children.map(child => {
    if (!child.mesh || child.children.length || !child.name.startsWith(`${root.name}_`)) throw new Error(`${child.name}: not a mesh part of ${root.name}`);
    const { geometry } = child.mesh, { position, normal, color } = geometry.attributes;
    if (!normal || !color) throw new Error(`${child.name}: the pickups layout needs NORMAL and COLOR_0`);
    return { name: child.name, material: child.mesh.material.name, positions: position.array, normals: normal.array, colors: color.array, indices: geometry.index.array };
  }) };
}

// The file's own glTF material, as written (factors are previews the game
// ignores, but they stay the ones the artist exported).
const rawMaterial = (glb, material) => structuredClone(glb.json.materials[glb.materials.indexOf(material)]);

// Two materials with only the ignored preview factors apart (K2: the game
// draws its own) are the same material; the first file's is kept.
function sameMaterial(a, b) {
  const strip = material => { const { pbrMetallicRoughness, ...rest } = material ?? {}; const { baseColorFactor, metallicFactor, roughnessFactor, ...pbr } = pbrMetallicRoughness ?? {}; return { ...rest, pbrMetallicRoughness: pbr }; };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export async function mergePickups(root = ROOT) {
  const { readGlb } = await importPublicModule('frisson/glb.js');
  const roots = [], materials = new Map(), names = new Set();
  for (const source of SOURCES) {
    const glb = readGlb(readFileSync(new URL(source, root)));
    for (const material of glb.materials) {
      const raw = rawMaterial(glb, material), held = materials.get(material.name);
      if (held) { if (!sameMaterial(held, raw)) throw new Error(`${source}: material ${material.name} differs from the first file's beyond the ignored preview factors`); continue; }
      materials.set(material.name, raw);
    }
    for (const part of glb.roots) {
      if (!part.name.startsWith(PREFIX)) throw new Error(`${source}: ${part.name} is not a pickups root`);
      if (names.has(part.name)) throw new Error(`${part.name}: in both files`);
      names.add(part.name);
      roots.push(copyRoot(part));
    }
  }
  return writeFrissonGlb(roots, { generator: GENERATOR, materials: [...materials.values()] });
}

async function main(argv) {
  const check = argv.includes('--check'), unknown = argv.filter(arg => arg !== '--check');
  if (unknown.length) { console.error(`unknown argument ${unknown[0]}\nusage: node tools/frisson-pickups-merge.mjs [--check]`); return 2; }
  const bytes = await mergePickups(), line = `${OUT}: ${bytes.length} bytes, sha256 ${sha256(bytes)}`;
  if (!check) { writeFileSync(new URL(OUT, ROOT), bytes); console.log(`wrote ${line}`); return 0; }
  let committed = null;
  try { committed = readFileSync(new URL(OUT, ROOT)); } catch {}
  const same = committed?.equals(bytes) ?? false;
  console.log(`${same ? 'same' : 'DIFFERS'} ${line}`);
  return same ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main(process.argv.slice(2));
