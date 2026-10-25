// Fictitious game cartridges in SI units, not real ammunition specifications.
// dragArea = Cx * frontal area. kappa = rho * dragArea / (2 * mass).
// Physical flight parameters stay fixed. Optional muzzleDamage/damageCurve
// calibrate gameplay damage separately: five smooth rational curves match
// the old 10-m damage and 0-30-m mean; pump/sniper keep exponential shapes.
// Magnum stays unchanged. Reproduce/check with
// node validation/calibrate-close-damage.mjs [--write].
export const BULLET_PROFILES = Object.freeze({
  pistol: Object.freeze({ mass: 0.002734889724622, muzzleSpeed: 170, dragArea: 0.00004018613472915, transmission: 0.7, muzzleDamage: 25.165480031899513, damageCurve: Object.freeze({ kind: "rational", halfDistance: 24.776051652398877, power: 3 }) }),
  smg: Object.freeze({ mass: 0.003474150344536, muzzleSpeed: 170, dragArea: 0.00006239290414678, transmission: 0.45, muzzleDamage: 21.42612912050946, damageCurve: Object.freeze({ kind: "rational", halfDistance: 22.897649866639668, power: 2 }) }),
  shotgun: Object.freeze({ mass: 0.004373842762205, muzzleSpeed: 170, dragArea: 0.0002856387110012, transmission: 0.55, spread: 0.11, muzzleDamage: 36.62604490265088 }),
  minigun: Object.freeze({ mass: 0.00541318683813922, muzzleSpeed: 200, dragArea: 0.00004418928031133747, transmission: 0.3, muzzleDamage: 31.78561689430243, damageCurve: Object.freeze({ kind: "rational", halfDistance: 41.95144015424762, power: 2 }) }),
  rifle: Object.freeze({ mass: 0.00610462898142, muzzleSpeed: 170, dragArea: 0.00001794013414948, transmission: 0.35, muzzleDamage: 30.17300863999586, damageCurve: Object.freeze({ kind: "rational", halfDistance: 131.6820961879102, power: 2 }) }),
  assault: Object.freeze({ mass: 0.0035356431694053914, muzzleSpeed: 250, dragArea: 0.000018471931660566945, transmission: 0.4, muzzleDamage: 42.61401567587669, damageCurve: Object.freeze({ kind: "rational", halfDistance: 82.70559983260127, power: 2 }) }),
  sniper: Object.freeze({ mass: 0.0331933082502, muzzleSpeed: 382.5, dragArea: 0.0001354828908172, transmission: 0.15, muzzleDamage: 367.9448837316162 }),
  magnum: Object.freeze({ mass: 0.02194787379973, muzzleSpeed: 450, dragArea: 0.0002866661067719, transmission: 0.9 }),
});
