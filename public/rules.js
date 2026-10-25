import { LEVEL, HAS_SPACE } from './level-config.js';
// Shared by the authoritative simulation and the rendered wall racks.
export { INTERIOR_WALLS, INTERIOR_DOORWAYS, INTERIOR_PASSAGES, EXTERIOR_WALLS, EXTERIOR_WALL_THICKNESS, DOOR_OPENING, WINDOWS, wallOpenings, PARTITION_CAPS, partitionCapHeight, partitionCapSupport } from './layout.js';
import { enemyHealthMean, BOSS_HP } from './enemies.js';
import { MAX_WAVES, LEGACY_MAX_WAVES, difficultyLevel, waveAtDifficultyLevel } from './progression.js';
import { EXPEDITION, RAIN } from './expedition.js';
export { EXPEDITION, RAIN, UMBRELLA, GENERATOR, GENERATOR_BOUNDS, FUEL_CACHES, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, farSpawnShare, SPAWN_WARNING, rainRoofHeight, hasRainShelter, rainExposed, generatorPower } from './expedition.js';
export { MAX_WAVES, LEGACY_MAX_WAVES, boundedWave, difficultyLevel, waveAtDifficultyLevel } from './progression.js';
export { enemyProfile, enemyPosture, enemyHitbox, enemyHeadshot, enemyDamageMultiplier, enemyHealth, enemyAppearance, ENEMY_APPEARANCES, RAIDER_APPEARANCE, ENEMY_HEALTH, BRUTE_HEALTH, BOSS_HP } from './enemies.js';
import { RAIDS } from './raids.js';
export { RAIDS, RAID_ENTRIES, RAIDER_LOADOUTS, RAID_COMPOSITIONS, DRILL_LOADOUTS, RAIDER_PLANK_DAMAGE, raidPlayers, raidIndex, raidTotal, raidSquad, raidDamageScale, raiderLoadout } from './raids.js';
export { PLAYER_POSTURE, playerHeight, playerEyeHeight, playerHitbox, LOFT_RAIL } from './movement.js';
export { MINIGUN_TIMING, minigunRotorSpeed, firingSchedule, fireTolerance, FIRE_FRAME_CARRY } from './minigun.js';
export { SUPPLY_BONUSES, SUPPLY_WAVES, LATE_SUPPLIES, BACKPACK, upgradedWeapon } from './weapon-upgrades.js';
export { RADAR } from './radar-rules.js';
export { STAIRS, STAIR_WELL, STAIR_STRINGERS, STAIR_TREADS, stairRampY, stairTreadY, stairCeiling } from './stairs.js';
export const LOFT = LEVEL.loft;
// Twenty-wave arsenal ladder. The bat is the early single-target melee option;
// the stronger katana arrives later for clearing compact groups.
export const ARMORY = Object.freeze([
  Object.freeze({ id: 'pistol', weapon: 'pistol', label: 'PISTOLET', price: 200, unlockWave: 1, x: -6.3, y: 0, z: 5.82, facing: Math.PI }),
  Object.freeze({ id: 'shotgun', weapon: 'shotgun', label: 'FUSIL À POMPE', price: 350, unlockWave: 2, x: 7.82, y: 0, z: -5.15, facing: -Math.PI / 2 }),
  Object.freeze({ id: 'bat', weapon: 'bat', label: 'BATTE EN BOIS', price: 250, unlockWave: 3, x: -7.82, y: 0, z: -3.6, facing: Math.PI / 2 }),
  Object.freeze({ id: 'smg', weapon: 'smg', label: 'MITRAILLETTE', price: 900, unlockWave: 4, x: 7.82, y: 0, z: 5.15, facing: -Math.PI / 2 }),
  Object.freeze({ id: 'fireaxe', weapon: 'fireaxe', label: 'HACHE DE POMPIER', price: 600, unlockWave: 5, x: 4.8, y: 0, z: -5.79, facing: 0 }),
  Object.freeze({ id: 'assault', weapon: 'assault', label: 'FUSIL D’ASSAUT', price: 1400, unlockWave: 6, x: 3, y: 3.4, z: -5.82, facing: 0 }),
  Object.freeze({ id: 'hammer', weapon: 'hammer', label: 'MASSE À POINTES', price: 1000, unlockWave: 7, x: 5.6, y: 3.4, z: -5.82, facing: 0 }),
  Object.freeze({ id: 'rifle', weapon: 'rifle', label: 'MITRAILLEUSE', price: 1800, unlockWave: 8, x: -7.82, y: 0, z: -5.15, facing: Math.PI / 2 }),
  Object.freeze({ id: 'katana', weapon: 'katana', label: 'KATANA', price: 1200, unlockWave: 9, x: 5.6, y: 3.4, z: 5.82, facing: Math.PI }),
  Object.freeze({ id: 'flamethrower', weapon: 'flamethrower', label: 'LANCE-FLAMMES', price: 2600, unlockWave: 10, x: 3, y: 3.4, z: 5.82, facing: Math.PI }),
  Object.freeze({ id: 'minigun', weapon: 'minigun', label: 'MINIGUN', price: 2800, unlockWave: 12, x: -7.82, y: 0, z: 5.15, facing: Math.PI / 2 }),
  Object.freeze({ id: 'sniper', weapon: 'sniper', label: 'FUSIL À VERROU', price: 3200, unlockWave: 13, x: 7.82, y: 3.4, z: 4.1, facing: -Math.PI / 2 }),
  Object.freeze({ id: 'magnum', weapon: 'magnum', label: 'MAGNUM DORÉ', price: 3500, unlockWave: 14, x: 7.82, y: 3.4, z: -4.1, facing: -Math.PI / 2 }),
  Object.freeze({ id: 'rocket', weapon: 'rocket', label: 'LANCE-ROQUETTES', price: 5000, unlockWave: 16, x: 7.82, y: 3.4, z: 0, facing: -Math.PI / 2 }),
].map(rack => HAS_SPACE ? Object.freeze({ ...rack, ...LEVEL.armoryPositions[rack.id] }) : rack));
export const STARTER_WEAPON = 'pistol';
export const STARTER_WEAPONS = Object.freeze([STARTER_WEAPON]);
// One cadence for real ballistics and the client trigger. The selected machine
// gun recording has an attack approximately every 89 ms.
export const FIRE_INTERVALS = Object.freeze({ pistol: .25, rifle: .09, shotgun: .85, smg: .085, minigun: .055, magnum: .7, assault: .13, rocket: .8, flamethrower: .125, katana: .55, hammer: .8, sniper: 1.25, bat: .4, fireaxe: .6 });
// The cone is its full opening angle. A target has one burn regardless of
// repeated sweeps or the number of survivors carrying a flamethrower.
export const FLAMETHROWER = Object.freeze({ range: 6, fullDamageRange: 5, coneAngle: 40 * Math.PI / 180, contactDps: 50, burnDps: 175, burnDuration: 4 });
export const ROCKET = Object.freeze({ innerRadius: 2, radiusDamage: 4, damage: 700, blastCurve: 'smootherstep' });
// Damage happens after the authoritative wind-up. A swing can cleave three
// bodies, retaining 75% damage for each successive target, without head bonus.
export const MELEE = Object.freeze({ maxTargets: 3, retention: .75,
  light: Object.freeze({ damage: 216, range: 1.9, coneAngle: 80 * Math.PI / 180, windup: .16, duration: .55, interval: .55, maxTargets: 3, retention: .75 }),
  heavy: Object.freeze({ damage: 504, range: 2.1, coneAngle: 65 * Math.PI / 180, windup: .7, duration: 1.5, interval: 1.5, maxTargets: 3, retention: .75 }),
});
export const MELEE_WEAPONS = Object.freeze({ katana: MELEE,
  hammer: Object.freeze({ maxTargets: 2, retention: .5, pushMultiplier: 2,
    light: Object.freeze({ damage: 300, range: 1.8, coneAngle: Math.PI / 3, windup: .3, duration: .8, interval: .8, maxTargets: 2, retention: .5 }),
    heavy: Object.freeze({ damage: 900, range: 2, coneAngle: Math.PI / 4, windup: .75, duration: 2.2, interval: 2.2, maxTargets: 2, retention: .5 }),
  }),
  bat: Object.freeze({ maxTargets: 1, retention: 1,
    light: Object.freeze({ damage: 120, range: 1.6, coneAngle: 50 * Math.PI / 180, windup: .12, duration: .4, interval: .4, maxTargets: 1, retention: 1 }),
    heavy: Object.freeze({ damage: 200, range: 1.8, coneAngle: 40 * Math.PI / 180, windup: .35, duration: 1, interval: 1, maxTargets: 1, retention: 1 }),
  }),
  fireaxe: Object.freeze({ maxTargets: 2, retention: .75,
    light: Object.freeze({ damage: 160, range: 1.8, coneAngle: 100 * Math.PI / 180, windup: .4, duration: .6, interval: .6, maxTargets: 2, retention: .75 }),
    heavy: Object.freeze({ damage: 320, range: 2, coneAngle: 90 * Math.PI / 180, windup: .55, duration: 1.4, interval: 1.4, maxTargets: 2, retention: .75 }),
  }),
});
// The unique golden revolver keeps its instant kill against ordinary enemies.
// Six landed rounds finish the final boss, with no headshot multiplier.
export const MAGNUM_BOSS_DAMAGE = 1000;
// The Gatling carries one loaded 75-round drum plus one full drum in reserve.
// The reserve rose from 19 to 75; shared pickups still grant 6/12 rounds.
export const MINIGUN_AMMO = Object.freeze({ magazine: 75, reserve: 75 });
// Spendable cash is independent of performance score and pellet count.
export const ECONOMY = Object.freeze({ kill: 18, headshot: 24, brute: 60, bruteHeadshot: 90, boss: 100, bossHeadshot: 150, repair: 1, revive: 25 });
// Rapid kills chain a small performance-score bonus; cash and loot never change.
// holdMax: between two kills, at most this much reload, gatling spin-up or
// killing-blow recovery stands the chain's clock still (the gatling reloads
// in 3.4 s, then spins up for 1 s), so without a kill a chain never outlives
// window + holdMax.
// Five difficulty levels, chosen by the host before the night (owner,
// 13 October). Normal is the game as tuned. damageTaken scales every blow a
// survivor takes, supplies how often medkits and revive kits drop, raiders
// the raiders' health and firepower. Zombies themselves are unchanged.
export const DIFFICULTY_LEVELS = Object.freeze(['very-easy', 'easy', 'normal', 'hard', 'nightmare']);
export const DIFFICULTY = Object.freeze({
  'very-easy': Object.freeze({ damageTaken: .5, supplies: 2.5, raiders: .6 }),
  easy: Object.freeze({ damageTaken: .75, supplies: 1.6, raiders: .8 }),
  normal: Object.freeze({ damageTaken: 1, supplies: 1, raiders: 1 }),
  hard: Object.freeze({ damageTaken: 1.25, supplies: .7, raiders: 1.3 }),
  nightmare: Object.freeze({ damageTaken: 1.6, supplies: .5, raiders: 1.7 }),
});
export function difficultyOf(level) { return Object.hasOwn(DIFFICULTY, level ?? '') ? DIFFICULTY[level] : DIFFICULTY.normal; }
// Friendly fire (owner, 23 October: « un truc un peu plus réaliste »), chosen
// by the host before the night like the difficulty, and off unless chosen.
// The scale multiplies a weapon's own damage on a teammate (or on oneself,
// for one's own grenade or rocket); the survivor's usual rules follow
// (difficulty, resistance, vest). Reduced is a provisional taste choice.
export const FRIENDLY_FIRE_LEVELS = Object.freeze(['off', 'reduced', 'full']);
export const FRIENDLY_FIRE = Object.freeze({ off: 0, reduced: .25, full: 1 });
export function friendlyFireScale(level) { return Object.hasOwn(FRIENDLY_FIRE, level ?? '') ? FRIENDLY_FIRE[level] : 0; }
// Which ambiances may choose it: all of them (23 October), Famille included,
// off unless chosen. The one condition to change to keep it, say, to Frisson
// rooms: the server, the lobby and the damage all ask here.
export function friendlyFireAllowed(ambiance) { return AMBIANCES.includes(ambiance); }
// A drop cadence ("one every N team kills") at a difficulty: never below one.
export function supplyCadence(everyKills, level) { return Math.max(1, Math.round(everyKills / difficultyOf(level).supplies)); }
// The night's ambiance (art/frisson/DESIGN.md), chosen by whoever creates the
// room and fixed for its life, in the home picker's order. Famille is the game
// itself; Frisson (15+) is a look only, drawn by the browsers that load it;
// Frisson léger (15 October 2026) is that same look with rounder heads and
// half the blood. Anything else is Famille.
export const AMBIANCES = Object.freeze(['family', 'frisson-leger', 'frisson']);
export function ambianceOf(value) { return AMBIANCES.includes(value) ? value : 'family'; }
// The ambiances drawn with the Frisson pack: everything Frisson does (the
// server's wounds, the pack, the "Famille uniquement" lock) holds for both.
export const FRISSON_AMBIANCES = Object.freeze(['frisson-leger', 'frisson']);
export function isFrissonLike(ambiance) { return FRISSON_AMBIANCES.includes(ambiance); }

