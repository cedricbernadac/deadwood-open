import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { BACKPACK, LATE_SUPPLIES, GENERATOR, FUEL_CACHES } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWorld, createBackpack, createSurvivor, animateSurvivor, setSurvivorWeapon, survivorMuzzle } =
  await importPublicModule('world.js');
const canvasDocument = { createElement: () => ({ width: 0, height: 0,
  getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) },
    { get: (object, key) => key in object ? object[key] : () => {} }) }) };
function world() {
  const previous = globalThis.document; globalThis.document = canvasDocument;
  try { const scene = new THREE.Scene(); return { scene, world: createWorld(scene) }; }
  finally { globalThis.document = previous; }
}
function pose(survivor, state = {}, frames = 180) {
  for (let frame = 0; frame < frames; frame++) animateSurvivor(survivor, { ...state, delta: 1 / 60, time: frame / 60 });
  survivor.updateWorldMatrix(true, true);
}
const resources = object => {
  const result = []; object.traverse(node => result.push([node.uuid, node.geometry?.uuid, node.material?.uuid])); return result;
};

test('the original canvas backpack is compact, readable and adds no lights or shadow casters', () => {
  const pack = createBackpack(), bounds = new THREE.Box3().setFromObject(pack);
  assert.ok(bounds.getSize(new THREE.Vector3()).x < .5);
  assert.ok(bounds.getSize(new THREE.Vector3()).y < .6);
  let meshes = 0;
  pack.traverse(node => {
    assert.equal(Boolean(node.isLight), false);
    if (!node.isMesh) return;
    meshes++; assert.equal(node.castShadow, false); assert.ok(node.material.roughness >= .6);
    assert.ok([...node.geometry.attributes.position.array].every(Number.isFinite));
  });
  assert.ok(meshes > 10 && meshes <= 24, 'pockets and straps use a bounded, static model');
  for (const name of ['backpackCanvasBody', 'backpackRearPocket', 'backpackShoulderStrap', 'backpackRearBuckle'])
    assert.ok(pack.getObjectByName(name), `missing silhouette feature: ${name}`);
});

test('the authoritative backpack follows crouch and downed poses without changing weapons or recreating resources', () => {
  const survivor = createSurvivor(), data = survivor.userData, pack = data.backpack;
  assert.equal(pack.parent, data.body); assert.equal(pack.visible, false);
  const original = resources(pack), holder = data.holder;
  for (const invalid of [undefined, false, 1, 'true']) { pose(survivor, { backpack: invalid }, 1); assert.equal(pack.visible, false); }
  pose(survivor, { backpack: true });
  const standingY = pack.getWorldPosition(new THREE.Vector3()).y;
  pose(survivor, { backpack: true, crouched: true });
  assert.equal(pack.visible, true); assert.ok(pack.getWorldPosition(new THREE.Vector3()).y < standingY - .5);
  pose(survivor, { backpack: true, downed: true });
  const bounds = new THREE.Box3().setFromObject(pack);
  assert.ok(bounds.min.y >= -.001, `the downed pack must rest above the floor, got ${bounds.min.y}`);
  assert.ok(Math.abs(data.body.rotation.x - Math.PI * .47) < .01);
  pose(survivor, { backpack: false, downed: true });
  assert.equal(pack.visible, false); assert.ok(Math.abs(data.body.position.y - .16) < .001, 'without a pack, the historical downed pose stays unchanged');
  for (const weapon of ['smg', 'rifle', 'sniper', 'hammer', 'katana']) {
    setSurvivorWeapon(survivor, weapon); pose(survivor, { backpack: true, pitch: .3 });
    assert.equal(data.holder, holder); assert.equal(data.weaponType, weapon);
    if (!data.gun.userData.melee) assert.ok(survivorMuzzle(survivor).toArray().every(Number.isFinite));
  }
  assert.deepEqual(resources(pack), original, 'pose and weapon updates reuse every backpack mesh, geometry and material');
});

