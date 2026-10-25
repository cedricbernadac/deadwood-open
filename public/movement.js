import { LEVEL } from './level-config.js';
// Shared posture dimensions. Positions always describe the feet, never the eyes.
export const PLAYER_POSTURE = Object.freeze({
  standingHeight: 1.75, crouchedHeight: 1.05,
  standingEye: 1.55, crouchedEye: .88, crouchSpeed: .52,
});
export const playerHeight = player => player.crouched ? PLAYER_POSTURE.crouchedHeight : PLAYER_POSTURE.standingHeight;
export const playerEyeHeight = player => player.crouched ? PLAYER_POSTURE.crouchedEye : PLAYER_POSTURE.standingEye;
// A standing (or crouched) survivor's body for the shots, blows and blasts
// that can reach it: raider guns, and teammates when friendly fire is on.
export const PLAYER_HALF_WIDTH = .27;
export const playerHitbox = player => ({ minX: player.x - PLAYER_HALF_WIDTH, maxX: player.x + PLAYER_HALF_WIDTH, minY: player.y,
  maxY: player.y + playerHeight(player), minZ: player.z - PLAYER_HALF_WIDTH, maxZ: player.z + PLAYER_HALF_WIDTH });

// The cabin keeps its low jumpable rail. The supermarket stockroom uses a
// tall open security grille: bodies cannot leap onto the shelving below.
// The authority and online predictor use the same volume; shots pass through.
export const LOFT_RAIL = Object.freeze({ height: LEVEL.loftRailHeight, topBarY: LEVEL.loftRailTopBarY, thickness: .1, endInset: .2 });
export const FALL_DAMAGE = Object.freeze({ safeDrop: 2.4, damagePerMeter: 15 });
export function fallDamage(drop) {
  return Number.isFinite(drop) ? Math.max(0, Math.round((drop - FALL_DAMAGE.safeDrop) * FALL_DAMAGE.damagePerMeter)) : 0;
}
