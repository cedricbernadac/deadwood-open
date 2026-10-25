// Frisson part: health marks fitted to each Blender head (art/frisson/
// DESIGN.md). The storybook marks of zombies.js markZombie are placed for
// its round skulls (a face plane at z -.2, a skull of radius .2); on the
// Blender heads they float off the hollow cheeks or sink into the brows. The
// same marks (the family's toughness cue: its accent and cloth colours, at
// the same places) are cast here onto each head's own surface, once per head
// variant and family: thin shells that follow the skin, or the hair or a
// bandage lying on it, LIFT out and EMBED in. Shared geometry, freed with the
// style: in the game heads.js casts the families each head can wear while
// the room loads (0.08 s for the final 25 heads), elsewhere each is cast on
// first use.
import * as THREE from '/vendor/three.module.js';

export const LIFT = .006;    // a mark stands this far out of the head...
export const EMBED = .004;   // ...and goes this far into it, so no seam shows
// A hair cap, a bandage or a beard within HAIR of the skin carries the mark;
// strands, spikes and veils farther out pass through it.
export const HAIR = .03;
// A sample sunk deeper than BRIDGE below both neighbours (a mouth, a nostril,
// a socket) is lifted to their mean: marks span holes as a strap would.
export const BRIDGE = .015;
// A cell whose corners lie further apart in depth than CLIFF straddles an
// edge (a veil, a strand, the hairline): it is left out, never stretched.
export const CLIFF = .03;
const REACH = .6;            // rays start this far out, outside any head

