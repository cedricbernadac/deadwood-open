import * as THREE from '/vendor/three.module.js';
import { sharedEffects } from './fx.js';

// Shots you can see and feel: glowing bullets sized by their damage, a
// spray of pellets, sparks and dust on every impact, golden bursts on hits,
// flames that roll and smoke, and cartoon explosions. Everything draws in
// the shared particle engine (fx.js): no light, no per-shot mesh.

// Damage per projectile (simulation WEAPONS) only shapes the look: the cube
// root keeps a 350-damage sniper round bold but not absurd.
const BULLET_DAMAGE = Object.freeze({ pistol: 24, rifle: 30, shotgun: 18, smg: 19, minigun: 30, magnum: 200, assault: 42, sniper: 350, rocket: 700 });
export const BULLET_SPEED = 170;
export function bulletLook(weapon, { hostile = false, local = false } = {}) {
  const weight = Math.cbrt((BULLET_DAMAGE[weapon] ?? 24) / 24), pellet = weapon === 'shotgun', rocket = weapon === 'rocket';
  return Object.freeze({
    weight, pellet, rocket,
    core: rocket ? .1 : (pellet ? .04 : .045) * weight,
    glow: rocket ? .6 : (pellet ? .17 : .21) * weight,
    length: rocket ? .8 : pellet ? .6 : Math.min(2.2, 1 + .5 * weight),
    color: hostile ? 0xff9274 : weapon === 'magnum' ? 0xffd27a : weapon === 'sniper' ? 0xeef6ff : rocket ? 0xffc06a : 0xfff0c8,
    trail: hostile ? 0xff4a34 : weapon === 'sniper' ? 0x8fc0ff : rocket ? 0xff7a2a : 0xffa64d,
    // Your own shots stay discreet near the eye; teammates and raiders shine.
    dim: local ? .5 : 1,
  });
}

// A projectile from the muzzle to where the server stopped it, at the
// tracer speed the game always used. Returns its travel time in seconds.
export function launchProjectile(start, end, { weapon = 'pistol', local = false, hostile = false, time = 0 } = {}) {
  const fx = sharedEffects(), look = bulletLook(weapon, { hostile, local });
  const length = start.distanceTo(end);
  if (!(length > 1e-4) || !Number.isFinite(time)) return 0;
  const direction = end.clone().sub(start).normalize(), travel = Math.max(.035, length / BULLET_SPEED);
  const headAt = (age, target) => target.copy(start).addScaledVector(direction, Math.min(1, age / travel) * length);
  const head = new THREE.Vector3(), tail = new THREE.Vector3();
  // The hot core rides the front; after the impact its tail catches up.
  fx.streak({ start: time, life: travel + .06, size: look.core, sizeTo: look.core, color: look.color, intensity: 2.2 * look.dim, fadeOut: .9,
    follow(p, age) {
      headAt(age, head);
      const traveled = Math.min(age, travel) / travel * length, span = Math.min(look.length, traveled);
      const behind = age > travel ? span * Math.max(0, 1 - (age - travel) / .06) : span;
      tail.copy(head).addScaledVector(direction, -behind);
      p.x = head.x; p.y = head.y; p.z = head.z; p.tx = tail.x; p.ty = tail.y; p.tz = tail.z;
    } });
  // A wider glowing wake hangs in the air a moment after the bullet passed,
  // so even a fast round leaves a readable line from barrel to target.
  const linger = .22;
  fx.streak({ start: time, life: travel + linger, size: look.core * 3.2, sizeTo: look.core * 1.4, color: look.trail, intensity: .85 * look.dim,
    fadeOut: travel / (travel + linger),
    follow(p, age) {
      headAt(age, head);
      const traveled = Math.min(age, travel) / travel * length;
      tail.copy(head).addScaledVector(direction, -Math.min(traveled, look.length * 3));
      p.x = head.x; p.y = head.y; p.z = head.z; p.tx = tail.x; p.ty = tail.y; p.tz = tail.z;
    } });
  // The bullet itself: a bright head that rides the front of the streak.
  fx.glow({ start: time, life: travel, size: look.glow, sizeTo: look.glow, color: look.color, intensity: 1.2 * look.dim, fadeOut: .95,
    follow(p, age) { headAt(age, head); p.x = head.x; p.y = head.y; p.z = head.z; } });
  if (look.rocket) {
    // A rocket leaves a lumpy smoke trail behind its flame.
    const puffs = Math.min(40, Math.ceil(length / .45));
    for (let index = 1; index <= puffs; index++) {
      const f = index / puffs, at = start.clone().addScaledVector(direction, f * length);
      fx.smoke({ start: time + f * travel, life: 1.1 + fx.random() * .5, x: at.x, y: at.y, z: at.z, vx: fx.spread(.25), vy: .35 + fx.random() * .3, vz: fx.spread(.25), drag: 1.2,
        size: .12, sizeTo: .5 + fx.random() * .25, color: 0x8d8a92, colorTo: 0x5c5866, alpha: .5, fadeIn: .05, fadeOut: .35, rotation: fx.random() * 6, spin: fx.spread(1) });
    }
  }
  return travel;
}

