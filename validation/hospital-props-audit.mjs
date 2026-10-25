// Read-only audit of the hospital props inside their contract boxes, on the real GLB.
// It ports the core of the z-fight scanner used by the reviewers: faces of different
// materials that face the same way, lie within `marginal` metres of the same plane and
// overlap by more than 1 cm2 flicker when a point just in front of them is visible.
// Run: node validation/hospital-props-audit.mjs [glb] [receipt.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DECALS = new Set(['Floor_grime_shop', 'Floor_grime_cellar', 'Prop_shadow', 'Lamp_pool', 'Lamp_pool_flicker']);

export function loadGlbTriangles(path) {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binaryOffset = 20 + jsonLength, binary = bytes.subarray(binaryOffset + 8, binaryOffset + 8 + bytes.readUInt32LE(binaryOffset));
  const read = index => {
    const spec = json.accessors[index], view = json.bufferViews[spec.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[spec.type];
    const width = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[spec.componentType];
    const method = { 5126: 'readFloatLE', 5125: 'readUInt32LE', 5123: 'readUInt16LE', 5121: 'readUInt8' }[spec.componentType];
    const stride = view.byteStride ?? size * width, start = (view.byteOffset ?? 0) + (spec.byteOffset ?? 0);
    const out = new Float64Array(spec.count * size);
    for (let row = 0; row < spec.count; row++) for (let c = 0; c < size; c++) out[row * size + c] = binary[method](start + row * stride + c * width);
    return out;
  };
  // Node transforms: the hospital export bakes geometry; still honour translation/rotation/scale.
  const matrices = new Array(json.nodes.length).fill(null);
  const local = node => {
    if (node.matrix) return node.matrix.slice();
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const multiply = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  const visit = (index, parent) => { const m = parent ? multiply(parent, local(json.nodes[index])) : local(json.nodes[index]); matrices[index] = m; for (const child of json.nodes[index].children ?? []) visit(child, m); };
  for (const index of json.scenes[json.scene ?? 0].nodes) visit(index, null);
  const tris = [];
  json.nodes.forEach((node, nodeIndex) => {
    if (node.mesh === undefined || !matrices[nodeIndex]) return;
    const m = matrices[nodeIndex];
    for (const primitive of json.meshes[node.mesh].primitives) {
      const material = json.materials[primitive.material]?.name ?? '';
      const p = read(primitive.attributes.POSITION), idx = read(primitive.indices);
      const world = i => { const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2]; return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; };
      for (let k = 0; k < idx.length; k += 3) tris.push({ a: world(idx[k]), b: world(idx[k + 1]), c: world(idx[k + 2]), material });
    }
  });
  for (const t of tris) {
    const u = sub(t.b, t.a), v = sub(t.c, t.a), n = cross(u, v), length = Math.hypot(...n);
    t.area = length / 2; t.n = length > 0 ? n.map(value => value / length) : [0, 0, 0]; t.d = dot(t.n, t.a);
    t.lo = [0, 1, 2].map(i => Math.min(t.a[i], t.b[i], t.c[i])); t.hi = [0, 1, 2].map(i => Math.max(t.a[i], t.b[i], t.c[i]));
  }
  return tris;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function clip(subject, clipper) {
  // Sutherland-Hodgman, both polygons counter-clockwise in 2D.
  let output = subject;
  for (let i = 0; i < clipper.length && output.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % clipper.length], input = output; output = [];
    const inside = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-12;
    const meet = (p, q) => { const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]); const t = d1 / (d1 - d2); return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; };
    for (let k = 0; k < input.length; k++) {
      const p = input[k], q = input[(k + 1) % input.length];
      if (inside(q)) { if (!inside(p)) output.push(meet(p, q)); output.push(q); } else if (inside(p)) output.push(meet(p, q));
    }
  }
  return output;
}
const area2 = poly => poly.reduce((sum, p, i) => sum + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2;

class Grid {
  constructor(tris, cell = 1) {
    this.cell = cell; this.map = new Map(); this.tris = tris;
    tris.forEach((t, index) => {
      const lo = t.lo.map(v => Math.floor(v / cell)), hi = t.hi.map(v => Math.floor(v / cell));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const key = `${x},${y},${z}`; if (!this.map.has(key)) this.map.set(key, []); this.map.get(key).push(index);
      }
    });
  }
  near(lo, hi) {
    const out = new Set(), c = this.cell;
    for (let x = Math.floor(lo[0] / c); x <= Math.floor(hi[0] / c); x++) for (let y = Math.floor(lo[1] / c); y <= Math.floor(hi[1] / c); y++)
      for (let z = Math.floor(lo[2] / c); z <= Math.floor(hi[2] / c); z++) for (const index of this.map.get(`${x},${y},${z}`) ?? []) out.add(index);
    return out;
  }
}

