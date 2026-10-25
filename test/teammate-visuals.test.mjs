import { advanceBallisticFlight, settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { RoomSimulation, WEAPONS, MINIGUN_WINDUP } from '../simulation.mjs';
import { MINIGUN_TIMING, minigunRotorSpeed } from '../public/minigun.js';
import { MELEE } from '../public/rules.js';
import { importPublicModule } from './helpers/public-modules.mjs';

// Real Three.js models from public/world.js, without DOM or GPU.
const world = await importPublicModule('world.js');
const { createSurvivor, setSurvivorWeapon, animateSurvivor, fireSurvivor, survivorMuzzle, createTracer, createZombie, animateZombie, startZombieDeath, animateZombieDeath, ZOMBIE_DEATH_DURATION } = world;
const { sharedEffects } = await importPublicModule('fx.js');
const { bulletLook } = await importPublicModule('shot-fx.js');
const fx = sharedEffects();
const live = (pool, time) => {
  fx.update(time);
  const count = fx.pools[pool].mesh.geometry.instanceCount, array = fx.pools[pool].center.array;
  return Array.from({ length: count }, (_, index) => new THREE.Vector3(array[index * 3], array[index * 3 + 1], array[index * 3 + 2]));
};
const lights = root => { const found = []; root.traverse(node => { if (node.isLight) found.push(node); }); return found; };

const settle = (survivor, state, seconds = 1, from = 0) => {
  for (let frame = 0; frame < seconds * 60; frame++) animateSurvivor(survivor, { ...state, time: from + frame / 60, delta: 1 / 60 });
};

test('teammate minigun barrels share local charge progress and remain still at rest, reload or incapacity', () => {
  const survivor = createSurvivor();setSurvivorWeapon(survivor, 'minigun');
  const rotor = survivor.userData.gun.userData.rotor;
  for (const state of [{}, { spinning: true, spinLeft: MINIGUN_TIMING.windup }, { spinning: true, reloading: true }, { spinning: true, downed: true }]) {
    const before = rotor.rotation.z;animateSurvivor(survivor, { ...state, delta: .05 });assert.equal(rotor.rotation.z, before);
  }
  for (const spinLeft of [MINIGUN_TIMING.windup * .75, MINIGUN_TIMING.windup * .5, 0]) {
    const before = rotor.rotation.z;animateSurvivor(survivor, { spinning: true, spinLeft, spinDuration: MINIGUN_TIMING.windup, delta: .05 });
    assert.ok(Math.abs(rotor.rotation.z - before + .05 * minigunRotorSpeed({ spinning: true, spinLeft })) < 1e-8);
  }
  assert.equal(minigunRotorSpeed({ spinning: true, spinLeft: -100 }), MINIGUN_TIMING.rotorSpeed);
  assert.equal(minigunRotorSpeed({ spinning: true, spinLeft: Infinity }), 0);
});

test('a teammate holds the real model of the weapon they carry and switches with it', () => {
  const survivor = createSurvivor(0x809fac);
  for (const weapon of Object.keys(WEAPONS)) {
    setSurvivorWeapon(survivor, weapon);
    const { gun, weaponType, holder, flash } = survivor.userData;
    assert.equal(weaponType, weapon);
    assert.equal(gun.userData.type, weapon);
    assert.equal(holder.children.length, 1, 'the previous weapon is removed');
    if (WEAPONS[weapon].melee) {
      assert.equal(flash.parent, null, 'a blade never carries the reusable muzzle flash');
      assert.equal(flash.visible, false); assert.equal(survivorMuzzle(survivor), null);
    } else {
      assert.equal(flash.parent, gun, 'the muzzle flash follows the held firearm');
      assert.ok(flash.position.distanceTo(gun.userData.muzzle) < 1e-9);
    }
    const firstPerson = world.createWeapon(weapon);
    const meshes = group => { let count = 0; group.traverse(node => { if (node.isMesh) count++; }); return count; };
    assert.ok(meshes(gun) - (flash.parent === gun ? meshes(flash) : 0) < meshes(firstPerson), `${weapon}: first-person hands are not drawn on teammates`);
  }
});

test('dropping the last weapon leaves a teammate empty-handed through movement and restores the actual gun on pickup', () => {
  const survivor = createSurvivor();
  setSurvivorWeapon(survivor, 'minigun');
  const oldGun = survivor.userData.gun, flash = survivor.userData.flash, geometries = new Set();
  oldGun.traverse(node => { if (node.geometry && !flash.children.includes(node)) geometries.add(node.geometry); });
  const disposed = new Map([...geometries].map(geometry => [geometry, 0]));
  geometries.forEach(geometry => geometry.addEventListener('dispose', () => disposed.set(geometry, disposed.get(geometry) + 1)));
  let flashDisposals = 0;
  flash.traverse(node => node.geometry?.addEventListener('dispose', () => flashDisposals++));
  fireSurvivor(survivor, 5); animateSurvivor(survivor, { time: 5.01 });
  assert.equal(flash.visible, true);
  setSurvivorWeapon(survivor, null);
  const d = survivor.userData;
  assert.equal(d.gun, null); assert.equal(d.weaponType, null); assert.equal(d.holder.children.length, 0);
  assert.equal(oldGun.parent, null); assert.equal(flash.parent, null); assert.equal(flash.visible, false);
  assert.ok([...disposed.values()].every(count => count === 1), 'only the removed gun geometries are disposed once');
  assert.equal(flashDisposals, 0, 'the reusable flash survives the drop');
  assert.equal(survivorMuzzle(survivor), null);
  for (const state of [{}, { pitch: .8, spinning: true, reloading: true }, { crouched: true }, { downed: true }]) {
    for (let frame = 0; frame < 30; frame++) {
      survivor.position.x += .04; survivor.position.z -= .03;
      fireSurvivor(survivor, 6 + frame / 60);
      animateSurvivor(survivor, { ...state, time: 6 + frame / 60, delta: 1 / 60 });
      assert.equal(d.flash.visible, false); assert.equal(survivorMuzzle(survivor), null);
      assert.equal(d.aim.rotation.x, 0); assert.equal(d.aim.rotation.z, 0);
      for (const arm of d.arms) { assert.equal(arm.scale.y, 1); assert.ok(arm.quaternion.angleTo(new THREE.Quaternion()) < 1e-9); }
      survivor.updateMatrixWorld(true);
      survivor.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite)));
    }
  }
  setSurvivorWeapon(survivor, null);
  assert.ok([...disposed.values()].every(count => count === 1), 'repeated empty state never disposes the old gun twice');
  for (const type of ['pistol', 'rifle', 'minigun']) {
    setSurvivorWeapon(survivor, type); settle(survivor, {}, 2, 10);
    assert.equal(d.weaponType, type); assert.equal(d.gun.userData.type, type); assert.equal(d.holder.children.length, 1);
    assert.equal(flash.parent, d.gun); assert.ok(survivorMuzzle(survivor)?.toArray().every(Number.isFinite));
    fireSurvivor(survivor, 20); animateSurvivor(survivor, { time: 20.01 }); assert.equal(flash.visible, true);
    setSurvivorWeapon(survivor, null);
  }
});

