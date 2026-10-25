import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWorld } = await importPublicModule('world.js');

function withCanvas(run) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const calls = [];
      const context = new Proxy({
        calls,
        measureText(value) { return { width: value.length * Number.parseInt(this.font?.match(/\d+/)?.[0] ?? 42) * .6 }; },
        fillText(value) { calls.push(value); },
      }, { get: (object, key) => key in object ? object[key] : () => {} });
      return { width: 0, height: 0, getContext: () => context };
    },
  };
  try { run(); } finally { globalThis.document = previous; }
}

const effectivelyVisible = node => { for (let current = node; current; current = current.parent) if (!current.visible) return false; return true; };
const visibleMeshes = root => {
  const meshes = [];
  root.traverse(node => { if (node.isMesh && effectivelyVisible(node)) meshes.push(node); });
  return meshes;
};
const triangleCount = mesh => {
  const { geometry } = mesh;
  const triangles = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
  return mesh.isInstancedMesh ? triangles * mesh.count : triangles;
};
// Module-cached materials are shared between both builds; the few per-world
// materials (signs, gauges, halos) are fingerprinted by their construction.
const materialKey = material => [material.type, material.color?.getHex(), material.emissive?.getHex(),
  material.metalness, material.roughness, Boolean(material.map), material.transparent, material.opacity,
  material.side, material.vertexColors].join('|');
const trianglesByMaterial = root => {
  const totals = new Map();
  for (const mesh of visibleMeshes(root)) {
    const key = materialKey(mesh.material);
    totals.set(key, (totals.get(key) ?? 0) + triangleCount(mesh));
  }
  return totals;
};
const worldBounds = root => {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), item = new THREE.Box3(), matrix = new THREE.Matrix4();
  for (const mesh of visibleMeshes(root)) {
    const { geometry } = mesh;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (mesh.isInstancedMesh) {
      for (let index = 0; index < mesh.count; index++) {
        mesh.getMatrixAt(index, matrix); matrix.premultiply(mesh.matrixWorld);
        box.union(item.copy(geometry.boundingBox).applyMatrix4(matrix));
      }
    } else box.union(item.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
  }
  return box;
};
const doorStates = world => {
  const states = {};
  for (const [id, door] of world.doors) {
    const { boards, seal, frame, openingSections, shelterSign } = door.userData;
    states[id] = { boards: boards.map(board => board.visible), seal: seal.visible, frame: frame.visible,
      sections: openingSections.map(section => section.visible), shelterSign: shelterSign?.visible };
  }
  return states;
};
const signLabels = world => {
  const labels = [];
  world.root.traverse(node => { if (typeof node.userData.setLabel === 'function') labels.push(node.userData.label); });
  return labels.sort();
};

test('merging drops the visible mesh count by at least 60%, instanced meshes counting as one', () => withCanvas(() => {
  const merged = createWorld(new THREE.Scene()), plain = createWorld(new THREE.Scene(), { mergeStatic: false });
  // The already-instanced ground decor is identical in both builds; the drop
  // is measured on the static cabin and forest it is meant to merge.
  const decor = world => new Set(world.root.getObjectByName('groundDecor')?.children ?? []);
  const plainDecor = decor(plain), mergedDecor = decor(merged);
  const before = visibleMeshes(plain.root).filter(mesh => !plainDecor.has(mesh)).length;
  const after = visibleMeshes(merged.root).filter(mesh => !mergedDecor.has(mesh)).length;
  assert.equal(plainDecor.size, mergedDecor.size);
  console.log(`visible meshes under root: ${before} plain -> ${after} merged (${(100 * (1 - after / before)).toFixed(1)}% fewer)`);
  // 60.2% before the redundant floor seams were removed from both builds.
  assert.ok(after <= before * .42, `expected at least a 58% drop, got ${before} -> ${after}`);
  const staticMerged = visibleMeshes(merged.root).filter(mesh => mesh.userData.staticMerge);
  assert.ok(staticMerged.length > 0);
  for (const mesh of staticMerged) {
    assert.ok(mesh.name.startsWith('staticMerge-'));
    assert.equal(mesh.matrixAutoUpdate, false);
    let attached = false;
    for (let node = mesh; node; node = node.parent) if (node === merged.root) { attached = true; break; }
    assert.ok(attached, 'merged meshes stay under root, zone merges inside their named group');
  }
  const forest = { forestTrunks: 64, forestNeedles: 128, forestTips: 64, forestRocks: 30 };
  for (const [name, count] of Object.entries(forest)) {
    const mesh = merged.root.getObjectByName(name);
    assert.ok(mesh?.isInstancedMesh, `${name} is one InstancedMesh`);
    assert.equal(mesh.count, count);
  }
}));

