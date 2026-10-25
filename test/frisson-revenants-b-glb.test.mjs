// Contract audit of the "Revenants (second artist)" Frisson head proposal:
// art/frisson/proposals/revenants-b/revenants-b_heads.glb against
// art/frisson/DESIGN.md (heads GLB contract). It reads the GLB with a small
// reader (no three.js), then checks that three's own GLTFLoader agrees.
// Skipped when the proposal file is absent (proposals leave once the owner picks).
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

const GLB = new URL('../art/frisson/proposals/revenants-b/revenants-b_heads.glb', import.meta.url);
const METRICS = new URL('../art/frisson/proposals/revenants-b/revenants-b_heads.json', import.meta.url);
const present = existsSync(GLB);
const skip = present ? false : 'the revenants-b proposal GLB is not in this tree';

function readGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'magic glTF');
  assert.equal(view.getUint32(4, true), 2, 'glTF version 2');
  assert.equal(view.getUint32(8, true), bytes.byteLength, 'declared length');
  let offset = 12, json = null, bin = null;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  assert.ok(json && bin, 'JSON and BIN chunks');
  return { json, bin };
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor({ json, bin }, index) {
  const a = json.accessors[index], view = json.bufferViews[a.bufferView];
  assert.equal(view.byteStride ?? 0, 0, 'no interleaving');
  const size = COMPONENTS[a.type], count = a.count * size;
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const buffer = bin.buffer;
  const typed = {
    5126: () => new Float32Array(buffer.slice(start, start + count * 4)),
    5125: () => new Uint32Array(buffer.slice(start, start + count * 4)),
    5123: () => new Uint16Array(buffer.slice(start, start + count * 2)),
    5121: () => new Uint8Array(buffer.slice(start, start + count)),
  }[a.componentType]();
  const scale = a.normalized ? (a.componentType === 5123 ? 65535 : a.componentType === 5121 ? 255 : 1) : 1;
  return { values: scale === 1 ? typed : Float32Array.from(typed, value => value / scale), size, count: a.count };
}

const load = () => readGlb(new Uint8Array(readFileSync(GLB)));

test('revenants-b: a lean GLB with only what the contract allows', { skip }, () => {
  const bytes = readFileSync(GLB);
  assert.ok(bytes.byteLength < 450 * 1024, `GLB under about 450 KB (${bytes.byteLength} bytes)`);
  const { json } = load();
  for (const key of ['textures', 'images', 'samplers', 'skins', 'animations', 'cameras']) assert.ok(!json[key]?.length, `no ${key}`);
  for (const extension of json.extensionsUsed ?? []) assert.equal(extension, 'KHR_materials_emissive_strength');
  assert.deepEqual(json.materials.map(material => material.name).sort(), ['detail', 'eyes', 'skin']);
});

test('revenants-b: roots FrissonHead_<Name> with _Skin, _Detail, _Eyes, identity transforms, one primitive each', { skip }, () => {
  const glb = load(), { json } = glb;
  const roots = json.scenes[json.scene ?? 0].nodes.map(index => json.nodes[index]);
  const names = roots.map(node => node.name);
  assert.ok(names.every(name => /^FrissonHead_[A-Za-z0-9]+$/.test(name)), `root names: ${names}`);
  assert.ok(names.filter(name => name !== 'FrissonHead_Boss').length >= 8, 'at least 8 variants');
  for (const node of json.nodes) {
    assert.ok(!node.matrix && !node.translation && !node.rotation && !node.scale, `${node.name} has an identity transform`);
    assert.ok(!node.name.includes('.'), `${node.name}: no dots`);
  }
  const materialOf = { Skin: 'skin', Detail: 'detail', Eyes: 'eyes' };
  for (const root of roots) {
    const children = root.children.map(index => json.nodes[index]);
    assert.deepEqual(children.map(child => child.name).sort(), ['Detail', 'Eyes', 'Skin'].map(part => `${root.name}_${part}`).sort());
    for (const child of children) {
      const part = child.name.slice(root.name.length + 1), mesh = json.meshes[child.mesh];
      assert.equal(mesh.primitives.length, 1, `${child.name}: one primitive`);
      const primitive = mesh.primitives[0];
      assert.ok(primitive.mode === undefined || primitive.mode === 4, 'triangles');
      assert.ok(primitive.indices !== undefined, 'indexed');
      assert.equal(json.materials[primitive.material].name, materialOf[part]);
      assert.ok(primitive.attributes.POSITION !== undefined && primitive.attributes.NORMAL !== undefined, 'positions and normals');
      if (part !== 'Eyes') assert.ok(primitive.attributes.COLOR_0 !== undefined, `${child.name}: COLOR_0`);
    }
  }
});