// --- The head's surface ---------------------------------------------------------
// Triangles as [v0, e1, e2] (9 floats each), ready for Möller–Trumbore,
// sorted into a tree of boxes (LEAF triangles at most per leaf): a ray only
// tests the triangles of the boxes it crosses before its nearest hit so far.
// The very same hits as testing every triangle (test frisson-final-marks),
// several times faster: testing them all, every family on the 25 final
// heads held the room's loading 0.45 s.
const LEAF = 8;
// Boxes grow by PAD, far beyond rounding, so a box never hides a hit.
const PAD = 1e-6;
function triangles(geometry) {
  const position = geometry.attributes.position, index = geometry.index;
  const count = (index ? index.count : position.count) / 3, flat = new Float32Array(count * 9);
  const at = corner => (index ? index.getX(corner) : corner);
  for (let face = 0; face < count; face++) {
    const a = at(face * 3), b = at(face * 3 + 1), c = at(face * 3 + 2), o = face * 9;
    const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
    flat[o] = ax; flat[o + 1] = ay; flat[o + 2] = az;
    flat[o + 3] = position.getX(b) - ax; flat[o + 4] = position.getY(b) - ay; flat[o + 5] = position.getZ(b) - az;
    flat[o + 6] = position.getX(c) - ax; flat[o + 7] = position.getY(c) - ay; flat[o + 8] = position.getZ(c) - az;
  }
  // Each triangle's box (from the stored corners) and centre.
  const boxes = new Float64Array(count * 6), centres = new Float64Array(count * 3);
  for (let face = 0; face < count; face++) for (let axis = 0; axis < 3; axis++) {
    const o = face * 9, a = flat[o + axis], b = a + flat[o + 3 + axis], c = a + flat[o + 6 + axis];
    boxes[face * 6 + axis] = Math.min(a, b, c); boxes[face * 6 + 3 + axis] = Math.max(a, b, c);
    centres[face * 3 + axis] = (a + b + c) / 3;
  }
  // Split across the middle of the longest side of the centres' spread (in
  // two equal counts when they all fall on one side). Nodes are laid out
  // depth first: a node's first half follows it, `right` is the other.
  const order = new Int32Array(count).map((_, face) => face), most = Math.max(1, 2 * count);
  const bounds = new Float64Array(most * 6), right = new Int32Array(most), first = new Int32Array(most), size = new Int32Array(most), split = new Uint8Array(most);
  let nodes = 0;
  const build = (start, end) => {
    const node = nodes++, b = node * 6;
    let lowX = Infinity, lowY = Infinity, lowZ = Infinity, highX = -Infinity, highY = -Infinity, highZ = -Infinity;
    let fromX = Infinity, fromY = Infinity, fromZ = Infinity, toX = -Infinity, toY = -Infinity, toZ = -Infinity;
    for (let k = start; k < end; k++) {
      const box = order[k] * 6, centre = order[k] * 3;
      lowX = Math.min(lowX, boxes[box]); lowY = Math.min(lowY, boxes[box + 1]); lowZ = Math.min(lowZ, boxes[box + 2]);
      highX = Math.max(highX, boxes[box + 3]); highY = Math.max(highY, boxes[box + 4]); highZ = Math.max(highZ, boxes[box + 5]);
      fromX = Math.min(fromX, centres[centre]); fromY = Math.min(fromY, centres[centre + 1]); fromZ = Math.min(fromZ, centres[centre + 2]);
      toX = Math.max(toX, centres[centre]); toY = Math.max(toY, centres[centre + 1]); toZ = Math.max(toZ, centres[centre + 2]);
    }
    bounds.set([lowX - PAD, lowY - PAD, lowZ - PAD, highX + PAD, highY + PAD, highZ + PAD], b);
    first[node] = start; size[node] = end - start;
    if (end - start <= LEAF) return node;
    const spread = [toX - fromX, toY - fromY, toZ - fromZ], axis = spread[1] > spread[0] ? (spread[2] > spread[1] ? 2 : 1) : spread[2] > spread[0] ? 2 : 0;
    const cut = ([fromX, fromY, fromZ][axis] + [toX, toY, toZ][axis]) / 2;
    let middle = start;
    for (let k = start; k < end; k++) if (centres[order[k] * 3 + axis] < cut) { const face = order[k]; order[k] = order[middle]; order[middle++] = face; }
    if (middle === start || middle === end) middle = (start + end) >> 1;
    size[node] = 0; split[node] = axis;
    build(start, middle);
    right[node] = build(middle, end);
    return node;
  };
  if (count) build(0, count);
  const tris = new Float32Array(count * 9);
  order.forEach((face, k) => tris.set(flat.subarray(face * 9, face * 9 + 9), k * 9));
  return { tris, bounds: bounds.slice(0, nodes * 6), right: right.slice(0, nodes), first: first.slice(0, nodes), size: size.slice(0, nodes), split: split.slice(0, nodes) };
}
// The nodes still to visit (it grows to the deepest tree's depth).
const stack = [];
// Narrows span, the stretch of the ray still in play (near to out), to a
// box's slab on one axis (low..high); false once nothing is left.
const span = { near: 0, out: 0 };
function slab(o, d, low, high) {
  if (d === 0) return o >= low && o <= high;
  const t0 = (low - o) / d, t1 = (high - o) / d;
  if (t0 < t1) { if (t0 > span.near) span.near = t0; if (t1 < span.out) span.out = t1; }
  else { if (t1 > span.near) span.near = t1; if (t0 < span.out) span.out = t0; }
  return span.near <= span.out;
}
// Distance along the ray to the nearest triangle (either side) closer than
// `far`, or Infinity.
function firstHit({ tris, bounds, right, first, size, split }, ox, oy, oz, dx, dy, dz, far) {
  let best = far;
  if (!size.length) return Infinity;
  let top = 0;
  stack[top++] = 0;
  while (top) {
    const node = stack[--top], b = node * 6;
    // The ray's stretch inside the node's box, from 0 to the best hit so far.
    span.near = 0; span.out = best;
    if (!slab(ox, dx, bounds[b], bounds[b + 3]) || !slab(oy, dy, bounds[b + 1], bounds[b + 4]) || !slab(oz, dz, bounds[b + 2], bounds[b + 5])) continue;
    if (size[node]) {
      for (let o = first[node] * 9, end = (first[node] + size[node]) * 9; o < end; o += 9) {
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
      continue;
    }
    // The nearer half first: its hits rule the farther one out sooner.
    const axis = split[node], toward = axis === 0 ? dx : axis === 1 ? dy : dz;
    if (toward < 0) { stack[top++] = node + 1; stack[top++] = right[node]; }
    else { stack[top++] = right[node]; stack[top++] = node + 1; }
  }
  return best < far ? best : Infinity;
}

// What a mark rests on, measured once per head variant: its surface (Skin
// and Detail, never the eye beads), the eyes and the whole head's top.
export function headSurface({ skin, detail, eyes, top }) {
  eyes.computeBoundingBox();
  const box = eyes.boundingBox, position = eyes.attributes.position;
  // The eyes' outer edge as seen from the face axis, over every bead point:
  // deep-set eyes reach their widest behind their front.
  let azimuth = 0;
  for (let index = 0; index < position.count; index++) azimuth = Math.max(azimuth, Math.atan2(Math.abs(position.getX(index)), FACE_AXIS - position.getZ(index)));
  return {
    skin: triangles(skin), detail: triangles(detail), top,
    eyes: { outer: Math.max(-box.min.x, box.max.x), bottom: box.min.y, top: box.max.y, y: (box.min.y + box.max.y) / 2, front: box.min.z, azimuth },
  };
}
// The visible surface along a ray coming from outside, on its own side of
// the head (rays are aimed at an axis or the centre, REACH away): the skin,
// or Detail lying on it within HAIR or covering a hole in it (some heads
// have no skin under their hair). Infinity: a miss.
export function surfaceHit(surface, ox, oy, oz, dx, dy, dz) {
  const skin = firstHit(surface.skin, ox, oy, oz, dx, dy, dz, REACH), detail = firstHit(surface.detail, ox, oy, oz, dx, dy, dz, REACH);
  return detail < skin && (skin === Infinity || skin - detail <= HAIR) ? detail : skin;
}

// --- Shells --------------------------------------------------------------------------
// A grid of rays (u in 0..nu, v in 0..nv) cast at the head; ray(u, v) gives
// [ox, oy, oz, dx, dy, dz] with a unit direction toward the head. Each hit
// becomes an outer point LIFT back toward the ray's origin and an inner one
// EMBED past the surface; the outer faces and the open edges' walls go into
// `out` (a flat list of triangle corners). closed: u wraps round (a band).
function shell(out, surface, { nu, nv, ray, closed = false, lift = LIFT, embed = EMBED }) {
  const columns = closed ? nu : nu + 1, rows = nv + 1, grid = [];
  for (let v = 0; v < rows; v++) for (let u = 0; u < columns; u++) {
    const r = ray(u / nu, v / nv), t = surfaceHit(surface, ...r);
    grid.push(Number.isFinite(t) ? { r, t } : null);
  }
  const at = (u, v) => (v < 0 || v >= rows ? null : closed ? grid[v * columns + ((u % columns) + columns) % columns] : u < 0 || u >= columns ? null : grid[v * columns + u]);
  // A band goes all the way round: a sample missing, or off the median of
  // its row's neighbours by more than CLIFF (a spike, a strand), takes that
  // median.
  if (closed) for (let v = 0; v < rows; v++) {
    const depths = Array.from({ length: columns }, (_, u) => at(u, v)?.t);
    for (let u = 0; u < columns; u++) {
      const near = [-2, -1, 1, 2].map(du => depths[(u + du + columns) % columns]).filter(Number.isFinite).sort((a, b) => a - b);
      if (!near.length) continue;
      const median = (near[(near.length - 1) >> 1] + near[near.length >> 1]) / 2;
      if (!Number.isFinite(depths[u])) grid[v * columns + u] = { r: ray(u / nu, v / nv), t: median };
      else if (Math.abs(depths[u] - median) > CLIFF) grid[v * columns + u].t = median;
    }
  }
  // Holes (a mouth, a socket) are spanned, along u then v.
  for (const [du, dv] of [[1, 0], [0, 1]]) for (let v = 0; v < rows; v++) for (let u = 0; u < columns; u++) {
    const point = at(u, v), before = at(u - du, v - dv), after = at(u + du, v + dv);
    if (point && before && after && point.t > Math.max(before.t, after.t) + BRIDGE) point.t = (before.t + after.t) / 2;
  }
  const place = (point, depth) => { const [ox, oy, oz, dx, dy, dz] = point.r; return [ox + dx * depth, oy + dy * depth, oz + dz * depth]; };
  const outer = point => place(point, point.t - lift), inner = point => place(point, point.t + embed);
  const valid = (u, v) => {
    if (v < 0 || v >= nv || (!closed && (u < 0 || u >= nu))) return false;
    const corners = [at(u, v), at(u + 1, v), at(u + 1, v + 1), at(u, v + 1)];
    if (!corners.every(Boolean)) return false;
    // A band is whole once its rows are mended; up a dome its rows may
    // rightly lie at quite different depths.
    if (closed) return true;
    const depths = corners.map(point => point.t);
    return Math.max(...depths) - Math.min(...depths) <= CLIFF;
  };
  for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
    if (!valid(u, v)) continue;
    const corners = [at(u, v), at(u + 1, v), at(u + 1, v + 1), at(u, v + 1)];
    // Outward: back along the mean ray.
    const away = [0, 1, 2].map(axis => -corners.reduce((sum, point) => sum + point.r[3 + axis], 0));
    const [a, b, c, d] = corners.map(outer);
    face(out, a, b, c, away); face(out, a, c, d, away);
    // Walls on the edges no valid cell continues.
    const centre = [0, 1, 2].map(axis => (a[axis] + b[axis] + c[axis] + d[axis]) / 4);
    for (const [p, q, du, dv] of [[0, 1, 0, -1], [1, 2, 1, 0], [2, 3, 0, 1], [3, 0, -1, 0]]) {
      if (valid(u + du, v + dv)) continue;
      const pOut = outer(corners[p]), qOut = outer(corners[q]), pIn = inner(corners[p]), qIn = inner(corners[q]);
      const side = [0, 1, 2].map(axis => (pOut[axis] + qOut[axis]) / 2 - centre[axis]);
      face(out, pOut, qOut, qIn, side); face(out, pOut, qIn, pIn, side);
    }
  }
  return grid;
}
// One triangle, wound so that its normal points along `toward`.
function face(out, a, b, c, toward) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * toward[0] + ny * toward[1] + nz * toward[2] < 0) out.push(a, c, b); else out.push(a, b, c);
}
// A small spike (a crown point): an n-sided cone from `base` along `axis`.
function spike(out, base, axis, radius, height, sides = 5) {
  const [ax, ay, az] = axis, side = Math.abs(ay) < .9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize(cross(axis, side)), e2 = cross(axis, e1), tip = [base[0] + ax * height, base[1] + ay * height, base[2] + az * height];
  const rim = Array.from({ length: sides }, (_, index) => {
    const angle = index / sides * Math.PI * 2, c = Math.cos(angle) * radius, s = Math.sin(angle) * radius;
    return [base[0] + e1[0] * c + e2[0] * s - ax * EMBED * 2, base[1] + e1[1] * c + e2[1] * s - ay * EMBED * 2, base[2] + e1[2] * c + e2[2] * s - az * EMBED * 2];
  });
  rim.forEach((point, index) => {
    const next = rim[(index + 1) % sides], mid = [(point[0] + next[0]) / 2 - base[0], (point[1] + next[1]) / 2 - base[1], (point[2] + next[2]) / 2 - base[2]];
    face(out, point, next, tip, mid);
  });
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = v => { const length = Math.hypot(...v) || 1; return v.map(value => value / length); };

// --- Rays --------------------------------------------------------------------------------
// Azimuth 0 faces the zombie's front (-Z), +90° its right (+X).
const DEG = Math.PI / 180;
// Horizontally at a vertical axis (the head's, or one at z behind the face
// so rays meet the cheeks and temples square on), at height y, azimuth a.
const axial = (a, y, z = 0) => { const s = Math.sin(a), c = Math.cos(a); return [s * REACH, y, z - c * REACH, -s, 0, c]; };
// Face marks are cast from an axis this far behind the head centre.
const FACE_AXIS = .05;
// At the head centre from azimuth a and elevation e.
const radial = (a, e) => { const s = Math.sin(a), c = Math.cos(a), h = Math.cos(e), y = Math.sin(e); return [s * h * REACH, y * REACH, -c * h * REACH, -s * h, -y, c * h]; };
const lerp = (from, to, t) => from + (to - from) * t;
// The azimuth of the eyes' outer edge seen from the face axis: face marks
// beside the eyes start past it, so the glow is never covered.
const eyeAzimuth = eyes => eyes.azimuth ?? Math.atan2(eyes.outer, FACE_AXIS - eyes.front);
// The highest height, from the top down to the brows, where the head's mean
// radius is still 85 % of its widest: a crown sits there, not up the dome.
function crownHeight(surface) {
  const low = surface.eyes.top + .05, radii = [];
  for (let y = surface.top - .01; y >= low; y -= .005) {
    const found = [];
    for (let index = 0; index < 12; index++) { const t = surfaceHit(surface, ...axial(index * 30 * DEG, y)); if (Number.isFinite(t)) found.push(REACH - t); }
    radii.push([y, found.length >= 6 ? found.reduce((sum, r) => sum + r, 0) / found.length : 0]);
  }
  const widest = Math.max(0, ...radii.map(([, r]) => r));
  return radii.find(([, r]) => r >= .85 * widest)?.[0] ?? low;
}

// --- The marks -------------------------------------------------------------------------------
// Each family mark of markZombie, as shells on this head: { accent, cloth },
// lists of shells. Heights follow the eyes (the storybook skull's eyes sit
// at .028, its marks are placed from there) and the head's own top.
export const HEAD_MARKS = Object.freeze({
  // A bandage wrapped round the brow, above the eyes.
  wrap: ({ eyes, top }) => {
    const y = Math.min(eyes.top + .075, top - .05);
    return { accent: [{ nu: 40, nv: 2, closed: true, ray: (u, v) => axial(u * 360 * DEG, lerp(y - .0225, y + .0225, v)) }] };
  },
  // A rag knotted on the crown, toward the right side.
  scarf: () => ({ cloth: [{ nu: 7, nv: 5, ray: (u, v) => radial(lerp(50, 125, u) * DEG, lerp(42, 74, v) * DEG) }] }),
  // A strap down the left cheek, beside the eye, leaning in at the top.
  straps: ({ eyes }) => {
    const beside = eyeAzimuth(eyes) + 2 * DEG, low = eyes.bottom - .09, high = eyes.top + .06;
    return { accent: [{ nu: 3, nv: 12, ray: (u, v) => axial(-(beside + lerp(10, 0, u) * DEG) + lerp(-4, 4, v) * DEG, lerp(low, high, v), FACE_AXIS) }] };
  },
  // A hood over the back and the sides of the head.
  cowl: () => ({ cloth: [{ nu: 14, nv: 8, ray: (u, v) => radial(lerp(80, 280, u) * DEG, lerp(-18, 68, v) * DEG) }] }),
  // Ash smeared down both sides of the face, beside the eyes.
  ash: ({ eyes }) => ({
    accent: [-1, 1].map(side => {
      const beside = eyeAzimuth(eyes) + 2 * DEG, low = eyes.bottom - .085, high = eyes.top + .065;
      return { nu: 3, nv: 12, ray: (u, v) => axial(side * (beside + lerp(0, 8, u) * DEG), lerp(low, high, v), FACE_AXIS) };
    }),
  }),
  // A riveted band across the back of the head.
  rivets: () => ({ cloth: [{ nu: 10, nv: 2, ray: (u, v) => radial(lerp(130, 230, u) * DEG, lerp(18, 34, v) * DEG) }] }),
  // A bar across the mouth, spanning it, round to the jaw's corners.
  cage: ({ eyes }) => {
    const y = eyes.y - .105;
    return { accent: [{ nu: 18, nv: 2, ray: (u, v) => axial(lerp(-44, 44, u) * DEG, lerp(y - .025, y + .025, v), FACE_AXIS) }] };
  },
  // A band round the head where it is still broad enough to hold one,
  // above the brows, and five points leaning out.
  crown: surface => {
    const y = crownHeight(surface);
    return { accent: [{ nu: 40, nv: 2, closed: true, ray: (u, v) => axial(u * 360 * DEG, lerp(y - .02, y + .02, v)), points: 5 }] };
  },
});

// The geometry of one family mark on one head: { accent, cloth }, each a
// BufferGeometry or null. White vertex colours: drawn with the Frisson
// accent and cloth materials (the skin's program).
export function buildMarks(surface, marker, { points = true } = {}) {
  const spec = HEAD_MARKS[marker]?.(surface);
  if (!spec) return { accent: null, cloth: null };
  const result = {};
  for (const channel of ['accent', 'cloth']) {
    const out = [];
    for (const piece of spec[channel] ?? []) {
      const grid = shell(out, surface, piece);
      if (piece.points && points) crownPoints(out, grid, piece);
    }
    result[channel] = out.length ? toGeometry(out) : null;
  }
  return result;
}
// Crown points on the band's top row, evenly round, none dead ahead (as the
// storybook crown: one at the back, two at each side).
function crownPoints(out, grid, { nu, nv, points }) {
  const columns = nu, row = nv;
  for (let index = 0; index < points; index++) {
    const u = (.5 + index / points) % 1, column = Math.round(u * columns) % columns, hit = grid[row * columns + column];
    if (!hit) continue;
    const [ox, oy, oz, dx, , dz] = hit.r, depth = hit.t - LIFT;
    const base = [ox + dx * depth, oy, oz + dz * depth];
    // Leaning out by .35 rad, as the storybook points.
    const axis = normalize([-dx * Math.sin(.35), Math.cos(.35), -dz * Math.sin(.35)]);
    spike(out, base, axis, .02, .05);
  }
}
function toGeometry(corners) {
  const positions = new Float32Array(corners.length * 3), normals = new Float32Array(corners.length * 3);
  corners.forEach((point, index) => positions.set(point, index * 3));
  for (let index = 0; index < corners.length; index += 3) {
    const [a, b, c] = [corners[index], corners[index + 1], corners[index + 2]];
    const n = normalize(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    for (let k = 0; k < 3; k++) normals.set(n, (index + k) * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(corners.length * 3).fill(1), 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
