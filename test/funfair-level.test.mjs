import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
function run(script, { level = 'funfair', timeout = 120000, marker, args = [] } = {}) {
  const env = { ...process.env };
  if (level === null) delete env.DEADWOOD_LEVEL;
  else env.DEADWOOD_LEVEL = level;
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024,
  });
  const diagnostic = [
    `command: ${process.execPath} ${script} ${args.join(' ')}`,
    `level: ${level ?? 'default cabin'}, status: ${result.status}, signal: ${result.signal}`,
    result.error ? String(result.error) : '', result.stdout, result.stderr,
  ].filter(Boolean).join('\n');
  assert.equal(result.status, 0, diagnostic);
  if (marker) assert.match(result.stdout, marker, diagnostic);
  return result;
}

test('funfair contract, interaction grids, canopies, spawns and authority/prediction methods agree', () => {
  run(fixture('funfair-contract-check.mjs'), { timeout: 150000, marker: /funfair contract verified/ });
});
test('funfair real rooms enclose targets and stay reachable through boss-width door openings', () => {
  run(fixture('funfair-rooms-check.mjs'), { timeout: 180000, marker: /funfair real rooms verified/ });
});
test('funfair stairwells stay open through every runtime outdoor ground piece', () => {
  run(fixture('funfair-outdoors-check.mjs'), { timeout: 60000, marker: /funfair stairwells open through the outdoor apron verified/ });
});
test('funfair real players traverse both stairs in both directions with prediction parity', () => {
  run(fixture('funfair-player-stairs-check.mjs'), { timeout: 120000, marker: /funfair player stairs verified/ });
});
test('funfair zombies enter every exterior door, reach every room and stair hall on both floors and use both stair directions', () => {
  run(fixture('funfair-zombie-routes-check.mjs'), { timeout: 300000, marker: /funfair zombie routes verified/ });
});
test('funfair zombie navigation graphs build cold without casting every partition per corner pair', () => {
  run(fixture('funfair-navigation-cost-check.mjs'), { timeout: 60000, marker: /funfair navigation cost verified: 6 cold graphs/ });
});
test('funfair zombies pressed against every exterior prop walk round it and get inside', () => {
  run(fixture('funfair-zombie-props-check.mjs'), { timeout: 90000, marker: /funfair zombie props verified: \d+ prop starts walked at least [\d.]+ m and got inside within 40 s/ });
});
test('funfair zombies cross both stair heads past the cheek rails without a three-second stall', () => {
  run(fixture('funfair-zombie-stairs-check.mjs'), { timeout: 120000, marker: /funfair zombie stair heads verified: 56;/ });
});
test('funfair companion body buys at two racks per floor and physically uses both stairs without a brain', () => {
  run(fixture('funfair-companion-check.mjs'), { timeout: 180000, marker: /funfair companion purchases verified/ });
});
test('funfair companion room, cross-floor, rain, loft and team-plan texts include post failover', () => {
  run(fixture('funfair-companion-texts-check.mjs'), { timeout: 180000, marker: /funfair companion texts verified/ });
});
test('funfair companion orders defend every door, follow on both stairs, leave stair heads and handle heavy loadouts and loft watches', () => {
  run(fixture('funfair-companion-orders-check.mjs'), { timeout: 240000, marker: /funfair companion orders verified: doors, follow, head, heavy, loft;/ });
});
test('funfair purchases, all-door interior repair, wave progression and save round trip use real simulation', () => {
  run(fixture('funfair-gameplay-check.mjs'), { timeout: 150000, marker: /funfair gameplay verified/ });
});
test('cabin contract remains unchanged beside funfair', () => {
  run(fixture('funfair-legacy-guard-check.mjs'), { level: null, timeout: 45000, marker: /cabin legacy contract guarded beside funfair/ });
});
test('supermarket contract remains unchanged beside funfair', () => {
  run(fixture('funfair-legacy-guard-check.mjs'), { level: 'supermarket', timeout: 45000, marker: /supermarket legacy contract guarded beside funfair/ });
});
test('hospital contract remains unchanged beside funfair', () => {
  run(fixture('funfair-legacy-guard-check.mjs'), { level: 'hospital', timeout: 45000, marker: /hospital legacy contract guarded beside funfair/ });
});

