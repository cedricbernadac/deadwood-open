import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { ARMORY, ARMORY_RACK, armoryRackBounds, LOFT, STAIR_WELL, GROUND_WEAPON_BOUNDS,MELEE } from '../public/rules.js';
import { RoomSimulation } from '../simulation.mjs';
import { stairTreadY } from '../public/stairs.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const world = await importPublicModule('world.js');
const types = ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'magnum', 'assault', 'rocket', 'flamethrower','katana','hammer','sniper','bat','fireaxe'];
const meshes = group => { const result = []; group.traverse(node => { if (node.isMesh) result.push(node); }); return result; };
const lights = group => { const result = []; group.traverse(node => { if (node.isLight) result.push(node); }); return result; };
const finite = group => {
  group.updateMatrixWorld(true);
  group.traverse(node => {
    assert.ok([...node.position.toArray(), ...node.scale.toArray(), ...node.quaternion.toArray(), ...node.matrixWorld.elements].every(Number.isFinite), `${node.name}: finite transform`);
  });
};

test('all fourteen ground weapons reuse their true model, omit first-person hands, and lie above the floor', () => {
  const counts = [];
  for (const type of types) {
    const pickup = world.createGroundWeapon(type), weapon = world.createWeapon(type);
    assert.equal(pickup.userData.kind, 'weapon');
    assert.equal(pickup.userData.weapon, type);
    assert.ok(pickup.getObjectByName(`groundWeapon-${type}`));
    assert.equal(pickup.getObjectByName('muzzleFlash'), undefined);
    assert.equal(lights(pickup).length, 0);
    const actual = meshes(pickup.userData.model), firstPerson = meshes(weapon);
    // Two hands and the firing sleeve; the guns also lose the support-hand
    // sleeve (weapon-racks lot, 24 October 2026).
    const melee = ['bat', 'fireaxe', 'hammer', 'katana'].includes(type);
    assert.equal(firstPerson.length - actual.length, melee ? 3 : 4, `${type}: exactly the two hands and ${melee ? 'the sleeve' : 'both sleeves'} are removed`);
    assert.equal(actual.some(mesh => ['firstPersonHand', 'firstPersonSleeve'].includes(mesh.material.name)), false);
    pickup.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(pickup.userData.model), size = bounds.getSize(new THREE.Vector3());
    assert.ok(bounds.min.y >= .0179 && bounds.max.y < (type === 'hammer' ? .47 : .45), `${type}: lies on its side above the floor (${bounds.min.y}..${bounds.max.y})`);
    assert.ok(size.z > .3 && size.z < 1.7, `${type}: plausible length ${size.z}`);
    assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x) < 1e-8 && Math.abs(bounds.getCenter(new THREE.Vector3()).z) < 1e-8);
    assert.equal(pickup.userData.halo.children[0].material.color.getHex(), 0x75baff);
    counts.push(actual.length);
    finite(pickup);
  }
  assert.ok(new Set(counts).size >= 8, 'the nine actual weapon silhouettes retain visibly different mesh structures');
});

test('weapon pickup animation pulses its halo without moving the server root or spinning the laid weapon', () => {
  const pickup = world.createGroundWeapon('rifle'), other = world.createGroundWeapon('rifle');
  pickup.position.set(2, 3.4, -5); pickup.rotation.y = .7;
  const root = pickup.position.clone(), angle = pickup.rotation.clone(), child = pickup.userData.model.position.clone();
  for (const time of [0, .5, 3, 100, NaN, Infinity]) {
    world.animatePickup(pickup, time); finite(pickup);
    assert.deepEqual(pickup.position.toArray(), root.toArray());
    assert.deepEqual(pickup.rotation.toArray(), angle.toArray());
    assert.deepEqual(pickup.userData.model.position.toArray(), child.toArray());
    assert.equal(pickup.userData.model.rotation.y, 0);
  }
  assert.equal(other.userData.halo.scale.x, 1, 'cloned transform animation stays independent');
  assert.notEqual(pickup.userData.model, other.userData.model);
  assert.equal(meshes(pickup.userData.model)[0].geometry, meshes(other.userData.model)[0].geometry, 'cached GPU geometry survives individual collection');
});

