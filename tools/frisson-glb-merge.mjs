#!/usr/bin/env node
// Builds the final Frisson heads and bodies from the owner's choice
// (art/frisson/selection.json): public/frisson/heads.glb from the chosen
// head proposals and public/frisson/bodies.glb from the chosen body sets.
// Each source is refused unless its bytes are the ones the owner saw (its
// sha256 in the selection). The geometry is copied exactly (the game's own
// reader, public/frisson/glb.js, then tools/frisson-glb-write.mjs), so two
// runs give the same bytes.
// - Heads: FrissonHead_<Set><Name> for every ordinary head of every source,
//   in the selection's order, then the one FrissonHead_Boss of the source
//   marked boss. Each source's `eyes` material becomes `eyes_<Set>`, so each
//   head keeps its own style's glow (DESIGN.md); skin and detail are one
//   material each (the game draws its own).
// - Bodies: every root of every set, renamed <prefix><Set>_<Variant>
//   (FrissonTorso_A_Shirt2), less the roots a source drops (BODIES.md
//   section 3).
// - Frisson léger (selection.frissonLeger, 15 October 2026): the same heads
//   recipe over the B proposals, public/frisson/heads-b.glb; its bodies are
//   Frisson's own bodies.glb.
//   node tools/frisson-glb-merge.mjs           writes every file
//   node tools/frisson-glb-merge.mjs --check   rebuilds them and compares (exit 1 when they differ)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { writeFrissonGlb } from './frisson-glb-write.mjs';
import { importPublicModule } from '../test/helpers/public-modules.mjs';

export const ROOT = new URL('../', import.meta.url);
export const SELECTION = new URL('art/frisson/selection.json', ROOT);
const GENERATOR = 'tools/frisson-glb-merge.mjs';
const HEAD_PREFIX = 'FrissonHead_', BOSS = 'FrissonHead_Boss';
// A head's new name is FrissonHead_ then letters and digits only: no dot,
// no extra underscore.
const PLAIN = /^[A-Za-z0-9]+$/, SET = /^[A-Z][A-Za-z0-9]*$/;
const HEAD_MATERIALS = ['skin', 'detail', 'eyes'];

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function readSelection(url = SELECTION) { return JSON.parse(readFileSync(url, 'utf8')); }

// A source's bytes, refused when they are not the ones the owner chose.
function sourceBytes(source, root) {
  const bytes = readFileSync(new URL(source.file, root)), digest = sha256(bytes);
  if (digest !== source.sha256) throw new Error(`${source.file}: sha256 ${digest}, the selection names ${source.sha256} (the proposal changed after the owner chose)`);
  if (!SET.test(source.set ?? '')) throw new Error(`${source.file}: set "${source.set}" must be a capital, then letters or digits`);
  return bytes;
}

// A root of the parsed file as the writer takes it, under a new name; its
// children keep their order, their channel suffix and their exact data.
function copyRoot(root, name, material) {
  if (root.mesh) throw new Error(`${root.name}: the root must be an empty`);
  return { name, children: root.children.map(child => {
    if (!child.mesh || child.children.length || !child.name.startsWith(`${root.name}_`)) throw new Error(`${child.name}: not a mesh part of ${root.name}`);
    const { geometry } = child.mesh, { position, normal, color } = geometry.attributes;
    if (!normal) throw new Error(`${child.name}: no NORMAL to copy`);
    return { name: name + child.name.slice(root.name.length), material: material(child.mesh.material.name), positions: position.array, normals: normal.array,
      ...(color ? { colors: color.array } : {}), indices: geometry.index.array };
  }) };
}

// The file's own glTF material, as written (factors, glow and extension).
const rawMaterial = (glb, material) => glb.json.materials[glb.materials.indexOf(material)];