// Getting back up. A teammate's E revives at once (teammateHp); a revive kit,
// carried one at a time, lifts its owner (kitHp), by hand or automatically
// when the bleed-out runs out. Any revive shields for `shield` seconds, so a
// zombie standing over the body cannot knock the survivor straight down.
// Reviving takes time (owner, 13 October): a teammate holds E for `duration`
// seconds within `reach` (a message every 570 ms keeps it going; `holdGrace`
// covers network jitter), and a kit lifts its owner after `kitDuration`. The
// bleed-out waits while either is under way. A kit used on a teammate is instant.
export const REVIVE = Object.freeze({ kitHp: 75, teammateHp: 55, shield: 2, bleedOut: 25,
  duration: 5, kitDuration: 5, startReach: 2.2, reach: 2.4, heightReach: 1.25, holdGrace: 1 });
// Coins dropped for a teammate: a pack of `amount`, never pulled back to the
// dropper, who can only pick it up again after `dropperDelay` seconds.
export const COIN_GIFT = Object.freeze({ amount: 100, dropperDelay: 3, cooldown: .4 });
// The score (owner, 18 October) is the damage dealt. Lifting a teammate
// earns, at the end of the wave, what they then dealt, and at least this.
export const REVIVE_SCORE_FLOOR = 150;