// Muzzle flash: a short star of light and a few sparks out of the barrel.
export function muzzleFlash(point, direction, { weapon = 'pistol', local = false, time = 0 } = {}) {
  if (!point || !Number.isFinite(time) || weapon === 'flamethrower') return;
  const fx = sharedEffects(), look = bulletLook(weapon, { local }), dir = direction?.clone?.().normalize() ?? new THREE.Vector3(0, 0, -1);
  const size = (local ? .16 : .32) * Math.min(1.8, look.weight) * (look.pellet ? 1.35 : 1);
  fx.glow({ start: time, life: .055, x: point.x, y: point.y, z: point.z, size, sizeTo: size * 1.4, color: 0xfff1c6, colorTo: 0xff9a3c, intensity: local ? 1.1 : 1.7, fadeOut: .2, rotation: fx.random() * 6 });
  if (local) return;
  for (let index = 0; index < 3; index++) {
    const speed = 7 + fx.random() * 5;
    fx.streak({ start: time, life: .07, x: point.x, y: point.y, z: point.z, vx: (dir.x + fx.spread(.25)) * speed, vy: (dir.y + fx.spread(.25)) * speed, vz: (dir.z + fx.spread(.25)) * speed,
      size: .02, sizeTo: .01, color: 0xffe2a0, intensity: 1.4, trail: .02 });
  }
}

// A look for hits on enemies, installed at run time by another look
// (art/frisson/UI-SOUND.md section 2.1): style[kind] is a recipe for
// 'zombie', 'kill' or 'headshot', with an optional .blow (a melee blow that
// did not kill) and .raider (a living enemy). Without a recipe, and always
// while the style is null, the bursts below are drawn exactly as before.
// A burst also hears which way the blow went (dirX, dirZ) and, for a kill
// drawn at the body's middle, the enemy's crown (top, a world height): only
// a look reads them.
let impactStyle = null;
export function setImpactStyle(style = null) { impactStyle = style && typeof style === 'object' ? style : null; }
export function getImpactStyle() { return impactStyle; }

