import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { EXPEDITION, GENERATOR, FUEL_CACHES, rainRoofHeight, hasRainShelter, PARTITION_CAPS, partitionCapHeight, SPAWN_ENTRIES } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWorld, createSurvivor, animateSurvivor } = await importPublicModule('world.js');
const canvasDocument = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
function setup() {
  const old = globalThis.document; globalThis.document = canvasDocument;
  try { const scene = new THREE.Scene(), world = createWorld(scene); return { scene, world, camera: new THREE.PerspectiveCamera() }; }
  finally { globalThis.document = old; }
}
const player = (id, extra = {}) => ({ id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: true, downed: false, umbrella: { open: false, remaining: 100, max: 100 }, ...extra });
const snapshot = (players, extra = {}) => ({ wave: 1, players, spawnWarnings: [], expedition: { enabled: true, generator: { ...GENERATOR, power: 1, active: false }, fuel: null }, ...extra });
const update = (world, state, time = 1, extra = {}) => world.update(time, { snapshot: state, myId: 'me', active: true, ...extra });

test('the enlarged clearing and fuel routes use server bounds and the three shared caches', () => {
  const { world } = setup(), clearing = world.root.getObjectByName('expedition-clearing');
  assert.equal(clearing.geometry.parameters.width, EXPEDITION.bounds.maxX - EXPEDITION.bounds.minX + 1);
  assert.equal(clearing.geometry.parameters.depth, EXPEDITION.bounds.maxZ - EXPEDITION.bounds.minZ + 1);
  assert.deepEqual(world.expedition.cacheMarkers.map(marker => marker.position.toArray()), FUEL_CACHES.map(cache => [cache.x, cache.y, cache.z]));
  assert.deepEqual(world.expedition.generator.position.toArray(), [GENERATOR.x, GENERATOR.y, GENERATOR.z]);
  assert.equal(world.expedition.spawnEntries.userData.anchors, SPAWN_ENTRIES);
  assert.equal(world.expedition.spawnEntries.children.length, 4, 'all eight ground-level entries use four static batches');
  assert.doesNotThrow(() => world.update(10), 'the historical world.update(time) contract stays usable');
});

test('rain reuses one buffer, falls outside the exact roof and stops in practice or inactive games', () => {
  const { world } = setup(), { rain } = world.expedition;
  const geometry = rain.geometry, buffer = geometry.attributes.position.array;
  const state = snapshot([player('me', { x: 12, z: 3 })]);
  let outdoors = 0, aboveRoof = 0;
  for (const time of [0, .4, 2, 20, 100, NaN]) {
    update(world, state, time);
    assert.equal(rain.geometry, geometry); assert.equal(rain.geometry.attributes.position.array, buffer);
    for (let index = 0; index < buffer.length; index += 6) {
      const [x, y, z, endX, endY, endZ] = buffer.subarray(index, index + 6);
      assert.ok([x, y, z, endX, endY, endZ].every(Number.isFinite));
      if (y < -10) continue;
      if (hasRainShelter({ x, y: 0, z }, 0)) { assert.ok(endY > rainRoofHeight(x) - .00001); aboveRoof++; }
      else outdoors++;
    }
  }
  assert.ok(outdoors > 100); assert.ok(aboveRoof > 50);
  update(world, { ...state, expedition: { ...state.expedition, enabled: false } });
  assert.equal(rain.visible, false); assert.equal(world.expedition.generator.visible, true, 'the physical generator stays visible at the practice stand');
  world.update(2, { snapshot: state, active: false }); assert.equal(rain.visible, false);
});