export const KILL_CHAIN = Object.freeze({ window: 2.5, bonusPerKill: 25, maxBonus: 100, holdMax: 4.5 });
// Raid rewards live in RAIDS, outside the zombie economy forecast.
export function killCash(zombie, headshot = false) {
  if (zombie.kind === 'raider') return headshot ? RAIDS.headshotCash : RAIDS.cash;
  if (zombie.boss) return headshot ? ECONOMY.bossHeadshot : ECONOMY.boss;
  if (zombie.kind === 'brute') return headshot ? ECONOMY.bruteHeadshot : ECONOMY.brute;
  return headshot ? ECONOMY.headshot : ECONOMY.kill;
}
export const WEAPON_MOVEMENT = Object.freeze({ pistol: 1.08, smg: 1, rifle: .96, shotgun: .93, magnum: .95, minigun: .72, assault: 1, rocket: .8, flamethrower: .82, katana: 1.05, hammer: .9, sniper: .9, bat: 1.08, fireaxe: 1 });
export const ARMORY_REACH = 1.85;
export const ARMORY_HEIGHT_REACH = .8;
// Wall anchor plus a local +Z depth into the room. Rendering and authoritative
// bodies/rays use the same narrow, suspended footprint.
export const ARMORY_RACK = Object.freeze({ width: 1.3, depth: .22, baseY: .9, height: 1.25 });
export function armoryRackBounds(crate) {
  const sine = Math.sin(crate.facing ?? 0), cosine = Math.cos(crate.facing ?? 0);
  const x = crate.x + sine * ARMORY_RACK.depth / 2, z = crate.z + cosine * ARMORY_RACK.depth / 2;
  const halfX = Math.abs(cosine) * ARMORY_RACK.width / 2 + Math.abs(sine) * ARMORY_RACK.depth / 2;
  const halfZ = Math.abs(sine) * ARMORY_RACK.width / 2 + Math.abs(cosine) * ARMORY_RACK.depth / 2;
  return { id: `rack-${crate.id}`, minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ,
    baseY: crate.y + ARMORY_RACK.baseY, height: ARMORY_RACK.height };
}
export const MAX_WEAPON_SLOTS = 2;
// A dropped gun keeps its exact stock and the ordinary shared pickup reach.
export const GROUND_WEAPONS = Object.freeze({ dropDistance: .55, interactCooldown: .3 });
// Measured envelopes of the actual hands-free models laid on their sides,
// centred in X/Z by createGroundWeapon. About 10 micrometres of numerical
// clearance cover Three.js float geometry; artwork changes are checked by tests.
export const GROUND_WEAPON_BOUNDS = Object.freeze({
  pistol: Object.freeze({ halfWidth: .20498, halfLength: .23134, height: .11101, floorOffset: .018 }),
  rifle: Object.freeze({ halfWidth: .28251, halfLength: .65001, height: .21501, floorOffset: .018 }),
  shotgun: Object.freeze({ halfWidth: .18174, halfLength: .72501, height: .12001, floorOffset: .018 }),
  smg: Object.freeze({ halfWidth: .23518, halfLength: .54501, height: .12751, floorOffset: .018 }),
  minigun: Object.freeze({ halfWidth: .23376, halfLength: .69001, height: .29001, floorOffset: .018 }),
  magnum: Object.freeze({ halfWidth: .18174, halfLength: .53501, height: .16743, floorOffset: .018 }),
  assault: Object.freeze({ halfWidth: .25871, halfLength: .64251, height: .10801, floorOffset: .018 }),
  rocket: Object.freeze({ halfWidth: .24501, halfLength: .59001, height: .28851, floorOffset: .018 }),
  flamethrower: Object.freeze({ halfWidth: .18027, halfLength: .48927, height: .38402, floorOffset: .018 }),
  katana: Object.freeze({ halfWidth: .40781, halfLength: .64707, height: .2117, floorOffset: .018 }),
  hammer: Object.freeze({ halfWidth: .40771, halfLength: .59657, height: .30811, floorOffset: .018 }),
  sniper: Object.freeze({ halfWidth: .26974, halfLength: .82601, height: .22538, floorOffset: .018 }),
  bat: Object.freeze({ halfWidth: .33495, halfLength: .49378, height: .12976, floorOffset: .018 }),
  fireaxe: Object.freeze({ halfWidth: .33277, halfLength: .68126, height: .10501, floorOffset: .018 }),
});
// A vest absorbs zombie blows and falls before health. It is not restored
// between waves, is lost when its wearer goes down and resets on restart.
export const ARMOR = Object.freeze({ max: 100 });
// The break between two waves ends early once every survivor is ready:
// the next wave then comes this many seconds later (owner: a faster rhythm).
export const NEXT_WAVE_CALL = 3;