function firstHit(grid, origin, direction, radius) {
  const end = origin.map((v, i) => v + direction[i] * radius);
  let best = null;
  for (const index of grid.near(origin.map((v, i) => Math.min(v, end[i])), origin.map((v, i) => Math.max(v, end[i])))) {
    const t = grid.tris[index]; if (t.area < 1e-12) continue;
    const e1 = sub(t.b, t.a), e2 = sub(t.c, t.a), p = cross(direction, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det, s = sub(origin, t.a), u = dot(s, p) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
    const q = cross(s, e1), v = dot(direction, q) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const distance = dot(e2, q) * inv;
    if (distance > 1e-5 && distance < radius && (!best || distance < best.distance)) best = { distance, back: dot(cross(e1, e2), direction) > 0 };
  }
  return best;
}

function visibility(grid, centroid, normal) {
  const a = Math.abs(normal[0]) < .9 ? [1, 0, 0] : [0, 1, 0];
  let u = cross(normal, a); const ul = Math.hypot(...u); u = u.map(v => v / ul); const v = cross(normal, u);
  const directions = [normal];
  for (const [cu, cv] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) for (const tilt of [.9, 2.75]) directions.push(normal.map((n, i) => n + tilt * (cu * u[i] + cv * v[i])));
  const origin = centroid.map((value, i) => value + .0015 * normal[i]);
  let inside = 0, blocked = 0, open = 0;
  for (const raw of directions) {
    const jitter = [raw[0] + 1.3e-4, raw[1] + 2.1e-4, raw[2] + 3.7e-4], length = Math.hypot(...jitter), direction = jitter.map(x => x / length);
    const hit = firstHit(grid, origin, direction, 2.0);
    if (hit?.back) inside++; else if (hit && hit.distance < .30) blocked++; else open++;
  }
  return { visible: open >= 3 && inside <= 4, open, inside, blocked };
}

export function coplanarSpots(tris, boxes, { tol = .0006, marginal = .0031, minArea = 1e-4, dotMin = .999, eyeLevel = 2.6 } = {}) {
  const inBox = point => boxes.find(b => point[0] >= b.minX - .02 && point[0] <= b.maxX + .02 && point[1] >= b.minY - .02 && point[1] <= b.maxY + .02 && point[2] >= b.minZ - .02 && point[2] <= b.maxZ + .02);
  const candidates = [];
  tris.forEach((t, index) => {
    if (t.area < 1e-9 || DECALS.has(t.material.replace(/^Hospital__|^Roof__/, ''))) return;
    const centroid = [0, 1, 2].map(i => (t.a[i] + t.b[i] + t.c[i]) / 3), box = inBox(centroid);
    if (box) candidates.push({ index, box: box.id });
  });
  const buckets = new Map();
  const keyOf = (n, d) => `${Math.round(n[0] * 20)},${Math.round(n[1] * 20)},${Math.round(n[2] * 20)},${Math.round(d / .005)}`;
  for (const c of candidates) { const t = tris[c.index], key = keyOf(t.n, t.d); if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(c); }
  const grid = new Grid(tris.filter(t => !DECALS.has(t.material.replace(/^Hospital__|^Roof__/, ''))), 1);
  const spots = [], seen = new Set();
  for (const c of candidates) {
    const t = tris[c.index];
    const nq = t.n.map(v => Math.round(v * 20)), dq = Math.round(t.d / .005);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dd = -1; dd <= 1; dd++) {
      for (const other of buckets.get(`${nq[0] + dx},${nq[1] + dy},${nq[2] + dz},${dq + dd}`) ?? []) {
        if (other.index <= c.index) continue;
        const s = tris[other.index];
        if (s.material === t.material || dot(t.n, s.n) < dotMin) continue;
        const axis = [0, 1, 2].reduce((best, i) => Math.abs(t.n[i]) > Math.abs(t.n[best]) ? i : best, 0);
        if (Math.abs(t.n[axis]) < .3) continue;
        const [ua, va] = [0, 1, 2].filter(i => i !== axis);
        if (Math.min(t.hi[ua], s.hi[ua]) - Math.max(t.lo[ua], s.lo[ua]) <= 1e-4 || Math.min(t.hi[va], s.hi[va]) - Math.max(t.lo[va], s.lo[va]) <= 1e-4) continue;
        let A = [t.a, t.b, t.c].map(p => [p[ua], p[va]]), B = [s.a, s.b, s.c].map(p => [p[ua], p[va]]);
        if (area2(A) < 0) A = A.reverse(); if (area2(B) < 0) B = B.reverse();
        const poly = clip(A, B), overlap = Math.abs(area2(poly)) / Math.abs(t.n[axis]);
        if (poly.length < 3 || overlap < minArea) continue;
        const points = poly.map(([pu, pv]) => { const p = [0, 0, 0]; p[ua] = pu; p[va] = pv; p[axis] = (t.d - t.n[ua] * pu - t.n[va] * pv) / t.n[axis]; return p; });
        const gap = Math.max(...points.map(p => Math.abs(dot(p, s.n) - s.d)));
        if (gap > marginal) continue;
        const centroid = [0, 1, 2].map(i => points.reduce((sum, p) => sum + p[i], 0) / points.length);
        const key = `${c.box}|${[t.material, s.material].sort().join('/')}|${centroid.map(v => Math.round(v * 20)).join(',')}`;
        if (seen.has(key)) continue; seen.add(key);
        const view = visibility(grid, centroid, gap <= 1e-9 || dot(centroid, t.n) - t.d >= dot(centroid, s.n) - s.d ? t.n : s.n);
        spots.push({ box: c.box, materials: [t.material, s.material].sort(), gapMm: Number((gap * 1000).toFixed(2)), areaCm2: Number((overlap * 1e4).toFixed(1)),
          centroid: centroid.map(v => Number(v.toFixed(3))), normal: t.n.map(v => Number(v.toFixed(3))), ...view });
      }
    }
  }
  const visible = spots.filter(spot => spot.visible);
  return {
    candidates: candidates.length, spots: spots.length,
    visibleWithinTol: visible.filter(spot => spot.gapMm <= tol * 1000),
    visibleWithinMarginalBelowEye: visible.filter(spot => spot.gapMm <= marginal * 1000 && spot.centroid[1] < eyeLevel),
    buried: spots.length - visible.length,
  };
}

