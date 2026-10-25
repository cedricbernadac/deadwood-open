// Regression captures for current calibrated bullet damage, 17 October 2026.
// Replayed through the real server/client/blood chain after the 10 m calibration:
// shotgun entry points/head shares are unchanged; its higher initial damage
// adds one burst droplet. The pistol's new curve changes power, not its count.
// The historical SHOTS/ROWS in blood-wounds.mjs remain artistic replay data.
const row = value => Object.freeze(value);
export const PHYSICAL_SPRAYS = Object.freeze({
  colossusHead: row({ wounds: 9, heads: 7, D: 594.572, burst: 56, back: 28, exit: 28, globs: 2, fountain: 8, kill: 0, puffs: 18, medium: 82 }),
  colossusKill: row({ wounds: 9, heads: 7, D: 594.572, burst: 56, back: 28, exit: 28, globs: 2, fountain: 0, kill: 29, puffs: 18, medium: 103 }),
  pistolBody3: row({ wounds: 1, heads: 0, D: 25.133, burst: 10, back: 5, exit: 5, globs: 0, fountain: 0, kill: 0, puffs: 2, medium: 12 }),
  walkerHeadKill: row({ wounds: 9, heads: 9, D: 675.540, burst: 44, back: 22, exit: 22, globs: 2, fountain: 0, kill: 22, puffs: 18, medium: 84 }),
});
