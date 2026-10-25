import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { RAIDER_LOADOUTS, RAIDER_APPEARANCE } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';
import { ENEMY_PROFILES } from '../public/enemies.js';

// The real raider model from public/world.js, without DOM or GPU.
const world = await importPublicModule('world.js');
const { createRaider, animateRaider, startRaiderDeath, animateRaiderDeath, createSurvivor, setSurvivorWeapon, animateSurvivor, fireSurvivor, survivorMuzzle, createTracer, createZombie, setZombieBurn } = world;
const { sharedEffects } = await importPublicModule('fx.js');
const { bulletLook } = await importPublicModule('shot-fx.js');
const fx = sharedEffects();
const live = (pool, time) => {
  fx.update(time);
  const count = fx.pools[pool].mesh.geometry.instanceCount, array = fx.pools[pool].center.array;
  return Array.from({ length: count }, (_, index) => new THREE.Vector3(array[index * 3], array[index * 3 + 1], array[index * 3 + 2]));
};

const raiderGuns = [...new Set(Object.values(RAIDER_LOADOUTS).map(gun => gun.model))];
const settle = (model, state, seconds = 1, from = 0) => {
  for (let frame = 0; frame < seconds * 60; frame++) animateRaider(model, { ...state, time: from + frame / 60, delta: 1 / 60 });
};
const meshes = (root, visibleOnly = false) => { let count = 0; (visibleOnly ? root.traverseVisible : root.traverse).call(root, node => { if (node.isMesh) count++; }); return count; };
const materialsOf = root => { const list = []; root.traverse(node => { if (node.isMesh) list.push(node.material); }); return list; };
const hue = color => { const hsl = {}; color.getHSL(hsl); return hsl.h * 360; };
const hueGap = (a, b) => { const gap = Math.abs(a - b) % 360; return Math.min(gap, 360 - gap); };

test('raiders carry their real gun with no light, no shadow, no backpack and a bounded mesh budget', () => {
  for (const weapon of raiderGuns) {
    const raider = createRaider({ weapon, maxHp: 140 }), d = raider.userData;
    assert.deepEqual({ raider: d.raider, kind: d.kind, boss: d.boss, maxHp: d.maxHp, weaponType: d.weaponType }, { raider: true, kind: 'raider', boss: false, maxHp: 140, weaponType: weapon });
    assert.equal(d.gun.userData.type, weapon);
    assert.equal(d.backpack, null);
    let lights = 0, shadows = 0, pack = 0;
    raider.traverse(node => { if (node.isLight) lights++; if (node.isMesh && node.castShadow) shadows++; if (node.name?.startsWith('backpack') || node.name === 'survivorBackpack') pack++; });
    assert.equal(lights, 0, `${weapon}: no light, so no shader recompilation`);
    assert.equal(shadows, 0, `${weapon}: no shadow casting`);
    assert.equal(pack, 0, `${weapon}: no backpack geometry is built`);
    assert.ok(meshes(raider) <= 80, `${weapon}: ${meshes(raider)} meshes`);
    assert.equal(raider.getObjectByName('survivorBrim'), undefined, 'the cap brim gives way to a hood');
    for (const name of ['raiderHood', 'raiderBandana', 'raiderGoggles', 'raiderArmband']) assert.ok(raider.getObjectByName(name), name);
    let accents = 0; raider.traverse(node => { if (node.isMesh && /^raider(Bandana|Goggles|Armband|Chevron)$/.test(node.name)) accents++; });
    assert.ok(accents <= 6, `${accents} accent meshes`);
    for (const material of materialsOf(raider).filter(material => !d.flash.children.some(child => child.material === material))) {
      assert.equal(material.side, THREE.FrontSide, 'no double-sided accent planes');
    }
    for (const name of ['raiderBandana', 'raiderGoggles', 'raiderArmband', 'raiderChevron']) {
      assert.equal(raider.getObjectByName(name).material.type, 'MeshStandardMaterial', `${name}: reuses the standard program`);
    }
  }
  // A changed authoritative weapon swaps the held model without rebuilding the raider.
  const raider = createRaider({ weapon: 'smg', maxHp: 200 });
  setSurvivorWeapon(raider, 'assault');
  assert.equal(raider.userData.weaponType, 'assault'); assert.equal(raider.userData.gun.userData.type, 'assault');
  raider.traverse(node => { if (node.isMesh) assert.equal(node.castShadow, false); });
});