test('funfair GLB passes exact contracts, contacts, coplanarity and geometry budgets', { skip: 'needs the art and audio originals, kept out of the open edition' }, (t) => {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'funfair-art-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  const receipt = join(outputDirectory, 'funfair-art-receipt.json');
  run(resolve(ROOT, 'validation/verify-funfair-art.mjs'), { timeout: 240000, args: [receipt] });
  const report = JSON.parse(readFileSync(receipt, 'utf8'));
  assert.equal(report.mapId, 'funfair');
  assert.equal(report.passed, true, `art receipt failed: ${JSON.stringify(report.checks?.filter(check => !check.passed) ?? report)}`);
  assert.match(report.glb?.path ?? '', /funfair\.glb$/);
  assert.ok(Array.isArray(report.checks) && report.checks.length > 0, 'art receipt contains executed checks');
  assert.ok(report.checks.every(check => check.passed), 'every art verifier check passed');
  assert.ok(report.checks.some(check => /contract/i.test(check.name) && check.passed), 'live-contract comparison passed');
  assert.ok(report.checks.some(check => /coplanar/i.test(check.name) && check.passed), 'coplanar scan passed');
  assert.ok(Array.isArray(report.meshContacts) && report.meshContacts.length > 0 && report.meshContacts.every(contact => contact.passed), 'all exported-mesh contact probes passed');
  assert.equal(report.coplanar?.visibleSpotCount, 0, 'no visible coplanar spots');
  const triangles = report.geometry?.triangles, drawCalls = report.geometry?.drawCalls;
  assert.ok(Number.isInteger(triangles) && triangles > 0 && triangles < 220000, `funfair triangle budget: ${triangles}`);
  assert.ok(Number.isInteger(drawCalls) && drawCalls > 0 && drawCalls <= 90, `funfair draw-call budget: ${drawCalls}`);
});

test('funfair coplanar scan flags flush faces of different materials and spares offsets above 3 mm', async () => {
  const { scanCoplanar } = await import('../validation/hospital-coplanarity.mjs');
  const box = (x0, x1, y0, y1, z0, z1, material) => {
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    return [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]
      .flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]).map(([a, b, c]) => ({ a: v[a], b: v[b], c: v[c], material, occluder: true }));
  };
  const panel = (front, back) => box(-.2, .2, .3, .7, back, front, 'Trim');
  const cube = box(-.5, .5, 0, 1, -.5, .5, 'Paint');
  const flush = scanCoplanar([...cube, ...box(-.2, .2, .3, .7, .49, .5, 'Trim')]);
  assert.ok(flush.some(spot => spot.materials.join() === 'Paint,Trim' && spot.gapMm === 0 && spot.visibleFraction >= .34),
    `flush trim is a visible spot: ${JSON.stringify(flush)}`);
  assert.equal(scanCoplanar([...cube, ...panel(.504, .49)]).filter(spot => spot.materials.join() === 'Paint,Trim').length, 0,
    'a panel standing 4 mm proud is outside the 3 mm rule');
  const close = scanCoplanar([...cube, ...panel(.502, .49)]);
  assert.ok(close.some(spot => spot.gapMm > 1.9 && spot.gapMm < 2.1), 'a 2 mm offset is inside the rule');
  const buried = scanCoplanar([...box(-2, 2, -2, 2, -2, 2, 'Concrete'), ...box(-.5, .5, -.5, .5, -.5, 0, 'Paint'), ...box(-.3, .3, -.3, .3, -.1, 0, 'Trim')]);
  assert.ok(buried.every(spot => spot.visibleFraction < .34), 'faces sealed inside a solid are not visible');
});

