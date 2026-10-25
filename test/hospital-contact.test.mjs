import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGlbTriangles } from '../validation/hospital-props-audit.mjs';
import { auditContacts, meshDistance } from '../validation/hospital-contact.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const triangle = (a, b, c) => ({ a, b, c,
  lo: [0, 1, 2].map(axis => Math.min(a[axis], b[axis], c[axis])),
  hi: [0, 1, 2].map(axis => Math.max(a[axis], b[axis], c[axis])) });

test('mesh distance measures real surface gaps and intersections', () => {
  const a = triangle([0, 0, 0], [1, 0, 0], [0, 1, 0]);
  const above = triangle([0, 0, 0.004], [1, 0, 0.004], [0, 1, 0.004]);
  const crossing = triangle([0.2, 0.2, -1], [0.2, 0.2, 1], [0.4, 0.3, 0]);
  assert.ok(Math.abs(meshDistance([a], [above]) - 0.004) < 1e-7);
  assert.equal(meshDistance([a], [crossing]), 0);
});

test('contact audit refuses to use a part as its own support', () => {
  const shared = { ...triangle([0, 0, 0], [1, 0, 0], [0, 1, 0]), material: 'Metal_white' };
  const region = { name: 'Curtain_track', material: 'Metal_white', min: [-1, -1, -1], max: [1, 1, 1] };
  assert.throws(() => auditContacts([shared], [{ id: 'self-support', part: region, supports: [region] }]), /No support triangles/);
});

test('every audited hospital accessory touches its support within 3 mm', { skip: 'needs the art and audio originals, kept out of the open edition' }, () => {
  const stats = JSON.parse(readFileSync(`${ROOT}art/levels/hospital/stats.json`, 'utf8'));
  const expected = {
    'ward bed frame/chassis': 16, 'curtain track/post caps': 4, 'curtain rings/track': 48, 'curtain cloth/rings': 8,
    'IV bag/hook': 4, 'timetable straps/rail': 2, 'timetable/straps': 1, 'shelter panes/rails': 2,
    'shelter rails/posts': 4, 'bench slats/beam': 3, 'bench beam/legs': 1,
    'theatre head rest/bracket': 1, 'fallen bottles/shelf boards': 15, 'cabinet card/drawer': 7,
    'ambulance bumpers/cab and doors': 2, 'ambulance letters/body': 2, 'gurney legs/frame': 12,
    'gurney legs/platform': 12, 'pine trunks/mulch discs': 24,
  };
  const counts = {};
  for (const contact of stats.contactChecks ?? []) counts[contact.id.split(':')[0]] = (counts[contact.id.split(':')[0]] ?? 0) + 1;
  assert.deepEqual(counts, expected, 'every contact family keeps its complete authored coverage');
  for (const contact of stats.contactChecks.filter(item => item.id.startsWith('pine trunks/'))) {
    assert.equal(contact.supports.length, 1, `${contact.id}: exactly one supporting disc`);
    const centre = region => region.min.map((value, axis) => (value + region.max[axis]) / 2);
    const trunk = centre(contact.part), disc = centre(contact.supports[0]);
    for (const axis of [0, 2]) assert.ok(Math.abs(trunk[axis] - disc[axis]) <= .02, `${contact.id}: trunk and disc share a centre on axis ${axis}`);
  }
  const report = auditContacts(loadGlbTriangles(`${ROOT}public/levels/hospital.glb`), stats.contactChecks);
  assert.equal(report.passed, true, JSON.stringify({ checked: report.checked, failed: report.failed }, null, 2));
});
