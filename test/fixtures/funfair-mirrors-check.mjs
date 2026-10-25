// The funfair mirror maze's live reflections (public/funfair-mirrors.js), run
// with DEADWOOD_LEVEL=funfair by test/funfair-mirrors.test.mjs. Each check
// prints one line; the last line is the marker the test waits for.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { importPublicModule, importPublicSource, publicModuleUrl } from '../helpers/public-modules.mjs';
import { loadGlbTriangles } from '../../validation/hospital-props-audit.mjs';

const { LEVEL } = await import('../../public/level-config.js');
assert.equal(LEVEL.id, 'funfair', 'run with DEADWOOD_LEVEL=funfair');
// Signs and flashes draw on a canvas: a do-nothing 2D context (every call,
// gradients included, returns it again) is enough here.
const context2d = new Proxy(function () {}, { get: (_, key) => key === 'measureText' ? value => ({ width: String(value).length * 20 }) : context2d, apply: () => context2d, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => context2d }) };

const M = await importPublicModule('funfair-mirrors.js');
const { createFunfairMirrors, mirrorFaces, faceDistance, facePriority, mirrorEnclosure, mirrorSight, canMirrorShow, actorBounds, MIRROR_LAYER, MIRROR_POOL, MIRROR_FIT, MIRROR_PANE, MIRROR_LOOK, MIRROR_RANGE, MIRROR_SHADER,
  MIRROR_SIGHT, MIRROR_BUDGET, MIRROR_AVATAR } = M;
const { PLAYER_POSTURE } = await importPublicModule('movement.js');
// world.js as the funfair page runs it: its deferred world-funfair.js import
// pointed at the same rewritten module the tests load.
const worldSource = readFileSync(new URL('../../public/world.js', import.meta.url), 'utf8');
assert.equal(worldSource.split("import('./world-funfair.js')").length, 2, 'world.js defers world-funfair.js once');
const W = await importPublicSource(worldSource.replace("import('./world-funfair.js')", `import(${JSON.stringify(publicModuleUrl('world-funfair.js'))})`), { name: 'world.js' });
const factories = { createSurvivor: W.createSurvivor, setSurvivorWeapon: W.setSurvivorWeapon, setSurvivorSecondaryWeapon: W.setSurvivorSecondaryWeapon,
  animateSurvivor: W.animateSurvivor, getSurvivorStyle: W.getSurvivorStyle, createUmbrella: W.createUmbrella };
const realReflector = () => import('three/examples/jsm/objects/Reflector.js');
const { Reflector } = await realReflector();
const checks = [];
const pass = (name, detail = '') => { checks.push(name); console.log(`ok ${checks.length} ${name}${detail ? ` (${detail})` : ''}`); };

const eyeAt = (x, y, z, yaw = 0, pitch = 0, aspect = 16 / 9) => {
  const camera = new THREE.PerspectiveCamera(76, aspect, .06, 130); camera.rotation.order = 'YXZ';
  camera.position.set(x, y, z); camera.rotation.set(pitch, yaw, 0); camera.updateMatrixWorld(true);
  return camera;
};
const spyLoader = () => { const spy = () => { spy.calls++; return realReflector(); }; spy.calls = 0; return spy; };
// The frame-time guard (MIRROR_BUDGET) reads a clock: here a steady 60 Hz one,
// so a loaded test PC never turns a mirror to glass. A world built here reads
// performance.now(), held to the same steady frames by worldFrame().
const steady = () => { let now = 0; return () => (now += 1 / 60); };
let frameClock = 0;
const holdPerformance = () => { Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => frameClock }); return () => { delete performance.now; }; };
const worldFrame = (world, time, context) => { frameClock += 1000 / 60; world.update(time, context); };
const glbPath = new URL('../../public/levels/funfair.glb', import.meta.url);
const glbTriangles = loadGlbTriangles(glbPath);
const quiet = { warn() {} };
async function settle(mirrors, camera, from = 0, seconds = 1, context = {}) {
  let time = from;
  mirrors.update(time, { camera, ...context });
  if (mirrors.loading) await mirrors.loading;
  for (; time < from + seconds; time += 1 / 30) mirrors.update(time, { camera, ...context });
  return time;
}
const ids = mirrors => mirrors.live.map(face => face.id);
const player = (extra = {}) => ({ id: '0123456789abcdef', name: 'Jules', x: 0, y: -3.4, z: 0, yaw: 0, pitch: 0, alive: true, downed: false, crouched: false,
  weapon: 'shotgun', backpack: false, umbrella: { open: false, remaining: 100, max: 100 }, ...extra });
// In front of panel 04's east face (x -7.4, z 4 to 5.8), two metres away, looking west.
const FRONT = Object.freeze({ x: -5.4, y: -1.8, z: 5.3, yaw: Math.PI / 2 });

// 1. The 28 faces against the real GLB panes.
{
  const faces = mirrorFaces(LEVEL.furniture);
  const panels = LEVEL.furniture.filter(item => item.kind === 'mirror-panel');
  assert.equal(panels.length, 14); assert.equal(faces.length, 28); assert.equal(new Set(faces.map(face => face.id)).size, 28);
  const triangles = glbTriangles;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let parallelNear = 0;
  for (const face of faces) {
    const panel = panels.find(item => item.id === face.panelId), n = [face.normal.x, 0, face.normal.z], a = [face.along.x, 0, face.along.z];
    const plane = face.centre.x * n[0] + face.centre.z * n[2], centreAlong = face.centre.x * a[0] + face.centre.z * a[2];
    const lo = Math.min(panel.minX * a[0] + panel.minZ * a[2], panel.maxX * a[0] + panel.maxZ * a[2]), hi = Math.max(panel.minX * a[0] + panel.minZ * a[2], panel.maxX * a[0] + panel.maxZ * a[2]);
    const inside = t => [t.a, t.b, t.c].every(p => dot(p, a) >= lo - 1e-4 && dot(p, a) <= hi + 1e-4 && p[1] >= panel.baseY - 1e-4 && p[1] <= panel.baseY + panel.height + 1e-4
      && Math.abs(dot(p, n) - (dot([(panel.minX + panel.maxX) / 2, 0, (panel.minZ + panel.maxZ) / 2], n))) < .06);
    const panes = triangles.filter(t => t.material === 'Mirror' && Math.abs(dot(t.n, n)) > .999 && inside(t));
    const planes = [...new Set(panes.map(t => Math.round(dot(t.a, n) * 1e5) / 1e5))];
    assert.equal(planes.length, 2, `${face.id}: the GLB has a pane on both faces (${planes})`);
    const front = planes.reduce((best, value) => Math.abs(plane - value) < Math.abs(plane - best) ? value : best);
    const gap = plane - front;
    assert.ok(gap >= .003 - 1e-6 && gap <= .004 + 1e-6, `${face.id}: ${(gap * 1000).toFixed(2)} mm in front of its pane`);
    assert.ok(planes.every(value => value === front || plane - value > .015), `${face.id}: the other pane is behind the panel's core`);
    const own = panes.filter(t => Math.abs(dot(t.a, n) - front) < 1e-4), alongs = own.flatMap(t => [t.a, t.b, t.c].map(p => dot(p, a))), ys = own.flatMap(t => [t.a[1], t.b[1], t.c[1]]);
    assert.ok(centreAlong - face.width / 2 >= Math.min(...alongs) - 1e-6 && centreAlong + face.width / 2 <= Math.max(...alongs) + 1e-6, `${face.id}: inside the pane's width`);
    assert.ok(face.centre.y - face.height / 2 >= Math.min(...ys) - 1e-6 && face.centre.y + face.height / 2 <= Math.max(...ys) + 1e-6, `${face.id}: inside the pane's height`);
    assert.ok(Math.min(...alongs) + MIRROR_FIT.margin - 1e-6 <= centreAlong - face.width / 2 && Math.min(...ys) + MIRROR_FIT.margin - 1e-6 <= face.centre.y - face.height / 2, `${face.id}: ${MIRROR_FIT.margin * 1000} mm margin`);
    // No z-fight: no parallel surface of any material (pane, velvet, core,
    // posts, crest, plinth) within 3 mm of the reflector over its rectangle.
    for (const t of triangles) {
      if (Math.abs(dot(t.n, n)) < .999 || Math.abs(dot(t.a, n) - plane) > .025) continue;
      parallelNear++;
      if (Math.abs(dot(t.a, n) - plane) > .003) continue;
      const ta = [t.a, t.b, t.c].map(p => dot(p, a)), ty = [t.a[1], t.b[1], t.c[1]];
      const overlaps = Math.max(...ta) > centreAlong - face.width / 2 + 1e-4 && Math.min(...ta) < centreAlong + face.width / 2 - 1e-4
        && Math.max(...ty) > face.centre.y - face.height / 2 + 1e-4 && Math.min(...ty) < face.centre.y + face.height / 2 - 1e-4;
      assert.ok(!overlaps, `${face.id}: ${t.material} surface ${((dot(t.a, n) - plane) * 1000).toFixed(2)} mm from the reflector`);
    }
    assert.equal(face.yaw, Math.atan2(face.normal.x, face.normal.z));
    assert.ok(Math.abs(face.pane.width - 2 * (((face.along.x ? panel.maxX - panel.minX : panel.maxZ - panel.minZ)) / 2 - MIRROR_PANE.inset)) < 1e-9);
  }
  pass('the 28 live-reflector rectangles sit 3-4 mm in front of the real GLB panes, inside them, with no parallel surface within 3 mm', `${parallelNear} parallel triangles within 25 mm screened`);
}

// 2. Pool size per tier; the low tier never loads Reflector.js.
{
  const sizes = Object.fromEntries(['low', 'medium', 'high', undefined, 'auto'].map(id => [String(id), createFunfairMirrors({ scene: new THREE.Scene(), quality: id ? { id } : {}, furniture: LEVEL.furniture }).poolSize]));
  assert.deepEqual(sizes, { low: 0, medium: 1, high: 2, undefined: 0, auto: 0 });
  assert.deepEqual({ ...MIRROR_POOL }, { low: 0, medium: 1, high: 2 });
  const scene = new THREE.Scene(), loader = spyLoader();
  const low = createFunfairMirrors({ scene, quality: { id: 'low' }, furniture: LEVEL.furniture, factories, loadReflector: loader, clock: steady() });
  low.setLocalAvatar({ player: player({ x: FRONT.x, z: FRONT.z }), x: FRONT.x, z: FRONT.z, yaw: FRONT.yaw });
  await settle(low, eyeAt(FRONT.x, FRONT.y, FRONT.z, FRONT.yaw), 0, 3);
  assert.equal(loader.calls, 0, 'the low tier never asks for Reflector.js');
  assert.equal(low.loading, null); assert.equal(low.pool.length, 0); assert.equal(low.avatar, null);
  assert.equal(scene.getObjectByName('funfairMirrors'), undefined, 'nothing is added to the scene');
  pass('pool sizes per tier: low 0, medium 1, high 2 (no id: 0); low never loads Reflector.js, adds nothing and builds no avatar');
}

// 3. Far from the maze: no load, nothing live, no render.
{
  const scene = new THREE.Scene(), loader = spyLoader();
  const mirrors = createFunfairMirrors({ scene, quality: { id: 'high' }, furniture: LEVEL.furniture, factories, loadReflector: loader, log: quiet, clock: steady() });
  mirrors.setLocalAvatar({ player: player(), x: 0, z: 0 });
  for (const [label, eye] of [['spawn', eyeAt(-2.8, 1.6, 1.7, Math.PI)], ['snack bar over the maze', eyeAt(-10, 1.6, 7, 0, -1.2)], ['crouched over the maze', eyeAt(-10, .9, 7, Math.PI / 2, -1)], ['outside', eyeAt(-30, 1.6, 8, -Math.PI / 2)]]) {
    await settle(mirrors, eye, 0, 1);
    assert.equal(loader.calls, 0, `${label}: no Reflector.js`); assert.equal(mirrors.live.length, 0, label);
  }
  // The refuge, in the cellar 11 m from the panes and behind walls: the pool
  // is prepared, nothing goes live.
  await settle(mirrors, eyeAt(-6, -1.8, -7, Math.PI), 0, 1);
  assert.equal(loader.calls, 1, 'prepared once within 14 m in the cellar'); assert.equal(mirrors.pool.length, 2);
  assert.equal(mirrors.live.length, 0); assert.ok(mirrors.pool.every(reflector => !reflector.visible));
  // Live in front of a mirror, then far again: all invisible.
  await settle(mirrors, eyeAt(FRONT.x, FRONT.y, FRONT.z, FRONT.yaw), 2, 1);
  assert.ok(mirrors.live.length > 0, 'live in front of a mirror');
  for (const eye of [eyeAt(-2.8, 1.6, 1.7, Math.PI), eyeAt(-6, -1.8, -7, Math.PI)]) {
    await settle(mirrors, eye, 4, 1);
    assert.ok(mirrors.pool.every(reflector => !reflector.visible), 'every reflector hidden far from the maze');
    assert.equal(mirrors.avatar?.visible ?? false, false, 'the avatar is hidden with them');
  }
  assert.equal(loader.calls, 1, 'Reflector.js is fetched once');
  mirrors.dispose();
  pass('far from the maze (spawn, the snack bar right above it, outside) nothing loads; 11 m away in the cellar the pool is ready and hidden; leaving hides every reflector');
}

