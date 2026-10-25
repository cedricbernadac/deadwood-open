// Fixes from the reviews of the Frisson tuning (art/frisson/DESIGN.md):
// the prewarm runs again for each zombie style, the falling zombies go with
// the pack, a lock the browser cannot keep says so, and a storybook body
// under a Frisson head wears the head's corpse colour.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';
import { settle, recordingPack, clientHarness, snapshotFor, walker } from './helpers/frisson-client.mjs';

const zombies = await importPublicModule('zombies.js');
const heads = await importPublicModule('frisson/heads.js');
const { skinColor } = await importPublicModule('frisson/palette.js');
const { createWorld } = await importPublicModule('world.js');
const { enemyAppearance } = await import('../public/enemies.js');
const { t, setLanguage, getLanguage } = await import('../public/i18n.js');
// The final heads.glb (24 heads and the boss).
const HEADS = readFileSync(new URL('../public/frisson/heads.glb', import.meta.url));
const installHeads = () => heads.install({ fetchAsset: async () => HEADS });

// Signs draw on a canvas: the world needs one, even in Node.
const canvasDocument = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: value => ({ width: value.length * 20 }) }, { get: (object, key) => key in object ? object[key] : () => {} }) }) };
function withCanvas(run) {
  const previous = globalThis.document; globalThis.document = canvasDocument;
  try { return run(); } finally { globalThis.document = previous; }
}
// A renderer that keeps, for each compile, the materials it was given.
function recordingRenderer() {
  const runs = [];
  return { runs, compile(scene) { const materials = new Set(); scene.traverse(object => { if (object.isMesh) for (const material of [].concat(object.material)) materials.add(material); }); runs.push(materials); } };
}
const WALKER = enemyAppearance({ kind: 'walker', maxHp: 80 });

test('world.prewarm: once per page for Famille, as before, and once more for each Frisson install (a later room compiles at enterGame)', async () => {
  assert.equal(zombies.getZombieStyle(), null);
  const camera = new THREE.PerspectiveCamera();
  // Famille only: one compile in the whole page, exactly as before.
  {
    const world = withCanvas(() => createWorld(new THREE.Scene())), renderer = recordingRenderer();
    assert.equal(withCanvas(() => world.prewarm(renderer, camera)), true);
    for (let room = 0; room < 3; room++) assert.equal(withCanvas(() => world.prewarm(renderer, camera)), false);
    assert.equal(renderer.runs.length, 1);
  }
  // Famille, then two Frisson rooms, then Famille again, in one tab.
  const world = withCanvas(() => createWorld(new THREE.Scene())), renderer = recordingRenderer();
  assert.equal(withCanvas(() => world.prewarm(renderer, camera)), true);
  for (let room = 0; room < 2; room++) {
    const handle = await installHeads();
    try {
      const skin = handle.style.materials.skin(WALKER);
      assert.equal(withCanvas(() => world.prewarm(renderer, camera)), true, `Frisson room ${room + 1}: compiled with the in-play lights`);
      assert.ok(renderer.runs.at(-1).has(skin), 'the staged walker wears this install\'s heads');
      assert.equal(withCanvas(() => world.prewarm(renderer, camera)), false, 'once per install');
    } finally { handle.uninstall(); }
  }
  assert.equal(withCanvas(() => world.prewarm(renderer, camera)), false, 'Famille was compiled already');
  assert.equal(renderer.runs.length, 3);
  // A Frisson room first: the next Famille room still gets its own compile.
  {
    const world = withCanvas(() => createWorld(new THREE.Scene())), renderer = recordingRenderer();
    const handle = await installHeads();
    try { assert.equal(withCanvas(() => world.prewarm(renderer, camera)), true); } finally { handle.uninstall(); }
    assert.equal(withCanvas(() => world.prewarm(renderer, camera)), true);
    assert.equal(withCanvas(() => world.prewarm(renderer, camera)), false);
    assert.ok([...renderer.runs[1]].every(material => !material.flatShading), 'storybook programs only');
  }
});

const kill = (zombieId, extra = {}) => ({ type: 'event', event: 'kill', id: 'host', zombieId, headshot: false, boss: false, x: 2, y: 0, z: -4, dirX: 1, dirZ: 0, weapon: 'pistol', score: 10, chain: 1, ...extra });
const raider = id => ({ id, kind: 'raider', boss: false, x: 6, y: 0, z: -6, yaw: 0, hp: 90, maxHp: 90, weapon: 'smg' });

test('"Famille uniquement" mid-night: the falling Frisson zombies go with the pack (their shared buffers are freed), raiders stay', async () => {
  const log = [], pack = recordingPack(log), client = clientHarness({ importer: pack.importer, log });
  client.join('guest');
  const night = () => snapshotFor({ ambiance: 'frisson', phase: 'wave', zombies: [walker(5), walker(6, 3), raider(7)] });
  client.update(night()); await settle(); await settle();
  client.enter();
  // The models in play (the pack, once on, had them made again).
  const body = client.zombies.findLast(mesh => mesh.userData.id === 5), standing = client.zombies.findLast(mesh => mesh.userData.id === 6);
  client.event(kill(5)); client.event(kill(7, { raider: true }));
  const after = night(); after.zombies = after.zombies.filter(zombie => zombie.id === 6); client.update(after);
  assert.equal(client.disposed.includes(body), false, 'falling');
  client.storage('deadwood-family-lock', '1'); await settle(); await settle();
  assert.equal(log.at(-1), 'uninstall');
  assert.ok(client.disposed.includes(body), 'the falling zombie went with the pack');
  assert.ok(client.disposed.includes(standing), 'the standing one is made again');
  assert.equal(client.disposed.filter(mesh => mesh.userData.raider).length, 0, 'raiders keep their own models');
  assert.deepEqual(client.state().zombieIds, [6]);
});

