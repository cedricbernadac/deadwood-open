import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ARMORY, ARMORY_RACK, GROUND_WEAPON_BOUNDS, MELEE_WEAPONS, SUPPLY_BONUSES, LATE_SUPPLIES, EXPEDITION } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const world = await importPublicModule('world.js');
const canvasDocument = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
function setup() {
  const previous = globalThis.document; globalThis.document = canvasDocument;
  try { const scene = new THREE.Scene(); return { scene, cabin: world.createWorld(scene) }; }
  finally { globalThis.document = previous; }
}
const meshes = object => { const result = []; object.traverse(node => { if (node.isMesh) result.push(node); }); return result; };

test('hammer and bolt rifle retain their own full-sized models on racks, on the ground and in teammate hands', () => {
  for (const type of ['hammer', 'sniper']) {
    const held = world.createWeapon(type), ground = world.createGroundWeapon(type), rack = world.createArmoryRack(type);
    assert.equal(held.userData.type, type); assert.equal(ground.userData.weapon, type);
    assert.ok(rack.getObjectByName(`rackWeapon-${type}`));
    // Two hands and the sleeve; the bolt rifle also has the support-hand sleeve.
    assert.equal(meshes(held).length - meshes(ground.userData.model).length, type === 'sniper' ? 4 : 3, 'hands and sleeves removed only');
    ground.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(ground.userData.model), shared = GROUND_WEAPON_BOUNDS[type];
    assert.ok(Math.abs(bounds.min.y - shared.floorOffset) < 1e-8);
    assert.ok(bounds.max.x <= shared.halfWidth && bounds.max.z <= shared.halfLength);
    assert.ok(bounds.max.y - shared.floorOffset <= shared.height);
    assert.ok(shared.halfWidth - bounds.max.x < .001 && shared.halfLength - bounds.max.z < .001 && shared.height - bounds.max.y + shared.floorOffset < .001, 'server envelope is measured, not guessed');
    const rackBounds = new THREE.Box3().setFromObject(rack);
    assert.ok(rackBounds.min.x >= -ARMORY_RACK.width / 2 - 1e-6 && rackBounds.max.x <= ARMORY_RACK.width / 2 + 1e-6);
    assert.ok(rackBounds.min.z >= -1e-6 && rackBounds.max.z <= ARMORY_RACK.depth + 1e-6);
    const teammate = world.createSurvivor(); world.setSurvivorWeapon(teammate, type); world.fireSurvivor(teammate, 10);
    world.animateSurvivor(teammate, { time: 10.01, meleeAttack: 'heavy', meleeElapsed: .75 });
    assert.equal(teammate.userData.flash.visible, type === 'sniper');
    assert.equal(Boolean(world.survivorMuzzle(teammate)), type === 'sniper');
    teammate.updateMatrixWorld(true); teammate.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite)));
  }
});

test('the hammer striking spikes lead both contact trajectories and its heavy recovery follows its own longer cycle', () => {
  for (const remote of [false, true]) for (const attack of ['light', 'heavy']) {
    const model = remote ? world.createSurvivor() : world.createWeapon('hammer');
    if (remote) world.setSurvivorWeapon(model, 'hammer');
    const gun = remote ? model.userData.gun : model, frame = gun.userData.bladeFrame;
    assert.equal(gun.getObjectByName('hammerStrikingSpikes').userData.strikingSide, 'negative-X');
    const profile = MELEE_WEAPONS.hammer[attack], epsilon = .00001;
    const sample = time => {
      if (remote) world.animateSurvivor(model, { pitch: .3, delta: 0, meleeAttack: attack, meleeElapsed: time });
      else world.animateMeleeWeapon(gun, { attack, elapsed: time });
      model.updateMatrixWorld(true);
      return frame.localToWorld(new THREE.Vector3(0, 0, -.79));
    };
    const before = sample(profile.windup - epsilon), after = sample(profile.windup + epsilon); sample(profile.windup);
    const velocity = after.sub(before), centre = frame.localToWorld(new THREE.Vector3(0, 0, -.79));
    const shaft = frame.localToWorld(new THREE.Vector3(0, 0, -.6)).sub(centre).normalize();
    const strikingFace = frame.localToWorld(new THREE.Vector3(-.25, 0, -.79)).sub(centre);
    velocity.addScaledVector(shaft, -velocity.dot(shaft)); strikingFace.addScaledVector(shaft, -strikingFace.dot(shaft));
    assert.ok(velocity.normalize().dot(strikingFace.normalize()) > .98, `${remote ? 'teammate' : 'FPS'}/${attack}: striking face leads the measured head movement`);
    sample(profile.duration * .8); assert.notEqual(gun.userData.meleePose.armX, 0);
    sample(profile.duration); assert.equal(gun.userData.meleePose.armX, 0); assert.equal(frame.rotation.z, 0);
    sample(Infinity); assert.equal(gun.userData.meleePose.armX, 0);
  }
});

test('sniper bolt opens, slides and closes once per firing cycle and resets on reload', () => {
  const gun = world.createWeapon('sniper'), bolt = gun.getObjectByName('sniperBolt');
  assert.ok(gun.getObjectByName('sniperScope')); assert.ok(gun.userData.muzzle.z < -1);
  world.animateWeaponMechanism(gun, { shotElapsed: .3 }); assert.ok(bolt.rotation.z < -.8);
  world.animateWeaponMechanism(gun, { shotElapsed: .55 }); assert.ok(bolt.position.z > .12);
  world.animateWeaponMechanism(gun, { shotElapsed: .55, reloading: true }); assert.equal(bolt.position.z, .018); assert.equal(bolt.rotation.z, 0);
  for (const shotElapsed of [0, 1.25, Infinity, NaN]) { world.animateWeaponMechanism(gun, { shotElapsed }); assert.equal(bolt.position.z, .018); assert.equal(bolt.rotation.z, 0); }
});

