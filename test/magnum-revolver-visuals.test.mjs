import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ARMORY_RACK, GROUND_WEAPON_BOUNDS } from '../public/rules.js';
import { applyWeaponViewPose, copyWeaponMuzzleInView, weaponViewPose } from '../public/weapon-view.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const world = await importPublicModule('world.js');
const near = (actual, expected, message) => assert.ok(actual.distanceTo(expected) < 1e-10, message);
const meshes = root => { const result = []; root.traverse(node => { if (node.isMesh) result.push(node); }); return result; };
const chambers = root => Array.from({ length: 6 }, (_, index) => root.getObjectByName(`magnumChamber-${index + 1}`));

test('the golden Magnum has a prominent six-chamber cylinder aligned with its short heavy barrel', () => {
  const gun = world.createWeapon('magnum'), cylinder = gun.getObjectByName('magnumCylinder'), barrel = gun.getObjectByName('magnumHeavyBarrel');
  assert.equal(gun.userData.cylinder, cylinder); assert.equal(gun.userData.barrel, barrel);
  assert.equal(cylinder.material.color.getHex(), 0xe3b550); assert.equal(barrel.material.color.getHex(), 0xffd47c);
  assert.equal(cylinder.material.metalness, .85); assert.equal(barrel.material.metalness, .85);
  assert.ok(cylinder.geometry.parameters.radiusTop > barrel.geometry.parameters.radiusBottom * 2, 'the cylinder is visibly broader than the barrel');
  assert.ok(barrel.geometry.parameters.height < .3, 'it has a handgun barrel, not a long rifle silhouette');
  const slots = chambers(gun);
  assert.ok(slots.every(Boolean));
  assert.equal(meshes(gun).filter(mesh => /^magnumChamber-/.test(mesh.name)).length, 6);
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index], next = slots[(index + 1) % slots.length];
    assert.ok(slot.position.z < cylinder.position.z, 'each chamber opening is on the front face');
    assert.equal(slot.material.color.getHex(), 0x191a18, 'dark openings contrast with the gold cylinder');
    assert.ok(Math.abs(Math.hypot(slot.position.x, slot.position.y - cylinder.position.y) - .052) < 1e-12);
    assert.ok(Math.abs(slot.position.distanceTo(next.position) - .052) < 1e-12, 'six chambers are equally spaced around the same axis');
  }
  assert.ok(slots.some(slot => Math.abs(slot.position.x - barrel.position.x) < 1e-12 && Math.abs(slot.position.y - barrel.position.y) < 1e-12), 'the upper chamber aligns with the bore');
  const guard = gun.getObjectByName('magnumTriggerGuard');
  assert.equal(guard.geometry.type, 'TorusGeometry'); assert.ok(guard.geometry.parameters.radius > guard.geometry.parameters.tube * 5, 'the trigger guard has an open center');
  assert.ok(gun.getObjectByName('magnumTrigger')); assert.ok(gun.getObjectByName('magnumHammer'));
});

test('the revolver has one curved dark wooden grip and no shoulder-stock-sized rear extension or forward wooden grip', () => {
  const gun = world.createWeapon('magnum');
  gun.children.slice(-4).forEach(node => node.removeFromParent()); // two hands, two sleeves
  gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0); gun.updateMatrixWorld(true);
  const grip = gun.getObjectByName('magnumCurvedGrip');
  assert.equal(grip.geometry.type, 'ExtrudeGeometry'); assert.equal(grip.material.color.getHex(), 0x38221b);
  assert.deepEqual(meshes(gun).filter(mesh => mesh.material.color.getHex() === 0x38221b), [grip], 'the only wood is the shaped handgun grip');
  const bounds = new THREE.Box3().setFromObject(gun), size = bounds.getSize(new THREE.Vector3());
  assert.ok(bounds.max.z < .2, 'there is no long shoulder stock behind the cylinder');
  assert.ok(size.z < .7 && size.y < .36348 && size.x < .16743, 'the full hands-free artwork remains a compact handgun');
  grip.geometry.computeBoundingBox();
  near(grip.geometry.boundingBox.getCenter(new THREE.Vector3()), new THREE.Vector3(), 'the curved geometry remains centered for precise transformed bounds');
});

