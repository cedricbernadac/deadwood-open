import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWorld } = await importPublicModule('world.js');
const { SPLINTERS } = await importPublicModule('splinters.js');

function withCanvas(run) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement() {
      const context = new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} });
      return { width: 0, height: 0, getContext: () => context };
    },
  };
  try { run(); } finally { globalThis.document = previous; }
}
const flying = world => {
  const pool = world.root.getObjectByName('barricadeSplinters'), matrix = new THREE.Matrix4(), scale = new THREE.Vector3();
  let total = 0;
  for (let index = 0; index < pool.count; index++) { pool.getMatrixAt(index, matrix); scale.setFromMatrixScale(matrix); if (scale.x > .01) total++; }
  return total;
};

test('a plank broken during play bursts into wood chips; joining, repairs and sealing do not', () => withCanvas(() => {
  const world = createWorld(new THREE.Scene());
  const nodes = () => { let count = 0; world.root.traverse(() => count++); return count; };
  // A player joining mid-wave sees already broken planks without a burst.
  world.setDoor('north', .4, [60, 60, 0, 0, 0]); world.update(1);
  world.update(1.1); assert.equal(flying(world), 0);
  const before = nodes();
  world.setDoor('north', .2, [60, 0, 0, 0, 0]); world.update(1.2);
  assert.equal(flying(world), SPLINTERS.chips, 'one burst for the plank that just broke');
  assert.equal(nodes(), before, 'breaking a plank creates no scene node');
  world.update(1.2 + SPLINTERS.duration + .05); assert.equal(flying(world), 0, 'the chips vanish');
  world.setDoor('north', 1, [60, 60, 60, 60, 60]); world.update(3);
  assert.equal(flying(world), 0, 'repairs do not burst');
  world.setDoor('north', 1, [60, 60, 60, 60, 60], true); world.update(3.1);
  assert.equal(flying(world), 0, 'sealing a door is not a break');
}));