test('the curved katana blade and two-handed survivor use distinct preparation, contact and recovery with no muzzle flash',()=>{
  const weapon=world.createWeapon('katana'),pivot=weapon.userData.meleePivot;
  assert.ok(weapon.getObjectByName('katanaBlade'));assert.equal(weapon.userData.melee,true);
  const idle=pivot.rotation.toArray(),poses={};
  for(const attack of['light','heavy']){
    const profile=MELEE[attack],sequence=[];
    for(const elapsed of[0,profile.windup*.6,profile.windup,profile.windup+.1,profile.duration*.95]){
      world.animateMeleeWeapon(weapon,{attack,elapsed,windup:profile.windup,duration:profile.duration});finite(weapon);sequence.push([...pivot.rotation.toArray(),...pivot.position.toArray()]);
    }
    assert.notDeepEqual(sequence[1],sequence[2],`${attack}: preparation visibly differs from contact`);
    assert.notDeepEqual(sequence[2],sequence[4],`${attack}: recovery leaves contact pose`);
    poses[attack]=sequence[1];world.animateMeleeWeapon(weapon,{attack,elapsed:profile.duration});assert.deepEqual(pivot.rotation.toArray(),idle);
  }
  assert.notDeepEqual(poses.light,poses.heavy,'heavy preparation raises the blade, light preparation winds sideways');
  for(const elapsed of[NaN,Infinity,-1]){world.animateMeleeWeapon(weapon,{attack:'heavy',elapsed});finite(weapon);assert.deepEqual(pivot.rotation.toArray(),idle);}
  const survivor=world.createSurvivor();world.setSurvivorWeapon(survivor,'katana');world.fireSurvivor(survivor,1);
  world.animateSurvivor(survivor,{time:1,delta:1/30,meleeAttack:'heavy',meleeElapsed:.7,meleeWindup:.7,meleeDuration:1.5});finite(survivor);
  assert.equal(survivor.userData.flash.visible,false);assert.equal(survivor.userData.gun.getObjectByName('muzzleFlash'),undefined);assert.equal(world.survivorMuzzle(survivor),null);
  assert.ok(Math.abs(survivor.userData.aim.rotation.x)>0,'the remote arms follow the heavy swing');
  world.animateSurvivor(survivor,{time:2,delta:1/30,meleeAttack:null,meleeElapsed:Infinity});assert.equal(survivor.userData.gun.userData.meleePose.armX,0);
});

// Flames, embers and smoke live in the shared particle engine (fx.js).
const { sharedEffects } = await importPublicModule('fx.js');
const fx = sharedEffects();
const live = (pool, time) => {
  fx.update(time);
  const count = fx.pools[pool].mesh.geometry.instanceCount, array = fx.pools[pool].center.array;
  return Array.from({ length: count }, (_, index) => new THREE.Vector3(array[index * 3], array[index * 3 + 1], array[index * 3 + 2]));
};

test('flame jets roll fire, embers and smoke in the shared engine, expire after release and add no lights', () => {
  fx.clear();
  const stream = world.createFlameStream(), other = world.createFlameStream();
  assert.equal(meshes(stream.mesh).length, 0, 'no mesh per flame');
  assert.equal(lights(stream.mesh).length, 0);
  for (let index = 0; index < 100; index++) {
    const time = index / 8;
    stream.aim(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 2, -2), time);
    assert.equal(stream.update(time + .05), true); finite(stream.mesh);
  }
  const flames = live('glow', 12.43);
  assert.ok(flames.length > 20, 'a dense rolling jet');
  assert.ok(flames.every(point => [point.x, point.y, point.z].every(Number.isFinite) && point.z < 3.2 && point.z > -5 && Math.abs(point.x - 1) < 2.5), 'flames stay along the jet');
  assert.ok(live('smoke', 12.9).length > 0, 'smoke billows where the flame dies');
  for (const pool of Object.values(fx.pools)) assert.ok(pool.particles.length <= pool.capacity, 'bounded pools');
  assert.equal(stream.update(100), false); assert.equal(stream.mesh.visible, false);
  stream.aim(new THREE.Vector3(), new THREE.Vector3(0, 0, -5), 101); stream.stop();
  assert.equal(stream.update(101), false);
  stream.dispose(); stream.dispose();
  assert.equal(other.update(102), false);
  other.aim(new THREE.Vector3(), new THREE.Vector3(0, 0, -5), 103);
  assert.equal(other.update(103), true, 'disposing one survivor leaves the others working');
  other.dispose();
  assert.equal(lights(fx.root).length, 0, 'the particle engine adds no light');
});