// 4. Assignment near the maze: the mirror in front, not the one edge-on beside.
{
  const scene = new THREE.Scene();
  const medium = createFunfairMirrors({ scene, quality: { id: 'medium' }, furniture: LEVEL.furniture, factories, loadReflector: realReflector, clock: steady() });
  const eye = eyeAt(FRONT.x, FRONT.y, FRONT.z, FRONT.yaw);
  await settle(medium, eye, 0, 1);
  assert.deepEqual(ids(medium), ['miroir-panel-04:east']);
  const faces = medium.faces, front = faces.find(face => face.id === 'miroir-panel-04:east'), side = faces.find(face => face.id === 'miroir-panel-05:south');
  const view = eye.getWorldDirection(new THREE.Vector3()), frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
  const near = faceDistance(side, eye.position);
  assert.ok(near.facing > MIRROR_RANGE.facing && near.distance < faceDistance(front, eye.position).distance, 'the edge-on pane beside the eye is nearer and faces it');
  assert.ok(facePriority(front, eye.position, view, frustum) > 2 * facePriority(side, eye.position, view, frustum), 'but the pane looked at weighs more');
  const check = (mirrors, camera) => {
    for (const reflector of mirrors.pool.filter(item => item.visible)) {
      const face = reflector.userData.face; reflector.updateMatrixWorld(true);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(reflector.matrixWorld);
      assert.ok(normal.distanceTo(new THREE.Vector3(face.normal.x, 0, face.normal.z)) < 1e-9, `${face.id}: oriented to its face`);
      const corners = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(reflector.matrixWorld));
      for (const corner of corners) {
        const across = (corner.x - face.centre.x) * face.along.x + (corner.z - face.centre.z) * face.along.z;
        assert.ok(Math.abs(Math.abs(across) - face.width / 2) < 1e-9 && Math.abs(Math.abs(corner.y - face.centre.y) - face.height / 2) < 1e-9, `${face.id}: sized to its face`);
        assert.ok(Math.abs((corner.x - face.centre.x) * face.normal.x + (corner.z - face.centre.z) * face.normal.z) < 1e-9, `${face.id}: in its plane`);
      }
      assert.ok(faceDistance(face, camera.position).facing > 0, `${face.id}: the eye is on the reflector's side`);
    }
  };
  check(medium, eye);
  const high = createFunfairMirrors({ scene: new THREE.Scene(), quality: { id: 'high' }, furniture: LEVEL.furniture, factories, loadReflector: realReflector, clock: steady() });
  await settle(high, eye, 0, 1);
  assert.equal(high.live.length, 2); assert.equal(high.live[0].id, 'miroir-panel-04:east'); assert.equal(new Set(ids(high)).size, 2);
  check(high, eye);
  const highIds = ids(high), second = M.faceShare(faces.find(face => face.id === highIds[1]), new THREE.Matrix4().multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
  assert.ok(second > MIRROR_RANGE.second, `the second face covers ${(second * 100).toFixed(1)} % of the screen`);
  medium.dispose(); high.dispose();
  // faceShare against the screen sampled ray by ray (a 120 x 120 grid).
  const sampled = (face, camera) => {
    const plane = new THREE.Plane(new THREE.Vector3(face.normal.x, 0, face.normal.z), -(face.normal.x * face.centre.x + face.normal.z * face.centre.z)), ray = new THREE.Raycaster(), hit = new THREE.Vector3();
    let inside = 0;
    for (let i = 0; i < 120; i++) for (let j = 0; j < 120; j++) {
      ray.setFromCamera(new THREE.Vector2((i + .5) / 60 - 1, (j + .5) / 60 - 1), camera);
      if (!ray.ray.intersectPlane(plane, hit)) continue;
      const across = (hit.x - face.centre.x) * face.along.x + (hit.z - face.centre.z) * face.along.z;
      if (Math.abs(across) <= face.width / 2 && Math.abs(hit.y - face.centre.y) <= face.height / 2) inside++;
    }
    return inside / 14400;
  };
  const shareOf = (face, camera) => M.faceShare(face, new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  for (const [id, camera] of [['miroir-panel-04:east', eye], ['miroir-panel-04:east', eyeAt(FRONT.x - .4, FRONT.y, FRONT.z + .9, FRONT.yaw + .6)], ['miroir-panel-03:north', eyeAt(-10, -1.8, 3.2, Math.PI)], ['miroir-panel-05:south', eye]]) {
    const face = faces.find(item => item.id === id), exact = shareOf(face, camera), grid = sampled(face, camera);
    assert.ok(Math.abs(exact - grid) < .012, `${id}: ${(exact * 100).toFixed(1)} % of the screen, ${(grid * 100).toFixed(1)} % sampled`);
  }
  // The high tier's second reflector goes only to a pane large enough on
  // screen (MIRROR_RANGE.second): beside the pane 2.2 m in front, one 8.7 m
  // away covers 1 % of the screen (the verifiers measured 13 ms for such a
  // pass of 94 x 98 pixels) and stays glass; 4.2 m away it is live too.
  const pres = { id: 'pres', kind: 'mirror-panel', axis: 'x', minX: -.9, maxX: .9, minZ: -.05, maxZ: .05, baseY: 0, height: 2.3 };
  const facing = eyeAt(0, 1.6, 2.2), shares = {};
  for (const [label, x, z, expected] of [['far', 4, -5.5, ['pres:south']], ['near', 2.2, -1.3, ['pres:south', 'loin:south']]]) {
    const loin = { ...pres, id: 'loin', minX: x, maxX: x + 1.8, minZ: z - .05, maxZ: z + .05 };
    const pair = createFunfairMirrors({ scene: new THREE.Scene(), quality: { id: 'high' }, furniture: [pres, loin], factories, loadReflector: realReflector, clock: steady() });
    await settle(pair, facing, 0, 1);
    shares[label] = shareOf(pair.faces.find(face => face.id === 'loin:south'), facing);
    assert.deepEqual(ids(pair), expected, `${label}: ${(shares[label] * 100).toFixed(1)} % of the screen`);
    assert.ok(facePriority(pair.faces.find(face => face.id === 'loin:south'), facing.position, facing.getWorldDirection(new THREE.Vector3()), new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(facing.projectionMatrix, facing.matrixWorldInverse))) > 0, `${label}: the other pane is a candidate`);
    pair.dispose();
  }
  assert.ok(shares.far < MIRROR_RANGE.second / 2 && shares.near > MIRROR_RANGE.second, JSON.stringify(shares));
  pass('in front of panel 04 the medium pool takes its east face (not the nearer edge-on pane beside), high adds a second face large enough on screen; each live reflector lies in its face, sized and oriented to it, on the eye side; faceShare matches the screen sampled ray by ray; a far pane under 3 % of the screen never takes the second reflector',
    `${highIds.join(', ')}; second ${(second * 100).toFixed(1)} %; a pane at 8.7 m ${(shares.far * 100).toFixed(1)} %, at 4.2 m ${(shares.near * 100).toFixed(1)} %`);
}

// 5. Hysteresis and the hand-over on two panes side by side.
{
  const wall = [-1, 1].map((side, index) => ({ id: `essai-${index + 1}`, kind: 'mirror-panel', axis: 'x', minX: side < 0 ? -1.9 : .1, maxX: side < 0 ? -.1 : 1.9, minZ: -.05, maxZ: .05, baseY: 0, height: 2.3 }));
  const mirrors = createFunfairMirrors({ scene: new THREE.Scene(), quality: { id: 'medium' }, furniture: wall, factories, loadReflector: realReflector, clock: steady() });
  let time = await settle(mirrors, eyeAt(-.3, 1.6, 3), 0, 1);
  assert.deepEqual(ids(mirrors), ['essai-1:south']);
  const [reflector] = mirrors.pool, material = reflector.material, version = material.version;
  // At rest the reflection is written whole, as an opaque surface: blending
  // one and zero, render order 0, in the opaque list.
  const atRest = label => {
    assert.equal(reflector.userData.opacity, 1, label); assert.equal(material.uniforms.opacity.value, 1, label);
    assert.deepEqual([material.blendSrc, material.blendDst, reflector.renderOrder], [THREE.OneFactor, THREE.ZeroFactor, 0], label);
  };
  atRest('faded in');
  assert.equal(material.blending, THREE.CustomBlending); assert.equal(material.transparent, false, 'in the opaque list');
  // three.js 0.180 blends a material that is not transparent only when its
  // blending is not NormalBlending, and keys programs on that, not on factors.
  const three = readFileSync(fileURLToPath(import.meta.resolve('three')), 'utf8');
  assert.ok(three.includes('( material.blending === NormalBlending && material.transparent === false )\n\t\t\t? setBlending( NoBlending )'), 'state: blending of an opaque material');
  assert.ok(three.includes('opaque: material.transparent === false && material.blending === NormalBlending && material.alphaToCoverage === false,'), 'programs: the only blending key');
  const ratio = x => {
    const eye = eyeAt(x, 1.6, 3), view = eye.getWorldDirection(new THREE.Vector3()), frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
    const [a, b] = ['essai-1:south', 'essai-2:south'].map(id => facePriority(mirrors.faces.find(face => face.id === id), eye.position, view, frustum));
    return b / a;
  };
  assert.ok(ratio(.6) > 1.6 && ratio(.6) < MIRROR_RANGE.keep, `at x .6 the neighbour weighs ${ratio(.6).toFixed(2)} times more: over round 1's keep (1.6), under ${MIRROR_RANGE.keep}`);
  assert.ok(ratio(1.2) > MIRROR_RANGE.keep && 1 / ratio(-1.2) > MIRROR_RANGE.keep);
  let swaps = 0, last = ids(mirrors).join();
  const frames = [];
  const step = (x, seconds, z = 3) => {
    const end = time + seconds;
    for (; time < end; time += 1 / 30) {
      mirrors.update(time, { camera: eyeAt(x(time), 1.6, z) });
      const now = ids(mirrors).join();
      frames.push({ time, live: now, opacity: reflector.userData.opacity, order: reflector.renderOrder, src: material.blendSrc, dst: material.blendDst, leaving: reflector.userData.leaving });
      if (now !== last) { swaps++; last = now; }
    }
  };
  step(() => .15, 1);
  assert.equal(swaps, 0, 'a slightly heavier neighbour does not take the pool');
  step(time => Math.sin(time * 40) * .08, 3);
  assert.equal(swaps, 0, 'jitter around the middle never flips it');
  step(() => .6, 3);
  assert.equal(swaps, 0, 'nor one that weighs twice as much'); atRest('kept');
  // A clearly heavier one does, through the glass: the live reflection fades
  // out, then the other fades in.
  frames.length = 0;
  const moved = time;
  step(() => 1.2, 1);
  assert.deepEqual(ids(mirrors), ['essai-2:south'], 'a clearly heavier one does'); assert.equal(swaps, 1);
  const out = frames.filter(frame => frame.live === 'essai-1:south' && frame.leaving), into = frames.filter(frame => frame.live === 'essai-2:south');
  assert.ok(out.length >= 4 && out[0].time - moved <= MIRROR_RANGE.every + 1e-9, `the old one starts to fade within one choice (${(out[0]?.time - moved).toFixed(2)} s)`);
  for (let index = 1; index < out.length; index++) assert.ok(out[index].opacity < out[index - 1].opacity, 'fading out');
  assert.ok(out[0].opacity > .7 && out.at(-1).opacity < .3);
  assert.ok(out.every(frame => frame.order === 1 && frame.src === THREE.SrcAlphaFactor && frame.dst === THREE.OneMinusSrcAlphaFactor), 'blended over the glass, after it');
  const outFor = into[0].time - out[0].time;
  assert.ok(outFor >= MIRROR_LOOK.fade - 1e-9 && outFor <= MIRROR_LOOK.fade + 2 / 30, `faded out over ${outFor.toFixed(3)} s`);
  const inFor = into.find(frame => frame.opacity === 1).time - into[0].time;
  assert.ok(into[0].opacity < .2 && inFor >= MIRROR_LOOK.fade - 1 / 30 - 1e-9 && inFor <= MIRROR_LOOK.fade + 1 / 30 + 1e-9, `faded in over ${inFor.toFixed(3)} s, from ${into[0].opacity.toFixed(2)}`);
  for (let index = 1; index < into.length; index++) assert.ok(into[index].opacity >= into[index - 1].opacity, 'fading in');
  atRest('the new one faded in');
  assert.equal(material.version, version, 'the fade never changes the shader program');
  // The hand-over from the first pane to the second took one frame: no frame without a live pane between them.
  assert.equal(frames.filter(frame => frame.live === '').length, 0, 'no gap between the two');
  // Held for its first second even when the other at once weighs 3.6 times more.
  const arrived = into[0].time;
  step(() => -1.2, MIRROR_RANGE.hold - (time - arrived) - .1);
  assert.deepEqual(ids(mirrors), ['essai-2:south'], `still held ${(time - arrived).toFixed(2)} s after its arrival`);
  assert.equal(reflector.userData.leaving, false);
  step(() => -1.2, MIRROR_RANGE.every + 2 * MIRROR_LOOK.fade + .3);
  assert.deepEqual(ids(mirrors), ['essai-1:south']); assert.equal(swaps, 2);
  const outweighed = mirrors.handovers.filter(item => item.event === 'leave' && item.why === 'outweighed');
  assert.equal(outweighed.length, 2);
  const heldFor = outweighed.map(item => item.time - mirrors.handovers.filter(other => other.event === 'arrive' && other.face === item.face && other.time <= item.time).at(-1).time);
  assert.ok(heldFor.every(seconds => seconds >= MIRROR_RANGE.hold - 1e-9), `each pane kept at least ${MIRROR_RANGE.hold} s (${heldFor.map(value => value.toFixed(2))})`);
  // A pause in the middle of a hand-over: the paused room draws the scene and
  // runs no update. The fade ends at the next drawing (the old pane out, then
  // the new one in whole): never a mirror half faded for the whole pause.
  const fake = fakeRenderer(), still = new THREE.Scene();
  const drawPaused = x => { const view = eyeAt(x, 1.6, 3); for (let index = 0; index < 3; index++) for (const item of mirrors.pool) if (item.visible) item.onBeforeRender(fake, still, view, item.geometry, item.material, null); };
  step(() => -1.2, MIRROR_RANGE.hold);
  for (let tries = 0; tries < 60 && !(reflector.userData.leaving && reflector.userData.opacity < .7); tries++) step(() => 1.2, 1 / 30 - 1e-9);
  const midOut = reflector.userData.opacity;
  assert.ok(reflector.userData.leaving && midOut > .3 && midOut < .7, `half faded out (${midOut.toFixed(2)})`);
  drawPaused(1.2);
  assert.ok(reflector.userData.opacity === 0 && material.uniforms.opacity.value === 0, 'the old pane faded out at once');
  for (let tries = 0; tries < 10 && !(ids(mirrors).join() === 'essai-2:south' && reflector.userData.opacity > .3); tries++) step(() => 1.2, 1 / 30 - 1e-9);
  const midIn = reflector.userData.opacity;
  assert.ok(ids(mirrors).join() === 'essai-2:south' && !reflector.userData.leaving && midIn > .3 && midIn < .7, `the new one half faded in (${midIn.toFixed(2)})`);
  drawPaused(1.2);
  atRest('the new one faded in at once, during a pause');
  assert.ok(mirrors.stats.settled >= 2);
  // Turning away: off screen, it goes at once, without a fade.
  mirrors.update(time, { camera: eyeAt(-1.2, 1.6, 3, Math.PI) });
  assert.equal(mirrors.live.length, 0, 'facing away: nothing live, at once');
  assert.match(mirrors.handovers.at(-1).event, /^gone:/);
  mirrors.dispose();
  pass(`hysteresis: a neighbour weighing up to ${MIRROR_RANGE.keep} times more (twice: round 1 switched) and jitter never take the pool; a clearly heavier one does through the glass (a ${MIRROR_LOOK.fade} s fade out, then in, blended after the opaque glass, no program change, no gap), after the new pane's ${MIRROR_RANGE.hold} s hold; a pause mid hand-over ends the fade at the next drawing (out ${midOut.toFixed(2)} to 0, in ${midIn.toFixed(2)} to 1); turning away releases it at once`);
}

