import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { enemyAppearance } from '../public/enemies.js';
import { INTERIOR_DOORWAYS, INTERIOR_PASSAGES } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

// Instantiate production meshes: no DOM, WebGL, generated mock or screenshot assertion.
const { createZombie, animateZombie } = await importPublicModule('world.js');
const healths = [80, 115, 165, 230, 310, 400];
const skin = model => model.userData.head.children.find(child => child.isMesh).material;
const meshCount = group => { let total = 0; group.traverse(child => { if (child.isMesh) total++; }); return total; };

test('all six normal health families have distinct skin, fabric and cosmetic markers on real models', () => {
  const models = healths.map(hp => createZombie('walker', false, hp));
  assert.equal(new Set(models.map(model => skin(model).color.getHex())).size, healths.length);
  assert.equal(new Set(models.map(model => model.userData.appearanceId)).size, healths.length);
  for (const [index, model] of models.entries()) {
    const appearance = enemyAppearance({ kind: 'walker', maxHp: healths[index] });
    assert.equal(skin(model).color.getHex(), appearance.color);
    // The torso, first mesh of the posable body, wears the family fabric.
    const torso = model.userData.body.children.find(child => child.isMesh);
    assert.equal(torso.name, 'zombieTorso');
    assert.equal(torso.material.color.getHex(), appearance.clothColor);
    assert.equal(model.userData.maxHp, healths[index]);
    assert.equal(model.userData.appearanceId, appearance.id);
    assert.equal(model.userData.healthMarker.name, 'healthMarker');
    if (index) assert.ok(meshCount(model.userData.healthMarker) + meshCount(model.userData.head.getObjectByName('healthHeadMarker')) > 0);
  }
});

test('health markings leave anatomy, scale and animation anchors intact', () => {
  for (const kind of ['walker', 'runner', 'armored', 'crawler']) {
    const baseline = createZombie(kind, false, 80);
    for (const hp of healths) {
      const model = createZombie(kind, false, hp);
      assert.deepEqual(model.scale.toArray(), baseline.scale.toArray());
      for (const part of ['head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
        assert.deepEqual(model.userData[part].position.toArray(), baseline.userData[part].position.toArray(), `${kind}/${hp}/${part}`);
      }
      model.userData.phase = 0;
      model.position.set(2, 0, -3);
      for (const time of [0, .1, .3, .5, 1]) {
        animateZombie(model, time, true, 1 / 60);
        assert.deepEqual(model.position.toArray(), [2, 0, -3]);
        if (kind === 'crawler') assert.ok(new THREE.Box3().setFromObject(model).max.y < .85, 'a marker never makes the crawler standing-height');
      }
    }
  }
});

test('crawler appearance follows its own maximum HP instead of its normal-wave counterpart', () => {
  const low = createZombie('crawler', false, 36), high = createZombie('crawler', false, 180);
  assert.equal(low.userData.appearanceId, enemyAppearance({ kind: 'crawler', maxHp: 36 }).id);
  assert.equal(high.userData.appearanceId, enemyAppearance({ kind: 'crawler', maxHp: 180 }).id);
  assert.notEqual(low.userData.appearanceId, high.userData.appearanceId);
  assert.notEqual(high.userData.appearanceId, createZombie('walker', false, 400).userData.appearanceId);
});

test('colossus families and the final boss keep their physical scale and separate readable markings', () => {
  const models = [700, 1000, 1400].map(hp => createZombie('brute', false, hp));
  models.push(createZombie('brute', true, 3600));
  assert.equal(new Set(models.map(model => model.userData.appearanceId)).size, 4);
  assert.equal(new Set(models.map(model => skin(model).color.getHex())).size, 4);
  for (const [index, model] of models.entries()) {
    assert.equal(model.scale.x, index === 3 ? 1.32 : 1.22);
    assert.ok(meshCount(model.userData.healthMarker) > 0);
    assert.equal(model.userData.head.position.y, 1.68);
  }
  assert.ok(meshCount(models[3]) > meshCount(models[2]), 'the final boss retains its own cage silhouette');
});

test('the full Overlord including its crown fits both open ends and exterior doors in every animation', () => {
  assert.equal(INTERIOR_DOORWAYS.length, 0, 'the short screen has no artificial interior lintel');
  assert.equal(INTERIOR_PASSAGES.length, 2, 'clearance is measured against two real routes, never an empty list');
  const interiorHeight = Math.min(...INTERIOR_PASSAGES.map(passage => passage.height));
  const interiorWidth = Math.min(...INTERIOR_PASSAGES.map(passage => passage.maxX - passage.minX));
  assert.ok(Number.isFinite(interiorHeight) && Number.isFinite(interiorWidth));
  let observedTop = 0;
  for (const phase of [0, .8, 1.6]) for (const state of ['idle', 'walk', 'attack', 'recoil']) {
    const model = createZombie('brute', true, 3600);
    Object.assign(model.userData, { phase, attackAt: state === 'attack' ? 0 : -Infinity,
      pushX: state === 'recoil' ? 100 : 0, pushZ: state === 'recoil' ? 100 : 0 });
    model.rotation.y = Math.PI / 4;
    for (let frame = 0; frame < 90; frame++) {
      animateZombie(model, frame / 120, state !== 'idle', 1 / 120);
      const bounds = new THREE.Box3().setFromObject(model);
      observedTop = Math.max(observedTop, bounds.max.y);
      assert.ok(bounds.max.y < interiorHeight, `${state}: visual top ${bounds.max.y} fits the ${interiorHeight} m ground-floor escape route`);
      assert.ok(bounds.max.y < 2.8, 'the model also clears the exterior door');
      assert.ok(bounds.max.x - bounds.min.x < interiorWidth, 'the full visual width fits both open ends even when angled');
      assert.ok(bounds.max.x - bounds.min.x < 2.6, 'the complete angled model also fits the narrower exterior doors');
    }
  }
  assert.ok(observedTop > 2.5, 'the assertion measures the actual tall boss model, not an ordinary placeholder');
});

test('creating another family never recolors existing shared materials and charcoal stays identifiable in low light', () => {
  const first = createZombie('walker', false, 80), original = skin(first).color.getHex();
  for (const hp of [...healths, 700, 1000, 1400, 3600]) createZombie(hp > 400 ? 'brute' : 'walker', hp === 3600, hp);
  assert.equal(skin(first).color.getHex(), original);
  const another = createZombie('walker', false, 80);
  assert.equal(skin(first), skin(another), 'unchanging family materials can be shared safely');
  const charcoal = createZombie('walker', false, 400), accent = charcoal.userData.healthMarker.children[0].material;
  assert.ok(accent.color.getHSL({}).l > skin(charcoal).color.getHSL({}).l + .2);
  assert.ok(accent.emissiveIntensity > 0 && accent.emissiveIntensity <= .2, 'subtle ash remains visible without neon lighting');
  const defaultModel = createZombie();
  assert.equal(defaultModel.userData.kind, 'walker');
  assert.equal(defaultModel.userData.boss, false);
});
