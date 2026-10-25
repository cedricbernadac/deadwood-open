import * as THREE from '/vendor/three.module.js';
import { EXTERIOR, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, FUEL_CACHES } from './rules.js';
import { SUPPLY_CACHES } from './expedition.js';
import { createGroundDecor } from './ground-decor.js';

// The supermarket's night outdoors, in the cabin's visual language: grass
// around the Blender parking, trails to the far arrivals and fuel caches, a
// forest kept outside the walkable clearing (nothing solid stands where a
// survivor or a zombie can walk) and walk-through ground decor. The GLB owns
// the asphalt apron, so the grass is a frame around it and never crosses the
// stairwells. Everything here is flat or outside the bounds: no collisions.
export const PARKING = Object.freeze({ minX: -35, maxX: 35, minZ: -31, maxZ: 31 });
// A flush 4 cm curb: it reads as an edge, never as a step anyone walks through.
const CURB = { width: .3, height: .04 };

const segmentDistance = (x, z, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
  const t = length > 0 ? THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / length, 0, 1) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};
// Trails leave the parking edge on the side of their destination.
export const fuelTrailStart = cache => ({ x: Math.sign(cache.x) * PARKING.maxX, z: THREE.MathUtils.clamp(cache.z * .5, PARKING.minZ + 4, PARKING.maxZ - 4) });
export const approachStart = end => ({ x: Math.sign(end.x) * PARKING.maxX, z: THREE.MathUtils.clamp(end.z * .4, PARKING.minZ + 6, PARKING.maxZ - 6) });

export function supermarketDecorAllowed(x, z) {
  const bounds = EXTERIOR.bounds;
  if (x < bounds.minX + 1 || x > bounds.maxX - 1 || z < bounds.minZ + 1 || z > bounds.maxZ - 1) return false;
  if (x > PARKING.minX - 1.2 && x < PARKING.maxX + 1.2 && z > PARKING.minZ - 1.2 && z < PARKING.maxZ + 1.2) return false;
  for (const cache of FUEL_CACHES) {
    const start = fuelTrailStart(cache);
    if (Math.hypot(x - cache.x, z - cache.z) < 3.2 || segmentDistance(x, z, start.x, start.z, cache.x, cache.z) < 1.5) return false;
  }
  for (const end of FAR_SPAWN_ENTRIES) {
    const start = approachStart(end);
    if (segmentDistance(x, z, start.x, start.z, end.x, end.z) < 4.9) return false;
  }
  for (const entry of SPAWN_ENTRIES) if (Math.hypot(x - entry.x, z - entry.z) < 1.7) return false;
  for (const cache of SUPPLY_CACHES) if (Math.hypot(x - cache.x, z - cache.z) < 2.3) return false;
  return true;
}