// 6. The avatar: the teammates' pipeline, on the mirror layer alone.
{
  const scene = new THREE.Scene(), mirrors = createFunfairMirrors({ scene, quality: { id: 'medium' }, furniture: LEVEL.furniture, factories, loadReflector: realReflector, clock: steady() });
  const eye = eyeAt(FRONT.x, FRONT.y, FRONT.z, FRONT.yaw);
  const state = { player: player({ x: FRONT.x, z: FRONT.z }), color: 0xb28e68, x: FRONT.x, z: FRONT.z, yaw: FRONT.yaw, pitch: -.1 };
  mirrors.setLocalAvatar(state);
  mirrors.update(0, { camera: eyeAt(-2.8, 1.6, 1.7) });
  assert.equal(mirrors.avatar, null, 'not built far from the maze');
  let time = await settle(mirrors, eye, 0, .5);
  const avatar = mirrors.avatar;
  assert.ok(avatar?.visible, 'built and shown when a reflector goes live');
  assert.equal(avatar.parent, mirrors.rig);
  for (const key of ['body', 'aim', 'holder', 'arms', 'legs', 'knees']) assert.ok(avatar.userData[key], `createSurvivor rig: ${key}`);
  assert.equal(avatar.userData.weaponType, 'shotgun'); assert.equal(avatar.userData.torso.material.color.getHex(), 0xb28e68, 'the colour teammates see');
  assert.deepEqual([avatar.position.x, avatar.position.y, avatar.position.z], [FRONT.x, -3.4, FRONT.z]); assert.equal(avatar.rotation.y, FRONT.yaw);
  const layered = () => {
    const nodes = []; avatar.traverse(node => nodes.push(node));
    for (const node of nodes) {
      assert.equal(node.layers.mask, 1 << MIRROR_LAYER, `${node.name || node.type}: mirror layer only`);
      assert.equal(eye.layers.test(node.layers), false, 'never in the main camera');
      assert.equal(new THREE.Raycaster().layers.test(node.layers), false, 'never hit by a raycaster');
      for (const reflector of mirrors.pool) assert.equal(reflector.camera.layers.test(node.layers), true, 'seen by the reflector camera');
      if (node.isMesh) assert.equal(node.castShadow, false);
    }
    return nodes.length;
  };
  const before = layered();
  // The reflected eyes on the camera's eye line (PLAYER_POSTURE), standing
  // and crouched: the teammates' model alone has them 13 cm higher standing
  // and 6 cm lower crouched.
  const eyeHeight = () => { avatar.updateMatrixWorld(true); return avatar.userData.head.localToWorld(new THREE.Vector3(0, MIRROR_AVATAR.eye, 0)).y - avatar.position.y; };
  const model = { standing: avatar.userData.mirrorHead + MIRROR_AVATAR.eye, crouched: avatar.userData.mirrorHead - .86 + MIRROR_AVATAR.eye };
  const eyes = { standing: eyeHeight() };
  state.player = { ...state.player, crouched: true };
  for (let index = 0; index < 45; index++) mirrors.update(time += 1 / 30, { camera: eye });
  assert.ok(avatar.userData.crouch > .999, 'crouched');
  eyes.crouched = eyeHeight();
  state.player = { ...state.player, crouched: false };
  for (let index = 0; index < 45; index++) mirrors.update(time += 1 / 30, { camera: eye });
  eyes.again = eyeHeight();
  assert.ok(Math.abs(eyes.standing - PLAYER_POSTURE.standingEye) < .003 && Math.abs(eyes.again - PLAYER_POSTURE.standingEye) < .003, `standing eyes at ${eyes.standing.toFixed(3)} m, the camera at ${PLAYER_POSTURE.standingEye}`);
  assert.ok(Math.abs(eyes.crouched - PLAYER_POSTURE.crouchedEye) < .003, `crouched eyes at ${eyes.crouched.toFixed(3)} m, the camera at ${PLAYER_POSTURE.crouchedEye}`);
  assert.ok(model.standing - PLAYER_POSTURE.standingEye > .12 && PLAYER_POSTURE.crouchedEye - model.crouched > .05, `the model alone: ${model.standing.toFixed(3)} m and ${model.crouched.toFixed(3)} m`);
  assert.ok(Math.abs(avatar.scale.x - PLAYER_POSTURE.standingEye / model.standing) < 1e-9 && avatar.scale.x === avatar.scale.y && avatar.scale.y === avatar.scale.z, 'scaled whole about its feet');
  assert.deepEqual([avatar.position.x, avatar.position.y, avatar.position.z], [FRONT.x, -3.4, FRONT.z], 'feet where the player stands');
  assert.equal(eye.layers.mask, 1, 'the main camera keeps layer 0 alone');
  for (const reflector of mirrors.pool) assert.ok(reflector.camera.layers.isEnabled(0) && reflector.camera.layers.isEnabled(MIRROR_LAYER));
  // Weapon change, dual wield, crouch, walk and an open umbrella.
  state.player = { ...state.player, weapon: 'rifle', dualWield: true, hands: { secondary: { weapon: 'pistol' } }, crouched: true, umbrella: { open: true, remaining: 10, max: 100 } };
  const gait = avatar.userData.gait;
  for (let index = 0; index < 30; index++, time += 1 / 30) { state.z = FRONT.z + index * .05; mirrors.update(time, { camera: eye, active: true, snapshot: { expedition: { enabled: true } } }); }
  assert.equal(avatar.userData.weaponType, 'rifle'); assert.equal(avatar.userData.secondaryType, 'pistol');
  assert.ok(avatar.userData.crouch > .9, `crouched (${avatar.userData.crouch.toFixed(2)})`); assert.ok(avatar.userData.gait > gait + 1, 'the walk cycle runs');
  const umbrella = avatar.getObjectByName('funfairMirrorUmbrella');
  assert.ok(umbrella.visible, 'an open umbrella is carried'); assert.equal(umbrella.userData.canopy.material.color.getHex(), 0x786649, 'worn canopy colour, as for teammates');
  assert.ok(layered() > before, 'the new weapons and the umbrella are on the mirror layer too');
  state.player = { ...state.player, umbrella: { open: false, remaining: 10 } }; mirrors.update(time += .04, { camera: eye, active: true, snapshot: { expedition: { enabled: true } } });
  assert.equal(umbrella.visible, false);
  // Hidden when dead, waiting or out of the game; rebuilt for a new colour.
  for (const change of [{ alive: false }, { waiting: true }]) {
    state.player = { ...state.player, ...change }; mirrors.update(time += .04, { camera: eye });
    assert.equal(avatar.visible, false, JSON.stringify(change)); state.player = { ...state.player, alive: true, waiting: false };
  }
  mirrors.setLocalAvatar(null); mirrors.update(time += .04, { camera: eye }); assert.equal(avatar.visible, false, 'no local player');
  mirrors.setLocalAvatar({ ...state, color: 0x8da46e }); mirrors.update(time += .04, { camera: eye });
  assert.notEqual(mirrors.avatar, avatar); assert.equal(mirrors.avatar.userData.torso.material.color.getHex(), 0x8da46e); assert.equal(avatar.parent, null, 'the old one is removed');
  // The main camera is never given the layer: only this module touches layers.
  const sources = ['client.js', 'online-client.js', 'world.js', 'world-funfair.js', 'graphics.js', 'world-supermarket.js', 'world-hospital.js', 'funfair-outdoors.js']
    .map(name => [name, readFileSync(new URL(`../../public/${name}`, import.meta.url), 'utf8')]);
  for (const [name, text] of sources) assert.doesNotMatch(text, /\blayers\s*\.\s*(?:enable|set|toggle|enableAll|mask)\b/, `${name} never changes layers`);
  mirrors.dispose();
  pass('the avatar is built with createSurvivor only once a reflector is live, follows weapon, dual wield, crouch, walk, umbrella and colour, hides when dead or waiting, and every node is on the mirror layer alone; its eyes are on the camera eye line standing and crouched', `${before} nodes; eyes at ${eyes.standing.toFixed(3)} and ${eyes.crouched.toFixed(3)} m (the model alone ${model.standing.toFixed(3)} and ${model.crouched.toFixed(3)})`);
}

// A minimal WebGLRenderer stand-in for Reflector.onBeforeRender.
function fakeRenderer(width = 1600, height = 900) {
  let target = null;
  const renderer = { size: { width, height }, calls: [], xr: { enabled: false }, shadowMap: { autoUpdate: true }, autoClear: true, onRender: null,
    state: { buffers: { depth: { setMask() {} } }, viewport() {} },
    getDrawingBufferSize: vector => vector.set(renderer.size.width, renderer.size.height),
    getRenderTarget: () => target, setRenderTarget: next => { target = next; }, clear() {},
    render(scene, camera) { renderer.calls.push({ camera, target, inside: renderer.onRender?.(scene, camera) ?? null }); } };
  return renderer;
}

