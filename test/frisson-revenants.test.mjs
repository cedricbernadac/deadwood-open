import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The "Revenants" Frisson heads proposal (art/frisson/proposals/revenants):
// the GLB contract of art/frisson/DESIGN.md, checked on the committed file.
// Skipped once the proposal folder is gone (the owner picked another one).
const folder = new URL('../art/frisson/proposals/revenants/', import.meta.url);
const glbUrl = new URL('revenants_heads.glb', folder);
const skip = !existsSync(glbUrl);
const bytes = skip ? null : readFileSync(glbUrl);
const json = skip ? null : JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
const bin = skip ? null : bytes.subarray(20 + bytes.readUInt32LE(12) + 8);
const COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const read = (index, Type) => {
  const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), length = COUNT[accessor.type] * accessor.count;
  return new Type(bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + start + length * Type.BYTES_PER_ELEMENT));
};
const roots = skip ? [] : json.scenes[json.scene ?? 0].nodes.map(index => json.nodes[index]);
const child = (root, suffix) => json.nodes[root.children.find(index => json.nodes[index].name === `${root.name}_${suffix}`)];
const primitive = node => json.meshes[node.mesh].primitives[0];
const triangles = node => json.accessors[primitive(node).indices].count / 3;
const bounds = nodes => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    const accessor = json.accessors[primitive(node).attributes.POSITION];
    accessor.min.forEach((value, axis) => { min[axis] = Math.min(min[axis], value); });
    accessor.max.forEach((value, axis) => { max[axis] = Math.max(max[axis], value); });
  }
  return { min, max };
};
const parts = root => ['Skin', 'Detail', 'Eyes'].map(suffix => child(root, suffix));

test('revenants: root and mesh names, materials and nothing beyond the contract', { skip }, () => {
  assert.ok(roots.every(root => /^FrissonHead_[A-Za-z]+$/.test(root.name)), roots.map(root => root.name).join());
  assert.ok(roots.filter(root => root.name !== 'FrissonHead_Boss').length >= 8, 'at least eight variants');
  assert.ok(roots.some(root => root.name === 'FrissonHead_Boss'));
  for (const root of roots) {
    assert.equal(root.children.length, 3, root.name);
    assert.equal(root.mesh, undefined);
    for (const [suffix, node] of [['Skin', 'skin'], ['Detail', 'detail'], ['Eyes', 'eyes']].map(([s, m]) => [m, child(root, s)])) {
      assert.ok(node, `${root.name} ${suffix}`);
      assert.equal(json.meshes[node.mesh].primitives.length, 1, node.name);
      assert.equal(json.materials[primitive(node).material].name, suffix, node.name);
      assert.ok([undefined, 4].includes(primitive(node).mode), 'triangles');
      const attributes = Object.keys(primitive(node).attributes).sort();
      assert.deepEqual(attributes, suffix === 'eyes' ? ['NORMAL', 'POSITION'] : ['COLOR_0', 'NORMAL', 'POSITION'], node.name);
    }
  }
  for (const node of json.nodes) for (const key of ['translation', 'rotation', 'scale', 'matrix']) assert.equal(node[key], undefined, `${node.name} ${key}`);
  for (const key of ['textures', 'images', 'samplers', 'skins', 'animations', 'cameras']) assert.equal(json[key], undefined, key);
  assert.deepEqual((json.extensionsUsed ?? []).filter(name => name !== 'KHR_materials_emissive_strength'), []);
  assert.ok(bytes.length <= 460_000, `${bytes.length} bytes`);
});

