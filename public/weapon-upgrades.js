import { CHARACTER_BONUSES } from './character-bonuses.js';
import { debtOf, sheetMalus } from './character-sheet.js';
export const SUPPLY_WAVES = Object.freeze(Array.from({ length: 17 }, (_, index) => index + 2));
export const MAX_BONUS_LEVEL = 8;
import { LEVEL, HAS_SPACE } from './level-config.js';

// Bonuses stack: each crate visit either raises the level of a carried bonus
// (up to 8) or adds a new one. The permanent outdoor crate offers one choice
// per survivor and wave from 2 through 18 inclusive.
export const SUPPLY_BONUSES = Object.freeze({
  // Keep the existing id for carried bonuses, pickups and network compatibility.
  stone: Object.freeze({ id: 'stone', label: Object.freeze({ fr: 'Armes renforcées', en: 'Reinforced weapons' }) }),
  perforating: Object.freeze({ id: 'perforating', label: Object.freeze({ fr: 'Balles perforantes', en: 'Armor-piercing rounds' }) }),
  extended: Object.freeze({ id: 'extended', label: Object.freeze({ fr: 'Chargeur étendu', en: 'Extended magazine' }) }),
  reinforced: Object.freeze({ id: 'reinforced', label: Object.freeze({ fr: 'Munitions renforcées', en: 'Reinforced rounds' }) }),
  ...CHARACTER_BONUSES,
});
// Armor-piercing rounds stay an investment, strengthened in play (owner,
// 16 October: "pas assez fort à l'usage" — the ladder is 3-3-2): nothing
// before level 3, one extra pierced target at 3, a second at 6, a third at 8.
export const PERFORATING_LEVELS = Object.freeze({ firstBonusLevel: 3, secondBonusLevel: 6, thirdBonusLevel: 8 });
// Reinforced rounds (owner, 16 October): +15% of the weapon's base damage
// every two levels — 0/15/15/30/30/45/45/60 — one multiplier on the base
// damage, never compounded between levels. Bullet weapons, shotgun and
// sniper included; never blades, flames, explosives or the one-shot Magnum.
export const REINFORCED_STEPS = Object.freeze({ every: 2, percent: 15 });
export const BACKPACK = Object.freeze({ price: 1500, unlockWave: 10, slots: 4,
  movementMultipliers: Object.freeze({ 3: .9, 4: .85 }) });
export const LATE_SUPPLIES = Object.freeze({ unlockWave: 15, reach: 1.85,
  position: Object.freeze(HAS_SPACE ? LEVEL.lateSupplyPosition : { x: -2.4, y: 0, z: -5.82, facing: 0 }),
  items: Object.freeze({
    // The revive kit opens the post early: expensive, one carried at a time.
    revive: Object.freeze({ price: 1200, unlockWave: 5 }),
    backpack: BACKPACK,
    grenade: Object.freeze({ price: 350 }), armor: Object.freeze({ price: 600 }), ammo: Object.freeze({ price: 700 }),
  }),
});

export function bonusLevel(bonus) {
  const level = typeof bonus === 'object' && bonus ? bonus.level : 1;
  return Math.max(1, Math.min(MAX_BONUS_LEVEL, Number.isFinite(level) ? Math.round(level) : 1));
}

// Carried bonuses live as a { kind: level } map. Single-kind shapes (a string
// or { kind, level }) are still accepted so older callers and snapshots read
// the same way.
export function bonusEntries(bonus) {
  if (!bonus) return [];
  if (typeof bonus === 'string') return Object.hasOwn(SUPPLY_BONUSES, bonus) ? [[bonus, 1]] : [];
  const entries = [];
  if (bonus.kind) {
    if (Object.hasOwn(SUPPLY_BONUSES, bonus.kind)) entries.push([bonus.kind, bonusLevel(bonus)]);
    return entries;
  }
  for (const [kind, level] of Object.entries(bonus)) {
    if (Object.hasOwn(SUPPLY_BONUSES, kind) && Number.isFinite(level) && level >= 1) entries.push([kind, bonusLevel({ level })]);
  }
  return entries;
}

export function perforatingTargets(level = 1) {
  const bounded = bonusLevel({ kind: 'perforating', level });
  return bounded >= PERFORATING_LEVELS.thirdBonusLevel ? 3
    : bounded >= PERFORATING_LEVELS.secondBonusLevel ? 2
    : bounded >= PERFORATING_LEVELS.firstBonusLevel ? 1 : 0;
}

