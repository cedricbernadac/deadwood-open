import * as THREE from '/vendor/three.module.js';

// Wood chips burst from a barricade plank the moment it breaks: a satisfying,
// harmless cue. One pre-built InstancedMesh holds every chip, so breaking a
// plank never creates scene nodes or GPU resources during play.
export const SPLINTERS = Object.freeze({ bursts: 6, chips: 9, duration: .7, gravity: 9 });

export function createSplinterPool({ seed = 811 } = {}) {
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const count = SPLINTERS.bursts * SPLINTERS.chips;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.11, .035, .025), new THREE.MeshLambertMaterial({ color: 0xc8955c }), count);
  mesh.name = 'barricadeSplinters'; mesh.frustumCulled = false; mesh.castShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let index = 0; index < count; index++) mesh.setMatrixAt(index, hidden);
  // Fixed per-chip launch velocities and spins, reused by every burst.
  const launches = Array.from({ length: count }, () => ({
    velocity: new THREE.Vector3((random() - .5) * 2.4, 1.2 + random() * 1.8, (random() - .5) * 2.4),
    spin: new THREE.Vector3(random() * 14, random() * 14, random() * 14), tint: .75 + random() * .35,
  }));
  const color = new THREE.Color();
  launches.forEach((launch, index) => mesh.setColorAt(index, color.setRGB(launch.tint, launch.tint * .92, launch.tint * .8)));
  const bursts = Array.from({ length: SPLINTERS.bursts }, () => ({ start: -Infinity, origin: new THREE.Vector3(), outward: new THREE.Vector3() }));
  let next = 0, active = false;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Euler(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  return {
    mesh,
    // `outward` points away from the cabin, where the plank is pulled.
    burst(origin, outward, time) {
      if (!Number.isFinite(time) || !origin) return;
      const burst = bursts[next]; next = (next + 1) % bursts.length;
      burst.start = time; burst.origin.copy(origin); burst.outward.copy(outward ?? position.set(0, 0, 0)).setY(0);
      if (burst.outward.lengthSq() > 1e-6) burst.outward.normalize();
      active = true;
    },
    update(time) {
      if (!active || !Number.isFinite(time)) return;
      active = false;
      bursts.forEach((burst, slot) => {
        const age = time - burst.start, live = age >= 0 && age < SPLINTERS.duration;
        if (live) active = true;
        for (let chip = 0; chip < SPLINTERS.chips; chip++) {
          const index = slot * SPLINTERS.chips + chip, launch = launches[index];
          if (!live) { mesh.setMatrixAt(index, hidden); continue; }
          position.copy(burst.origin).addScaledVector(launch.velocity, age).addScaledVector(burst.outward, age * 1.6);
          position.y -= .5 * SPLINTERS.gravity * age * age;
          rotation.set(launch.spin.x * age, launch.spin.y * age, launch.spin.z * age);
          const shrink = Math.max(.001, 1 - (age / SPLINTERS.duration) ** 3);
          mesh.setMatrixAt(index, matrix.compose(position, quaternion.setFromEuler(rotation), scale.setScalar(shrink)));
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
