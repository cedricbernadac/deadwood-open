// Coplanar-face scan for a triangle soup: the core of the z-fight scanner the
// hospital reviewers ran (zfight_scan.py), ported for verify-hospital-art.mjs.
// Two triangles of different materials that face the same way (normal dot at
// least `dot`), lie within `tolerance` metres of each other's plane and overlap
// by at least `minArea` square metres flicker on screen. Overlapping pairs are
// grouped into spots (materials, plane, 0.5 m cell) and each spot is tested for
// visibility from just in front of it: nine rays (the normal and eight tilted
// ones); it is visible when at least three escape a short reach and at most
// four start inside a closed solid (their first hit is a back face).
// Triangles: { a, b, c } as [x, y, z] arrays, `material` (string) and
// `occluder` (false for alpha decals and blended glass, which hide nothing).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function polyArea(poly) {
  let area = 0;
  for (let k = 0; k < poly.length; k++) {
    const [x1, y1] = poly[k], [x2, y2] = poly[(k + 1) % poly.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}
// Sutherland-Hodgman against a convex counter-clockwise clipper.
function clip(subject, clipper) {
  let out = subject;
  for (let k = 0; k < clipper.length && out.length; k++) {
    const [ax, ay] = clipper[k], [bx, by] = clipper[(k + 1) % clipper.length], ex = bx - ax, ey = by - ay;
    const side = p => ex * (p[1] - ay) - ey * (p[0] - ax);
    const input = out; out = [];
    for (let m = 0; m < input.length; m++) {
      const cur = input[m], prev = input[(m + input.length - 1) % input.length], sc = side(cur), sp = side(prev);
      if (sc >= 0) {
        if (sp < 0) { const t = sp / (sp - sc); out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]); }
        out.push(cur);
      } else if (sp >= 0) { const t = sp / (sp - sc); out.push([prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])]); }
    }
  }
  return out;
}

// A uniform grid over the occluders, walked cell by cell along each ray.
class Occluders {
  constructor(tris, cell = .5) {
    this.cell = cell; this.tris = tris; this.cells = new Map(); this.big = [];
    tris.forEach((t, index) => {
      if (!t.occluder) return;
      const lo = [0, 1, 2].map(k => Math.floor(Math.min(t.a[k], t.b[k], t.c[k]) / cell));
      const hi = [0, 1, 2].map(k => Math.floor(Math.max(t.a[k], t.b[k], t.c[k]) / cell));
      const count = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
      if (count > 4000) { this.big.push(index); return; }
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const key = `${x},${y},${z}`; let list = this.cells.get(key); if (!list) this.cells.set(key, list = []); list.push(index);
      }
    });
    this.stamp = new Int32Array(tris.length); this.ray = 0;
  }
  hit(index, o, d, best) {
    const t = this.tris[index], e1 = sub(t.b, t.a), e2 = sub(t.c, t.a), p = cross(d, e2), det = dotv(e1, p);
    if (Math.abs(det) < 1e-14) return best;
    const inv = 1 / det, s = sub(o, t.a), u = dotv(s, p) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) return best;
    const q = cross(s, e1), v = dotv(d, q) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) return best;
    const dist = dotv(e2, q) * inv;
    if (dist <= 1e-5 || dist >= best.t) return best;
    return { t: dist, back: dotv(cross(e1, e2), d) > 0, index };
  }
  cast(o, d, radius) {
    let best = { t: radius, back: false, index: -1 };
    const ray = ++this.ray;
    for (const index of this.big) best = this.hit(index, o, d, best);
    const c = this.cell, cellOf = v => Math.floor(v / c);
    let x = cellOf(o[0]), y = cellOf(o[1]), z = cellOf(o[2]);
    const step = d.map(v => v > 0 ? 1 : v < 0 ? -1 : 0);
    const next = [0, 1, 2].map(k => d[k] === 0 ? Infinity : ((Math.floor(o[k] / c) + (d[k] > 0 ? 1 : 0)) * c - o[k]) / d[k]);
    const delta = [0, 1, 2].map(k => d[k] === 0 ? Infinity : c / Math.abs(d[k]));
    let travelled = 0;
    while (travelled <= Math.min(radius, best.t) + c) {
      const list = this.cells.get(`${x},${y},${z}`);
      if (list) for (const index of list) { if (this.stamp[index] === ray) continue; this.stamp[index] = ray; best = this.hit(index, o, d, best); }
      const k = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
      travelled = next[k]; next[k] += delta[k];
      if (k === 0) x += step[0]; else if (k === 1) y += step[1]; else z += step[2];
    }
    return best.index >= 0 ? best : null;
  }
}