export const PICKUPS = Object.freeze({
  lifetime: 90, reach: 1.15, heightReach: .6, ammoEveryKills: 5, specialEvery: 4,
  // Coins slide toward the nearest survivor who can see them within this
  // reach (m), faster as they get closer (m/s at the edge, at contact).
  magnetReach: 2.6, magnetSpeed: Object.freeze({ edge: 3.5, contact: 9 }),
  // A revive kit drops every so many team kills from this wave (Normal).
  reviveEveryKills: 90, reviveFromWave: 3,
  // One shared integer budget. Its divisors exactly represent every normal
  // and special refill fraction without accumulating floating-point supply.
  ammoCharge: 780, healthEveryKills: 25,
  // From wave 10 of 20 the hordes start to hurt: a vest drops every sixtieth
  // team kill (never on the same corpse as a medkit before kill 300).
  armorEveryKills: 60, armorFromWave: 10,
  ammo: Object.freeze({ pistol: 4, rifle: 10, shotgun: 2, smg: 13, minigun: 6, magnum: 0, assault: 10, rocket: 0, flamethrower: 0, katana: 0, hammer: 0, sniper: 1, bat: 0, fireaxe: 0 }),
  specialAmmo: Object.freeze({ pistol: 4, rifle: 10, shotgun: 2, smg: 13, minigun: 12, magnum: 1, assault: 10, rocket: 1, flamethrower: 12, katana: 0, hammer: 0, sniper: 2, bat: 0, fireaxe: 0 }),
});