// 7, 8. One reflection pass, drawn by update() before the main render: no
// recursion, first person hidden, targets at half the drawing buffer following
// resizes, only the pane's rectangle drawn; the main render keeps it.
{
  const wall = [-1, 1].map((side, index) => ({ id: `essai-${index + 1}`, kind: 'mirror-panel', axis: 'x', minX: side < 0 ? -1.9 : .1, maxX: side < 0 ? -.1 : 1.9, minZ: -.05, maxZ: .05, baseY: 0, height: 2.3 }));
  const outdoors = new THREE.Group(); outdoors.name = 'outdoors';
  const scene = new THREE.Scene(), mirrors = createFunfairMirrors({ scene, quality: { id: 'high' }, furniture: wall, factories, loadReflector: realReflector, offstage: [outdoors], clock: steady() });
  scene.add(outdoors);
  const eye = eyeAt(0, 1.6, 3); scene.add(eye);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .4)), flashlight = new THREE.SpotLight(0xffffff, 1);
  eye.add(gun, flashlight, flashlight.target); eye.updateMatrixWorld(true);
  mirrors.setLocalAvatar({ player: player({ x: 0, y: 0, z: 3 }), x: 0, z: 3 });
  let time = await settle(mirrors, eye, 0, .5);
  const [first, second] = mirrors.pool;
  assert.ok(first.visible && second.visible, 'both live');
  assert.ok(first instanceof Reflector, 'three.js Reflector');
  assert.equal(mirrors.stats.renders, 0, 'no renderer known yet: no pass');
  const renderer = fakeRenderer();
  renderer.onRender = (_, camera) => {
    const self = renderer.getRenderTarget() === first.getRenderTarget() ? first : second, other = self === first ? second : first;
    const inside = { other: other.visible, self: self.visible, gun: gun.visible, light: flashlight.visible, outdoors: outdoors.visible, layer: camera.layers.isEnabled(MIRROR_LAYER), main: camera === eye, shadows: renderer.shadowMap.autoUpdate };
    other.onBeforeRender(renderer, scene, camera, other.geometry, other.material, null);
    return inside;
  };
  mirrors.setRenderer(renderer);
  mirrors.update(time += 1 / 30, { camera: eye });
  assert.equal(renderer.calls.length, 2, 'update draws each live mirror once, and the mirror hidden inside a pass never renders in it');
  for (const call of renderer.calls) assert.deepEqual(call.inside, { other: false, self: false, gun: false, light: true, outdoors: false, layer: true, main: false, shadows: false });
  assert.deepEqual(renderer.calls.map(call => call.target), [first.getRenderTarget(), second.getRenderTarget()]);
  assert.equal(renderer.getRenderTarget(), null, 'the canvas is the target again');
  assert.ok(second.visible && first.visible && gun.visible && flashlight.visible && outdoors.visible, 'everything shown again after the pass');
  assert.equal(mirrors.stats.renders, 2); assert.equal(mirrors.stats.skipped, 2);
  // The main render of the same view keeps those reflections.
  first.onBeforeRender(renderer, scene, eye, first.geometry, first.material, null);
  second.onBeforeRender(renderer, scene, eye, second.geometry, second.material, null);
  assert.equal(renderer.calls.length, 2, 'drawn for this very view: kept');
  const target = first.getRenderTarget();
  assert.deepEqual([target.width, target.height], [800, 450], 'half of 1600 x 900');
  // The reflected camera is narrowed to the pane: the pane fills its view
  // (two target pixels of margin), what it cannot show is culled, and it is
  // drawn into a viewport of the target sized as the pane is on screen.
  const vp = target.viewport, fx = vp.z / target.width, fy = vp.w / target.height;
  assert.ok(target.scissorTest && vp.x === 0 && vp.y === 0 && target.scissor.equals(vp), `viewport ${vp.toArray()}`);
  assert.ok(fx * fy < .6 && fx > .05 && fy > .05, `the pane's share of the target (${(fx * fy * 100).toFixed(0)} %)`);
  const onScreen = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => new THREE.Vector4(x, y, 0, 1).applyMatrix4(new THREE.Matrix4().multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse).multiply(first.matrixWorld)));
  const screenWidth = (Math.max(...onScreen.map(p => p.x / p.w)) - Math.min(...onScreen.map(p => p.x / p.w))) / 2, screenHeight = (Math.max(...onScreen.map(p => p.y / p.w)) - Math.min(...onScreen.map(p => p.y / p.w))) / 2;
  assert.ok(Math.abs(fx - screenWidth) * target.width <= 6 && Math.abs(fy - screenHeight) * target.height <= 6, `viewport ${fx.toFixed(3)} x ${fy.toFixed(3)} of the target, pane ${screenWidth.toFixed(3)} x ${screenHeight.toFixed(3)} of the screen`);
  const lens = new THREE.Matrix4().multiplyMatrices(first.camera.projectionMatrix, first.camera.matrixWorldInverse).multiply(first.matrixWorld);
  const corners = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => new THREE.Vector4(x, y, 0, 1).applyMatrix4(lens)).map(p => [p.x / p.w, p.y / p.w]);
  for (const [x, y] of corners) assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1 && (Math.abs(x) > .95 || Math.abs(y) > .95), `a pane corner at the edge of the narrowed view (${x.toFixed(3)}, ${y.toFixed(3)})`);
  assert.ok(Math.min(...corners.map(c => c[0])) < -.95 && Math.max(...corners.map(c => c[0])) > .95 && Math.min(...corners.map(c => c[1])) < -.95 && Math.max(...corners.map(c => c[1])) > .95, 'the pane fills the narrowed view');
  const uv = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => new THREE.Vector4(x, y, 0, 1).applyMatrix4(first.material.uniforms.textureMatrix.value)).map(p => [p.x / p.w, p.y / p.w]);
  for (const [u, v] of uv) assert.ok(u >= -1e-6 && u <= fx + 1e-6 && v >= -1e-6 && v <= fy + 1e-6, `the pane reads its own viewport (${u.toFixed(3)}, ${v.toFixed(3)})`);
  const narrowed = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(first.camera.projectionMatrix, first.camera.matrixWorldInverse));
  const wide = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(eye.projectionMatrix, first.camera.matrixWorldInverse));
  const seen = new THREE.Vector3(-3, 1.6, 8), beside = new THREE.Vector3(6, 1.6, 8);
  assert.ok(narrowed.containsPoint(seen) && wide.containsPoint(seen), 'what the pane shows is drawn');
  assert.ok(wide.containsPoint(beside) && !narrowed.containsPoint(beside), 'what the pane cannot show is culled');
  const drawn = `viewport ${vp.z} x ${vp.w} of ${target.width} x ${target.height}`;
  // A view the reflection was not drawn for (no update since, as in a paused
  // room, or a resize): the main render draws it, nested, still alone.
  renderer.onRender = null;
  const moved = eyeAt(.2, 1.6, 3);
  first.onBeforeRender(renderer, scene, moved, first.geometry, first.material, null);
  assert.equal(renderer.calls.length, 3); assert.equal(mirrors.stats.nested, 1);
  renderer.size = { width: 1000, height: 500 };
  first.onBeforeRender(renderer, scene, moved, first.geometry, first.material, null);
  assert.deepEqual([target.width, target.height], [500, 250], 'a canvas resize resizes the target');
  assert.equal(renderer.calls.length, 4);
  renderer.size = { width: 3, height: 1 }; first.onBeforeRender(renderer, scene, moved, first.geometry, first.material, null);
  assert.deepEqual([target.width, target.height], [2, 1], 'never a zero-sized target');
  // Nothing is drawn from behind the plane, nor for a mirror out of the view.
  const before = renderer.calls.length;
  first.onBeforeRender(renderer, scene, eyeAt(0, 1.6, -3, Math.PI), first.geometry, first.material, null);
  assert.equal(renderer.calls.length, before, 'nothing rendered from behind');
  renderer.size = { width: 1600, height: 900 };
  const passes = mirrors.stats.renders;
  mirrors.update(time += 1 / 30, { camera: eyeAt(0, 1.6, 3, -1.2) });
  assert.ok(mirrors.stats.renders - passes < 2, 'a mirror outside the view is not drawn');
  pass('one reflection pass per live mirror, drawn by update() before the main render and kept by it: the other mirror hidden and its own pass refused inside (no recursion), the first-person gun and the outdoor scenery hidden but the torch kept, shadows frozen, the mirror layer on; redrawn nested only for another view or a resize; half the drawing buffer; the reflected camera narrowed to the pane (culling what it cannot show) and drawn into a pane-sized viewport; nothing from behind',
    drawn);

  // 9. Colour: the reflection is drawn with the main view's own pipeline.
  const material = first.material;
  assert.equal(material.isShaderMaterial, true); assert.equal(material.toneMapped, false); assert.equal(material.fog, false);
  assert.doesNotMatch(material.fragmentShader, /tonemapping_fragment|colorspace_fragment/, 'no second tone mapping or encoding');
  assert.equal(material.fragmentShader, MIRROR_SHADER.fragmentShader);
  for (const reflector of mirrors.pool) {
    const renderTarget = reflector.getRenderTarget();
    assert.equal(renderTarget.isXRRenderTarget, true); assert.equal(renderTarget.texture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(renderTarget.texture.type, THREE.HalfFloatType, 'half float: stored display values neither clamped nor quantised');
  }
  // Three.js 0.180 tone maps and encodes a target only when it is flagged XR,
  // in its texture's colour space, and fog, background and programs follow:
  // the trick must be revisited if a three.js update changes these lines.
  const three = readFileSync(fileURLToPath(import.meta.resolve('three')), 'utf8');
  assert.equal(three.split('if ( currentRenderTarget === null || currentRenderTarget.isXRRenderTarget === true ) {').length, 2, 'program parameters: tone mapping');
  assert.equal(three.split('if ( _currentRenderTarget === null || _currentRenderTarget.isXRRenderTarget === true ) {').length, 2, 'program change: tone mapping');
  assert.equal(three.split("outputColorSpace: ( currentRenderTarget === null ) ? renderer.outputColorSpace : ( currentRenderTarget.isXRRenderTarget === true ? currentRenderTarget.texture.colorSpace : LinearSRGBColorSpace ),").length, 2, 'program parameters: encoding');
  assert.equal(three.split("const colorSpace = ( _currentRenderTarget === null ) ? _this.outputColorSpace : ( _currentRenderTarget.isXRRenderTarget === true ? _currentRenderTarget.texture.colorSpace : LinearSRGBColorSpace );").length, 2, 'program change: encoding');
  assert.match(readFileSync(fileURLToPath(import.meta.resolve('three').replace('three.module.js', 'three.core.js')), 'utf8'), /if \( currentRenderTarget\.isXRRenderTarget === true \) \{\s*return currentRenderTarget\.texture\.colorSpace;/, 'fog and background colours');
  const tint = material.uniforms.color.value.toArray();
  tint.forEach((value, index) => assert.ok(Math.abs(value - MIRROR_LOOK.tint[index]) < 1e-9, 'the tint is taken as given'));
  assert.ok(Math.min(...tint) >= .85 && Math.max(...tint) <= 1 && Math.max(...tint) / Math.min(...tint) < 1.06, `a light tint (${tint})`);
  assert.ok(material.uniforms.haze.value > 0 && material.uniforms.haze.value < .01);
  assert.ok(MIRROR_LOOK.clipBias > 0 && MIRROR_LOOK.clipBias <= .005);
  pass('colour: reflection targets are drawn with the main view\'s own programs, tone mapping, encoding, fog and background (three.js 0.180 lines guarded); the mirror adds only a light tint', tint.map(value => value.toFixed(3)).join(' '));

  // 10. Dispose frees the targets, materials, geometry and the avatar.
  const freed = new Set(), watch = (thing, name) => thing.addEventListener('dispose', () => freed.add(name));
  mirrors.pool.forEach((reflector, index) => { watch(reflector.getRenderTarget(), `target-${index}`); watch(reflector.material, `material-${index}`); });
  watch(first.geometry, 'plane');
  const avatar = mirrors.avatar; assert.ok(avatar);
  let ownGeometries = 0;
  avatar.traverse(node => { if (node.geometry && node.name !== 'survivorFace') { ownGeometries++; watch(node.geometry, 'avatar-' + node.uuid); } });
  if (!avatar.userData.flash.parent) avatar.userData.flash.traverse(node => { if (node.geometry) { ownGeometries++; watch(node.geometry, 'avatar-' + node.uuid); } });
  avatar.userData.flash.traverse(node => { if (node.material) watch(node.material, 'flash'); });
  watch(avatar.userData.torso.material, 'clothes');
  const canopy = avatar.userData.mirrorUmbrella.userData.canopy.material; watch(canopy, 'canopy');
  mirrors.dispose();
  for (const name of ['target-0', 'target-1', 'material-0', 'material-1', 'plane', 'clothes', 'canopy', 'flash']) assert.ok(freed.has(name), name);
  assert.equal([...freed].filter(name => name.startsWith('avatar-')).length, ownGeometries, 'every geometry of the avatar');
  assert.equal(scene.getObjectByName('funfairMirrors'), undefined); assert.equal(avatar.parent, null); assert.equal(mirrors.pool.length, 0);
  assert.doesNotThrow(() => mirrors.update(10, { camera: eye })); assert.equal(mirrors.live.length, 0);
  // A dispose while Reflector.js is still loading builds nothing afterwards.
  let release; const gate = new Promise(resolve => { release = resolve; });
  const late = createFunfairMirrors({ scene, quality: { id: 'high' }, furniture: wall, factories, loadReflector: () => gate.then(realReflector) });
  late.update(0, { camera: eye }); late.dispose(); release(); await late.loading;
  assert.equal(late.pool.length, 0); assert.equal(scene.getObjectByName('funfairMirrors'), undefined);
  pass('dispose frees both render targets, both mirror materials, the shared plane, every avatar geometry, its clothes and umbrella, and a load still pending builds nothing', `${freed.size} resources`);
}

// 11. The real funfair world: real collision proxies for the line of sight,
// the real survivor factories, prewarm and dispose.
{
  const release = holdPerformance();
  const scene = new THREE.Scene(), camera = eyeAt(FRONT.x, FRONT.y, FRONT.z, FRONT.yaw); scene.add(camera);
  const world = W.createWorld(scene, { quality: { id: 'medium', shadows: false, shadowMapSize: 0, fireflies: 0, groundDetail: 0, rainFraction: .1 }, loadDecor: async () => new THREE.Group(), loadReflector: realReflector });
  assert.equal(await world.ready, true);
  const compiled = [];
  const renderer = fakeRenderer(); renderer.compile = (_, used) => compiled.push(used);
  renderer.onRender = () => ({ outdoors: scene.getObjectByName('funfairOutdoors').visible, sky: world.atmosphere.sky?.visible ?? false, rain: world.expedition.rain.visible });
  world.prewarm(renderer, camera);
  assert.equal(compiled.length, 1);
  const self = player({ x: FRONT.x, z: FRONT.z });
  const context = time => ({ snapshot: { players: [self], expedition: { enabled: false } }, myId: self.id, active: true, camera, survivors: new Map() });
  world.setLocalAvatar({ player: self, color: 0x809fac, x: FRONT.x, z: FRONT.z, yaw: FRONT.yaw, pitch: 0 });
  worldFrame(world, 0, context(0)); await world.mirrors.loading;
  for (let time = 0; time < 1; time += 1 / 30) worldFrame(world, time, context(time));
  assert.deepEqual(ids(world.mirrors), ['miroir-panel-04:east'], 'live through the real proxies');
  assert.ok(world.mirrors.stats.renders > 20 && renderer.calls.every(call => call.target === world.mirrors.pool[0].getRenderTarget()), 'drawn each frame with the renderer prewarm handed over');
  assert.ok(renderer.calls.every(call => call.inside.outdoors === false && call.inside.sky === false && call.inside.rain === false), 'outdoor scenery, sky and rain left out of the cellar reflection');
  assert.ok(scene.getObjectByName('funfairOutdoors').visible, 'and shown again for the main view');
  assert.ok(world.mirrors.avatar?.visible && world.mirrors.avatar.userData.body, 'the avatar from world.js createSurvivor');
  assert.equal(world.mirrors.rig.parent, scene);
  // From the corridor, the maze wall hides every pane: nothing live.
  const corridor = eyeAt(-12, -1.8, 1, Math.PI);
  for (let time = 2; time < 3; time += 1 / 30) worldFrame(world, time, { ...context(time), camera: corridor });
  assert.equal(world.mirrors.live.length, 0, 'the north wall of the maze blocks the line of sight');
  // Through the maze door (x -9) the far panes are in sight.
  const door = eyeAt(-9, -1.8, 1.2, Math.PI);
  for (let time = 3; time < 4; time += 1 / 30) worldFrame(world, time, { ...context(time), camera: door });
  assert.equal(world.mirrors.live.length, 1, `through the door: ${ids(world.mirrors)}`);
  const throughDoor = ids(world.mirrors)[0];
  assert.equal(camera.layers.mask, 1);
  const rig = world.mirrors.rig;
  world.dispose(); release();
  assert.equal(rig.parent, null); assert.equal(world.mirrors.pool.length, 0);
  pass('the funfair world wires the pool: real collision proxies hide the panes from the corridor and show one through the door, prewarm hands the renderer, outdoor scenery stays out of the reflection, dispose frees it', `through the door: ${throughDoor}`);
}

// 12. MIRROR_SIGHT's premise, against the real GLB: the maze is closed but
// for its doorway, and the cellar is closed around and overhead but for its
// stair wells. Over every wall of the maze, the cellar's four outer walls and
// the slab over the cellar, an opaque surface of the decor (not a blended
// one: glass, decals, grime, pools of light) parallel to the sheet, within
// 15 cm of it and facing the inside (a one-sided face seen from behind is not
// drawn) covers each sample point outside the openings: every 10 cm, and every
// 2.5 cm within 25 cm of an opening, so the art opens nowhere more than 2.5 cm
// beyond them (MIRROR_SIGHT.opening is 5 cm).
const { SPACE } = await import('../../public/level-space.js');
const mazeRoom = SPACE.rooms.find(room => room.id === 'miroirs');
const mazeSlab = SPACE.slabs.find(slab => slab.maxY === 0 && slab.minX <= mazeRoom.target.x && slab.maxX >= mazeRoom.target.x && slab.minZ <= mazeRoom.target.z && slab.maxZ >= mazeRoom.target.z);
const ENCLOSURE = mirrorEnclosure(mazeRoom, { floorY: -3.4, ceilingY: 0, slabBottom: mazeSlab.minY, wells: SPACE.holes });
const MAZE = Object.freeze({ minX: -17, maxX: -2.6, minZ: 2.4, maxZ: 12, floor: -3.4, ceiling: -.24 }), CELLAR = Object.freeze({ minX: -17, maxX: 17, minZ: -12, maxZ: 12 });
{
  assert.deepEqual(mazeRoom.bounds, { minX: MAZE.minX, maxX: MAZE.maxX, minZ: MAZE.minZ, maxZ: MAZE.maxZ });
  assert.equal(mazeSlab.minY, MAZE.ceiling); assert.equal(SPACE.holes.length, 2);
  assert.deepEqual(SPACE.floors.find(floor => floor.id === 'cellar'), { id: 'cellar', ...CELLAR, y: MAZE.floor });
  assert.equal(mazeRoom.doors.length, 1); assert.equal(ENCLOSURE.portals.length, 1); assert.equal(ENCLOSURE.skylights.length, 2); assert.equal(ENCLOSURE.upstairs, -MIRROR_SIGHT.top);
  for (const face of mirrorFaces(LEVEL.furniture)) assert.ok(ENCLOSURE.box.containsPoint(new THREE.Vector3(face.centre.x, face.centre.y, face.centre.z)), `${face.id} is in the maze`);
  const bytes = readFileSync(glbPath), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const blended = new Set(json.materials.filter(material => (material.alphaMode ?? 'OPAQUE') !== 'OPAQUE').map(material => material.name));
  const twoSided = new Set(json.materials.filter(material => material.doubleSided).map(material => material.name));
  assert.ok(blended.has('Glass_clear'), 'glass is no wall');
  const door = mazeRoom.doors[0];
  assert.equal(door.axis, 'x'); assert.equal(door.z, MAZE.minZ);
  // axis: the sheet's normal (0 x, 1 y, 2 z) at 'at', 'inside' the sign of
  // that normal for a face turned to the inside; u, v: the axes along it. The
  // east wall starts where the north wall's block ends (z 2.5).
  const wall = (id, axis, at, inside, u, range) => ({ id, axis, at, inside, u, v: 1, range: [range, [MAZE.floor, MAZE.ceiling]], openings: [] });
  const sheets = [
    { ...wall('maze north wall', 2, MAZE.minZ, 1, 0, [MAZE.minX, MAZE.maxX]), openings: [[door.x - door.width / 2, door.x + door.width / 2, door.floorY, door.floorY + door.height]] },
    wall('maze east wall', 0, MAZE.maxX, -1, 2, [MAZE.minZ + .1, MAZE.maxZ]),
    wall('cellar north wall', 2, CELLAR.minZ, 1, 0, [CELLAR.minX, CELLAR.maxX]), wall('cellar south wall', 2, CELLAR.maxZ, -1, 0, [CELLAR.minX, CELLAR.maxX]),
    wall('cellar west wall', 0, CELLAR.minX, 1, 2, [CELLAR.minZ, CELLAR.maxZ]), wall('cellar east wall', 0, CELLAR.maxX, -1, 2, [CELLAR.minZ, CELLAR.maxZ]),
    { id: 'slab over the cellar', axis: 1, at: MAZE.ceiling / 2, inside: -1, u: 0, v: 2, range: [[CELLAR.minX, CELLAR.maxX], [CELLAR.minZ, CELLAR.maxZ]], openings: SPACE.holes.map(hole => [hole.minX, hole.maxX, hole.minZ, hole.maxZ]) },
  ];
  const report = [];
  for (const sheet of sheets) {
    const near = glbTriangles.filter(t => !blended.has(t.material) && Math.abs(t.n[sheet.axis]) > .9 && (twoSided.has(t.material) || Math.sign(t.n[sheet.axis]) === sheet.inside)
      && [t.a, t.b, t.c].every(point => Math.abs(point[sheet.axis] - sheet.at) <= .15));
    const buckets = new Map(), cell = .5, key = (i, j) => `${i},${j}`;
    for (const t of near) {
      const us = [t.a, t.b, t.c].map(point => point[sheet.u]), vs = [t.a, t.b, t.c].map(point => point[sheet.v]);
      for (let i = Math.floor(Math.min(...us) / cell); i <= Math.floor(Math.max(...us) / cell); i++) for (let j = Math.floor(Math.min(...vs) / cell); j <= Math.floor(Math.max(...vs) / cell); j++) {
        if (!buckets.has(key(i, j))) buckets.set(key(i, j), []); buckets.get(key(i, j)).push(t);
      }
    }
    const covered = (u, v) => (buckets.get(key(Math.floor(u / cell), Math.floor(v / cell))) ?? []).some(t => {
      const [a, b, c] = [t.a, t.b, t.c].map(point => [point[sheet.u], point[sheet.v]]);
      const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (Math.abs(d) < 1e-12) return false;
      const l1 = ((b[0] - u) * (c[1] - v) - (c[0] - u) * (b[1] - v)) / d, l2 = ((c[0] - u) * (a[1] - v) - (a[0] - u) * (c[1] - v)) / d;
      return l1 >= -1e-6 && l2 >= -1e-6 && 1 - l1 - l2 >= -1e-6;
    });
    const opened = (u, v, margin) => sheet.openings.some(([u0, u1, v0, v1]) => u > u0 - margin && u < u1 + margin && v > v0 - margin && v < v1 + margin);
    const holes = []; let samples = 0;
    const scan = (u0, u1, v0, v1, step) => {
      for (let u = u0 + step / 2; u < u1; u += step) for (let v = v0 + step / 2; v < v1; v += step) {
        if (u < sheet.range[0][0] || u > sheet.range[0][1] || v < sheet.range[1][0] || v > sheet.range[1][1] || opened(u, v, .025)) continue;
        samples++; if (!covered(u, v)) holes.push([+u.toFixed(3), +v.toFixed(3)]);
      }
    };
    scan(sheet.range[0][0], sheet.range[0][1], sheet.range[1][0], sheet.range[1][1], .1);
    for (const [u0, u1, v0, v1] of sheet.openings) scan(u0 - .25, u1 + .25, v0 - .25, v1 + .25, .025);
    assert.deepEqual(holes.slice(0, 8), [], `${sheet.id}: ${holes.length} uncovered of ${samples}`);
    report.push(`${sheet.id} ${samples}`);
  }
  pass('the GLB closes the maze but for its doorway and the cellar but for its stair wells: every wall, the outer walls and the slab are covered by opaque surfaces turned to the inside, to within 2.5 cm of the openings', report.join(', '));
}

// A tiny seeded generator, for the sampled checks.
const seeded = (seed = 1) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

// 13. The sight test never hides what a mirror can show. From eyes in the
// maze and in the corridor, through random points of each face that faces
// them, rays from the reflected eye are followed past the pane through the
// room's own geometry: out only by the doorway, under the slab, up only by a
// well, between the cellar's outer walls (inner walls and panels are ignored:
// more is visible, the check is stricter). Every point a ray reaches is kept.
// The actors' spheres hold every survivor and zombie rig.
{
  const random = seeded(24), faces = mirrorFaces(LEVEL.furniture), point = new THREE.Vector3(), box = new THREE.Box3(), tiny = new THREE.Vector3(.02, .02, .02);
  const inBox = (p, b) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
  // Where a ray from q along d leaves the box [lo, hi]: its distance and the point.
  const leave = (q, d, lo, hi) => {
    let t = Infinity, axis = -1;
    for (const [index, key] of ['x', 'y', 'z'].entries()) {
      if (Math.abs(d[key]) < 1e-12) continue;
      const bound = d[key] > 0 ? hi[index] : lo[index], at = (bound - q[key]) / d[key];
      if (at >= 0 && at < t) { t = at; axis = index; }
    }
    return { t, axis, at: q.clone().addScaledVector(d, t) };
  };
  const counts = { rays: 0, room: 0, doorway: 0, upstairs: 0, hidden: 0, blocked: 0 };
  const eyes = [];
  for (const face of faces) {
    for (const distance of [.6, 1.5, 3, 5]) for (let k = 0; k < 2; k++) {
      const lateral = (random() - .5) * 3, x = face.centre.x + face.normal.x * distance + face.along.x * lateral, z = face.centre.z + face.normal.z * distance + face.along.z * lateral;
      if (x > MAZE.minX + .3 && x < MAZE.maxX - .3 && z > MAZE.minZ + .3 && z < MAZE.maxZ - .3) eyes.push([face, new THREE.Vector3(x, -2.6 + random() * 1.3, z)]);
    }
    const corridor = new THREE.Vector3(-9 + (random() - .5) * 2.4, -2.6 + random() * 1.3, .4 + random() * 1.8);
    if (faceDistance(face, corridor).facing > MIRROR_RANGE.facing) eyes.push([face, corridor]);
  }
  for (const [face, eye] of eyes) {
    if (faceDistance(face, eye).facing <= MIRROR_RANGE.facing) continue;
    const sight = mirrorSight(ENCLOSURE, face, eye);
    assert.equal(sight.open, false);
    for (let ray = 0; ray < 24; ray++) {
      counts.rays++;
      const u = (random() - .5) * face.width, v = (random() - .5) * face.height;
      const q = new THREE.Vector3(face.centre.x + face.along.x * u, face.centre.y + v, face.centre.z + face.along.z * u), d = q.clone().sub(sight.apex).normalize();
      // The stretches of the ray that are in sight: the room, then the cellar
      // beyond the doorway, then anything above a well.
      const room = leave(q, d, [MAZE.minX, MAZE.floor, MAZE.minZ], [MAZE.maxX, MAZE.ceiling, MAZE.maxZ]);
      let seenUntil = room.t, cellarFrom = Infinity, upFrom = Infinity;
      const door = mazeRoom.doors[0];
      if (room.axis === 2 && d.z < 0 && Math.abs(room.at.x - door.x) <= door.width / 2 && room.at.y <= door.floorY + door.height) {
        const cellar = leave(room.at, d, [CELLAR.minX, MAZE.floor, CELLAR.minZ], [CELLAR.maxX, MAZE.ceiling, CELLAR.maxZ]);
        cellarFrom = room.t; seenUntil = room.t + cellar.t;
        if (cellar.axis === 1 && d.y > 0 && SPACE.holes.some(hole => inBox(cellar.at, hole))) { upFrom = seenUntil; seenUntil = Infinity; }
      }
      for (let t = .05; t < 40; t += .2) {
        point.copy(q).addScaledVector(d, t);
        const kept = canMirrorShow(ENCLOSURE, sight, box.setFromCenterAndSize(point, tiny));
        if (t < seenUntil) {
          assert.ok(kept, `${face.id} from ${eye.toArray().map(value => value.toFixed(2))}: a point in sight at ${point.toArray().map(value => value.toFixed(2))} (${t >= upFrom ? 'upstairs' : t >= cellarFrom ? 'through the doorway' : 'in the room'}) was hidden`);
          counts[t >= upFrom ? 'upstairs' : t >= cellarFrom ? 'doorway' : 'room']++;
        } else { counts.blocked++; if (!kept) counts.hidden++; }
      }
    }
  }
  assert.ok(counts.doorway > 1000 && counts.upstairs > 100, `the doorway and the wells are exercised: ${JSON.stringify(counts)}`);
  assert.ok(counts.hidden > counts.blocked * .75, `most of what the room hides is hidden: ${JSON.stringify(counts)}`);
  // The actors' boxes (MIRROR_SIGHT.actorReach, actorBelow, actorTop) hold
  // the rigs, and their broken pieces, which fly 1.8 m/s for 1.3 s and rise
  // 0.35 m at most (zombies.js), all in the rig's own scale.
  const rigs = [['walker', W.createZombie('walker', false, 100, 'z1')], ['runner', W.createZombie('runner', false, 100, 'z2')], ['armored', W.createZombie('armored', false, 300, 'z3')],
    ['crawler', W.createZombie('crawler', false, 100, 'z4')], ['brute', W.createZombie('brute', false, 900, 'z5')], ['boss brute', W.createZombie('brute', true, 3000, 'z6')],
    ['survivor', W.createSurvivor(0x809fac)], ['raider', W.createRaider({ weapon: 'smg', maxHp: 200, id: 'r1' })]];
  for (const [name, rig] of rigs) {
    rig.updateMatrixWorld(true);
    const scale = Math.max(rig.scale.x, rig.scale.y, rig.scale.z), bounds = new THREE.Box3().setFromObject(rig), reach = actorBounds(rig, new THREE.Box3(), null);
    assert.ok(reach.containsBox(bounds), `${name}: ${bounds.min.toArray().map(value => value.toFixed(2))} .. ${bounds.max.toArray().map(value => value.toFixed(2))}`);
    const local = Math.max(-bounds.min.x, bounds.max.x, -bounds.min.z, bounds.max.z) / scale;
    assert.ok(local + 1.8 * 1.3 <= MIRROR_SIGHT.actorReach && bounds.max.y / scale + .35 <= MIRROR_SIGHT.actorTop, `${name}: its flying pieces stay inside`);
  }
  // Standing on the floor above, an actor never reaches under it (a crawler's
  // few centimetres below its feet are inside the slab); in the cellar it does.
  {
    const rig = W.createZombie('walker', false, 100, 'z7'); rig.position.set(-10, 0, 7);
    assert.equal(actorBounds(rig, new THREE.Box3(), ENCLOSURE).min.y, ENCLOSURE.upstairs);
    rig.position.y = -3.4; assert.ok(actorBounds(rig, new THREE.Box3(), ENCLOSURE).min.y < -3.4);
  }
  pass('the sight test keeps every point a mirror can show (rays followed through the doorway and up the wells) and hides most of what the room hides; actor boxes hold every rig and its flying pieces', JSON.stringify(counts));
}

// 14. The real funfair world: each pass leaves out the scenery and the actors
// that the maze hides, keeps what is in it, and shows everything again after.
{
  const release = holdPerformance();
  const decor = new THREE.Group();
  const block = (name, [x0, x1], [y0, y1], [z0, z1]) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new THREE.MeshBasicMaterial()); mesh.name = name;
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); decor.add(mesh); return mesh;
  };
  block('snack bar over the maze', [-14, -6], [0, 1], [6, 10]); block('ground-floor ceiling', [-17.9, 17.9], [3.2, 3.26], [-12.9, 12.9]);
  block('machine room', [4, 8], [-3.4, -2], [4, 8]); block('whole level', [-30, 30], [-3.4, 6], [-20, 20]); block('maze prop', [-6.8, -6.2], [-3.4, -2.5], [6.5, 7.5]);
  block('behind panel 04', [-9.5, -8.5], [-3.4, -2.5], [4, 5.5]); block('corridor crate', [-9.6, -9], [-3.4, -2.6], [0, .6]);
  const scene = new THREE.Scene(), camera = eyeAt(FRONT.x, FRONT.y, FRONT.z, FRONT.yaw); scene.add(camera);
  const world = W.createWorld(scene, { quality: { id: 'medium', shadows: false, shadowMapSize: 0, fireflies: 0, groundDetail: 0, rainFraction: .1 }, loadDecor: async () => decor, loadReflector: realReflector });
  assert.equal(await world.ready, true);
  const actor = (name, rig, x, y, z) => { rig.name = name; rig.position.set(x, y, z); scene.add(rig); return rig; };
  actor('zombie upstairs', W.createZombie('walker', false, 100, 'a1'), -10, 0, 7); actor('zombie in the maze', W.createZombie('runner', false, 100, 'a2'), -5, -3.4, 7.5);
  actor('zombie in the refuge', W.createZombie('walker', false, 100, 'a3'), -6, -3.4, -8); actor('brute in the machine room', W.createZombie('brute', true, 900, 'a4'), 6, -3.4, 7);
  actor('zombie in the corridor', W.createZombie('walker', false, 100, 'a5'), -9.3, -3.4, -1.5); actor('teammate in the maze', W.createSurvivor(0x8da46e), -4, -3.4, 4);
  const watched = ['snack bar over the maze', 'ground-floor ceiling', 'machine room', 'whole level', 'maze prop', 'behind panel 04', 'corridor crate', 'armory-katana', 'armory-flamethrower', 'armory-smg', 'armory-magnum', 'armory-assault',
    'lateSupplyPost', 'cabinGenerator', 'zombie upstairs', 'zombie in the maze', 'zombie in the refuge', 'brute in the machine room', 'zombie in the corridor', 'teammate in the maze'];
  const named = name => { const object = scene.getObjectByName(name); assert.ok(object, name); return object; };
  const drawn = object => { for (let node = object; node; node = node.parent) if (!node.visible) return false; return true; };
  const halo = (x, z) => world.root.children.find(child => child.isSprite && Math.abs(child.position.x - x) < .01 && Math.abs(child.position.z - z) < .01);
  const mazeHalo = halo(-5, 9), groundHalo = world.root.children.find(child => child.isSprite && child.position.y > 1);
  assert.ok(mazeHalo && groundHalo);
  const frontDoor = [...world.doors.values()][0].userData.frame;
  // A collision proxy of the maze itself: it never draws, and passes leave it out.
  const proxy = world.rayBlockers.find(mesh => mesh.name === 'collision-room-miroirs-east');
  assert.ok(proxy && proxy.material.visible === false && proxy.visible);
  const renderer = fakeRenderer();
  renderer.onRender = () => ({ ...Object.fromEntries(watched.map(name => [name, drawn(named(name))])), 'maze halo': drawn(mazeHalo), 'ground-floor halo': drawn(groundHalo), 'a door frame': drawn(frontDoor), 'a collision proxy': drawn(proxy) });
  world.prewarm(renderer, camera);
  const self = player({ x: FRONT.x, z: FRONT.z });
  const context = eye => ({ snapshot: { players: [self], expedition: { enabled: false } }, myId: self.id, active: true, camera: eye, survivors: new Map() });
  world.setLocalAvatar({ player: self, color: 0x809fac, x: FRONT.x, z: FRONT.z, yaw: FRONT.yaw, pitch: 0 });
  worldFrame(world, 0, context(camera)); await world.mirrors.loading;
  let time = 0;
  const look = (eye, seconds = .5) => { const from = renderer.calls.length; for (const end = time + seconds; time < end; time += 1 / 30) worldFrame(world, time, context(eye)); return renderer.calls.slice(from).map(call => call.inside); };
  const front = look(camera);
  assert.deepEqual(ids(world.mirrors), ['miroir-panel-04:east']); assert.ok(front.length > 5);
  // The katana rack in the maze stands wholly behind this mirror's plane.
  const keptAtFront = ['whole level', 'maze prop', 'zombie in the maze', 'teammate in the maze', 'maze halo'];
  const hiddenAtFront = ['snack bar over the maze', 'ground-floor ceiling', 'machine room', 'behind panel 04', 'armory-katana', 'corridor crate', 'armory-smg', 'armory-magnum', 'armory-assault',
    'lateSupplyPost', 'cabinGenerator', 'zombie upstairs', 'zombie in the refuge', 'brute in the machine room', 'zombie in the corridor', 'ground-floor halo', 'a door frame', 'a collision proxy'];
  for (const inside of front) {
    for (const name of keptAtFront) assert.equal(inside[name], true, `panel 04: ${name} is drawn in the reflection`);
    for (const name of hiddenAtFront) assert.equal(inside[name], false, `panel 04: ${name} is left out of the reflection`);
  }
  for (const name of watched) assert.equal(drawn(named(name)), true, `${name} is shown again for the main view`);
  assert.ok(drawn(mazeHalo) && drawn(groundHalo) && drawn(frontDoor) && drawn(proxy));
  const stats = world.mirrors.stats.sight;
  assert.equal(stats.on, true); assert.ok(stats.scenery > 40 && stats.culled >= hiddenAtFront.length, JSON.stringify(stats));
  // Facing panel 03's north face, the doorway is in the mirror: the corridor
  // shows, the floor above still does not.
  const north = eyeAt(-10, -1.8, 3.2, Math.PI);
  const seen = look(north, 1);
  assert.deepEqual(ids(world.mirrors), ['miroir-panel-03:north']);
  const last = seen.at(-1);
  for (const name of ['whole level', 'zombie in the corridor', 'corridor crate']) assert.equal(last[name], true, `panel 03 north: ${name} is drawn`);
  for (const name of ['snack bar over the maze', 'ground-floor ceiling', 'zombie upstairs', 'armory-smg', 'ground-floor halo', 'brute in the machine room']) assert.equal(last[name], false, `panel 03 north: ${name} is left out`);
  // Facing panel 12's south face by the south wall: the flamethrower rack is
  // in front of it, the katana rack behind.
  const south = eyeAt(-9.5, -1.8, 11.3, 0);
  const bySouthWall = look(south, 1).at(-1);
  assert.deepEqual(ids(world.mirrors), ['miroir-panel-12:south']);
  for (const name of ['armory-flamethrower', 'whole level']) assert.equal(bySouthWall[name], true, `panel 12 south: ${name} is drawn`);
  for (const name of ['armory-katana', 'maze prop', 'zombie in the corridor', 'snack bar over the maze', 'armory-magnum']) assert.equal(bySouthWall[name], false, `panel 12 south: ${name} is left out`);
  // Restyled racks are measured again.
  world.restyleArmory(); assert.equal(world.mirrors.stats.sight.scenery, null);
  look(north, .1); assert.ok(world.mirrors.stats.sight.scenery > 40);
  world.dispose(); release();
  pass('the funfair world leaves out of each pass the floor above, the other rooms, what is behind the mirror, the actors there and the collision proxies, keeps what is in front of it in the maze (a rack, the halo, actors), the corridor when the doorway is in the mirror, and shows all again', `${stats.scenery} scenery pieces, ${stats.culled} left out at panel 04`);
}