test('stopped world updates keep backpack ownership visible and leave fuel, umbrella and torch accessible', () => {
  const { scene, world: environment } = world(), survivor = createSurvivor(); scene.add(survivor);
  const player = { id: 'ally', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: true, downed: false, backpack: true,
    carryingFuel: true, umbrella: { open: true, remaining: 80, max: 100 } };
  const state = { wave: 10, players: [player], spawnWarnings: [],
    expedition: { enabled: true, generator: { ...GENERATOR, power: 1 }, fuel: { ...FUEL_CACHES[0], carrierId: player.id } } };
  const update = time => environment.update(time, { snapshot: state, myId: 'self', active: true, survivors: new Map([[player.id, survivor]]) });
  update(0); assert.equal(survivor.userData.backpack.visible, true, 'no animation tick is required on a paused arrival');
  pose(survivor, player);
  const team = environment.expedition.teamSlots[0]; update(1);
  assert.equal(team.umbrella.visible, true); assert.equal(team.carriedFuel.visible, true); assert.equal(team.torch.visible, true);
  scene.updateMatrixWorld(true);
  assert.equal(new THREE.Box3().setFromObject(survivor.userData.backpack).intersectsBox(new THREE.Box3().setFromObject(team.carriedFuel)), false);
  const position = team.carriedFuel.position.clone();
  player.backpack = false; update(2);
  assert.equal(survivor.userData.backpack.visible, false); assert.equal(team.carriedFuel.position.x, 0);
  assert.equal(team.carriedFuel.position.y, position.y); assert.equal(team.carriedFuel.position.z, position.z);
});

test('the existing equipment counter displays the same pack and the wave the post opens (the revive kit) without a new blocker', () => {
  const { world: environment } = world(), post = environment.lateSupplyPost;
  assert.ok(post.getObjectByName('backpackDisplay'));
  const opens = Math.min(...Object.values(LATE_SUPPLIES.items).map(item => item.unlockWave ?? LATE_SUPPLIES.unlockWave));
  assert.equal(opens, 5);
  assert.ok(post.children.some(node => node.userData.label === `ÉQUIPEMENT · VAGUE ${opens}`));
  assert.equal(environment.rayBlockers.some(blocker => { let node = blocker; while (node) { if (node === post) return true; node = node.parent; } return false; }), false);
});

test('equipment silhouettes show a vest neckline and a deep ammunition case within their original columns', () => {
  const { world: environment } = world(), post = environment.lateSupplyPost;
  const vest = post.getObjectByName('lateSupplyArmorDisplay'), ammunition = post.getObjectByName('lateSupplyAmmoDisplay');
  // Inspect in counter-local space, independent of the wall placement.
  const display = new THREE.Group(); display.add(vest.clone(true), ammunition.clone(true)); display.updateMatrixWorld(true);
  const [localVest, localAmmo] = display.children;
  const vestBounds = new THREE.Box3().setFromObject(localVest), ammoBounds = new THREE.Box3().setFromObject(localAmmo);
  assert.equal(vestBounds.intersectsBox(ammoBounds), false, 'the two separate equipment columns remain readable');
  for (const [bounds, centre] of [[vestBounds, .145], [ammoBounds, .415]]) {
    assert.ok(bounds.min.x >= centre - .125 - 1e-6 && bounds.max.x <= centre + .125 + 1e-6);
    assert.ok(bounds.min.y >= 1.2575 && bounds.max.y <= 1.8, 'both props stay above the shelf and below the existing pack');
    assert.ok(bounds.min.z > .0775 && bounds.max.z < .29, 'props stay in front of the backing and inside the original display depth');
  }
  assert.ok(ammoBounds.getSize(new THREE.Vector3()).z > .12, 'the ammunition case has a volumetric silhouette');
  const ray = new THREE.Raycaster(new THREE.Vector3(.145, 1.635, .8), new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(localVest, true).length, 0, 'the open neckline remains visibly cut out');
  ray.ray.origin.x += .055;
  assert.ok(ray.intersectObject(localVest, true).length > 0, 'a shoulder strap surrounds the open neckline');
  display.traverse(node => { assert.equal(Boolean(node.isLight), false); if (node.isMesh) assert.equal(node.castShadow, false); });
});
