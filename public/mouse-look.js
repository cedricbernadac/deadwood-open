// Mouse look: how the pointer is captured and which deltas reach the aim.
// Pure helpers; client.js owns the canvas, the events and the aim itself.

export const RAW_MOUSE_KEY = 'deadwood-raw-mouse-v1';

// Raw (unadjusted) movement is the default: it bypasses Chromium's
// re-centring of the hidden cursor, and also Windows pointer acceleration and
// pointer speed.
export function readRawMouse(storage) {
  try { return storage?.getItem(RAW_MOUSE_KEY) !== 'off'; } catch { return true; }
}
export function saveRawMouse(storage, enabled) {
  const value = enabled !== false;
  try { storage?.setItem(RAW_MOUSE_KEY, value ? 'on' : 'off'); } catch {}
  return value;
}

// Chromium on Windows reports raw counts without dividing by the display
// scale, while ordinary movement is in CSS pixels. Dividing by the pixel ratio
// keeps the sensitivity slider's meaning (at 100 % page zoom and the default
// Windows pointer speed). Read from Chromium's source, not yet measured.
export function rawMovementScale(pixelRatio) {
  return Number.isFinite(pixelRatio) && pixelRatio > 0 ? 1 / pixelRatio : 1;
}

// Without raw movement, Chromium on Windows warps the hidden cursor back to
// the centre once it enters the outer 15 % of the view, so 35 % of the width
// or height from the centre. A stale position delivered right after that warp
// is reported as one jump of the whole offset, in the direction of travel.
// Captured on 11 October 2026: -600/+116, +594/-90 and +595/-89 px in a
// 1696 x 1273 view (0.350-0.354 of the width), 0.1-0.4 ms after the previous
// mousemove; ordinary events there were about 16 ms apart. The 2 px slack
// covers Chromium's truncation and fractional display scales.
export const WARP_ECHO = Object.freeze({ border: .35, slackPx: 2, maxIntervalMs: 1 });

// The size alone is not enough: a real flick can reach it within one frame.
export function warpEchoSized(movementX, movementY, width, height) {
  if (!(width > 0) || !(height > 0)) return false;
  return Math.abs(movementX) >= width * WARP_ECHO.border - WARP_ECHO.slackPx
    || Math.abs(movementY) >= height * WARP_ECHO.border - WARP_ECHO.slackPx;
}
export function warpEcho({ movementX, movementY, intervalMs, width, height }) {
  return intervalMs >= 0 && intervalMs < WARP_ECHO.maxIntervalMs && warpEchoSized(movementX, movementY, width, height);
}

const isThenable = value => typeof value?.then === 'function';

// Ask for raw movement, then fall back once to the plain request only when the
// platform refuses the option. Other refusals are returned, never retried.
// A browser converts the options during the call and silently ignores a member
// it does not know, so the movement is raw only if unadjustedMovement was read.
// Resolves with { mode: 'raw' | 'adjusted' | 'unknown' | null, fallback, rawIgnored, error }:
// 'unknown' means a browser that read the option returned no promise, so the
// outcome arrives only through pointerlockchange/pointerlockerror; rawIgnored
// means the option was never read, so raw movement is unavailable there.
export function requestMouseLock(element, { raw = true, onFallback } = {}) {
  const granted = (mode, fallback, rawIgnored = false) => ({ mode, fallback, rawIgnored, error: null });
  const failure = (error, fallback, rawIgnored = false) => ({ mode: null, fallback, rawIgnored, error: { name: error?.name ?? 'Error', message: error?.message ?? '' } });
  if (typeof element?.requestPointerLock !== 'function') return Promise.resolve(failure({ name: 'Unavailable' }, false));
  const plain = fallback => {
    let result;
    try { result = element.requestPointerLock(); } catch (error) { return Promise.resolve(failure(error, fallback)); }
    return isThenable(result)
      ? Promise.resolve(result).then(() => granted('adjusted', fallback), error => failure(error, fallback))
      : Promise.resolve(granted('adjusted', fallback));
  };
  if (!raw) return plain(false);
  let read = false, result;
  const options = { get unadjustedMovement() { read = true; return true; } };
  try { result = element.requestPointerLock(options); } catch (error) {
    // Nothing was requested, so no pointerlockerror follows this one.
    if (error?.name !== 'NotSupportedError' && error?.name !== 'TypeError') return Promise.resolve(failure(error, false, !read));
    onFallback?.(error, { errorEvent: false });
    return plain(true);
  }
  // Settled now: a later read (a test, a debugger) proves nothing.
  const ignored = !read;
  if (!isThenable(result)) return Promise.resolve(granted(ignored ? 'adjusted' : 'unknown', false, ignored));
  return Promise.resolve(result).then(() => granted(ignored ? 'adjusted' : 'raw', false, ignored), error => {
    if (error?.name !== 'NotSupportedError') return failure(error, false, ignored);
    // Chromium also queues a pointerlockerror for the refused option.
    onFallback?.(error, { errorEvent: true });
    return plain(true);
  });
}
