// Keep the selected 25–30 s recording intact. Its first second is the motor
// introduction; confirmed fire starts at 1 s and loops only sustained fire.
export const MINIGUN_TIMING = Object.freeze({ windup: 1, fireOffset: 1, loopStart: 1.05, loopEnd: 4.7, crossfade: .04, rotorSpeed: 24 });

export function minigunRotorSpeed({ spinning = false, spinLeft = 0, duration = MINIGUN_TIMING.windup, reloading = false, downed = false } = {}) {
  if (!spinning || reloading || downed) return 0;
  const total = Number.isFinite(duration) && duration > 0 ? duration : MINIGUN_TIMING.windup;
  const remaining = Number.isFinite(spinLeft) ? Math.max(0, spinLeft) : total;
  return MINIGUN_TIMING.rotorSpeed * Math.max(0, Math.min(1, 1 - remaining / total));
}

// Shared by the client schedule and the server's slots. The client carries
// up to one 30 Hz tick of frame lateness (so 30 FPS keeps the full cadence).
// `early`: how far ahead of its slot a round may reach the server, i.e. the
// delivery jitter it absorbs (a tick, less for very fast guns). `carry`: how
// late a round may arrive and keep its slot. carry + early stays below the
// interval, so two rounds never land together; the long-run rate is exactly
// one round per interval.
export const FIRE_FRAME_CARRY = 1 / 30;
export function fireTolerance(interval) {
  const safe = Number.isFinite(interval) && interval > 0 ? interval : 0;
  const early = Math.max(0, Math.min(FIRE_FRAME_CARRY, (safe - FIRE_FRAME_CARRY) * .45));
  return { early, carry: FIRE_FRAME_CARRY + early };
}

// Every held weapon fires on that schedule: one request per rendered frame,
// carrying ordinary frame lateness forward (leaving the server room for
// delivery jitter). Longer stalls start a fresh period rather than replaying
// missed projectiles.
export function firingSchedule(now, nextAt, interval) {
  if (!Number.isFinite(now) || !Number.isFinite(interval) || interval <= 0) return { fire: false, nextAt: null };
  if (Number.isFinite(nextAt) && now + 1e-8 < nextAt) return { fire: false, nextAt };
  const start = Number.isFinite(nextAt) && now - nextAt <= Math.min(interval, FIRE_FRAME_CARRY) + 1e-9 ? nextAt : now;
  return { fire: true, nextAt: start + interval };
}