test('raider materials are new cached references; teammates keep every shared material and colour', () => {
  const before = createSurvivor(0x809fac), shared = materialsOf(before), colours = shared.map(material => material.color?.getHex());
  const first = createRaider({ weapon: 'rifle', maxHp: 300 }), second = createRaider({ weapon: 'pistol', maxHp: 140 });
  assert.deepEqual(materialsOf(before).map(material => material.color?.getHex()), colours, 'creating raiders recolours nothing a teammate uses');
  const after = createSurvivor(0x809fac);
  assert.equal(after.userData.backpack?.name, 'survivorBackpack', 'teammates still get their pack');
  assert.equal(after.userData.weaponType, 'pistol', 'and their starter pistol');
  assert.ok(after.getObjectByName('survivorBrim'), 'and their cap');
  for (const name of ['survivorCap', 'survivorBrim']) assert.equal(after.getObjectByName(name).material, before.getObjectByName(name).material);
  assert.equal(after.userData.vest.material, before.userData.vest.material);
  const raiderMaterials = new Set(materialsOf(first));
  for (const material of [before.userData.vest.material, before.getObjectByName('survivorCap').material, before.userData.legs[0].children[0].material]) {
    assert.equal(raiderMaterials.has(material), false, 'raiders never share the teammate vest, cap or trousers');
  }
  assert.equal(first.userData.torso.material, second.userData.torso.material, 'the jacket is one cached material for every raider');
  assert.notEqual(first.userData.torso.material, before.userData.torso.material);
  assert.equal(first.userData.arms[0].children[0].material, first.userData.torso.material);
  const empty = createSurvivor(0x809fac, { backpack: false, weapon: null });
  assert.equal(empty.userData.backpack, null); assert.equal(empty.userData.gun, null); assert.equal(empty.userData.weaponType, null);
});

test('the night-vision strip glows cold green-cyan, at least 90 degrees of hue away from every zombie eye', () => {
  const goggles = createRaider({ weapon: 'smg', maxHp: 140 }).getObjectByName('raiderGoggles').material;
  assert.ok(goggles.emissiveIntensity >= 2, 'readable at night like zombie eyes');
  assert.equal(goggles.color.getHex(), RAIDER_APPEARANCE.accentColor);
  const eyes = new Map();
  for (const [kind, boss] of [['walker', false], ['crawler', false], ['brute', true]]) {
    createZombie(kind, boss, kind === 'brute' ? 6000 : 80).userData.head.traverse(node => {
      if (node.isMesh && node.material.emissive?.getHex() && node.material.emissiveIntensity >= .5) eyes.set(node.material, kind);
    });
  }
  assert.equal(eyes.size, 3, 'walker, crawler and boss eyes are found');
  for (const [eye, kind] of eyes) {
    assert.ok(hueGap(hue(goggles.emissive), hue(eye.emissive)) >= 90, `${kind}: ${hue(goggles.emissive).toFixed(0)} vs ${hue(eye.emissive).toFixed(0)}`);
    assert.ok(hueGap(hue(goggles.color), hue(eye.color)) >= 90, `${kind} base colour`);
  }
  // The strip wraps the front and both sides of the head, beyond the hood.
  const raider = createRaider({ weapon: 'smg', maxHp: 140 }); raider.updateMatrixWorld(true);
  const strip = new THREE.Box3().setFromObject(raider.getObjectByName('raiderGoggles')), hood = new THREE.Box3().setFromObject(raider.getObjectByName('raiderHood'));
  assert.ok(strip.min.z < hood.min.z && strip.min.x < hood.min.x && strip.max.x > hood.max.x);
});

test('the muzzle sits on the barrel ahead of the raider and the shallow crouch matches the server hitbox', () => {
  for (const weapon of raiderGuns) {
    const raider = createRaider({ weapon, maxHp: 140 });
    raider.position.set(2, 0, 1); raider.rotation.y = Math.PI / 2; // facing -X
    settle(raider, { pitch: 0 });
    const standing = survivorMuzzle(raider).clone(), gun = raider.userData.gun;
    assert.ok(standing.distanceTo(gun.localToWorld(gun.userData.muzzle.clone())) < 1e-9, `${weapon}: the muzzle is the barrel end`);
    assert.ok(standing.x < 2 - .3 && Math.abs(standing.z - 1) < .35, `${weapon}: muzzle in front of the body`);
    assert.ok(standing.y > 1.1 && standing.y < 1.6, `${weapon}: shoulder height (${standing.y.toFixed(2)})`);
    settle(raider, { crouched: true }, 1, 1); raider.updateMatrixWorld(true);
    const head = new THREE.Vector3(); raider.userData.head.getWorldPosition(head);
    const profile = ENEMY_PROFILES.raider;
    assert.ok(Math.abs(head.y - profile.crouchHead) < .02, `${weapon}: crouched head ${head.y.toFixed(3)} vs server ${profile.crouchHead}`);
    assert.ok(head.y > profile.crouchHeadThreshold && head.y < profile.crouchHeight, 'the head lies inside the crouched headshot band');
    const crouched = survivorMuzzle(raider);
    assert.ok(crouched.y < standing.y - .3 && crouched.y > .75, `${weapon}: the gun drops with the shoulders (${crouched.y.toFixed(2)})`);
    for (const boot of raider.userData.boots) {
      const box = new THREE.Box3().setFromObject(boot);
      assert.ok(box.min.y > -.06 && box.min.y < .15, `${weapon}: feet stay near the floor (${box.min.y.toFixed(3)})`);
    }
    settle(raider, {}, 1, 2); raider.updateMatrixWorld(true); raider.userData.head.getWorldPosition(head);
    assert.ok(Math.abs(head.y - profile.head) < .01, 'standing again restores the standing head');
  }
  const teammate = createSurvivor(); for (let frame = 0; frame < 60; frame++) animateSurvivor(teammate, { crouched: true, time: frame / 60, delta: 1 / 60 });
  assert.ok(Math.abs(teammate.userData.head.position.y - .81) < .01, 'teammates keep their deeper crouch');
});

