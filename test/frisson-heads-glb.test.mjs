import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { importPublicModule } from './helpers/public-modules.mjs';
import { buildHeadsGlb, headParts, namedHeads } from './helpers/frisson-heads-glb.mjs';
import { checkFrissonGlb, CONTRACT } from '../tools/frisson-glb-check.mjs';

// The Frisson heads GLB (art/frisson/DESIGN.md): the game's small reader,
// the contract checker, and the committed public/frisson/heads.glb (the
// owner's choice, built by tools/frisson-glb-merge.mjs; its own tests:
// frisson-final-heads.test.mjs).
const { readGlb } = await importPublicModule('frisson/glb.js');
const HEADS = readFileSync(new URL('../public/frisson/heads.glb', import.meta.url));
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const jsonText = bytes => bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString();

test('the reader gives back exactly what three\'s GLTFLoader reads from heads.glb', async () => {
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(arrayBuffer(HEADS), '', resolve, reject));
  const glb = readGlb(HEADS);
  assert.deepEqual(glb.roots.map(root => root.name), gltf.scene.children.map(root => root.name));
  let compared = 0;
  for (const root of glb.roots) for (const node of root.children) {
    const reference = gltf.scene.getObjectByName(node.name);
    assert.ok(reference?.isMesh, node.name);
    assert.equal(reference.parent.name, root.name);
    assert.ok(reference.matrixWorld.equals(new THREE.Matrix4()), `${node.name}: transforms applied`);
    const mine = node.mesh.geometry, theirs = reference.geometry;
    for (const name of ['position', 'normal', 'color']) {
      if (!theirs.attributes[name]) { assert.equal(mine.attributes[name], undefined); continue; }
      assert.equal(mine.attributes[name].itemSize, 3, `${node.name} ${name}`);
      assert.deepEqual(Array.from(mine.attributes[name].array), Array.from(theirs.attributes[name].array), `${node.name} ${name}`);
    }
    assert.deepEqual(Array.from(mine.index.array), Array.from(theirs.index.array), `${node.name} indices`);
    assert.equal(node.mesh.material.name, reference.material.name);
    assert.equal(node.mesh.material.color.getHex(), reference.material.color.getHex());
    assert.equal(node.mesh.material.emissiveIntensity, reference.material.emissiveIntensity);
    compared++;
  }
  assert.equal(compared, glb.roots.length * 3);
});

test('heads.glb follows the heads contract (names, materials, colours, budget, bounds)', async () => {
  const { errors, heads } = await checkFrissonGlb(HEADS);
  assert.deepEqual(errors, []);
  const ordinary = heads.filter(head => !head.boss);
  assert.ok(ordinary.length >= CONTRACT.minVariants);
  for (const head of heads) {
    assert.ok(head.triangles.total <= (head.boss ? CONTRACT.bossTriangles : CONTRACT.triangles), head.name);
    assert.ok(head.min[1] >= -.25 && head.max[1] <= .26, `${head.name} stays in the head-shot band`);
  }
  // No textures, skins, animations or stray extensions, by the file itself.
  const json = JSON.parse(HEADS.subarray(20, 20 + HEADS.readUInt32LE(12)).toString());
  for (const key of ['textures', 'images', 'samplers', 'skins', 'animations', 'extensionsRequired']) assert.equal(json[key], undefined, key);
  assert.deepEqual(json.extensionsUsed ?? [], ['KHR_materials_emissive_strength']);
  // 24 heads and the boss: about 1.2 MB, read in a few tens of ms (DESIGN.md).
  assert.ok(HEADS.length < 1_300_000, `${HEADS.length} bytes: small enough to load with the room`);
});

