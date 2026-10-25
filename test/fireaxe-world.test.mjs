import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ARMORY_RACK, GROUND_WEAPON_BOUNDS, MELEE_WEAPONS } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const world = await importPublicModule('world.js');
const meshes = object => { const result = []; object.traverse(node => { if (node.isMesh) result.push(node); }); return result; };

test('fire axe has a broad red head, silver cutting edge, rear pick and long wooden handle in every representation', () => {
  const held = world.createWeapon('fireaxe'), ground = world.createGroundWeapon('fireaxe'), rack = world.createArmoryRack('fireaxe');
  for (const model of [held, ground, rack]) {
    for (const part of ['fireaxeRedHead', 'fireaxeCuttingEdge', 'fireaxeRearPick', 'fireaxeWoodHandle']) assert.ok(model.getObjectByName(part), part);
    assert.equal(model.getObjectByName('fireaxeRedHead').material.color.getHex(), 0xa92118);
    assert.ok(model.getObjectByName('fireaxeCuttingEdge').material.metalness > .8);
    let lights = 0; model.traverse(node => { if (node.isLight) lights++; }); assert.equal(lights, 0);
  }
  assert.equal(meshes(held).length - meshes(ground.userData.model).length, 3, 'only two first-person hands and one sleeve removed');
  ground.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(ground.userData.model), shared = GROUND_WEAPON_BOUNDS.fireaxe;
  assert.ok(Math.abs(bounds.min.y - shared.floorOffset) < 1e-8);
  assert.ok(bounds.max.y < .13, 'the broad head lies flat on its cheek rather than balancing on its blade');
  for (const [measured, envelope] of [[bounds.max.x, shared.halfWidth], [bounds.max.z, shared.halfLength], [bounds.max.y - shared.floorOffset, shared.height]]) {
    assert.ok(measured <= envelope && envelope - measured < .00003, 'authoritative pickup envelope uses measured production art');
  }
  const rackBounds = new THREE.Box3().setFromObject(rack);
  assert.ok(rackBounds.min.x >= -ARMORY_RACK.width / 2 - 1e-6 && rackBounds.max.x <= ARMORY_RACK.width / 2 + 1e-6);
  assert.ok(rackBounds.min.z >= -1e-6 && rackBounds.max.z <= ARMORY_RACK.depth + 1e-6);
  const rackWeapon = rack.getObjectByName('rackWeapon-fireaxe'), rackWeaponSize = new THREE.Box3().setFromObject(rackWeapon).getSize(new THREE.Vector3());
  assert.ok(rackWeaponSize.y > .9 && rackWeaponSize.x > .55, 'the axe hangs as a readable full-size diagonal silhouette, not a depth-limited miniature');
  assert.ok(rackWeaponSize.z < .14, 'the broad cheek lies flat against the rack');
  assert.equal(held.userData.melee, true);
});

test('both axe swings bring the cutting edge through contact, including aimed teammate animations', () => {
  for (const remote of [false, true]) for (const attack of ['light', 'heavy']) {
    const model = remote ? world.createSurvivor() : world.createWeapon('fireaxe');
    if (remote) world.setSurvivorWeapon(model, 'fireaxe');
    const gun = remote ? model.userData.gun : model, frame = gun.userData.bladeFrame;
    const profile = MELEE_WEAPONS.fireaxe[attack], epsilon = .00001;
    assert.equal(frame.getObjectByName('fireaxeCuttingEdge').userData.strikingSide, 'negative-X');
    const sample = time => {
      if (remote) world.animateSurvivor(model, { pitch: .3, delta: 0, meleeAttack: attack, meleeElapsed: time });
      else world.animateMeleeWeapon(gun, { attack, elapsed: time });
      model.updateMatrixWorld(true); return frame.localToWorld(new THREE.Vector3(0, 0, -.79));
    };
    const before = sample(profile.windup - epsilon), after = sample(profile.windup + epsilon); sample(profile.windup);
    const velocity = after.sub(before), centre = frame.localToWorld(new THREE.Vector3(0, 0, -.79));
    const shaft = frame.localToWorld(new THREE.Vector3(0, 0, -.6)).sub(centre).normalize();
    const edge = frame.localToWorld(new THREE.Vector3(-.3, 0, -.79)).sub(centre);
    velocity.addScaledVector(shaft, -velocity.dot(shaft)); edge.addScaledVector(shaft, -edge.dot(shaft));
    assert.ok(velocity.normalize().dot(edge.normalize()) > .98, `${remote ? 'teammate' : 'FPS'}/${attack}: the sharp edge leads, not the cheek or pick`);
    sample(profile.duration * .8); assert.notEqual(gun.userData.meleePose.armX, 0);
    sample(profile.duration); assert.equal(gun.userData.meleePose.armX, 0); assert.equal(frame.rotation.z, 0);
    sample(Infinity); assert.equal(gun.userData.meleePose.armX, 0);
    if (remote) { world.fireSurvivor(model, 1); assert.equal(model.userData.flash.visible, false); assert.equal(world.survivorMuzzle(model), null); }
  }
});

test('axe light and heavy preparations are visibly distinct and never change another axe instance', () => {
  const axe = world.createWeapon('fireaxe'), other = world.createWeapon('fireaxe'), pivot = axe.userData.meleePivot;
  const idle = other.userData.meleePivot.rotation.toArray(), poses = [];
  for (const attack of ['light', 'heavy']) {
    const profile = MELEE_WEAPONS.fireaxe[attack];
    world.animateMeleeWeapon(axe, { attack, elapsed: profile.windup * .7 }); poses.push(pivot.rotation.toArray());
    assert.notDeepEqual(pivot.rotation.toArray(), idle); assert.deepEqual(other.userData.meleePivot.rotation.toArray(), idle);
    world.animateMeleeWeapon(axe, { attack, elapsed: profile.duration }); assert.deepEqual(pivot.rotation.toArray(), idle);
  }
  assert.notDeepEqual(...poses);
});
