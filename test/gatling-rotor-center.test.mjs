import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { applyWeaponViewPose } from '../public/weapon-view.js';
import { MINIGUN_TIMING, minigunRotorSpeed } from '../public/minigun.js';
import { GROUND_WEAPON_BOUNDS } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const world = await importPublicModule('world.js');
const vec = (...values) => new THREE.Vector3(...values);
const center = mesh => {
  mesh.geometry.computeBoundingBox();
  return mesh.localToWorld(mesh.geometry.boundingBox.getCenter(new THREE.Vector3()));
};
const near = (actual, expected, message) => assert.ok(actual.distanceTo(expected) < 1e-10, `${message}: ${actual.toArray()} vs ${expected.toArray()}`);

function representation(kind) {
  if (kind === 'first-person') {
    const root = new THREE.PerspectiveCamera(), gun = world.createWeapon('minigun');
    root.position.set(2, 4.95, -3); root.rotation.set(.2, 1.1, 0, 'YXZ'); root.add(gun);
    applyWeaponViewPose(gun, { moving: true, time: .5, bob: .028, recoil: .025 });
    return { root, gun };
  }
  if (kind === 'teammate') {
    const root = world.createSurvivor(); world.setSurvivorWeapon(root, 'minigun');
    root.position.set(-2, 0, 4); root.rotation.y = -.7;
    for (let frame = 0; frame < 30; frame++) world.animateSurvivor(root, { pitch: .3, delta: 1 / 60 });
    return { root, gun: root.userData.gun };
  }
  const root = kind === 'rack' ? world.createArmoryRack('minigun') : world.createGroundWeapon('minigun');
  root.position.set(3, kind === 'rack' ? 3.4 : 0, -2); root.rotation.y = .8;
  return { root, gun: root.getObjectByName(`${kind === 'rack' ? 'rack' : 'ground'}Weapon-minigun`) };
}

for (const kind of ['first-person', 'teammate', 'rack', 'ground']) test(`${kind} Gatling keeps its six barrels and collars centered through a full turn`, () => {
  const { root, gun } = representation(kind), rotor = gun.getObjectByName('minigunRotor');
  const barrels = Array.from({ length: 6 }, (_, index) => rotor.getObjectByName(`minigunBarrel-${index + 1}`));
  const collars = [1, 2].map(index => rotor.getObjectByName(`minigunCollar-${index}`));
  assert.ok(barrels.every(Boolean)); assert.ok(collars.every(Boolean)); assert.equal(rotor.children.length, 8);
  root.updateMatrixWorld(true);
  const scale = gun.getWorldScale(new THREE.Vector3());
  assert.ok(Math.abs(scale.x - scale.y) < 1e-12 && Math.abs(scale.y - scale.z) < 1e-12, 'the physical weapon uses uniform scale');
  const ringCenters = [-.35, -.76].map(z => gun.localToWorld(vec(0, .012, z)));
  const assemblyCenter = gun.localToWorld(vec(0, .012, -.585));
  const radius = .075 * scale.x, originalGunPosition = gun.position.clone(), originalGunRotation = gun.quaternion.clone();
  const rest = barrels.map(barrel => center(barrel));
  for (let step = 0; step <= 48; step++) {
    rotor.rotation.z = step * Math.PI * 2 / 48; root.updateMatrixWorld(true);
    collars.forEach((collar, index) => near(center(collar), ringCenters[index], `${kind}: collar ${index} never orbits`));
    const positions = barrels.map(barrel => center(barrel));
    const centroid = positions.reduce((sum, value) => sum.add(value), new THREE.Vector3()).divideScalar(6);
    near(centroid, assemblyCenter, `${kind}: all six barrel centers share the fixed axis`);
    positions.forEach((position, index) => {
      assert.ok(Math.abs(position.distanceTo(assemblyCenter) - radius) < 1e-10, `${kind}: barrel ${index} keeps its 75 mm ring radius`);
      assert.ok(Math.abs(position.distanceTo(positions[(index + 1) % 6]) - radius) < 1e-10, `${kind}: six barrels retain equal spacing`);
      if (step === 48) near(position, rest[index], `${kind}: barrel ${index} returns after a full turn`);
    });
    assert.deepEqual(gun.position, originalGunPosition); assert.ok(gun.quaternion.angleTo(originalGunRotation) < 1e-7, 'spinning does not tilt the whole weapon');
  }
});

test('centering the Gatling pivot preserves the original rest geometry, muzzle and ground envelope', () => {
  const gun = world.createWeapon('minigun'), rotor = gun.userData.rotor;
  gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0); gun.updateMatrixWorld(true);
  near(gun.userData.barrel.getWorldPosition(new THREE.Vector3()), vec(0, .012, -.585), 'the static central barrel remains on the same axis');
  near(gun.userData.muzzle, vec(0, .012, -.94), 'the firing presentation keeps its original muzzle');
  for (let index = 0; index < 6; index++) {
    const barrel = rotor.getObjectByName(`minigunBarrel-${index + 1}`), angle = index * Math.PI * 2 / 6;
    near(center(barrel), vec(Math.cos(angle) * .075, .012 + Math.sin(angle) * .075, -.585), `rest barrel ${index}`);
    assert.equal(barrel.geometry.parameters.radiusTop, .024); assert.equal(barrel.geometry.parameters.radiusBottom, .024);
    assert.equal(barrel.geometry.parameters.height, .65);
  }
  for (const [index, z] of [-.35, -.76].entries()) {
    const collar = rotor.getObjectByName(`minigunCollar-${index + 1}`);
    near(center(collar), vec(0, .012, z), `rest collar ${index}`);
    assert.equal(collar.geometry.parameters.radiusTop, .115); assert.equal(collar.geometry.parameters.height, .065);
  }
  const ground = world.createGroundWeapon('minigun'); ground.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(ground.userData.model), envelope = GROUND_WEAPON_BOUNDS.minigun;
  assert.ok(Math.abs(bounds.min.y - envelope.floorOffset) < 1e-10);
  assert.ok(bounds.max.x <= envelope.halfWidth && bounds.max.z <= envelope.halfLength && bounds.max.y <= envelope.floorOffset + envelope.height);
  assert.ok(envelope.halfWidth - bounds.max.x < .001 && envelope.halfLength - bounds.max.z < .001 && envelope.floorOffset + envelope.height - bounds.max.y < .001);
});

test('teammate charge animation spins only the centered barrel assembly at the existing shared speed', () => {
  const { root, gun } = representation('teammate'), rotor = gun.userData.rotor;
  const collar = rotor.getObjectByName('minigunCollar-1'), axis = gun.localToWorld(vec(0, .012, -.35));
  for (const spinLeft of [MINIGUN_TIMING.windup, MINIGUN_TIMING.windup * .5, 0]) {
    const before = rotor.rotation.z;
    world.animateSurvivor(root, { pitch: .3, spinning: true, spinLeft, spinDuration: MINIGUN_TIMING.windup, delta: .05 }); root.updateMatrixWorld(true);
    assert.ok(Math.abs(rotor.rotation.z - before + .05 * minigunRotorSpeed({ spinning: true, spinLeft })) < 1e-12);
    near(center(collar), axis, 'the animated collar stays on the fixed axis');
  }
  for (const state of [{}, { spinning: true, reloading: true }, { spinning: true, downed: true }]) {
    const before = rotor.rotation.z; world.animateSurvivor(root, { ...state, delta: .05 });
    assert.equal(rotor.rotation.z, before, 'rest/reload/incapacity still stops the rotor');
  }
});