test('the muzzle sits at the end of the barrel, ahead of the teammate and following its aim', () => {
  for (const weapon of Object.keys(WEAPONS).filter(weapon => !WEAPONS[weapon].melee)) {
    const survivor = createSurvivor();
    setSurvivorWeapon(survivor, weapon);
    survivor.position.set(2, 0, 1); survivor.rotation.y = Math.PI / 2; // facing -X
    settle(survivor, { pitch: 0 });
    const level = survivorMuzzle(survivor);
    assert.ok(level.x < 2 - .3, `${weapon}: muzzle is in front of the body (${level.x.toFixed(2)})`);
    assert.ok(Math.abs(level.z - 1) < .35, `${weapon}: muzzle stays near the facing line`);
    assert.ok(level.y > .9 && level.y < 1.6, `${weapon}: muzzle is at hand height (${level.y.toFixed(2)})`);
    settle(survivor, { pitch: .7 }, 1, 1);
    const raised = survivorMuzzle(survivor);
    assert.ok(raised.y > level.y + .15, `${weapon}: aiming up raises the muzzle`);
  }
});

test('teammate katana swings animate the blade and grips without a muzzle, flash or firearm recoil', () => {
  const survivor = createSurvivor(); setSurvivorWeapon(survivor, 'katana');
  const { gun, aim, flash } = survivor.userData, pivot = gun.userData.meleePivot;
  for (const attack of ['light', 'heavy']) {
    animateSurvivor(survivor, { meleeAttack: attack, meleeElapsed: MELEE[attack].windup - .05, time: 0 });
    const prepared = pivot.quaternion.clone();
    fireSurvivor(survivor, 1);
    animateSurvivor(survivor, { meleeAttack: attack, meleeElapsed: MELEE[attack].windup, time: 1.01 });
    assert.ok(pivot.quaternion.angleTo(prepared) > .1, `${attack}: the real blade moves through its strike`);
    assert.equal(flash.parent, null); assert.equal(flash.visible, false);
    assert.equal(survivorMuzzle(survivor), null); assert.equal(survivor.userData.recoil, 0);
    assert.ok(Math.abs(aim.rotation.x - gun.userData.meleePose.armX) < 1e-9, 'only the deliberate sword swing changes aim, without firearm kick');
    survivor.updateMatrixWorld(true);
    survivor.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite)));
  }
  setSurvivorWeapon(survivor, 'rifle');
  assert.equal(flash.parent, survivor.userData.gun, 'switching back restores the firearm flash');
  assert.ok(survivorMuzzle(survivor)?.toArray().every(Number.isFinite));
});

