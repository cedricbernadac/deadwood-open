import * as THREE from 'three';

const centroid = triangle => [0, 1, 2].map(axis => (triangle.a[axis] + triangle.b[axis] + triangle.c[axis]) / 3);
const material = triangle => triangle.material.replace(/^Hospital__|^Roof__/, '');
const inside = (point, box, tolerance = 0.0002) => [0, 1, 2].every(axis => point[axis] >= box.min[axis] - tolerance && point[axis] <= box.max[axis] + tolerance);

function regionTriangles(triangles, region) {
  const selected = triangles.filter(triangle => material(triangle) === region.material && inside(centroid(triangle), region));
  if (!selected.length) throw Error(`No exported triangles for ${region.name} (${region.material}) at ${JSON.stringify(region.min)}..${JSON.stringify(region.max)}`);
  return selected;
}

const vector = point => new THREE.Vector3(...point);
const triangle3 = triangle => new THREE.Triangle(vector(triangle.a), vector(triangle.b), vector(triangle.c));
const edges = triangle => [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]];
const point = new THREE.Vector3();

function segmentTriangleIntersection(a, b, triangle) {
  const start = vector(a), direction = vector(b).sub(start), length = direction.length();
  if (length < 1e-9) return false;
  const hit = new THREE.Ray(start, direction.normalize()).intersectTriangle(triangle3(triangle).a, triangle3(triangle).b, triangle3(triangle).c, false, point);
  return hit ? start.distanceTo(hit) <= length + 1e-7 : false;
}

function segmentDistanceSquared(a, b, c, d) {
  const u = vector(b).sub(vector(a)), v = vector(d).sub(vector(c)), w = vector(a).sub(vector(c));
  const A = u.dot(u), B = u.dot(v), C = v.dot(v), D = u.dot(w), E = v.dot(w), denominator = A * C - B * B;
  let s = denominator > 1e-16 ? (B * E - C * D) / denominator : 0;
  s = Math.max(0, Math.min(1, s));
  let t = C > 1e-16 ? (B * s + E) / C : 0;
  if (t < 0) { t = 0; s = A > 1e-16 ? Math.max(0, Math.min(1, -D / A)) : 0; }
  else if (t > 1) { t = 1; s = A > 1e-16 ? Math.max(0, Math.min(1, (B - D) / A)) : 0; }
  const left = vector(a).addScaledVector(u, s), right = vector(c).addScaledVector(v, t);
  return left.distanceToSquared(right);
}

function triangleDistanceSquared(a, b) {
  for (const [start, end] of edges(a)) if (segmentTriangleIntersection(start, end, b)) return 0;
  for (const [start, end] of edges(b)) if (segmentTriangleIntersection(start, end, a)) return 0;
  let best = Infinity;
  const target = new THREE.Vector3(), bt = triangle3(b), at = triangle3(a);
  for (const vertex of [a.a, a.b, a.c]) {
    bt.closestPointToPoint(vector(vertex), target);
    best = Math.min(best, target.distanceToSquared(vector(vertex)));
  }
  for (const vertex of [b.a, b.b, b.c]) {
    at.closestPointToPoint(vector(vertex), target);
    best = Math.min(best, target.distanceToSquared(vector(vertex)));
  }
  for (const [aa, ab] of edges(a)) for (const [ba, bb] of edges(b)) best = Math.min(best, segmentDistanceSquared(aa, ab, ba, bb));
  return best;
}

export function meshDistance(aTriangles, bTriangles) {
  let best = Infinity;
  for (const a of aTriangles) for (const b of bTriangles) {
    const lower = [0, 1, 2].reduce((sum, axis) => {
      const gap = Math.max(0, a.lo[axis] - b.hi[axis], b.lo[axis] - a.hi[axis]);
      return sum + gap * gap;
    }, 0);
    if (lower >= best) continue;
    best = Math.min(best, triangleDistanceSquared(a, b));
    if (best <= 1e-14) return 0;
  }
  return Math.sqrt(best);
}

export function auditContacts(triangles, contacts, tolerance = 0.003) {
  const results = contacts.map(contact => {
    const part = regionTriangles(triangles, contact.part);
    const partSet = new Set(part);
    const support = contact.supports.flatMap(region => regionTriangles(triangles, region)).filter(triangle => !partSet.has(triangle));
    if (!support.length) throw Error(`No support triangles remain for ${contact.id}`);
    const distance = meshDistance(part, support);
    return { id: contact.id, distanceMm: Math.round(distance * 1000000) / 1000, toleranceMm: tolerance * 1000,
      partTriangles: part.length, supportTriangles: support.length, passed: distance <= tolerance + 1e-7 };
  });
  return { toleranceMm: tolerance * 1000, checked: results.length, failed: results.filter(result => !result.passed), results,
    passed: results.every(result => result.passed) };
}
