// Compact strategic facts, derived from the same bonus-free profiles that the
// simulation uses. These are damage/rate ceilings, never predicted hit rates
// or a mandatory shopping policy. The director supplies play experience apart.
import { ARMORY, FLAMETHROWER, MINIGUN_TIMING, ROCKET, WEAPON_MOVEMENT } from '../public/rules.js';
import { sampleBulletAtDistance } from '../public/ballistics.js';
import { blastDamageAtDistance } from '../public/area-damage.js';

const DISTANCES_M = Object.freeze([3, 10, 20]);
const rounded = value => Math.round(value * 100) / 100;

export const WEAPON_STRATEGY_ASSUMPTIONS = Object.freeze({
  damage: 'HP, bonus-free, first unarmored body; no headshot or hit-probability multiplier.',
  samples: 'Damage arrays correspond to distances 3, 10, 20 m. Shotgun damage is per pellet; all-pellets values assume every pellet hits the SAME body, never extra bodies.',
  dps: 'HP/s ideal ceilings, not expected bot performance. Burst = one trigger damage / interval. Reload = magazine trigger damage / ((magazine-1)*interval + max(reload,interval) + minigun spin). Unlimited reserves, instant reload initiation; no aiming, movement, AI pauses or misses.',
  penetration: 'Bodies per projectile is a cap, not damage multiplied by that cap. Each traversal loses energy: retained fraction applies at every body, further flight also slows/loses damage. Walls/boards block.',
  melee: 'Light/heavy cycles include full recovery, impact delay is the wind-up. No ammunition or reload. Companions currently use light attacks; damage falls by retained fraction on each additional body in the arc.',
});

function reloadCycle(profile, spin = 0) {
  return Math.max(0, profile.magazine - 1) * profile.interval + Math.max(profile.reloadTime, profile.interval) + spin;
}

function attackFacts(attack) {
  return {
    firstBodyDamageHP: rounded(attack.damage), cycleSec: attack.duration, impactDelaySec: attack.windup,
    reachM: attack.range, arcDeg: rounded(attack.coneAngle * 180 / Math.PI),
    maxBodiesInArc: attack.maxTargets, damageRetainedPerExtraBody: attack.retention,
    idealFirstBodyDps: rounded(attack.damage / attack.duration),
  };
}

export function weaponStrategyCatalogue(sim) {
  if (typeof sim?.weaponProfile !== 'function') throw new TypeError('A simulation weaponProfile is required.');
  return ARMORY.filter(rack => rack.weapon !== 'magnum').map(({ weapon, price, unlockWave }) => {
    // A null owner deliberately excludes every survivor's carried bonuses.
    const profile = sim.weaponProfile(null, weapon);
    if (!profile) throw new TypeError(`Missing base weapon profile: ${weapon}`);
    const facts = { weapon, price, unlockWave, movementMultiplier: WEAPON_MOVEMENT[weapon] ?? 1 };
    if (profile.melee) return { ...facts, kind: 'melee', light: attackFacts(profile.attacks.light), heavy: attackFacts(profile.attacks.heavy) };

    Object.assign(facts, { kind: profile.fuel ? 'flame' : profile.explosive ? 'explosive' : 'bullet',
      intervalSec: profile.interval, triggersPerSec: rounded(1 / profile.interval),
      magazine: profile.magazine, reserve: profile.reserve, reloadSec: profile.reloadTime });
    if (profile.fuel) return { ...facts,
      fuelUnitsPerTrigger: 1, contactHPperTrigger: rounded(FLAMETHROWER.contactDps * profile.interval),
      contactDps: FLAMETHROWER.contactDps, burnDps: FLAMETHROWER.burnDps, burnDuration: FLAMETHROWER.burnDuration,
      fullDamageRange: FLAMETHROWER.fullDamageRange, range: FLAMETHROWER.range,
      coneDeg: rounded(FLAMETHROWER.coneAngle * 180 / Math.PI),
      fullContactPlusBurnDpsPerBody: FLAMETHROWER.contactDps + FLAMETHROWER.burnDps,
      idealReloadContactDpsPerBody: rounded(profile.magazine * FLAMETHROWER.contactDps * profile.interval / reloadCycle(profile)),
      fullBurnHPAfterLastContact: FLAMETHROWER.burnDps * FLAMETHROWER.burnDuration,
      area: 'All exposed bodies in the cone; bodies do not block each other, solids protect. Full strength through 5m, smooth fade to zero at 6m. One strongest active burn per target, shared across shooters: repeated hits or two flamethrowers do not stack burn DPS.',
    };
    if (profile.explosive) return { ...facts,
      rocketsPerTrigger: 1, maxTravelM: profile.range,
      blastFullUntilM: ROCKET.innerRadius, blastEndsM: ROCKET.radiusDamage,
      blastHPAtRadiusM: Object.fromEntries([0, ROCKET.innerRadius, (ROCKET.innerRadius + ROCKET.radiusDamage) / 2, ROCKET.radiusDamage]
        .map(radius => [radius, rounded(blastDamageAtDistance(ROCKET, radius))])),
      idealInnerBlastBurstDps: rounded(ROCKET.damage / profile.interval),
      idealInnerBlastReloadDps: rounded(profile.magazine * ROCKET.damage / reloadCycle(profile)),
      area: `Blast power is independent of shooter distance. Damage follows distance from impact, with smooth edge; solids shield targets. Explosion requires an impact, not range exhaustion. ${sim.friendlyFireOn?.() === true ? 'Blasts hurt our team too.' : 'No friendly blast damage.'}`,
    };

    const damage = DISTANCES_M.map(distance => rounded(sampleBulletAtDistance(profile, distance).damage));
    const rawDamage10 = sampleBulletAtDistance(profile, 10).damage;
    const pellets = profile.pellets;
    const spin = weapon === 'minigun' ? MINIGUN_TIMING.windup : 0;
    return { ...facts,
      projectilesPerTrigger: pellets, damageHPperProjectileAt3_10_20m: damage,
      ...(pellets > 1 ? { allPelletsHPperTriggerAt3_10_20m: DISTANCES_M.map(distance => rounded(sampleBulletAtDistance(profile, distance).damage * pellets)) } : {}),
      idealBurstDpsAt10m: rounded(rawDamage10 * pellets / profile.interval),
      idealReloadDpsAt10m: rounded(profile.magazine * rawDamage10 * pellets / reloadCycle(profile, spin)),
      bodiesPerProjectile: profile.penetrationTargets, energyRetainedPerBody: rounded(profile.penetrationRetention),
      muzzleSpeedMps: profile.ballisticSpeed, yawPitchSpreadRad: profile.spread,
      ...(spin ? { spinUpSec: spin, spinUpAfterReload: true } : {}),
    };
  });
}