// One team-wide, deterministic allowance per wave. Carrying a grenade does
// not multiply the allowance when another survivor joins the room.
export const GRENADES = Object.freeze({
  maxCarry: 2, fuse: 1.8, cooldown: .7, speed: 8, lift: 2.4,
  gravity: 18, radius: .09, bounce: .4, friction: .72,
  innerRadius: 2, radiusDamage: 4, damage: 450, blastCurve: 'smootherstep',
});
export function grenadeDropsForWave(wave = 0) {
  if (!Number.isFinite(wave) || wave < 1) return 0;
  return Math.floor((difficultyLevel(Math.floor(wave)) + 1e-9) / 5);
}

// Exact local geometry, shared by rendering, ballistics and doorway collisions.
export const BARRICADE_BOARDS = Object.freeze(Array.from({ length: 5 }, (_, index) => Object.freeze({
  index, y: .38 + .48 * index, width: 2.68, height: .27, depth: .13,
  // 2.5x the original 24 HP: zombies and stray bullets both need longer, and
  // unchanged 25-HP repairs make rebuilding a plank take 2.5x as long.
  maxHp: 60, angle: index % 2 ? -.04 : .06,
})));

// Fill the original doorway for inactive entrances. Its historical name is
// retained for physics callers; rendering now extends ordinary timber to the
// full wall height, where the original upper-wall collider takes over.
export const SEALED_DOOR_PLATE = Object.freeze({ width: 2.6, height: 2.8, depth: .27 });

