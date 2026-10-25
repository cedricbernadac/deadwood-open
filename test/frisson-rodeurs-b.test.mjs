// Frisson heads, "Rodeurs" proposal (second artist): the committed GLB keeps
// the contract of art/frisson/DESIGN.md. Skipped if the proposal is removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = new URL('../art/frisson/proposals/rodeurs-b/', import.meta.url);
const glb = fileURLToPath(new URL('rodeurs-b_heads.glb', dir));
const present = existsSync(glb);

test('Rodeurs-b heads GLB meets the Frisson head contract', { skip: !present && 'proposal not present' }, async () => {
  const { auditGlb, LIMITS } = await import(new URL('glb_audit.mjs', dir));
  const report = auditGlb(readFileSync(glb), { bytes: statSync(glb).size });
  assert.deepEqual(report.problems, []);
  const names = Object.keys(report.heads);
  assert.ok(names.filter(n => n !== 'Boss').length >= LIMITS.minVariants);
  assert.ok(names.includes('Boss'));
  for (const [name, head] of Object.entries(report.heads)) {
    // The face looks down -Z and the skin reaches the neck like today's skulls.
    assert.ok(head.eyeZ < -0.1, `${name} eyes face -Z`);
    assert.ok(head.min[1] <= -0.17, `${name} reaches down to the neck`);
  }
});

test('Rodeurs-b heads keep the in-engine review fixes', { skip: !present && 'proposal not present' }, () => {
  const report = JSON.parse(readFileSync(fileURLToPath(new URL('rodeurs-b_heads.json', dir)), 'utf8'));
  const heads = Object.entries(report.heads).filter(([name]) => name !== 'FrissonHead_Boss');
  for (const [name, h] of heads) {
    // Eyes: a 12-triangle bead per pit, forward in the pit and wide apart, so the game's glow shows at 6 m.
    assert.equal(h.triangles.eyes, 24, `${name} eye beads`);
    assert.ok(h.eye_front_z <= -0.175, `${name} eye beads forward in the pit (${h.eye_front_z})`);
    assert.ok(h.eye_x >= 0.058, `${name} pupils apart (${h.eye_x})`);
    // Hats are fitted to the skin above the centre: the cranium carries them.
    assert.ok(h.band_half >= 0.17 && h.band_half <= 0.2, `${name} hat band half width ${h.band_half}`);
    // Crawlers keep their .74 even when the hair counts (heads.js measures every part).
    assert.ok(h.head_top <= 0.215, `${name} top ${h.head_top}`);
    assert.equal(h.crawler_scale, 0.74);
  }
  // Nine different faces, not one face nine times: eye line, brow and nose vary.
  const spread = key => Math.max(...heads.map(([, h]) => h[key])) - Math.min(...heads.map(([, h]) => h[key]));
  assert.ok(spread('eye_y') >= 0.015, `eye line spread ${spread('eye_y')}`);
  assert.ok(spread('brow_front_z') >= 0.02, `brow spread ${spread('brow_front_z')}`);
  assert.ok(spread('face_front_z') >= 0.03, `nose spread ${spread('face_front_z')}`);
  const boss = report.heads.FrissonHead_Boss;
  assert.ok(boss.boss_scale === 1 && boss.jaw_half >= 0.24, 'the boss keeps its size and its swollen jowls');
});

test('Rodeurs-b generator report matches the GLB', { skip: !present && 'proposal not present' }, async () => {
  const { createHash } = await import('node:crypto');
  const report = JSON.parse(readFileSync(fileURLToPath(new URL('rodeurs-b_heads.json', dir)), 'utf8'));
  const sha = createHash('sha256').update(readFileSync(glb)).digest('hex');
  assert.equal(report.glb_sha256, sha);
  assert.equal(report.glb_bytes, statSync(glb).size);
});
