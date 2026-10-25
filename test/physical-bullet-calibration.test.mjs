import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { BULLET_PROFILES } from '../public/bullet-profiles.js';
import { AIR_DENSITY, DAMAGE_PER_JOULE, physicalWeaponProfile, sampleBulletAtDistance, penetrationMultiplier } from '../public/ballistics.js';
import { scenarioReport, scenarioShot, scenarioRandom } from '../public/weapon-scenarios.js';
import { baselineSample } from '../public/weapon-damage-history.js';

const report = JSON.parse(fs.readFileSync(new URL('../validation/close-damage-calibration.json', import.meta.url), 'utf8'));
const historical = JSON.parse(fs.readFileSync(new URL('../validation/physical-bullet-calibration.json', import.meta.url), 'utf8'));
const baseline = JSON.parse(fs.readFileSync(new URL('../public/weapon-damage-before.json', import.meta.url), 'utf8')).weapons;
const rows = new Map(report.rows.map(row => [row.id, row]));
const weapon = id => physicalWeaponProfile(baseline[id], id);
const inBand = (value, low, high, label) => assert.ok(value >= low && value <= high, `${label}: ${value} outside ${low}..${high}`);
const ordinary = ['pistol', 'smg', 'shotgun', 'minigun', 'rifle', 'assault', 'sniper'];
// Independent quadrature: do not trust the fitted report or the UI's integral.
// Millimetre midpoint steps exactly partition the old piecewise boundaries,
// without assigning weight to the SMG's zero damage at exactly 30 m.
function mean0To30(sample) {
  const steps = 30000;
  let mean = 0;
  for (let step = 0; step < steps; step++) mean += sample((step + .5) / 1000) / steps;
  return mean;
}

test('frozen cartridge and gameplay parameters agree with the calibration report', () => {
  assert.deepEqual(Object.keys(BULLET_PROFILES).sort(), ['pistol', 'smg', 'shotgun', 'minigun', 'rifle', 'assault', 'sniper', 'magnum'].sort());
  assert.equal(AIR_DENSITY, 1.225); assert.equal(DAMAGE_PER_JOULE, 1);
  assert.equal(report.schemaVersion, 1); assert.ok(Object.isFrozen(BULLET_PROFILES));
  for (const [id, parameters] of Object.entries(BULLET_PROFILES)) {
    assert.ok(Object.isFrozen(parameters), id);
    assert.ok(parameters.mass > 0 && parameters.muzzleSpeed > 0 && parameters.dragArea > 0, id);
    assert.ok(parameters.transmission > 0 && parameters.transmission < 1, id);
    if (parameters.damageCurve) assert.ok(Object.isFrozen(parameters.damageCurve), id);
    assert.equal(weapon(id).oneShot, undefined, id);
    assert.equal(weapon(id).closeRangeBoost, undefined, id);
    assert.equal(weapon(id).falloff, undefined, id);
    assert.deepEqual(rows.get(id).profile, parameters, id);
    for (const property of ['mass', 'muzzleSpeed', 'dragArea', 'transmission', 'spread'])
      assert.equal(parameters[property], rows.get(id).beforeProfile[property], `${id}: preserved ${property}`);
  }
  const source = fs.readFileSync(new URL('../public/bullet-profiles.js', import.meta.url));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), report.profileSourceSha256);
  inBand(sampleBulletAtDistance(weapon('magnum'), 0).damage, 1999.999, 2000.001, 'finite Magnum muzzle damage');
});

test('all seven ordinary cartridges match the frozen habitual Refuge damage at exactly 10 m', () => {
  for (const id of ordinary) {
    const expected = baselineSample(baseline[id], 10).damage;
    const actual = sampleBulletAtDistance(weapon(id), 10).damage;
    assert.ok(Math.abs(actual / expected - 1) < 1e-10, `${id}: ${actual} vs ${expected}`);
  }
});

test('uniform continuous 0-30 m means meet the chosen fit and bounded residuals independently of the report', () => {
  const exactRatios = { pistol: 1, smg: 1, rifle: 1, assault: 1, minigun: 1 };
  for (const id of ordinary) {
    const actual = weapon(id);
    const before = mean0To30(distance => baselineSample(baseline[id], distance).damage);
    const now = mean0To30(distance => sampleBulletAtDistance(actual, distance).damage);
    const ratio = now / before;
    if (id in exactRatios) assert.ok(Math.abs(ratio - exactRatios[id]) < 1e-7, `${id}: mean ratio ${ratio}`);
    else if (id === 'shotgun') inBand(ratio, .9562, .9563, 'shotgun accepted mean ratio');
    else inBand(ratio, .9762, .9763, 'sniper accepted mean ratio');
    assert.ok(sampleBulletAtDistance(actual, 30).reachable, `${id}: the entire calibration band is reachable`);
  }
  inBand(weapon('shotgun').bulletPhysics.drag, .04 - 1e-12, .04 + 1e-12, 'preserved shotgun drag');
  inBand(weapon('sniper').bulletPhysics.drag, .0025 - 1e-12, .0025 + 1e-12, 'preserved sniper drag');
});

