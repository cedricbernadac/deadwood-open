import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { enemyAppearance, enemyProfile } from '../public/enemies.js';
import { zombieLook, hashSeed, seededRandom } from '../public/zombie-looks.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createZombie, animateZombie, startZombieDeath, animateZombieDeath, disposeZombie, setZombieHealth } = await importPublicModule('world.js');
const zombiesModule = await importPublicModule('zombies.js');
const ids = Array.from({ length: 160 }, (_, index) => `z${index}`);
const meshes = group => { const list = []; group.traverse(child => { if (child.isMesh) list.push(child); }); return list; };
const preciseBox = object => { object.updateMatrixWorld(true); return new THREE.Box3().setFromObject(object, true); };

test('the server id seeds the same look on every screen, and ids differ visibly', () => {
  assert.deepEqual(zombieLook('z42', { kind: 'walker' }), zombieLook('z42', { kind: 'walker' }));
  const a = createZombie('walker', false, 115, 'z42'), b = createZombie('walker', false, 115, 'z42');
  assert.deepEqual(meshes(a).map(mesh => mesh.geometry.attributes.position.count), meshes(b).map(mesh => mesh.geometry.attributes.position.count));
  const signature = look => [look.build, look.skull, look.eyes, look.mouth, look.hair, look.hat, look.top].join('/');
  assert.ok(new Set(ids.map(id => signature(zombieLook(id)))).size > 120, 'at least three looks in four are unique');
  for (const field of ['skull', 'eyes', 'mouth', 'hat', 'top', 'build']) {
    assert.ok(new Set(ids.map(id => zombieLook(id)[field])).size >= 4, `${field} varies`);
  }
  const random = seededRandom(hashSeed('z1')), values = Array.from({ length: 1000 }, random);
  assert.ok(values.every(value => value >= 0 && value < 1));
  assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) / values.length - .5) < .05);
});

test('variety never blurs the health family: skin, fabric and marker stay the toughness cue', () => {
  for (const hp of [80, 115, 165, 230, 310, 400]) {
    const appearance = enemyAppearance({ kind: 'walker', maxHp: hp });
    const skins = new Set(), cloths = new Set();
    for (const id of ids.slice(0, 40)) {
      const model = createZombie('walker', false, hp, id);
      skins.add(model.userData.head.children[0].material); cloths.add(model.userData.body.children[0].material);
      assert.equal(model.userData.appearanceId, appearance.id);
      assert.equal(model.userData.healthMarker.name, 'healthMarker');
    }
    assert.equal(skins.size, 1, 'one shared, never recoloured skin material per family');
    assert.equal(cloths.size, 1);
    assert.equal([...skins][0].color.getHex(), appearance.color);
    assert.equal([...cloths][0].color.getHex(), appearance.clothColor);
  }
});

test('every variant keeps the visual head on the server head band', () => {
  for (const kind of ['walker', 'runner', 'armored']) {
    const profile = enemyProfile({ kind });
    for (const id of ids) {
      const model = createZombie(kind, false, 165, id);
      assert.equal(model.userData.head.position.y, 1.68);
      model.updateMatrixWorld(true);
      const skull = new THREE.Box3().setFromObject(model.userData.head.children[0], true);
      assert.ok(skull.min.y <= profile.headThreshold + .03, `${kind}/${id} skull reaches down to the head-shot line`);
      assert.ok(skull.max.y >= profile.height - .03 && skull.max.y <= profile.height + .1, `${kind}/${id} skull top ${skull.max.y.toFixed(3)}`);
      assert.ok(preciseBox(model).max.y < profile.height + .2, 'hats stay close to the hitbox');
    }
  }
});

test('crawlers stay crawler-height in every variant, attack and step', () => {
  for (const id of ids) {
    const model = createZombie('crawler', false, 80, id);
    assert.ok(preciseBox(model).max.y <= .825, `${id} at rest`);
    model.userData.attackAt = 0;
    for (const time of [0, .1, .2, .3, .4, 1.3]) {
      animateZombie(model, time, true, 1 / 60);
      assert.ok(preciseBox(model).max.y < .85, `${id} at ${time}`);
    }
  }
});

test('merged parts keep each zombie within a small draw-call budget', () => {
  // Armoured kinds carry separately breakable pieces (damage stages).
  const budget = { walker: 17, runner: 17, armored: 21, crawler: 14, brute: 22 };
  for (const [kind, limit] of Object.entries(budget)) for (const id of ids.slice(0, 60)) {
    const count = meshes(createZombie(kind, false, kind === 'brute' ? 1000 : 165, id)).length;
    assert.ok(count <= limit, `${kind}/${id}: ${count} meshes`);
  }
  assert.ok(meshes(createZombie('brute', true, 6000, 'z1')).length <= 34, 'the overlord with its carapace and breakable armour');
  const lights = []; createZombie('brute', true, 6000, 'z2').traverse(child => { if (child.isLight) lights.push(child); });
  assert.equal(lights.length, 0);
});

