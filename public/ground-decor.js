import * as THREE from '/vendor/three.module.js';
import { EXTERIOR, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, FUEL_CACHES } from './rules.js';
import { SUPPLY_CACHES } from './expedition.js';
import { PartBuilder } from './mesh-merge.js';

// Walk-through ground decor: grass tufts, pale flowers and storybook
// mushrooms, a few of them softly glowing near the woods. Nothing collides
// and nothing rises above GROUND_DECOR.maxHeight, so the server's flat
// clearing stays the truth for movement, zombies and bullets. Everything is
// instanced: six draw calls whatever the density.
export const GROUND_DECOR = Object.freeze({ maxHeight: .3, tufts: 2600, flowers: 700, mushrooms: 170, glowing: 28 });

const segmentDistance = (x, z, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
  const t = length > 0 ? THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / length, 0, 1) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};
// True where decor may grow: off the cabin, trails, entries and caches.
export function decorAllowed(x, z) {
  const bounds = EXTERIOR.bounds;
  if (x < bounds.minX + 1 || x > bounds.maxX - 1 || z < bounds.minZ + 1 || z > bounds.maxZ - 1) return false;
  if (Math.abs(x) < 9.8 && Math.abs(z) < 7.8) return false;
  if (Math.abs(x) < 11.6 && Math.abs(Math.abs(z) - 7.8) < 1.7) return false;
  if (Math.abs(z) < 9.6 && Math.abs(Math.abs(x) - 9.8) < 1.7) return false;
  for (const cache of FUEL_CACHES) {
    if (Math.hypot(x - cache.x, z - cache.z) < 3.2) return false;
    if (segmentDistance(x, z, Math.sign(cache.x) * 9.8, Math.sign(cache.z) * 7.8, cache.x, cache.z) < 1.5) return false;
  }
  for (const end of FAR_SPAWN_ENTRIES) {
    const side = Math.sign(end.x);
    if (segmentDistance(x, z, side * 9.8, -side * 3.5, end.x, end.z) < 4.9) return false;
  }
  for (const entry of SPAWN_ENTRIES) if (Math.hypot(x - entry.x, z - entry.z) < 1.7) return false;
  for (const cache of SUPPLY_CACHES) if (Math.hypot(x - cache.x, z - cache.z) < 2.3) return false;
  return true;
}

function tuftGeometry() {
  const tuft = new PartBuilder(), blade = new THREE.ConeGeometry(1, 1, 4);
  for (let index = 0; index < 6; index++) {
    const angle = index / 6 * Math.PI * 2 + index * .4, lean = .25 + (index % 3) * .12, height = .15 + (index % 4) * .03;
    tuft.add(blade, 0xffffff, { position: [Math.cos(angle) * .03, height / 2, Math.sin(angle) * .03],
      rotation: [Math.sin(angle) * lean, 0, -Math.cos(angle) * lean], scale: [.018, height, .018] });
  }
  const geometry = tuft.build(null).geometry, position = geometry.attributes.position, color = geometry.attributes.color;
  const base = new THREE.Color(0x253f33), tip = new THREE.Color(0x86b47d), mix = new THREE.Color();
  for (let index = 0; index < position.count; index++) {
    mix.copy(base).lerp(tip, THREE.MathUtils.clamp(position.getY(index) / .22, 0, 1));
    color.setXYZ(index, mix.r, mix.g, mix.b);
  }
  return geometry;
}

