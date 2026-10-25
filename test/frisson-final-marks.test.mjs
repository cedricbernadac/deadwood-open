import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { importPublicModule } from './helpers/public-modules.mjs';

// The head marks on the final heads (art/frisson/DESIGN.md): casting every
// family on the 25 heads took 0.45 s of the room's loading, the main thread
// busy. marks.js now sorts each head's triangles into a tree of boxes, with
// the very same hits, and heads.js casts only the pairs a zombie can wear.
// Both final files: heads.glb (Frisson) and heads-b.glb (Frisson léger).
const zombies = await importPublicModule('zombies.js');
const heads = await importPublicModule('frisson/heads.js');
const marks = await importPublicModule('frisson/marks.js');
const { readGlb } = await importPublicModule('frisson/glb.js');
const { ENEMY_APPEARANCES } = await import('../public/enemies.js');
const FINAL = ['heads.glb', 'heads-b.glb'].map(name => {
  const bytes = readFileSync(new URL(`../public/frisson/${name}`, import.meta.url)), parsed = heads.headsFromGlb(readGlb(bytes));
  return { name, bytes, parsed, everyHead: [...parsed.variants, parsed.boss] };
});

// The cast as it was, every triangle tested (marks.js before the tree):
// triangles as [v0, e1, e2] in 32-bit floats, Möller–Trumbore, either side.
const REACH = .6; // marks.js: rays start this far out
function flat(geometry) {
  const position = geometry.attributes.position, index = geometry.index, count = index.count / 3, out = new Float32Array(count * 9);
  for (let face = 0; face < count; face++) {
    const [a, b, c] = [0, 1, 2].map(k => index.getX(face * 3 + k)), o = face * 9, ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
    out.set([ax, ay, az, position.getX(b) - ax, position.getY(b) - ay, position.getZ(b) - az, position.getX(c) - ax, position.getY(c) - ay, position.getZ(c) - az], o);
  }
  return out;
}
function everyTriangle(tris, ox, oy, oz, dx, dy, dz, far) {
  let best = far;
  for (let o = 0; o < tris.length; o += 9) {
    const e1x = tris[o + 3], e1y = tris[o + 4], e1z = tris[o + 5], e2x = tris[o + 6], e2y = tris[o + 7], e2z = tris[o + 8];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) continue;
    const inv = 1 / det, tx = ox - tris[o], ty = oy - tris[o + 1], tz = oz - tris[o + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-9 && t < best) best = t;
  }
  return best < far ? best : Infinity;
}
function referenceHit({ skin, detail }, ray) {
  const s = everyTriangle(skin, ...ray, REACH), d = everyTriangle(detail, ...ray, REACH);
  return d < s && (s === Infinity || s - d <= marks.HAIR) ? d : s;
}

for (const { name, everyHead } of FINAL) test(`${name}: the tree of boxes gives every ray of every mark exactly the hit of testing every triangle`, () => {
  let rays = 0, hits = 0;
  for (const head of everyHead) {
    const surface = marks.headSurface(head), reference = { skin: flat(head.skin), detail: flat(head.detail) };
    const check = ray => {
      const mine = marks.surfaceHit(surface, ...ray), theirs = referenceHit(reference, ray);
      assert.ok(Object.is(mine, theirs), `${head.name}: ray ${ray.map(value => value.toFixed(3))} hits at ${mine}, every triangle says ${theirs}`);
      rays++; if (Number.isFinite(mine)) hits++;
    };
    // The rays each family's shells cast (marks.js shell: u across, v up).
    for (const marker of Object.keys(marks.HEAD_MARKS)) {
      const spec = marks.HEAD_MARKS[marker](surface);
      for (const piece of [...(spec.accent ?? []), ...(spec.cloth ?? [])]) {
        for (let v = 0; v <= piece.nv; v++) for (let u = 0; u < (piece.closed ? piece.nu : piece.nu + 1); u++) check(piece.ray(u / piece.nu, v / piece.nv));
      }
    }
    // And rays from every side, at the centre and past it, some grazing.
    for (let index = 0; index < 400; index++) {
      const azimuth = index * 2.399963, elevation = Math.asin(((index * 37) % 400) / 200 - 1), aim = [Math.sin(index) * .08, Math.cos(index * 1.7) * .08, Math.sin(index * .3) * .08];
      const origin = [Math.sin(azimuth) * Math.cos(elevation) * REACH, Math.sin(elevation) * REACH, -Math.cos(azimuth) * Math.cos(elevation) * REACH];
      const direction = new THREE.Vector3(aim[0] - origin[0], aim[1] - origin[1], aim[2] - origin[2]).normalize();
      check([...origin, direction.x, direction.y, direction.z]);
    }
    // Axis-parallel rays (a zero direction component), through vertices too.
    const position = head.skin.attributes.position;
    for (let index = 0; index < position.count; index += 37) {
      const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
      check([x, y, -REACH, 0, 0, 1]); check([REACH, y, z, -1, 0, 0]); check([x, REACH, z, 0, -1, 0]);
    }
  }
  assert.ok(rays > 25_000 && hits > rays / 2, `${rays} rays, ${hits} hits`);
});