test('every material keeps the exact same triangle total as the unmerged build', () => withCanvas(() => {
  const merged = createWorld(new THREE.Scene()), plain = createWorld(new THREE.Scene(), { mergeStatic: false });
  assert.deepEqual(trianglesByMaterial(merged.root), trianglesByMaterial(plain.root));
}));

test('the world-space bounds of all visible geometry match within 1e-4', () => withCanvas(() => {
  const merged = createWorld(new THREE.Scene()), plain = createWorld(new THREE.Scene(), { mergeStatic: false });
  const a = worldBounds(merged.root), b = worldBounds(plain.root);
  for (const side of ['min', 'max']) for (const axis of ['x', 'y', 'z'])
    assert.ok(Math.abs(a[side][axis] - b[side][axis]) < 1e-4, `${side}.${axis}: ${a[side][axis]} vs ${b[side][axis]}`);
}));

test('rayBlockers keep their exact geometry, placement and attachment', () => withCanvas(() => {
  const merged = createWorld(new THREE.Scene()), plain = createWorld(new THREE.Scene(), { mergeStatic: false });
  assert.equal(merged.rayBlockers.length, plain.rayBlockers.length);
  merged.rayBlockers.forEach((mesh, index) => {
    const other = plain.rayBlockers[index];
    if (mesh.geometry.parameters) assert.deepEqual(mesh.geometry.parameters, other.geometry.parameters);
    else assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), Array.from(other.geometry.attributes.position.array));
    assert.deepEqual(mesh.position.toArray(), other.position.toArray());
    assert.deepEqual(mesh.quaternion.toArray(), other.quaternion.toArray());
    assert.deepEqual(mesh.scale.toArray(), other.scale.toArray());
    let attached = false;
    for (let node = mesh; node; node = node.parent) if (node === merged.root) { attached = true; break; }
    assert.ok(attached, 'still attached under root');
  });
}));

test('doors still toggle and signs still relabel exactly as on the plain build', () => withCanvas(() => {
  const merged = createWorld(new THREE.Scene()), plain = createWorld(new THREE.Scene(), { mergeStatic: false });
  for (const pattern of [[1, [60, 60, 60, 60, 60], true], [.4, [60, 0, 60, 0, 0], false], [0, [0, 0, 0, 0, 0], false]]) {
    for (const id of merged.doors.keys()) { merged.setDoor(id, ...pattern); plain.setDoor(id, ...pattern); }
    assert.deepEqual(doorStates(merged), doorStates(plain));
  }
  for (const language of ['en', 'fr']) {
    merged.setLanguage(language); plain.setLanguage(language);
    assert.deepEqual(signLabels(merged), signLabels(plain));
  }
  const camera = new THREE.PerspectiveCamera();
  const snapshot = { wave: 3, players: [], magnumAvailable: true, spawnWarnings: [{ x: 12, z: -9 }],
    expedition: { enabled: true, generator: { power: .8, active: true }, fuel: null }, supplyCrate: null, radar: null };
  assert.doesNotThrow(() => merged.update(1.25, { snapshot, myId: 'me', active: true, camera }));
  assert.doesNotThrow(() => plain.update(1.25, { snapshot, myId: 'me', active: true, camera }));
}));

test('every named node of the plain build still exists by name after merging', () => withCanvas(() => {
  const merged = createWorld(new THREE.Scene()), plain = createWorld(new THREE.Scene(), { mergeStatic: false });
  const names = root => {
    const counts = new Map();
    root.traverse(node => { if (node.name && !node.userData.staticMerge) counts.set(node.name, (counts.get(node.name) ?? 0) + 1); });
    return counts;
  };
  const before = names(plain.root), after = names(merged.root);
  for (const [name, count] of before) assert.equal(after.get(name), count, name);
}));
