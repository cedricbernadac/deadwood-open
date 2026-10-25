// Frisson part: atmosphere (art/frisson/DESIGN.md). The same set on a grim
// night: darker and colder through world.setMood (GRIM_NIGHT.mood is the
// whole light, colours included, so setMood alone gives the same night),
// frisson.css for the vignette, the grain and the hurt pulse. Uniforms and
// CSS only: no light, define or program changes.
import { GENERATOR } from '../expedition.js';

// Every number in one place. Readability rule: darken the flat fills, keep
// the key lights (moon outside, lamps and flashlight inside), so zombies
// keep a lit side and a silhouette against the fog. Computed (ACES r180,
// not yet judged by eye): the OKLab distance between neighbouring family
// skins, the toughness cue, stays at 74-85 % of Famille's on the moonlit
// and shadow sides, at wave 20 and under a door lamp.
export const GRIM_NIGHT = Object.freeze({
  mood: Object.freeze({
    ambient: .65,        // the flat hemisphere fill: most of the darkening, more shape contrast
    moon: .78,           // the key light outside stays strong: zombies keep a moonlit side
    fill: .55,           // the opposite rim, now sickly green-grey (tints.fill)
    lamps: .82,          // cabin and door lamps (about .79 with the tint); the circuit flicker dips from here
    windowGlow: .55,     // boarded windows glow less: the cabin feels less cosy
    sky: .6,             // dome, stars, moon disc and halo
    fireflies: 0,        // too cute; hidden fireflies also skip their per-frame update
    beams: .5,           // the teammates' flashlight cones, half as loud as in Famille
    fogColor: 0x2e423b,  // sickly green-grey at 76 % of the Famille horizon's luminance; density unchanged
    exposure: .94,       // 1.3 -> 1.22: a light global pull that barely dims the flashlight and the eyes
    // Hue only: each colour keeps its light's luminance within 6 %, so the
    // multipliers above alone say how much darker it gets.
    colors: Object.freeze({
      ambientSky: 0x8aa3bd,     // was 0x8aa6d6: colder grey-blue
      ambientGround: 0x4a4c43,  // was 0x5a4a3a: the warm brown bounce turns grey-olive
      moon: 0xa4c8e2,           // was 0xa9c6f0: colder, less violet
      fill: 0x768c7d,           // was 0x8c7fc4: the storybook violet rim turns sickly green-grey
      lamps: 0xffbf82,          // was 0xffc48c: dimmed tungsten runs more orange
    }),
  }),
  // The lamps share one failing circuit: a slow breath plus rare smooth sags.
  // At most one sag per slot and at least 1.4 s between sags; a sin² dip has
  // no on/off edge, so it never strobes. Under reduced motion only the breath.
  flicker: Object.freeze({
    breathe: .03,     // a 0-3 % wobble from two sines under .31 Hz
    slot: 3.2,        // seconds per draw
    chance: .22,      // chance of a sag per slot with the generator at full power...
    lowPower: .4,     // ...plus up to this much as it falls to its minimum
    depth: Object.freeze([.18, .34]), // a sag takes 18-34 % of the lamp light, never to dark
    length: .6,       // seconds per sag
    gap: 1.4,         // seconds of steady light at least between two sags
  }),
  // A darker pulse of the vignette when the local player is hurt.
  hurt: Object.freeze({ hold: 140, min: .45, max: 1 }),
  // CSS saturate(.9) on the canvas is one more compositor pass: discrete GPUs
  // only ('high'); medium is usually an integrated GPU, low is skipped.
  desaturate: Object.freeze(['high']),
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// A stable value in [0, 1) per slot (integer hash), so the flicker is a pure
// function of time.
function unit(slot, salt) {
  let x = Math.imul((slot | 0) ^ Math.imul(salt + 1, 0x9e3779b9), 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Lamp level in [1 - breathe - depth[1], 1] at `time` (seconds). Lower
// generator power makes sags more likely, never deeper. Plain arguments: it
// runs every frame.
export function circuitFlicker(time, power = 1, calm = false, flicker = GRIM_NIGHT.flicker) {
  if (!Number.isFinite(time)) return 1;
  const breathe = flicker.breathe * (.5 + .25 * Math.sin(time * 1.9) + .25 * Math.sin(time * 1.1 + 2));
  if (calm) return 1 - breathe;
  const slot = Math.floor(time / flicker.slot), within = time - slot * flicker.slot;
  const weak = clamp((1 - power) / (1 - GENERATOR.minPower), 0, 1);
  if (unit(slot, 0) >= flicker.chance + flicker.lowPower * weak) return 1 - breathe;
  const start = flicker.gap / 2 + unit(slot, 1) * (flicker.slot - flicker.length - flicker.gap), u = (within - start) / flicker.length;
  if (u <= 0 || u >= 1) return 1 - breathe;
  const depth = flicker.depth[0] + unit(slot, 2) * (flicker.depth[1] - flicker.depth[0]);
  return 1 - breathe - depth * Math.sin(Math.PI * u) ** 2;
}

function reducedMotion(doc) {
  try { return (doc?.defaultView ?? globalThis).matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; }
  catch { return false; }
}
function detach(node) {
  if (typeof node?.remove === 'function') node.remove(); else node?.parentNode?.removeChild?.(node);
}

export async function install(ctx = {}) {
  const { world, renderer, hooks, document: doc, base = '/frisson/' } = ctx;
  const quality = typeof ctx.quality === 'string' ? ctx.quality : ctx.quality?.id;
  // One mood and one options object for the whole install: the frame hook
  // re-applies them without allocating.
  const mood = { ...GRIM_NIGHT.mood }, options = { renderer }, calm = reducedMotion(doc);
  const apply = () => world?.setMood?.(mood, options);
  apply();

  const created = [];
  let vignette = null, hurtTimer = null, level = 1;
  if (doc?.createElement) {
    doc.getElementById?.('frisson-css')?.remove?.();
    const link = doc.createElement('link');
    link.id = 'frisson-css'; link.rel = 'stylesheet'; link.href = `${base}frisson.css`;
    (doc.head ?? doc.body)?.appendChild(link); created.push(link);
    for (const id of ['frisson-vignette', 'frisson-grain']) {
      const overlay = doc.createElement('div');
      overlay.id = id; overlay.setAttribute?.('aria-hidden', 'true');
      doc.body?.appendChild(overlay); created.push(overlay);
      if (id === 'frisson-vignette') vignette = overlay;
    }
    if (GRIM_NIGHT.desaturate.includes(quality)) doc.documentElement?.classList?.add('frisson-desaturate');
  }

  // The frame hook may run before or after world.update: setMood re-applies
  // to update()'s own values, so the order does not matter. Paused time
  // freezes the flicker.
  const frame = ({ time, snapshot, self } = {}) => {
    // Low health: the vignette's inner ring breathes (frisson.css), unless
    // the survivor is downed or out.
    if (vignette?.classList) {
      const hp = Number(self?.hp), max = Number(self?.maxHp);
      const low = Boolean(self?.alive) && !self?.downed && Number.isFinite(hp) && max > 0 && hp / max <= .35;
      if (low) vignette.classList.add('low'); else vignette.classList.remove('low');
    }
    const expedition = snapshot?.expedition;
    const power = expedition?.enabled === true ? expedition.generator?.power ?? 1 : 1;
    const next = Math.round(circuitFlicker(time, power, calm) * 500) / 500;
    if (next === level) return;
    level = next; mood.lamps = GRIM_NIGHT.mood.lamps * level; mood.windowGlow = GRIM_NIGHT.mood.windowGlow * level;
    apply();
  };
  const hurt = ({ amount = 0, hp = 0, maxHp = 100 } = {}) => {
    const overlay = vignette;
    if (!overlay) return;
    const max = maxHp > 0 ? maxHp : 100;
    const weight = clamp((Number(amount) || 0) / max * 3 + (1 - clamp((Number(hp) || 0) / max, 0, 1)) * .5, 0, 1);
    overlay.style?.setProperty?.('--frisson-hurt', (GRIM_NIGHT.hurt.min + (GRIM_NIGHT.hurt.max - GRIM_NIGHT.hurt.min) * weight).toFixed(2));
    overlay.classList?.add('hurt');
    clearTimeout(hurtTimer);
    hurtTimer = setTimeout(() => { hurtTimer = null; overlay.classList?.remove('hurt'); }, GRIM_NIGHT.hurt.hold);
  };
  if (hooks) { hooks.frame = frame; hooks.hurt = hurt; }

  let installed = true;
  return {
    uninstall() {
      if (!installed) return;
      installed = false;
      if (hooks?.frame === frame) hooks.frame = null;
      if (hooks?.hurt === hurt) hooks.hurt = null;
      clearTimeout(hurtTimer); hurtTimer = null;
      vignette?.classList?.remove('low'); vignette = null;
      for (const node of created) detach(node);
      doc?.documentElement?.classList?.remove('frisson-desaturate');
      world?.setMood?.(null); // lights, colours, fog, sky and exposure
    },
  };
}
