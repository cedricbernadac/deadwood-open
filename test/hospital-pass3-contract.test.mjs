import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.DEADWOOD_LEVEL = 'hospital';
const { LEVEL } = await import('../public/level-config.js');
const { SPACE } = await import('../public/level-space.js');
const { LAMPS, CELLAR_TUBES } = await import('../public/hospital-lights.js');
const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('pass 3 dressing has one collider per new solid and no overlapping furniture', () => {
  const expected = { 'pass3-linen-': 8, 'pass3-archives-': 4, 'pass3-chapel-': 3, 'pass3-waiting-': 6 };
  for (const [prefix, count] of Object.entries(expected)) {
    assert.equal(LEVEL.furniture.filter(item => item.id.startsWith(prefix)).length, count, prefix);
  }
  const additions = LEVEL.furniture.filter(item => Object.keys(expected).some(prefix => item.id.startsWith(prefix)));
  for (const addition of additions) {
    assert.ok(addition.height > 0 && addition.maxX > addition.minX && addition.maxZ > addition.minZ, addition.id);
    for (const other of LEVEL.furniture) {
      if (other.id === addition.id || (other.baseY ?? 0) !== (addition.baseY ?? 0)) continue;
      assert.ok(!(addition.minX < other.maxX && addition.maxX > other.minX && addition.minZ < other.maxZ && addition.maxZ > other.minZ),
        `${addition.id} overlaps ${other.id}`);
    }
  }
  assert.ok(LEVEL.furniture.find(item => item.id === 'chapel-altar').height >= 1.1, 'altar collider covers its cloth and unlit candles');
});

test('cellar tube lighting is brighter and Blender uses the same live fixture grid', { skip: 'needs the art and audio originals, kept out of the open edition' }, () => {
  const cellarLamps = LAMPS.filter(lamp => lamp.y < 0);
  const coordinates = values => values.map(value => [value.x, value.z].join(',')).sort();
  assert.deepEqual(coordinates(cellarLamps), coordinates(CELLAR_TUBES.filter(tube => tube.state !== 'dead')),
    'every non-dead Blender cellar tube has exactly one runtime spotlight');
  for (const lamp of cellarLamps) {
    assert.ok(lamp.intensity >= 32, `cellar lamp intensity ${lamp.intensity}`);
    assert.ok(lamp.range >= 7, `cellar lamp range ${lamp.range}`);
  }
  const source = readFileSync(`${ROOT}art/levels/hospital/build_hospital.py`, 'utf8');
  assert.ok(source.includes("for x, z, state in cellar_fixtures:"), 'Blender lights reuse the fixture grid');
  assert.ok(source.includes("light('Cellar_tube_softbox', x, -.68, z, 260,"), 'each live Blender tube has a 260 lm softbox below its diffuser');
});

test('the west ambulance barricade opens directly into emergency through a real facade doorway', () => {
  assert.equal(LEVEL.doors.length, 4, 'the established four-barricade contract is preserved');
  const west = LEVEL.doors.find(door => door.id === 'west');
  const emergency = SPACE.rooms.find(room => room.id === 'emergency');
  assert.ok(west.z > emergency.bounds.minZ && west.z < emergency.bounds.maxZ, `west door z=${west.z} is inside the ED facade span`);
  const doorway = emergency.doors.find(door => door.id === 'emergency-ambulance');
  assert.ok(doorway && doorway.axis === 'z' && doorway.x === -20 && doorway.z === west.z && doorway.width >= 1.4 && doorway.height >= 2.7,
    'SPACE.rooms declares the direct ambulance doorway');
  assert.ok(emergency.doors.some(door => door.id === 'emergency-bay' && door.axis === 'x' && door.z === 4.2 && door.width >= 7),
    'a wide open bay joins the ambulance entrance to the triage room');
  assert.ok(emergency.doors.some(door => door.id === 'emergency-east' && door.axis === 'z' && door.x === -4.4 && door.z === 0 && door.width >= 1.4),
    'the eastern ED doorway preserves the corridor spine');
  const blocked = SPACE.facadeSections.some(section => section.wallId === 'west' && section.minY < 1.6 && section.maxY > 1.6
    && section.minX < -19.8 && section.maxX > -20.2 && section.minZ < west.z && section.maxZ > west.z);
  assert.equal(blocked, false, 'the facade contract leaves the doorway open at body height');
});