test('funfair low/medium/high light tiers and deterministic Blender tube fixtures agree', { skip: 'needs the art and audio originals, kept out of the open edition' }, async () => {
  const { GROUND_TUBES, CELLAR_TUBES, TUBE_Y, LAMPS, lampsFor, indoorTarget, flickerLevel, FLICKER } = await import('../public/funfair-lights.js');
  const source = readFileSync(resolve(ROOT, 'art/levels/funfair/build_funfair.py'), 'utf8');
  const SPACE = JSON.parse(readFileSync(resolve(ROOT, 'art/levels/funfair/space-contract.json'), 'utf8'));
  assert.ok(source.includes('for xi,x in enumerate([-15,-8,0,6,14]):'));
  assert.ok(source.includes('for zi,z in enumerate([-10,-4,1,9]):'));
  assert.ok(source.includes('for xi,x in enumerate([-13,-5,5,14]):'));
  assert.ok(source.includes('for zi,z in enumerate([-9,0,9]):'));
  assert.ok(source.includes("state='Fluorescent_dead' if (xi+zi)%5==1 else 'Fluorescent_flicker' if (xi,zi)==(1,2) else 'Fluorescent_aged' if zi==3 else 'Fluorescent_cold'"));
  assert.ok(source.includes("state='Fluorescent_dead' if (xi+zi)%6==2 else 'Fluorescent_flicker' if (xi,zi)==(3,2) else 'Fluorescent_cold'"));
  const ground = [-15, -8, 0, 6, 14].flatMap((x, xi) => [-10, -4, 1, 9].filter(z => !SPACE.holes.some(hole => x > hole.minX && x < hole.maxX && z > hole.minZ && z < hole.maxZ)).map((z) => {
    const zi = [-10, -4, 1, 9].indexOf(z);
    return [x, z, (xi + zi) % 5 === 1 ? 'dead' : xi === 1 && zi === 2 ? 'flicker' : zi === 3 ? 'aged' : 'on'];
  }));
  const cellar = [-13, -5, 5, 14].flatMap((x, xi) => [-9, 0, 9].map((z, zi) => [x, z, (xi + zi) % 6 === 2 ? 'dead' : xi === 3 && zi === 2 ? 'flicker' : 'on']));
  assert.deepEqual(GROUND_TUBES.map(tube => [tube.x, tube.z, tube.state]), ground);
  assert.deepEqual(CELLAR_TUBES.map(tube => [tube.x, tube.z, tube.state]), cellar);
  assert.equal(GROUND_TUBES.filter(tube => tube.state === 'flicker').length, 1, 'one ground tube really flickers');
  assert.ok(LAMPS.some(lamp => lamp.x === -8 && lamp.z === 1 && lamp.flicker), 'the ground flicker has a matching runtime light');
  assert.equal(GROUND_TUBES.length, 19);
  assert.equal(CELLAR_TUBES.length, 12);
  assert.ok(GROUND_TUBES.every(tube => tube.y === TUBE_Y.ceiling && tube.y < 3.2));
  assert.ok(CELLAR_TUBES.every(tube => tube.y === TUBE_Y.cellar && tube.y < -.24 && tube.y > -3.4));

  const low = lampsFor({ id: 'low' }), medium = lampsFor({ id: 'medium' }), high = lampsFor({ id: 'high' });
  assert.equal(low.length, 13, 'the family low tier keeps at most thirteen lights');
  assert.ok(low.length <= 13 && low.length < medium.length && medium.length < high.length);
  assert.equal(medium.length, 19);
  assert.equal(high.length, 20);
  assert.equal(LAMPS.length, high.length);
  for (const lamp of low) assert.ok(medium.includes(lamp), 'low is a subset of medium');
  for (const lamp of medium) assert.ok(high.includes(lamp), 'medium is a subset of high');
  for (const lamp of LAMPS) {
    assert.ok([lamp.x, lamp.y, lamp.z, lamp.color, lamp.intensity, lamp.range].every(Number.isFinite), `finite lamp ${JSON.stringify(lamp)}`);
    assert.ok(lamp.intensity > 0 && lamp.range > 0, 'every runtime lamp contributes light');
  }
  assert.equal(indoorTarget(null), 0);
  assert.equal(indoorTarget({ x: 0, y: 0, z: 0 }), 1);
  assert.equal(indoorTarget({ x: 6, y: -3.4, z: 9 }), 1);
  assert.equal(indoorTarget({ x: 26, y: 0, z: 20 }), 0);
  assert.equal(flickerLevel(4, true), 1, 'reduced motion disables flicker');
  for (let time = 0; time < 30; time += .17) {
    const level = flickerLevel(time);
    assert.ok(level >= FLICKER.floor && level <= 1, `bounded flicker ${time}: ${level}`);
    assert.equal(level, flickerLevel(time), 'deterministic flicker');
  }
});