test('supply crate and every recoverable bonus follow shared state without new lights', () => {
  const { cabin, scene } = setup(), lights = []; scene.traverse(node => { if (node.isLight) lights.push(node); });
  assert.equal(cabin.lateSupplyPost.position.x, LATE_SUPPLIES.position.x);
  for (const bonus of Object.keys(SUPPLY_BONUSES)) {
    const pickup = world.createPickup('bonus', false, bonus);
    assert.equal(pickup.userData.kind, 'bonus'); assert.equal(pickup.userData.bonus, bonus);
    assert.ok(meshes(pickup.userData.model).length >= 3); world.animatePickup(pickup, 2);
    assert.equal(world.createPickup('bonus', bonus).userData.bonus, bonus);
  }
  const state = { wave: 8, supplyCrate: { id: 'crate', x: 17, y: 0, z: -12, claimed: [] }, magnumAvailable: false };
  cabin.update(1, { snapshot: state, myId: 'me', active: true });
  assert.equal(cabin.supplyCrate.visible, true); assert.deepEqual(cabin.supplyCrate.position.toArray(), [17, 0, -12]);
  assert.equal(cabin.armoryDisplays.get('magnum').getObjectByName('rackWeapon-magnum').visible, false);
  state.supplyCrate.claimed.push('me'); cabin.update(2, { snapshot: state, myId: 'me', active: true });
  assert.equal(cabin.supplyCrate.userData.indicator.material.color.getHex(), 0x61776b);
  cabin.update(3, { snapshot: { magnumAvailable: true }, active: true }); assert.equal(cabin.supplyCrate.visible, false);
  const afterLights = []; scene.traverse(node => { if (node.isLight) afterLights.push(node); }); assert.deepEqual(afterLights, lights);
});

test('the supply crate has no hanging bonus models, while every dropped bonus retains its own animated pickup', () => {
  const { cabin } = setup(), crate = cabin.supplyCrate, decorativeBonuses = [];
  crate.traverse(node => { if (/^bonus-/.test(node.name)) decorativeBonuses.push(node.name); });
  assert.deepEqual(decorativeBonuses, [], 'reward choice models belong to the menu and dropped pickups only');
  const bodyBounds = new THREE.Box3();
  for (const part of crate.children) if (part.isMesh && part !== crate.userData.halo) bodyBounds.union(new THREE.Box3().setFromObject(part));
  assert.ok(bodyBounds.min.x >= -.575001 && bodyBounds.max.x <= .575001, 'solid crate parts stay within the original 1.15 m footprint');
  assert.ok(crate.userData.beacon.lens && crate.userData.beacon.glow && crate.userData.indicator && crate.userData.halo, 'the crate still has its rescue beacon and offer state');
  assert.equal(Object.keys(SUPPLY_BONUSES).length, 14);
  for (const bonus of Object.keys(SUPPLY_BONUSES)) {
    const pickup = world.createPickup('bonus', false, bonus);
    assert.equal(pickup.userData.bonus, bonus); assert.equal(pickup.userData.kind, 'bonus');
    assert.equal(pickup.userData.model.parent, pickup); assert.ok(meshes(pickup.userData.model).length >= 3, bonus);
    assert.equal(pickup.getObjectByName('pickupHalo'), pickup.userData.halo);
    world.animatePickup(pickup, 2); pickup.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(pickup.userData.model); assert.ok(!bounds.isEmpty() && bounds.min.toArray().every(Number.isFinite), bonus);
    if (bonus === 'grenadier') assert.ok(pickup.getObjectByName('grenadeBody'), 'Grenadier remains recognizable on the ground');
  }
});

test('long approaches preserve flat movement, fog visibility and the bounded cabin rain pool', () => {
  const { cabin, scene } = setup(), approaches = cabin.root.getObjectByName('distantApproaches');
  assert.equal(approaches.children.length, 2); assert.equal(scene.fog.density, .017);
  for (const approach of approaches.children) {
    assert.ok(approach.geometry.parameters.depth > 35); assert.equal(approach.geometry.parameters.height, .007);
    assert.equal(cabin.rayBlockers.includes(approach), false);
  }
  assert.equal(cabin.expedition.rain.geometry.attributes.position.count, 2800, 'larger arena keeps the same 1400 line segments');
  assert.equal(cabin.root.getObjectByName('expedition-clearing').geometry.parameters.width, EXPEDITION.bounds.maxX - EXPEDITION.bounds.minX + 1);
  for (const type of ['hammer', 'sniper']) assert.ok(ARMORY.some(rack => rack.weapon === type));
});

test('boss carapace cracks show six successive losses of health and never alter another boss or add lights', () => {
  const boss = world.createZombie('brute', true, 6000), other = world.createZombie('brute', true, 6000);
  for (let hit = 0; hit <= 6; hit++) {
    world.setZombieHealth(boss, 6000 - hit * 1000, 6000);
    assert.equal(boss.userData.carapace.cracks.filter(crack => crack.visible).length, hit);
  }
  assert.equal(other.userData.carapace.cracks.some(crack => crack.visible), false);
  assert.notEqual(other.userData.carapace.material, boss.userData.carapace.material);
  const lights = []; boss.traverse(node => { if (node.isLight) lights.push(node); }); assert.equal(lights.length, 0);
});
