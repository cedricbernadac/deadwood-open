import { LEVEL, HAS_SPACE } from './level-config.js';
// Human raiders (les Pillards) close waves 5, 10 and 15. They live among the
// zombies with kind 'raider'; their guns never join WEAPONS, ARMORY or the
// zombie spawn entries. Shared by the authoritative server and the client.
export const RAIDS = Object.freeze({
  waves: Object.freeze([5, 10, 15]),
  base: Object.freeze([2, 4, 6]),
  extraPerPlayer: .5,
  hp: Object.freeze([175, 250, 325]),
  bodyDamage: Object.freeze([1, 1, .8]),
  damageScale: Object.freeze([.5, .85, 1, 1]),
  // A late trigger (one live zombie per survivor): with 3 + 2 per survivor, a
  // solo average human still facing the zombie tail went down in 37.5 % of raid-3 runs.
  triggerBase: 0, triggerPerPlayer: 1, bruteWeight: 4,
  fallbackAfter: 35, fallbackFactor: 2,
  holdForFuel: 45, holdDistance: 30,
  squadSize: Object.freeze([2, 2, 3, 3]),
  soloStagger: 4,
  nextSquadAfter: Object.freeze([30, 20, 20, 20]),
  warning: 2.5, entryClearance: 3,
  capAfterLastSquad: 150, capAfterTrigger: 300,
  stuckRetreatAfter: 20,
  retreatSpeed: 3, retreatDespawnDistance: 18, retreatMaxSeconds: 12,
  targetRadius: 45,
  cash: 40, headshotCash: 60,
  clearBonus: Object.freeze([50, 100, 150]),
  lootLifetime: 240,
});

const entry = (doorId, side, x, z) => Object.freeze({ id: `raid-${doorId}-${side}`, doorId, x, z });
// Two woodland exits per door, 22 m beyond the facade and 5 m to either side.
export const RAID_ENTRIES = HAS_SPACE ? LEVEL.raidEntries : Object.freeze([
  entry('north', 'a', -5, -28), entry('north', 'b', 5, -28),
  entry('south', 'a', -5, 28), entry('south', 'b', 5, 28),
  entry('west', 'a', -30, -5), entry('west', 'b', -30, 5),
  entry('east', 'a', 30, -5), entry('east', 'b', 30, 5),
]);

// Damage is per hit on a survivor, before the plan's damageScale and armour.
// `ref` names the player weapon whose distance curve scales it (capped 1.15).
// The original calibration is in raid-balance-2026-10-11.md. The later pressure
// pass tightens aim/pauses and closes distance; damage, stock and raid counts
// stay unchanged. Reproduce its small comparison with raider-pressure.test.mjs.
const loadout = (key, damage, pellets, interval, burst, pause, magazine, reload, spread, range, engageRange) => Object.freeze({
  key, ref: key, model: key, sound: key, damage, pellets, interval,
  burst: Object.freeze(burst), pause: Object.freeze(pause), magazine, reload, spread, range, engageRange,
});
export const RAIDER_LOADOUTS = Object.freeze({
  pistol: loadout('pistol', 10, 1, .45, [2, 3], [.5, .8], 12, 1.8, .032, 30, 9),
  smg: loadout('smg', 7, 1, .10, [4, 7], [.4, .7], 30, 2.3, .042, 26, 9),
  shotgun: loadout('shotgun', 5, 8, .95, [1, 1], [0, 0], 6, 3.2, .080, 15, 6),
  assault: loadout('assault', 11, 1, .16, [3, 4], [.35, .6], 24, 2.4, .026, 42, 10),
  rifle: loadout('rifle', 9, 1, .12, [6, 9], [.6, .9], 40, 3, .032, 46, 10),
});
// The tunable part of a raider's aim error (section 4), kept with the other
// raid numbers so the balance report can record and tune it.
export const RAIDER_AIM_TUNING = Object.freeze({
  reaction: Object.freeze([.42, .28]), reactionRaid3: Object.freeze([.34, .22]), peek: Object.freeze([.20, .12]),
  settle: .08, peekSettle: .04, settleTime: .95,
  motionGain: .12, motionFloor: 6, motionMax: .055, running: .025, strafing: .012,
  // Running in from the treeline, a raider holds fire until his target is this close.
  advanceFireRange: 16,
});
// Composition by raider ordinal (1-based, cycling), one list per raid.
export const RAID_COMPOSITIONS = Object.freeze([
  Object.freeze(['smg', 'pistol', 'shotgun', 'smg', 'pistol']),
  Object.freeze(['assault', 'smg', 'shotgun', 'rifle', 'assault', 'smg']),
  Object.freeze(['rifle', 'assault', 'shotgun', 'assault', 'rifle', 'smg']),
]);
export const DRILL_LOADOUTS = Object.freeze(['smg', 'assault']);
// Raiders plank barricades with a fixed amount per shot, never per pellet.
export const RAIDER_PLANK_DAMAGE = 8;

// Whole survivors, like the defended doors: a companion counts half (1.5 → 1).
export const raidPlayers = count => Math.max(1, Math.min(4, Math.floor(Number.isFinite(count) ? count : 1)));
export const raidIndex = wave => RAIDS.waves.indexOf(wave) + 1;
export function raidTotal(index, players = 1) {
  const base = RAIDS.base[index - 1];
  return base === undefined ? 0 : Math.round(base * (1 + RAIDS.extraPerPlayer * (raidPlayers(players) - 1)));
}
export const raidSquad = players => RAIDS.squadSize[raidPlayers(players) - 1];
export const raidDamageScale = players => RAIDS.damageScale[raidPlayers(players) - 1];
export function raiderLoadout(index, ordinal) {
  const composition = RAID_COMPOSITIONS[Math.max(0, Math.min(RAID_COMPOSITIONS.length, index) - 1)];
  return composition[(Math.max(1, ordinal) - 1) % composition.length];
}
