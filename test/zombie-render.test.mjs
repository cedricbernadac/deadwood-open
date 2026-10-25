import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

// Import the real browser model with local module URLs; no DOM or GPU is needed.
const { createZombie, animateZombie } = await importPublicModule('world.js');

test('impact lean points along the world shot direction regardless of zombie facing', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const [pushX, pushZ] of [[1, 0], [0, -1], [1, 1]]) {
      const zombie = createZombie();
      zombie.position.set(3, 3.4, -2); zombie.rotation.y = yaw;
      Object.assign(zombie.userData, { pushX, pushZ });
      for (let frame = 0; frame < 30; frame++) animateZombie(zombie, frame / 60, true, 1 / 60);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(zombie.quaternion);
      assert.ok(up.x * pushX + up.z * pushZ > .02);
      assert.ok(Math.abs(up.x * pushZ - up.z * pushX) < .001);
      assert.deepEqual(zombie.position.toArray(), [3, 3.4, -2], 'cosmetic animation never moves the server position');
    }
  }
});

test('impact lean is bounded, proportional and settles back while walking continues', () => {
  const small = createZombie(), large = createZombie();
  small.userData.phase = large.userData.phase = 0;
  small.userData.pushZ = -.5; large.userData.pushZ = -100;
  for (let frame = 0; frame < 30; frame++) {
    animateZombie(small, frame / 60, true, 1 / 60);
    animateZombie(large, frame / 60, true, 1 / 60);
  }
  assert.ok(Math.abs(small.rotation.x) > .02);
  assert.ok(Math.abs(large.rotation.x) > Math.abs(small.rotation.x));
  assert.ok(Math.abs(large.rotation.x) <= .1);
  assert.notEqual(large.userData.leftLeg.rotation.x, 0);
  large.userData.pushZ = 0;
  for (let frame = 0; frame < 60; frame++) animateZombie(large, 1 + frame / 60, true, 1 / 60);
  assert.ok(Math.abs(large.rotation.x) < 1e-8);
  assert.ok(Math.abs(large.rotation.z) < 1e-8);
  assert.notEqual(large.userData.leftLeg.rotation.x, 0);
});

test('impact smoothing is stable across render rates and absent snapshots stay neutral', () => {
  const fast = createZombie(), slow = createZombie(), neutral = createZombie('brute', true);
  fast.userData.pushX = slow.userData.pushX = 1;
  for (let frame = 0; frame < 60; frame++) animateZombie(fast, frame / 60, true, 1 / 60);
  for (let frame = 0; frame < 30; frame++) animateZombie(slow, frame / 30, true, 1 / 30);
  assert.ok(Math.abs(fast.rotation.z - slow.rotation.z) < 1e-12);
  animateZombie(neutral, 1, true, 1 / 60);
  assert.equal(neutral.rotation.x, 0);
  assert.equal(Math.abs(neutral.rotation.z), 0);
});
