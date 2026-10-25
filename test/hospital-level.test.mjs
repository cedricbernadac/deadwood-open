import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function run(script, { level = 'hospital', timeout = 120000, marker, args = [] } = {}) {
  const env = { ...process.env };
  if (level === null) delete env.DEADWOOD_LEVEL;
  else env.DEADWOOD_LEVEL = level;
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024,
  });
  const diagnostic = [
    `command: ${process.execPath} ${script} ${args.join(' ')}`,
    `level: ${level ?? 'default cabin'}, status: ${result.status}, signal: ${result.signal}`,
    result.error ? String(result.error) : '',
    result.stdout,
    result.stderr,
  ].filter(Boolean).join('\n');
  assert.equal(result.status, 0, diagnostic);
  if (marker) assert.match(result.stdout, marker, diagnostic);
  return result;
}

test('hospital contract, interaction grids, shelters and authority/prediction methods agree', () => {
  run(fixture('hospital-contract-check.mjs'), { timeout: 150000, marker: /hospital contract verified/ });
});

test('hospital real rooms enclose targets and stay reachable through boss-width door openings', () => {
  run(fixture('hospital-rooms-check.mjs'), { timeout: 180000, marker: /hospital real rooms verified/ });
});

test('hospital stairwells stay open through the outdoor asphalt apron', () => {
  run(fixture('hospital-outdoors-check.mjs'), { timeout: 60000, marker: /hospital stairwells open through the outdoor apron verified/ });
});

test('hospital real players traverse both stairs in both directions with prediction parity', () => {
  run(fixture('hospital-player-stairs-check.mjs'), { timeout: 120000, marker: /hospital player stairs verified/ });
});

test('hospital zombies enter every exterior door, reach a player in every room on both floors and use both stair directions', () => {
  run(fixture('hospital-zombie-routes-check.mjs'), { timeout: 300000, marker: /hospital zombie routes verified/ });
});

test('hospital zombie navigation graphs build cold without casting every partition per corner pair', () => {
  run(fixture('hospital-navigation-cost-check.mjs'), { timeout: 60000, marker: /hospital navigation cost verified: 6 cold graphs/ });
});

test('hospital zombies pressed against an exterior prop walk round it and get inside', () => {
  run(fixture('hospital-zombie-props-check.mjs'), { timeout: 60000, marker: /hospital zombie props verified: \d+ prop starts walked at least [\d.]+ m and got inside within 40 s/ });
});

test('hospital zombies cross both stair heads past the cheek rails without a three-second stall', () => {
  run(fixture('hospital-zombie-stairs-check.mjs'), { timeout: 120000, marker: /hospital zombie stair heads verified: 56;/ });
});

test('hospital companion body walks and buys at two racks per floor without a brain', () => {
  run(fixture('hospital-companion-check.mjs'), { timeout: 180000, marker: /hospital companion purchases verified/ });
});

test('hospital companion eyes keep door and threat labels on their floor and name the basement post', () => {
  run(fixture('hospital-companion-texts-check.mjs'), { timeout: 120000, marker: /hospital companion texts verified/ });
});

test('hospital companion orders reach their goal on real bodies (north door post, following on the stairs, main stair head, heavy-gun time limits, basement loft post)', () => {
  run(fixture('hospital-companion-orders-check.mjs'), { timeout: 120000, marker: /hospital companion orders verified: north, follow, head, heavy, loft;/ });
});

test('hospital purchases, interior repair, wave progression and save round trip use real simulation', () => {
  run(fixture('hospital-gameplay-check.mjs'), { timeout: 150000, marker: /hospital gameplay verified/ });
});

test('cabin contract remains unchanged beside hospital', () => {
  run(fixture('hospital-legacy-guard-check.mjs'), { level: null, timeout: 45000, marker: /cabin legacy contract guarded/ });
});

test('supermarket contract remains unchanged beside hospital', () => {
  run(fixture('hospital-legacy-guard-check.mjs'), { level: 'supermarket', timeout: 45000, marker: /supermarket legacy contract guarded/ });
});