test('the reader accepts every encoding of the layout: u16 or u32 indices, float or normalized colours', () => {
  for (const options of [{}, { indexType: 'u32' }, { color: 'u16n4' }]) {
    const glb = readGlb(buildHeadsGlb(namedHeads(2), options));
    assert.deepEqual(glb.roots.map(root => root.name), ['FrissonHead_Test0', 'FrissonHead_Test1']);
    const skin = glb.roots[0].children[0].mesh.geometry;
    assert.equal(skin.attributes.color.itemSize, 3, 'RGB only: no vertex-alpha program');
    assert.ok(skin.attributes.color.array instanceof Float32Array);
    assert.ok(Math.abs(skin.attributes.color.getX(0) - .7) < 1e-4);
    assert.equal(skin.index.count, 24);
    assert.equal(glb.roots[0].children[2].mesh.material.emissiveIntensity, 3);
  }
});

test('the reader refuses anything outside the layout with a clear message', () => {
  const broken = (mutate, options = {}) => buildHeadsGlb(namedHeads(1), { ...options, mutate });
  const cases = [
    [broken(json => { json.nodes[0].translation = [0, .1, 0]; }), /transforms must be applied/],
    [broken(json => { json.nodes[3].scale = [2, 2, 2]; }), /transforms must be applied/],
    [broken(json => { json.images = [{ uri: 'x.png' }]; json.textures = [{ source: 0 }]; }), /textures are not allowed|images are not allowed/],
    [broken(json => { json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 }; }), /textures are not allowed/],
    [broken(json => { json.animations = [{ channels: [], samplers: [] }]; }), /animations are not allowed/],
    [broken(json => { json.skins = [{ joints: [0] }]; }), /skins are not allowed/],
    [broken(json => { json.meshes[0].primitives.push(json.meshes[0].primitives[0]); }), /exactly one primitive/],
    [broken(json => { json.meshes[0].primitives[0].mode = 1; }), /triangles only/],
    [broken(json => { json.extensionsUsed.push('KHR_draco_mesh_compression'); }), /extension KHR_draco_mesh_compression is outside the layout/],
    [broken(json => { json.extensionsRequired = ['KHR_texture_basisu']; }), /required extensions/],
    [broken(json => { delete json.meshes[0].primitives[0].indices; }), /indices are missing/],
    [broken(json => { json.meshes[0].primitives[0].attributes.TEXCOORD_0 = 0; }), /TEXCOORD_0 is outside the layout/],
    [broken(json => { json.bufferViews[0].byteStride = 16; }), /interleaved/],
    [broken(json => { json.accessors[0].count = 9999; }), /out of bounds/],
    [broken(() => {}, { indexType: 'u8' }), /u16 or u32/],
    [Buffer.from('not a glb file at all'), /not a binary glTF/],
    // Numbers that pass every bound check: NaN and infinite vertices, part
    // counts and offsets, indices written as strings, factors past 1e308.
    [buildHeadsGlb([{ name: 'FrissonHead_A', parts: { ...headParts(), Skin: { ...headParts().Skin, positions: headParts().Skin.positions.map((point, index) => index === 2 ? [0, NaN, 0] : point) } } }]), /POSITION: non-finite value/],
    [buildHeadsGlb([{ name: 'FrissonHead_A', parts: { ...headParts(), Skin: { ...headParts().Skin, normals: headParts().Skin.positions.map((_, index) => index ? [0, 1, 0] : [0, Infinity, 0]) } } }]), /NORMAL: non-finite value/],
    [broken(json => { json.accessors[0].count = 1.5; }), /whole numbers/],
    [broken(json => { json.bufferViews[0].byteOffset = -12; }), /whole numbers/],
    [broken(json => { json.nodes[0].mesh = '0'; }), /mesh 0 is missing/],
    [broken(json => { json.scenes[0].nodes = ['3']; }), /scene node 3 is missing/],
    [broken(json => { json.materials[0].pbrMetallicRoughness.baseColorFactor = [1, 1, null, 1]; }), /factors must be finite/],
    [broken(() => {}, { text: text => text.replace('"roughnessFactor":0.85', '"roughnessFactor":1e999') }), /material skin: factors must be finite/],
    // Shapes no check names still fail with the prefix.
    [broken(json => { json.nodes[0].children = 5; }), /GLB: unreadable layout/],
  ];
  for (const [bytes, message] of cases) assert.throws(() => readGlb(bytes), error => error.message.startsWith('GLB: ') && message.test(error.message), String(message));
  const truncated = Buffer.from(HEADS.subarray(0, 4000)); truncated.writeUInt32LE(4000, 8);
  assert.throws(() => readGlb(truncated), /GLB: truncated chunk/);
});