test('eyes shine through the fog and the body poses on an inner group', () => {
  const model = createZombie('walker', false, 80, 'z7');
  const eyes = model.userData.head.getObjectByName('zombieEyes');
  assert.equal(eyes.material.fog, false);
  assert.ok(eyes.material.emissiveIntensity >= 1);
  model.position.set(3, 0, 2); model.rotation.y = .4;
  model.userData.hp = 80; model.userData.hitPending = true;
  for (let frame = 0; frame < 12; frame++) animateZombie(model, frame / 60, true, 1 / 60);
  assert.deepEqual(model.position.toArray(), [3, 0, 2], 'cosmetic animation never moves the server position');
  assert.equal(model.rotation.y, .4);
  assert.notDeepEqual(model.userData.body.scale.toArray(), [1, 1, 1], 'a landed hit squashes the body');
});

test('a dead zombie shares its puff geometry and frees only its own buffers', () => {
  const first = createZombie('walker', false, 80, 'z1'), second = createZombie('walker', false, 80, 'z2');
  const scene = new THREE.Scene(); scene.add(first, second);
  startZombieDeath(first, { time: 0, directionX: 1, directionZ: 0, headshot: true });
  startZombieDeath(second, { time: 0 });
  assert.equal(first.getObjectByName('zombiePoofSmoke').geometry, second.getObjectByName('zombiePoofSmoke').geometry);
  animateZombieDeath(first, .5);
  const hat = first.userData.hat;
  if (hat) {
    assert.equal(hat.parent, scene, 'a head shot pops the hat off into the world');
    assert.ok(hat.position.y > 1.6, 'it flies up above the falling body');
  }
  const disposed = new Set(), materialsDisposed = [];
  for (const mesh of meshes(first)) {
    mesh.geometry.addEventListener('dispose', () => disposed.add(mesh.geometry));
    mesh.material.addEventListener?.('dispose', () => materialsDisposed.push(mesh.material));
  }
  disposeZombie(first);
  if (hat) assert.equal(hat.parent, null, 'a flying hat leaves with its zombie');
  const owned = meshes(first).filter(mesh => mesh.userData.ownedGeometry).map(mesh => mesh.geometry);
  assert.ok(owned.length > 5);
  assert.ok(owned.every(geometry => disposed.has(geometry)));
  assert.equal(disposed.has(first.getObjectByName('zombiePoofSmoke').geometry), false, 'the shared puff survives');
  assert.equal(materialsDisposed.length, 0, 'shared family materials survive');
});

test('colossi shed armour as their health drops, visibly and identically for every player', () => {
  const { damageStage, DAMAGE_STAGES } = zombiesModule;
  assert.deepEqual([1, .76, .75, .5, .3, .25, .01].map(damageStage), [0, 0, 1, 2, 2, 3, 3]);
  assert.deepEqual(DAMAGE_STAGES, [.75, .5, .25]);
  const scene = new THREE.Scene(), brute = createZombie('brute', false, 1000, 'z3'); scene.add(brute);
  const named = name => brute.getObjectByName(name) ?? scene.getObjectByName(name);
  setZombieHealth(brute, 1000, 1000);
  for (const name of ['zombieArmorPadLeft', 'zombieArmorPadRight', 'zombieChestArmor']) assert.equal(named(name).parent !== scene && named(name).visible, true, name);
  assert.equal(named('zombieArmorCracks').visible, false);
  setZombieHealth(brute, 700, 1000); animateZombie(brute, 1, true, 1 / 60);
  assert.equal(named('zombieArmorPadLeft').parent, scene, 'the first shoulder pad breaks off into the world');
  setZombieHealth(brute, 450, 1000); animateZombie(brute, 1.1, true, 1 / 60);
  assert.equal(named('zombieArmorCracks').visible, true, 'the chest plate cracks at half health');
  setZombieHealth(brute, 200, 1000); animateZombie(brute, 1.2, true, 1 / 60);
  for (const name of ['zombieArmorPadRight', 'zombieChestArmor']) assert.equal(named(name).parent, scene, `${name} breaks off`);
  animateZombie(brute, 1.6, true, 1 / 60);
  assert.ok(named('zombieChestArmor').position.y < 1.5 + 1e-6, 'pieces fall');
  animateZombie(brute, 3, true, 1 / 60);
  for (const name of ['zombieArmorPadLeft', 'zombieArmorPadRight', 'zombieChestArmor']) assert.equal(scene.getObjectByName(name), undefined, `${name} is gone after its fall`);
  // A late joiner sees the same state at once, with nothing flying.
  const late = createZombie('brute', false, 1000, 'z3'); scene.add(late);
  setZombieHealth(late, 200, 1000); animateZombie(late, 5, true, 1 / 60);
  assert.equal(late.userData.flying?.length ?? 0, 0);
  for (const name of ['zombieArmorPadLeft', 'zombieArmorPadRight', 'zombieChestArmor']) assert.equal(late.getObjectByName(name).visible, false);
});

test('an ordinary zombie loses its hat at half health; flying pieces leave with the model', () => {
  const scene = new THREE.Scene(), id = ids.find(candidate => zombieLook(candidate).hat !== 'none'), zombie = createZombie('walker', false, 165, id); scene.add(zombie);
  setZombieHealth(zombie, 165, 165); const hat = zombie.userData.hat; assert.ok(hat);
  setZombieHealth(zombie, 80, 165); animateZombie(zombie, 2, true, 1 / 60);
  assert.equal(hat.parent, scene); assert.equal(zombie.userData.hat, null, 'a later head shot has no hat left to pop');
  disposeZombie(zombie);
  assert.equal(hat.parent, null, 'disposal clears pieces still in flight');
});