test('FPS, rack, ground and teammate models retain the same revolver anatomy and golden materials', () => {
  const fps = world.createWeapon('magnum'), rack = world.createArmoryRack('magnum'), ground = world.createGroundWeapon('magnum');
  const survivor = world.createSurvivor(); world.setSurvivorWeapon(survivor, 'magnum');
  const held = survivor.userData.gun;
  for (const representation of [fps, rack, ground, held]) {
    assert.ok(chambers(representation).every(Boolean));
    assert.ok(representation.getObjectByName('magnumCurvedGrip')); assert.ok(representation.getObjectByName('magnumTriggerGuard'));
    assert.equal(representation.getObjectByName('magnumCylinder').material.color.getHex(), 0xe3b550);
    assert.equal(representation.getObjectByName('magnumHeavyBarrel').material.color.getHex(), 0xffd47c);
  }
  ground.updateMatrixWorld(true); rack.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(ground.userData.model), profile = GROUND_WEAPON_BOUNDS.magnum;
  assert.ok(bounds.min.x >= -profile.halfWidth && bounds.max.x <= profile.halfWidth);
  assert.ok(bounds.min.z >= -profile.halfLength && bounds.max.z <= profile.halfLength);
  assert.ok(Math.abs(bounds.min.y - profile.floorOffset) < 1e-10 && bounds.max.y <= profile.floorOffset + profile.height);
  const rackBounds = new THREE.Box3().setFromObject(rack);
  assert.ok(rackBounds.min.x >= -ARMORY_RACK.width / 2 - 1e-6 && rackBounds.max.x <= ARMORY_RACK.width / 2 + 1e-6);
  assert.ok(rackBounds.min.z >= -1e-6 && rackBounds.max.z <= ARMORY_RACK.depth + 1e-6);
  assert.equal(meshes(fps).length - meshes(ground.userData.model).length, 4, 'only the FPS hands and both sleeves are removed on the ground');
  const pose = weaponViewPose('magnum'); assert.deepEqual(pose.position, [.31, -.32, -.74]); assert.deepEqual(pose.rotation, [0, -.018, 0]);
  applyWeaponViewPose(fps, { recoil: .18 }); fps.updateMatrixWorld(true);
  near(copyWeaponMuzzleInView(fps, new THREE.Vector3()), fps.localToWorld(fps.userData.muzzle.clone()), 'the muzzle light remains on the actual animated revolver');
  near(fps.userData.muzzle, new THREE.Vector3(0, .059, -.46), 'the confirmed cosmetic shot starts just beyond the new barrel end');
});

test('teammates hold the revolver grip with both hands rather than reaching for a rifle foregrip', () => {
  const survivor = world.createSurvivor(); world.setSurvivorWeapon(survivor, 'magnum');
  survivor.position.set(2, 0, -1); survivor.rotation.y = .7;
  for (const pitch of [0, .7, -.5]) {
    world.animateSurvivor(survivor, { pitch, delta: 1 / 60 }); survivor.updateMatrixWorld(true);
    const { arms, gun } = survivor.userData;
    for (const [arm, grip] of [[arms[1], [0, -.14, .09]], [arms[0], [-.015, -.15, .07]]]) {
      const hand = arm.localToWorld(new THREE.Vector3(0, -.51, 0));
      const target = gun.localToWorld(new THREE.Vector3(...grip));
      near(hand, target, 'each hand follows its own handgun grip point through aim changes');
      assert.ok(grip[2] > 0, 'both hands remain behind the cylinder, not under the barrel');
    }
    assert.ok(world.survivorMuzzle(survivor).toArray().every(Number.isFinite));
  }
});