// Every value of a small valid file, replaced in turn by values a broken
// exporter or a hand edit could leave there.
test('whatever the JSON holds, the reader refuses with a GLB message or reads finite, in-range data', async () => {
  const leaves = (value, path = []) => value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key])) : [path];
  const paths = leaves(JSON.parse(jsonText(buildHeadsGlb(namedHeads(1)))));
  const replacements = [null, -1, 1.5, '0', 2 ** 40, true, {}, []];
  let refused = 0, read = 0;
  for (const path of paths) for (const replacement of replacements) {
    const bytes = buildHeadsGlb(namedHeads(1), { mutate: json => { const parent = path.slice(0, -1).reduce((node, key) => node[key], json); parent[path.at(-1)] = structuredClone(replacement); } });
    let glb;
    try { glb = readGlb(bytes); } catch (error) {
      assert.ok(error instanceof Error && error.message.startsWith('GLB: '), `${path.join('.')} = ${JSON.stringify(replacement)}: ${error?.message ?? error}`);
      refused++; continue;
    }
    read++;
    for (const mesh of glb.meshes) {
      const { position, normal, color } = mesh.geometry.attributes;
      for (const attribute of [position, normal, color].filter(Boolean)) assert.ok(attribute.array.every(Number.isFinite), `${path.join('.')}: finite ${mesh.name}`);
      assert.ok(Array.from(mesh.geometry.index.array).every(index => Number.isInteger(index) && index < position.count), `${path.join('.')}: indices in range`);
    }
    // The checker reports, it never throws.
    await checkFrissonGlb(bytes, { minVariants: 1 });
  }
  assert.ok(paths.length > 60 && refused > 300 && read > 50, `${paths.length} values, ${refused} refused, ${read} read`);
});