const IMPACTS = Object.freeze({
  wood: { sparks: 4, spark: 0xffc070, dust: 3, dustColor: 0xb89068, flash: .22 },
  solid: { sparks: 6, spark: 0xfff0c8, dust: 3, dustColor: 0x9c9a94, flash: .26 },
  zombie: { sparks: 10, spark: 0xffd256, dust: 0, flash: .42, pop: 4 },
  kill: { sparks: 14, spark: 0xffd256, dust: 0, flash: .6, pop: 6, ring: true },
  headshot: { sparks: 18, spark: 0xffe27a, dust: 0, flash: .75, pop: 8, ring: true, stars: true },
});
// Sparks, a flash and dust where a shot lands; gold bursts on zombies.
export function impactBurst(point, { kind = 'solid', direction = null, time = 0, kill = true, raider = false, dirX = 0, dirZ = 0, top = null } = {}) {
  if (!point || !Number.isFinite(time) || ![point.x, point.y, point.z].every(Number.isFinite)) return;
  if (impactStyle?.[kind]) { styledImpact(impactStyle[kind], point, direction, time, kill, raider, dirX, dirZ, top); return; }
  const fx = sharedEffects(), style = IMPACTS[kind] ?? IMPACTS.solid;
  // Bounce back towards the shooter, plus a fan of random directions.
  const back = direction ? new THREE.Vector3(-direction.x, -direction.y, -direction.z).normalize() : new THREE.Vector3(0, 1, 0);
  fx.glow({ start: time, life: .09, x: point.x, y: point.y, z: point.z, size: style.flash * .5, sizeTo: style.flash, color: 0xfff4d6, colorTo: style.spark, intensity: 1.6, fadeOut: .3 });
  for (let index = 0; index < style.sparks; index++) {
    const speed = 3.5 + fx.random() * 4.5;
    const vx = back.x * .8 + fx.spread(1), vy = back.y * .8 + fx.spread(1) + .5, vz = back.z * .8 + fx.spread(1);
    fx.streak({ start: time, life: .22 + fx.random() * .2, x: point.x, y: point.y, z: point.z, vx: vx * speed, vy: vy * speed, vz: vz * speed,
      gravity: 9, drag: 2.2, size: .034, sizeTo: .012, color: 0xfff6dc, colorTo: style.spark, colorSpeed: 2.5, intensity: 1.6, trail: .05, fadeOut: .6 });
  }
  for (let index = 0; index < style.dust; index++) {
    fx.smoke({ start: time, life: .45 + fx.random() * .3, x: point.x + fx.spread(.05), y: point.y + fx.spread(.05), z: point.z + fx.spread(.05),
      vx: back.x * .6 + fx.spread(.4), vy: .4 + fx.random() * .4, vz: back.z * .6 + fx.spread(.4), drag: 3,
      size: .06, sizeTo: .26 + fx.random() * .12, color: style.dustColor, alpha: .55, fadeIn: .05, fadeOut: .3, rotation: fx.random() * 6, spin: fx.spread(2) });
  }
  // Little glowing "pops" drift up from a hit zombie.
  for (let index = 0; index < (style.pop ?? 0); index++) {
    fx.glow({ start: time + index * .012, life: .35 + fx.random() * .25, x: point.x, y: point.y, z: point.z,
      vx: fx.spread(1.4), vy: 1 + fx.random() * 1.6, vz: fx.spread(1.4), drag: 2.5, gravity: 1.5,
      size: .07, sizeTo: .02, color: 0xfff1b0, colorTo: 0xffb13b, intensity: 1.4, fadeOut: .5 });
  }
  if (style.ring) for (let index = 0; index < 10; index++) {
    const angle = index / 10 * Math.PI * 2;
    fx.glow({ start: time, life: .28, x: point.x, y: point.y, z: point.z, vx: Math.cos(angle) * 3.2, vy: fx.spread(.4), vz: Math.sin(angle) * 3.2, drag: 5,
      size: .08, sizeTo: .03, color: 0xfff1c0, colorTo: style.spark, intensity: 1.2, fadeOut: .4 });
  }
  if (style.stars) for (let index = 0; index < 5; index++) {
    // A head shot pops a little crown of gold stars.
    const angle = index / 5 * Math.PI * 2;
    fx.glow({ start: time + .03, life: .55, x: point.x, y: point.y + .1, z: point.z, vx: Math.cos(angle) * 1.2, vy: 1.8, vz: Math.sin(angle) * 1.2, drag: 2.2, gravity: 2,
      size: .11, sizeTo: .05, color: 0xffef9a, colorTo: 0xffc43a, intensity: 1.8, rotation: angle, spin: 6, fadeOut: .6 });
  }
}

