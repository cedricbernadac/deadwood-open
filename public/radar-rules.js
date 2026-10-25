import { bonusDebt } from './character-sheet.js';
// Shared limits for the personal field radar and its inexpensive 2D display.
// The radar is a permanent bonus: each level shortens the interval between
// map pulses, from one blip every 8 seconds down to a continuous map. It opens
// with the first crate so a dedicated player can reach level 8 by wave 18.
export const RADAR = Object.freeze({
  unlockWave: 2, range: 25, refreshSeconds: .2,
  blipSeconds: Object.freeze([8, 7, 6, 5, 4, 3, 2, .2]),
  blipVisibleSeconds: 2,
});

export function radarBlipSeconds(level = 1) {
  const bounded = Math.max(1, Math.min(RADAR.blipSeconds.length, Number.isFinite(level) ? Math.round(level) : 1));
  return RADAR.blipSeconds[bounded - 1];
}

// A sheet's Bricolage debt lowers a picked-up radar (effective = level − debt).
export function reconLevel(player) {
  return Math.max(0, Math.min(8, Math.floor(Number(player?.bonus?.radar) || 0)) - bonusDebt(player, 'radar'));
}
export function radarInformation(level) {
  return { presence: level >= 1, sectors: level >= 2, positions: level >= 3,
    types: level >= 5, floor: level >= 6, health: level >= 7, exactHealth: level >= 8 };
}
export function radarPulseIndex(level, timeSeconds) {
  return level > 0 && Number.isFinite(timeSeconds) ? Math.floor(Math.max(0, timeSeconds) / radarBlipSeconds(level)) : -1;
}