test('local and team umbrellas follow equipment state and actual smoothed actor positions', () => {
  const { world, scene, camera } = setup();
  const survivor = createSurvivor(); survivor.position.set(5, 0, 2); survivor.rotation.y = .7; scene.add(survivor);
  for (let frame = 0; frame < 60; frame++) animateSurvivor(survivor, { crouched: true, delta: 1 / 60 });
  const state = snapshot([player('me', { umbrella: { open: true, remaining: 80, max: 100 } }), player('team', { x: 1, z: 1, crouched: true, umbrella: { open: true, remaining: 12, max: 100 } })]);
  update(world, state, 1, { camera, survivors: new Map([['team', survivor]]) });
  const { localUmbrella, teamSlots } = world.expedition, team = teamSlots[0];
  assert.equal(localUmbrella.parent, camera); assert.equal(localUmbrella.visible, true);
  assert.equal(team.umbrella.visible, true); assert.equal(team.umbrella.position.x, 5); assert.equal(team.umbrella.position.z, 2);
  assert.ok(team.umbrella.position.y < 1.28 && team.umbrella.position.y > 1.24);
  assert.notEqual(team.umbrella.userData.canopy.material.color.getHex(), localUmbrella.userData.canopy.material.color.getHex());
  state.players[1].downed = true; state.players[0].umbrella.open = false;
  update(world, state, 2, { camera });
  assert.equal(localUmbrella.visible, false); assert.equal(team.umbrella.visible, false);
});

test('rain stops beneath a teammate canopy at its actual crouched height', () => {
  const { world } = setup(), { rainSeeds, rain } = world.expedition;
  rainSeeds.set([12, .7, 8], 0); rainSeeds.set([12, 1.8, 8], 3);
  const state = snapshot([player('me'), player('team', { x: 12, z: 8, crouched: true, umbrella: { open: true, remaining: 100, max: 100 } })]);
  update(world, state, 0);
  assert.equal(rain.geometry.attributes.position.array[1], -20, 'the drop below the crouched canopy is omitted');
  assert.ok(rain.geometry.attributes.position.array[7] > 1.7, 'rain above that canopy remains visible');
  state.players[1].umbrella.open = false; update(world, state, 0);
  assert.ok(rain.geometry.attributes.position.array[1] > .69, 'closing it restores the exposed drop');
});

test('a fuel can is either at its cache or on exactly one carrier, with no duplicate pickup', () => {
  const { world, camera } = setup(), state = snapshot([player('me'), player('a'), player('b')]);
  state.expedition.fuel = { ...FUEL_CACHES[0], carrierId: null };
  update(world, state);
  assert.equal(world.expedition.fuel.visible, true);
  assert.equal(world.expedition.teamSlots.filter(slot => slot.carriedFuel.visible).length, 0);
  state.expedition.fuel.carrierId = 'b'; state.players[2].carryingFuel = true;
  update(world, state, 2);
  assert.equal(world.expedition.fuel.visible, false);
  assert.equal(world.expedition.teamSlots.filter(slot => slot.carriedFuel.visible).length, 1);
  state.expedition.fuel.carrierId = 'me'; state.players[0].carryingFuel = true; update(world, state, 2.5, { camera });
  assert.equal(world.expedition.localFuel.visible, true); assert.equal(world.expedition.localFuel.parent, camera);
  assert.equal(world.expedition.teamSlots.filter(slot => slot.carriedFuel.visible).length, 0);
  state.expedition.fuel = null; update(world, state, 3);
  assert.equal(world.expedition.fuel.visible, false);
  assert.equal(world.expedition.teamSlots.filter(slot => slot.carriedFuel.visible).length, 0);
});

test('the wooden cap follows the shared pitch, with no opaque box across the empty upper triangle', () => {
  const { world } = setup(), cap = PARTITION_CAPS[0], mesh = world.root.getObjectByName('partitionPitchedCap');
  assert.equal(mesh.userData.partitionCap, cap); assert.ok(world.rayBlockers.includes(mesh));
  world.root.updateMatrixWorld(true);
  const caster = new THREE.Raycaster();
  for (const z of [cap.minZ + .02, (cap.minZ + cap.maxZ) / 2, cap.maxZ - .02]) {
    caster.set(new THREE.Vector3(-.5, 4, z), new THREE.Vector3(0, -1, 0));
    const hit = caster.intersectObject(mesh, false)[0];
    assert.ok(hit); assert.ok(Math.abs(hit.point.y - partitionCapHeight(cap, z)) < 1e-6);
  }
  const z = cap.maxZ - .02, y = partitionCapHeight(cap, z) + .04;
  caster.set(new THREE.Vector3(cap.minX - .5, y, z), new THREE.Vector3(1, 0, 0));
  assert.equal(caster.intersectObject(mesh, false).length, 0, 'a horizontal ray above the slope crosses real empty air');
});