test('revenants: triangle budgets, bounds and the game head band', { skip }, () => {
  // Crawlers wear the head at .74 from 0.66 m and must stay under 0.825 m.
  const crawlerTop = (.825 - .66) / .74;
  for (const root of roots) {
    const boss = root.name === 'FrissonHead_Boss', total = parts(root).reduce((sum, node) => sum + triangles(node), 0);
    assert.ok(boss ? total <= 2400 : total >= 900 && total <= 1600, `${root.name}: ${total} triangles`);
    const { min, max } = bounds(parts(root));
    assert.ok(min[0] >= -.3 && max[0] <= .3, `${root.name} x ${min[0]} ${max[0]}`);
    assert.ok(min[1] >= -.25 && max[1] <= .26, `${root.name} y ${min[1]} ${max[1]}`);
    assert.ok(min[2] >= -.32 && max[2] <= .26, `${root.name} z ${min[2]} ${max[2]}`);
    if (!boss) assert.ok(max[1] <= crawlerTop, `${root.name} top ${max[1]} fits a crawler`);
    // zombie-variety.test.mjs bounds for a walker skull (head group at 1.68 m).
    const skin = bounds([child(root, 'Skin')]);
    assert.ok(skin.min[1] <= -.17, `${root.name} skin reaches the head-shot line`);
    assert.ok(skin.max[1] >= .11 && skin.max[1] <= .24, `${root.name} skin top ${skin.max[1]}`);
  }
});

test('revenants: grey skin multiplier, true-colour detail, eyes looking down -Z', { skip }, () => {
  for (const root of roots) {
    const skin = read(primitive(child(root, 'Skin')).attributes.COLOR_0, Float32Array);
    for (let index = 0; index < skin.length; index += 3) {
      assert.ok(Math.abs(skin[index] - skin[index + 1]) < 1e-6 && Math.abs(skin[index] - skin[index + 2]) < 1e-6, `${root.name} skin colour is grey`);
    }
    const detail = read(primitive(child(root, 'Detail')).attributes.COLOR_0, Float32Array);
    let tinted = 0;
    for (let index = 0; index < detail.length; index += 3) if (Math.abs(detail[index] - detail[index + 2]) > .02) tinted++;
    assert.ok(tinted > 0, `${root.name} detail carries true colours`);
    const eyes = bounds([child(root, 'Eyes')]);
    assert.ok((eyes.min[2] + eyes.max[2]) / 2 < -.12, `${root.name} eyes sit on the face, toward -Z`);
    assert.ok(eyes.min[1] > -.04 && eyes.max[1] < .06, `${root.name} eye height`);
  }
  const material = json.materials.find(entry => entry.name === 'skin');
  assert.equal(material.pbrMetallicRoughness.baseColorTexture, undefined);
});

test('revenants: three r180 loads the file and the metrics report matches it', { skip }, async () => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
  const report = JSON.parse(readFileSync(new URL('revenants_heads.json', folder), 'utf8'));
  for (const root of roots) {
    const group = gltf.scene.getObjectByName(root.name);
    assert.ok(group, root.name);
    const skin = group.getObjectByName(`${root.name}_Skin`);
    assert.ok(skin.isMesh && skin.material.vertexColors && skin.geometry.attributes.color.itemSize === 3, 'RGB colours, no alpha program');
    const box = new THREE.Box3().setFromObject(group.getObjectByName(`${root.name}_Eyes`));
    assert.ok(box.getCenter(new THREE.Vector3()).z < 0);
    const metrics = report.heads[root.name];
    assert.equal(metrics.triangles, parts(root).reduce((sum, node) => sum + triangles(node), 0), `${root.name} report is current`);
  }
  assert.equal(report.files['revenants_heads.glb'], bytes.length, 'the report was written with this GLB');
});