test('a Famille night never rebuilds: its falling zombies finish their fall', async () => {
  const client = clientHarness({ importer: () => { throw new Error('no pack in Famille'); } });
  client.join('guest');
  client.update(snapshotFor({ ambiance: 'family', phase: 'wave', zombies: [walker(5), walker(6, 3)] })); await settle();
  client.enter();
  const body = client.zombies.findLast(mesh => mesh.userData.id === 5);
  client.event(kill(5));
  client.update(snapshotFor({ ambiance: 'family', phase: 'wave', zombies: [walker(6, 3)] })); await settle(); await settle();
  assert.equal(client.disposed.includes(body), false);
  assert.deepEqual(client.loaderCalls, []);
});

const blocked = () => { const error = () => { throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }); }; return { getItem: error, setItem: error }; };
const forgetful = () => ({ getItem: () => null, setItem() {} });
function tick(client, checked) { const box = client.node('family-lock'); box.checked = checked; box.onchange({ target: box }); }

test('"Famille uniquement" in a browser that cannot keep it: the lock holds for this page and a note says it will not last', () => {
  for (const [label, storage] of [['throws', blocked()], ['forgets', forgetful()]]) {
    const client = clientHarness({ storage });
    assert.equal(client.node('family-lock-note').hidden, true, `${label}: nothing to say yet`);
    tick(client, true);
    assert.equal(client.state().familyLocked, true, `${label}: locked until the page reloads`);
    assert.equal(client.node('ambiance-frisson').disabled, true);
    assert.equal(client.node('family-lock').checked, true);
    assert.equal(client.node('family-lock-note').hidden, false, `${label}: the note shows`);
    tick(client, false);
    assert.equal(client.node('family-lock-note').hidden, true, `${label}: unlocked, the default after a reload too`);
  }
  // A browser that keeps it: no note.
  const client = clientHarness();
  tick(client, true);
  assert.equal(client.stored.get('deadwood-family-lock'), '1');
  assert.equal(client.node('family-lock-note').hidden, true);
  // The note is in both pages, hidden, with its text in both languages.
  for (const page of ['index.html', 'online.html']) {
    const html = readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');
    assert.match(html, /<p id="family-lock-note" class="family-lock-note" role="status" data-i18n="ambiance\.lockNotKept" hidden>/, page);
  }
  const language = getLanguage();
  try {
    for (const value of ['fr', 'en']) { setLanguage(value); assert.ok(t('ambiance.lockNotKept').length > 20 && t('ambiance.lockNotKept') !== 'ambiance.lockNotKept', value); }
  } finally { setLanguage(language); }
});

test('a storybook body under a Frisson head (no bodies.glb) wears the head\'s corpse colour in the game\'s own skin material', async () => {
  const famille = Object.fromEntries([['walker', 80], ['walker', 310], ['crawler', 230], ['brute', 1000]].map(([kind, hp]) => {
    const model = zombies.createZombie(kind, false, hp, 'z3');
    return [`${kind}/${hp}`, Object.fromEntries(['zombieSkin', 'zombieHand'].map(name => [name, model.getObjectByName(name)?.material]))];
  }));
  const handle = await installHeads();
  try {
    for (const key of Object.keys(famille)) {
      const [kind, hp] = key.split('/'), appearance = enemyAppearance({ kind, maxHp: Number(hp) });
      const model = zombies.createZombie(kind, false, Number(hp), 'z3');
      assert.equal(model.userData.head.children[0].material.color.getHex(), skinColor(appearance));
      let seen = 0;
      model.userData.body.traverse(mesh => {
        if (!mesh.isMesh || !['zombieSkin', 'zombieHand'].includes(mesh.name)) return;
        seen++;
        const plain = famille[key][mesh.name];
        assert.equal(mesh.material.color.getHex(), skinColor(appearance), `${key} ${mesh.name}: the head's colour`);
        assert.notEqual(mesh.material.color.getHex(), plain.color.getHex(), `${key} ${mesh.name}: not the storybook colour`);
        for (const field of ['type', 'roughness', 'metalness', 'flatShading', 'vertexColors', 'fog', 'side']) assert.equal(mesh.material[field], plain[field], `${key} ${mesh.name} ${field}`);
        assert.equal(mesh.material.customProgramCacheKey(), plain.customProgramCacheKey(), 'no program added');
      });
      assert.ok(seen >= 1, key);
    }
    // A family the palette leaves alone keeps the game's material.
    assert.equal(handle.style.skin({ id: 'unknown', color: 0x123456 }), null);
  } finally { handle.uninstall(); }
  // Off again: the storybook skin of Famille.
  for (const [key, parts] of Object.entries(famille)) {
    const [kind, hp] = key.split('/'), model = zombies.createZombie(kind, false, Number(hp), 'z3');
    for (const [name, material] of Object.entries(parts)) if (material) assert.equal(model.getObjectByName(name).material, material, `${key} ${name}`);
  }
});