test('a lopsided head (a deep tree of boxes) still gives the hits of testing every triangle', () => {
  // Upright triangles bunched ever closer toward x 0, each 2^(1/8) nearer:
  // every split across the middle peels off about eight, so the tree runs
  // 73 levels deep (the final heads: 14 at most), and rays along +x walk
  // down all of it first.
  const positions = [], indices = [];
  for (let index = 0; index < 600; index++) {
    const x = .2 * 2 ** (-index / 8), base = positions.length / 3;
    positions.push(x, 0, -.1, x, .02, -.12, x, .02, -.08);
    indices.push(base, base + 1, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  const eyes = new THREE.BufferGeometry(); eyes.setAttribute('position', new THREE.Float32BufferAttribute([-.05, 0, -.18, .05, .02, -.18, 0, .01, -.19], 3));
  const empty = new THREE.BufferGeometry(); empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3)); empty.setIndex([]);
  const surface = marks.headSurface({ skin: geometry, detail: empty, eyes, top: .2 }), reference = { skin: flat(geometry), detail: flat(empty) };
  let hits = 0;
  for (let index = 0; index < 300; index++) {
    const y = .012 + (index % 7) * .001, z = -.1 + (index % 5 - 2) * .002, start = index % 3 ? .1 - REACH : .2 * 2 ** (-(index % 600) / 8) * 1.01;
    const ray = [start, y, z, 1, 0, 0];
    const mine = marks.surfaceHit(surface, ...ray), theirs = referenceHit(reference, ray);
    assert.ok(Object.is(mine, theirs), `ray ${index}: ${mine} against ${theirs}`);
    if (Number.isFinite(mine)) hits++;
  }
  assert.ok(hits > 250, `${hits} hits`);
});

for (const { name, bytes, parsed } of FINAL) test(`${name}: the marks cast while the room loads are the pairs a zombie can wear: the crown on the boss head, the other families on the others`, async t => {
  const style = heads.createHeadsStyle(parsed), markers = Object.keys(marks.HEAD_MARKS);
  const started = performance.now(), cast = style.prepare(), took = performance.now() - started;
  assert.equal(heads.BOSS_MARKER, 'crown');
  assert.equal(cast, parsed.variants.length * (markers.length - 1) + 1, 'every ordinary head x 7 families, and the boss head\'s crown');
  assert.equal(cast, { 'heads.glb': 169, 'heads-b.glb': 176 }[name], '24 heads (25 B heads) x 7 families, and the crown');
  assert.equal(style.prepare(), 0, 'nothing left');
  t.diagnostic(`${cast} marks cast in ${took.toFixed(0)} ms (Node; every family on every head, testing every triangle: 200 in about 440 ms)`);
  // Every zombie the game makes wears one of those pairs, so none is cast at
  // a first spawn: every kind, every family, and the overlord.
  const handle = await heads.install({ fetchAsset: async () => bytes });
  try {
    const worn = new Set();
    const casts = [...['walker', 'runner', 'armored', 'crawler', 'brute'].flatMap(kind => ENEMY_APPEARANCES.map(family => [kind, false, Number.isFinite(family.ceiling) ? family.ceiling : 6000])), ['brute', true, 6000]];
    for (const [kind, boss, hp] of casts) for (let serial = 0; serial < 40; serial++) {
      const model = zombies.createZombie(kind, boss, hp, `z${serial}`), name = model.userData.head.children[0].userData.headVariant;
      const marker = model.userData.appearanceId && ENEMY_APPEARANCES.find(family => family.id === model.userData.appearanceId)?.marker;
      worn.add(`${name} ${boss ? 'crown' : marker}`);
    }
    for (const pair of worn) {
      const [name, marker] = pair.split(' ');
      if (!markers.includes(marker)) continue;
      assert.equal(name === 'Boss', marker === 'crown', `${pair}: the crown on the boss head only, and the boss head with the crown only`);
    }
    assert.ok(worn.has('Boss crown') && [...worn].some(pair => pair.endsWith(' cage')) && [...worn].some(pair => pair.endsWith(' wrap')));
  } finally { handle.uninstall(); }
});
