// Authoritative variants replace ordinary walkers; wave size, rewards and
// ammunition drops remain governed by rules.js. Visuals are checked against
// these silhouettes in the variant tests.
import { difficultyLevel } from './progression.js';
export const ENEMY_PROFILES = Object.freeze({
  walker: Object.freeze({ height: 1.82, head: 1.68, headThreshold: 1.48, health: 1, bodyDamage: 1, speed: 1, damage: 11, attackInterval: .95, barricadeDamage: 12 }),
  armored: Object.freeze({ height: 1.82, head: 1.68, headThreshold: 1.48, health: 1, bodyDamage: .65, speed: .94, damage: 11, attackInterval: .95, barricadeDamage: 12 }),
  crawler: Object.freeze({ height: .82, head: .66, headThreshold: .58, health: .45, bodyDamage: 1, speed: .8, damage: 8, attackInterval: .65, barricadeDamage: 8 }),
  // Human raiders crouch to fire; hitbox, headshot line and snapshot follow.
  raider: Object.freeze({ height: 1.78, head: 1.67, headThreshold: 1.46, crouchHeight: 1.12, crouchHead: 1.03, crouchHeadThreshold: .86,
    health: 1, bodyDamage: 1, speed: 1, damage: 14, attackInterval: 1, barricadeDamage: 18 }),
});
const bossProfile = Object.freeze({ ...ENEMY_PROFILES.walker, height: 1.91 });

// Health belongs to a readable family, never to an invisible per-round buff.
// Adjacent families are interleaved as the night advances. The same family
// always has the same health; wounded zombies keep their original appearance.
export const ENEMY_HEALTH = Object.freeze([80, 115, 165, 230, 310, 400]);
export const BRUTE_HEALTH = Object.freeze([700, 1000, 1400]);
export const BOSS_HP = 6000;
function healthMix(wave, brute = false) {
  const values = brute ? BRUTE_HEALTH : ENEMY_HEALTH;
  const phase = Math.max(0, (difficultyLevel(wave) - (brute ? 5 : 2)) / (brute ? 25 : 28)) * (values.length - 1);
  const lower = Math.min(values.length - 1, Math.floor(phase));
  const upper = Math.min(values.length - 1, lower + 1), blend = phase - lower;
  return { values, lower, upper, blend };
}
export function enemyHealthMean(wave, brute = false) {
  const { values, lower, upper, blend } = healthMix(wave, brute);
  return values[lower] * (1 - blend) + values[upper] * blend;
}
export function enemyHealth(wave, ordinal = 1, kind = 'walker', boss = false) {
  if (boss) return BOSS_HP;
  const { values, lower, upper, blend } = healthMix(wave, kind === 'brute');
  const index = Math.max(1, Math.floor(ordinal) || 1);
  const stronger = Math.floor(index * blend + .31 + 1e-9) > Math.floor((index - 1) * blend + .31 + 1e-9);
  const base = values[stronger ? upper : lower];
  return Math.round(base * enemyProfile({ kind }).health);
}