test('a shot shows a brief muzzle flash and a recoil kick that settle again', () => {
  const survivor = createSurvivor();
  setSurvivorWeapon(survivor, 'rifle');
  settle(survivor, {});
  const rest = survivor.userData.aim.rotation.x;
  fireSurvivor(survivor, 10);
  animateSurvivor(survivor, { time: 10.01, delta: 1 / 60 });
  assert.equal(survivor.userData.flash.visible, true);
  assert.ok(survivor.userData.aim.rotation.x > rest + .05, 'the weapon kicks up');
  animateSurvivor(survivor, { time: 10.1, delta: 1 / 60 });
  assert.equal(survivor.userData.flash.visible, false, 'the flash lasts a few frames only');
  settle(survivor, {}, 1, 10.2);
  assert.ok(Math.abs(survivor.userData.aim.rotation.x - rest) < .01);
});

test('teammates walk with their actual movement, lower the weapon to reload and lie down when downed', () => {
  const survivor = createSurvivor();
  settle(survivor, {});
  assert.ok(Math.abs(survivor.userData.legs[0].rotation.x) < 1e-6, 'standing still keeps the legs together');
  let widest = 0;
  for (let frame = 0; frame < 60; frame++) {
    survivor.position.z -= 3.5 / 60;
    animateSurvivor(survivor, { time: frame / 60, delta: 1 / 60 });
    widest = Math.max(widest, Math.abs(survivor.userData.legs[0].rotation.x));
    assert.ok(Math.abs(survivor.userData.legs[0].rotation.x + survivor.userData.legs[1].rotation.x) < 1e-9);
  }
  assert.ok(widest > .3, 'walking swings the legs');
  settle(survivor, { reloading: true });
  assert.ok(survivor.userData.aim.rotation.x < -.4, 'reloading lowers the weapon');
  const muzzleBefore = survivorMuzzle(survivor).clone();
  settle(survivor, { downed: true }, 2);
  assert.ok(survivor.userData.body.rotation.x > 1.3, 'a downed teammate lies on the floor');
  survivor.updateMatrixWorld(true);
  const head = new THREE.Vector3(); survivor.userData.head.getWorldPosition(head);
  assert.ok(head.y < .6, `the head is near the floor (${head.y.toFixed(2)})`);
  assert.ok(survivorMuzzle(survivor).y < muzzleBefore.y);
  assert.deepEqual(survivor.position.toArray().map(value => Math.round(value * 1000) / 1000), [0, 0, -3.5], 'animation never moves the server position');
});

test('a catch-up after a frame gap slides the teammate without a running stride', () => {
  const survivor = createSurvivor();
  settle(survivor, {});
  // A hidden tab renders rarely: one frame then covers metres of smoothing.
  for (const jump of [2.8, 1.2, .6]) {
    survivor.position.z -= jump;
    animateSurvivor(survivor, { time: 5, delta: .05 });
    assert.ok(Math.abs(survivor.userData.legs[0].rotation.x) < .02, `a ${jump} m snap is not a stride`);
  }
});

