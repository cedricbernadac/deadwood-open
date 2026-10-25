// The cabin, the supermarket and the hospital never get the funfair mirrors:
// their world has no local-avatar hook, no mirror rig and never asks for
// Reflector.js, whatever the quality and wherever the eye. Run with
// DEADWOOD_LEVEL=<cabin|supermarket|hospital> (unset: the cabin).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { importPublicSource, publicModuleUrl } from '../helpers/public-modules.mjs';

const { LEVEL } = await import('../../public/level-config.js');
assert.notEqual(LEVEL.id, 'funfair');
const context2d = new Proxy(function () {}, { get: (_, key) => key === 'measureText' ? value => ({ width: String(value).length * 20 }) : context2d, apply: () => context2d, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context2d }) };
const source = readFileSync(new URL('../../public/world.js', import.meta.url), 'utf8')
  .replace("import('./world-hospital.js')", `import(${JSON.stringify(publicModuleUrl('world-hospital.js'))})`)
  .replace("import('./world-funfair.js')", "import('data:text/javascript,throw new Error(\"world-funfair.js loaded off the funfair\")')");
const { createWorld } = await importPublicSource(source, { name: 'world.js' });
let asked = 0;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(76, 16 / 9, .06, 130);
camera.rotation.order = 'YXZ'; camera.position.set(-5.4, -1.8, 5.3); camera.rotation.set(0, Math.PI / 2, 0); scene.add(camera);
const world = createWorld(scene, { quality: { id: 'high', shadows: false, shadowMapSize: 0, fireflies: 0, groundDetail: 0, rainFraction: .1 }, loadDecor: async () => new THREE.Group(),
  loadReflector: () => { asked++; return import('three/examples/jsm/objects/Reflector.js'); } });
await world.ready;
assert.equal(world.setLocalAvatar, undefined, 'no local-avatar hook');
assert.equal(world.mirrors, undefined, 'no mirror pool');
for (let time = 0; time < 1; time += 1 / 30) world.update(time, { snapshot: { players: [] }, myId: 'x', active: true, camera, survivors: new Map() });
assert.equal(asked, 0, 'Reflector.js never asked for');
assert.equal(scene.getObjectByName('funfairMirrors'), undefined);
let layered = 0; scene.traverse(node => { if (node.layers.mask !== 1) layered++; });
assert.equal(layered, 0, 'every object of the scene stays on layer 0 alone');
console.log(`${LEVEL.id} has no funfair mirrors: verified`);