// 15. The frame-time guard (MIRROR_BUDGET) on a clock the check drives. Each
// frame lasts what a model PC takes for what the last update drew: a frame
// without the mirror costs 'glass', each reflection pass drawn in it adds
// 'pass' (a light pass 'light', by default as much: the guard must hold even
// when the lighter pass is no cheaper), a kept reflection adds nothing,
// optionally rounded up to a screen refresh, plus whatever else slows the PC
// at that moment (a fight, other programs: 'extra', seeded 'noise'; a fight
// seen in the reflection also makes each pass heavier: 'extraPass').
{
  const panel = { id: 'essai-1', kind: 'mirror-panel', axis: 'x', minX: -1.9, maxX: -.1, minZ: -.05, maxZ: .05, baseY: 0, height: 2.3 };
  const pair = [panel, { ...panel, id: 'essai-2', minX: .1, maxX: 1.9 }];
  async function guarded({ quality = 'medium', furniture = [panel], x = -1, z = 3, sway = () => 0 } = {}) {
    let now = 0, time = 0, frame = 0;
    const scene = new THREE.Scene();
    const mirrors = createFunfairMirrors({ scene, quality: { id: quality }, furniture, factories, loadReflector: realReflector, clock: () => now });
    const renderer = fakeRenderer(); mirrors.setRenderer(renderer);
    // 'sway': how far the eye is from x at that moment, to one side then the other frame by frame (a few centimetres).
    const camera = () => eyeAt(x + (frame % 2 ? 1 : -1) * sway(now), 1.6, z);
    mirrors.update(0, { camera: camera() }); await mirrors.loading;
    const timeline = [];
    const frames = (seconds, cost, { until = () => false } = {}) => {
      let live = 0;
      for (const end = now + seconds - 1e-9; now < end;) {
        const before = mirrors.stats.renders, eye = camera();
        mirrors.update(time, { camera: eye }); frame++;
        const passes = mirrors.stats.renders - before, live_ = mirrors.live.length, stage = mirrors.stats.guard.stage, interval = cost(passes, now, stage);
        timeline.push({ at: now, shown: live_ > 0, live: live_, passes, stage, eye, interval, opacity: mirrors.pool[0].userData.opacity });
        now += interval; time += interval; if (live_ > 0) live += interval;
        if (until(timeline.at(-1))) break;
      }
      return live;
    };
    // Hand-overs between a live mirror and the glass, both ways.
    const flips = () => {
      const result = { toGlass: 0, toLive: 0 };
      for (let index = 1; index < timeline.length; index++) {
        if (timeline[index - 1].shown && !timeline[index].shown) result.toGlass++;
        if (!timeline[index - 1].shown && timeline[index].shown) result.toLive++;
      }
      return result;
    };
    // Seconds shown with a live mirror at each stage.
    const seconds = () => timeline.reduce((sum, item) => { if (item.shown) sum[item.stage] = (sum[item.stage] ?? 0) + item.interval; return sum; }, {});
    const stages = () => mirrors.stats.guard.steps.map(step => step.stage).join();
    return { mirrors, renderer, scene, frames, flips, seconds, stages, timeline, camera, get now() { return now; }, get time() { return time; } };
  }
  const refresh = (seconds, hz) => Math.ceil(seconds * hz - 1e-6) / hz;
  const pc = (glass, pass, { hz = 0, extra = () => 0, extraPass = () => 0, light = pass, noise = null } = {}) => (passes, at, stage) => {
    const cost = glass + ((stage === 'full' ? pass : light) + extraPass(at)) * passes + extra(at) + (noise ? noise() : 0);
    return hz ? refresh(cost, hz) : cost;
  };
  // Seeded noise in [0, spread) (mulberry32): CPU contention from other programs.
  const seeded = (seed, spread) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * spread; };
  // This RTX 3080 PC with other sessions holding the processor at 100 %, as
  // the browser measured it on 25 October (gpu/report.json, the guard at its
  // default): a live mirror 33 to 36 ms a frame, the lighter one 34.1 ms on
  // the frames that drew it and 24.7 ms on those that kept it, the glass 18
  // to 23 ms. The guard before the third review gave it the glass for good
  // after 2.5 to 6 s.
  const thisPcBusy = (seed = 7, more = {}) => pc(.0215, .0094, { noise: seeded(seed, .0065), ...more });
  // The same PC on high, as the verifiers' sessions recorded it at panel 10
  // west (fourth review): a 56 Hz screen (17.9 ms refreshes); the frames that
  // kept the light reflection took one refresh (about a quarter of them), two
  // or three, 32.4 ms on average, those that drew it 40 ms, the glass 29.5 to
  // 32 ms: 11 ms of work and up to 26.7 ms more of contention a frame, 5.8 ms
  // for a light pass, 12 ms for a full one (two panes). The guard before this
  // review gave it the glass for good in 3 of 10 sessions, and this model the
  // glass at 20 to 67 s (guard-old-vs-new.json).
  const thisPcHigh = (seed = 1, more = {}) => pc(.011, .012, { hz: 55.9, light: .0058, noise: seeded(seed, .0267), ...more });
  const { slow, after, fast, recover, recoverMax, floor, gain, calm, calmOf, renew, kinds, span, spells, ahead, catchUp, spike, light } = MIRROR_BUDGET;
  assert.deepEqual({ slow, after, fast, recover, recoverMax, floor, gain, calm, calmOf, renew, kinds, span, spells, ahead, catchUp, spike },
    { slow: 1 / 38, after: 2, fast: 1 / 48, recover: 4, recoverMax: 60, floor: 1 / 30, gain: .6, calm: 1.15, calmOf: 5, renew: 20, kinds: 12, span: 1.5, spells: 3, ahead: 6, catchUp: .003, spike: 2.5 }, 'the documented budget');
  assert.ok(light.every === 2 && light.textureScale === .35 && light.samples === 0 && light.turn === .01 && light.move === .01);
  for (const gone of ['rests', 'settle']) assert.equal(MIRROR_BUDGET[gone], undefined, `no ${gone} any more: no timed glass, no rest and come back`);
  const outcome = {};
  const lightTimeline = run => run.timeline.filter(item => item.stage === 'light');
  // Every window that decided: enough frames and seconds of each kind, side by
  // side; one that blamed the mirror was calm, measured against a reference.
  const soundWindows = run => run.mirrors.stats.guard.verdicts.every(item => item.frames.every(count => count >= kinds) && item.seconds.every(value => value >= span - 1e-9) && Math.abs(item.frames[0] - item.frames[1]) <= ahead
    && (!item.cause || (item.calm === true && item.kept <= item.reference * calm && item.ratio >= 1 + gain && item.live > floor)));
  // Live all along, lighter, never the glass, never back and forth, no window blaming the mirror.
  // ('blamed': how many single windows may blame it, never three in a row.)
  const liveForGood = (run, label, { stages = 'light', blamed = 0 } = {}) => {
    assert.equal(run.stages(), stages, `${label}: ${run.stages()}`); assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 }, label);
    const guard = run.mirrors.stats.guard;
    assert.ok(guard.blamed <= blamed && guard.verdicts.every(item => item.streak < spells) && soundWindows(run), `${label}: ${guard.blamed} windows blame the mirror`);
  };

  // A PC that affords the mirror, on a 60 Hz screen: nothing happens.
  {
    const run = await guarded();
    assert.ok(run.frames(20, pc(.009, .006, { hz: 60 })) > 19.9);
    assert.equal(run.stages(), '', 'never lighter'); assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 });
    run.mirrors.dispose();
  }
  // Fast screens (144 and 360 Hz): their frames are frames (the 360 Hz ones,
  // 2.8 ms apart, joined in pairs), and nothing happens.
  for (const hz of [144, 360]) {
    const run = await guarded();
    assert.ok(run.frames(10, () => 1 / hz) > 9.9);
    assert.equal(run.stages(), '', `${hz} Hz`); assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 });
    if (hz === 360) assert.ok(Math.abs(run.mirrors.stats.guard.average - 2 / 360) < 1e-6, `360 Hz frames joined in pairs (${(run.mirrors.stats.guard.average * 1000).toFixed(2)} ms)`);
    run.mirrors.dispose();
  }
  // This PC busy (M2): lighter after 2 s, then live for the whole visit. Its
  // lighter mirror does cost (the drawing frames are about 38 % slower, under
  // the 60 % that blames it), and the game still shows 34 images a second
  // with it, over the 30 floor: never the glass. Two minutes, three seeds of
  // contention.
  for (const seed of [7, 11, 23]) {
    const run = await guarded(), reflector = run.mirrors.pool[0], target = reflector.getRenderTarget();
    run.frames(after + .6, thisPcBusy(seed));
    assert.equal(run.stages(), 'light', `seed ${seed}: lighter first, still live`); assert.equal(run.mirrors.live.length, 1);
    if (seed === 7) {
      run.frames(.1, thisPcBusy(seed + 100));
      assert.deepEqual([target.width, target.height, target.samples], [Math.round(1600 * light.textureScale), Math.round(900 * light.textureScale), 0], 'a smaller target, no multisampling');
      // Lighter: one frame draws the reflection, the next keeps it, and the
      // main render of a keeping frame does not draw it either.
      const lighter = lightTimeline(run).slice(2);
      assert.ok(lighter.length > 10 && lighter.every((item, index) => index === 0 || item.passes + lighter[index - 1].passes === 1), `frames alternate: ${lighter.map(item => item.passes).join('')}`);
      if (run.timeline.at(-1).passes !== 0) run.frames(1e-6, thisPcBusy(seed + 200));
      const kept = run.timeline.at(-1), calls = run.renderer.calls.length, nested = run.mirrors.stats.nested;
      assert.ok(kept.shown && kept.passes === 0);
      reflector.onBeforeRender(run.renderer, run.scene, kept.eye, reflector.geometry, reflector.material, null);
      assert.equal(run.renderer.calls.length, calls, 'a kept reflection is not drawn again by the main render'); assert.equal(run.mirrors.stats.nested, nested);
      assert.ok(run.mirrors.stats.reused > 5);
    }
    assert.ok(run.frames(120, thisPcBusy(seed + 300)) > 119.9, `seed ${seed}: live all along`);
    const guard = run.mirrors.stats.guard;
    liveForGood(run, `seed ${seed}`);
    assert.ok(guard.judged >= 30 && guard.verdicts.every(item => !item.cause), `seed ${seed}: ${guard.judged} windows, ${guard.blamed} blame the mirror`);
    const ratio = guard.verdicts.reduce((sum, item) => sum + item.drawn / item.kept, 0) / guard.verdicts.length, live = guard.verdicts.reduce((sum, item) => sum + item.live, 0) / guard.verdicts.length;
    assert.ok(ratio > 1.25 && ratio < 1 + gain && live < floor, `the mirror costs (drawing frames ${((ratio - 1) * 100).toFixed(0)} % slower) and the game shows ${(1 / live).toFixed(1)} images a second`);
    // The old rule (the cheaper kind 15 % faster than the spell) sat on its threshold.
    const oldRule = guard.verdicts.filter(item => item.kept < item.live * .85).length;
    if (seed === 7) outcome.busy = `${guard.judged} windows, drawing ${(ratio * 100 - 100).toFixed(0)} % slower, ${(1 / live).toFixed(1)} images/s; the 15 % rule of the second round would have blamed ${oldRule} of the last ${guard.verdicts.length}`;
    run.mirrors.dispose();
  }
  // This PC busy, then a fight in front of the mirror (fourth review): from
  // 10 s, every frame takes 4 to 12 ms more for 8 or 20 s, and, the zombies
  // in the reflection, each pass 3 to 6 ms more. The third round's rule (25 %
  // slower and under 30 images a second, no calm windows) gave this the glass
  // at 16 to 28 s, for good: the lighter mirror's drawing frames were already
  // 38 % slower, and the fight took the frames over the floor. Now the gap
  // stays far under 60 %, and a fight of 5 ms or more shows in the keeping
  // frames: those windows are set aside. Never the glass, live all along.
  for (const [extra, extraPass, from, seconds, seed] of [[.004, 0, 10, 20, 7], [.005, 0, 10, 20, 11], [.005, 0, 10, 8, 7], [.008, 0, 10, 8, 11], [.008, 0, 10, 20, 7], [.012, 0, 10, 20, 7],
    [.004, .003, 10, 20, 7], [.008, .005, 10, 20, 11], [.012, .006, 10, 8, 7]]) {
    const run = await guarded(), during = at => at >= from && at < from + seconds, label = `a ${seconds} s fight, ${extra * 1000} ms a frame, ${extraPass * 1000} ms a pass`;
    assert.ok(run.frames(60, thisPcBusy(seed, { extra: at => during(at) ? extra : 0, extraPass: at => during(at) ? extraPass : 0 })) > 59.9, label);
    liveForGood(run, label);
    const guard = run.mirrors.stats.guard;
    if (extra >= .005) assert.ok(guard.setAside >= 1, `${label}: ${guard.setAside} windows set aside`);
    if (extra === .008 && seconds === 20) outcome.fight = `${guard.judged} windows, ${guard.setAside} set aside`;
    run.mirrors.dispose();
  }
  // This PC ever busier (fourth review): contention rising from nothing to
  // 10 ms more a frame over two minutes (the third round's rule: the glass at
  // 54 s), and the processor stalling the browser 0.1 to 0.45 s every 0.8 to
  // 2.2 s (a stall counts as 2.5 times the running average). Live all along.
  {
    const run = await guarded();
    assert.ok(run.frames(120, thisPcBusy(5, { extra: at => .010 * at / 120 })) > 119.9);
    liveForGood(run, 'rising contention');
    run.mirrors.dispose();
  }
  for (const seed of [1, 2, 3]) {
    const run = await guarded(), random = seeded(seed * 97, 1), busy = thisPcBusy(seed);
    let next = 3;
    assert.ok(run.frames(120, (passes, at, stage) => { const base = busy(passes, at, stage); if (at < next) return base; next = at + .8 + random() * 1.4; return base + .1 + random() * .35; }) > 119.9);
    liveForGood(run, `stalls, seed ${seed}`);
    run.mirrors.dispose();
  }
  // Something outside the mirror with a rhythm of two frames that falls in
  // step with the alternation (every other frame 10 ms more, the mirror
  // costing 2 ms): the drawing frames look 43 % slower, under the 60 %.
  for (const odd of [0, 1]) {
    const run = await guarded();
    let frame = 0;
    assert.ok(run.frames(60, passes => .028 + .002 * passes + (frame++ % 2 === odd ? .010 : 0)) > 59.9);
    liveForGood(run, `a two-frame rhythm, phase ${odd}`);
    run.mirrors.dispose();
  }
  // This PC on high (fourth review): the full mirror's two panes are too
  // slow, lighter after 2 s, then live for the whole visit, three minutes,
  // three seeds of contention: its drawing frames are about 25 % slower than
  // its keeping frames on average, rounded to the screen's refreshes, and the
  // game shows about 28 images a second, under the floor; the third round's
  // rule blamed about half of its windows. Then the same with a fight from 10
  // s to 30 s (4 to 12 ms a frame, up to 8 ms a pass).
  for (const seed of [1, 4, 7]) {
    const run = await guarded({ quality: 'high', furniture: pair, x: 0 });
    assert.ok(run.frames(180, thisPcHigh(seed)) > 179.9);
    liveForGood(run, `this PC on high, seed ${seed}`);
    const verdicts = run.mirrors.stats.guard.verdicts, ratios = verdicts.map(item => item.ratio), live = verdicts.reduce((sum, item) => sum + item.live, 0) / verdicts.length;
    assert.ok(ratios.every(value => value > .95 && value < 1 + gain) && live > floor && run.mirrors.live.length === 1, `ratios ${ratios.map(value => value.toFixed(2)).join(' ')}, ${(1 / live).toFixed(1)} images/s`);
    const thirdRound = verdicts.filter(item => item.ratio >= 1.25 && item.live > floor).length;
    if (seed === 1) outcome.high = `drawing frames ${((Math.min(...ratios) - 1) * 100).toFixed(0)} to ${((Math.max(...ratios) - 1) * 100).toFixed(0)} % slower, ${(1 / live).toFixed(1)} images/s; the third round's rule would have blamed ${thirdRound} of the last ${verdicts.length}`;
    run.mirrors.dispose();
  }
  for (const [extra, extraPass] of [[.004, 0], [.012, 0], [.004, .003], [.008, .005], [.012, .008]]) {
    const run = await guarded({ quality: 'high', furniture: pair, x: 0 }), during = at => at >= 10 && at < 30;
    assert.ok(run.frames(60, thisPcHigh(2, { extra: at => during(at) ? extra : 0, extraPass: at => during(at) ? extraPass : 0 })) > 59.9);
    liveForGood(run, `this PC on high, a fight of ${extra * 1000} ms a frame and ${extraPass * 1000} ms a pass`);
    run.mirrors.dispose();
  }
  // The very frames this PC showed in the browser (the verifiers' sessions of
  // the fourth review and the proof's own, one with six zombies in the maze
  // while the survivor fires; test/fixtures/funfair-mirror-busy-frames.json):
  // each frame lasts the next recorded one of the kind the guard makes (the
  // full mirror's, then the light one's that drew or kept the reflection, in
  // order, from four starting points, looped over four minutes). On high at
  // panel 10 west, three of the verifiers' sessions went to the glass for good
  // under the third round's rule. Single windows may blame the mirror (on a
  // 56 Hz screen, a window whose keeping frames mostly took one refresh):
  // never three in a row.
  {
    const recorded = JSON.parse(readFileSync(new URL('./funfair-mirror-busy-frames.json', import.meta.url), 'utf8')).sessions;
    const replays = [];
    for (const [name, session] of Object.entries(recorded)) {
      const [full, drawn, kept] = ['full', 'drawn', 'kept'].map(key => session[key].split(' ').map(value => Number(value) / 10000));
      assert.ok(full.length >= 10 && drawn.length >= 99 && kept.length >= 99, name);
      for (const start of [0, 37, 111, 250]) {
        const run = await guarded(session.preset === 'high' ? { quality: 'high', furniture: pair, x: 0 } : {});
        let f = 0, d = start, k = start;
        assert.ok(run.frames(240, (passes, at, stage) => stage === 'full' ? full[f++ % full.length] : passes > 0 ? drawn[d++ % drawn.length] : kept[k++ % kept.length]) > 239.9);
        liveForGood(run, `${name} from ${start}`, { blamed: 6 });
        replays.push({ name, windows: run.mirrors.stats.guard.judged, blamed: run.mirrors.stats.guard.blamed });
        run.mirrors.dispose();
      }
    }
    assert.ok(Object.keys(recorded).filter(name => name.startsWith('high-p10w')).length >= 3 && Object.keys(recorded).filter(name => name.startsWith('proof-high-panel10')).length >= 4, 'the sessions at panel 10 west');
    outcome.replays = `${replays.length} replays, ${replays.reduce((sum, item) => sum + item.windows, 0)} windows, ${replays.reduce((sum, item) => sum + item.blamed, 0)} single ones blaming the mirror`;
  }
  // The same PC at other moments: the verifiers' measure (34.9 ms a frame
  // with the live mirror, 21.8 ms with the glass) and the browser's under
  // full load (lighter: 33.2 ms drawing, 26.1 keeping). Both live, lighter,
  // for good; the old guard gave the first the glass at 3 s.
  for (const [label, cost] of [['verifiers', pc(.0218, .0131)], ['full load', pc(.0261, .0071)]]) {
    const run = await guarded();
    assert.ok(run.frames(120, cost) > 119.9, label);
    assert.equal(run.stages(), 'light', label); assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 }, label);
    assert.ok(run.mirrors.stats.guard.judged > 20 && run.mirrors.stats.guard.blamed === 0, label);
    run.mirrors.dispose();
  }
  // A borderline PC (29 ms with the mirror, 15 ms without): the lighter
  // mirror (22 ms on average) holds, live for good; its drawing frames (29
  // ms) leave no headroom to come back to the full mirror.
  {
    const run = await guarded();
    assert.ok(run.frames(120, pc(.015, .014)) > 119.9);
    assert.equal(run.stages(), 'light'); assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 });
    run.mirrors.dispose();
  }
  // A 60 Hz screen where a pass makes its frame miss a refresh (33 ms, 17 ms
  // without): lighter it shows 40 images a second, and holds.
  {
    const run = await guarded();
    assert.ok(run.frames(120, pc(.012, .012, { hz: 60 })) > 119.9);
    assert.equal(run.stages(), 'light'); assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 });
    run.mirrors.dispose();
  }
  // A 30 Hz screen: as slow without the passes, so the mirror is not the
  // cause: never the glass, not a single blink.
  {
    const run = await guarded();
    assert.ok(run.frames(120, pc(.012, .006, { hz: 30 })) > 119.9);
    assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 }); assert.equal(run.stages(), 'light');
    assert.ok(run.mirrors.stats.guard.verdicts.length > 10 && run.mirrors.stats.guard.verdicts.every(item => !item.cause && Math.abs(item.drawn / item.kept - 1) < .01));
    run.mirrors.dispose();
  }
  // A PC that truly cannot afford the mirror: a family PC at 38 images a
  // second without it (26 ms), where each pass costs 22 ms (the lighter one
  // no less): live 48 ms a frame, lighter 37 ms, 27 images a second. Lighter
  // at 2 s; a first window of 1.5 s of each kind measures its keeping frames,
  // then three calm windows blame the mirror (drawing frames 85 % slower),
  // and it fades to the glass for good, in one hand-over. The fade out draws
  // nothing (the last reflection is kept: the old guard redrew it at full
  // size with multisampling, in targets it had just freed), and the targets
  // are freed once it has faded out.
  {
    const run = await guarded(), reflectorTarget = run.mirrors.pool[0].getRenderTarget(), cannot = pc(.026, .022);
    const disposals = []; reflectorTarget.addEventListener('dispose', () => disposals.push(run.now));
    run.frames(60, cannot);
    const guard = run.mirrors.stats.guard;
    assert.equal(run.stages(), 'light,glass'); assert.deepEqual(run.flips(), { toGlass: 1, toLive: 0 }, 'one hand-over to the glass, never back');
    const [toLight, toGlass] = guard.steps.map(step => step.at);
    const decided = guard.verdicts.slice(-spells);
    assert.ok(guard.judged === spells + 1 && guard.verdicts[0].calm === null && !guard.verdicts[0].cause && decided.every(item => item.cause && item.calm) && soundWindows(run), JSON.stringify(guard.verdicts));
    assert.ok(decided.every(item => Math.abs(item.drawn - .048) < .001 && Math.abs(item.kept - .026) < .001 && Math.abs(item.reference - .026) < .001 && item.live > floor), 'drawing frames 48 ms, keeping frames 26 ms, as calm as the first window');
    const seen = decided.reduce((sum, item) => [sum[0] + item.seconds[0], sum[1] + item.seconds[1]], [0, 0]);
    assert.ok(seen.every(value => value >= spells * span - 1e-9), `${seen.map(value => value.toFixed(2)).join(' s and ')} s of each kind`);
    assert.ok(toLight > after && toLight < after + .5 && toGlass > toLight + (spells + 1) * 4 && toGlass < toLight + (spells + 1) * 4.6, `lighter at ${toLight.toFixed(2)} s, the glass at ${toGlass.toFixed(2)} s`);
    // The fade out: from the step to the glass to the release.
    const fading = run.timeline.filter(item => item.at >= toGlass && item.shown);
    assert.ok(fading.length >= 4 && fading.every(item => item.passes === 0), `the fade out keeps the last reflection (${fading.map(item => item.passes).join('')})`);
    const released = run.timeline.find(item => item.at > toGlass && !item.shown).at;
    assert.ok(released - toGlass >= MIRROR_LOOK.fade - .03, `and lasts the whole fade (${(released - toGlass).toFixed(3)} s)`);
    assert.ok(disposals.filter(at => at >= toGlass && at < released).length === 0, 'no target freed or rebuilt during the fade');
    assert.deepEqual([reflectorTarget.width, reflectorTarget.height, reflectorTarget.samples], [Math.round(1600 * light.textureScale), Math.round(900 * light.textureScale), 0], 'the light target, as it was');
    assert.equal(disposals.filter(at => at >= released).length, 1, 'freed once, after the fade');
    assert.ok(run.mirrors.stats.guard.freed && run.timeline.filter(item => item.at >= released).every(item => !item.shown && item.passes === 0), 'nothing drawn after');
    outcome.cannot = { light: toLight.toFixed(2), glass: toGlass.toFixed(2) };
    run.mirrors.dispose();
  }
  // The browser proof's artificial PC: this busy PC with every pass made
  // 40 ms heavier. The glass for good, the same way.
  {
    const run = await guarded();
    run.frames(60, pc(.0215, .0494, { noise: seeded(5, .0065) }));
    assert.equal(run.stages(), 'light,glass'); assert.deepEqual(run.flips(), { toGlass: 1, toLive: 0 });
    assert.ok(run.mirrors.stats.guard.last.cause && run.mirrors.stats.guard.last.drawn - run.mirrors.stats.guard.last.kept > .035 && soundWindows(run));
    outcome.heavy = run.mirrors.stats.guard.steps[1].at.toFixed(2);
    run.mirrors.dispose();
  }
  // A browser that catches up at once after each long frame, whatever the
  // mirror does (M1): its callbacks come 40 ms, then 2 ms apart, the mirror
  // costing nothing. Counted as frames of their own, the 2 ms catch-ups made
  // one kind look far cheaper than the frames shown (24 images a second) and
  // the old guard blamed the mirror. Joined to the next frame, both kinds
  // take 42 ms: the mirror stays live.
  {
    const run = await guarded();
    let beat = 0;
    assert.ok(run.frames(120, () => (beat++ % 2 ? .002 : .040)) > 119.9);
    const verdicts = run.mirrors.stats.guard.verdicts;
    assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 }); assert.equal(run.stages(), 'light');
    assert.ok(verdicts.length > 10 && verdicts.every(item => !item.cause && Math.abs(item.drawn - .042) < 1e-6 && Math.abs(item.kept - .042) < 1e-6 && Math.abs(item.live - .042) < 1e-6), JSON.stringify(verdicts.slice(0, 2)));
    run.mirrors.dispose();
  }
  // Catch-ups on a PC that cannot afford the mirror: a frame that draws it
  // takes 70 ms, the browser then catches up at once (1.5 ms later) and the
  // work of that catch-up joins the next interval; a frame without a pass
  // costs 20 ms. Counted the same way, the drawing frames (70 ms) are far
  // slower than the keeping ones (40 ms, two updates) and the frames shown
  // are under 30 a second: the glass, once.
  {
    const run = await guarded();
    let owed = 0, catchUp = false;
    run.frames(90, passes => {
      const work = .020 + .050 * passes;
      if (catchUp) { catchUp = false; owed = work - .0015; return .0015; }
      const interval = work + owed; catchUp = passes > 0 && owed === 0; owed = 0;
      return interval;
    });
    assert.equal(run.stages(), 'light,glass'); assert.deepEqual(run.flips(), { toGlass: 1, toLive: 0 });
    const last = run.mirrors.stats.guard.last;
    assert.ok(Math.abs(last.drawn - .070) < 1e-6 && Math.abs(last.kept - .040) < 1e-6 && soundWindows(run), JSON.stringify(last));
    run.mirrors.dispose();
  }
  // A PC that cannot afford the mirror, with a fight from 9 s to 30 s (10 ms
  // more a frame, 6 ms more a pass): the fight's windows are set aside (and
  // start the count again), the glass comes from three calm windows that end
  // after it.
  {
    const run = await guarded(), during = at => at >= 9 && at < 30;
    run.frames(90, pc(.026, .022, { extra: at => during(at) ? .010 : 0, extraPass: at => during(at) ? .006 : 0 }));
    const guard = run.mirrors.stats.guard, toGlass = guard.steps.find(step => step.stage === 'glass')?.at;
    assert.equal(run.stages(), 'light,glass'); assert.deepEqual(run.flips(), { toGlass: 1, toLive: 0 });
    assert.ok(guard.setAside >= 3 && guard.verdicts.filter(item => item.at > 13 && item.at < 30).every(item => item.calm === false) && guard.verdicts.slice(-spells).every(item => item.cause && item.calm && item.at > 30), `the glass at ${toGlass?.toFixed(1)} s, ${guard.setAside} windows set aside`);
    run.mirrors.dispose();
  }
  // A PC that cannot afford the mirror and gets busier for good at 12 s (a
  // program starts: 9 ms more a frame): its windows are set aside for 20 s,
  // then the next one measures the new keeping frames, and three calm
  // windows give the glass.
  {
    const run = await guarded();
    run.frames(120, pc(.026, .022, { extra: at => at >= 12 ? .009 : 0 }));
    const guard = run.mirrors.stats.guard, toGlass = guard.steps.find(step => step.stage === 'glass')?.at;
    assert.equal(run.stages(), 'light,glass'); assert.deepEqual(run.flips(), { toGlass: 1, toLive: 0 });
    const measured = guard.verdicts.filter(item => item.calm === null);
    assert.ok(measured.length === 2 && measured[1].at > 12 + renew && Math.abs(measured[1].kept - .035) < .001 && guard.setAside >= 4 && toGlass > measured[1].at, `measured at ${measured.map(item => item.at.toFixed(1)).join(' and ')} s, the glass at ${toGlass?.toFixed(1)} s`);
    run.mirrors.dispose();
  }
  // A 60 Hz PC whose light mirror shows 24 images a second instead of 30:
  // the keeping frames take two refreshes, the drawing ones three, 50 %
  // slower, under the 60 %. The guard cannot tell it from this busy PC on
  // high (single windows up to 80 %): it stays light (a limit, in the reprise).
  {
    const run = await guarded();
    assert.ok(run.frames(60, pc(.026, .022, { hz: 60 })) > 59.9);
    liveForGood(run, 'a 60 Hz PC, three refreshes against two');
    assert.ok(Math.abs(run.mirrors.stats.guard.last.ratio - 1.5) < 1e-6 && run.mirrors.stats.guard.last.live > floor);
    run.mirrors.dispose();
  }
  // A fight while the mirror is live: for 20 s every frame takes 25 ms more,
  // with or without the mirror, whose own cost stays 4 ms. Lighter during the
  // fight (the frames are slow), never the glass (both kinds slowed alike),
  // and the full mirror again 4 s after the fight.
  {
    const run = await guarded();
    assert.ok(run.frames(60, pc(.010, .004, { extra: at => at >= 5 && at < 25 ? .025 : 0 })) > 59.9);
    assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 }); assert.equal(run.stages(), 'light,full');
    const [toLight, toFull] = run.mirrors.stats.guard.steps.map(step => step.at);
    assert.ok(toLight > 5 + after && toLight < 5 + after + .5 && toFull > 25 + recover && toFull < 25 + recover + 1, `lighter at ${toLight.toFixed(2)} s, full again at ${toFull.toFixed(2)} s`);
    assert.ok(run.mirrors.stats.guard.verdicts.every(item => !item.cause));
    run.mirrors.dispose();
  }
  // Short fights on a PC that affords the mirror (60 Hz): 1.5 s of slow
  // frames change nothing; 3 s make it lighter, and the full mirror comes
  // back 4 s later.
  for (const [seconds, expected] of [[1.5, ''], [3, 'light,full']]) {
    const run = await guarded();
    assert.ok(run.frames(30, pc(.009, .006, { hz: 60, extra: at => at >= 5 && at < 5 + seconds ? .02 : 0 })) > 29.9);
    assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 }); assert.equal(run.stages(), expected, `a ${seconds} s fight`);
    if (expected) assert.ok(run.mirrors.stats.guard.steps[1].at < 5 + seconds + recover + 1.5, `full again at ${run.mirrors.stats.guard.steps[1].at.toFixed(2)} s`);
    run.mirrors.dispose();
  }
  // A recovery: this PC busy for 30 s, then free (the other sessions end):
  // lighter, then the full mirror again, and it stays.
  {
    const run = await guarded(), busy = thisPcBusy(3), free = pc(.009, .006, { hz: 60 });
    assert.ok(run.frames(70, (passes, at, stage) => (at < 30 ? busy : free)(passes, at, stage)) > 69.9);
    assert.equal(run.stages(), 'light,full'); assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 });
    const toFull = run.mirrors.stats.guard.steps[1].at;
    assert.ok(toFull > 30 + recover && toFull < 30 + recover + 1, `full again at ${toFull.toFixed(2)} s`);
    const back = run.timeline.filter(item => item.at > toFull + .5), target = run.mirrors.pool[0].getRenderTarget();
    assert.ok(back.every(item => item.passes === 1), 'redrawn on every frame again');
    assert.deepEqual([target.width, target.height, target.samples], [800, 450, MIRROR_LOOK.samples.medium], 'at half the drawing buffer, multisampled again');
    run.mirrors.dispose();
  }
  // No oscillation: a PC whose full mirror is slow (33 ms at 60 Hz) but whose
  // lighter one is fast (17 ms). Each return to the full mirror waits twice as
  // long as the last (4, 8, 16, 32 s, then a minute at most): in three minutes
  // it tries five times, ever more rarely, never the glass, never a blink.
  {
    const run = await guarded();
    assert.ok(run.frames(180, pc(.008, .022, { hz: 60, light: .005 })) > 179.9);
    assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 });
    const steps = run.mirrors.stats.guard.steps, spellsOfLight = [];
    for (let index = 0; index + 1 < steps.length; index++) if (steps[index].stage === 'light') spellsOfLight.push(steps[index + 1].at - steps[index].at);
    assert.ok(steps.every((step, index) => step.stage === (index % 2 ? 'full' : 'light')) && steps.length <= 11, run.stages());
    assert.ok(spellsOfLight.length >= 4 && spellsOfLight.every((value, index) => Math.abs(value - Math.min(recoverMax, recover * 2 ** index)) < .1), `light for ${spellsOfLight.map(value => value.toFixed(1)).join(', ')} s`);
    outcome.backoff = spellsOfLight.map(value => value.toFixed(0)).join(', ');
    run.mirrors.dispose();
  }
  // A pane cut by the screen's edge (40 cm away) while the eye moves 3 cm a
  // frame, on the PC that cannot afford the mirror: no frame keeps it, so no
  // window closes (the old guard timed a second of glass, a blink); it stays
  // light while the eye moves, then, the eye still, the glass for good.
  {
    const run = await guarded({ z: .45, sway: at => at < 20 ? .015 : 0 });
    assert.ok(run.frames(20, pc(.026, .022)) > 19.9);
    assert.ok(run.mirrors.pool[0].userData.clamped, 'the pane is cut by the screen\'s edge');
    assert.ok(lightTimeline(run).slice(1).every(item => item.passes === 1), 'redrawn every frame while the eye moves');
    assert.equal(run.stages(), 'light'); assert.equal(run.mirrors.stats.guard.verdicts.length, 0, 'no window closes'); assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 });
    run.frames(30, pc(.026, .022));
    assert.equal(run.stages(), 'light,glass'); assert.deepEqual(run.flips(), { toGlass: 1, toLive: 0 }); assert.ok(soundWindows(run));
    run.mirrors.dispose();
    // The same pane with the eye still: the cut reflection is kept every other frame.
    const still = await guarded({ z: .45 });
    still.frames(after + 1.5, pc(.0218, .0131));
    assert.ok(still.mirrors.pool[0].userData.clamped && still.mirrors.stats.reused > 5, 'kept while the eye stands still');
    still.mirrors.dispose();
  }
  // High: two reflectors; lighter, one only (the second fades out), redrawn
  // every other frame; full again after the fight, two again.
  {
    const run = await guarded({ quality: 'high', furniture: pair, x: 0 });
    run.frames(2, pc(.008, .004, { extra: at => at >= 3 && at < 9 ? .015 : 0 }));
    assert.equal(run.mirrors.live.length, 2);
    run.frames(28, pc(.008, .004, { extra: at => at >= 3 && at < 9 ? .015 : 0 }));
    assert.equal(run.stages(), 'light,full'); assert.deepEqual(run.flips(), { toGlass: 0, toLive: 0 });
    const [toLight, toFull] = run.mirrors.stats.guard.steps.map(step => step.at);
    assert.ok(run.mirrors.handovers.some(item => item.event === 'leave' && item.why === 'light' && item.time >= toLight), 'the second pane fades out');
    const lighter = run.timeline.filter(item => item.stage === 'light' && item.at > toLight + MIRROR_LOOK.fade + .1);
    assert.ok(lighter.length > 10 && lighter.every(item => item.live === 1) && lighter.every((item, index) => index === 0 || item.passes + lighter[index - 1].passes === 1), `one pane, every other frame: ${lighter.map(item => item.passes).join('')}`);
    assert.ok(run.timeline.filter(item => item.at > toFull + .5).every(item => item.live === 2 && item.passes === 2), 'two panes again, drawn every frame');
    run.mirrors.dispose();
  }
  // Hitches and pauses are not frames.
  {
    const run = await guarded();
    for (let index = 0; index < 20; index++) { run.frames(.5, () => 1 / 60); run.frames(.6, () => .6); }
    run.frames(10, () => .7);
    assert.equal(run.stages(), '', 'hitches and tab switches never count');
    run.mirrors.dispose();
  }
  // A pause in the middle of the fade to the glass (the paused room draws
  // the scene and runs no update): the fade ends at the next drawing, never
  // a mirror half faded for the whole pause.
  {
    const run = await guarded(), reflector = run.mirrors.pool[0];
    run.frames(60, pc(.026, .022), { until: item => item.stage === 'glass' && item.opacity > .3 && item.opacity < .7 });
    assert.ok(reflector.userData.leaving && reflector.userData.opacity > .3 && reflector.userData.opacity < .7, `half faded (${reflector.userData.opacity.toFixed(2)})`);
    // The client's own update when the room pauses, then the paused frames.
    run.mirrors.update(run.time, { camera: run.camera(), snapshot: { paused: true } });
    const eye = run.camera();
    for (let index = 0; index < 3; index++) reflector.onBeforeRender(run.renderer, run.scene, eye, reflector.geometry, reflector.material, null);
    assert.equal(reflector.material.uniforms.opacity.value, 0, 'faded out at once'); assert.equal(reflector.userData.opacity, 0);
    run.frames(.1, pc(.026, .022));
    assert.equal(run.mirrors.live.length, 0, 'released at the next update'); assert.equal(run.stages(), 'light,glass');
    run.mirrors.dispose();
  }
  pass('the frame-time guard never blinks: a PC that affords the mirror keeps it whole (fast screens too, 360 Hz frames joined in pairs); under 38 images a second for 2 s it gets lighter (one pane, every other frame, smaller, no multisampling) and stays live: this PC busy (three seeds), with fights of 8 and 20 s (also heavier in the reflection), rising contention, stalls, on high (a 56 Hz model, three seeds, and fights), its own recorded frames replayed, the verifiers\' measure, full load, a borderline PC, 60 Hz screens, a 30 Hz screen, a two-frame rhythm, catch-ups that are not the mirror\'s, a fight; it comes back to the full mirror after 4 s of headroom (a fight, a recovery), each return waiting twice as long; the glass for good, in one fade that draws nothing and frees the targets after, only after a window that measures and three calm windows of 1.5 s of each kind side by side whose drawing frames are 60 % slower under 30 images a second (a PC that cannot afford it, also after a fight or once busier for good, the proof\'s 40 ms heavier pass, catch-ups on a slow PC), never while a cut pane is redrawn as the eye moves; high drops to one pane when lighter; hitches do not count; a pause mid-fade ends the fade',
    `this PC busy: ${outcome.busy}; a 20 s fight of 8 ms: ${outcome.fight}; on high: ${outcome.high}; recorded: ${outcome.replays}; cannot afford: lighter at ${outcome.cannot.light} s, glass at ${outcome.cannot.glass} s; 40 ms heavier: glass at ${outcome.heavy} s; back-off: light for ${outcome.backoff} s`);
}