test('burning enemies roll flames in the shared engine without new meshes or family colour changes', () => {
  fx.clear();
  const zombie = world.createZombie('walker', false, 165), other = world.createZombie('brute', false, 700);
  zombie.position.set(4, 0, -2);
  const skin = zombie.userData.head.children[0].material, initialColor = skin.color.getHex(), meshCount = meshes(zombie).length;
  world.setZombieBurn(zombie, true); world.setZombieBurn(other, true);
  for (const time of [0, .5, 2, 4]) { world.setZombieBurn(zombie, true); world.animateZombie(zombie, time, false); finite(zombie); }
  for (let frame = 0; frame <= 30; frame++) world.animateZombie(zombie, 20 + frame / 60, false, 1 / 60);
  assert.equal(meshes(zombie).length, meshCount, 'no flame mesh is added to the body');
  const flames = live('glow', 20.52);
  assert.ok(flames.length > 5, 'a burning body keeps flaming');
  assert.ok(flames.every(point => point.distanceTo(new THREE.Vector3(4, 1.1, -2)) < 2.6), 'the flames ride on the burning body');
  assert.equal(skin.color.getHex(), initialColor, 'health-family appearance stays readable under the flames');
  world.setZombieBurn(zombie, false); fx.clear();
  world.animateZombie(zombie, 21, false);
  assert.equal(live('glow', 21.01).length, 0, 'an extinguished body stops burning');
  assert.equal(other.userData.burning, true);
});

test('ground weapons follow the authoritative yaw and stair pitch while their halo and root stay on the support plane', () => {
  for (const type of types) {
    const pickup = world.createGroundWeapon(type), other = world.createGroundWeapon(type);
    pickup.position.set(3.8, 1.81, .25);
    const pitch = Math.atan2(3.4, 4.5);
    world.setGroundWeaponPose(pickup, { yaw: Math.PI / 2, pitch, modelLift: .13 });
    assert.equal(pickup.rotation.y, Math.PI / 2);
    assert.equal(pickup.userData.model.rotation.x, pitch);
    assert.equal(pickup.userData.model.position.y, .13);
    assert.ok(Math.abs(pickup.userData.halo.rotation.x) < 1e-12);
    assert.ok(Math.abs(other.rotation.y) < 1e-12);
    assert.ok(Math.abs(other.userData.model.rotation.x) < 1e-12);
    for (const time of [0, 1, 100]) {
      world.animatePickup(pickup, time);
      assert.deepEqual(pickup.position.toArray(), [3.8, 1.81, .25]);
      assert.equal(pickup.rotation.y, Math.PI / 2);
      assert.equal(pickup.userData.model.rotation.x, pitch);
      assert.equal(pickup.userData.model.position.y, .13);
      finite(pickup);
    }
    world.setGroundWeaponPose(pickup, { yaw: NaN, pitch: Infinity, modelLift: NaN });
    assert.equal(pickup.rotation.y, 0); assert.equal(pickup.userData.model.rotation.x, 0); finite(pickup);
    assert.equal(pickup.userData.model.position.y, 0);
  }
});

