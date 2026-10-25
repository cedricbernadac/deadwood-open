const finitePoint = point => point && [point.x, point.y, point.z].every(Number.isFinite);

// Anchor the captured view-space barrel to this confirmed shot, never to the
// camera's newer position or aim. Matches Three.js camera Euler order YXZ.
export function shotMuzzleFromView(eye, yaw, pitch, offset) {
  if (!finitePoint(eye) || !finitePoint(offset) || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y = offset.y * cp - offset.z * sp, z = offset.y * sp + offset.z * cp;
  return { x: eye.x + offset.x * cy + z * sy, y: eye.y + y, z: eye.z - offset.x * sy + z * cy };
}

// A first-person barrel can project through a nearby wall. Keep the real impact
// and fall back to the eye-to-impact segment rather than drawing backwards or
// across the screen. Zero-length stopped rays have no visible trail.
export function safeTracerStart(eye, end, muzzle) {
  if (!finitePoint(eye) || !finitePoint(end)) return null;
  const dx = end.x - eye.x, dy = end.y - eye.y, dz = end.z - eye.z;
  const length = Math.hypot(dx, dy, dz);
  if (length <= .05) return null;
  const ux = dx / length, uy = dy / length, uz = dz / length;
  if (finitePoint(muzzle)) {
    const mx = muzzle.x - eye.x, my = muzzle.y - eye.y, mz = muzzle.z - eye.z;
    const forward = mx * ux + my * uy + mz * uz;
    const lateral = Math.sqrt(Math.max(0, mx * mx + my * my + mz * mz - forward * forward));
    if (forward >= 0 && forward < length - .05 && length - forward >= lateral) return { x: muzzle.x, y: muzzle.y, z: muzzle.z };
  }
  const lead = Math.min(.5, length * .25);
  return { x: eye.x + ux * lead, y: eye.y + uy * lead, z: eye.z + uz * lead };
}
