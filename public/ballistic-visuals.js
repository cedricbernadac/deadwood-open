import * as THREE from '/vendor/three.module.js';
import { ballisticDistance, ballisticPosition, ballisticVelocity } from './ballistics.js';
import { sharedEffects } from './fx.js';
import { bulletLook } from './shot-fx.js';

const finitePoint = point => point && [point.x, point.y, point.z].every(Number.isFinite);
const CONTACT_FADE = .045;
const MUZZLE_BLEND_METRES = 8;

// Physical bullets have their own clock: a local hit-stop must never slow a
// bullet while the server continues to move it. The shared FX clock still
// owns particle drawing; the handle supplies the authoritative flight age.
export function createBallisticTracer(projectile, { weapon = 'pistol', local = false, time = 0, muzzle = null } = {}) {
  if (!finitePoint(projectile) || ![projectile.vx, projectile.vy, projectile.vz, projectile.gravity, projectile.maxAge, time].every(Number.isFinite)
    || !(projectile.maxAge > 0)) return null;
  const shot = { ...projectile }, fx = sharedEffects(), look = bulletLook(weapon, { local });
  const mesh = new THREE.Group(); mesh.name = 'ballisticTracer';
  let root = fx.root; while (root.parent) root = root.parent;
  if (!root.isScene) mesh.add(fx.root);
  const startedAt = time, effectStart = fx.time;
  const segments = [shot];
  const segmentAt = age => {
    for (let index = segments.length - 1; index >= 0; index--) if ((segments[index].segmentStartAge ?? 0) <= age + 1e-9) return segments[index];
    return segments[0];
  };
  // Presentation only: leave the displayed barrel, then join the server's
  // flight smoothly. Never move the collision ray, its clock or a contact.
  let offset = finitePoint(muzzle) ? { x: muzzle.x - shot.x, y: muzzle.y - shot.y, z: muzzle.z - shot.z } : null;
  let blendDistance = MUZZLE_BLEND_METRES;
  const positionAt = age => {
    const point = ballisticPosition(segmentAt(age), age);
    if (offset && blendDistance > 1e-6) {
      const t = Math.min(1, ballisticDistance(shot, age) / blendDistance);
      const weight = 1 - t * t * (3 - 2 * t);
      point.x += offset.x * weight; point.y += offset.y * weight; point.z += offset.z * weight;
    }
    return point;
  };
  const state = { age: 0, minAge: 0, now: time, point: null, terminalAt: null, disposed: false };
  const head = () => state.point ?? positionAt(state.age);
  const follow = span => p => {
    const velocity = ballisticVelocity(segmentAt(state.age), state.age);
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const at = head(), behind = positionAt(Math.max(0, state.age - span / Math.max(1, speed)));
    p.x = at.x; p.y = at.y; p.z = at.z;
    p.tx = behind.x; p.ty = behind.y; p.tz = behind.z;
  };
  const common = { start: effectStart, life: shot.maxAge + 1, fadeOut: 1 };
  const core = fx.streak({ ...common, size: look.core, sizeTo: look.core, color: look.color,
    intensity: 2.2 * look.dim, follow: follow(look.length) });
  const wake = fx.streak({ ...common, size: look.core * 3.2, sizeTo: look.core * 3.2, color: look.trail,
    intensity: .85 * look.dim, follow: follow(look.length * 3) });
  const glow = fx.glow({ ...common, size: look.glow, sizeTo: look.glow, color: look.color, intensity: 1.2 * look.dim,
    follow(p) { const at = head(); p.x = at.x; p.y = at.y; p.z = at.z; } });
  const particles = [core, wake, glow], intensities = particles.map(p => p.intensity), follows = particles.map(p => p.follow);
  const drive = now => { if (!fx.driven) fx.update(effectStart + Math.max(0, now - startedAt)); };
  const dispose = () => {
    state.disposed = true;
    for (let index = 0; index < particles.length; index++) if (particles[index].follow === follows[index]) particles[index].dead = true;
  };
  return {
    id: shot.id, mesh, startedAt,
    update(now) {
      if (state.disposed || !Number.isFinite(now)) return false;
      state.now = now;
      if (state.terminalAt !== null) {
        const fade = Math.max(0, 1 - Math.max(0, now - state.terminalAt) / CONTACT_FADE);
        for (let index = 0; index < particles.length; index++) if (particles[index].follow === follows[index]) particles[index].intensity = intensities[index] * fade;
        if (!fade) { dispose(); drive(now); return false; }
      } else {
        const age = Math.max(state.minAge, now - startedAt, 0);
        if (age > shot.maxAge + .1) { dispose(); drive(now); return false; }
        state.age = Math.min(shot.maxAge, age); state.point = null;
      }
      drive(now); return true;
    },
    contact(event, now = state.now) {
      if (state.disposed || !finitePoint(event) || !Number.isFinite(event.age)) return;
      if (event.age + 1e-9 < state.minAge || state.terminalAt !== null) return;
      state.age = Math.max(0, Math.min(shot.maxAge, event.age));
      state.minAge = Math.max(state.minAge, state.age);
      state.point = { x: event.x, y: event.y, z: event.z };
      // A close body/wall can stop the shot before the normal blend ends.
      // Both head and tail must meet that exact point, including penetration.
      blendDistance = Math.min(blendDistance, ballisticDistance(shot, state.age));
      if (offset) {
        const forward = (offset.x * shot.vx + offset.y * shot.vy + offset.z * shot.vz) / Math.max(1, Math.hypot(shot.vx, shot.vy, shot.vz));
        // Smoothstep's maximum slope is 1.5: too little room beyond the
        // barrel would make the shortened visual curve turn backwards.
        if (blendDistance <= 1.5 * forward + .05) offset = null;
      }
      const next = event.continuation;
      if (event.terminal !== true && finitePoint(next) && [next.vx, next.vy, next.vz, next.drag, next.gravity, next.segmentStartAge, next.maxAge].every(Number.isFinite)
        && next.segmentStartAge >= state.minAge - 1e-9 && next.maxAge <= shot.maxAge + 1e-9 && segments.length < 8) {
        segments.push({ ...next, id: shot.id });
      }
      if (event.terminal === true) state.terminalAt = Number.isFinite(now) ? now : state.now;
    },
    dispose,
  };
}
