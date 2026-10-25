import { EXTERIOR_WALLS, EXTERIOR_WALL_THICKNESS, INTERIOR_WALLS } from './layout.js';

// Client-only combat feel: camera shake, hit-stop, the push that throws a
// dead zombie back, barrel heat and where casings leave each gun. Nothing
// here changes a rule, a hit or the aim; it only shapes what is drawn.

// Camera trauma: shocks add trauma, which drains away; the shake grows with
// its square, so small knocks stay subtle and big blasts really rattle.
export const SHAKE = Object.freeze({ decay: 1.5, maxOffset: .075, maxRoll: .04, frequency: 24 });

export function createCameraShake() {
  let trauma = 0, phase = 0;
  return {
    add(amount) { if (Number.isFinite(amount) && amount > 0) trauma = Math.min(1, trauma + amount); },
    get trauma() { return trauma; },
    reset() { trauma = 0; },
    // Offsets for this frame. `strength` is the player's setting (0..1).
    sample(delta, strength = 1, out = { x: 0, y: 0, roll: 0 }) {
      const step = Number.isFinite(delta) && delta > 0 ? Math.min(delta, .1) : 0;
      phase += step * SHAKE.frequency;
      trauma = Math.max(0, trauma - step * SHAKE.decay);
      const amount = trauma * trauma * Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1));
      // Sums of sines at unrelated rates: smooth, never a visible loop.
      out.x = amount * SHAKE.maxOffset * (Math.sin(phase) * .6 + Math.sin(phase * 2.31 + 1.7) * .4);
      out.y = amount * SHAKE.maxOffset * (Math.sin(phase * 1.13 + .4) * .6 + Math.sin(phase * 2.71 + 2.9) * .4);
      out.roll = amount * SHAKE.maxRoll * (Math.sin(phase * .87 + 2.2) * .7 + Math.sin(phase * 1.93 + .3) * .3);
      return out;
    },
  };
}

// A blast close by rattles the view; far away it is only heard.
export function explosionTrauma(distance, { rocket = false } = {}) {
  const reach = rocket ? 24 : 17;
  if (!Number.isFinite(distance) || distance < 0 || distance >= reach) return 0;
  const near = 1 - distance / reach;
  return .05 + (rocket ? .8 : .65) * near * near;
}
// The kick of your own heavy shots, on top of the existing recoil.
export const SHOT_TRAUMA = Object.freeze({ shotgun: .16, magnum: .13, sniper: .12, rocket: .22 });

// Hit-stop: the world's clock nearly freezes for a few hundredths of a
// second when your shot kills, so the blow lands. Mouse look never stops.
export const HIT_STOP = Object.freeze({ kill: .04, headshot: .05, headshotKill: .065, heavy: .075, melee: .055, meleeHeavy: .085, cooldown: .22, scale: .06 });

export function createHitStop() {
  let until = -Infinity, readyAt = -Infinity;
  return {
    // `now` is real time in seconds. Returns true when a stop starts.
    trigger(kind, now) {
      const length = HIT_STOP[kind];
      if (!(length > 0) || kind === 'cooldown' || kind === 'scale' || !Number.isFinite(now) || now < readyAt) return false;
      until = now + length; readyAt = now + HIT_STOP.cooldown;
      return true;
    },
    scale(now) { return Number.isFinite(now) && now < until ? HIT_STOP.scale : 1; },
    reset() { until = -Infinity; readyAt = -Infinity; },
  };
}

// The last enemy of a wave falls in slow motion: the world's clock runs at
// `scale` for most of `duration` (real seconds), then eases back to full
// speed. Purely visual: the server, the aim and the controls never slow.
export const LAST_KILL_SLOWMO = Object.freeze({ duration: .9, scale: .3, ease: .35 });
export function createSlowMotion() {
  let start = -Infinity, end = -Infinity;
  return {
    // `at` may lie a little ahead (a rocket still in flight).
    trigger(at) { if (!Number.isFinite(at)) return false; start = at; end = at + LAST_KILL_SLOWMO.duration; return true; },
    scale(now) {
      if (!Number.isFinite(now) || now < start || now >= end) return 1;
      const left = (end - now) / LAST_KILL_SLOWMO.duration;
      if (left > LAST_KILL_SLOWMO.ease) return LAST_KILL_SLOWMO.scale;
      const back = 1 - left / LAST_KILL_SLOWMO.ease;
      return LAST_KILL_SLOWMO.scale + (1 - LAST_KILL_SLOWMO.scale) * back * back;
    },
    reset() { start = -Infinity; end = -Infinity; },
  };
}

// A heavy death: the body is shoved back, sometimes lifted a little, and
// falls faster. Explosions and point-blank blasts only; never a cartoon flight.
export const KNOCKBACK = Object.freeze({
  grenade: Object.freeze({ distance: 1.5, hop: .3, fall: .34 }),
  rocket: Object.freeze({ distance: 1.7, hop: .36, fall: .32 }),
  shotgun: Object.freeze({ distance: 1, hop: .08, fall: .38, range: 6 }),
  magnum: Object.freeze({ distance: .6, hop: .03, fall: .42, range: 12 }),
  sniper: Object.freeze({ distance: .7, hop: .04, fall: .42 }),
  hammer: Object.freeze({ distance: 1.1, hop: .14, fall: .36 }),
  bat: Object.freeze({ distance: 1, hop: .1, fall: .38 }),
  fireaxe: Object.freeze({ distance: .7, hop: .04, fall: .42 }),
});

