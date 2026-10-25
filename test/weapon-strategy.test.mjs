import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { weaponStrategyCatalogue, WEAPON_STRATEGY_ASSUMPTIONS } from '../companions/weapon-strategy.mjs';

const room = () => new RoomSimulation('STRAT1', { random: () => .5 });
const byWeapon = sim => Object.fromEntries(weaponStrategyCatalogue(sim).map(facts => [facts.weapon, facts]));
function close(actual, expected, tolerance = .0051) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${actual} should equal ${expected} within ${tolerance}`);
}

test('the catalogue covers all ordinary weapons and states damage, accuracy and penetration assumptions', () => {
  const weapons = byWeapon(room());
  assert.deepEqual(Object.keys(weapons).sort(), [
    'assault', 'bat', 'fireaxe', 'flamethrower', 'hammer', 'katana', 'minigun',
    'pistol', 'rifle', 'rocket', 'shotgun', 'smg', 'sniper',
  ]);
  assert.equal(weapons.magnum, undefined, 'the unique golden weapon is not a companion purchase');
  assert.match(WEAPON_STRATEGY_ASSUMPTIONS.damage, /bonus-free.*first unarmored body/);
  assert.match(WEAPON_STRATEGY_ASSUMPTIONS.damage, /no headshot or hit-probability multiplier/);
  assert.match(WEAPON_STRATEGY_ASSUMPTIONS.samples, /3, 10, 20 m/);
  assert.match(WEAPON_STRATEGY_ASSUMPTIONS.dps, /ideal ceilings, not expected bot performance/);
  assert.match(WEAPON_STRATEGY_ASSUMPTIONS.penetration, /cap, not damage multiplied by that cap/);
});

test('the SMG is a cadence, magazine and penetration step above the pistol despite lower damage per bullet', () => {
  const { pistol, smg } = byWeapon(room());
  assert.equal(pistol.kind, 'bullet'); assert.equal(smg.kind, 'bullet');
  assert.deepEqual([pistol.magazine, smg.magazine], [12, 40]);
  assert.deepEqual([pistol.reserve, smg.reserve], [36, 120]);
  assert.deepEqual([pistol.intervalSec, smg.intervalSec], [.25, .085]);
  assert.deepEqual([pistol.reloadSec, smg.reloadSec], [1.25, 1.5]);
  assert.deepEqual([pistol.triggersPerSec, smg.triggersPerSec], [4, 11.76]);
  assert.deepEqual([pistol.bodiesPerProjectile, smg.bodiesPerProjectile], [1, 2]);
  assert.deepEqual([pistol.projectilesPerTrigger, smg.projectilesPerTrigger], [1, 1]);
  close(pistol.damageHPperProjectileAt3_10_20m[1], 23.61);
  close(smg.damageHPperProjectileAt3_10_20m[1], 17.99);
  close(pistol.idealBurstDpsAt10m, 94.45); close(smg.idealBurstDpsAt10m, 211.70);
  close(pistol.idealReloadDpsAt10m, 70.84); close(smg.idealReloadDpsAt10m, 149.48);
  assert.ok(smg.idealBurstDpsAt10m > pistol.idealBurstDpsAt10m * 2.2);
  assert.ok(smg.damageHPperProjectileAt3_10_20m[1] < pistol.damageHPperProjectileAt3_10_20m[1]);
  assert.equal(smg.price, 900); assert.equal(smg.unlockWave, 4);
});

test('shotgun samples are per pellet and the nine-pellet ceiling is applied exactly once to shell damage and DPS', () => {
  const { shotgun } = byWeapon(room());
  assert.equal(shotgun.projectilesPerTrigger, 9);
  close(shotgun.damageHPperProjectileAt3_10_20m[1], 16.46);
  close(shotgun.allPelletsHPperTriggerAt3_10_20m[1], 148.11);
  close(shotgun.idealBurstDpsAt10m, 174.25);
  close(shotgun.idealReloadDpsAt10m, 141.91);
  for (let index = 0; index < 3; index++) {
    close(shotgun.allPelletsHPperTriggerAt3_10_20m[index],
      shotgun.damageHPperProjectileAt3_10_20m[index] * 9, .05);
  }
  assert.match(WEAPON_STRATEGY_ASSUMPTIONS.samples, /every pellet hits the SAME body, never extra bodies/);
  assert.equal(shotgun.bodiesPerProjectile, 2, 'the per-pellet body cap is separate from nine pellets');
});

test('retained energy and body caps remain separate from ideal first-body DPS, including minigun spin after reload', () => {
  const weapons = byWeapon(room());
  const expected = {
    pistol: [1, .30], smg: [2, .55], shotgun: [2, .45],
    rifle: [3, .65], assault: [2, .60], minigun: [4, .70], sniper: [6, .85],
  };
  for (const [weapon, [bodies, retention]] of Object.entries(expected)) {
    assert.deepEqual([weapons[weapon].bodiesPerProjectile, weapons[weapon].energyRetainedPerBody], [bodies, retention]);
    assert.ok(weapons[weapon].idealReloadDpsAt10m <= weapons[weapon].idealBurstDpsAt10m);
  }
  close(weapons.rifle.idealBurstDpsAt10m, 333.33, .01);
  close(weapons.sniper.idealBurstDpsAt10m, 280, .01);
  close(weapons.minigun.idealBurstDpsAt10m, 546.85, .01);
  close(weapons.minigun.idealReloadDpsAt10m, 266.32, .01);
  assert.equal(weapons.minigun.spinUpSec, 1);
  assert.equal(weapons.minigun.spinUpAfterReload, true);
  assert.equal(weapons.smg.spinUpSec, undefined);

  const sim = room();
  const changedCapOnly = { weaponProfile(owner, weapon) {
    const profile = sim.weaponProfile(owner, weapon);
    return weapon === 'smg' ? { ...profile, penetrationTargets: 6, penetrationRetention: .91 } : profile;
  } };
  const changed = byWeapon(changedCapOnly).smg;
  assert.equal(changed.bodiesPerProjectile, 6); assert.equal(changed.energyRetainedPerBody, .91);
  assert.equal(changed.idealBurstDpsAt10m, weapons.smg.idealBurstDpsAt10m);
  assert.equal(changed.idealReloadDpsAt10m, weapons.smg.idealReloadDpsAt10m);
});

test('a changed weaponProfile drives samples, cadence, stock, reload, projectiles, spread and penetration instead of fixed statistics', () => {
  const sim = room(), calls = [];
  const adapted = { weaponProfile(owner, weapon) {
    calls.push({ owner, weapon });
    const base = sim.weaponProfile(owner, weapon);
    return weapon === 'smg' ? { ...base,
      damage: 80, damageCurve: { kind: 'rational', halfDistance: 10, power: 2 },
      bulletPhysics: { ...base.bulletPhysics, drag: 0, muzzleSpeed: 222 },
      ballisticSpeed: 222, interval: .2, magazine: 7, reserve: 11, reloadTime: 1.9,
      pellets: 3, penetrationTargets: 5, penetrationRetention: .73, spread: .042,
    } : base;
  } };
  const { smg } = byWeapon(adapted);
  assert.equal(calls.length, 13); assert.ok(calls.every(call => call.owner === null));
  assert.deepEqual(smg.damageHPperProjectileAt3_10_20m, [73.39, 40, 16]);
  assert.deepEqual(smg.allPelletsHPperTriggerAt3_10_20m, [220.18, 120, 48]);
  assert.deepEqual([smg.intervalSec, smg.triggersPerSec, smg.magazine, smg.reserve, smg.reloadSec], [.2, 5, 7, 11, 1.9]);
  assert.deepEqual([smg.projectilesPerTrigger, smg.bodiesPerProjectile, smg.energyRetainedPerBody], [3, 5, .73]);
  assert.deepEqual([smg.muzzleSpeedMps, smg.yawPitchSpreadRad], [222, .042]);
  close(smg.idealBurstDpsAt10m, 600);
  close(smg.idealReloadDpsAt10m, 270.97);
});

test('carried bonuses change the owner profile but cannot leak into the bonus-free strategic catalogue', () => {
  const sim = room(), before = weaponStrategyCatalogue(sim);
  const owner = sim.addPlayer('max', 'Max', undefined, { companion: true });
  owner.bonus = { reinforced: 8, perforating: 8, extended: 8, stone: 8 };
  const enhanced = sim.weaponProfile(owner, 'smg'), base = sim.weaponProfile(null, 'smg');
  assert.equal(enhanced.magazine, 72); assert.equal(enhanced.reserve, 216);
  assert.equal(enhanced.penetrationTargets, 5);
  close(enhanced.damage / base.damage, 1.6, 1e-12);
  assert.ok(sim.weaponProfile(owner, 'katana').attacks.light.damage > sim.weaponProfile(null, 'katana').attacks.light.damage);
  assert.deepEqual(weaponStrategyCatalogue(sim), before);
  const { smg } = byWeapon(sim);
  assert.equal(smg.magazine, 40); assert.equal(smg.bodiesPerProjectile, 2);
  close(smg.damageHPperProjectileAt3_10_20m[1], 17.99);
});

test('flames describe every exposed body, 225 contact-plus-burn DPS and one shared non-stacking 700 HP burn tail', () => {
  const { flamethrower: flame } = byWeapon(room());
  assert.equal(flame.kind, 'flame'); assert.equal(flame.fuelUnitsPerTrigger, 1);
  assert.equal(flame.intervalSec, .125); assert.equal(flame.contactHPperTrigger, 6.25);
  assert.equal(flame.contactDps, 50); assert.equal(flame.burnDps, 175);
  assert.equal(flame.fullContactPlusBurnDpsPerBody, 225);
  assert.equal(flame.burnDuration, 4); assert.equal(flame.fullBurnHPAfterLastContact, 700);
  assert.equal(flame.fullDamageRange, 5); assert.equal(flame.range, 6); assert.equal(flame.coneDeg, 40);
  close(flame.idealReloadContactDpsPerBody, 38.83);
  assert.equal(flame.bodiesPerProjectile, undefined, 'a bullet profile body cap must not restrict the flame cone');
  assert.equal(flame.idealBurstDpsAt10m, undefined, 'flame samples cannot pretend to be 10 m ballistic damage');
  assert.match(flame.area, /All exposed bodies in the cone; bodies do not block each other, solids protect/);
  assert.match(flame.area, /One strongest active burn per target, shared across shooters/);
  assert.match(flame.area, /repeated hits or two flamethrowers do not stack burn DPS/);
});

test('rocket damage is indexed by radius from an actual impact, independently of the distance travelled', () => {
  const { rocket } = byWeapon(room());
  assert.equal(rocket.kind, 'explosive'); assert.equal(rocket.rocketsPerTrigger, 1);
  assert.equal(rocket.maxTravelM, 60); assert.equal(rocket.blastFullUntilM, 2); assert.equal(rocket.blastEndsM, 4);
  assert.deepEqual(rocket.blastHPAtRadiusM, { 0: 700, 2: 700, 3: 350, 4: 0 });
  close(rocket.idealInnerBlastBurstDps, 875); close(rocket.idealInnerBlastReloadDps, 250);
  assert.equal(rocket.damageHPperProjectileAt3_10_20m, undefined);
  assert.match(rocket.area, /independent of shooter distance/);
  assert.match(rocket.area, /distance from impact, with smooth edge; solids shield targets/);
  assert.match(rocket.area, /Explosion requires an impact, not range exhaustion/);
  assert.match(rocket.area, /No friendly blast damage/);
});

test('light and heavy melee attacks keep their own damage, recovery, impact delay and multi-body attenuation', () => {
  const weapons = byWeapon(room());
  const expected = {
    bat: { light: [120, .4, .12, 1.6, 50, 1, 1, 300], heavy: [200, 1, .35, 1.8, 40, 1, 1, 200] },
    fireaxe: { light: [160, .6, .4, 1.8, 100, 2, .75, 266.67], heavy: [320, 1.4, .55, 2, 90, 2, .75, 228.57] },
    hammer: { light: [300, .8, .3, 1.8, 60, 2, .5, 375], heavy: [900, 2.2, .75, 2, 45, 2, .5, 409.09] },
    katana: { light: [216, .55, .16, 1.9, 80, 3, .75, 392.73], heavy: [504, 1.5, .7, 2.1, 65, 3, .75, 336] },
  };
  for (const [weapon, modes] of Object.entries(expected)) {
    const facts = weapons[weapon];
    assert.equal(facts.kind, 'melee'); assert.equal(facts.magazine, undefined); assert.equal(facts.reloadSec, undefined);
    assert.equal(facts.idealBurstDpsAt10m, undefined);
    for (const [mode, values] of Object.entries(modes)) {
      const attack = facts[mode];
      assert.deepEqual([
        attack.firstBodyDamageHP, attack.cycleSec, attack.impactDelaySec, attack.reachM,
        attack.arcDeg, attack.maxBodiesInArc, attack.damageRetainedPerExtraBody, attack.idealFirstBodyDps,
      ], values, `${weapon} ${mode} is a distinct full-recovery attack`);
      assert.ok(attack.impactDelaySec < attack.cycleSec);
    }
  }
  assert.match(WEAPON_STRATEGY_ASSUMPTIONS.melee, /Companions currently use light attacks/);
  assert.match(WEAPON_STRATEGY_ASSUMPTIONS.melee, /damage falls by retained fraction on each additional body/);
});

test('a one-round synthetic gun cannot acquire an impossible reload DPS above its firing cadence', () => {
  const sim = room();
  const adapted = { weaponProfile(owner, weapon) {
    const base = sim.weaponProfile(owner, weapon);
    return weapon === 'pistol' ? { ...base, damage: 40, damageCurve: { kind: 'rational', halfDistance: 10, power: 2 },
      magazine: 1, interval: .5, reloadTime: .1 } : base;
  } };
  const { pistol } = byWeapon(adapted);
  assert.equal(pistol.damageHPperProjectileAt3_10_20m[1], 20);
  assert.equal(pistol.idealBurstDpsAt10m, 40);
  assert.equal(pistol.idealReloadDpsAt10m, 40, 'firing cadence, rather than a faster reload, limits repeated shots');
});
