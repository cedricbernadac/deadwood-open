// Graphics quality choice and presets. No DOM and no THREE: safe to unit test.
export const GRAPHICS_QUALITY_KEY = 'deadwood-graphics-v1';
export const GRAPHICS_QUALITY_CHOICES = ['auto', 'low', 'medium', 'high'];
export const GRAPHICS_PRESETS = Object.freeze({
  low:    Object.freeze({ id: 'low',    pixelRatio: 1,    minPixelRatio: .7,  antialias: false, shadows: false, shadowMapSize: 0,    fireflies: 40,  groundDetail: .35, rainFraction: .5 }),
  medium: Object.freeze({ id: 'medium', pixelRatio: 1.25, minPixelRatio: .8,  antialias: true,  shadows: false, shadowMapSize: 1024, fireflies: 100, groundDetail: .7,  rainFraction: 1 }),
  high:   Object.freeze({ id: 'high',   pixelRatio: 1.5,  minPixelRatio: .9,  antialias: true,  shadows: true,  shadowMapSize: 2048, fireflies: 160, groundDetail: 1,   rainFraction: 1 }),
});

export function normalizeGraphicsQuality(value) {
  return GRAPHICS_QUALITY_CHOICES.includes(value) ? value : 'auto';
}

// hints: { gpu, deviceMemory, hardwareConcurrency, devicePixelRatio }.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const WEAK_GPU = /intel.*\b(hd|uhd)\b|mali|adreno|powervr|videocore/i;
// Entry-level discrete chips (GeForce MX / GT) behave like integrated ones.
const ENTRY_GPU = /geforce\s*(mx|gt)\s*\d|geforce\s*\d{3}mx?\b/i;
const INTEGRATED_GPU = /iris|radeon\(tm\) graphics|radeon graphics|vega|apple m\d|apple gpu|arc\(tm\) graphics/i;
const DISCRETE_GPU = /nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro)|\barc(\(tm\))?\s*a\d{3}/i;

export function autoGraphicsPresetId(hints = {}) {
  const gpu = String(hints?.gpu ?? '');
  if (SOFTWARE_RENDERER.test(gpu)) return 'low';
  if (typeof hints?.deviceMemory === 'number' && hints.deviceMemory <= 4) return 'low';
  if (WEAK_GPU.test(gpu)) return 'low';
  if (ENTRY_GPU.test(gpu)) return 'medium';
  if (/\barc/i.test(gpu) && DISCRETE_GPU.test(gpu)) return 'high';
  if (INTEGRATED_GPU.test(gpu)) return 'medium';
  if (DISCRETE_GPU.test(gpu)) return 'high';
  return 'medium';
}

export function resolveGraphicsPreset(choice, hints) {
  const normalized = normalizeGraphicsQuality(choice);
  const id = normalized === 'auto' ? autoGraphicsPresetId(hints) : normalized;
  return Object.freeze({ ...GRAPHICS_PRESETS[id], choice: normalized });
}

export function readGraphicsQuality(storage) {
  try { return normalizeGraphicsQuality(storage?.getItem(GRAPHICS_QUALITY_KEY)); }
  catch { return 'auto'; }
}

export function saveGraphicsQuality(storage, value) {
  try {
    if (!storage) return false;
    storage.setItem(GRAPHICS_QUALITY_KEY, normalizeGraphicsQuality(value));
    return true;
  } catch { return false; }
}

// Adaptive pixel ratio for the auto choice: ease down under sustained slow
// frames, ease back up under fast ones. Pure arithmetic, no timers.
export function createPixelRatioGovernor(preset, devicePixelRatio) {
  const cap = Math.min(devicePixelRatio || 1, preset.pixelRatio);
  const floor = Math.min(preset.minPixelRatio, cap);
  let ratio = cap;
  let average = 0, slowSeconds = 0, fastSeconds = 0, cooldown = 0, before = null, locked = false, trial = null;
  const change = next => { ratio = next; slowSeconds = 0; fastSeconds = 0; cooldown = 3; };
  return {
    get ratio() { return ratio; },
    sample(frameSeconds) {
      // Tab switches produce huge or missing frames: never learn from them.
      if (!Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds > .5) return false;
      average = average === 0 ? frameSeconds : average + (frameSeconds - average) * .1;
      cooldown = Math.max(0, cooldown - frameSeconds);
      if (average > 1 / 40) { slowSeconds += frameSeconds; fastSeconds = 0; }
      else if (average < 1 / 57) { fastSeconds += frameSeconds; slowSeconds = 0; }
      else { slowSeconds = 0; fastSeconds = 0; }
      if (cooldown > 0) return false;
      // A lower resolution that did not speed frames up means another limit
      // (a 30 Hz cap, a power saver): judged on one settled second of frames,
      // ignoring hitches, then undone and adaptation stops.
      if (before && before.ratio > ratio) {
        if (frameSeconds > average * 2.5) { trial = null; cooldown = 1; return false; }
        trial ??= { time: 0, sum: 0, count: 0 };
        trial.time += frameSeconds; trial.sum += frameSeconds; trial.count++;
        if (trial.time < 1) return false;
        const settled = trial.sum / trial.count, previous = before.ratio, undo = settled > before.average * .92;
        before = null; trial = null;
        if (undo) { locked = true; change(previous); return true; }
      }
      if (locked) return false;
      if (slowSeconds >= 4 && ratio > floor) {
        before = { ratio, average };
        change(Math.max(floor, Math.round((ratio - .1) * 100) / 100));
        return true;
      }
      if (fastSeconds >= 12 && ratio < cap) {
        change(Math.min(cap, Math.round((ratio + .05) * 100) / 100));
        return true;
      }
      return false;
    },
  };
}
