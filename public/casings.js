import * as THREE from '/vendor/three.module.js';

// Every shot ejects a brass casing (or a red shotgun shell) that tumbles,
// bounces twice on the floor, lies there briefly and shrinks away. One
// pre-built InstancedMesh holds the whole pool and each trajectory is solved
// in closed form at eject time, so playing a casing never allocates and the
// picture at a given time never depends on the frame rate.
export const CASINGS = Object.freeze({ capacity: 128, life: 2.6, gravity: 9.8, restitution: .32, friction: .45, fade: .5, bounces: 2, restSpeed: .25 });
// Sizes in metres, 1.4 times real ones so they read on screen. `head` marks
// a two-tone shell: a brass base covering `fraction` of the length.
export const CASING_KINDS = Object.freeze({
  pistol:  Object.freeze({ length: .029, radius: .0073, color: 0xe0b050 }),
  rifle:   Object.freeze({ length: .062, radius: .0087, color: 0xe0b050 }),
  sniper:  Object.freeze({ length: .087, radius: .0104, color: 0xe0b050 }),
  minigun: Object.freeze({ length: .056, radius: .0084, color: 0xd29a3e }),
  shell:   Object.freeze({ length: .09, radius: .0147, color: 0xc8402e, head: Object.freeze({ fraction: .3, color: 0xe0b050 }) }),
});

const SEGMENTS = CASINGS.bounces + 1;

export function createCasingPool({ capacity = CASINGS.capacity, seed = 1337 } = {}) {
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a2a10 }), capacity * 2);
  mesh.name = 'ejectedCasings'; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0), color = new THREE.Color(0xffffff);
  for (let index = 0; index < capacity * 2; index++) { mesh.setMatrixAt(index, hidden); mesh.setColorAt(index, color); }
  // Per-slot ballistic arc, solved once at eject time: segment k starts at
  // segStart[k] from segPos with segVel and lands segHit[k] seconds later; the
  // arc always ends lying at the rest point from restTime on.
  const slots = Array.from({ length: capacity }, () => ({
    start: -Infinity, kind: CASING_KINDS.rifle, restY: 0, spin: new THREE.Vector3(), yaw: 0,
    segStart: new Float64Array(SEGMENTS), segPos: new Float64Array(SEGMENTS * 3), segVel: new Float64Array(SEGMENTS * 3), segHit: new Float64Array(SEGMENTS),
    segments: 0, restTime: Infinity, restX: 0, restZ: 0,
  }));
  let next = 0, active = false, visible = 0;
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), axis = new THREE.Vector3(), rotation = new THREE.Euler(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  const lieFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  return {
    mesh,
    eject(options = {}) {
      if (!options) return false;
      const { origin, velocity, time, kind = 'rifle', floor = 0, spin = null } = options;
      if (!origin || !velocity || !Number.isFinite(time)) return false;
      if (![origin.x, origin.y, origin.z, velocity.x, velocity.y, velocity.z].every(Number.isFinite)) return false;
      const shape = CASING_KINDS[kind] ?? CASING_KINDS.rifle, ground = Number.isFinite(floor) ? floor : 0;
      const index = next; next = (next + 1) % capacity;
      const slot = slots[index];
      slot.start = time; slot.kind = shape; slot.restY = ground + shape.radius;
      if (spin) slot.spin.set(spin.x, spin.y, spin.z);
      else slot.spin.set((random() - .5) * 30, (random() - .5) * 12, (random() - .5) * 30);
      slot.yaw = random() * Math.PI * 2;
      let px = origin.x, py = Math.max(origin.y, slot.restY), pz = origin.z, vx = velocity.x, vy = velocity.y, vz = velocity.z, start = time;
      for (let k = 0; k < SEGMENTS; k++) {
        slot.segStart[k] = start;
        slot.segPos[k * 3] = px; slot.segPos[k * 3 + 1] = py; slot.segPos[k * 3 + 2] = pz;
        slot.segVel[k * 3] = vx; slot.segVel[k * 3 + 1] = vy; slot.segVel[k * 3 + 2] = vz;
        const hit = (vy + Math.sqrt(Math.max(vy * vy + 2 * CASINGS.gravity * (py - slot.restY), 0))) / CASINGS.gravity;
        slot.segHit[k] = hit; slot.segments = k + 1;
        const bounce = (CASINGS.gravity * hit - vy) * CASINGS.restitution;
        slot.restTime = start + hit; slot.restX = px + vx * hit; slot.restZ = pz + vz * hit;
        if (k + 1 >= CASINGS.bounces || bounce < CASINGS.restSpeed) break;
        start = slot.restTime; px = slot.restX; py = slot.restY; pz = slot.restZ;
        vx *= CASINGS.friction; vy = bounce; vz *= CASINGS.friction;
      }
      mesh.setColorAt(index, color.setHex(shape.color));
      if (shape.head) mesh.setColorAt(capacity + index, color.setHex(shape.head.color));
      mesh.instanceColor.needsUpdate = true;
      active = true;
      return true;
    },
    update(time) {
      if (!active || !Number.isFinite(time)) return;
      active = false; visible = 0;
      for (let index = 0; index < capacity; index++) {
        const slot = slots[index], age = time - slot.start;
        // A casing scheduled for later keeps the pool awake until it flies.
        if (age < 0 && Number.isFinite(age)) active = true;
        if (age < 0 || age >= CASINGS.life) { mesh.setMatrixAt(index, hidden); mesh.setMatrixAt(capacity + index, hidden); continue; }
        active = true; visible++;
        const shape = slot.kind, resting = time >= slot.restTime;
        if (resting) position.set(slot.restX, slot.restY, slot.restZ);
        else {
          for (let k = 0; k < slot.segments; k++) {
            if (k < slot.segments - 1 && time >= slot.segStart[k] + slot.segHit[k]) continue;
            const tau = time - slot.segStart[k];
            position.set(
              slot.segPos[k * 3] + slot.segVel[k * 3] * tau,
              slot.segPos[k * 3 + 1] + slot.segVel[k * 3 + 1] * tau - .5 * CASINGS.gravity * tau * tau,
              slot.segPos[k * 3 + 2] + slot.segVel[k * 3 + 2] * tau);
            break;
          }
        }
        if (resting) quaternion.setFromAxisAngle(axis.set(0, 1, 0), slot.yaw).multiply(lieFlat);
        else quaternion.setFromEuler(rotation.set(slot.spin.x * age, slot.spin.y * age, slot.spin.z * age));
        const shrink = age < CASINGS.life - CASINGS.fade ? 1 : 1 - (1 - .001) * (age - (CASINGS.life - CASINGS.fade)) / CASINGS.fade;
        mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale.set(shape.radius * shrink, shape.length * shrink, shape.radius * shrink)));
        if (shape.head) {
          const headLength = shape.length * shape.head.fraction;
          // The brass head shrinks with the shell and pokes a hair below its base, so
          // the two end caps never share a plane.
          position.addScaledVector(axis.set(0, 1, 0).applyQuaternion(quaternion), (headLength / 2 - shape.length / 2 - .0008) * shrink);
          mesh.setMatrixAt(capacity + index, matrix.compose(position, quaternion, scale.set(shape.radius * 1.06 * shrink, headLength * shrink, shape.radius * 1.06 * shrink)));
        } else mesh.setMatrixAt(capacity + index, hidden);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    clear() {
      for (const slot of slots) slot.start = -Infinity;
      for (let index = 0; index < capacity * 2; index++) mesh.setMatrixAt(index, hidden);
      mesh.instanceMatrix.needsUpdate = true;
      active = false; visible = 0;
    },
    count() { return visible; },
  };
}
