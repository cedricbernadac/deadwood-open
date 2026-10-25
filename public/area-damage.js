// Smooth gameplay response shared by authoritative area hits and their charts.
// The reverse quintic has zero first and second derivatives at both endpoints.
// It describes damage, not a pressure-wave or combustion simulation.
export function smoothRangeFalloff(distance, fullUntil, end) {
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(fullUntil)
    || fullUntil < 0 || !Number.isFinite(end) || end <= fullUntil) {
    throw new TypeError('Invalid smooth range inputs');
  }
  if (distance <= fullUntil) return 1;
  if (distance >= end) return 0;
  // Evaluating from the zero end avoids subtracting nearly equal values there.
  const u = (end - distance) / (end - fullUntil);
  const attenuation = u * u * u * (10 + u * (6 * u - 15));
  return Math.max(0, Math.min(1, attenuation));
}

export function blastDamageAtDistance(profile, distance) {
  if (!profile || !Number.isFinite(profile.damage) || profile.damage < 0) {
    throw new TypeError('Invalid blast damage profile');
  }
  // Plain ROCKET and GRENADES settings are accepted; no inventory flag needed.
  return profile.damage * smoothRangeFalloff(distance, profile.innerRadius, profile.radiusDamage);
}

export function flameFalloff(profile, distance) {
  if (!profile) throw new TypeError('Invalid flame damage profile');
  return smoothRangeFalloff(distance, profile.fullDamageRange, profile.range);
}
