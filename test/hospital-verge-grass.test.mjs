import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGlbTriangles } from '../validation/hospital-props-audit.mjs';
import { scanCoplanar } from '../validation/hospital-coplanarity.mjs';
import { importPublicModule } from './helpers/public-modules.mjs';

process.env.DEADWOOD_LEVEL = 'hospital';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GLB = `${ROOT}public/levels/hospital.glb`;
const GRASS = 'runtime-grass';
// Same decal materials the art verifier excludes from occluding: alpha decals
// and blended glass hide nothing in the visibility rays.
const DECALS = new Set(['Floor_grime_shop', 'Floor_grime_cellar', 'Prop_shadow', 'Lamp_pool', 'Lamp_pool_flicker']);

const blended = (() => {
  const bytes = readFileSync(GLB), jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  return new Set(json.materials.filter(material => material.alphaMode === 'BLEND').map(material => material.name));
})();

test('hospital runtime verge grass shares no coplanar face with the art GLB', async () => {
  const glbTriangles = loadGlbTriangles(GLB).map(t => ({ ...t, occluder: !DECALS.has(t.material) && !blended.has(t.material) }));

  // The real runtime build: the same module and call the game uses, no
  // duplicated rectangles. quality {} is the default high-quality path.
  const { createHospitalOutdoors } = await importPublicModule('hospital-outdoors.js');
  const scene = new THREE.Scene(), root = new THREE.Group();
  scene.add(root);
  const { group } = createHospitalOutdoors(scene, root, { quality: {} });
  scene.updateMatrixWorld(true);

  const grassMeshes = [];
  group.traverse(object => { if (object.isMesh && object.name.startsWith('grass-')) grassMeshes.push(object); });
  assert.equal(grassMeshes.length, 4, `the runtime builds four verge grass boxes: ${grassMeshes.map(mesh => mesh.name)}`);

  // Only the upward faces of the grass boxes z-fight with the GLB ground art.
  const grassTop = [];
  for (const mesh of grassMeshes) {
    const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.getIndex();
    const vertex = k => new THREE.Vector3().fromBufferAttribute(position, index.getX(k)).applyMatrix4(mesh.matrixWorld);
    for (let k = 0; k < index.count; k += 3) {
      const a = vertex(k), b = vertex(k + 1), c = vertex(k + 2);
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (normal.lengthSq() < 1e-18) continue;
      if (normal.normalize().y > .5) grassTop.push({ a: a.toArray(), b: b.toArray(), c: c.toArray(), material: GRASS, occluder: false });
    }
  }
  assert.ok(grassTop.length > 0, 'the grass boxes contribute top faces');
  const grassY = grassTop[0].a[1];
  assert.ok(grassTop.every(t => [t.a, t.b, t.c].every(p => Math.abs(p[1] - grassY) < 1e-6)), 'all grass top faces share one height');

  const started = Date.now();
  const spots = scanCoplanar([...glbTriangles, ...grassTop], { tolerance: .003, scan: t => !DECALS.has(t.material) });
  const grassSpots = spots.filter(spot => spot.materials.includes(GRASS));
  const visible = grassSpots.filter(spot => spot.visibleFraction >= .34);
  const areaM2 = grassSpots.reduce((sum, spot) => sum + spot.areaCm2, 0) / 1e4;
  const yRange = spots => spots.length ? [Math.min(...spots.map(spot => spot.lo[1])), Math.max(...spots.map(spot => spot.hi[1]))] : null;
  console.log(JSON.stringify({
    glbTriangles: glbTriangles.length, grassTopTriangles: grassTop.length, grassTopY: grassY,
    spotsScanned: spots.length, grassSpots: grassSpots.length, visibleGrassSpots: visible.length,
    grassOverlapM2: Number(areaM2.toFixed(1)), grassSpotYRange: yRange(grassSpots),
    materials: [...new Set(grassSpots.flatMap(spot => spot.materials))],
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  }));
  assert.equal(grassSpots.length, 0,
    `${grassSpots.length} coplanar spots (${areaM2.toFixed(1)} m2) between runtime grass and the GLB at y=${grassY}: `
    + JSON.stringify(grassSpots.slice(0, 10).map(({ triangles, ...spot }) => spot), null, 1));
});
