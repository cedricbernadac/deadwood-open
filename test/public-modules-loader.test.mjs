import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as THREE from 'three';
import { importPublicModule, importPublicSource, publicModuleUrl } from './helpers/public-modules.mjs';

test('world.js loads through the helper and exposes createWorld', async () => {
  const world = await importPublicModule('world.js');
  assert.equal(typeof world.createWorld, 'function');
  assert.ok(publicModuleUrl('world.js').startsWith('data:text/javascript;base64,'));
});

test('importing world.js twice in one process returns the same instance', async () => {
  const [first, second] = await Promise.all([importPublicModule('world.js'), importPublicModule('world.js')]);
  assert.equal(first, second);
});

test('rules.js through the helper is the same instance as a direct import', async () => {
  const viaHelper = await importPublicModule('rules.js');
  const direct = await import('../public/rules.js');
  assert.equal(viaHelper, direct);
  assert.equal(publicModuleUrl('rules.js'), new URL('../public/rules.js', import.meta.url).href);
});

test('a browser-only module importing another browser module shares the three instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deadwood-public-modules-'));
  try {
    await writeFile(join(root, 'inner.js'), "import * as THREE from '/vendor/three.module.js';\nexport const mesh = new THREE.Mesh();\n");
    await writeFile(join(root, 'outer.js'), 'import { mesh as imported } from "./inner.js";\nexport { mesh } from \'./inner.js\';\nexport const shared = imported;\n');
    const outer = await importPublicModule('outer.js', { root });
    assert.ok(outer.shared instanceof THREE.Mesh, 'instanceof THREE.Mesh works across the data URL boundary');
    assert.equal(outer.mesh, outer.shared);
    assert.ok(publicModuleUrl('outer.js', { root }).startsWith('data:text/javascript;base64,'));
    assert.ok(publicModuleUrl('inner.js', { root }).startsWith('data:text/javascript;base64,'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a missing relative import throws a clear error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deadwood-public-modules-'));
  try {
    await writeFile(join(root, 'broken.js'), "import { value } from './missing.js';\nexport const value2 = value;\n");
    await assert.rejects(importPublicModule('broken.js', { root }), /does not exist/);
    await assert.rejects(importPublicModule('broken.js', { root: join(root, 'empty') }), /does not exist/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('importPublicSource rewrites source text as a named public module', async () => {
  const source = "import * as THREE from '/vendor/three.module.js';\nimport { MAX_WAVES } from './rules.js';\nexport const probe = { mesh: new THREE.Mesh(), waves: MAX_WAVES };\n";
  const module = await importPublicSource(source);
  assert.ok(module.probe.mesh instanceof THREE.Mesh);
  const rules = await import('../public/rules.js');
  assert.equal(module.probe.waves, rules.MAX_WAVES);
});