test('three fixed lights follow aim, shorten before surviving planks and turn off when players leave', () => {
  const { world, scene } = setup(), state = snapshot([player('me'), player('a', { x: 0, z: -4.8 })]);
  const lights = world.expedition.teamSlots.map(slot => slot.light);
  update(world, state, 1);
  const closed = lights[0].distance;
  assert.ok(closed > .1 && closed < 2, `surviving door boards truncate the cone (${closed})`);
  world.setDoor('north', 0, [0, 0, 0, 0, 0]); update(world, state, 2);
  assert.ok(lights[0].distance > closed + 1, 'an actual opening releases the cone');
  world.setDoor('north', 1, [60, 60, 60, 60, 60], true); update(world, state, 3);
  assert.ok(lights[0].distance < 2, 'the opaque plate truncates the cone while every wooden board is hidden');
  world.setDoor('north', 0, [0, 0, 0, 0, 0], false); update(world, state, 4);
  assert.ok(lights[0].distance > closed + 1, 'an unsealed invisible plate cannot block the beam');
  assert.equal(lights[0].castShadow, false); assert.equal(lights[1].intensity, 0); assert.equal(lights[2].intensity, 0);
  assert.ok(world.rayBlockers.some(mesh => mesh.name === 'generatorOcclusion'));
  const count = []; scene.traverse(node => { if (node.isSpotLight) count.push(node); }); assert.equal(count.length, 3);
  state.players = [player('me')]; update(world, state, 5);
  assert.deepEqual(world.expedition.teamSlots.map(slot => slot.light), lights);
  assert.ok(lights.every(light => light.intensity === 0));
});

test('night and generator power preserve ambient visibility and keep local flashlight ownership unchanged', () => {
  const { world, scene } = setup(), state = snapshot([player('me')]);
  update(world, state, 1);
  const lamps = [], ambient = []; scene.traverse(node => { if (node.isPointLight) lamps.push(node); if (node.isHemisphereLight || node.isDirectionalLight) ambient.push(node); });
  const start = lamps.map(light => light.intensity), startAmbient = ambient.map(light => light.intensity);
  state.wave = 20; state.expedition.generator.power = .2; update(world, state, 1);
  lamps.forEach((light, index) => assert.ok(Math.abs(light.intensity / start[index] - .2) < 1e-8));
  ambient.forEach((light, index) => assert.ok(light.intensity > 0 && light.intensity < startAmbient[index]));
  assert.equal(world.expedition.gauge.scale.x, .2);
});

test('teammate beams stop at the real table surface and loft slab when aimed into them', () => {
  const { world } = setup(), state = snapshot([player('me'), player('a', { x: -.9, z: 1.4, pitch: -.55 })]);
  update(world, state, 1);
  assert.ok(world.expedition.teamSlots[0].length < 2, 'the downward cone reaches the table before the floor');
  Object.assign(state.players[1], { x: 6, z: -.5, pitch: .6 }); update(world, state, 2);
  assert.ok(world.expedition.teamSlots[0].length > .2 && world.expedition.teamSlots[0].length < 4, 'the upward cone ends beneath the loft slab');
});

test('spawn warnings have a bounded reusable pool and never create zombies in rendering', () => {
  const { world } = setup(), state = snapshot([player('me')]);
  state.spawnWarnings = Array.from({ length: 45 }, (_, index) => ({ id: `w${index}`, x: 12 + index / 20, y: 0, z: 8, remaining: 1.5 }));
  const rings = world.expedition.warningRings, bodies = world.expedition.warningBodies;
  update(world, state);
  assert.equal(rings.count, 32); assert.equal(bodies.count, 32);
  assert.equal(rings.castShadow, false); assert.equal(bodies.castShadow, false);
  const matrix = new THREE.Matrix4(); rings.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[12] - state.spawnWarnings[0].x) < 1e-6);
  assert.ok(Math.abs(matrix.elements[14] - state.spawnWarnings[0].z) < 1e-6);
  state.spawnWarnings = []; update(world, state, 2);
  assert.equal(rings.count, 0); assert.equal(bodies.count, 0);
  assert.equal(world.expedition.warningRings, rings); assert.equal(world.expedition.warningBodies, bodies);
});