// A styled burst, in the Famille formulas: a flash, embers flying back along
// the shot, then the dark layers (ash, and grit rising by `lift`) in the
// alpha-blended smoke pool, since the additive pools can only add light.
// A kill burst drawn at the body's middle (one given its crown, `top`) would
// stay hidden in the torso: the recipe's `front` brings it out of the body
// toward the killer (against dirX, dirZ), `under` keeps it on a body lower
// than the kill's 1 m (a crawler), and the grit rises from the crown.
// Embers start a little apart (`jitter`) and may kindle as they fly out
// (`fadeIn`), so their additive light never piles into a hot core. Scratch
// vectors and positional arguments: nothing allocated per hit beyond the
// particle options Famille passes too.
const styledBack = new THREE.Vector3(), styledAt = new THREE.Vector3();
function styledImpact(own, point, direction, time, kill, raider, dirX, dirZ, top) {
  // A living enemy's recipe first, then a blow that did not kill (each may have its own).
  const base = raider && own.raider ? own.raider : own, recipe = kill === false && base.blow ? base.blow : base;
  const fx = sharedEffects(), back = direction ? styledBack.set(-direction.x, -direction.y, -direction.z).normalize() : styledBack.set(0, 1, 0);
  const whole = Number.isFinite(top), away = whole && recipe.front && Number.isFinite(dirX) && Number.isFinite(dirZ) ? Math.hypot(dirX, dirZ) : 0, reach = away > 1e-6 ? recipe.front / away : 0;
  const at = whole ? styledAt.set(point.x - (reach && dirX * reach), Math.min(point.y, top - (recipe.under ?? 0)), point.z - (reach && dirZ * reach)) : point;
  const { flash, embers, ash, grit } = recipe;
  if (flash) fx.glow({ start: time, life: flash.life, x: at.x, y: at.y, z: at.z, size: flash.size[0], sizeTo: flash.size[1], color: flash.color, colorTo: flash.colorTo, intensity: flash.intensity, fadeOut: .3 });
  const jitter = embers?.jitter ?? 0;
  for (let index = 0; index < (embers?.count ?? 0); index++) {
    const speed = embers.speed[0] + fx.random() * (embers.speed[1] - embers.speed[0]);
    const vx = back.x * .8 + fx.spread(1), vy = back.y * .8 + fx.spread(1) + embers.up, vz = back.z * .8 + fx.spread(1);
    fx.streak({ start: time, life: embers.life[0] + fx.random() * (embers.life[1] - embers.life[0]), x: at.x + (jitter && fx.spread(jitter)), y: at.y + (jitter && fx.spread(jitter)), z: at.z + (jitter && fx.spread(jitter)),
      vx: vx * speed, vy: vy * speed, vz: vz * speed, gravity: embers.gravity, drag: embers.drag, size: embers.size[0], sizeTo: embers.size[1], color: embers.color, colorTo: embers.colorTo, colorSpeed: 2.5,
      intensity: embers.intensity, trail: embers.trail, fadeIn: embers.fadeIn ?? 0, fadeOut: .6 });
  }
  if (ash) styledSmoke(fx, ash, at, back, time, 0);
  // The bone dust rises above the head itself: from the crown when it is known.
  if (grit) styledSmoke(fx, grit, point, back, time, (whole ? top - point.y : 0) + (grit.lift ?? 0));
}
function styledSmoke(fx, layer, point, back, time, lift) {
  const jitter = layer.jitter ?? 0;
  for (let index = 0; index < layer.count; index++) {
    fx.smoke({ start: time, life: layer.life[0] + fx.random() * (layer.life[1] - layer.life[0]),
      x: point.x + fx.spread(jitter), y: point.y + lift + fx.spread(jitter), z: point.z + fx.spread(jitter),
      vx: back.x * layer.vx + fx.spread(layer.spread), vy: layer.vy[0] + fx.random() * (layer.vy[1] - layer.vy[0]), vz: back.z * layer.vx + fx.spread(layer.spread),
      drag: layer.drag, gravity: layer.gravity ?? 0, size: layer.size[0], sizeTo: layer.size[1] + fx.random() * (layer.size[2] - layer.size[1]),
      color: layer.color, colorTo: layer.colorTo, alpha: layer.alpha, fadeIn: .08, fadeOut: .35, rotation: fx.random() * 6, spin: fx.spread(1.5) });
  }
}