const appearance = (id, fr, en, ceiling, color, clothColor, accentColor, marker) => Object.freeze({
  id, label: Object.freeze({ fr, en }), ceiling, color, clothColor, accentColor, marker,
});
export const ENEMY_APPEARANCES = Object.freeze([
  appearance('pale', 'Blafard', 'Pale', 100, 0xd3c8b4, 0x746e66, 0xe4d8c7, 'bare'),
  appearance('sallow', 'Jauni', 'Sallow', 140, 0xc6b764, 0x756b39, 0xf0d877, 'wrap'),
  appearance('rust', 'Rouillé', 'Rust', 200, 0xb8754d, 0x74452e, 0xf6b06a, 'scarf'),
  appearance('scarlet', 'Cramoisi', 'Crimson', 270, 0xa95950, 0x622c32, 0xf3a196, 'straps'),
  appearance('umber', 'Bruni', 'Umber', 350, 0x8e7967, 0x49443d, 0xd8c7ac, 'cowl'),
  appearance('charcoal', 'Cendre', 'Ash', 500, 0x585e66, 0x242a31, 0xdce8db, 'ash'),
  appearance('hulk', 'Colosse', 'Hulk', 850, 0x759b8e, 0x343d3b, 0xc2e0bf, 'plate'),
  appearance('iron', 'Colosse de fer', 'Iron hulk', 1150, 0x637889, 0x323846, 0xd0dae3, 'rivets'),
  appearance('dread', 'Colosse ancien', 'Elder hulk', Infinity, 0x55506e, 0x292436, 0xb7a3d5, 'cage'),
]);
const overlord = appearance('overlord', 'Colosse ultime', 'Overlord', Infinity, 0x6e384a, 0x211f29, 0xffba68, 'crown');
// Not a zombie family: never listed in ENEMY_APPEARANCES nor picked from health.
export const RAIDER_APPEARANCE = appearance('raider', 'Pillard', 'Raider', Infinity, 0xd8453b, 0x23262b, 0x9dffd8, 'bandana');
export function enemyAppearance(zombie = {}) {
  if (zombie.kind === 'raider') return RAIDER_APPEARANCE;
  if (zombie.boss) return overlord;
  const health = Number.isFinite(zombie.maxHp) && zombie.maxHp > 0
    ? zombie.maxHp : zombie.kind === 'brute' ? 700 : zombie.kind === 'crawler' ? 36 : 80;
  return ENEMY_APPEARANCES.find(family => health <= family.ceiling) ?? ENEMY_APPEARANCES.at(-1);
}

export function enemyProfile(zombie) {
  return zombie.boss ? bossProfile : ENEMY_PROFILES[zombie.kind] ?? ENEMY_PROFILES.walker;
}

// Unscaled stature of the current pose. Only a crouched raider differs.
export function enemyPosture(zombie) {
  const profile = enemyProfile(zombie);
  return zombie.kind === 'raider' && zombie.crouched
    ? { height: profile.crouchHeight, head: profile.crouchHead, headThreshold: profile.crouchHeadThreshold }
    : { height: profile.height, head: profile.head, headThreshold: profile.headThreshold };
}

// Smooth deterministic proportions; no lucky extra enemy or extra reward.
// Existing runners are never converted, and callers keep brute/boss quotas.
export function enemyVariant(wave, ordinal, fast = false) {
  if (fast) return 'runner';
  const difficulty = difficultyLevel(wave);
  const crossed = (rate, phase = 0) => Math.floor(ordinal * rate + phase + 1e-9) > Math.floor((ordinal - 1) * rate + phase + 1e-9);
  if (difficulty >= 4 && crossed(.0625 + .0575 * Math.min(1, (difficulty - 4) / 26))) return 'crawler';
  if (difficulty >= 7 && crossed(.04 + .08 * Math.min(1, (difficulty - 7) / 23), .5)) return 'armored';
  return 'walker';
}

export function enemyHitbox(zombie) {
  const scale = zombie.scale ?? (zombie.kind === 'brute' ? 1.22 : 1);
  const height = zombie.boss ? 1.91 : enemyPosture(zombie).height;
  return {
    minX: zombie.x - .32 * scale, maxX: zombie.x + .32 * scale,
    minY: zombie.y + .05 * scale, maxY: zombie.y + height * scale,
    minZ: zombie.z - .32 * scale, maxZ: zombie.z + .32 * scale,
  };
}

export function enemyHeadshot(zombie, hitHeight) {
  const scale = zombie.scale ?? (zombie.kind === 'brute' ? 1.22 : 1);
  return hitHeight > enemyPosture(zombie).headThreshold * scale;
}

// A raid-3 vest overrides the body factor per raider; heads stay unprotected.
export function enemyDamageMultiplier(zombie, headshot) {
  return headshot ? 1 : zombie.bodyDamage ?? enemyProfile(zombie).bodyDamage;
}
