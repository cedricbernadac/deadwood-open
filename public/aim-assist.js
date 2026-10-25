// Presentation/input assistance only. Damage and hits remain server-authoritative.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finitePoint = point => point && [point.x, point.y, point.z].every(Number.isFinite);
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const profiles = Object.freeze({
  // Light preserves the original Normal tuning. Stronger profiles widen the
  // acquisition zone and add noticeable friction, without a snap or idle aim.
  light: Object.freeze({ maxRange: 60, cone: 6 * Math.PI / 180, slowdown: .28, trackingSpeed: .16 }),
  normal: Object.freeze({ maxRange: 60, cone: 9 * Math.PI / 180, slowdown: .58, trackingSpeed: .60 }),
  strong: Object.freeze({ maxRange: 60, cone: 12 * Math.PI / 180, slowdown: .75, trackingSpeed: .95 }),
});

function targetPoint(candidate) {
  if (finitePoint(candidate.aimPoint)) return candidate.aimPoint;
  if (!finitePoint(candidate)) return null;
  const scale = Number.isFinite(candidate.scale) ? clamp(candidate.scale, .25, 3) : 1;
  const height = Number.isFinite(candidate.height) && candidate.height > 0
    ? clamp(candidate.height, .5, 5) : (candidate.crouched ? 1.05 : 1.85) * scale;
  return { x: candidate.x, y: candidate.y + height * .67, z: candidate.z };
}

export function createAimAssist() {
  let previousId = null;
  return {
    reset() { previousId = null; },
    update({ eye, yaw, pitch, lookX = 0, lookY = 0, yawDelta = 0, pitchDelta = 0,
      dt = 0, deltaSeconds = dt, candidates = [], level = 'normal', inputSource = 'gamepad', isBlocked = () => false } = {}) {
      const rawYaw = Number.isFinite(yawDelta) ? yawDelta : 0, rawPitch = Number.isFinite(pitchDelta) ? pitchDelta : 0;
      const unchanged = { yawDelta: rawYaw, pitchDelta: rawPitch, targetId: null, slowdown: 1 };
      const profile = profiles[level], intent = Math.min(1, Math.hypot(Number.isFinite(lookX) ? lookX : 0, Number.isFinite(lookY) ? lookY : 0));
      if (!profile || inputSource !== 'gamepad' || intent <= .001 || !finitePoint(eye) || !Number.isFinite(yaw) || !Number.isFinite(pitch)) {
        previousId = null; return unchanged;
      }
      const elapsed = Number.isFinite(deltaSeconds) ? clamp(deltaSeconds, 0, .05) : 0;
      if (elapsed === 0) return unchanged;
      const cp = Math.cos(pitch), forward = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
      const choices = [];
      for (const candidate of Array.isArray(candidates) ? candidates : []) {
        if (!candidate || candidate.id == null || !Number.isFinite(candidate.hp) || candidate.hp <= 0
          || candidate.alive === false || candidate.downed === true || candidate.friendly === true || candidate.visible === false) continue;
        const point = targetPoint(candidate);
        if (!point) continue;
        const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z, distance = Math.hypot(dx, dy, dz);
        if (distance < .2 || distance > profile.maxRange) continue;
        const alignment = (dx * forward.x + dy * forward.y + dz * forward.z) / distance;
        if (alignment <= 0) continue;
        const angle = Math.acos(clamp(alignment, -1, 1));
        if (angle > profile.cone || isBlocked(candidate, point) === true) continue;
        choices.push({ candidate, point, distance, angle, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
      }
      choices.sort((a, b) => a.angle - b.angle || a.distance - b.distance || String(a.candidate.id).localeCompare(String(b.candidate.id)));
      let target = choices[0];
      const previous = choices.find(choice => choice.candidate.id === previousId);
      if (previous && target && previous.angle <= target.angle * 1.3 + .35 * Math.PI / 180) target = previous;
      if (!target) { previousId = null; return unchanged; }
      previousId = target.candidate.id;
      const centered = 1 - target.angle / profile.cone;
      const distanceWeight = .5 + .5 * (1 - target.distance / profile.maxRange);
      const slowdown = 1 - profile.slowdown * centered * distanceWeight;
      let adjustedYaw = rawYaw * slowdown, adjustedPitch = rawPitch * slowdown;
      const errorYaw = wrap(target.yaw - yaw - adjustedYaw), errorPitch = target.pitch - pitch - adjustedPitch;
      // Follow only axes the player is actively steering towards the target.
      // In particular, a horizontal sweep at head height must not pull down
      // towards the torso, and a deliberate turn away always wins.
      const followYaw = adjustedYaw * errorYaw > 0 ? errorYaw : 0;
      const followPitch = adjustedPitch * errorPitch > 0 ? errorPitch : 0;
      const followLength = Math.hypot(followYaw, followPitch);
      if (followLength > 1e-8) {
        const maximum = profile.trackingSpeed * elapsed * intent * (.4 + .6 * centered) * distanceWeight;
        const fraction = Math.min(1, maximum / followLength);
        adjustedYaw += followYaw * fraction; adjustedPitch += followPitch * fraction;
      }
      return { yawDelta: adjustedYaw, pitchDelta: adjustedPitch, targetId: target.candidate.id, slowdown };
    },
  };
}