export async function mergeHeads(recipe, root = ROOT) {
  const { readGlb } = await importPublicModule('frisson/glb.js');
  const roots = [], bosses = [], materials = new Map(), sets = new Set();
  for (const source of recipe.sources) {
    const glb = readGlb(sourceBytes(source, root));
    if (sets.has(source.set)) throw new Error(`set ${source.set} appears twice`);
    sets.add(source.set);
    const rename = name => {
      if (!HEAD_MATERIALS.includes(name)) throw new Error(`${source.file}: material ${name} is outside the heads layout the merge knows (${HEAD_MATERIALS.join(', ')})`);
      return name === 'eyes' ? `eyes_${source.set}` : name;
    };
    for (const material of glb.materials) {
      const name = rename(material.name);
      if (materials.has(name)) continue;
      // Head materials are single-sided (DESIGN.md, the heads contract): a
      // source exported double-sided (Rôdeurs B, Revenants B) loses the flag,
      // glTF's default. The game draws its own front-face materials anyway;
      // a source without the flag is copied as it is (heads.glb unchanged).
      const { doubleSided, ...raw } = structuredClone(rawMaterial(glb, material));
      materials.set(name, { ...raw, ...(doubleSided === false ? { doubleSided } : {}), name });
    }
    for (const head of glb.roots) {
      if (!head.name.startsWith(HEAD_PREFIX)) throw new Error(`${source.file}: ${head.name} is not a head`);
      if (head.name === BOSS) { if (source.boss) bosses.push(copyRoot(head, BOSS, rename)); continue; }
      const name = head.name.slice(HEAD_PREFIX.length);
      if (!PLAIN.test(name)) throw new Error(`${source.file}: ${head.name} must be FrissonHead_ then letters and digits`);
      roots.push(copyRoot(head, `${HEAD_PREFIX}${source.set}${name}`, rename));
    }
  }
  if (bosses.length !== 1) throw new Error(`exactly one source must give the boss head, ${bosses.length} do`);
  return writeFrissonGlb([...roots, ...bosses], { generator: GENERATOR, materials: [...materials.values()] });
}

export async function mergeBodies(recipe, root = ROOT) {
  const { readGlb } = await importPublicModule('frisson/glb.js');
  const { bodyRootName } = await importPublicModule('frisson/bodies.js');
  const roots = [], materials = new Map(), sets = new Set();
  for (const source of recipe.sources) {
    const glb = readGlb(sourceBytes(source, root)), drop = new Set(source.drop ?? []);
    if (sets.has(source.set)) throw new Error(`set ${source.set} appears twice`);
    sets.add(source.set);
    for (const name of drop) if (!glb.roots.some(part => part.name === name)) throw new Error(`${source.file}: ${name} is to be dropped but the file has no such root`);
    for (const material of glb.materials) if (!materials.has(material.name)) materials.set(material.name, structuredClone(rawMaterial(glb, material)));
    for (const part of glb.roots) {
      if (drop.has(part.name)) continue;
      const parsed = bodyRootName(part.name);
      if (!parsed || parsed.set !== null) throw new Error(`${source.file}: ${part.name} is not a body root of a single proposal`);
      roots.push(copyRoot(part, `${part.name.slice(0, -parsed.variant.length)}${source.set}_${parsed.variant}`, name => name));
    }
  }
  return writeFrissonGlb(roots, { generator: GENERATOR, materials: [...materials.values()] });
}

// Each file's recipe in the selection, by the key buildFinal answers it
// under: Frisson's heads and bodies, and Frisson léger's heads (headsB).
export const recipes = selection => ({ heads: selection.heads, bodies: selection.bodies, ...(selection.frissonLeger ? { headsB: selection.frissonLeger.heads } : {}) });

// Every file, from the selection: { heads, bodies, headsB } as Buffers.
export async function buildFinal(selection = readSelection(), root = ROOT) {
  const built = { heads: await mergeHeads(selection.heads, root), bodies: await mergeBodies(selection.bodies, root) };
  if (selection.frissonLeger) built.headsB = await mergeHeads(selection.frissonLeger.heads, root);
  return built;
}

async function main(argv) {
  const check = argv.includes('--check'), unknown = argv.filter(arg => arg !== '--check');
  if (unknown.length) { console.error(`unknown argument ${unknown[0]}\nusage: node tools/frisson-glb-merge.mjs [--check]`); return 2; }
  const selection = readSelection(), built = await buildFinal(selection), recipe = recipes(selection);
  let differs = 0;
  for (const [what, bytes] of Object.entries(built)) {
    const out = new URL(recipe[what].out, ROOT), line = `${recipe[what].out}: ${bytes.length} bytes, sha256 ${sha256(bytes)}`;
    if (!check) { writeFileSync(out, bytes); console.log(`wrote ${line}`); continue; }
    let committed = null;
    try { committed = readFileSync(out); } catch {}
    const same = committed?.equals(bytes) ?? false;
    if (!same) differs++;
    console.log(`${same ? 'same' : 'DIFFERS'} ${line}`);
  }
  return differs ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main(process.argv.slice(2));
