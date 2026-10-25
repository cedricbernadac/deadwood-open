import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Supermarket companions in the rain, fixes from the review of 24 October
// (validation/kimi-companion-rain/REPORT.md): real simulation, bodies and
// eyes on DEADWOOD_LEVEL=supermarket; no server, no brain, no model API.
const fixture = fileURLToPath(new URL('./fixtures/companion-rain-review-check.mjs', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));

function check(mode) {
  const result = spawnSync(process.execPath, [fixture, mode], {
    cwd: root, env: { ...process.env, DEADWOOD_LEVEL: 'supermarket' }, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stdout, new RegExp(`${mode} verified`));
}

test('rain repair refuses an unaffordable east-door job and prices its HP cost', () => check('repair-offer'));
test('a stale rain repair order stops before the companion goes down', () => check('repair-stale-order'));
test('rain repair with a full umbrella still finishes and reports the whole job', () => check('repair-full-umbrella'));
test('supermarket routes measure real shelter per leg and choose the dry stock stair', () => check('routes'));
test('a downed first loft companion releases the interior watch', () => check('loft-downed'));
test('an eliminated first loft companion releases the interior watch', () => check('loft-eliminated'));
test('follow text admits rain on flights and limits passage cover to humans in sight', () => check('follow-stairs'));
test('rainy engagement still checks for a bitten teammate', () => check('rainy-engagement'));
test('the supermarket loft action names the post the body takes and fits its cap', () => check('loft-text'));
