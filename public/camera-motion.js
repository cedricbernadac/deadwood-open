import { HAS_SPACE } from './level-config.js';
import { spaceFlightAt, spaceTreadY, spaceRampY } from './level-space.js';
// Presentation only: real player feet and collisions still follow the treads.
import { STAIR_CONTACT, stairContactY, stairRampY } from './stairs.js';

export const CAMERA_SMOOTHING_KEY = 'deadwood-camera-smoothing-v1';
export const CAMERA_SMOOTHING_DEFAULTS = Object.freeze({ heightMs: 45, recoilMs: 31 });
export const CAMERA_SMOOTHING_LIMITS = Object.freeze({ heightMs: 150, recoilMs: 100 });

export function normalizeCameraSmoothing(value) {
  return Object.fromEntries(Object.entries(CAMERA_SMOOTHING_DEFAULTS).map(([key, fallback]) =>
    [key, Number.isFinite(value?.[key]) ? Math.max(0, Math.min(CAMERA_SMOOTHING_LIMITS[key], value[key])) : fallback]));
}

// A time constant: after this many milliseconds, 63% of the gap is closed.
// Zero explicitly disables damping; this never changes player simulation.
export function cameraSmoothingAlpha(delta, milliseconds) {
  return milliseconds <= 0 ? 1 : 1 - Math.exp(-Math.max(0, delta) * 1000 / milliseconds);
}

// Match the current player footprint when checking actual tread support. The
// foot of the flight supports the first tread before its centre reaches z=2.5.
const PLAYER_RADIUS = .25;
// LAN snapshots round to millimetres. A rounded Z can also cross a tread edge.
const SUPPORT_EPSILON = .001;
const SNAPSHOT_Z_EPSILON = .00051;

export function cameraSupportHeight(pose, supportPose = pose) {
  if (!pose || !Number.isFinite(pose.y) || !supportPose || supportPose.grounded !== true
    || ![supportPose.x, supportPose.y, supportPose.z].every(Number.isFinite)) return pose?.y;
  if (HAS_SPACE) {
    const flight = spaceFlightAt(supportPose.x, supportPose.z, supportPose.y, PLAYER_RADIUS);
    if (!flight || ![0, -SNAPSHOT_Z_EPSILON, SNAPSHOT_Z_EPSILON].some(offset =>
      Math.abs(supportPose.y - spaceTreadY(flight, supportPose.z + offset)) <= SUPPORT_EPSILON)) return pose.y;
    return spaceRampY(flight, supportPose.z) + (pose.y - supportPose.y);
  }
  const onFlight = supportPose.x >= STAIR_CONTACT.minX - PLAYER_RADIUS
    && supportPose.x <= STAIR_CONTACT.maxX + PLAYER_RADIUS
    && supportPose.z >= STAIR_CONTACT.minZ - PLAYER_RADIUS
    && supportPose.z <= STAIR_CONTACT.maxZ + PLAYER_RADIUS;
  const matchesTread = [0, -SNAPSHOT_Z_EPSILON, SNAPSHOT_Z_EPSILON].some(offset =>
    Math.abs(supportPose.y - stairContactY(supportPose.z + offset)) <= SUPPORT_EPSILON);
  if (!onFlight || !matchesTread) return pose.y;
  // Online pose already includes the reconciliation offset. Recognize support
  // on raw predicted feet and retain that offset instead of losing the ramp.
  return stairRampY(supportPose.z) + (pose.y - supportPose.y);
}