export function propBoxes(LEVEL, SPACE) {
  const furniture = LEVEL.furniture.map(f => ({ id: f.id, kind: f.kind, minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ, minY: f.baseY ?? 0, maxY: (f.baseY ?? 0) + f.height }));
  const table = { id: 'table', kind: 'table', minX: LEVEL.table.minX, maxX: LEVEL.table.maxX, minZ: LEVEL.table.minZ, maxZ: LEVEL.table.maxZ, minY: 0, maxY: LEVEL.table.height };
  const props = SPACE.props.map(p => ({ id: p.id, kind: p.kind, minX: p.minX, maxX: p.maxX, minZ: p.minZ, maxZ: p.maxZ, minY: p.minY ?? 0, maxY: p.maxY }));
  return [...furniture, table, ...props];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.env.DEADWOOD_LEVEL = 'hospital';
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { LEVEL } = await import('../public/level-config.js');
  const { SPACE } = await import('../public/level-space.js');
  const glb = resolve(process.argv[2] ?? resolve(root, 'public/levels/hospital.glb'));
  const started = Date.now();
  const report = coplanarSpots(loadGlbTriangles(glb), propBoxes(LEVEL, SPACE));
  const summary = { glb, seconds: (Date.now() - started) / 1000, candidates: report.candidates, spots: report.spots, buried: report.buried,
    visibleWithin06mm: report.visibleWithinTol.length, visibleWithin3mmBelowEyeLevel: report.visibleWithinMarginalBelowEye.length };
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ ...summary, visible: report.visibleWithinMarginalBelowEye, visibleTol: report.visibleWithinTol }, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  for (const spot of [...new Set([...report.visibleWithinTol, ...report.visibleWithinMarginalBelowEye])].slice(0, 30)) console.log(JSON.stringify(spot));
}
