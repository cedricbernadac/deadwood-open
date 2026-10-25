import * as THREE from '/vendor/three.module.js';
import { readGraphicsQuality, saveGraphicsQuality, normalizeGraphicsQuality, resolveGraphicsPreset, createPixelRatioGovernor } from './graphics-quality.js';

// The art lead tunes the tone mapping here, in one place.
export const TONE_MAPPING_EXPOSURE = 1.3;
export function configureToneMapping(renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
}

function safeLocalStorage() { try { return globalThis.localStorage; } catch { return undefined; } }

function probeGraphicsHints() {
  const hints = {
    gpu: '',
    deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: globalThis.devicePixelRatio,
  };
  try {
    const probe = document.createElement('canvas');
    // Ask for the same GPU the game renderer will use (dual-GPU laptops).
    const context = probe.getContext('webgl2', { powerPreference: 'high-performance' }) || probe.getContext('webgl', { powerPreference: 'high-performance' });
    if (context) {
      const info = context.getExtension('WEBGL_debug_renderer_info');
      if (info) hints.gpu = context.getParameter(info.UNMASKED_RENDERER_WEBGL) || '';
      context.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {}
  return hints;
}

export function createGraphics({ canvas, scene, camera, storage = safeLocalStorage(), choice, hints } = {}) {
  const detected = hints ?? probeGraphicsHints();
  const preset = resolveGraphicsPreset(choice ?? readGraphicsQuality(storage), detected);
  const ratioHint = detected.devicePixelRatio ?? globalThis.devicePixelRatio;
  let governor = createPixelRatioGovernor(preset, ratioHint);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: preset.antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(governor.ratio);
  let width = innerWidth, height = innerHeight;
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = preset.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  configureToneMapping(renderer);
  let currentChoice = preset.choice, lastFrame = null;
  const clock = () => globalThis.performance?.now?.() ?? Date.now();
  const applyRatio = () => { renderer.setPixelRatio(governor.ratio); renderer.setSize(width, height); };
  return {
    renderer, preset, hints: detected,
    get choice() { return currentChoice; },
    render(delta, { measure = false } = {}) {
      renderer.render(scene, camera);
      // Only the auto choice adapts, and only with real in-game frames. The
      // governor gets the true frame time (the client clamps its delta).
      if (!measure || currentChoice !== 'auto') { lastFrame = null; return; }
      const now = clock(), frame = lastFrame === null ? delta : (now - lastFrame) / 1000; lastFrame = now;
      if (governor.sample(frame)) applyRatio();
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth; height = nextHeight;
      renderer.setSize(width, height);
    },
    setChoice(value) {
      currentChoice = normalizeGraphicsQuality(value);
      saveGraphicsQuality(storage, currentChoice);
      const next = resolveGraphicsPreset(currentChoice, detected);
      // Sharpness applies at once; antialiasing, shadows and scenery density
      // are fixed when the page loads.
      governor = createPixelRatioGovernor(next, ratioHint); lastFrame = null; applyRatio();
      const reloadRequired = next.id !== preset.id || next.antialias !== preset.antialias || next.shadows !== preset.shadows;
      return { choice: currentChoice, reloadRequired };
    },
    pixelRatio() { return governor.ratio; },
  };
}
