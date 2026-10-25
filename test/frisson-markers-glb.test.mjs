import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFrissonMarkersGlb } from '../tools/frisson-glb-check.mjs';
import { markersRoots, buildMarkersGlb, brokenRoots } from './helpers/frisson-markers-glb.mjs';

// The checker's markers mode (art/frisson/MARKERS.md section 4, "Checker"),
// driven with the synthetic markers GLB of helpers/frisson-markers-glb.mjs:
// the valid set passes (also fitted onto the proposal heads and bodies, the
// calibrated references), and each deliberate violation is an error naming
// the offending root.
const GLB = buildMarkersGlb(markersRoots());
const RODEURS = new URL('../art/frisson/proposals/rodeurs/rodeurs_heads.glb', import.meta.url);
const BODIES_A = new URL('../art/frisson/proposals/bodies-a/bodies.glb', import.meta.url);
const BODIES_B = new URL('../art/frisson/proposals/bodies-b/bodies.glb', import.meta.url);
const read = url => readFileSync(url);
const errorsOf = async roots => (await checkFrissonMarkersGlb(buildMarkersGlb(roots))).errors.join('\n');
const tool = fileURLToPath(new URL('../tools/frisson-glb-check.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });

test('the synthetic markers.glb follows the markers contract, plain and fitted on the reference heads and bodies', { skip: 'needs the art and audio originals, kept out of the open edition' }, async () => {
  const { errors, families } = await checkFrissonMarkersGlb(GLB);
  assert.deepEqual(errors, []);
  assert.ok(families.length >= 9, 'the per-family report');
  const fitted = await checkFrissonMarkersGlb(GLB, { heads: [read(RODEURS)], bodies: [read(BODIES_A), read(BODIES_B)] });
  assert.deepEqual(fitted.errors, []);
  assert.ok(fitted.fit.heads >= 1 && fitted.fit.torsos >= 1 && fitted.fit.crawlers >= 1 && fitted.fit.arms >= 1, 'the fit was measured on the references');
});

test('each deliberate violation is an error naming the offending root', async () => {
  // A _Detail child drawn with another material.
  assert.match(await errorsOf(brokenRoots('material')), /FrissonMark_Sallow_Torso/);
  // A root with neither a _Detail nor a _Glow channel.
  assert.match(await errorsOf(brokenRoots('channel')), /FrissonMark_Rust_Neck/);
  // Pieces past the anchor bounds.
  assert.match(await errorsOf(brokenRoots('bounds')), /FrissonMark_Sallow_Torso/);
  // Over the family's triangle budget.
  assert.match(await errorsOf(brokenRoots('budget')), /scarlet: \d+ standing triangles, budget 700/);
  // Glow on a family that never glows (only Charcoal and Overlord do).
  assert.match(await errorsOf(brokenRoots('glow')), /FrissonMark_Sallow_Torso/);
  // A required root missing.
  assert.match(await errorsOf(brokenRoots('missing')), /FrissonMark_Hulk_Neck/);
});

test('the checker\'s command line: --markers, exit codes', () => {
  const folder = mkdtempSync(join(tmpdir(), 'frisson-markers-'));
  try {
    const good = join(folder, 'markers.glb'), bad = join(folder, 'broken.glb');
    writeFileSync(good, GLB);
    writeFileSync(bad, buildMarkersGlb(brokenRoots('bounds')));
    const happy = run(good, '--markers');
    assert.equal(happy.status, 0, happy.stdout + happy.stderr);
    const broken = run(bad, '--markers');
    assert.equal(broken.status, 1, broken.stdout + broken.stderr);
    assert.match(broken.stdout, /FrissonMark_Sallow_Torso/);
    // Reference heads and bodies come after the flags, in any order.
    assert.equal(run(good, '--markers', '--heads', fileURLToPath(new URL('../public/frisson/heads.glb', import.meta.url)), '--bodies', fileURLToPath(new URL('../public/frisson/bodies.glb', import.meta.url))).status, 0);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
