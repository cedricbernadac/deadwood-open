import assert from 'node:assert/strict';
import * as THREE from 'three';
import { importPublicModule } from '../helpers/public-modules.mjs';
import { SPACE } from '../../public/level-space.js';

const { createFunfairOutdoors, apronPieces, PARKING, WHEEL_CLEARING, inWheelClearing } = await importPublicModule('funfair-outdoors.js');
const overlaps = (a, b) => a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minZ < b.maxZ - 1e-6 && a.maxZ > b.minZ + 1e-6;
const area = r => (r.maxX - r.minX) * (r.maxZ - r.minZ);

assert.equal(SPACE.holes.length, 2, 'both funfair stairwell holes are in the contract');
const pieces = apronPieces(PARKING, SPACE.holes);
assert.ok(pieces.length > 0);
for (const piece of pieces) {
  assert.ok(piece.minX < piece.maxX && piece.minZ < piece.maxZ, `nonempty apron piece ${JSON.stringify(piece)}`);
  for (const hole of SPACE.holes) assert.ok(!overlaps(piece, hole), `apron piece ${JSON.stringify(piece)} covers a stairwell`);
}
const holeArea = SPACE.holes.reduce((sum, hole) => sum + area(hole), 0);
assert.ok(Math.abs(pieces.reduce((sum, piece) => sum + area(piece), 0) - (area(PARKING) - holeArea)) < 1e-6, 'the apron covers everything except the holes');

const scene = new THREE.Scene(), root = new THREE.Group();
createFunfairOutdoors(scene, root, { quality: { id: 'low', groundDetail: 0 } });
root.updateMatrixWorld(true);
const raycaster = new THREE.Raycaster(), meshes = [];
root.traverse(node => { if (node.isMesh) meshes.push(node); });
assert.ok(meshes.length > 0, 'the runtime outdoor module created geometry');
let probes = 0;
for (const hole of SPACE.holes) {
  for (const u of [.2, .5, .8]) for (const v of [.2, .5, .8]) {
    const x = hole.minX + (hole.maxX - hole.minX) * u, z = hole.minZ + (hole.maxZ - hole.minZ) * v;
    raycaster.set(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0));
    const lid = raycaster.intersectObjects(meshes, false).find(hit => hit.point.y > -.2);
    assert.equal(lid, undefined, `outdoor ground over the stairwell at (${x.toFixed(2)}, ${z.toFixed(2)}): ${lid?.object.name}`);
    probes++;
  }
}
for (const quality of [{ id: 'low', groundDetail: 0 }, { id: 'high', groundDetail: 0 }]) {
  const forest = new THREE.Group();
  createFunfairOutdoors(new THREE.Scene(), forest, { quality });
  let instances = 0;
  forest.traverse(node => {
    if (!node.isInstancedMesh || !/^forest/.test(node.name)) return;
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    for (let index = 0; index < node.count; index++) {
      node.getMatrixAt(index, matrix); position.setFromMatrixPosition(matrix); instances++;
      assert.ok(!inWheelClearing(position.x, position.z), `${quality.id} ${node.name} ${index} grows in the Ferris wheel clearing at (${position.x.toFixed(1)}, ${position.z.toFixed(1)})`);
    }
  });
  assert.ok(instances > 100, `${quality.id} forest instances were inspected (${instances})`);
}
assert.ok(WHEEL_CLEARING.minX < -36 && WHEEL_CLEARING.maxX > -16 && WHEEL_CLEARING.minZ < -72.9 && WHEEL_CLEARING.maxZ > -64, 'the clearing covers the wheel, its pad and its stairs');
console.log(`funfair stairwells open through the outdoor apron verified: ${probes} downward rays through both holes`);