test('crouching bends the knees, lowers the head and held weapon, and yields to the downed pose', () => {
  for (const weapon of ['pistol', 'rifle', 'shotgun']) {
    const survivor = createSurvivor(); setSurvivorWeapon(survivor, weapon);
    settle(survivor, {});
    const standingMuzzle = survivorMuzzle(survivor).clone();
    settle(survivor, { crouched: true }); survivor.updateMatrixWorld(true);
    const head = new THREE.Vector3(); survivor.userData.head.getWorldPosition(head);
    assert.ok(head.y < 1 && head.y > .7, `${weapon}: head is near the crouched eye height (${head.y})`);
    assert.ok(survivorMuzzle(survivor).y < standingMuzzle.y - .5, 'the held gun follows the lowered shoulders');
    assert.ok(survivor.userData.knees.every(knee => knee.rotation.x < -2));
    for (const boot of survivor.userData.boots) {
      const box = new THREE.Box3().setFromObject(boot);
      assert.ok(box.min.y >= -.01 && box.min.y < .12, `feet stay near the floor (${box.min.y})`);
    }
    const crouchedAim = survivor.userData.aim.rotation.x;
    settle(survivor, { crouched: true, reloading: true });
    assert.ok(survivor.userData.aim.rotation.x < crouchedAim - .4, 'reload still lowers the weapon');
    fireSurvivor(survivor, 10); animateSurvivor(survivor, { crouched: true, time: 10.01 });
    assert.equal(survivor.userData.flash.visible, true, 'crouched fire keeps its muzzle flash');
    settle(survivor, { crouched: true, downed: true }, 2, 11);
    survivor.updateMatrixWorld(true); survivor.userData.head.getWorldPosition(head);
    assert.ok(head.y < .6); assert.ok(survivor.userData.body.rotation.x > 1.3);
    settle(survivor, {}, 2, 13); survivor.updateMatrixWorld(true); survivor.userData.head.getWorldPosition(head);
    assert.ok(Math.abs(head.y - 1.67) < .01, 'revived and standing returns to the original pose');
    assert.deepEqual(survivor.position.toArray(), [0, 0, 0], 'posture never changes authoritative feet position');
  }
});

test('bullets fly from the muzzle to the impact point at tracer speed, keep a bounded streak, then vanish', () => {
  fx.clear();
  const start = new THREE.Vector3(0, 1.4, 0), end = new THREE.Vector3(0, 1.4, -8.5);
  const tracer = createTracer(start, end, { time: 5, weapon: 'rifle' });
  assert.ok(Math.abs(tracer.travel - 8.5 / 170) < 1e-9, 'the tracer speed is unchanged');
  assert.equal(tracer.update(5), true);
  const [early] = live('glow', 5.02);
  assert.ok(early.z < -.5 && early.z > -8.5 && Math.abs(early.y - 1.4) < 1e-6, 'the glowing bullet has left the muzzle along the shot');
  const [late] = live('glow', 5 + 8.5 / 170 - 1e-4);
  assert.ok(Math.abs(late.z + 8.5) < .05, 'and reaches the impact point');
  fx.update(5.045);
  const streaks = fx.pools.streak, count = streaks.mesh.geometry.instanceCount;
  assert.equal(count, 2, 'a hot core and a wider wake');
  for (let index = 0; index < count; index++) {
    const head = streaks.center.array[index * 3 + 2], tail = streaks.tail.array[index * 3 + 2];
    assert.ok(head <= 0 && tail <= 0 && head >= -8.5 - 1e-6 && Math.abs(head - tail) <= 3 * bulletLook('rifle').length + 1e-6, 'bounded streaks on the shot segment');
  }
  assert.equal(tracer.update(5 + 1), false, 'the bullet expires');
  fx.update(6); assert.equal(fx.pools.glow.mesh.geometry.instanceCount + fx.pools.streak.mesh.geometry.instanceCount, 0, 'nothing lingers');
  tracer.dispose();
  // Bigger damage reads as a bigger bullet; your own shots stay discreet.
  assert.ok(bulletLook('sniper').glow > bulletLook('magnum').glow && bulletLook('magnum').glow > 1.8 * bulletLook('smg').glow);
  assert.ok(bulletLook('minigun').core > bulletLook('smg').core);
  assert.ok(bulletLook('rifle', { local: true }).dim <= .5);
  assert.equal(lights(fx.root).length, 0);
});