export function createSupermarketOutdoors(scene, root, { quality = {}, grassTexture, repeatedTexture, createNightSky } = {}) {
  const group = new THREE.Group(); group.name = 'supermarketOutdoors'; root.add(group);
  const flat = (name, material, x, z, w, d, y = -.016, h = .02) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.receiveShadow = true; mesh.name = name; group.add(mesh); return mesh;
  };
  // Grass frame: four slabs around the asphalt, reaching past the clearing.
  const bounds = EXTERIOR.bounds, margin = 60;
  const outer = { minX: bounds.minX - margin, maxX: bounds.maxX + margin, minZ: bounds.minZ - margin, maxZ: bounds.maxZ + margin };
  const grassMaterial = (w, d) => new THREE.MeshStandardMaterial({ color: 0xb4c4b8, roughness: .99,
    ...(grassTexture ? { map: repeatedTexture ? repeatedTexture(grassTexture(), w / 3.2, d / 3.2) : grassTexture() } : {}) });
  for (const [name, a, b, c, d] of [
    ['grass-north', outer.minX, outer.maxX, outer.minZ, PARKING.minZ], ['grass-south', outer.minX, outer.maxX, PARKING.maxZ, outer.maxZ],
    ['grass-west', outer.minX, PARKING.minX, PARKING.minZ, PARKING.maxZ], ['grass-east', PARKING.maxX, outer.maxX, PARKING.minZ, PARKING.maxZ]]) {
    flat(name, grassMaterial(b - a, d - c), (a + b) / 2, (c + d) / 2, b - a, d - c);
  }
  // A worn concrete curb finishes the parking edge, open wherever a trail or
  // an approach lane leaves it: each cut spans the lane's full crossing width.
  const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x8d918c, roughness: .95 });
  const gaps = [];
  const crossing = (start, end, width) => {
    const length = Math.hypot(end.x - start.x, end.z - start.z) || 1, along = Math.abs(end.x - start.x) / length;
    gaps.push({ ...start, half: width / 2 / Math.max(.2, along) + .6 });
  };
  for (const cache of FUEL_CACHES) crossing(fuelTrailStart(cache), cache, 2);
  for (const end of FAR_SPAWN_ENTRIES) crossing(approachStart(end), end, 8.8);
  const curbRun = (axis, fixed, from, to) => {
    const cuts = gaps.filter(gap => axis === 'x' ? Math.abs(gap.z - fixed) < .5 : Math.abs(gap.x - fixed) < .5)
      .map(gap => ({ at: axis === 'x' ? gap.x : gap.z, half: gap.half })).sort((p, q) => p.at - q.at);
    let start = from;
    for (const cut of [...cuts, { at: Infinity, half: 0 }]) {
      const end = Math.min(cut.at - cut.half, to);
      if (end - start > .4) axis === 'x'
        ? flat('parking-curb', curbMaterial, (start + end) / 2, fixed, end - start, CURB.width, CURB.height / 2 - .005, CURB.height)
        : flat('parking-curb', curbMaterial, fixed, (start + end) / 2, CURB.width, end - start, CURB.height / 2 - .005, CURB.height);
      start = cut.at + cut.half; if (start >= to) break;
    }
  };
  curbRun('x', PARKING.minZ, PARKING.minX, PARKING.maxX); curbRun('x', PARKING.maxZ, PARKING.minX, PARKING.maxX);
  curbRun('z', PARKING.minX, PARKING.minZ, PARKING.maxZ); curbRun('z', PARKING.maxX, PARKING.minZ, PARKING.maxZ);
  // Beaten-earth trails, the same tone as the cabin's escape trails.
  const trail = new THREE.MeshStandardMaterial({ color: 0x55503c, roughness: .99 }), runoff = new THREE.MeshStandardMaterial({ color: 0x323e35, roughness: .99 });
  const path = (name, a, b, width) => {
    const mesh = flat(name, trail, (a.x + b.x) / 2, (a.z + b.z) / 2, width, Math.hypot(b.x - a.x, b.z - a.z) + 1, -.002, .007);
    mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); return mesh;
  };
  for (const cache of FUEL_CACHES) path('fuel-cache-trail', fuelTrailStart(cache), cache, 2);
  for (const end of FAR_SPAWN_ENTRIES) {
    const approach = path(end.x < 0 ? 'westDistantClearing' : 'eastDistantClearing', approachStart(end), end, 8.8);
    for (const offset of [-2.6, 2.6]) {
      const rut = new THREE.Mesh(new THREE.BoxGeometry(.34, .008, approach.geometry.parameters.depth - 1), runoff);
      rut.position.set(offset, .005, 0); rut.name = 'distantTrailRut'; approach.add(rut);
    }
  }
  // Forest: instanced firs and rocks pushed just outside the walkable clearing,
  // denser opposite the shop front so the parking reads as cut into the woods.
  let seed = 7311; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const trees = quality.id === 'low' ? 90 : 150, rocks = quality.id === 'low' ? 24 : 40;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.14, .34, 1, 6), new THREE.MeshStandardMaterial({ color: 0x302c27, roughness: .9 }), trees);
  const needles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0, 1, 1, 7), new THREE.MeshStandardMaterial({ color: 0x153b32, roughness: .9 }), trees * 2);
  const tips = new THREE.InstancedMesh(new THREE.CylinderGeometry(0, 1, 1, 7), new THREE.MeshStandardMaterial({ color: 0x245046, roughness: .9 }), trees);
  const stones = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x41504d, roughness: .9 }), rocks);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), turn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const edgePoint = (inset, depth) => {
    // A point on a band just outside the clearing's rectangle.
    const width = bounds.maxX - bounds.minX + inset * 2, height = bounds.maxZ - bounds.minZ + inset * 2, perimeter = 2 * (width + height);
    let along = random() * perimeter, x, z;
    if (along < width) { x = bounds.minX - inset + along; z = bounds.minZ - inset; }
    else if ((along -= width) < height) { x = bounds.maxX + inset; z = bounds.minZ - inset + along; }
    else if ((along -= height) < width) { x = bounds.maxX + inset - along; z = bounds.maxZ + inset; }
    else { along -= width; x = bounds.minX - inset; z = bounds.maxZ + inset - along; }
    const outward = depth * random(), nx = Math.abs(x) >= bounds.maxX + inset - 1e-6 ? Math.sign(x) : 0, nz = nx ? 0 : Math.sign(z);
    return [x + nx * outward, z + nz * outward];
  };
  let needle = 0;
  for (let index = 0; index < trees; index++) {
    const [x, z] = edgePoint(2.5, 16), h = 7 + random() * 8, girth = .85 + random() * .5;
    turn.setFromAxisAngle(up, random() * Math.PI * 2);
    position.set(x, h / 2 - .7, z); scale.set(girth, h, girth); trunks.setMatrixAt(index, matrix.compose(position, turn, scale));
    for (let tier = 0; tier < 3; tier++) {
      position.set(x, h * .48 + tier * h * .15, z); scale.set((2.1 - tier * .38) * girth, h * .5, (2.1 - tier * .38) * girth);
      matrix.compose(position, turn, scale);
      if (tier === 2) tips.setMatrixAt(index, matrix); else needles.setMatrixAt(needle++, matrix);
    }
  }
  for (let index = 0; index < rocks; index++) {
    const [x, z] = edgePoint(1, 6), size = .25 + random() * .6;
    turn.setFromAxisAngle(up, random() * Math.PI * 2);
    position.set(x, .07, z); scale.set(size * 1.5, size * .7, size); stones.setMatrixAt(index, matrix.compose(position, turn, scale));
  }
  for (const [name, mesh] of Object.entries({ forestTrunks: trunks, forestNeedles: needles, forestTips: tips, forestRocks: stones })) {
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = mesh !== stones;
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
  }
  const decor = createGroundDecor({ density: quality.groundDetail ?? .7, allowed: supermarketDecorAllowed, spread: 1.7 });
  group.add(decor);
  const sky = createNightSky ? createNightSky() : null;
  if (sky) scene.add(sky);
  return { group, sky, decor };
}