test('authoritative weapon envelopes contain the full-sized rendered artwork at every supported yaw and stair pitch', () => {
  for (const type of types) {
    const profile = GROUND_WEAPON_BOUNDS[type];
    assert.ok(Object.isFrozen(profile));
    const pickup = world.createGroundWeapon(type), model = pickup.userData.model;
    const local = new THREE.Box3().setFromObject(model);
    assert.ok(local.min.x >= -profile.halfWidth && local.max.x <= profile.halfWidth);
    assert.ok(local.min.z >= -profile.halfLength && local.max.z <= profile.halfLength);
    assert.ok(local.min.y >= profile.floorOffset - 1e-8 && local.max.y <= profile.floorOffset + profile.height);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) for (const pitch of [0, Math.atan2(3.4, 4.5)]) {
      const lift = pitch ? .13 : 0;
      world.setGroundWeaponPose(pickup, { yaw, pitch, modelLift: lift });
      pickup.position.set(3, 1.8, -.5); pickup.updateMatrixWorld(true);
      const envelope = new THREE.Box3();
      for (const x of [-profile.halfWidth, profile.halfWidth]) for (const z of [-profile.halfLength, profile.halfLength]) for (const y of [profile.floorOffset, profile.floorOffset + profile.height]) envelope.expandByPoint(model.localToWorld(new THREE.Vector3(x, y, z)));
      // Check each true geometry vertex, rather than an expanded AABB of an
      // already rotated part. This matches the server's oriented envelope.
      model.traverse(node => {
        if (!node.isMesh) return;
        const positions = node.geometry.getAttribute('position');
        for (let index = 0; index < positions.count; index++) {
          const point = node.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, index));
          assert.ok(envelope.containsPoint(point), `${type}: actual vertex is in its shared posed envelope`);
        }
      });
    }
  }
});

test('real server drops place full-sized models clear of the rendered walls, floors and stair treads', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
  try {
    const cabin = world.createWorld(new THREE.Scene()); cabin.root.updateMatrixWorld(true);
    const obbFor = node => {
      node.geometry.computeBoundingBox();
      return new OBB().fromBox3(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
    };
    const obstacles = cabin.rayBlockers.map(node => ({ node, box: obbFor(node) }));
    const cases = [
      { id: 'north-wall', x: 2, z: -5.55, y: 0 },
      { id: 'south-wall', x: 2, z: 5.55, y: 0 },
      { id: 'east-wall', x: 7.55, z: 2, y: 0 },
      { id: 'west-wall', x: -7.55, z: 2, y: 0 },
      { id: 'lower-stair', x: 3.8, z: 1.5, y: stairTreadY(1.5) },
      { id: 'middle-stair', x: 3.8, z: .25, y: stairTreadY(.25) },
      { id: 'upper-stair', x: 3.8, z: -1.35, y: stairTreadY(-1.35) },
      { id: 'top-stair', x: 3.8, z: -1.9, y: stairTreadY(-1.9) },
      { id: 'expanded-loft', x: .8, z: 2.8, y: LOFT.y },
      { id: 'under-stair', x: 3.8, z: -1.35, y: 0 },
    ];
    for (const type of types) for (const scenario of cases) {
      const simulation = new RoomSimulation('VISUAL', { random: () => .5 }), player = simulation.addPlayer('a');
      simulation.start(player.id); simulation.phase = 'wave';
      Object.assign(player, { x: scenario.x, y: scenario.y, z: scenario.z, yaw: 0, weapon: type, inventory: { [type]: { ammo: 1, reserve: 2 } } });
      assert.equal(simulation.dropWeapon(player.id), true, `${type}/${scenario.id}: the legal position allows a drop`);
      const pickup = simulation.snapshot().pickups.find(item => item.kind === 'weapon');
      const rendered = world.createGroundWeapon(type); rendered.position.set(pickup.x, pickup.y, pickup.z); world.setGroundWeaponPose(rendered, pickup); rendered.updateMatrixWorld(true);
      for (const node of meshes(rendered.userData.model)) {
        const actual = obbFor(node);
        for (const obstacle of obstacles) assert.equal(actual.intersectsOBB(obstacle.box, 0), false,
          `${type}/${scenario.id}: actual gun part does not intersect ${obstacle.node.name || obstacle.node.geometry.type}`);
      }
      finite(rendered);
      assert.ok(Math.hypot(pickup.x - player.x, pickup.z - player.z) < 1.15);
      if (scenario.id === 'north-wall' && type === 'rifle') assert.equal(pickup.yaw, Math.PI / 2, 'the original north-wall rifle reproduction turns across the wall');
    }
  } finally { globalThis.document = previous; }
});

