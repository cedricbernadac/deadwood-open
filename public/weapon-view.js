// Camera-space presentation only. Metric artwork, hand sizes and every world
// representation remain in world.js; these poses do not change aiming rays.
const originalRotation = Object.freeze([0, -.018, 0]);
const pose = position => Object.freeze({ position: Object.freeze(position), rotation: originalRotation });
const original = pose([.32, -.28, -.48]);
export const WEAPON_VIEW_POSES = Object.freeze({
  pistol: pose([.30, -.31, -.61]),
  smg: pose([.29, -.31, -.64]),
  assault: pose([.34, -.34, -.64]),
  rifle: pose([.39, -.37, -.64]),
  minigun: pose([.41, -.36, -.72]),
  sniper: pose([.36, -.43, -.73]),
  shotgun: pose([.35, -.36, -.67]),
  magnum: pose([.31, -.32, -.74]),
  rocket: pose([.40, -.37, -.72]),
  flamethrower: pose([.38, -.35, -.69]),
});

export function weaponViewPose(type) { return WEAPON_VIEW_POSES[type] ?? original; }

// Use the same base pose on equip and on every animation frame. Walking,
// recoil and reload retain their existing offsets and all weapons keep their
// original inclination; melee also keeps its original position.
export function applyWeaponViewPose(gun, { time = 0, moving = false, bob = 0, recoil = 0, reloading = false } = {}) {
  if (!gun) return;
  const { position: p, rotation: r } = weaponViewPose(gun.userData.type);
  gun.position.set(p[0] + Math.sin(time * 9) * (moving ? .014 : .002), p[1] + bob * .7 - (reloading ? .16 : 0), p[2] + recoil);
  gun.rotation.set(r[0] + recoil * .65 - (reloading ? .35 : 0), r[1], r[2]);
}

// The light is a camera child, just like the FPS weapon. Transform the real
// muzzle into that shared space instead of guessing a fixed barrel length.
export function copyWeaponMuzzleInView(gun, target) {
  return target.copy(gun.userData.muzzle).multiply(gun.scale).applyEuler(gun.rotation).add(gun.position);
}