test('raider animation never moves the root while firing, reloading, burning or bashing planks', () => {
  const raider = createRaider({ weapon: 'assault', maxHp: 200 });
  raider.position.set(-12, 0, 4); raider.rotation.y = .4;
  settle(raider, {});
  const rest = { aim: raider.userData.aim.rotation.x, holder: raider.userData.holder.position.z };
  raider.userData.bashAt = 5;
  animateRaider(raider, { time: 5.16, delta: 1 / 60 });
  assert.ok(raider.userData.holder.position.z < rest.holder - .15, 'the butt-stroke drives the gun forward');
  assert.ok(raider.userData.aim.rotation.x < rest.aim - .3, 'and down');
  assert.equal(raider.userData.flash.visible, false, 'a bash shows no muzzle flash');
  settle(raider, {}, .5, 5.5);
  assert.ok(Math.abs(raider.userData.holder.position.z - rest.holder) < 1e-6, 'the stroke ends');
  setZombieBurn(raider, true); fx.clear();
  for (let frame = 0; frame <= 20; frame++) animateRaider(raider, { time: 7 + frame / 60, delta: 1 / 60 });
  const flames = live('glow', 7.34);
  assert.ok(flames.length > 3, 'a burning raider flames');
  assert.ok(flames.every(point => point.distanceTo(new THREE.Vector3(-12, 1.1, 4)) < 2.6), 'burn particles ride the raider rig');
  for (const state of [{ reloading: true }, { crouched: true, pitch: .6 }, { pitch: -.5 }]) {
    fireSurvivor(raider, 8); settle(raider, state, .5, 8);
    assert.deepEqual(raider.position.toArray(), [-12, 0, 4]);
    assert.equal(raider.rotation.y, .4); assert.equal(raider.rotation.x, 0); assert.equal(raider.rotation.z, 0);
  }
  setZombieBurn(raider, false); fx.clear(); animateRaider(raider, { time: 9 }); assert.equal(live('glow', 9.01).length, 0, 'the fire goes out');
});

test('a dead raider turns along the killing shot, falls on its back, sinks and is removed at 3 s', () => {
  for (const [directionX, directionZ] of [[1, 0], [0, -1], [-.6, .8]]) {
    const raider = createRaider({ weapon: 'smg', maxHp: 140 });
    raider.position.set(5, 0, -3); raider.rotation.y = 2.5;
    settle(raider, {});
    fireSurvivor(raider, 0);
    startRaiderDeath(raider, { time: 1, directionX, directionZ });
    let alive = true, time = 1;
    for (; time < 2.2; time += 1 / 60) alive = animateRaiderDeath(raider, time);
    assert.equal(alive, true);
    assert.equal(raider.userData.flash.visible, false, 'a corpse never flashes');
    raider.updateMatrixWorld(true);
    const head = new THREE.Vector3(); raider.userData.head.getWorldPosition(head);
    const along = ((head.x - 5) * directionX + (head.z + 3) * directionZ) / Math.hypot(directionX, directionZ);
    const across = Math.abs((head.x - 5) * directionZ - (head.z + 3) * directionX) / Math.hypot(directionX, directionZ);
    assert.ok(along > 1.2 && across < .35, `falls along the shot (${along.toFixed(2)}, ${across.toFixed(2)})`);
    assert.ok(head.y < .6, 'lying on the ground');
    for (; time < 3.99; time += 1 / 60) assert.equal(animateRaiderDeath(raider, time), true);
    assert.ok(raider.position.y < -.4, 'it sinks out of sight');
    assert.equal(animateRaiderDeath(raider, 4), false);
  }
  assert.equal(animateRaiderDeath(createRaider({ weapon: 'pistol', maxHp: 140 }), 1), false, 'no death without a start');
});

test('hostile bullets keep the tracer timing in a reddish colour; friendly bullets stay warm', () => {
  const friendly = bulletLook('smg'), hostile = bulletLook('smg', { hostile: true });
  assert.equal(friendly.color, 0xfff0c8);
  for (const hex of [hostile.color, hostile.trail]) {
    const color = new THREE.Color(hex);
    assert.ok(color.r > color.g + .3 && color.r > color.b + .3, 'reddish');
  }
  const start = new THREE.Vector3(0, 1.4, 0), end = new THREE.Vector3(0, 1.4, -20);
  const a = createTracer(start, end, { time: 0, weapon: 'smg' }), b = createTracer(start, end, { time: 0, weapon: 'smg', hostile: true });
  for (const time of [0, .05, .2, .5]) assert.equal(b.update(time), a.update(time));
  a.dispose(); b.dispose();
});