// Rolling flame from the nozzle to where the server stopped it.
const FLAME = Object.freeze({ rate: 170, speed: 10, grow: .95 });
export function createFlameEmitter() {
  const fx = sharedEffects();
  const start = new THREE.Vector3(), end = new THREE.Vector3(), direction = new THREE.Vector3();
  let length = 0, until = -Infinity, last = null;
  return {
    aim(from, to, time, coneAngle = .5) {
      start.copy(from); end.copy(to); direction.copy(to).sub(from);
      length = direction.length(); if (length > 1e-4) direction.divideScalar(length);
      until = (Number.isFinite(time) ? time : 0) + .19; this.cone = coneAngle;
    },
    stop() { until = -Infinity; last = null; },
    update(time) {
      if (!Number.isFinite(time) || time >= until || length <= .01) { last = null; return false; }
      if (last === null || time - last > .25) last = time - 1 / FLAME.rate;
      const spread = Math.tan((this.cone ?? .5) / 2), life = Math.max(.12, length / FLAME.speed);
      for (; last < time; last += 1 / FLAME.rate) {
        const jitter = .85 + fx.random() * .3, sideX = fx.spread(spread), sideY = fx.spread(spread), sideZ = fx.spread(spread);
        const vx = (direction.x + sideX) * FLAME.speed, vy = (direction.y + sideY) * FLAME.speed, vz = (direction.z + sideZ) * FLAME.speed;
        fx.glow({ start: last, life: life * jitter, x: start.x, y: start.y, z: start.z, vx, vy, vz, drag: .25, gravity: -2.2,
          size: .1, sizeTo: FLAME.grow * jitter, ease: true, color: 0xffe9b0, colorTo: 0xff4e1c, colorSpeed: 1.5, intensity: .72, fadeIn: .04, fadeOut: .5,
          rotation: fx.random() * 6, spin: fx.spread(5) });
        // A hot white-yellow core near the nozzle makes the jet read as one tongue of fire.
        if (fx.random() < .5) fx.glow({ start: last, life: life * .45, x: start.x, y: start.y, z: start.z, vx: vx * .95, vy: vy * .95, vz: vz * .95, drag: .3,
          size: .06, sizeTo: .3, ease: true, color: 0xfff6dc, colorTo: 0xffb03a, colorSpeed: 1.6, intensity: 1, fadeOut: .4 });
        if (fx.random() < .28) {
          // Smoke billows where the flame dies out.
          const at = life * jitter * .8, travel = (1 - Math.exp(-.25 * at)) / .25;
          fx.smoke({ start: last + at, life: .9 + fx.random() * .5, x: start.x + vx * travel, y: start.y + vy * travel + 1.1 * at * at, z: start.z + vz * travel,
            vx: vx * .05, vy: .7 + fx.random() * .4, vz: vz * .05, drag: .8, size: .25, sizeTo: .8, color: 0x4a4048, colorTo: 0x2f2a33, alpha: .38, fadeIn: .15, fadeOut: .4, rotation: fx.random() * 6, spin: fx.spread(1.5) });
        }
        if (fx.random() < .12) fx.streak({ start: last, life: .45 + fx.random() * .3, x: start.x, y: start.y, z: start.z,
          vx: vx * .8 + fx.spread(1.5), vy: vy * .8 + 1.5, vz: vz * .8 + fx.spread(1.5), drag: 1.4, gravity: 3,
          size: .016, sizeTo: .006, color: 0xffe08a, colorTo: 0xff6a20, intensity: 1.6, trail: .04 });
      }
      return true;
    },
  };
}

// A burning enemy carries rolling flames, embers and a smoky top, all in the
// shared pools: a whole burning wave adds no draw call.
const BURN_POINTS = [[0, 1.2, 0, .2], [0, .95, 0, .18], [-.28, 1.25, 0, .1], [.28, 1.25, 0, .1], [0, 1.6, 0, .15], [-.12, .55, 0, .1], [.12, .55, 0, .1]];
const burnPoint = new THREE.Vector3();
export function emitBurn(group, time, { crawler = false } = {}) {
  if (!group || !Number.isFinite(time)) return;
  const fx = sharedEffects(), d = group.userData;
  if (!Number.isFinite(d.burnLast) || time - d.burnLast > .3) d.burnLast = time - .03;
  group.updateMatrixWorld?.(true);
  for (; d.burnLast < time; d.burnLast += 1 / 26) {
    const [x, y, z, r] = BURN_POINTS[Math.floor(fx.random() * BURN_POINTS.length)];
    burnPoint.set(x + fx.spread(r), crawler ? y * .4 : y + fx.spread(.1), z + fx.spread(r));
    group.localToWorld(burnPoint);
    fx.glow({ start: d.burnLast, life: .35 + fx.random() * .25, x: burnPoint.x, y: burnPoint.y, z: burnPoint.z, vx: fx.spread(.3), vy: 1.1 + fx.random() * .8, vz: fx.spread(.3), drag: 1.2,
      size: .1, sizeTo: .34 + fx.random() * .12, ease: true, color: 0xfff0b8, colorTo: 0xff4a18, colorSpeed: 1.4, intensity: 1.1, fadeIn: .1, fadeOut: .5, rotation: fx.random() * 6, spin: fx.spread(4) });
    if (fx.random() < .14) fx.smoke({ start: d.burnLast + .2, life: .9, x: burnPoint.x, y: burnPoint.y + .3, z: burnPoint.z, vx: fx.spread(.2), vy: .8, vz: fx.spread(.2), drag: .6,
      size: .18, sizeTo: .55, color: 0x463c44, alpha: .3, fadeIn: .2, fadeOut: .4, rotation: fx.random() * 6 });
    if (fx.random() < .1) fx.streak({ start: d.burnLast, life: .6, x: burnPoint.x, y: burnPoint.y, z: burnPoint.z, vx: fx.spread(.8), vy: 1.8 + fx.random(), vz: fx.spread(.8), drag: 1, gravity: 1.2,
      size: .014, sizeTo: .005, color: 0xffd27a, colorTo: 0xff5a1a, intensity: 1.5, trail: .05 });
  }
}