test('grenade loot and projectile show an olive body, pin and amber marks, with only loot carrying a halo', () => {
  const pickup = world.createPickup('grenade'), projectile = world.createGrenadeProjectile();
  assert.equal(pickup.userData.kind, 'grenade');
  assert.equal(pickup.userData.special, false);
  assert.ok(pickup.getObjectByName('grenadePin'));
  assert.equal(pickup.userData.halo.children[0].material.color.getHex(), 0xffaa48);
  assert.ok(meshes(pickup).some(mesh => mesh.material.color.getHex() === 0x56623b));
  assert.ok(meshes(pickup).some(mesh => mesh.material.color.getHex() === 0xdfa24d));
  assert.equal(projectile.getObjectByName('pickupHalo'), undefined);
  assert.equal(lights(pickup).length + lights(projectile).length, 0);
  const size = new THREE.Box3().setFromObject(projectile).getSize(new THREE.Vector3());
  assert.ok(size.x < .15 && size.y < .2 && size.z < .15, 'the thrown model is hand-sized');
  projectile.position.set(-2, 1.7, 5);
  for (const time of [0, .1, 1, 100, NaN, Infinity]) {
    world.animateGrenadeProjectile(projectile, time); finite(projectile);
    assert.deepEqual(projectile.position.toArray(), [-2, 1.7, 5]);
  }
});

test('explosion fades completely within 600 ms, has no dynamic light, and disposes only its own resources once', () => {
  const blast = world.createGrenadeExplosion({ x: 2, y: 3.4, z: -1 }, { time: 5, radius: 4 });
  const other = world.createGrenadeExplosion({ x: 0, y: 0, z: 0 }, { time: 5 });
  const scene = new THREE.Scene(); scene.add(blast.mesh, other.mesh);
  assert.equal(lights(blast.mesh).length, 0);
  const resources = new Set(), otherResources = new Set();
  for (const mesh of meshes(blast.mesh)) { resources.add(mesh.geometry); resources.add(mesh.material); }
  for (const mesh of meshes(other.mesh)) { otherResources.add(mesh.geometry); otherResources.add(mesh.material); }
  assert.equal([...resources].some(resource => otherResources.has(resource)), false);
  const disposal = new Map([...resources].map(resource => [resource, 0]));
  resources.forEach(resource => resource.addEventListener('dispose', () => disposal.set(resource, disposal.get(resource) + 1)));
  for (const now of [5, 5.03, 5.2, 5.4, 5.599, NaN]) {
    assert.equal(blast.update(now), true); finite(blast.mesh);
    assert.deepEqual(blast.mesh.position.toArray(), [2, 3.4, -1]);
    for (const mesh of meshes(blast.mesh)) assert.ok(mesh.material.opacity >= 0 && mesh.material.opacity <= 1);
  }
  assert.equal(blast.update(5.6 + 1e-9), false);
  assert.equal(blast.mesh.visible, false);
  blast.dispose(); blast.dispose();
  assert.ok([...disposal.values()].every(count => count === 1));
  assert.equal(blast.mesh.parent, null);
  assert.equal(blast.update(6), false);
  assert.equal(other.update(5.1), true, 'a separate concurrent explosion still renders');
  other.dispose();
});

test('invalid visual inputs fall back to bounded finite models without affecting existing pickups', () => {
  const fallback = world.createGroundWeapon('unknown');
  assert.equal(fallback.userData.weapon, 'pistol');
  for (const kind of ['points', 'ammo', 'health', 'armor', 'grenade']) {
    const pickup = world.createPickup(kind); world.animatePickup(pickup, NaN); finite(pickup);
    assert.equal(pickup.userData.kind, kind);
  }
  const blast = world.createGrenadeExplosion({ x: NaN, y: Infinity, z: -Infinity }, { time: NaN, radius: Infinity });
  blast.update(NaN); finite(blast.mesh); assert.deepEqual(blast.mesh.position.toArray(), [0, 0, 0]); blast.dispose();
});