export const EXTERIOR = Object.freeze({
  bounds: EXPEDITION.bounds,
  damagePerSecond: RAIN.damagePerSecond,
});

// An AI companion counts as half a survivor for the size of a wave (owner,
// 13 October: "ils devraient compter pour des demi-joueurs"), so the count
// may be fractional: one human and one companion make 1.5.
export const COMPANION_SHARE = .5;

// Opposed escape routes stay available in every party. Apply this only at a
// wave boundary, so a join/disconnect cannot seal an entrance during combat.
// Whole doors: a fractional count rounds down (1.5 keeps the solo two).
export function defendedDoorIds(playerCount = 1) {
  const players = Math.max(1, Math.min(4, Math.floor(Number.isFinite(playerCount) ? playerCount : 1)));
  return players === 1 ? ['west', 'east'] : players === 2 ? ['west', 'east', 'north'] : ['west', 'east', 'north', 'south'];
}

// One shared, continuous curve keeps the HUD and authoritative simulation in
// agreement. More survivors bring almost proportionally more late-wave enemies.
// A fractional count (companions) lands between the whole ones.
export function waveBalance(wave = 1, playerCount = 1) {
  const level = Math.max(1, Math.min(MAX_WAVES, Math.floor(Number.isFinite(wave) ? wave : 1)));
  const difficulty = difficultyLevel(level);
  const players = Math.max(1, Math.min(4, Number.isFinite(playerCount) ? playerCount : 1));
  const progress = (difficulty - 1) / (LEGACY_MAX_WAVES - 1);
  const soloTotal = Math.round(8 + 92 * progress ** 1.08)
    + Math.round(60 * Math.max(0, (difficulty - 10) / 20) ** 1.15);
  return Object.freeze({
    wave: level,
    soloTotal,
    total: Math.round(soloTotal * (1 + (0.55 + 0.3 * progress) * (players - 1))),
    // Informational average; spawnZombie uses the exact fixed family health.
    zombieHp: Math.round(enemyHealthMean(level)),
    headshotMultiplier: 2.2,
    walkerSpeed: 1.15 + 0.65 * progress,
    runnerSpeed: 1.85 + 0.6 * progress,
    runnerChance: difficulty < 3 ? 0 : 0.08 + 0.32 * progress,
    bruteHp: Math.round(enemyHealthMean(level, true)),
    brutes: difficulty >= 8 ? 2 : difficulty >= 5 ? 1 : 0,
    bosses: level === MAX_WAVES ? 1 : 0,
    bossHp: BOSS_HP,
    maxActive: Math.round(18 + 24 * progress + 6 * (players - 1)),
    spawnInterval: (1.1 - 0.84 * progress) / Math.sqrt(players),
  });
}