// Extra victims within the existing swing arc, not extra reach or penetration
// through walls. Both light and heavy attacks keep their own damage retention.
export function reinforcedMeleeTargets(level = 1) {
  const bounded = bonusLevel({ kind: 'stone', level });
  return bounded >= 8 ? 2 : bounded >= 4 ? 1 : 0;
}

// The reinforced-rounds damage bonus of a whole level ladder, in percent of
// the base damage: 0/15/15/30/30/45/45/60.
export function reinforcedDamagePercent(level = 1) {
  return REINFORCED_STEPS.percent * Math.floor(bonusLevel({ kind: 'reinforced', level }) / REINFORCED_STEPS.every);
}

const bulletWeapon = weapon => !weapon.melee && !weapon.fuel && !weapon.explosive && !weapon.oneShot && !weapon.upgradeExempt;
// A character sheet's innate debt (character-sheet.js), never part of the
// carried bonuses: same weapon scope as the bonus it weighs on.
function weaponMalus(weapon, kind, level) {
  const factor = effect => sheetMalus(kind, effect, level) ?? 1;
  if (kind === 'stone' && weapon.melee) {
    const scale = factor('meleeDamageMultiplier');
    return { ...weapon, damage: weapon.damage * scale,
      attacks: Object.fromEntries(Object.entries(weapon.attacks).map(([mode, profile]) => [mode, { ...profile, damage: profile.damage * scale }])) };
  }
  if (kind === 'extended' && !weapon.melee && weapon.magazine >= 2) {
    const scale = factor('capacityMultiplier');
    return { ...weapon, magazine: Math.max(1, Math.round(weapon.magazine * scale)),
      reserve: weapon.reserve > 0 ? Math.max(1, Math.round(weapon.reserve * scale)) : weapon.reserve };
  }
  if (kind === 'reinforced' && bulletWeapon(weapon)) return { ...weapon, damage: weapon.damage * factor('bulletDamageMultiplier') };
  return weapon;
}

// Bonuses never mutate the shared base rules. Levels of different bonuses
// compose freely; the extended magazine grows the loaded magazine and the
// reserve alike, so the between-wave refill hands out full extended loadouts
// while scavenged ammunition boxes keep their fixed yields. A sheet's debt
// lowers the carried level (effective = level − debt): positive effective
// levels keep the ladders, negative ones apply the malus, zero does nothing.
export function upgradedWeapon(weapon, id, bonus, debt = null) {
  if (!weapon) return weapon;
  let result = weapon;
  const levels = new Map(bonusEntries(bonus));
  for (const kind of ['stone', 'perforating', 'extended', 'reinforced']) {
    const owed = debtOf(debt, kind);
    if (owed) levels.set(kind, (levels.get(kind) ?? 0) - owed);
  }
  for (const [kind, level] of levels) {
    if (level < 0) { result = weaponMalus(result, kind, level); continue; }
    if (level < 1) continue;
    const growth = 1 + .1 * level;
    if (kind === 'stone' && result.melee) {
      const extra = reinforcedMeleeTargets(level);
      result = { ...result, damage: result.damage * growth,
        penetrationTargets: (result.penetrationTargets ?? result.attacks.light.maxTargets) + extra,
        attacks: Object.fromEntries(Object.entries(result.attacks).map(([mode, profile]) => [mode, {
          ...profile, damage: profile.damage * growth, maxTargets: profile.maxTargets + extra,
        }])) };
    } else if (kind === 'perforating' && bulletWeapon(result) && id !== 'sniper') {
      const extra = perforatingTargets(level);
      if (extra) result = { ...result, penetrationTargets: Math.min(6, result.penetrationTargets + extra) };
    } else if (kind === 'extended' && !result.melee && result.magazine >= 2) {
      result = { ...result, magazine: Math.max(result.magazine, Math.round(result.magazine * growth)),
        reserve: Math.max(result.reserve, Math.round(result.reserve * growth)) };
    } else if (kind === 'reinforced' && bulletWeapon(result)) {
      // One multiplier on the base damage (shotgun and sniper included); the
      // piercing falloff downstream keeps working on the raised damage.
      const percent = reinforcedDamagePercent(level);
      if (percent) result = { ...result, damage: result.damage * (1 + percent / 100) };
    }
  }
  return result;
}