test('penetration retains the physical energy share independently of calibrated gameplay damage', () => {
  for (const id of rows.keys()) {
    const actual = weapon(id), tau = BULLET_PROFILES[id].transmission;
    for (const distance of [0, 12, 50, 200]) {
      const sample = sampleBulletAtDistance(actual, distance);
      const deposited = sample.energy * tau, remaining = sample.energy - deposited;
      assert.ok(remaining > 0 && remaining < sample.energy, id);
      assert.ok(Math.abs(remaining / sample.energy - (1 - tau)) < 1e-12, id);
      assert.ok(Math.abs(penetrationMultiplier(actual, 1, distance) - remaining / sample.energy) < 1e-12, id);
      assert.ok(Math.abs(penetrationMultiplier(actual, 2, distance) - (1 - tau) ** 2) < 1e-12, id);
    }
  }
});

test('ordinary body kill thresholds at contact, 4, 10 and 12 m stay within two rounds', () => {
  for (const id of ordinary.filter(id => id !== 'shotgun')) {
    for (const distance of [0, 4, 10, 12]) {
      const oldDamage = baselineSample(baseline[id], distance).damage;
      const next = sampleBulletAtDistance(weapon(id), distance).damage;
      for (const hp of [80, 115, 165, 230, 310, 400]) {
        const before = Math.ceil(hp / oldDamage - 1e-10), after = Math.ceil(hp / next - 1e-10);
        assert.ok(Math.abs(after - before) <= 2, `${id}, ${distance}m, ${hp}HP: ${before}->${after}`);
      }
    }
  }
});

test('rational curvature avoids large contact boosts while preserving each weapon identity', () => {
  for (const id of ['pistol', 'smg', 'rifle', 'assault', 'minigun']) {
    const original = baselineSample(baseline[id], 0).damage;
    const current = sampleBulletAtDistance(weapon(id), 0).damage;
    inBand(current / original, 1, 1.06, `${id}: contact ratio`);
    assert.equal(BULLET_PROFILES[id].damageCurve.kind, 'rational');
    assert.equal(BULLET_PROFILES[id].damageCurve.power, id === 'pistol' ? 3 : 2);
  }
});

test('shotgun preserves a measured close crowd envelope after removing its artificial contact boost', () => {
  const actual = weapon('shotgun');
  const cells = scenarioReport({ shotgun: actual }, { distances: [0, 4, 12], samples: 8, shotsPerSample: 128, seed: 104729 }).rows[0].cells;
  const before = historical.shotgun.baselineCrowd;
  const envelopes = [[.75, .86], [1.06, 1.18], [.86, 1.06]];
  cells.forEach((cell, i) => inBand(cell.damagePerShot / before[i].damagePerShot, ...envelopes[i], `crowd ${cell.distance}m`));
  const weighted = list => list[0].damagePerShot * .25 + list[1].damagePerShot * .5 + list[2].damagePerShot * .25;
  inBand(weighted(cells) / weighted(before), .91, 1.02, 'crowd 25/50/25 envelope');
});

test('the shotgun compromise also holds on isolated walkers and colossi, with contact loss explicitly accepted', () => {
  const actual = weapon('shotgun'), distances = [0, 4, 12], envelopes = [[.76, .86], [1.08, 1.27], [.82, 1.06]];
  for (const [kind, scale] of [['walker', 1], ['colossus', 1.22]]) {
    for (const [i, distance] of distances.entries()) {
      const target = { id: 'body', kind: kind === 'walker' ? 'walker' : 'brute', scale, x: 0, y: 0, z: -distance - .25 - .32 * scale };
      const random = scenarioRandom(104729), shots = 1024;
      let damage = 0;
      for (let shot = 0; shot < shots; shot++) damage += scenarioShot(actual, { targets: [target], origin: { x: 0, y: .88, z: 0 }, random }).damage / shots;
      const before = historical.shotgun.baselineIsolated[kind].find(row => row.distance === distance).damagePerShot;
      inBand(damage / before, ...envelopes[i], `${kind} ${distance}m`);
    }
  }
});