// A cartoon blast: a rolling fireball, a shock of sparks, falling embers and
// a fat, slow cloud of smoke. Radius only scales the look.
export function explosionBurst(position, { time = 0, radius = 4 } = {}) {
  if (!position || !Number.isFinite(time)) return;
  const fx = sharedEffects(), r = THREE.MathUtils.clamp(Number.isFinite(radius) ? radius : 4, .5, 12), { x = 0, y = 0, z = 0 } = position;
  if (![x, y, z].every(Number.isFinite)) return;
  fx.glow({ start: time, life: .16, x, y: y + .3, z, size: .4, sizeTo: r * .9, color: 0xffffff, colorTo: 0xffd27a, intensity: 2, fadeOut: .2 });
  for (let index = 0; index < 16; index++) {
    const angle = fx.random() * Math.PI * 2, up = .25 + fx.random() * .9, speed = r * (1.2 + fx.random() * 1.1);
    fx.glow({ start: time + fx.random() * .04, life: .45 + fx.random() * .25, x, y: y + .25, z,
      vx: Math.cos(angle) * speed * .7, vy: up * speed * .6, vz: Math.sin(angle) * speed * .7, drag: 4.5, gravity: -1.5,
      size: .3, sizeTo: r * (.32 + fx.random() * .18), ease: true, color: 0xfff5d0, colorTo: 0xff4818, colorSpeed: 1.25, intensity: 1.35, fadeOut: .5, rotation: fx.random() * 6, spin: fx.spread(2) });
  }
  for (let index = 0; index < 12; index++) {
    const angle = fx.random() * Math.PI * 2, speed = r * (.6 + fx.random() * .6);
    fx.smoke({ start: time + .12 + fx.random() * .12, life: 1.3 + fx.random() * .7, x, y: y + .4, z,
      vx: Math.cos(angle) * speed * .5, vy: .8 + fx.random() * 1.1, vz: Math.sin(angle) * speed * .5, drag: 1.6, gravity: -.3,
      size: r * .15, sizeTo: r * (.42 + fx.random() * .2), color: 0x5a5262, colorTo: 0x3a3542, alpha: .5, fadeIn: .1, fadeOut: .45, rotation: fx.random() * 6, spin: fx.spread(.8) });
  }
  for (let index = 0; index < 30; index++) {
    const angle = fx.random() * Math.PI * 2, up = .2 + fx.random() * 1.1, speed = 7 + fx.random() * 9;
    fx.streak({ start: time, life: .45 + fx.random() * .45, x, y: y + .3, z, vx: Math.cos(angle) * speed, vy: up * speed * .7, vz: Math.sin(angle) * speed,
      drag: 1.3, gravity: 9, size: .03, sizeTo: .01, color: 0xfff1c0, colorTo: 0xff7a2a, colorSpeed: 1.6, intensity: 1.7, trail: .045, fadeOut: .6 });
  }
  for (let index = 0; index < 10; index++) fx.glow({ start: time + .1, life: 1 + fx.random() * .6, x: x + fx.spread(r * .3), y: y + .6 + fx.random() * r * .3, z: z + fx.spread(r * .3),
    vx: fx.spread(.8), vy: .4 + fx.random() * .6, vz: fx.spread(.8), drag: 1, gravity: 1.4, size: .06, sizeTo: .02, color: 0xffc46a, colorTo: 0xff5a1a, intensity: 1.3, fadeOut: .6 });
}

