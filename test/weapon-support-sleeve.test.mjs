import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { applyWeaponViewPose } from '../public/weapon-view.js';
import { importPublicModule } from './helpers/public-modules.mjs';

// The support hand's forearm (weapon-racks lot, 24 October 2026). Every
// two-handed gun had two box hands and only the firing arm's sleeve, so the
// support hand floated under the forend. Each gun now has a second sleeve,
// from that hand toward the lower left; the melee weapons keep theirs.
const world = await importPublicModule('world.js');
const weapons = await importPublicModule('frisson/weapons.js');
const { readGlb } = await importPublicModule('frisson/glb.js');
const GUNS = ['pistol', 'magnum', 'smg', 'assault', 'rifle', 'shotgun', 'sniper', 'minigun', 'rocket', 'flamethrower'];
const MELEE = ['bat', 'fireaxe', 'hammer', 'katana'];
const HAND = 0xb89171, SLEEVE = 0x3e4a43; // the Famille skin and sleeve

const meshesOf = root => { const list = []; root.traverse(node => { if (node.isMesh) list.push(node); }); return list; };
const coloured = (root, hex) => meshesOf(root).filter(mesh => mesh.material.color?.getHex() === hex);
// A box mesh's eight corners in the gun's frame.
function corners(mesh, frame) {
  frame.updateMatrixWorld(true);
  const { width, height, depth } = mesh.geometry.parameters, matrix = new THREE.Matrix4().copy(frame.matrixWorld).invert().multiply(mesh.matrixWorld), points = [];
  for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) points.push(new THREE.Vector3(x * width, y * height, z * depth).applyMatrix4(matrix));
  return points;
}

test('every gun has two hands and two sleeves, the second one leaving the support hand toward the lower left', () => {
  for (const type of GUNS) {
    const gun = world.createWeapon(type);
    gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0);
    const hands = coloured(gun, HAND), sleeves = coloured(gun, SLEEVE);
    assert.equal(hands.length, 2, `${type}: two hands`);
    assert.equal(sleeves.length, 2, `${type}: a sleeve for each hand`);
    // The support hand is the forward one; its sleeve is the one nearest it.
    const centre = mesh => new THREE.Box3().setFromPoints(corners(mesh, gun)).getCenter(new THREE.Vector3());
    const [support] = [...hands].sort((a, b) => centre(a).z - centre(b).z), hand = centre(support);
    const [sleeve] = [...sleeves].sort((a, b) => centre(a).distanceTo(hand) - centre(b).distanceTo(hand));
    const box = new THREE.Box3().setFromPoints(corners(sleeve, gun));
    // It starts at the hand: the sleeve's box reaches into the hand's.
    const handBox = new THREE.Box3().setFromPoints(corners(support, gun));
    assert.ok(box.intersectsBox(handBox), `${type}: the sleeve meets the support hand`);
    // And runs down, left and back toward the player's elbow.
    const far = corners(sleeve, gun).reduce((best, point) => point.z > best.z ? point : best);
    assert.ok(far.y < hand.y - .1 && far.x < hand.x - .05 && far.z > hand.z + .15, `${type}: far end ${far.toArray().map(v => v.toFixed(3))} from the hand ${hand.toArray().map(v => v.toFixed(3))}`);
  }
  for (const type of MELEE) {
    const weapon = world.createWeapon(type);
    assert.equal(coloured(weapon, HAND).length, 2, `${type}: two hands`);
    assert.equal(coloured(weapon, SLEEVE).length, 1, `${type}: one sleeve, unchanged`);
  }
});

test('on screen, the long guns show the support sleeve under the hand, clear of the near plane and the aiming band', () => {
  for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
    const camera = new THREE.PerspectiveCamera(76, aspect, .06, 130); camera.updateMatrixWorld(true);
    for (const type of GUNS) {
      const gun = world.createWeapon(type); applyWeaponViewPose(gun); gun.updateMatrixWorld(true);
      const hand = coloured(gun, HAND).sort((a, b) => a.position.z - b.position.z)[0].getWorldPosition(new THREE.Vector3());
      const sleeve = coloured(gun, SLEEVE).sort((a, b) => a.getWorldPosition(new THREE.Vector3()).distanceTo(hand) - b.getWorldPosition(new THREE.Vector3()).distanceTo(hand))[0];
      let inside = 0;
      for (const point of corners(sleeve, gun).map(local => gun.localToWorld(local))) {
        assert.ok(point.z < -camera.near, `${type} at ${aspect.toFixed(2)}: no near-plane clipping`);
        const ndc = point.clone().project(camera);
        assert.ok(ndc.y < -.12, `${type}: the central aiming band stays clear`);
        if (Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) inside++;
      }
      if (!['pistol', 'magnum'].includes(type)) assert.ok(inside >= 2, `${type} at ${aspect.toFixed(2)}: the support sleeve is seen (${inside} corners on screen)`);
    }
  }
});

test('held, rack and ground copies drop both sleeves; Frisson dresses the new one with the sleeve recipe', () => {
  for (const type of GUNS) {
    for (const copy of [world.createHeldWeapon(type), world.createGroundWeapon(type), world.createArmoryRack(type)])
      assert.deepEqual([...coloured(copy, HAND), ...coloured(copy, SLEEVE)], [], `${type}: no first-person hand or sleeve outside the first person`);
  }
  const style = weapons.createWeaponsStyle({ roots: weapons.weaponsFromGlb(readGlb(readFileSync(new URL('../public/frisson/weapons.glb', import.meta.url)))), quality: 'high' });
  world.setWeaponStyle(style);
  try {
    for (const type of GUNS) {
      const sleeves = meshesOf(world.createWeapon(type)).filter(mesh => mesh.material.name === 'frisson:firstPersonSleeve');
      assert.equal(sleeves.length, 2, `${type}: both sleeves wear the Frisson sleeve`);
      assert.equal(sleeves[0].material, sleeves[1].material, `${type}: one shared recipe material`);
    }
  } finally { world.setWeaponStyle(null); style.dispose(); }
});