export function knockbackFor(event) {
  const profile = KNOCKBACK[event?.weapon];
  if (!profile) return null;
  let scale = 1;
  if (profile.range) {
    const range = Number(event.range);
    if (!Number.isFinite(range) || range > profile.range) return null;
    // Point blank pushes hardest, the edge of the range barely.
    scale = 1 - .55 * Math.max(0, range) / profile.range;
  }
  return { distance: profile.distance * scale, hop: profile.hop * scale, fall: profile.fall };
}

// Every wall a body could be shoved into, as a box: the four outer walls
// (doorway and windows included, so a body stops at an opening rather than
// risk the wall beside it), the partition and the low wall.
const SLIDE_WALLS = Object.freeze([
  ...EXTERIOR_WALLS.map(wall => wall.axis === 'x'
    ? { minX: -wall.length / 2, maxX: wall.length / 2, minZ: wall.fixed - EXTERIOR_WALL_THICKNESS / 2, maxZ: wall.fixed + EXTERIOR_WALL_THICKNESS / 2 }
    : { minX: wall.fixed - EXTERIOR_WALL_THICKNESS / 2, maxX: wall.fixed + EXTERIOR_WALL_THICKNESS / 2, minZ: -wall.length / 2, maxZ: wall.length / 2 }),
  ...INTERIOR_WALLS.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ })),
].map(Object.freeze));
// Distance along a unit ray to where it enters `box` grown by `grow`:
// negative when it starts inside, Infinity when it never touches it.
function boxEntry(x, z, ux, uz, box, grow) {
  let enter = -Infinity, exit = Infinity;
  for (const [start, step, min, max] of [[x, ux, box.minX - grow, box.maxX + grow], [z, uz, box.minZ - grow, box.maxZ + grow]]) {
    if (Math.abs(step) < 1e-9) { if (start < min || start > max) return Infinity; continue; }
    const a = (min - start) / step, b = (max - start) / step;
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  return enter <= exit && exit > 0 ? enter : Infinity;
}
// Shorten a slide so no part of the body crosses a wall. `reach` is how far
// the body topples beyond its feet along the slide (about its height). A body
// already that close to a wall only slides when moving away from it.
export function clampSlide(x, z, dirX, dirZ, distance, { margin = .35, reach = 0 } = {}) {
  if (![x, z, dirX, dirZ, distance].every(Number.isFinite) || distance <= 0) return 0;
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-9) return 0;
  const ux = dirX / length, uz = dirZ / length, grow = margin + (Number.isFinite(reach) ? Math.max(0, reach) : 0);
  let limit = distance;
  for (const box of SLIDE_WALLS) {
    const enter = boxEntry(x, z, ux, uz, box, grow);
    if (enter >= limit) continue;
    if (enter > 0) limit = enter;
    else if (boxEntry(x, z, ux, uz, box, 0) !== Infinity) limit = 0;
  }
  return Math.max(0, limit);
}

// Barrel heat: every round warms the gun, which cools down over a few
// seconds. A warm barrel at rest breathes thin smoke; a hot minigun glows.
export const HEAT = Object.freeze({
  perShot: Object.freeze({ pistol: .07, smg: .045, assault: .055, rifle: .045, minigun: .028, shotgun: .3, magnum: .3, sniper: .38, rocket: .45 }),
  cool: 2.6, smokeFrom: .2, idle: .14, maxWisps: 18,
});

export function createBarrelHeat() {
  let heat = 0, at = 0, lastShot = -Infinity, carry = 0;
  const level = time => Number.isFinite(time) ? heat * Math.exp(-Math.max(0, time - at) / HEAT.cool) : 0;
  return {
    shot(weapon, time) {
      const add = HEAT.perShot[weapon];
      if (!(add > 0) || !Number.isFinite(time)) return;
      heat = Math.min(1, level(time) + add); at = time; lastShot = time;
    },
    level,
    // Whole wisps to emit over this frame, only while the trigger rests.
    wisps(time, delta) {
      const warm = level(time);
      if (!Number.isFinite(delta) || delta <= 0 || warm <= HEAT.smokeFrom || time - lastShot < HEAT.idle) { carry = 0; return 0; }
      carry += delta * (2 + HEAT.maxWisps * (warm - HEAT.smokeFrom) / (1 - HEAT.smokeFrom));
      const count = Math.floor(carry); carry -= count;
      return Math.min(count, 4);
    },
    reset() { heat = 0; at = 0; lastShot = -Infinity; carry = 0; },
  };
}

// Where each gun spits its casing, in the gun's own frame (x right, y up,
// -z forward), which kind it is and how long after the shot it leaves:
// a pump shotgun and a bolt rifle eject when they are cycled.
export const CASING_PORTS = Object.freeze({
  pistol: Object.freeze({ kind: 'pistol', port: Object.freeze([.026, .045, -.11]), delay: 0 }),
  smg: Object.freeze({ kind: 'pistol', port: Object.freeze([.032, .03, -.13]), delay: 0 }),
  assault: Object.freeze({ kind: 'rifle', port: Object.freeze([.036, .042, -.19]), delay: 0 }),
  rifle: Object.freeze({ kind: 'rifle', port: Object.freeze([.04, .032, -.2]), delay: 0 }),
  minigun: Object.freeze({ kind: 'minigun', port: Object.freeze([.05, -.045, -.16]), delay: 0, drop: true }),
  sniper: Object.freeze({ kind: 'sniper', port: Object.freeze([.035, .07, -.1]), delay: .52 }),
  shotgun: Object.freeze({ kind: 'shell', port: Object.freeze([.036, .02, -.14]), delay: .4 }),
});
export function casingPort(weapon) { return CASING_PORTS[weapon] ?? null; }