// Geometry of one mesh node: positions and triangles (index type as stored).
const TYPES = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array };
const geometry = node => {
  const prim = primitive(node), P = read(prim.attributes.POSITION, Float32Array), I = read(prim.indices, TYPES[json.accessors[prim.indices].componentType]);
  const V = [], T = [];
  for (let i = 0; i < P.length; i += 3) V.push([P[i], P[i + 1], P[i + 2]]);
  for (let i = 0; i < I.length; i += 3) T.push([V[I[i]], V[I[i + 1]], V[I[i + 2]]]);
  return { T, colors: prim.attributes.COLOR_0 === undefined ? null : read(prim.attributes.COLOR_0, Float32Array), indices: I };
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const hit = (o, d, [a, b, c]) => { // Moller-Trumbore distance, or Infinity
  const e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
  if (Math.abs(det) < 1e-14) return Infinity;
  const s = sub(o, a), u = dot(s, h) / det, q = cross(s, e1), v = dot(d, q) / det, t = dot(e2, q) / det;
  return u < 0 || v < 0 || u + v > 1 || t <= 1e-7 ? Infinity : t;
};
// Glow beads: groups of _Eyes triangles that touch (welded by position).
const beads = triangles => {
  const key = v => v.map(x => Math.round(x * 1e5)).join(), owner = new Map(), groups = [];
  for (const tri of triangles) {
    const found = [...new Set(tri.map(v => owner.get(key(v))).filter(g => g))];
    const group = found[0] ?? [];
    if (!found.length) groups.push(group);
    for (const other of found.slice(1)) { group.push(...other); groups.splice(groups.indexOf(other), 1); for (const t of other) for (const v of t) owner.set(key(v), group); }
    group.push(tri);
    for (const v of tri) owner.set(key(v), group);
  }
  return groups;
};

test('revenants: single-sided materials, the game draws FrontSide', { skip }, () => {
  for (const material of json.materials) assert.notEqual(material.doubleSided, true, material.name);
});

test('revenants: two glow points per head, each at least 75% visible from 6 m ahead', { skip }, () => {
  const camera = [0, -.05, -6]; // the player's eye a little below the head centre, straight ahead
  for (const root of roots) {
    const eyes = beads(geometry(child(root, 'Eyes')).T);
    assert.ok(eyes.length >= 2, `${root.name}: ${eyes.length} glow points`);
    const blockers = [...geometry(child(root, 'Skin')).T, ...geometry(child(root, 'Detail')).T];
    for (const bead of eyes) {
      const xs = bead.flat().map(v => v[0]), ys = bead.flat().map(v => v[1]), front = Math.min(...bead.flat().map(v => v[2]));
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      let seen = 0, shown = 0;
      for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
        const target = [x0 + (x1 - x0) * (i + .5) / 12, y0 + (y1 - y0) * (j + .5) / 12, front];
        const d = sub(target, camera), l = Math.hypot(...d), dir = d.map(x => x / l);
        const near = Math.min(...bead.map(t => hit(camera, dir, t)));
        if (near === Infinity) continue;
        seen++;
        if (!blockers.some(t => hit(camera, dir, t) < near - 1e-6)) shown++;
      }
      assert.ok(seen > 20 && shown / seen >= .75, `${root.name} bead at x ${((x0 + x1) / 2).toFixed(3)}: ${(100 * shown / seen).toFixed(0)}% visible`);
    }
  }
});

test('revenants: no skin face turns toward the head centre (no folds lost to back-face culling)', { skip }, () => {
  const report = JSON.parse(readFileSync(new URL('revenants_heads.json', folder), 'utf8'));
  for (const root of roots) {
    const center = report.heads[root.name].center;
    const inward = geometry(child(root, 'Skin')).T.filter(([a, b, c]) => dot(cross(sub(b, a), sub(c, a)), sub([0, 1, 2].map(k => (a[k] + b[k] + c[k]) / 3), center)) <= 0);
    assert.equal(inward.length, 0, `${root.name}: ${inward.length} inward skin faces`);
  }
});

test('revenants: pixel blood comes in square tiles of 1.5 to 2 cm', { skip }, () => {
  let tiles = 0;
  for (const root of roots) {
    const { T, colors, indices } = geometry(child(root, 'Detail'));
    T.forEach((tri, k) => {
      const [r, g, b] = [0, 1, 2].map(c => colors[indices[k * 3] * 3 + c]);
      const edges = [[0, 1], [1, 2], [2, 0]].map(([p, q]) => Math.hypot(...sub(tri[p], tri[q]))).sort((x, y) => x - y);
      if (!(r > .02 && r > 6 * g && r > 6 * b) || edges[0] < .012) return; // blood red; skip the low tile walls
      tiles += .5;
      assert.ok(edges[0] >= .015 && edges[1] <= .02 && Math.abs(edges[0] - edges[1]) < .001 && Math.abs(edges[2] - Math.SQRT2 * edges[1]) < .002,
        `${root.name} blood tile half ${edges.map(e => (e * 1000).toFixed(1)).join('/')} mm`);
    });
  }
  assert.ok(tiles >= 12, `${tiles} tiles`);
});
