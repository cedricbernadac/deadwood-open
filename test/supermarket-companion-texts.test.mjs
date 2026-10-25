import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lot 3: the supermarket companion fallback posts, floor-aware labels, player
// place names, per-flight STAIRS and the text budget (fixture: real simulation
// on DEADWOOD_LEVEL=supermarket, no server, no model API).
test('supermarket companion fallback posts and situation texts', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/supermarket-companion-texts-check.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, /supermarket companion texts verified/);
});

// The default map must not change at all: the companion texts for a fixed
// cabin state stay byte-identical (baseline captured before lot 3).
test('cabin companion texts are unchanged', () => {
  const env = { ...process.env }; delete env.DEADWOOD_LEVEL;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/cabin-companion-texts-baseline.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  const baseline = JSON.parse(readFileSync(new URL('./fixtures/cabin-companion-texts-baseline.json', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(result.stdout), baseline, 'cabin situation text and actions differ from the captured baseline');
});

// Over the text budget, the cabin keeps its historical trimming order (the
// latest line of the worst rank goes first): a busy state the small baseline
// above never trims (review, 24 October). The supermarket's longest-first
// rule would drop the 1,226-character crate line instead and keep PICKUPS.
test('cabin companion texts keep their trimming order over budget', () => {
  const env = { ...process.env }; delete env.DEADWOOD_LEVEL;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/cabin-companion-texts-busy.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  const { text } = JSON.parse(result.stdout);
  assert.doesNotMatch(text, /^PICKUPS:/m, 'trimmed from the latest rank-2 line: PICKUPS goes first');
  assert.match(text, /^RECENT: /m, 'the news still fits after trimming');
  const baseline = JSON.parse(readFileSync(new URL('./fixtures/cabin-companion-texts-busy.json', import.meta.url), 'utf8'));
  assert.equal(text, baseline.text, 'over-budget cabin situation text differs from the captured baseline');
});