test('the checker catches files the reader accepts but the contract does not', async () => {
  const errorsOf = async (heads, options) => (await checkFrissonGlb(buildHeadsGlb(heads, options), { minVariants: 1 })).errors.join('\n');
  assert.equal(await errorsOf(namedHeads(3, { boss: true })), '', 'a small valid file');
  assert.match((await checkFrissonGlb(buildHeadsGlb(namedHeads(3)))).errors.join('\n'), /3 ordinary heads, the contract asks for at least 8/);
  assert.match(await errorsOf([{ name: 'FrissonHead_Old.001' }]), /no dots/);
  assert.match(await errorsOf([{ name: 'ZombieHead_A' }]), /FrissonHead_<Name>/);
  const parts = headParts(); delete parts.Eyes;
  assert.match(await errorsOf([{ name: 'FrissonHead_A', parts }]), /expected exactly FrissonHead_A_Skin, FrissonHead_A_Detail, FrissonHead_A_Eyes/);
  assert.match(await errorsOf([{ name: 'FrissonHead_A', parts: { ...headParts(), Detail: { ...headParts().Detail, material: 'skin' } } }]), /FrissonHead_A_Detail: material "skin", expected "detail"/);
  // Single-sided materials (DESIGN.md, the heads contract): the merge drops a source's doubleSided.
  const twoSided = json => { for (const material of json.materials) if (material.name === 'detail') material.doubleSided = true; };
  assert.match(await errorsOf([{ name: 'FrissonHead_A' }], { mutate: twoSided }), /FrissonHead_A_Detail: materials are single-sided/);
  assert.match(await errorsOf([{ name: 'FrissonHead_A', parts: headParts({ top: .3 }) }]), /y spans -0\.300\.\.0\.300, allowed -0\.25\.\.0\.26/);
  const tinted = headParts(); tinted.Skin.colors = tinted.Skin.colors.map(() => [.8, .2, .2]);
  assert.match(await errorsOf([{ name: 'FrissonHead_A', parts: tinted }]), /FrissonHead_A_Skin: COLOR_0 multiplies the family colour/);
  const bare = headParts(); delete bare.Detail.colors;
  assert.match(await errorsOf([{ name: 'FrissonHead_A', parts: bare }]), /FrissonHead_A_Detail: COLOR_0 is missing/);
  const backwards = headParts(); backwards.Eyes.positions = backwards.Eyes.positions.map(([x, y, z]) => [x, y, -z]);
  assert.match(await errorsOf([{ name: 'FrissonHead_A', parts: backwards }]), /must look down -Z/);
  // Budgets: 1,600 triangles a head, 2,400 for the boss.
  const sphere = new THREE.SphereGeometry(.18, 48, 20), position = sphere.attributes.position;
  const dense = headParts();
  dense.Skin = { positions: Array.from({ length: position.count }, (_, index) => [position.getX(index), position.getY(index), position.getZ(index)]), indices: Array.from(sphere.index.array), material: 'skin' };
  dense.Skin.colors = dense.Skin.positions.map(() => [.6, .6, .6]);
  assert.ok(sphere.index.count / 3 > 1600 && sphere.index.count / 3 < 2400);
  assert.match(await errorsOf([{ name: 'FrissonHead_A', parts: dense }]), /FrissonHead_A: \d+ triangles, budget 1600/);
  assert.equal(await errorsOf([{ name: 'FrissonHead_A' }, { name: 'FrissonHead_Boss', parts: dense }]), '', 'the boss may use more');
  assert.match(await errorsOf([{ name: 'FrissonHead_A' }], { mutate: json => { json.nodes[0].translation = [0, 1, 0]; } }), /GLB: node FrissonHead_A_Skin: transforms must be applied/);
});

test('the checker runs from the command line with an exit code', async () => {
  const tool = fileURLToPath(new URL('../tools/frisson-glb-check.mjs', import.meta.url));
  const run = file => spawnSync(process.execPath, [tool, file], { encoding: 'utf8' });
  const good = run(fileURLToPath(new URL('../public/frisson/heads.glb', import.meta.url)));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /OK: the file follows the heads contract/);
  const missing = run('does-not-exist.glb');
  assert.equal(missing.status, 1);
});

test('the checker\'s options: a bad --min-variants is bad usage, never a pass, in any order', async () => {
  const tool = fileURLToPath(new URL('../tools/frisson-glb-check.mjs', import.meta.url));
  const folder = mkdtempSync(join(tmpdir(), 'frisson-heads-')), small = join(folder, 'three-heads.glb');
  try {
    writeFileSync(small, buildHeadsGlb(namedHeads(3)));
    const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
    assert.equal(run(small).status, 1, 'three heads, eight asked for');
    for (const args of [['--min-variants', 'eight', small], [small, '--min-variants'], [small, '--min-variants', '0'], [small, '--min-variants', '2.5'], [small, '--min-variants=-3'], ['--frob', small], [small, small], []]) {
      const result = run(...args);
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /usage: node tools\/frisson-glb-check\.mjs/);
    }
    assert.equal(run('--min-variants', '3', small).status, 0, 'the option first, its value never taken for the file');
    assert.equal(run(small, '--min-variants=3').status, 0);
    assert.equal(run('--min-variants', '4', small).status, 1);
  } finally { rmSync(folder, { recursive: true, force: true }); }
  await assert.rejects(checkFrissonGlb(HEADS, { minVariants: Number('eight') }), TypeError);
  // NaN never slips through the bounds either: the reader refuses it first.
  const nan = headParts(); nan.Skin.positions[0] = [NaN, 0, 0];
  assert.match((await checkFrissonGlb(buildHeadsGlb([{ name: 'FrissonHead_A', parts: nan }]), { minVariants: 1 })).errors.join('\n'), /GLB: .*non-finite value/);
});
