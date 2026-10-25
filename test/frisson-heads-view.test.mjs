import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { importPublicModule, importPublicSource } from './helpers/public-modules.mjs';
import { withoutHeadStyleHook } from './helpers/frisson-heads-baseline.mjs';

// The family's head marks from the player's views, over every head of each
// final file: Frisson's heads.glb and Frisson léger's heads-b.glb (15 October
// 2026). frisson-tune-look.test.mjs checks two zombies on heads.glb; here
// each family is worn on each head once (the overlord: its own head, twice),
// with a coarser grid of rays (16 x 16 from each view) to keep it quick, and
// its hits are summed against the same zombies in Famille. Some heads show a
// mark much less than Famille does (the colossus cage under a quarter on a
// few heads of both files: Famille's cage stands out of a round skull, the
// cast one follows the jaw); each family as a whole shows at least half.
// Measured 15 October 2026, cage over every head: heads.glb 535 hits against
// Famille's 962 (56 %), heads-b.glb 592 against 1013 (58 %).
const zombies = await importPublicModule('zombies.js');
const heads = await importPublicModule('frisson/heads.js');
const source = readFileSync(new URL('../public/zombies.js', import.meta.url), 'utf8');
const storybook = await importPublicSource(withoutHeadStyleHook(source), { name: 'zombies.js' });
const FINAL = ['heads.glb', 'heads-b.glb'].map(name => [name, readFileSync(new URL(`../public/frisson/${name}`, import.meta.url))]);
// Families with head marks (enemies.js markers) and the hp that picks them.
const MARKED = [['walker', false, 115, 'wrap'], ['walker', false, 165, 'scarf'], ['walker', false, 230, 'straps'], ['walker', false, 310, 'cowl'], ['walker', false, 400, 'ash'],
  ['brute', false, 1000, 'rivets'], ['brute', false, 1400, 'cage'], ['brute', true, 6000, 'crown']];
const GRID = 16;
const meshes = group => { const list = []; group.traverse(child => { if (child.isMesh) list.push(child); }); return list; };

// As frisson-tune-look's: parallel rays from 6 m at the head from the front,
// three-quarters and the sides; hits on a mark first.
function seen(model) {
  model.updateMatrixWorld(true);
  const head = model.userData.head, centre = head.getWorldPosition(new THREE.Vector3()), size = .32 * model.scale.y;
  const targets = meshes(model), ray = new THREE.Raycaster(), origin = new THREE.Vector3(), direction = new THREE.Vector3();
  let hits = 0;
  for (const yaw of [0, -45, 45, -90, 90]) {
    const angle = yaw * Math.PI / 180, toward = direction.set(-Math.sin(angle), 0, Math.cos(angle)), right = new THREE.Vector3(toward.z, 0, -toward.x);
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      origin.copy(centre).addScaledVector(toward, -6).addScaledVector(right, ((i + .5) / GRID - .5) * 2 * size);
      origin.y += ((j + .5) / GRID - .5) * 2 * size;
      ray.set(origin, toward); ray.far = 12;
      const first = ray.intersectObjects(targets, false)[0];
      if (first && first.object.name.startsWith('healthHead')) hits++;
    }
  }
  return hits;
}

for (const [label, bytes] of FINAL) test(`${label}: over every head, each family's head marks show at least half as much as in Famille`, async t => {
  const handle = await heads.install({ fetchAsset: async () => bytes });
  try {
    const { variants } = handle.heads;
    // One server id wearing each head.
    const ids = variants.map((_, index) => { for (let serial = 1; serial < 10000; serial++) if (heads.headVariant(`z${serial}`, variants.length) === index) return `z${serial}`; return null; });
    assert.ok(ids.every(Boolean));
    for (const [kind, boss, hp, marker] of MARKED) {
      let frisson = 0, plain = 0, lowest = Infinity, weakest = 'none';
      for (const id of boss ? ['z5', 'z11'] : ids) {
        const model = zombies.createZombie(kind, boss, hp, id), mine = seen(model), theirs = seen(storybook.createZombie(kind, boss, hp, id));
        frisson += mine; plain += theirs;
        if (theirs > 0 && mine / theirs < lowest) { lowest = mine / theirs; weakest = `${model.userData.head.children[0].userData.headVariant} ${mine}/${theirs}`; }
      }
      t.diagnostic(`${label} ${kind}/${hp} ${marker}: ${frisson} hits, Famille ${plain} (${(frisson / plain * 100).toFixed(0)} %); weakest head ${weakest}`);
      assert.ok(frisson >= .5 * plain && frisson > 5 * (boss ? 2 : variants.length), `${label} ${kind}/${hp} ${marker}: ${frisson} hits, Famille ${plain}`);
    }
  } finally { handle.uninstall(); }
});
