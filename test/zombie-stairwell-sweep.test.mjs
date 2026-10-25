import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/zombie-stairwell-sweep-check.mjs', import.meta.url));

// Sampled stairwell sweep, one child per map, all three at once: every flight,
// every body, the upper floor, the flight and the lower floor, plus the
// former stalls. SWEEP_MODE=full on the fixture runs the whole grid.
function sweep(level) {
  const env = { ...process.env, DEADWOOD_LEVEL: level };
  for (const key of ['SWEEP_MODE', 'SWEEP_SHARD', 'SWEEP_OUT', 'SWEEP_TARGETS']) delete env[key];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture], { cwd, env });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), 170000);
    child.on('error', reject);
    child.on('close', status => { clearTimeout(timer); resolve({ level, status, stdout, stderr }); });
  });
}

test('supermarket, hospital and funfair zombies never stall around a stairwell', { timeout: 180000 }, async () => {
  for (const result of await Promise.all(['supermarket', 'hospital', 'funfair'].map(sweep))) {
    assert.equal(result.status, 0, `${result.level}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`${result.level} zombie stairwell sweep verified: \\d+ routes, 0 stalls`));
    const summary = JSON.parse(result.stdout.split('\n')[0]);
    assert.deepEqual([summary.flights, summary.bodies, summary.floors], [2, 5, 3]);
    assert.ok(summary.scenarios >= 190, `${result.level} sampled ${summary.scenarios} routes`);
  }
});
