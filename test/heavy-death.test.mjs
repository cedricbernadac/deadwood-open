import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createZombie, startZombieDeath, animateZombieDeath, disposeZombie, ZOMBIE_DEATH_DURATION } = await importPublicModule('zombies.js');

const heavy = { distance: 1.5, hop: .3, fall: .34 };
const meshes = group => { const list = []; group.traverse(child => { if (child.isMesh) list.push(child); }); return list; };

test('a death without knockback keeps the body where it fell', () => {
  assert.equal(ZOMBIE_DEATH_DURATION, 1.5);
  const zombie = createZombie('walker', false, 80, 'heavy-still');
  zombie.position.set(2, 0, -3);
  startZombieDeath(zombie, { time: 1, directionX: 1, directionZ: 0 });
  for (const time of [1, 1.1, 1.4, 1.9, 2.4, 1 + ZOMBIE_DEATH_DURATION]) {
    animateZombieDeath(zombie, time);
    assert.equal(zombie.position.x, 2, `x at t=${time}`);
    assert.equal(zombie.position.z, -3, `z at t=${time}`);
  }
});

test('a heavy death slides the full distance along the shot and settles', () => {
  const zombie = createZombie('walker', false, 80, 'heavy-slide');
  zombie.position.set(.5, 0, -2);
  startZombieDeath(zombie, { time: 0, directionX: 1, directionZ: 0, knockback: heavy });
  let previous = .5;
  for (let step = 0; step <= 21; step++) {
    const age = step / 50;
    animateZombieDeath(zombie, age);
    assert.ok(zombie.position.x >= previous - 1e-12, `the slide never comes back at ${age} s`);
    previous = zombie.position.x;
    assert.equal(zombie.position.z, -2, `z untouched at ${age} s`);
  }
  for (const age of [.42, .6, 1]) {
    animateZombieDeath(zombie, age);
    assert.ok(Math.abs(zombie.position.x - (.5 + 1.5)) < 1e-9, `exactly 1.5 m travelled by ${age} s (${zombie.position.x})`);
    assert.equal(zombie.position.z, -2);
  }
});

test('the hop lifts the body and lets it sink back onto the fallen pose', () => {
  const zombie = createZombie('walker', false, 80, 'heavy-hop');
  zombie.position.set(0, 0, 0);
  startZombieDeath(zombie, { time: 0, directionX: 1, directionZ: 0, knockback: heavy });
  animateZombieDeath(zombie, 0);
  assert.equal(zombie.position.y, 0, 'on the floor at the start');
  animateZombieDeath(zombie, .19);
  assert.ok(zombie.position.y > .2, `lifted by the hop at its peak (${zombie.position.y})`);
  animateZombieDeath(zombie, .6);
  assert.ok(Math.abs(zombie.position.y - .13) < 1e-9, `back on the fallen pose height by 0.6 s (${zombie.position.y})`);
});

test('a heavy death tips fully earlier than a quiet one', () => {
  const blasted = createZombie('walker', false, 80, 'heavy-tip-a');
  const quiet = createZombie('walker', false, 80, 'heavy-tip-b');
  startZombieDeath(blasted, { time: 0, directionX: 1, directionZ: 0, knockback: heavy });
  startZombieDeath(quiet, { time: 0, directionX: 1, directionZ: 0 });
  animateZombieDeath(blasted, .36);
  animateZombieDeath(quiet, .36);
  assert.ok(Math.abs(blasted.rotation.x - 1.48) < 1e-9, `fully tipped at 0.36 s (${blasted.rotation.x})`);
  assert.ok(quiet.rotation.x < blasted.rotation.x - .5, `the quiet death still leans (${quiet.rotation.x})`);
});

test('the knockback direction is normalised before the slide', () => {
  const zombie = createZombie('walker', false, 80, 'heavy-norm');
  zombie.position.set(0, 0, 0);
  startZombieDeath(zombie, { time: 0, directionX: 3, directionZ: 4, knockback: { distance: 1, hop: 0, fall: .34 } });
  animateZombieDeath(zombie, .5);
  assert.ok(Math.abs(zombie.position.x - .6) < 1e-9, `x ${zombie.position.x}`);
  assert.ok(Math.abs(zombie.position.z - .8) < 1e-9, `z ${zombie.position.z}`);
});

test('a zero direction or an invalid distance means no slide', () => {
  const cases = [
    [{ time: 0, directionX: 0, directionZ: 0, knockback: heavy }, 'zero direction'],
    [{ time: 0, directionX: NaN, directionZ: 0, knockback: heavy }, 'NaN direction'],
    [{ time: 0, directionX: 1, directionZ: 0, knockback: { ...heavy, distance: NaN } }, 'NaN distance'],
    [{ time: 0, directionX: 1, directionZ: 0, knockback: { ...heavy, distance: -2 } }, 'negative distance'],
  ];
  for (const [event, label] of cases) {
    const zombie = createZombie('walker', false, 80, `heavy-no-${label}`);
    zombie.position.set(1, 0, 1);
    startZombieDeath(zombie, event);
    animateZombieDeath(zombie, .5);
    assert.equal(zombie.position.x, 1, `${label}: x stays`);
    assert.equal(zombie.position.z, 1, `${label}: z stays`);
  }
});

test('a death scheduled in the future does not move the body yet', () => {
  const zombie = createZombie('walker', false, 80, 'heavy-future');
  zombie.position.set(-1, 0, 2);
  startZombieDeath(zombie, { time: 10, directionX: 1, directionZ: 0, knockback: heavy });
  for (const time of [5, 9.99]) {
    assert.equal(animateZombieDeath(zombie, time), true);
    assert.equal(zombie.position.x, -1, `x at t=${time}`);
    assert.equal(zombie.position.z, 2, `z at t=${time}`);
    assert.equal(zombie.position.y, 0, `y at t=${time}`);
    assert.equal(zombie.rotation.x, 0, `not tipping yet at t=${time}`);
  }
  animateZombieDeath(zombie, 10.42);
  assert.ok(Math.abs(zombie.position.x - (-1 + 1.5)) < 1e-9, 'once its time comes the slide runs');
});

test('the death animation still ends after the poof and disposal still works', () => {
  const zombie = createZombie('walker', false, 80, 'heavy-end');
  startZombieDeath(zombie, { time: 0, directionX: 1, directionZ: 0, knockback: heavy });
  assert.equal(animateZombieDeath(zombie, .5), true);
  assert.equal(animateZombieDeath(zombie, ZOMBIE_DEATH_DURATION - .01), true);
  assert.equal(animateZombieDeath(zombie, ZOMBIE_DEATH_DURATION), false, 'over after the poof');
  assert.equal(animateZombieDeath(zombie, 3), false);
  const disposed = new Set();
  for (const mesh of meshes(zombie)) if (mesh.userData.ownedGeometry) mesh.geometry.addEventListener('dispose', () => disposed.add(mesh.geometry));
  disposeZombie(zombie);
  const owned = meshes(zombie).filter(mesh => mesh.userData.ownedGeometry).map(mesh => mesh.geometry);
  assert.ok(owned.length > 0, 'the zombie owns geometry');
  assert.ok(owned.every(geometry => disposed.has(geometry)), 'disposeZombie frees every owned buffer after a heavy death');
});