// allowed / spread let another map (the supermarket) grow it around its own
// footprint: the cabin keeps the defaults.
export function createGroundDecor({ density = 1, seed = 6113, allowed = decorAllowed, spread = 1 } = {}) {
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const group = new THREE.Group(); group.name = 'groundDecor';
  const amount = value => Math.max(0, Math.round(value * THREE.MathUtils.clamp(density, 0, 1)));
  // Denser near the cabin, where everyone looks, thinning out into the clearing.
  const place = (count, near, far, test = allowed) => {
    const spots = [];
    for (let attempt = 0; spots.length < count && attempt < count * 30; attempt++) {
      const angle = random() * Math.PI * 2, radius = (near + (far - near) * random() ** 1.7) * spread;
      const x = Math.cos(angle) * radius * 1.6, z = Math.sin(angle) * radius;
      if (test(x, z)) spots.push([x, z]);
    }
    return spots;
  };
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
  const instanced = (geometry, material, spots, name, pose) => {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, spots.length));
    // Receives the moon shadows on high quality, never casts.
    mesh.count = spots.length; mesh.name = name; mesh.castShadow = false; mesh.receiveShadow = true;
    spots.forEach(([x, z], index) => {
      const { scale, color } = pose(index);
      quaternion.setFromAxisAngle(up, random() * Math.PI * 2);
      matrix.compose(new THREE.Vector3(x, 0, z), quaternion, new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(index, matrix);
      if (color !== undefined) mesh.setColorAt(index, tint.set(color));
    });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); group.add(mesh);
    return mesh;
  };
  const lambert = extra => new THREE.MeshLambertMaterial({ vertexColors: true, ...extra });

  const tufts = place(amount(GROUND_DECOR.tufts), 9, 44);
  instanced(tuftGeometry(), lambert(), tufts, 'decorGrassTufts', () => ({ scale: .7 + random() * .42, color: tint.setHSL(.27 + random() * .08, .3, .74 + random() * .2).getHex() }));

  const flowerSpots = place(amount(GROUND_DECOR.flowers), 10, 34);
  // Tiny shapes need few triangles: open stalks, low-poly blooms and caps.
  const stem = new PartBuilder(), heads = new PartBuilder(), stalk = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true), bloom = new THREE.SphereGeometry(1, 5, 3);
  for (const [dx, dz, height] of [[0, 0, .15], [.05, .03, .12], [-.04, .04, .1]]) {
    stem.add(stalk, 0x3e6a48, { position: [dx, height / 2, dz], scale: [.006, height, .006] });
    heads.add(bloom, 0xffffff, { position: [dx, height + .01, dz], scale: [.028, .016, .028] });
  }
  const flowerPalette = [0xf4f0e4, 0xf3e3a0, 0xd9c8f2, 0xc1d8f6, 0xf2c6d6];
  const flowerScales = flowerSpots.map(() => .8 + random() * .45);
  instanced(stem.build(null).geometry, lambert(), flowerSpots, 'decorFlowerStems', index => ({ scale: flowerScales[index] }));
  instanced(heads.build(null).geometry, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x1a1a22 }), flowerSpots, 'decorFlowerHeads',
    index => ({ scale: flowerScales[index], color: flowerPalette[Math.floor(random() * flowerPalette.length)] }));

  // Mushrooms grow in little rings near the forest edge and around the cabin.
  const mushroomSpots = place(amount(GROUND_DECOR.mushrooms), 10, 46);
  const glowSpots = place(amount(GROUND_DECOR.glowing), 26, 48);
  const stems = new PartBuilder(), caps = new PartBuilder(), dome = new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), dot = new THREE.SphereGeometry(1, 4, 2);
  for (const [dx, dz, size] of [[0, 0, 1], [.09, .05, .7], [-.06, .08, .55]]) {
    stems.add(stalk, 0xece3cc, { position: [dx, .035 * size, dz], scale: [.016 * size, .07 * size, .016 * size] });
    caps.add(dome, 0xffffff, { position: [dx, .065 * size, dz], scale: [.045 * size, .035 * size, .045 * size] });
    for (const [ox, oz] of [[.018, 0], [-.012, .014]]) stems.add(dot, 0xfaf6ea, { position: [dx + ox * size, .065 * size + .028 * size, dz + oz * size], scale: [.008 * size, .005 * size, .008 * size] });
  }
  const all = [...mushroomSpots, ...glowSpots], mushroomScales = all.map(() => .8 + random() * .6);
  instanced(stems.build(null).geometry, lambert(), all, 'decorMushroomStems', index => ({ scale: mushroomScales[index] }));
  const capPalette = [0xc0473a, 0xd27a3a, 0x8a5a3c, 0xb8463f];
  instanced(caps.build(null).geometry, lambert(), mushroomSpots, 'decorMushroomCaps', index => ({ scale: mushroomScales[index], color: capPalette[Math.floor(random() * capPalette.length)] }));
  // A few caps glow sea-green: magical, a little uncanny, never a light source.
  instanced(caps.build(null).geometry, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), glowSpots, 'decorGlowingCaps',
    index => ({ scale: mushroomScales[mushroomSpots.length + index], color: index % 3 ? 0x6ff2d2 : 0x9fe9ff }));
  group.userData.counts = { tufts: tufts.length, flowers: flowerSpots.length, mushrooms: mushroomSpots.length, glowing: glowSpots.length };
  return group;
}