// 16. The browser proof's probe is inert unless its key is set.
{
  const { MIRROR_PROBE_KEY } = M;
  assert.equal(MIRROR_PROBE_KEY, 'deadwood-test-mirror-probe');
  const plain = createFunfairMirrors({ scene: new THREE.Scene(), quality: { id: 'medium' }, furniture: LEVEL.furniture });
  assert.equal(globalThis.__funfairMirrors, undefined, 'no storage: no probe');
  globalThis.localStorage = { getItem: () => null };
  const stored = createFunfairMirrors({ scene: new THREE.Scene(), quality: { id: 'medium' }, furniture: LEVEL.furniture });
  assert.equal(globalThis.__funfairMirrors, undefined, 'key absent: no probe');
  globalThis.localStorage = { getItem: key => { throw new Error(`blocked ${key}`); } };
  assert.doesNotThrow(() => createFunfairMirrors({ scene: new THREE.Scene(), quality: { id: 'medium' }, furniture: LEVEL.furniture }));
  assert.equal(globalThis.__funfairMirrors, undefined, 'blocked storage: no probe');
  globalThis.localStorage = { getItem: key => key === MIRROR_PROBE_KEY ? '1' : null };
  const probed = createFunfairMirrors({ scene: new THREE.Scene(), quality: { id: 'medium' }, furniture: LEVEL.furniture });
  assert.equal(globalThis.__funfairMirrors?.api, probed, 'key set: the probe');
  for (const name of ['setAvatarInMirrors', 'setLive', 'setNeutral', 'directView', 'rects', 'faceRect', 'targets', 'timeRenders', 'setFirstPerson', 'setSight', 'setGuard', 'leftOut', 'keep', 'handovers']) assert.equal(typeof globalThis.__funfairMirrors[name], 'function', name);
  probed.dispose(); assert.equal(globalThis.__funfairMirrors, undefined, 'dispose removes it');
  delete globalThis.localStorage; plain.dispose(); stored.dispose();
  pass('the test-only probe exists only when its localStorage key is set to 1, survives a blocked storage and leaves with dispose');
}