function visibility(occluders, centroid, normal, eps, reach) {
  const len = Math.hypot(...normal), n = normal.map(v => v / len);
  const a = Math.abs(n[0]) < .9 ? [1, 0, 0] : [0, 1, 0];
  let u = cross(n, a); const ul = Math.hypot(...u); u = u.map(v => v / ul); const v = cross(n, u);
  const dirs = [n];
  for (const [cu, cv] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) for (const tilt of [.9, 2.75]) dirs.push([0, 1, 2].map(k => n[k] + tilt * (cu * u[k] + cv * v[k])));
  const o = centroid.map((value, k) => value + eps * n[k]);
  let inside = 0, blocked = 0;
  for (let dir of dirs) {
    dir = dir.map((value, k) => value + [1.3e-4, 2.1e-4, 3.7e-4][k]); const dl = Math.hypot(...dir); dir = dir.map(value => value / dl);
    const hit = occluders.cast(o, dir, 1) ?? occluders.cast(o, dir, 9);
    if (hit?.back) inside++; else if (hit && hit.t < reach) blocked++;
  }
  const open = dirs.length - inside - blocked;
  return { visible: open >= 3 && inside <= 4, open, inside, blocked };
}

export function scanCoplanar(triangles, { tolerance = .003, minArea = 1e-4, dot = .999, reach = .30, scan = () => true } = {}) {
  const tris = [];
  for (const t of triangles) {
    const c = cross(sub(t.b, t.a), sub(t.c, t.a)), length = Math.hypot(...c);
    if (length < 2e-9) continue;
    const n = c.map(value => value / length);
    tris.push({ ...t, n, d: dotv(n, t.a), lo: [0, 1, 2].map(k => Math.min(t.a[k], t.b[k], t.c[k])), hi: [0, 1, 2].map(k => Math.max(t.a[k], t.b[k], t.c[k])) });
  }
  const groups = new Map();
  tris.forEach((t, index) => {
    if (!scan(t)) return;
    const q = t.n.map(value => Math.round(value / .05));
    const key = ((q[0] + 21) * 43 + (q[1] + 21)) * 43 + (q[2] + 21);
    const full = key * 1e6 + (Math.floor(t.d / .002) + 5e5);
    let list = groups.get(full); if (!list) groups.set(full, list = []); list.push(index);
  });
  const pairs = [];
  const exact = (i, j, axis, ua, va) => {
    const A = tris[i], B = tris[j];
    if (A.material === B.material || dotv(A.n, B.n) < dot || Math.abs(A.n[axis]) < .3) return null;
    let P = [A.a, A.b, A.c].map(p => [p[ua], p[va]]), Q = [B.a, B.b, B.c].map(p => [p[ua], p[va]]);
    if (polyArea(P) < 0) P = P.reverse(); if (polyArea(Q) < 0) Q = Q.reverse();
    const poly = clip(P, Q); if (poly.length < 3) return null;
    const area = polyArea(poly) / Math.abs(A.n[axis]); if (area < minArea) return null;
    const points = poly.map(([pu, pv]) => { const p = [0, 0, 0]; p[ua] = pu; p[va] = pv; p[axis] = (A.d - A.n[ua] * pu - A.n[va] * pv) / A.n[axis]; return p; });
    const gap = Math.max(...points.map(p => Math.abs(dotv(p, B.n) - B.d)));
    if (gap > tolerance) return null;
    const centroid = [0, 1, 2].map(k => points.reduce((sum, p) => sum + p[k], 0) / points.length);
    return { i, j, area, gap, centroid, lo: [0, 1, 2].map(k => Math.min(...points.map(p => p[k]))), hi: [0, 1, 2].map(k => Math.max(...points.map(p => p[k]))) };
  };
  for (const [key, A] of groups) {
    const nk = Math.floor(key / 1e6), dk = key - nk * 1e6 - 5e5;
    const nz = nk % 43 - 21, ny = Math.floor(nk / 43) % 43 - 21, nx = Math.floor(nk / 1849) - 21;
    const axis = [Math.abs(nx), Math.abs(ny), Math.abs(nz)].indexOf(Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)));
    const [ua, va] = [0, 1, 2].filter(k => k !== axis);
    for (let ddx = -1; ddx <= 1; ddx++) for (let ddy = -1; ddy <= 1; ddy++) for (let ddz = -1; ddz <= 1; ddz++) for (let ddd = -2; ddd <= 2; ddd++) {
      const key2 = (((nx + ddx + 21) * 43 + (ny + ddy + 21)) * 43 + (nz + ddz + 21)) * 1e6 + (dk + ddd + 5e5);
      if (key2 < key) continue;
      const B = groups.get(key2); if (!B) continue;
      const same = key2 === key;
      // A 1 m grid over B's in-plane boxes keeps big planes (floors, walls) from going quadratic.
      const grid = new Map();
      B.forEach(j => {
        const t = tris[j];
        for (let gu = Math.floor(t.lo[ua]); gu <= Math.floor(t.hi[ua]); gu++) for (let gv = Math.floor(t.lo[va]); gv <= Math.floor(t.hi[va]); gv++) {
          const g = gu * 100003 + gv; let list = grid.get(g); if (!list) grid.set(g, list = []); list.push(j);
        }
      });
      for (const i of A) {
        const a = tris[i], seen = new Set();
        for (let gu = Math.floor(a.lo[ua]); gu <= Math.floor(a.hi[ua]); gu++) for (let gv = Math.floor(a.lo[va]); gv <= Math.floor(a.hi[va]); gv++) {
          for (const j of grid.get(gu * 100003 + gv) ?? []) {
            if (seen.has(j) || (same && j <= i)) continue; seen.add(j);
            const b = tris[j];
            if (a.material === b.material) continue;
            const ou = Math.min(a.hi[ua], b.hi[ua]) - Math.max(a.lo[ua], b.lo[ua]), ov = Math.min(a.hi[va], b.hi[va]) - Math.max(a.lo[va], b.lo[va]);
            const ow = Math.min(a.hi[axis], b.hi[axis]) - Math.max(a.lo[axis], b.lo[axis]);
            if (ou <= 1e-4 || ov <= 1e-4 || ou * ov <= minArea * .5 || ow <= -tolerance - 1e-4) continue;
            const pair = exact(i, j, axis, ua, va); if (pair) pairs.push(pair);
          }
        }
      }
    }
  }
  // Spots: same two materials, same plane, same 0.5 m cell.
  const spots = new Map();
  for (const pair of pairs) {
    const A = tris[pair.i], B = tris[pair.j], materials = [A.material, B.material].sort();
    const key = [materials.join('|'), A.n.map(v => Math.round(v * 100)).join(','), Math.round(A.d / .004), pair.centroid.map(v => Math.floor(v / .5)).join(',')].join('#');
    let spot = spots.get(key);
    if (!spot) spots.set(key, spot = { materials, normal: A.n, pairs: [] });
    spot.pairs.push(pair);
  }
  const occluders = new Occluders(tris);
  return [...spots.values()].map(spot => {
    const ranked = spot.pairs.sort((p, q) => q.area - p.area), samples = ranked.slice(0, 3);
    const vis = samples.map(pair => visibility(occluders, pair.centroid, tris[pair.i].n, pair.gap + .0015, reach));
    const best = ranked[0];
    return { materials: spot.materials, normal: spot.normal.map(v => Number(v.toFixed(4))), pairs: ranked.length,
      areaCm2: Number((ranked.reduce((sum, pair) => sum + pair.area, 0) * 1e4).toFixed(1)), gapMm: Number((Math.max(...ranked.map(pair => pair.gap)) * 1000).toFixed(2)),
      lo: [0, 1, 2].map(k => Number(Math.min(...ranked.map(pair => pair.lo[k])).toFixed(3))), hi: [0, 1, 2].map(k => Number(Math.max(...ranked.map(pair => pair.hi[k])).toFixed(3))),
      visibleFraction: vis.filter(item => item.visible).length / vis.length,
      triangles: [tris[best.i], tris[best.j]].map(t => ({ material: t.material, lo: t.lo, hi: t.hi })) };
  });
}
