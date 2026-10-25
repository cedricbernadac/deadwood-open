import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lampsFor, LAMPS, CELLAR_TUBES } from '../public/hospital-lights.js';

// The family's machines run the low tier: the third pass lit three more
// cellar diffusers, and their spotlights must not land on low (13 real
// lights, as before that pass) nor on medium (24). High has all 31.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIERS = ['low', 'medium', 'high'];
const lamps = id => lampsFor({ id });
const cellar = list => list.filter(lamp => lamp.y < 0);
const key = item => `${item.x},${item.z}`;
const LIVE = CELLAR_TUBES.filter(tube => tube.state !== 'dead');

test('hospital light tiers keep low at 13 real lights and pin medium and high', () => {
  assert.equal(lamps('low').length, 13, 'low keeps the 13 lights it had before the third pass');
  assert.equal(lamps('medium').length, 24, 'medium keeps its 24 lights');
  assert.equal(lamps('high').length, 31, 'high lights every live cellar diffuser (31 lights)');
  assert.equal(lampsFor(undefined).length, lamps('medium').length, 'no quality is the medium tier');
});

test('cellar spotlights follow the explicit tier of each live diffuser, not their position in the list', () => {
  assert.equal(LIVE.length, 9, 'nine live cellar diffusers');
  assert.deepEqual(Object.fromEntries(TIERS.map(id => [id, cellar(lamps(id)).length])), { low: 3, medium: 5, high: 9 });
  // The six diffusers lit before the third pass keep their old tiers; the
  // three lit by it (the z = 0 row) are high only.
  assert.deepEqual(cellar(lamps('low')).map(key).sort(), ['-12,-10', '11,-10', '3,9']);
  assert.deepEqual(cellar(lamps('medium')).map(key).sort(), ['-12,-10', '-5,-10', '11,-10', '11,9', '3,9']);
  assert.deepEqual(LIVE.filter(tube => tube.z === 0).map(tube => tube.tier), ['high', 'high', 'high']);
  for (const tube of LIVE) {
    const lamp = LAMPS.find(item => item.y < 0 && key(item) === key(tube));
    assert.ok(lamp, `live diffuser ${key(tube)} has a runtime spotlight`);
    assert.equal(lamp.tier, tube.tier, `spotlight ${key(tube)} takes its diffuser's tier`);
    assert.equal(lamp.flicker, tube.state === 'flicker', `spotlight ${key(tube)} flickers with its diffuser`);
  }
  assert.ok(CELLAR_TUBES.filter(tube => tube.state === 'dead').every(tube => !tube.tier), 'dead diffusers carry no tier');
});

test('every tier keeps the lights of the tier below it', () => {
  const low = new Set(lamps('low').map(lamp => `${lamp.x},${lamp.y},${lamp.z}`));
  const medium = new Set(lamps('medium').map(lamp => `${lamp.x},${lamp.y},${lamp.z}`));
  const high = new Set(lamps('high').map(lamp => `${lamp.x},${lamp.y},${lamp.z}`));
  for (const lamp of low) assert.ok(medium.has(lamp), `medium keeps the low-tier lamp ${lamp}`);
  for (const lamp of medium) assert.ok(high.has(lamp), `high keeps the medium-tier lamp ${lamp}`);
});

test('the Blender cellar fixtures stay the runtime grid and the README states the tier counts', { skip: 'needs the art and audio originals, kept out of the open edition' }, () => {
  // build_hospital.py derives the cellar states from a formula; it must give
  // the same dead and flickering diffusers as CELLAR_TUBES.
  const source = readFileSync(`${ROOT}art/levels/hospital/build_hospital.py`, 'utf8');
  assert.ok(source.includes("for xi, x in enumerate([-12, -5, 3, 11]):") && source.includes("for zi, z in enumerate([-10, 0, 9]):"), 'Blender cellar grid');
  assert.ok(source.includes("state = 'Fluorescent_dead' if (xi + zi) % 6 == 2 else 'Fluorescent_flicker' if (xi, zi) == (3, 2) else 'Fluorescent_cold'"), 'Blender cellar states');
  const blender = [-12, -5, 3, 11].flatMap((x, xi) => [-10, 0, 9].map((z, zi) => [x, z, (xi + zi) % 6 === 2 ? 'dead' : xi === 3 && zi === 2 ? 'flicker' : 'on']));
  assert.deepEqual(CELLAR_TUBES.map(tube => [tube.x, tube.z, tube.state]), blender);
  // The per-tier counts are written down for whoever tunes the lights next.
  const readme = readFileSync(`${ROOT}art/levels/hospital/README.md`, 'utf8');
  assert.match(readme, /bas\D{0,12}13\D[^\n]*moyen\D{0,12}24\D[^\n]*haut\D{0,12}31/i, 'the README states the per-tier light counts');
});
