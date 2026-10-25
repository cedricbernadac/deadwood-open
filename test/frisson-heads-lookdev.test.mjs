import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';
import { buildHeadsGlb, namedHeads } from './helpers/frisson-heads-glb.mjs';

// The heads lookdev page (public/frisson/lookdev.html) through its lineup:
// what the owner sees while choosing heads, and what stays on the GPU.
const zombies = await importPublicModule('zombies.js');
const heads = await importPublicModule('frisson/heads.js');
const { createLineup, PER_PAGE } = await importPublicModule('frisson/lookdev-lineup.js');
// The final heads.glb (24 heads and the boss).
const HEADS = readFileSync(new URL('../public/frisson/heads.glb', import.meta.url));
const load = (bytes = HEADS) => () => heads.install({ fetchAsset: async () => bytes });

function stage() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 9, .06, 130);
  // A stand-in for the raider, whose real rig needs canvas textures.
  const raider = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(.5, 1.8, .3));
  raider.userData.kind = 'raider'; body.position.y = .9; raider.add(body);
  return { scene, camera, raider, lineup: createLineup({ scene, camera, raider }) };
}
const headsOf = handle => handle.heads.variants.flatMap(head => [head.skin, head.detail, head.eyes]);

test('lookdev shows one row at a time: nothing stands between the camera and the heads on show', async () => {
  const { scene, camera, raider, lineup } = stage();
  try {
    for (const next of [load(), null, load(buildHeadsGlb(namedHeads(3, { boss: true })))]) {
      await lineup.swapHeads(next);
      // The final 24 heads take three pages of variants; six storybook
      // heads or three test heads, one.
      const pages = lineup.views.filter(([id]) => id.startsWith('variants'));
      const count = lineup.heads?.heads.variants.length ?? 6;
      assert.equal(pages.length, Math.ceil(count / PER_PAGE), `${count} heads`);
      assert.deepEqual(lineup.views.map(([id]) => id), [...pages.map(([id]) => id), 'families', 'specials']);
      if (pages.length > 1) assert.deepEqual(pages.map(([, label]) => label), ['Variantes 1–8', 'Variantes 9–16', 'Variantes 17–24']);
      const shown = lineup.actors.filter(actor => actor.row.startsWith('variants')).map(actor => actor.model.userData.head.children[0].userData.headVariant);
      if (lineup.heads) assert.deepEqual(shown, lineup.heads.heads.variants.map(variant => variant.name), 'every head once, in file order');
      for (const [view] of lineup.views) {
        lineup.setView(view); lineup.placeCamera(); scene.updateMatrixWorld(true); camera.updateMatrixWorld();
        const row = lineup.actors.filter(actor => actor.row === view);
        assert.ok(row.length >= Math.min(6, count), `${view}: ${row.length} actors`);
        for (const actor of lineup.actors) assert.equal(actor.model.visible, actor.row === view, `${view}: ${actor.text} shown only in its own row`);
        assert.deepEqual(new Set(lineup.anchors().map(anchor => anchor.actor)), new Set(row), `${view}: the row's labels, and only them`);
        // A click on each head picks that zombie, so its head can be framed.
        for (const actor of row) {
          const aim = (actor.model.userData.head ?? actor.model.children[0]).getWorldPosition(new THREE.Vector3()).project(camera);
          assert.ok(Math.abs(aim.x) < 1 && Math.abs(aim.y) < 1, `${view}: ${actor.text} in the frame`);
          assert.ok(lineup.pick(aim.x, aim.y) === actor, `${view}: a click on ${actor.text} picks it, not ${lineup.pick(aim.x, aim.y)?.text}`);
        }
      }
      assert.equal(lineup.actors.filter(actor => actor.kind === 'raider')[0]?.model, raider, 'one raider, never rebuilt');
    }
  } finally { lineup.dispose(); }
  assert.equal(zombies.getZombieStyle(), null);
});

// three uploads a geometry or material the first time it draws it, and
// forgets it on its dispose event; drawing it after that uploads it again,
// for good. draw() asserts that never happens.
function gpu(scene) {
  const held = new Set(), freed = new Set();
  const hold = resource => {
    if (held.has(resource)) return;
    assert.ok(!freed.has(resource), `draws the freed ${resource.type} ${resource.name || resource.uuid}`);
    held.add(resource);
    resource.addEventListener('dispose', function release() { resource.removeEventListener('dispose', release); held.delete(resource); freed.add(resource); });
  };
  return { held, draw() { scene.traverseVisible(object => { if (object.isMesh) { hold(object.geometry); hold(object.material); } }); } };
}

test('lookdev swaps heads without drawing freed buffers, and the old heads leave the GPU', async () => {
  const { scene, lineup } = stage(), view = gpu(scene);
  try {
    const first = await lineup.swapHeads(load());
    view.draw();
    // Frames keep coming while the next heads load.
    const second = await lineup.swapHeads(async () => {
      view.draw();
      const next = await load(buildHeadsGlb(namedHeads(3, { boss: true })))();
      view.draw();
      return next;
    });
    view.draw();
    assert.equal(headsOf(first).filter(geometry => view.held.has(geometry)).length, 0, 'the first heads left the GPU');
    assert.ok(headsOf(second).some(geometry => view.held.has(geometry)), 'the second heads are drawn');
    // To Famille, then a missing proposal: Famille stays.
    await lineup.swapHeads(null);
    view.draw();
    await assert.rejects(lineup.swapHeads(async () => { view.draw(); throw new Error('proposals/enrages.glb est absent'); }), /absent/);
    assert.equal(zombies.getZombieStyle(), null);
    assert.equal(headsOf(second).filter(geometry => view.held.has(geometry)).length, 0, 'the second heads left the GPU');
    await lineup.swapHeads(load());
    // Every row drawn: the GPU holds exactly the geometry the lineup shows.
    for (const [id] of lineup.views) { lineup.setView(id); view.draw(); }
    const shown = new Set();
    scene.traverse(object => { if (object.isMesh) shown.add(object.geometry); });
    const stale = [...view.held].filter(resource => resource.isBufferGeometry && !shown.has(resource));
    assert.deepEqual(stale.map(geometry => geometry.name || geometry.type), [], 'no geometry left behind');
  } finally { lineup.dispose(); }
});