test('hospital GLB passes the real art verifier, contract checks and triangle budget', { skip: 'needs the art and audio originals, kept out of the open edition' }, (t) => {
  // A fresh receipt outside the tree: the committed one in
  // validation/kimi-hospital stays as Kimi recorded it.
  const outputDirectory = mkdtempSync(join(tmpdir(), 'hospital-art-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  const receipt = join(outputDirectory, 'hospital-art-receipt.json');
  run(resolve(ROOT, 'validation/verify-hospital-art.mjs'), {
    timeout: 240000, args: [receipt],
  });
  const report = JSON.parse(readFileSync(receipt, 'utf8'));
  assert.equal(report.mapId, 'hospital');
  assert.equal(report.passed, true, `art receipt failed: ${JSON.stringify(report.checks?.filter(check => !check.passed) ?? report)}`);
  assert.match(report.glb?.path ?? '', /hospital\.glb$/);
  assert.ok(Array.isArray(report.checks) && report.checks.length > 0, 'art receipt contains its executed checks');
  assert.ok(report.checks.every(check => check.passed), 'every art verifier check passed');
  assert.ok(report.checks.some(check => /contract/i.test(check.name) && check.passed), 'art receipt includes a passing live-contract comparison');
  const triangles = report.geometry?.triangles;
  assert.ok(Number.isInteger(triangles) && triangles > 0, `invalid triangle count: ${triangles}`);
  assert.ok(triangles < 200000, `hospital triangle budget exceeded: ${triangles} >= 200000`);
});

test('hospital coplanar scan flags flush faces of different materials and spares 3 mm offsets', async () => {
  const { scanCoplanar } = await import('../validation/hospital-coplanarity.mjs');
  // A 1 m cube (plaster) with a 40 cm panel (tile) on its +z face, 1 cm deep.
  const box = (x0, x1, y0, y1, z0, z1, material) => {
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    return [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]
      .flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]).map(([a, b, c]) => ({ a: v[a], b: v[b], c: v[c], material, occluder: true }));
  };
  const panel = (front, back) => box(-.2, .2, .3, .7, back, front, 'Tile');
  const cube = box(-.5, .5, 0, 1, -.5, .5, 'Plaster');
  // Flush: the panel's back face lies in the cube's front face plane and faces the other way
  // (never seen), but its sides cut the cube; flush FRONT faces are the failure case.
  const flush = scanCoplanar([...cube, ...box(-.2, .2, .3, .7, .49, .5, 'Tile')]);
  assert.ok(flush.some(spot => spot.materials.join() === 'Plaster,Tile' && spot.gapMm === 0 && spot.visibleFraction >= .34),
    `a tile face flush with the plaster face is a visible spot: ${JSON.stringify(flush)}`);
  const proud = scanCoplanar([...cube, ...panel(.504, .49)]);
  assert.equal(proud.filter(spot => spot.materials.join() === 'Plaster,Tile').length, 0, 'a panel standing 4 mm proud is not coplanar');
  const close = scanCoplanar([...cube, ...panel(.502, .49)]);
  assert.ok(close.some(spot => spot.gapMm > 1.9 && spot.gapMm < 2.1), 'a 2 mm offset is inside the 3 mm rule');
  // Buried: two boxes sharing a face deep inside a third solid are not visible.
  const buried = scanCoplanar([...box(-2, 2, -2, 2, -2, 2, 'Concrete'), ...box(-.5, .5, -.5, .5, -.5, 0, 'Plaster'), ...box(-.3, .3, -.3, .3, -.1, 0, 'Tile')]);
  assert.ok(buried.every(spot => spot.visibleFraction < .34), `faces sealed inside a solid are not visible: ${JSON.stringify(buried.map(spot => spot.visibleFraction))}`);
});

test('hospital runtime tubes match the deterministic Blender fixtures', { skip: 'needs the art and audio originals, kept out of the open edition' }, async () => {
  const { GROUND_TUBES, CELLAR_TUBES, TUBE_Y } = await import('../public/hospital-lights.js');
  const source = readFileSync(resolve(ROOT, 'art/levels/hospital/build_hospital.py'), 'utf8');
  assert.ok(source.includes("state = 'Fluorescent_dead' if (xi + zi) % 5 == 1 else 'Fluorescent_flicker' if (xi, zi) in [(1, 0), (3, 2)] else 'Fluorescent_aged' if zi == 3 else 'Fluorescent_cold'"));
  assert.ok(source.includes("state = 'Fluorescent_dead' if (xi + zi) % 6 == 2 else 'Fluorescent_flicker' if (xi, zi) == (3, 2) else 'Fluorescent_cold'"));
  // Ceiling luminaires since the suspended ceiling (second pass): the same grid in Blender and at runtime.
  assert.ok(source.includes('for xi, x in enumerate([-15, -8, 0, 8, 15]):'));
  assert.ok(source.includes('for zi, z in enumerate([.7, -10, -5.4, 9.4]):'));
  assert.ok(source.includes('SHAFT_TUBE_Y = 5.91; CEILING_TUBE_Y = CEIL - .0925'));
  const ground = [-15, -8, 0, 8, 15].flatMap((x, xi) => [.7, -10, -5.4, 9.4].map((z, zi) => {
    const flicker = xi === 1 && zi === 0 || xi === 3 && zi === 2;
    return [x, z, (xi + zi) % 5 === 1 ? 'dead' : flicker ? 'flicker' : zi === 3 ? 'aged' : 'on'];
  }));
  const cellar = [-12, -5, 3, 11].flatMap((x, xi) => [-10, 0, 9].map((z, zi) => [x, z,
    (xi + zi) % 6 === 2 ? 'dead' : xi === 3 && zi === 2 ? 'flicker' : 'on']));
  assert.deepEqual(GROUND_TUBES.map(tube => [tube.x, tube.z, tube.state]), ground);
  assert.deepEqual(CELLAR_TUBES.map(tube => [tube.x, tube.z, tube.state]), cellar);
  // Two tubes hang high in the stair-well shafts; every other one sits under the 3.2 m ceiling.
  // The art's snapshot of the live contract (this test runs in-process, on the default level).
  const SPACE = JSON.parse(readFileSync(resolve(ROOT, 'art/levels/hospital/space-contract.json'), 'utf8'));
  for (const tube of GROUND_TUBES) {
    const shaft = SPACE.holes.some(hole => tube.x > hole.minX && tube.x < hole.maxX && tube.z > hole.minZ && tube.z < hole.maxZ);
    assert.equal(tube.y, shaft ? TUBE_Y.shaft : TUBE_Y.ceiling, `tube ${tube.x},${tube.z} height`);
    if (!shaft) assert.ok(tube.y < SPACE.slabs.find(slab => slab.id.startsWith('ceiling-')).minY, `tube ${tube.x},${tube.z} under the ceiling`);
  }
  assert.equal(GROUND_TUBES.filter(tube => tube.y === TUBE_Y.shaft).length, 2);
});