test('zombies swing at what they hit, fall away from the killing shot, then vanish in a puff', () => {
  const zombie = createZombie();
  animateZombie(zombie, 1, true, 1 / 60);
  const walking = zombie.userData.leftArm.rotation.x;
  zombie.userData.attackAt = 2;
  animateZombie(zombie, 2 + .42 * .38, true, 1 / 60);
  assert.ok(zombie.userData.leftArm.rotation.x > 2, 'the arms rise for the blow');
  animateZombie(zombie, 2 + .42 * .68, true, 1 / 60);
  assert.ok(zombie.userData.leftArm.rotation.x < .5, 'then slam down');
  animateZombie(zombie, 3, true, 1 / 60);
  assert.ok(Math.abs(zombie.userData.leftArm.rotation.x - walking) < .8, 'and the walk resumes');

  zombie.position.set(1, 0, -3); zombie.rotation.y = 1.2;
  startZombieDeath(zombie, { time: 10, directionX: 0, directionZ: -1 });
  assert.equal(animateZombieDeath(zombie, 10.6), true);
  zombie.updateMatrixWorld(true);
  const head = new THREE.Vector3(); zombie.userData.head.getWorldPosition(head);
  assert.ok(head.z < -3 - 1.2, `the body falls along the shot (head z ${head.z.toFixed(2)})`);
  assert.ok(head.y < .6, 'and lies on the floor');
  // No corpse piles up: the body shrinks into a puff of smoke and sparks.
  assert.equal(animateZombieDeath(zombie, 10 + ZOMBIE_DEATH_DURATION * .95), true);
  assert.equal(zombie.getObjectByName('zombiePoof').visible, true, 'a puff of smoke replaces the body');
  assert.equal(zombie.userData.body.visible, false);
  assert.ok(ZOMBIE_DEATH_DURATION <= 2, 'the model goes quickly');
  assert.equal(animateZombieDeath(zombie, 10 + ZOMBIE_DEATH_DURATION + .01), false, 'the model is removed after the puff');
});

test('the server reports where each pellet arrived and the direction of a killing shot', () => {
  const events = [];
  const simulation = new RoomSimulation('PELLET', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.start('a');
  player.weapon = 'shotgun';
  player.inventory.shotgun = { ammo: WEAPONS.shotgun.magazine, reserve: WEAPONS.shotgun.reserve };
  // Facing the west wall from inside: every pellet stops in solid timber.
  Object.assign(player, { x: -5, y: 0, z: 1.9, yaw: Math.PI / 2, pitch: 0 }); // between the door and the window
  simulation.shoot('a');
  let shot = events.filter(event => event.event === 'shot').at(-1);
  assert.equal(shot.projectiles.length, WEAPONS.shotgun.pellets);
  const wall = advanceBallisticFlight(simulation, .1).impacts;
  assert.equal(wall.length, WEAPONS.shotgun.pellets);
  for (const pellet of wall) {
    assert.equal(pellet.stop, 'solid');
    assert.ok(Math.abs(pellet.x + 8 - .135) < .01, `stops at the wall (${pellet.x})`);
  }
  // A plank stops the bullet at its own distance.
  simulation.time = player.shotAfter;
  player.weapon = 'rifle'; player.inventory.rifle = { ammo: WEAPONS.rifle.magazine, reserve: WEAPONS.rifle.reserve };
  Object.assign(player, { x: 0, z: -4, yaw: 0, pitch: Math.atan2(.86 - 1.55, 2) });
  simulation.shoot('a');
  const board = advanceBallisticFlight(simulation, .1).impacts;
  assert.equal(board.length, 1);
  assert.equal(board[0].stop, 'board');
  assert.ok(Math.abs(board[0].z + 6) < .1);
  // A bullet that runs out of penetration stops in its last zombie and its kill carries the shot direction.
  simulation.time += 1;
  Object.assign(player, { x: 0, z: 3, yaw: 0, pitch: 0 });
  const targets = [1, 0, -1, -2].map((z, index) => {
    const zombie = { id: `t${index}`, x: 0, y: .4, z, hp: index ? 1000 : 1, maxHp: 1000, kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity };
    simulation.zombies.set(zombie.id, zombie); return zombie;
  });
  simulation.shoot('a');
  const bodies = advanceBallisticFlight(simulation, .1).impacts;
  assert.equal(bodies.at(-1).stop, 'zombie');
  assert.ok(Math.abs(bodies.at(-1).z - (-1 + .32)) < .02, 'stops inside the third zombie (rifle penetration)');
  assert.equal(targets[3].hp, 1000, 'the fourth one is untouched');
  const kill = events.find(event => event.event === 'kill');
  assert.equal(kill.zombieId, 't0');
  assert.deepEqual([kill.dirX, kill.dirZ], [-0, -1]);
  // Upward shot: the actual roof stops the bullet before its free-flight range.
  simulation.zombies.clear(); simulation.time += 1;
  Object.assign(player, { x: 0, y: 3.4, z: 5, yaw: 0, pitch: .9 });
  player.weapon = 'minigun'; player.inventory.minigun = { ammo: 60, reserve: 15 };
  simulation.phase = 'wave'; simulation.setMinigunSpin('a', true); simulation.time += MINIGUN_WINDUP;
  assert.equal(simulation.shoot('a'), true);
  const sky = settleBallisticFlight(simulation).impacts;
  assert.ok(['solid', 'expired'].includes(sky.at(-1).stop));
  assert.ok(sky.at(-1).age <= 4);
});