// Crawlers wear a head at min(.74, .1591 / skull top), the skull top being
// _Skin's highest point (heads.js), at .66 m: the whole head must stay under
// .825 m like every crawler (zombie-variety.test.mjs).
const crawlerTop = (skinTop, top) => .66 + Math.min(.74, .215 * .74 / skinTop) * top;

test('revenants-b: budgets, bounds, grey skin, eyes on the -Z face, crawler-safe tops', { skip }, () => {
  const glb = load(), { json } = glb;
  const roots = json.scenes[json.scene ?? 0].nodes.map(index => json.nodes[index]);
  for (const root of roots) {
    const boss = root.name === 'FrissonHead_Boss';
    let triangles = 0, eyeZ = 0, eyeCount = 0, skinTop = -Infinity;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const index of root.children) {
      const child = json.nodes[index], primitive = json.meshes[child.mesh].primitives[0];
      triangles += json.accessors[primitive.indices].count / 3;
      const position = accessor(glb, primitive.attributes.POSITION);
      for (let i = 0; i < position.count; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const value = position.values[i * 3 + axis];
          min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
        }
        if (child.name.endsWith('_Eyes')) { eyeZ += position.values[i * 3 + 2]; eyeCount++; }
        if (child.name.endsWith('_Skin')) skinTop = Math.max(skinTop, position.values[i * 3 + 1]);
      }
      if (child.name.endsWith('_Skin')) {
        const color = accessor(glb, primitive.attributes.COLOR_0);
        for (let i = 0; i < color.count; i++) {
          const r = color.values[i * color.size], g = color.values[i * color.size + 1], b = color.values[i * color.size + 2];
          assert.ok(Math.abs(r - g) < 2e-3 && Math.abs(r - b) < 2e-3, `${child.name}: COLOR_0 is a grey multiplier`);
        }
      }
    }
    if (boss) assert.ok(triangles <= 2400, `${root.name}: ${triangles} triangles (boss up to 2,400)`);
    else assert.ok(triangles >= 900 && triangles <= 1600, `${root.name}: ${triangles} triangles (900-1,600)`);
    assert.ok(min[0] >= -0.3 && max[0] <= 0.3, `${root.name}: x ${min[0]}..${max[0]}`);
    assert.ok(min[1] >= -0.25 && max[1] <= 0.26, `${root.name}: y ${min[1]}..${max[1]}`);
    assert.ok(min[2] >= -0.32 && max[2] <= 0.26, `${root.name}: z ${min[2]}..${max[2]}`);
    assert.ok(eyeCount > 0 && eyeZ / eyeCount < -0.12, `${root.name}: the glowing eyes sit on the face, toward -Z`);
    if (!boss) {
      assert.ok(crawlerTop(skinTop, max[1]) <= .825, `${root.name}: a crawler wearing it stays under .825 m (${crawlerTop(skinTop, max[1]).toFixed(4)})`);
      // The scalp stays in _Skin under hair, caps and cloth: the game fits hats and marks to its top.
      assert.ok(skinTop >= .19 && max[1] - skinTop <= .03, `${root.name}: skin top ${skinTop.toFixed(3)} (all ${max[1].toFixed(3)})`);
    }
  }
});

test('revenants-b: the metrics file matches the GLB', { skip }, () => {
  const { json } = load(), metrics = JSON.parse(readFileSync(METRICS, 'utf8'));
  const roots = json.scenes[json.scene ?? 0].nodes.map(index => json.nodes[index].name.replace('FrissonHead_', ''));
  assert.deepEqual(Object.keys(metrics.heads).sort(), [...roots].sort());
  for (const head of Object.values(metrics.heads)) {
    assert.ok(head.face_front_z < -0.15 && head.jaw_bottom < -0.17 && head.skull_top > 0.18);
    assert.ok(head.mouth_top > head.mouth_bottom && head.mouth_bottom > head.jaw_bottom, 'the mouth sits above the chin');
  }
});

test('revenants-b: three r180 GLTFLoader reads the heads as the game expects', { skip }, async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const bytes = readFileSync(GLB);
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject));
  const roots = gltf.scene.children;
  assert.ok(roots.length >= 9);
  for (const root of roots) {
    const skin = root.getObjectByName(`${root.name}_Skin`), detail = root.getObjectByName(`${root.name}_Detail`), eyes = root.getObjectByName(`${root.name}_Eyes`);
    assert.ok(skin?.isMesh && detail?.isMesh && eyes?.isMesh, `${root.name}: three meshes`);
    assert.ok(skin.material.isMeshStandardMaterial && skin.material.vertexColors, 'skin keeps vertex colours (the family colour multiplies them)');
    assert.ok(detail.material.vertexColors, 'detail is vertex-coloured');
    assert.ok(eyes.material.emissiveIntensity >= 1, 'eyes glow');
    const box = new THREE.Box3().setFromObject(eyes);
    assert.ok(box.getCenter(new THREE.Vector3()).z < 0, 'eyes face -Z');
  }
});
