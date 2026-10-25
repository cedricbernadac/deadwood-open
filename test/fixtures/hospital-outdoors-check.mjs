import assert from 'node:assert/strict';
// The hospital's runtime asphalt apron runs under the whole building, just
// below its floor. Drawn as one slab it closed both stairwells like a grey
// lid: from the ground floor the flights were hidden under a flat plate, and
// from the basement it looked like a ceiling over the stairs. The apron is
// now cut around SPACE.holes. Run with DEADWOOD_LEVEL=hospital.
import * as THREE from 'three';
import { importPublicModule } from '../helpers/public-modules.mjs';
import { SPACE } from '../../public/level-space.js';

const { createHospitalOutdoors, apronPieces, PARKING } = await importPublicModule('hospital-outdoors.js');
const overlaps = (a, b) => a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minZ < b.maxZ - 1e-6 && a.maxZ > b.minZ + 1e-6;
const area = r => (r.maxX - r.minX) * (r.maxZ - r.minZ);

assert.ok(SPACE.holes.length >= 2, 'both stairwell holes are in the contract');
const pieces = apronPieces(PARKING, SPACE.holes);
for (const piece of pieces) for (const hole of SPACE.holes) assert.ok(!overlaps(piece, hole), `apron piece ${JSON.stringify(piece)} covers a stairwell`);
const holeArea = SPACE.holes.reduce((sum, hole) => sum + area(hole), 0);
assert.ok(Math.abs(pieces.reduce((sum, piece) => sum + area(piece), 0) - (area(PARKING) - holeArea)) < 1e-6, 'the apron still covers everything else');

const scene = new THREE.Scene(), root = new THREE.Group();
createHospitalOutdoors(scene, root, { quality: { id: 'low', groundDetail: 0 } });
root.updateMatrixWorld(true);
const raycaster = new THREE.Raycaster(), meshes = [];
root.traverse(node => { if (node.isMesh) meshes.push(node); });
for (const hole of SPACE.holes) {
  for (const [u, v] of [[.5, .5], [.2, .3], [.8, .7]]) {
    const x = hole.minX + (hole.maxX - hole.minX) * u, z = hole.minZ + (hole.maxZ - hole.minZ) * v;
    raycaster.set(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0));
    const lid = raycaster.intersectObjects(meshes, false).find(hit => hit.point.y > -.2);
    assert.equal(lid, undefined, `outdoor ground over the stairwell at (${x.toFixed(2)}, ${z.toFixed(2)}): ${lid?.object.name}`);
  }
}
console.log('hospital stairwells open through the outdoor apron verified');