test('wall racks expose the correct hands-free weapon inside the shared suspended collider, without a ground island or light', () => {
  for (const crate of ARMORY) {
    const rack = world.createArmoryRack(crate.weapon);
    assert.equal(rack.userData.weapon, crate.weapon);
    assert.ok(rack.getObjectByName(`rackWeapon-${crate.weapon}`));
    assert.equal(lights(rack).length, 0);
    const local = new THREE.Box3().setFromObject(rack);
    assert.ok(local.min.x >= -ARMORY_RACK.width / 2 - 1e-6 && local.max.x <= ARMORY_RACK.width / 2 + 1e-6);
    assert.ok(local.min.y >= ARMORY_RACK.baseY - 1e-6 && local.max.y <= ARMORY_RACK.baseY + ARMORY_RACK.height + 1e-6, `${crate.id}: suspended rack within shared heights`);
    assert.ok(local.min.z >= -1e-6 && local.max.z <= ARMORY_RACK.depth + 1e-6, `${crate.id}: shallow rack stays inside collider`);
    rack.position.set(crate.x, crate.y, crate.z); rack.rotation.y = crate.facing;
    const actual = new THREE.Box3().setFromObject(rack), expected = armoryRackBounds(crate);
    assert.ok(actual.min.x >= expected.minX - 1e-6 && actual.max.x <= expected.maxX + 1e-6);
    assert.ok(actual.min.z >= expected.minZ - 1e-6 && actual.max.z <= expected.maxZ + 1e-6);
    assert.ok(actual.min.y >= expected.baseY - 1e-6 && actual.max.y <= expected.baseY + expected.height + 1e-6);
    finite(rack);
  }
});

test('the four rendered loft slabs and outer railing follow the expanded shared loft and preserve the exact stair opening', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
  try {
    const scene = new THREE.Scene(), cabin = world.createWorld(scene);
    const slabs = ['north', 'east', 'west', 'south'].map(id => cabin.root.getObjectByName(`loft-floor-${id}`));
    assert.ok(slabs.every(Boolean));
    const bounds = slabs.map(slab => new THREE.Box3().setFromObject(slab));
    for (let index = 0; index < slabs.length; index++) {
      const actual = bounds[index];
      assert.ok(cabin.rayBlockers.includes(slabs[index]));
      assert.ok(Math.abs(actual.max.y - LOFT.y) < 1e-6 && Math.abs(actual.min.y - (LOFT.y - LOFT.thickness)) < 1e-6);
      assert.ok(actual.min.x >= LOFT.minX - 1e-6 && actual.max.x <= LOFT.maxX + 1e-6 && actual.min.z >= LOFT.minZ - 1e-6 && actual.max.z <= LOFT.maxZ + 1e-6);
      assert.ok(actual.max.x <= STAIR_WELL.minX + 1e-6 || actual.min.x >= STAIR_WELL.maxX - 1e-6 || actual.max.z <= STAIR_WELL.minZ + 1e-6 || actual.min.z >= STAIR_WELL.maxZ - 1e-6, 'the full stair opening remains empty');
      for (const other of bounds.slice(index + 1)) assert.ok(actual.max.x <= other.min.x + 1e-6 || actual.min.x >= other.max.x - 1e-6 || actual.max.z <= other.min.z + 1e-6 || actual.min.z >= other.max.z - 1e-6, 'floor rectangles never overlap');
    }
    const area = bounds.reduce((sum, box) => sum + (box.max.x - box.min.x) * (box.max.z - box.min.z), 0);
    const expected = (LOFT.maxX - LOFT.minX) * (LOFT.maxZ - LOFT.minZ) - (STAIR_WELL.maxX - STAIR_WELL.minX) * (STAIR_WELL.maxZ - STAIR_WELL.minZ);
    assert.ok(Math.abs(area - expected) < 1e-5, 'coverage is the enlarged loft minus only the stair opening');
    const guardrail = new THREE.Box3().setFromObject(cabin.root.getObjectByName('loftGuardrail'));
    assert.ok(Math.abs((guardrail.min.x + guardrail.max.x) / 2 - LOFT.minX) < 1e-8);
    assert.ok(Math.abs(guardrail.min.y - LOFT.y) < 1e-6);
    assert.equal(cabin.root.children.filter(node => node.name.startsWith('armory-')).length, ARMORY.length);
  } finally { globalThis.document = previous; }
});