// 17. Walking and turning in the real maze, with the real collision proxies
// for the line of sight, at 60 frames a second: the verifier's drive from
// in front of panel 07 (turns both ways, a walk, strafes), sways (1.2 m side
// to side every 2.5 s) where round 1 changed pane 15 to 19 times in 10 s, and
// the walk past the end of panel 11 and back that the browser proof's
// controller made (round 1, and round 2 before MIRROR_RANGE.back, showed
// panel 11's south face for 0.43 s, then glass, then again for 0.22 s). A
// pane is never outweighed in its first second, every change fades through
// the glass unless the old pane is off screen, no pane comes back within
// 0.6 s, none shows for under 0.25 s between two others, and a sway changes
// pane at most 9 times.
{
  const world = W.createWorld(new THREE.Scene(), { quality: { id: 'low', shadows: false, shadowMapSize: 0, fireflies: 0, groundDetail: 0, rainFraction: .1 }, loadDecor: async () => new THREE.Group() });
  assert.equal(await world.ready, true);
  const D = Math.PI / 180, camera = new THREE.PerspectiveCamera(76, 16 / 9, .06, 130); camera.rotation.order = 'YXZ';
  const place = ({ x, z, yaw }) => { camera.position.set(x, -1.8, z); camera.rotation.set(-.08, yaw, 0); camera.updateMatrixWorld(true); };
  async function walk(steps) {
    const mirrors = createFunfairMirrors({ scene: new THREE.Scene(), quality: { id: 'medium' }, rayBlockers: world.rayBlockers, furniture: LEVEL.furniture, factories, loadReflector: realReflector, clock: steady() });
    place(steps[0]); mirrors.update(0, { camera }); await mirrors.loading;
    const segments = [];
    for (const step of steps) {
      place(step); mirrors.update(step.t, { camera });
      const live = ids(mirrors).join(), last = segments.at(-1);
      if (!last || last.live !== live) segments.push({ live, from: step.t, to: step.t }); else last.to = step.t;
    }
    const handovers = mirrors.handovers;
    mirrors.dispose();
    const shown = segments.filter(segment => segment.live);
    let changes = 0; for (let index = 1; index < shown.length; index++) if (shown[index].live !== shown[index - 1].live) changes++;
    segments.forEach((segment, index) => { segment.seconds = (segments[index + 1]?.from ?? segment.to) - segment.from; });
    const returns = [], flashes = [];
    for (let index = 2; index < segments.length; index++) if (segments[index].live && segments[index].live === segments[index - 2].live && segments[index - 1].seconds < .6) returns.push(segments.slice(index - 2, index + 1).map(segment => `${segment.live || 'glass'} ${segment.seconds.toFixed(2)}`).join(' / '));
    for (const segment of segments.slice(1, -1)) if (segment.live && segment.seconds < .25 - 1e-9) flashes.push(`${segment.live} ${segment.seconds.toFixed(2)} s`);
    // Each pane outweighed at least MIRROR_RANGE.hold after it arrived.
    const arrived = new Map(), early = [];
    for (const item of handovers) {
      if (item.event === 'arrive') arrived.set(item.face, item.time);
      if (item.why === 'outweighed' || item.event === 'gone:outweighed') { const held = item.time - arrived.get(item.face); if (!(held >= MIRROR_RANGE.hold - 1e-9)) early.push(`${item.face} ${held.toFixed(2)} s`); }
    }
    // Each pane that leaves fades out ('leave', then 'left' or won 'back'),
    // unless it is off screen ('gone:...'); none is released at once.
    const fading = new Set(), unfaded = [];
    for (const item of handovers) {
      if (item.event === 'leave') fading.add(item.face);
      else if (item.event === 'left' || item.event === 'back') { if (!fading.delete(item.face)) unfaded.push(`${item.event} without a fade: ${item.face}`); }
      else if (item.event === 'release') unfaded.push(`released at once: ${item.face}`);
    }
    return { changes, early, unfaded, returns, flashes, faded: handovers.filter(item => item.event === 'left').length, gone: handovers.filter(item => item.event.startsWith('gone:')).length, segments };
  }
  // The verifier's drive (60 frames a second): still, a turn right of 360
  // degrees at 50 a second, 300 back at 90, 145 at 40, a walk forward and back,
  // strafes, then a slow turn while walking.
  const drive = [];
  {
    let x = -12.2, z = 9, yaw = 0, t = 0;
    const phase = (seconds, turn = 0, forward = 0, strafe = 0) => {
      for (let index = 0; index < Math.round(seconds * 60); index++) {
        yaw += turn * D / 60; t += 1 / 60;
        x += (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) / 60; z += (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) / 60;
        drive.push({ t, x, z, yaw });
      }
    };
    phase(2); phase(360 / 50, -50); phase(300 / 90, 90); phase(145 / 40, 40); phase(.6, 0, 1); phase(.9, 0, -1); phase(.5 / .6, 0, 0, -.6); phase(1.2 / .6, 0, 0, .6); phase(4, 45, .3);
  }
  const sway = (x0, z0, degrees) => Array.from({ length: 600 }, (_, index) => {
    const t = (index + 1) / 60, side = .6 * Math.sin(2 * Math.PI * t / 2.5), yaw = degrees * D;
    return { t, x: x0 + Math.cos(yaw) * side, z: z0 - Math.sin(yaw) * side, yaw };
  });
  // Past the end of panel 11 and back, heading 49.9 degrees west of north: the
  // eye crosses the panel's plane beyond its end both ways.
  const pastEnd = [];
  {
    const heading = -49.9 * D, yaw = heading - Math.PI;
    let x = -12.2, z = 9, t = 0;
    const go = (seconds, speed) => { for (let index = 0; index < Math.round(seconds * 60); index++) { x += Math.sin(heading) * speed / 60; z += Math.cos(heading) * speed / 60; t += 1 / 60; pastEnd.push({ t, x, z, yaw }); } };
    go(2, 0); go(1.1, 1.74); go(.3, 0); go(1.37, -1.94); go(1, 0);
  }
  const runs = { drive: await walk(drive), 'past the end of panel 11': await walk(pastEnd) };
  for (const [x, z, degrees] of [[-15.6, 5.4, 270], [-10.8, 5.4, 270], [-11.6, 3.8, 180], [-13.2, 7.8, 270]]) runs[`sway ${x} ${z} ${degrees}`] = await walk(sway(x, z, degrees));
  for (const [label, run] of Object.entries(runs)) {
    assert.deepEqual(run.early, [], `${label}: a pane outweighed in its first ${MIRROR_RANGE.hold} s`);
    assert.deepEqual(run.unfaded, [], `${label}: every pane on screen fades out`);
    assert.deepEqual(run.returns, [], `${label}: a pane back within 0.6 s`);
    assert.deepEqual(run.flashes, [], `${label}: a pane shown under 0.25 s`);
    assert.ok(run.faded > 0 || label.startsWith('past'), label);
    if (label.startsWith('sway')) assert.ok(run.changes <= 9, `${label}: ${run.changes} changes of pane in 10 s (round 1: 15 to 19)`);
  }
  world.dispose();
  pass('walking and turning in the real maze: no pane outweighed in its first second, every pane on screen fades out through the glass, none back within 0.6 s or shown under 0.25 s (walking past the end of panel 11), a sway changes pane at most 9 times in 10 s (round 1: 15 to 19)',
    Object.entries(runs).map(([label, run]) => `${label}: ${run.changes} changes, ${run.faded} faded, ${run.gone} off screen`).join('; '));
}

console.log(`funfair mirrors verified: ${checks.length} checks`);