// A thin wisp off a warm barrel at rest: pale, slow, rising and curling
// away. Hotter barrels breathe denser smoke.
// `scale` shrinks the wisp for the first-person gun, just below the eye.
export function emitBarrelSmoke(point, time, level = .5, scale = 1) {
  if (!point || !Number.isFinite(time) || ![point.x, point.y, point.z].every(Number.isFinite)) return;
  const fx = sharedEffects(), warm = Math.max(0, Math.min(1, Number.isFinite(level) ? level : .5)), k = Number.isFinite(scale) ? Math.max(.2, Math.min(1, scale)) : 1;
  fx.smoke({ start: time, life: 1.5 + fx.random() * .8, x: point.x + fx.spread(.008), y: point.y + fx.spread(.008), z: point.z + fx.spread(.008),
    vx: fx.spread(.06), vy: .1 + fx.random() * .1, vz: fx.spread(.06), drag: .9, gravity: -.2,
    size: .03 * k, sizeTo: (.2 + fx.random() * .1) * k, color: 0xc4c6cb, alpha: (.18 + .26 * warm) * (.5 + .5 * k), fadeIn: .1, fadeOut: .5, rotation: fx.random() * 6, spin: fx.spread(1.4) });
}

// A supply crate breathes a pale signal column: slow, buoyant puffs that lean
// with the night air. Together with the red strobe it marks the crate from the
// cabin porch without any extra light or render pass.
export function emitSignalSmoke(point, time) {
  if (!point || !Number.isFinite(time) || ![point.x, point.y, point.z].every(Number.isFinite)) return;
  const fx = sharedEffects();
  fx.smoke({ start: time, life: 2.9 + fx.random() * .9, x: point.x + fx.spread(.09), y: point.y, z: point.z + fx.spread(.09),
    vx: .13 + fx.spread(.05), vy: .6 + fx.random() * .22, vz: fx.spread(.07), drag: .35, gravity: -.06,
    size: .22 + fx.random() * .08, sizeTo: .95 + fx.random() * .25, color: 0xbfc3ca, colorTo: 0x8e939c, colorSpeed: .4,
    alpha: .34, fadeIn: .3, fadeOut: 1.1, rotation: fx.random() * 6, spin: fx.spread(.5) });
}

// A melee swoosh: one glowing ribbon segment between two successive positions
// of the blade's sweet spot, fading in a blink. Successive frames draw the arc.
const STILL = () => {};
export const SWING_TRAILS = Object.freeze({
  katana: Object.freeze({ color: 0xe8f6ff, colorTo: 0x8fc8ff, width: .045, intensity: 1.1 }),
  bat: Object.freeze({ color: 0xfff0d6, colorTo: 0xffc98a, width: .07, intensity: .75 }),
  fireaxe: Object.freeze({ color: 0xffe2c4, colorTo: 0xff8a5a, width: .07, intensity: .85 }),
  hammer: Object.freeze({ color: 0xfff0d0, colorTo: 0xffb062, width: .085, intensity: .8 }),
});
export function emitSwingTrail(from, to, time, { weapon = 'katana', heavy = false } = {}) {
  if (!from || !to || !Number.isFinite(time) || ![from.x, from.y, from.z, to.x, to.y, to.z].every(Number.isFinite)) return;
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (length < .004) return;
  const look = SWING_TRAILS[weapon] ?? SWING_TRAILS.katana, width = look.width * (heavy ? 1.35 : 1);
  // A streak quad overhangs each end by half its width: pull both ends in so
  // neighbouring segments meet edge to edge instead of glowing twice.
  const trim = Math.min(width / 2, length * .45) / length, dx = (to.x - from.x) * trim, dy = (to.y - from.y) * trim, dz = (to.z - from.z) * trim;
  sharedEffects().streak({ start: time, life: heavy ? .2 : .15, x: to.x - dx, y: to.y - dy, z: to.z - dz, tx: from.x + dx, ty: from.y + dy, tz: from.z + dz, follow: STILL,
    size: width, sizeTo: width * .9, color: look.color, colorTo: look.colorTo, colorSpeed: 1.5, intensity: look.intensity, fadeIn: 0, fadeOut: .25 });
}
