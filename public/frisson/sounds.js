// Frisson part: sounds (art/frisson/DESIGN.md; provenance in art/frisson/sounds.md).
// Every candidate is synthesized here into small buffers, rendered once per
// audio context and replayed with two nodes per sound. Nothing is fetched and
// no Famille sample changes: the one groan candidate built on the current take
// only reads it, in memory. Nobody has listened to any of them yet.

// The owner's picks, by ear, on audition.html: one line per sound, a candidate
// id or null for the Famille sound. His picks of 14 October are recorded with
// his words in art/frisson/sounds.md (« Choix du propriétaire »): hit, headshot,
// kill, groan, ambience and heartbeat. The jingle is still the provisional
// default of that day (his request to leave C major), never one of his takes.
// The four kill cracks of art/frisson/KILL-SOUND.md (craque, claque, coquille,
// os) were offered to compare with his eclat; after a game he could not hear
// eclat and asked to try craque, then coquille; then eclat again, made
// audible (14 October, evening): its gain .062 -> .2303 matches craque's
// loudness (K-weighted -45.0 -> -33.6), by his request. After trying all three
// in game he kept craque, « le seul que j'entends bien », 2 dB louder.
export const CHOSEN = Object.freeze({
  chain: 'mineur',
  hit: null,
  headshot: 'fele',
  kill: 'craque',
  groan: 'prise',
  ambience: 'veille',
  heartbeat: 'lubdub',
});

export const SLOTS = Object.freeze(['chain', 'hit', 'headshot', 'kill', 'groan', 'ambience', 'heartbeat']);
const ONE_SHOTS = new Set(['hit', 'headshot', 'kill', 'groan']), VOICE_CAP = 12, LOOKAHEAD = .2, BED_RATE = 22050;
// The kill player (art/frisson/KILL-SOUND.md 1.3), for whichever kill is chosen:
// the sound lands KILL_LAG after the shot (measured, sounds.md), as the 40 ms
// kill hit-stop ends. Kills within KILL_GAP of the last start merge into it
// (KILL_GAP_STREAM for the minigun and the flamethrower); heat trims a horde by
// HEAT_STEP dB a kill past HEAT_FREE, never under HEAT_FLOOR, and recovers over
// HEAT_TIME s; KILL_TRIM trims by kind. Every trim is <= 0 dB: no runtime gain
// ever passes the measured level. A brute or boss plays at HEAVY_RATE. A rocket
// kill waits in one of HELD_KILLS slots until the visual clock reaches its
// landing, and is dropped if found more than HELD_STALE s late.
export const KILL_LAG = .04;
// The owner's level knob for the kill sound (14 October, evening): ×2 (+6 dB)
// when he heard nothing in a game, then +2 dB more, « un tout petit peu plus
// fort […] avec la musique » (×2.52, +8 dB). The candidates' gains stay the
// measured floors.
export const KILL_BOOST = 2.52;
const KILL_GAP = .07, KILL_GAP_STREAM = .15, HEAT_TIME = 1, HEAT_FREE = 3, HEAT_STEP = 1.5, HEAT_FLOOR = -6;
const KILL_TRIM = Object.freeze({ shot: 0, blast: 0, stream: -4, melee: -6 });
const HEAVY_RATE = .95, HELD_KILLS = 8, HELD_STALE = .25;
// A candidate levelled per variant (variantGain) renders at the rate it was
// measured at, whatever the context's: its seeded noise is drawn sample by
// sample, so another rate is another draw and another level (3 to 5 LU apart
// between variants at 44.1 kHz). The source resamples it as it plays.
const MEASURED_RATE = 48000;
// The heartbeat starts at 35 HP (the HUD turns red under 30), is fastest at 5 HP and while down.
const HEART_FROM = 35, HEART_FULL = 5;

// Mulberry32: the same seed always renders the same sound.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Zavalishin's state-variable filter: stays stable while its cutoff moves.
// The band output peaks at Q times the input; every layer is normalized after.
class Filter {
  constructor(rate) { this.rate = rate; this.s1 = 0; this.s2 = 0; this.low = 0; this.band = 0; this.high = 0; this.tune(1000); }
  tune(frequency, q = .707) {
    const g = Math.tan(Math.PI * Math.max(10, Math.min(frequency, this.rate * .45)) / this.rate);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
    return this;
  }
  run(x) {
    const v3 = x - this.s2, v1 = this.a1 * this.s1 + this.a2 * v3, v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3;
    this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2;
    this.band = v1; this.low = v2; this.high = x - this.k * v1 - v2;
    return this;
  }
}
const glide = (from, to, t, time) => to + (from - to) * Math.exp(-Math.max(0, t) / time);
const env = (t, attack, decay) => t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay);
// Rises over `rise`, holds, then falls over the last `fall` of the sound.
const swell = (t, seconds, rise, fall) => Math.sin(Math.PI / 2 * Math.min(1, t / rise)) ** 2
  * (t < seconds - fall ? 1 : Math.cos(Math.PI / 2 * Math.min(1, (t - seconds + fall) / fall)) ** 2);

// A sine (plus harmonics) whose pitch glides; call it once per sample, in order.
function sweep(rate, from, to, time, harmonics = [1]) {
  let phase = 0;
  return t => {
    phase += 2 * Math.PI * glide(from, to, t, time) / rate;
    let value = 0;
    for (let h = 0; h < harmonics.length; h++) value += harmonics[h] * Math.sin(phase * (h + 1));
    return value;
  };
}
// Sparse clicks whose density decays: the grain of a crunch.
const crackle = (rate, rand, density, decay) => t => rand() < density * Math.exp(-t / decay) / rate ? (rand() < .5 ? -1 : 1) * (.4 + .6 * rand()) : 0;
// Noise held in steps: the "pixel" texture that matches the pixel blood.
function held(rate, rand, hz) {
  const hold = Math.max(1, Math.round(rate / hz));
  let value = 0, left = 0;
  return () => { if (left-- <= 0) { value = rand() * 2 - 1; left = hold - 1; } return value; };
}
// One layer of a sound, normalized to a peak of 1 so the mix weights read as peaks.
function layer(length, rate, fill) {
  const out = new Float32Array(length);
  let peak = 0;
  for (let i = 0; i < length; i++) { const value = fill(i / rate, i); out[i] = value; peak = Math.max(peak, Math.abs(value)); }
  if (peak > 0) for (let i = 0; i < length; i++) out[i] /= peak;
  return out;
}
// Mixes the layers, then optional drive and bit reduction, the candidate's
// high-pass (keeps the master compressor calm), an optional lowpass, a tail
// fade and a .9 peak. The fade is 6 ms, or with `release` a raised cosine over
// min(release, a quarter of the buffer), for sounds sized to have decayed by then.
function finish(data, rate, parts, { highpass = 0, lowpass = 0, drive = 0, bits = 0, fade = true, release = 0 } = {}) {
  data.fill(0);
  for (const [part, weight] of parts) for (let i = 0; i < data.length; i++) data[i] += part[i] * weight;
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (!peak) return;
  const high = highpass ? new Filter(rate).tune(highpass, .6) : null, low = lowpass ? new Filter(rate).tune(lowpass, .7) : null;
  for (let i = 0; i < data.length; i++) {
    let value = data[i] / peak;
    if (drive) value = Math.tanh(value * drive) / Math.tanh(drive);
    if (bits) value = Math.round(value * bits) / bits;
    if (high) value = high.run(value).high;
    if (low) value = low.run(value).low;
    data[i] = value;
  }
  if (release) {
    const tail = Math.min(Math.round(release * rate), Math.floor(data.length / 4));
    for (let i = 0; i < tail; i++) data[data.length - 1 - i] *= .5 - .5 * Math.cos(Math.PI * i / tail);
  } else {
    const tail = fade ? Math.min(data.length, Math.round(rate * .006)) : 0;
    for (let i = 0; i < tail; i++) data[data.length - 1 - i] *= i / tail;
  }
  peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak) for (let i = 0; i < data.length; i++) data[i] *= .9 / peak;
}
// A loop without a seam: render one second more, then fade that second into
// the start (equal power: only for noise, never for an exactly periodic tone).
function seamless(data, rate, fill) {
  const length = data.length, overlap = Math.min(length, Math.round(rate)), temp = new Float32Array(length + overlap);
  fill(temp);
  data.set(temp.subarray(0, length));
  for (let i = 0; i < overlap; i++) {
    const angle = (i + .5) / overlap * Math.PI / 2;
    data[i] = temp[i] * Math.sin(angle) + temp[length + i] * Math.cos(angle);
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak) for (let i = 0; i < length; i++) data[i] /= peak;
}
// Wind: noise through a band whose centre and level follow a slow, looping
// sum of sines (period = the loop), then a lowpass for distance.
function wind(length, rate, rand, { centre, depth, q, gust, distance, phase = 0 }) {
  const out = new Float32Array(length), period = length / rate;
  const motion = t => .6 * Math.sin(2 * Math.PI * t / period + phase) + .3 * Math.sin(6 * Math.PI * t / period + 1 + phase) + .2 * Math.sin(10 * Math.PI * t / period + 2 + phase);
  seamless(out, rate, temp => {
    const band = new Filter(rate), soft = new Filter(rate).tune(distance, .7);
    let level = 0;
    for (let i = 0; i < temp.length; i++) {
      if (i % 32 === 0) { const m = motion(i / rate); band.tune(centre * 2 ** (depth * m), q); level = 1 - gust + gust * ((m + 1.1) / 2.2) ** 2; }
      temp[i] = soft.run(band.run(rand() * 2 - 1).band).low * level;
    }
  });
  return out;
}

// Every Frisson pitch is a semitone offset from this tonic, D4, on the veille
// bed's D drone: transposing the whole set is this one line.
const TONIC = 293.66;
const pitch = semitones => TONIC * 2 ** (semitones / 12);
// An envelope is over once it falls under 1e-4: after ln(1e4) time constants.
const SPENT = Math.log(1e4);

// A square's edges smoothed over a sample (polyBLEP; x the phase in cycles,
// step the cycles per sample), so nothing folds back audibly.
const blep = (x, step) => x < step ? (x /= step, 2 * x - x * x - 1) : x > 1 - step ? (x = (x - 1) / step, x * x + 2 * x + 1) : 0;
// A note added into `out` from `at` (seconds) over its active window only: its
// onset until env(t, attack, decay) is spent or the buffer ends. Its pitch
// sags from `frequency` to `ratio` × it (time constant `time`), read again
// every 32 samples; the envelope steps by one product a sample. Each layer is
// [multiple of the pitch, level, 'sine' | 'triangle' | 'square'], in a loop of
// its own: a sine is a turning phasor, never Math.sin per sample.
function note(out, rate, at, frequency, { ratio = 1, time = 1, attack, decay, layers }) {
  const start = Math.max(0, Math.round(at * rate)), rise = Math.max(1, Math.round(attack * rate));
  const end = Math.min(out.length, start + rise + Math.ceil(decay * rate * SPENT));
  const fall = Math.exp(-1 / (decay * rate)), settle = Math.exp(-32 / (time * rate));
  for (const [multiple, level, shape] of layers) {
    const base = multiple * frequency / rate;
    let bend = 1 - ratio, amp = level, phase = 0, re = 1, im = 0, i = start;
    while (i < end) {
      const step = base * (ratio + bend), block = Math.min(end, i + 32);
      bend *= settle;
      if (shape === 'sine') {
        const c = Math.cos(2 * Math.PI * step), s = Math.sin(2 * Math.PI * step);
        for (; i < block; i++) {
          const k = i - start;
          out[i] += im * (k < rise ? level * k / rise : amp);
          if (k >= rise) amp *= fall;
          const next = re * c - im * s; im = re * s + im * c; re = next;
        }
      } else if (shape === 'triangle') {
        for (; i < block; i++) {
          const k = i - start;
          out[i] += (phase < .25 ? 4 * phase : phase < .75 ? 2 - 4 * phase : 4 * phase - 4) * (k < rise ? level * k / rise : amp);
          if (k >= rise) amp *= fall;
          phase += step; if (phase >= 1) phase -= 1;
        }
      } else {
        for (; i < block; i++) {
          const k = i - start, other = phase < .5 ? phase + .5 : phase - .5;
          out[i] += ((phase < .5 ? 1 : -1) + blep(phase, step) - blep(other, step)) * (k < rise ? level * k / rise : amp);
          if (k >= rise) amp *= fall;
          phase += step; if (phase >= 1) phase -= 1;
        }
      }
    }
  }
}
// Fixed-pitch partials, each [frequency, level, decay] under env(t, attack,
// decay), added into `out` from `at` over their own active windows: the bed's
// rotating phasor with the decay folded into each turn, four products a sample
// and no Math.sin. `drift(t)`, when given, bends every pitch by a slow factor,
// read again every 32 samples.
function ring(out, rate, at, partials, { attack = .001, drift = null } = {}) {
  const start = Math.max(0, Math.round(at * rate)), rise = Math.max(1, Math.round(attack * rate));
  for (const [frequency, level, decay] of partials) {
    if (!level || !(frequency > 0 && frequency < rate / 2)) continue;
    const end = Math.min(out.length, start + rise + Math.ceil(decay * rate * SPENT)), top = Math.min(end, start + rise);
    const fall = Math.exp(-1 / (decay * rate)), turn = 2 * Math.PI * frequency / rate;
    let w = drift ? turn * drift(start / rate) : turn, c = Math.cos(w), s = Math.sin(w), re = level, im = 0, i = start;
    for (; i < top; i++) { out[i] += im * (i - start) / rise; const next = re * c - im * s; im = re * s + im * c; re = next; }
    let dc = c * fall, ds = s * fall;
    if (!drift) for (; i < end; i++) { out[i] += im; const next = re * dc - im * ds; im = re * ds + im * dc; re = next; }
    else while (i < end) {
      w = turn * drift(i / rate); dc = Math.cos(w) * fall; ds = Math.sin(w) * fall;
      for (const block = Math.min(end, i + 32); i < block; i++) { out[i] += im; const next = re * dc - im * ds; im = re * ds + im * dc; re = next; }
    }
  }
}
// A burst of noise through `filter` under `shape(t)`, over [at, at + seconds):
// peak-normalized, then added at `level`. It draws from the candidate's seeded
// generator, so it renders the same every time.
function burst(out, rate, rand, at, seconds, level, filter, shape) {
  const start = Math.max(0, Math.round(at * rate)), length = Math.max(0, Math.min(out.length - start, Math.round(seconds * rate))), temp = new Float64Array(length);
  let peak = 0;
  for (let k = 0; k < length; k++) { const value = filter(rand() * 2 - 1) * shape(k / rate); temp[k] = value; peak = Math.max(peak, Math.abs(value)); }
  if (peak) for (let k = 0; k < length; k++) out[start + k] += temp[k] * level / peak;
}
// The kill crack's low body (KILL-SOUND.md 1.2, layer B), added into `mix` from
// t = 0: a sine sweep with harmonics under env(t, .0015, decay), peak-normalized,
// then driven on its own (tanh), then weighted. It runs until its envelope is
// spent or the buffer ends.
function body(mix, rate, weight, { from = 170, to = 70, time = .015, decay = .03, harmonics = [1, .5, .3], drive = 2.5 } = {}) {
  const osc = sweep(rate, from, to, time, harmonics), length = Math.min(mix.length, Math.round(rate * (.0015 + decay * SPENT))), temp = new Float64Array(length);
  let peak = 0;
  for (let i = 0; i < length; i++) { const t = i / rate, value = osc(t) * env(t, .0015, decay); temp[i] = value; peak = Math.max(peak, Math.abs(value)); }
  if (!peak) return;
  const norm = Math.tanh(drive);
  for (let i = 0; i < length; i++) mix[i] += Math.tanh(drive * temp[i] / peak) / norm * weight;
}
// A crackle (sparse clicks whose density decays) fed for `span` s from `at`
// into resonators, each [Hz, Q, weight] (band outputs, summed), which ring
// 30 ms more: peak-normalized, then added at `weight`.
function crackleInto(mix, rate, rand, at, span, density, decay, bands, weight) {
  const start = Math.max(0, Math.round(at * rate)), length = Math.max(0, Math.min(mix.length - start, Math.round((span + .03) * rate)));
  const grit = crackle(rate, rand, density, decay), filters = bands.map(([frequency, q]) => new Filter(rate).tune(frequency, q)), temp = new Float64Array(length);
  let peak = 0;
  for (let k = 0; k < length; k++) {
    const t = k / rate, x = t < span ? grit(t) : 0;
    let value = 0;
    for (let b = 0; b < filters.length; b++) value += filters[b].run(x).band * bands[b][2];
    temp[k] = value; peak = Math.max(peak, Math.abs(value));
  }
  if (peak) for (let k = 0; k < length; k++) mix[start + k] += temp[k] * weight / peak;
}

// The kill-chain rung, exactly the step count of audio.js chain(): 2 to 6
// notes, then one more at 8, 15, 30 and 75 kills (rungs 7 to 10). A chain
// candidate's variant is its rung − 2, picked by the count, never at random.
export function chainRung(count) {
  const whole = Math.floor(count);
  return Math.min(whole, 6) + (whole >= 75 ? 4 : whole >= 30 ? 3 : whole >= 15 ? 2 : whole >= 8 ? 1 : 0);
}
// Melodic notes m (2-6) and the shadows s (0-4) under them, heavier below.
const rungOf = variant => { const rung = variant + 2, m = Math.min(rung, 6); return { rung, m, s: rung - m }; };
const MINOR = [0, 3, 7, 12, 15, 19];
// boite's onsets: the spring runs down, each gap 6 ms longer than the one before (Σ .065 + .006k).
const BOITE_AT = [0, .065, .136, .213, .296, .385];
// glas: a small bell's partials, [multiple of the prime, level, decay]. 1.2 is
// the bell's own minor third and 2.4 a minor tenth (a church bell's 2.5 would
// be a major tenth); .5 is the hum, at .2, not .35: under 250 Hz it fills the
// K-weighted level without carrying over the bed (rule L5).
const BELL = [[.5, .2, .40], [1, 1, .30], [1.2, .5, .24], [1.5, .25, .16], [2, .4, .13], [2.4, .12, .07], [2.66, .1, .07]];

// The candidates. Each one-shot is rendered in a few variants (seed + variant)
// and replayed at a slightly varied rate; gains are peak levels at the output;
// highpass is in Hz, 0 for none (sounds.md lists it per candidate).

// The kill-chain jingle (art/frisson/UI-SOUND.md section 3.2): nine buffers,
// one per rung, each normalized to .9, so rungGain[rung - 2] (× gain) sets
// each rung against the Famille one, by measurement (tools/frisson-sound-render.mjs).
// Played at rate 1, one at a time, never refused (createSounds' chain()). Where
// a number differs from the brief, the measured rules asked for it (sounds.md):
// shorter decays for the clean ending, and the few changes noted below.
const CHAIN = [
  {
    id: 'mineur', label: 'Trois notes mineures', variants: 9, gain: .05, cooldown: 0, seed: 7101, highpass: 40,
    rungGain: [1.099, 1.118, 1, 1.022, 1.067, 1.224, 1.438, 1.556, 1.676],
    about: 'Arpège de ré mineur qui monte (ré, fa, la, puis l’octave), une note toutes les 75 ms : deux triangles désaccordés de ±5 cents et un sinus à l’octave du dessous, dont la hauteur s’affaisse de 26 cents au lieu de monter. Doublé ré → fa (tierce mineure), triplé ré-fa-la. La dernière note garde une petite sous-octave. Au-delà de six éliminations, la série s’alourdit par le bas, juste après la dernière note : ré grave, puis triton (sol dièse), puis ré très grave et un souffle. Passe-bas 2,2 kHz. De 0,375 à 1,075 s.',
    secondsFor(variant) { const { m, s } = rungOf(variant); return .075 * (m - 1) + .30 + .10 * s; },
    render(data, rate, rand, variant) {
      const { m, s } = rungOf(variant), mix = new Float64Array(data.length), last = (m - 1) * .075, toll = last + .06;
      // ±5 cents, not 7: a ±7 pair beats to silence 70 ms into A5 (A5 then reads
      // as its own octave below) and 210 ms into D4 (its line splits onto C#4).
      // The last note's extra sub-octave is .15, not .35, for the same reason.
      for (let i = 0; i < m; i++) {
        const f = pitch(MINOR[i]), end = i === m - 1;
        note(mix, rate, i * .075, f, { ratio: .985, time: .12, attack: .005, decay: .08, layers: [[2 ** (-5 / 1200), .5, 'triangle'], [2 ** (5 / 1200), .5, 'triangle'], [.5, .3, 'sine']] });
        if (end) note(mix, rate, last, f / 2, { ratio: .985, time: .12, attack: .02, decay: .08, layers: [[1, .15, 'sine']] });
      }
      // The shadows land just after the last note, which they would otherwise drown.
      if (s >= 1) ring(mix, rate, toll, [[pitch(-12), .45, .11], [pitch(0), .45 * .3, .11]], { attack: .03 });
      if (s >= 2) note(mix, rate, toll, pitch(-6), { attack: .04, decay: .11, layers: [[1, .22, 'triangle']] });
      if (s >= 3) ring(mix, rate, toll, [[pitch(-24), .5, .18], [pitch(-12), .5 * .5, .18]], { attack: .05 });
      if (s >= 4) { const band = new Filter(rate).tune(300, 1.5); burst(mix, rate, rand, toll, .45, .2, x => band.run(x).band, t => swell(t, .45, .15, .25)); }
      finish(data, rate, [[mix, 1]], { highpass: this.highpass, lowpass: 2200, release: .08 });
    },
  },
  {
    id: 'glauque', label: 'Mineur glauque : triton et demi-ton qui frotte', variants: 9, gain: .05, cooldown: 0, seed: 7201, highpass: 40,
    rungGain: [.913, .855, .844, .922, .998, 1.146, 1.346, 1.456, 1.568],
    about: 'Mineur assombri, une note toutes les 80 ms : le doublé est un triton (ré → la bémol), le triplé un accord diminué (ré, fa, la bémol), puis l’octave. Deux carrés adoucis (passe-bas 1,25 kHz), le second 18 cents plus bas, qui battent lentement, et une hauteur qui s’affaisse de 30 cents. Un mi bémol fixe frotte contre le ré (du fond sonore) juste après la dernière note. Au-delà de six : ré grave, la grave, ré très grave, puis un métal frotté sur un mi bémol aigu. Passe-bas 1,8 kHz. De 0,36 à 1,08 s.',
    secondsFor(variant) { const { m, s } = rungOf(variant); return .08 * (m - 1) + .28 + .10 * s; },
    render(data, rate, rand, variant) {
      const { m, s } = rungOf(variant), n = data.length, mix = new Float64Array(n), squares = new Float64Array(n), last = (m - 1) * .08;
      const notes = m === 2 ? [0, 6] : [0, 3, 6, 12, 15, 18].slice(0, m);
      notes.forEach((offset, i) => note(squares, rate, i * .08, pitch(offset), { ratio: .983, time: .15, attack: .004, decay: i === m - 1 ? .075 : .08, layers: [[1, 1, 'square'], [2 ** (-18 / 1200), .6, 'square']] }));
      // The squares' own low-pass, one filter for every note (the same sum), at
      // 1.25 kHz: at the brief's 1.4 the D4 square's 5th harmonic, on F#6, was
      // only 24.0 dB under the strongest peak, the no-third limit.
      const soft = new Filter(rate).tune(1250, .7);
      for (let i = 0; i < n; i++) mix[i] = soft.run(squares[i]).low;
      // The rub: a fixed Eb, a minor second over D, never a semitone from the last note.
      ring(mix, rate, last + .06, [[pitch(m >= 4 ? 13 : 1), .25, .06]], { attack: .03 });
      if (s >= 1) ring(mix, rate, last, [[pitch(-12), .45, .18]], { attack: .03 });
      if (s >= 2) ring(mix, rate, last, [[pitch(-17), .35, .18]], { attack: .03 });
      if (s >= 3) ring(mix, rate, last, [[pitch(-24), .5, .22], [pitch(-12), .5 * .5, .22]], { attack: .05 });
      // The bowed metal rings on Eb6, the rub an octave up: the brief's 1.1 kHz is 14 cents under C#6.
      if (s >= 4) { const band = new Filter(rate).tune(pitch(25), 14); burst(mix, rate, rand, last, .5, .18, x => band.run(x).band, t => swell(t, .5, .2, .25)); }
      finish(data, rate, [[mix, 1]], { highpass: this.highpass, lowpass: 1800, release: .08 });
    },
  },
  {
    id: 'boite', label: 'Mécanisme qui s’épuise, lames faussées', variants: 9, gain: .045, cooldown: 0, seed: 7301, highpass: 40,
    rungGain: [1.288, 1.193, 1.245, 1.272, 1.351, 1.546, 1.897, 2.052, 2.619],
    about: 'Petites lames de métal frappées (partiels 1 ; 2,756 ; 5,404, ceux d’une lame libre de glockenspiel, pas d’une boîte à musique) sur les notes de « Trois notes mineures », de plus en plus espacées, comme un ressort qui se détend (65 ms, puis 71, 77…). Chaque note est 8 cents plus basse que la précédente, le tout ondule de ±10 cents à 4,5 Hz, et la dernière lame accroche une seconde fois, plus bas. Au-delà de six : coup de bois, lame grave en ré, second accroc, lame en la grave. Passe-bas 3 kHz. De 0,365 à 1,085 s.',
    secondsFor(variant) { const { m, s } = rungOf(variant); return BOITE_AT[m - 1] + .30 + .10 * s; },
    render(data, rate, rand, variant) {
      const { m, s } = rungOf(variant), mix = new Float64Array(data.length), last = BOITE_AT[m - 1], top = pitch(MINOR[m - 1]), flat = 8 * (m - 1);
      const wobble = t => 2 ** (10 * Math.sin(2 * Math.PI * 4.5 * t) / 1200);
      const bar = (at, f, level, cents) => {
        const tuned = f * 2 ** (-cents / 1200), click = new Filter(rate).tune(3000, .7);
        ring(mix, rate, at, [[tuned, level, .065], [tuned * 2.756, .35 * level, .05], [tuned * 5.404, .12 * level, .025]], { drift: wobble });
        burst(mix, rate, rand, at, .003, .15 * level, x => click.run(x).high, t => env(t, .0002, .0008));
      };
      for (let i = 0; i < m; i++) bar(BOITE_AT[i], pitch(MINOR[i]), 1, 8 * i);
      bar(last + .08, top, .4, flat + 15);
      if (s >= 1) note(mix, rate, last, 140, { ratio: 90 / 140, time: .02, attack: .001, decay: .04, layers: [[1, .4, 'sine']] });
      if (s >= 2) bar(last, pitch(-12), .5, 0);
      if (s >= 3) bar(last + .18, top, .3, flat + 25);
      if (s >= 4) bar(last, pitch(-17), .4, 0);
      finish(data, rate, [[mix, 1]], { highpass: this.highpass, lowpass: 3000, release: .08 });
    },
  },
  {
    id: 'glas', label: 'Petit glas qui descend', variants: 9, gain: .045, cooldown: 0, seed: 7401, highpass: 40,
    rungGain: [1.082, 1.063, 1.101, 1.251, 1.384, 1.614, 1.963, 2.124, 2.288],
    about: 'Petites cloches qui sonnent en descendant jusqu’au ré, une toutes les 100 ms : doublé fa → ré, triplé la → fa → ré ; la cloche la plus haute monte avec la série. Chaque cloche porte sa propre tierce mineure (partiels 0,5 ; 1 ; 1,2 ; 1,5 ; 2 ; 2,4 ; 2,66 de la note). Au-delà de six : une grosse cloche en ré grave sous la dernière, son bourdon plus fort, une seconde frappe, puis une cloche en sol dièse grave. Passe-bas 2,6 kHz. De 1,0 à 1,8 s : une cloche a besoin de résonner.',
    secondsFor(variant) { const { m, s } = rungOf(variant); return .10 * (m - 1) + .90 + .10 * s; },
    render(data, rate, rand, variant) {
      const { m, s } = rungOf(variant), mix = new Float64Array(data.length), last = (m - 1) * .1;
      const bell = (at, prime, level, stretch, { hum = BELL[0][1], partials = BELL.length } = {}) => {
        const strike = new Filter(rate).tune(2000, 1);
        ring(mix, rate, at, BELL.slice(0, partials).map(([multiple, weight, decay], k) => [prime * multiple, (k ? weight : hum) * level, decay * stretch]));
        burst(mix, rate, rand, at, .005, .2 * level, x => strike.run(x).band, t => env(t, .0005, .0015));
      };
      for (let i = 0; i < m; i++) bell(i * .1, pitch(MINOR[m - 1 - i]), 1, i === m - 1 ? 1.15 : 1);
      if (s >= 1) bell(last, pitch(-12), .5, 1.2, { hum: s >= 2 ? .6 : BELL[0][1] });
      if (s >= 3) bell(last + .25, pitch(-12), .35, 1.2, { hum: .6 });
      // Its 2.66 partial would land on C#4: left off.
      if (s >= 4) bell(last + .15, pitch(-18), .3, 1, { partials: BELL.length - 1 });
      finish(data, rate, [[mix, 1]], { highpass: this.highpass, lowpass: 2600, release: .08 });
    },
  },
];
// `seconds` is the longest buffer, rung 10's.
for (const made of CHAIN) made.seconds = made.secondsFor(8);

const HIT = [
  {
    id: 'mouille', label: 'Choc mouillé', seconds: .16, variants: 3, gain: .05, cooldown: .035, seed: 1101, highpass: 40,
    about: 'Bruit filtré par une bande résonante qui tombe de 1,7 kHz à 320 Hz (« squelch ») sur un coup sourd sinusoïdal 150 → 55 Hz, avec une claque aiguë de 5 ms au-dessus de 2,6 kHz. 160 ms.',
    render(data, rate, rand, variant) {
      const n = data.length, pitch = [.92, 1, 1.08][variant] ?? 1, osc = sweep(rate, 150 * pitch, 55 * pitch, .03), wet = new Filter(rate), hp = new Filter(rate).tune(2600, .8);
      const thump = layer(n, rate, t => osc(t) * env(t, .002, .05));
      const squelch = layer(n, rate, t => wet.tune(glide(1700 * pitch, 320, t, .035), 3.2).run(rand() * 2 - 1).band * env(t - .003, .004, .04));
      const slap = layer(n, rate, t => hp.run(rand() * 2 - 1).high * env(t, .0005, .005));
      finish(data, rate, [[thump, 1], [squelch, .7], [slap, .35]], { highpass: this.highpass });
    },
  },
  {
    id: 'lourd', label: 'Coup lourd', seconds: .2, variants: 3, gain: .05, cooldown: .035, seed: 1201, highpass: 40,
    about: 'Grave sinusoïdal 100 → 42 Hz avec son harmonique 2 (pour les petits haut-parleurs) et un corps de bruit sous 520 Hz, saturés doucement (tanh ×2,2). 200 ms.',
    render(data, rate, rand, variant) {
      const n = data.length, pitch = [.92, 1, 1.08][variant] ?? 1, osc = sweep(rate, 100 * pitch, 42 * pitch, .045, [1, .35]), lp = new Filter(rate).tune(520 * pitch, .9);
      const sub = layer(n, rate, t => osc(t) * env(t, .002, .08));
      const body = layer(n, rate, t => lp.run(rand() * 2 - 1).low * env(t, .001, .045));
      finish(data, rate, [[sub, 1], [body, .6]], { highpass: this.highpass, drive: 2.2 });
    },
  },
  {
    id: 'pixel', label: 'Choc pixel', seconds: .12, variants: 3, gain: .06, cooldown: .035, seed: 1301, highpass: 40,
    about: 'Bruit tenu par paliers (3 kHz) dans une bande qui tombe de 1,4 kHz à 380 Hz, sur un coup carré 120 → 60 Hz, le tout réduit à 15 niveaux (environ 4 bits), comme le sang pixelisé. 120 ms.',
    render(data, rate, rand, variant) {
      const n = data.length, pitch = [.92, 1, 1.08][variant] ?? 1, steps = held(rate, rand, 3000), band = new Filter(rate), lp = new Filter(rate).tune(600, .7);
      let phase = 0;
      const grit = layer(n, rate, t => band.tune(glide(1400 * pitch, 380, t, .03), 2).run(steps()).band * env(t, .002, .035));
      const thump = layer(n, rate, t => { phase += 2 * Math.PI * glide(120 * pitch, 60 * pitch, t, .03) / rate; return lp.run(Math.sign(Math.sin(phase))).low * env(t, .001, .04); });
      finish(data, rate, [[grit, .8], [thump, .7]], { highpass: this.highpass, bits: 7 });
    },
  },
];

const HEADSHOT = [
  {
    id: 'craquement', label: 'Craquement + tintement', seconds: .1, variants: 3, gain: .042, cooldown: .04, seed: 2101, highpass: 40, tink: true,
    about: 'Grésillement de clics (densité 9 000/s, constante de 20 ms) dans une bande à 2,8 kHz, écrasement de bruit sous 1,4 kHz et petit coup 260 → 120 Hz, saturés (tanh ×2). Le « tink » Famille du tir à la tête joue par-dessus : le repère sonore reste. 100 ms.',
    render(data, rate, rand, variant) {
      const n = data.length, pitch = [.94, 1, 1.06][variant] ?? 1, grit = crackle(rate, rand, 9000, .02), band = new Filter(rate).tune(2800 * pitch, 1.1), lp = new Filter(rate).tune(1400, .8), osc = sweep(rate, 260 * pitch, 120 * pitch, .02);
      const crunch = layer(n, rate, t => band.run(grit(t)).band);
      const crush = layer(n, rate, t => lp.run(rand() * 2 - 1).low * env(t, .001, .025));
      const knock = layer(n, rate, t => osc(t) * env(t, .001, .03));
      finish(data, rate, [[crunch, 1], [crush, .45], [knock, .5]], { highpass: this.highpass, drive: 2 });
    },
  },
  {
    id: 'sourd', label: 'Craquement grave, sans tintement', seconds: .14, variants: 3, gain: .056, cooldown: .04, seed: 2201, highpass: 40,
    about: 'Grésillement plus grave (bande à 1,5 kHz, densité 7 000/s sur 28 ms), coup 180 → 75 Hz et écrasement sous 800 Hz, saturés (tanh ×1,6). Sans le « tink » : le tir à la tête ne s’entend plus qu’à ce craquement. 140 ms.',
    render(data, rate, rand, variant) {
      const n = data.length, pitch = [.94, 1, 1.06][variant] ?? 1, grit = crackle(rate, rand, 7000, .028), band = new Filter(rate).tune(1500 * pitch, 1.4), lp = new Filter(rate).tune(800, .8), osc = sweep(rate, 180 * pitch, 75 * pitch, .03);
      const crunch = layer(n, rate, t => band.run(grit(t)).band);
      const knock = layer(n, rate, t => osc(t) * env(t, .001, .055));
      const crush = layer(n, rate, t => lp.run(rand() * 2 - 1).low * env(t, .001, .035));
      finish(data, rate, [[crunch, .9], [knock, 1], [crush, .5]], { highpass: this.highpass, drive: 1.6 });
    },
  },
  {
    id: 'fele', label: 'Tintement fêlé', seconds: .19, variants: 3, gain: .0556, cooldown: .04, seed: 2301, highpass: 40,
    about: 'Deux sinus à un demi-ton l’un de l’autre (sol et la bémol aigus, 784 et 831 Hz), qui battent rudement à 47 Hz et glissent ensemble d’un demi-ton vers le bas (86 cents en 60 ms), sur le craquement grave de « sourd » et un petit coup 180 → 75 Hz. Le tir à la tête garde un repère qui sonne, distinct de l’impact, mais dissonant et qui tombe : ni quarte qui monte, ni accord majeur. 190 ms.',
    render(data, rate, rand, variant) {
      const n = data.length, shift = [.97, 1, 1.03][variant] ?? 1, g = pitch(17) * shift, ab = pitch(18) * shift;
      const high = sweep(rate, g, g * .944, .03), low = sweep(rate, ab, ab * .944, .03), osc = sweep(rate, 180 * shift, 75 * shift, .03);
      const grit = crackle(rate, rand, 7000, .028), band = new Filter(rate).tune(1500 * shift, 1.4);
      // The ping's decay is .05 s, not .06, so it is 20 dB down where the release starts.
      const ping = layer(n, rate, t => (high(t) + low(t)) * env(t, .002, .05));
      const crunch = layer(n, rate, t => band.run(grit(t)).band);
      const knock = layer(n, rate, t => osc(t) * env(t, .001, .055));
      finish(data, rate, [[ping, 1], [crunch, .4], [knock, .5]], { highpass: this.highpass, lowpass: 3200, release: .08 });
    },
  },
];

// Each kill candidate keeps the zombie's voice: groan(.09), as Famille does
// (so a chosen groan speaks here too), then plays its own body sound, through
// the kill player (createSounds' kill()): KILL_LAG after the shot, merged in a
// horde, never refused for lack of voices.
//
// The four cracks of 14 October (KILL-SOUND.md section 2): a sharp crack and a
// crackle over a light, short low body, t = 0 the body's onset and the crack at
// CRACK_AT. Six variants each, never the same twice in a row: KILL_SPREAD[v]
// moves only the crack band, the resonators and the slap bands (os's notes
// never move). variantGain (x gain) is each variant's playback level, set by
// measurement (tools/frisson-sound-render.mjs --slot kill, sounds.md) so every
// variant measures the same perceived level, at 48 kHz (the game renders these
// at 48 kHz on any device: MEASURED_RATE); gain is the lowest that still cuts
// through the owner's gun takes in Edge's own master compressor, at 48 and
// 44.1 kHz (the kill-mix page of art/frisson/tools/feedback-shot decides; his
// words: « ça n'a pas besoin d'être fort »).
const CRACK_AT = .002, KILL_SPREAD = [1, .95, 1.05, .975, 1.025, .99];
const KILL = [
  {
    id: 'craque', label: 'Craquement d’os sec', seconds: .18, variants: 6, gain: .2938, variantGain: [1.2, 1.033, .958, .927, 1.004, .905], seed: 3301, highpass: 40, voice: .09,
    about: 'Os qui casse net : un claquement très bref (bande de 2,7 kHz) et un grésillement d’os de 40 ms (résonances à 2,2 et 3 kHz) sur un petit coup sourd 170 → 70 Hz. Aucune note. 180 ms, 40 ms après le coup de feu, avec le grognement de mort habituel. Le même pour un tir à la tête : c’est le « fêlé » qui marque la tête.',
    render(data, rate, rand, variant) {
      const s = KILL_SPREAD[variant] ?? 1, mix = new Float64Array(data.length), band = new Filter(rate).tune(2700 * s, .9), high = new Filter(rate).tune(1600, .7);
      body(mix, rate, .1);
      burst(mix, rate, rand, CRACK_AT, .02, 1, x => high.run(band.run(x).band).high, t => env(t, .0002, .003));
      crackleInto(mix, rate, rand, CRACK_AT, .04, 4000, .012, [[2200 * s, 3, 1], [3000 * s, 3, .8]], .65);
      finish(data, rate, [[mix, 1]], { highpass: this.highpass, lowpass: 3500, drive: 1.2, release: .045 });
    },
  },
  {
    id: 'claque', label: 'Claque sèche', seconds: .16, variants: 6, gain: .281, variantGain: [.943, 1.061, .993, 1.11, .83, 1.091], seed: 3401, highpass: 40, voice: .09,
    about: 'Claque sèche : trois claques de bruit très rapprochées (0, 7 et 15 ms, bande de 1,6 kHz) et un « snap » à 2,9 kHz sur un petit coup sourd. Le plus proche d’un marqueur de touche de jeu de tir, mais il passe moins bien au-dessus des tirs. 160 ms.',
    render(data, rate, rand, variant) {
      const s = KILL_SPREAD[variant] ?? 1, mix = new Float64Array(data.length);
      body(mix, rate, .1);
      for (const [delay, level] of [[0, 1], [.007, .6], [.015, .35]]) { const band = new Filter(rate).tune(1600 * s, 1); burst(mix, rate, rand, CRACK_AT + delay, .03, level, x => band.run(x).band, t => env(t, .0003, .006)); }
      const snap = new Filter(rate).tune(2900 * s, 1.5), high = new Filter(rate).tune(2000, .7);
      burst(mix, rate, rand, CRACK_AT, .01, .8, x => high.run(snap.run(x).band).high, t => env(t, .0001, .0015));
      finish(data, rate, [[mix, 1]], { highpass: this.highpass, lowpass: 3500, drive: 1.2, release: .04 });
    },
  },
  {
    id: 'coquille', label: 'Coquille qui éclate (esprit Warzone)', seconds: .2, variants: 6, gain: .3033, variantGain: [.967, 1.047, .829, 1.06, .986, 1.138], seed: 3501, highpass: 40, voice: .09,
    about: 'Plaque ou carapace qui éclate, dans l’esprit du craquement de Warzone : un éclat bref, un crépitement dans trois résonances qui ne s’accordent pas (1,7 ; 2,3 ; 2,9 kHz), puis quelques petits débris jusqu’à 70 ms, sur un petit coup sourd. Les débris ne s’entendent qu’hors des tirs. 200 ms.',
    render(data, rate, rand, variant) {
      const s = KILL_SPREAD[variant] ?? 1, mix = new Float64Array(data.length), band = new Filter(rate).tune(2600 * s, 1), high = new Filter(rate).tune(1200, .7), soft = new Filter(rate).tune(3000, .7);
      body(mix, rate, .1);
      burst(mix, rate, rand, CRACK_AT, .015, 1, x => high.run(band.run(x).band).high, t => env(t, .0002, .0015));
      crackleInto(mix, rate, rand, CRACK_AT, .025, 4000, .01, [[1700 * s, 9, 1], [2300 * s, 10, .8], [2900 * s, 11, .6]], .8);
      // Debris: six ticks 30 to 70 ms after the crack, each in its own inharmonic band.
      for (let k = 0; k < 6; k++) {
        const at = CRACK_AT + .03 + .04 * rand(), tick = new Filter(rate).tune((1900 + 900 * rand()) * s, 6);
        burst(mix, rate, rand, at, .012, .2, x => soft.run(tick.run(x).band).low, t => env(t, .0002, .0015));
      }
      finish(data, rate, [[mix, 1]], { highpass: this.highpass, lowpass: 3500, drive: 1.2, release: .05 });
    },
  },
  {
    id: 'os', label: 'Os sec et note grave en ré', seconds: .25, variants: 6, gain: .3294, variantGain: [.93, .836, 1.251, 1.042, 1.089, .857], seed: 3601, highpass: 40, voice: .09, pitched: true,
    about: 'Os sec et note grave : un coup creux accordé sur ré, un claquement, puis une courte résonance grave en ré mineur (ré, ré grave, fa très bas). Le plus musical des quatre : il sonne avec la mélodie des séries, mais il s’entend peu sous les tirs. 250 ms.',
    render(data, rate, rand, variant) {
      const s = KILL_SPREAD[variant] ?? 1, mix = new Float64Array(data.length), band = new Filter(rate).tune(2600 * s, 1), high = new Filter(rate).tune(1600, .7);
      body(mix, rate, .08);
      // The knock, tuned to D and never spread: D4, a wood partial between E5
      // and F5 (x2.32, not a note) and an Eb6 shadow (x4.25).
      ring(mix, rate, CRACK_AT, [[TONIC, .15, .025], [TONIC * 2.32, .12, .012], [TONIC * 4.25, .08, .006]], { attack: .0003 });
      burst(mix, rate, rand, CRACK_AT, .015, 1, x => high.run(band.run(x).band).high, t => env(t, .0002, .003));
      // The dark tail: D2, D3 and F3, the minor third. It plays at rate 1 always.
      ring(mix, rate, CRACK_AT + .01, [[pitch(-24), .035, .07], [pitch(-12), .05, .06], [pitch(-9), .015, .045]], { attack: .006 });
      finish(data, rate, [[mix, 1]], { highpass: this.highpass, lowpass: 3500, drive: 1.3, release: .06 });
    },
  },
  {
    id: 'eclat', label: 'Giclée + os qui casse', seconds: .26, variants: 3, gain: .2303, cooldown: .04, seed: 3101, highpass: 40, voice: .09,
    about: 'Giclée : bruit dans une bande résonante (Q 4) qui tombe de 1,4 kHz vers 260 Hz (constante de 60 ms), avec un léger glouglou à 32 Hz. Os : quatre clics serrés en 10 ms à +22 ms, bande 3,2 kHz au-dessus de 1,8 kHz. Coup sourd 115 → 48 Hz. 260 ms, avec le grognement de mort habituel.',
    render(data, rate, rand, variant) {
      const n = data.length, pitch = [.93, 1, 1.07][variant] ?? 1, osc = sweep(rate, 115 * pitch, 48 * pitch, .04), wet = new Filter(rate);
      const thump = layer(n, rate, t => osc(t) * env(t, .002, .06));
      const squelch = layer(n, rate, t => wet.tune(glide(1400 * pitch, 260, t, .06), 4).run(rand() * 2 - 1).band * env(t - .002, .004, .07) * (1 - .35 * (.5 + .5 * Math.sin(2 * Math.PI * 32 * t))));
      const crackAt = .022, clicks = new Map([0, .0035, .0061, .0098].map(delay => [Math.round((crackAt + delay) * rate), (rand() < .5 ? -1 : 1) * (.5 + .5 * rand())]));
      const ring = new Filter(rate).tune(3200 * pitch, 1.2), hp = new Filter(rate).tune(1800, .7);
      const crack = layer(n, rate, (t, i) => hp.run(ring.run((clicks.get(i) ?? 0) + (rand() * 2 - 1) * .3 * env(t - crackAt, .0003, .006)).band).high);
      finish(data, rate, [[thump, .7], [squelch, .85], [crack, .75]], { highpass: this.highpass });
    },
  },
  {
    id: 'pixel', label: 'Éclaboussure pixel + claquement', seconds: .2, variants: 3, gain: .064, cooldown: .04, seed: 3201, highpass: 40, voice: .09,
    about: 'Éclaboussure : bruit tenu par paliers (2,4 kHz) dans une bande qui tombe de 1,8 kHz à 400 Hz. Claquement de bois : deux impulsions dans des résonances étroites à 2,1 et 1,7 kHz (Q 9). Coup carré 95 → 50 Hz, le tout réduit à 31 niveaux (environ 5 bits). 200 ms, avec le grognement de mort habituel.',
    render(data, rate, rand, variant) {
      const n = data.length, pitch = [.93, 1, 1.07][variant] ?? 1, steps = held(rate, rand, 2400), band = new Filter(rate), lp = new Filter(rate).tune(500, .7);
      const snapA = new Filter(rate).tune(2100 * pitch, 9), snapB = new Filter(rate).tune(1700 * pitch, 9), atA = Math.round(.015 * rate), atB = Math.round(.021 * rate);
      let phase = 0;
      const splat = layer(n, rate, t => band.tune(glide(1800 * pitch, 400, t, .04), 1.5).run(steps()).band * env(t, .002, .055));
      const snap = layer(n, rate, (t, i) => snapA.run(i === atA ? 1 : 0).band + .7 * snapB.run(i === atB ? 1 : 0).band);
      const thump = layer(n, rate, t => { phase += 2 * Math.PI * glide(95 * pitch, 50 * pitch, t, .04) / rate; return lp.run(Math.sign(Math.sin(phase))).low * env(t, .001, .05); });
      finish(data, rate, [[splat, .85], [snap, .6], [thump, .6]], { highpass: this.highpass, bits: 15 });
    },
  },
];

// Groans: gain is the level at groan(.055), the nearest zombie; it scales with
// the volume the game asks for, like the Famille take.
const GROAN = [
  {
    id: 'grave', label: 'Grognement grave', seconds: 1.3, variants: 3, gain: .08, cooldown: .8, seed: 4101, highpass: 40,
    about: 'Dent de scie 58 → 42 Hz (variantes 52, 58, 64 Hz) avec vibrato 5,2 Hz, dérive aléatoire et sous-harmonique (modulation à f0/2) pour le râpeux, filtrée par deux formants qui glissent de 430/800 Hz à 330/620 Hz, plus un souffle. 1,3 s.',
    render(data, rate, rand, variant) {
      const n = data.length, seconds = n / rate, base = [52, 58, 64][variant] ?? 58, shift = [.95, 1, 1.06][variant] ?? 1;
      const f1 = new Filter(rate), f2 = new Filter(rate), breath = new Filter(rate).tune(700 * shift, 1);
      let cycles = 0, drift = 0;
      const voice = layer(n, rate, (t, i) => {
        if (i % 64 === 0) { drift = drift * .97 + (rand() - .5) * .006; f1.tune(glide(430, 330, t, .5) * shift, 5); f2.tune(glide(800, 620, t, .6) * shift, 6); }
        cycles += base * (1 - .27 * Math.min(1, t / seconds)) * (1 + .015 * Math.sin(2 * Math.PI * 5.2 * t) + drift) / rate;
        const source = (2 * (cycles - Math.floor(cycles)) - 1) * (.62 + .38 * Math.sin(Math.PI * cycles));
        return (f1.run(source).band * .9 + f2.run(source).band * .55) * swell(t, seconds, .22, .5);
      });
      const air = layer(n, rate, t => breath.run(rand() * 2 - 1).band * swell(t, seconds, .3, .6));
      finish(data, rate, [[voice, 1], [air, .25]], { highpass: this.highpass });
    },
  },
  {
    id: 'rale', label: 'Râle éraillé', seconds: 1.25, variants: 3, gain: .09, cooldown: .8, seed: 4201, highpass: 40,
    about: 'Râle : dent de scie 72 → 56 Hz mêlée de bruit, hachée par un battement irrégulier de 22, 26 ou 30 coups par seconde (±18 %, qui ralentit), dans trois formants (360, 950, 2 400 Hz). 1,25 s.',
    render(data, rate, rand, variant) {
      const n = data.length, seconds = n / rate, flutter = [22, 26, 30][variant] ?? 26;
      const f1 = new Filter(rate).tune(360, 6), f2 = new Filter(rate).tune(950, 7), f3 = new Filter(rate).tune(2400, 8);
      let cycles = 0, beat = 0, speed = flutter;
      const voice = layer(n, rate, t => {
        beat += speed / rate;
        if (beat >= 1) { beat -= 1; speed = flutter * glide(1.1, .8, t, seconds * .6) * (.82 + .36 * rand()); }
        cycles += 72 * glide(1, .78, t, seconds * .7) / rate;
        const gate = (.5 - .5 * Math.cos(2 * Math.PI * beat)) ** 2;
        const source = ((2 * (cycles - Math.floor(cycles)) - 1) * .6 + (rand() * 2 - 1) * .4) * (.15 + .85 * gate);
        return (f1.run(source).band * .9 + f2.run(source).band * .5 + f3.run(source).band * .15) * swell(t, seconds, .18, .45);
      });
      finish(data, rate, [[voice, 1]], { highpass: this.highpass });
    },
  },
  {
    id: 'prise', label: 'Prise actuelle, plus grave', cooldown: .8,
    take: 'groan', rates: [.77, .8, .83], lowpass: 1000, boost: 1.2, fallback: 'grave',
    about: 'Les deux extraits de grognement du jeu (choisis par l’agent, pas par toi), joués 0,77 à 0,83 fois moins vite (donc plus graves et plus longs) à travers un passe-bas à 1 kHz. Traitement en mémoire : le fichier n’est ni modifié ni réexporté. Si l’extrait n’est pas encore décodé, c’est « Grognement grave » qui joue.',
  },
];

const AMBIENCE = [
  {
    id: 'veille', label: 'Veille : bourdon, vent lointain, craquements', seconds: 16, gain: .031, seed: 5101, highpass: 0, creaks: [14, 38], creakGain: .029,
    about: 'Boucle de 16 s sans couture : bourdon de ré (36,7, 73,4 et 73,5 Hz qui battent lentement, la 110 Hz, harmonique 147 Hz) qui respire sur 16 s, vent (bruit dans une bande qui erre entre 210 et 700 Hz, rafales lentes, passe-bas 900 Hz) et un sifflement lointain très discret (bande étroite entre 1,2 et 1,9 kHz). Un craquement de bois toutes les 14 à 38 s, à gauche ou à droite. Très bas.',
    render(data, rate, rand) {
      const n = data.length;
      // Whole cycles per loop: the drone repeats exactly and needs no crossfade.
      const cycles = [587, 1175, 1176, 1760, 2350], levels = [.3, .5, .35, .12, .08];
      const re = cycles.map(() => 1), im = cycles.map(() => 0), turn = cycles.map(c => [Math.cos(2 * Math.PI * c / n), Math.sin(2 * Math.PI * c / n)]);
      const drone = layer(n, rate, (t, i) => {
        let value = 0;
        for (let k = 0; k < cycles.length; k++) {
          value += levels[k] * im[k];
          const r = re[k] * turn[k][0] - im[k] * turn[k][1];
          im[k] = re[k] * turn[k][1] + im[k] * turn[k][0]; re[k] = r;
        }
        return value * (.75 + .25 * Math.cos(2 * Math.PI * i / n));
      });
      const air = wind(n, rate, rand, { centre: 380, depth: .8, q: .8, gust: .55, distance: 900 });
      const whistle = wind(n, rate, rand, { centre: 1500, depth: .3, q: 9, gust: .7, distance: 2600, phase: 2 });
      finish(data, rate, [[drone, .55], [air, .45], [whistle, .08]], { highpass: this.highpass, fade: false });
    },
  },
  {
    id: 'creux', label: 'Vent creux, sans note tenue', seconds: 16, gain: .028, seed: 5201, highpass: 0, creaks: [10, 28], creakGain: .029,
    about: 'Boucle de 16 s sans couture, sans aucune note (rien ne frotte contre la musique) : vent grave en rafales (bande qui erre entre 130 et 520 Hz, passe-bas 700 Hz), vent plus haut décalé (entre 480 Hz et 1 kHz, passe-bas 1,6 kHz) et grondement sous 90 Hz. Un craquement de bois toutes les 10 à 28 s. Très bas.',
    render(data, rate, rand) {
      const n = data.length, period = n / rate;
      const low = wind(n, rate, rand, { centre: 260, depth: .9, q: .7, gust: .75, distance: 700 });
      const high = wind(n, rate, rand, { centre: 700, depth: .5, q: 1.2, gust: .6, distance: 1600, phase: 2.4 });
      const rumble = new Float32Array(n);
      seamless(rumble, rate, temp => { const lp = new Filter(rate).tune(90, .7); for (let i = 0; i < temp.length; i++) temp[i] = lp.run(rand() * 2 - 1).low * (.7 + .3 * Math.sin(4 * Math.PI * i / rate / period)); });
      finish(data, rate, [[low, .6], [high, .25], [rumble, .35]], { highpass: this.highpass, fade: false });
    },
  },
];

// A cabin creak, shared by both beds: stick-slip pulses whose rate glides
// (rising in variants 0 and 2, falling in 1) through three wood resonances.
export const CREAK = Object.freeze({
  id: 'craquement', seconds: .9, variants: 3, seed: 5901, highpass: 120,
  about: 'Impulsions de frottement (38 → 75 /s ou 70 → 40 /s, ±22 %) dans trois résonances de bois (650, 1 350, 2 300 Hz, Q 14 à 18, décalées de -14 % à +15 % selon la variante), passe-bas 2,6 kHz pour la distance. 0,9 s.',
  render(data, rate, rand, variant) {
    const n = data.length, seconds = n / rate, shift = [.86, 1, 1.15][variant] ?? 1, rising = variant !== 1;
    const modes = [new Filter(rate).tune(650 * shift, 14), new Filter(rate).tune(1350 * shift, 16), new Filter(rate).tune(2300 * shift, 18)], levels = [.9, .6, .25], far = new Filter(rate).tune(2600, .7);
    let next = 0;
    const creak = layer(n, rate, (t, i) => {
      let x = 0;
      if (i >= next) { x = .6 + .4 * rand(); next = i + Math.max(1, Math.round(rate / (glide(rising ? 38 : 70, rising ? 75 : 40, t, seconds * .5) * (.78 + .44 * rand())))); }
      let value = 0;
      for (let m = 0; m < modes.length; m++) value += modes[m].run(x).band * levels[m];
      return far.run(value).low * Math.sin(Math.PI * Math.min(1, t / seconds)) ** 1.5;
    });
    finish(data, rate, [[creak, 1]], { highpass: this.highpass });
  },
});

const HEARTBEAT = [
  {
    id: 'lubdub', label: 'Lub-dub', seconds: .5, gain: .1, seed: 6101, highpass: 30, bpm: [70, 125],
    about: 'Deux battements « lub-dub » à 0,17 s d’écart : sinus 62 → 44 Hz puis 72 → 52 Hz avec leur harmonique 2 (pour les petits haut-parleurs) et un petit choc de bruit sous 260 Hz. De 70 battements/min à 35 PV jusqu’à 125 à 5 PV et à terre, plus fort quand la vie baisse.',
    render(data, rate, rand) {
      const n = data.length, lub = sweep(rate, 62, 44, .04, [1, .35]), dub = sweep(rate, 72, 52, .035, [1, .3]), thud = new Filter(rate).tune(260, .7);
      const beat = layer(n, rate, t => lub(t) * env(t, .004, .06) + .7 * dub(t - .17) * env(t - .17, .003, .045));
      const knock = layer(n, rate, t => thud.run(rand() * 2 - 1).low * (env(t, .002, .015) + .6 * env(t - .17, .002, .012)));
      finish(data, rate, [[beat, 1], [knock, .2]], { highpass: this.highpass });
    },
  },
  {
    id: 'sourd', label: 'Sourd, entendu de l’intérieur', seconds: .55, gain: .11, seed: 6201, highpass: 28, bpm: [64, 118],
    about: 'Battements plus graves et plus longs (sinus 50 → 36 Hz puis 58 → 42 Hz à 0,14 s, harmonique 2), une poussée de bruit sous 180 Hz, le tout sous un passe-bas à 220 Hz, comme entendu de l’intérieur. De 64 à 118 battements/min.',
    render(data, rate, rand) {
      const n = data.length, lub = sweep(rate, 50, 36, .06, [1, .3]), dub = sweep(rate, 58, 42, .05, [1, .25]), lp = new Filter(rate).tune(180, .7);
      const beat = layer(n, rate, t => lub(t) * env(t, .008, .095) + .55 * dub(t - .14) * env(t - .14, .006, .07));
      const whoosh = layer(n, rate, t => lp.run(rand() * 2 - 1).low * (env(t, .02, .09) + .5 * env(t - .14, .02, .07)));
      finish(data, rate, [[beat, 1], [whoosh, .35]], { highpass: this.highpass, lowpass: 220 });
    },
  },
];

export const CANDIDATES = Object.freeze({ chain: CHAIN, hit: HIT, headshot: HEADSHOT, kill: KILL, groan: GROAN, ambience: AMBIENCE, heartbeat: HEARTBEAT });
const BY_ID = new Map(SLOTS.map(slot => [slot, new Map(CANDIDATES[slot].map(candidate => [candidate.id, candidate]))]));
export const candidate = (slot, id) => BY_ID.get(slot)?.get(id) ?? null;

// Renders one candidate (or the shared creak) without an audio context: for
// tests and measurements. The game renders the same samples into its buffers.
export function render(slot, id, { rate = 48000, variant = 0 } = {}) {
  const made = slot === 'creak' ? CREAK : candidate(slot, id);
  const source = made?.take ? candidate(slot, made.fallback) : made;
  if (!source?.render) return null;
  const data = new Float32Array(Math.max(1, Math.round((source.secondsFor?.(variant) ?? source.seconds) * rate)));
  source.render(data, rate, seeded(source.seed + variant * 7919), variant);
  return data;
}

// From the local player (frame) or a hurt event: 0 above 35 HP, up to 1 at 5 HP or down.
export function heartbeatLevel(player) {
  if (!player || player.alive === false) return 0;
  if (player.downed === true) return 1;
  const hp = Number(player.hp), max = Number.isFinite(player.maxHp) && player.maxHp > 0 ? player.maxHp : 100;
  if (!Number.isFinite(hp)) return 0;
  const left = hp / max * 100;
  return left >= HEART_FROM ? 0 : Math.min(1, (HEART_FROM - left) / (HEART_FROM - HEART_FULL));
}

// The sound bank on one SoundEngine: plays any candidate (the audition page
// uses it directly) and builds the style that setStyle receives, with only
// the chosen sounds. It never creates an audio context: it plays only while
// the engine's own context runs and its volume is up.
export function createSounds(engine, choices = CHOSEN) {
  let cache = new Map(), cacheContext = null, bed = null, warmed = 0, chainVoice = null;
  const samples = new Map(), last = new Map(), voices = new Set(), chainVoices = new Set(), heart = { id: null, next: -Infinity, voices: new Set() }, ahead = [];
  // The kill player's own voices (never in the one-shots' cap), the ring of
  // kills held for a rocket (allocated once), the last crack, the heat.
  const killVoices = new Set(), held = Array.from({ length: HELD_KILLS }, () => ({ at: Infinity, id: null, kind: 'shot', heavy: false }));
  let crack = null, heat = 0, heatAt = -Infinity, lastVariant = -1, frameTime = -Infinity, framePhase;
  const live = () => !!engine?.ready?.() && engine.volume > 0 && !!engine.output;
  const any = list => list[Math.floor(engine.random() * list.length) % list.length];

  // Raw samples need no audio context: warm() renders the heavy bed ahead.
  function samplesOf(slot, made, variant, rate) {
    const key = `${slot}:${made.id}:${variant}:${rate}`;
    let data = samples.get(key);
    if (!data) {
      data = new Float32Array(Math.max(1, Math.round((made.secondsFor?.(variant) ?? made.seconds) * rate)));
      made.render(data, rate, seeded(made.seed + variant * 7919), variant);
      samples.set(key, data);
    }
    return data;
  }
  function fresh() { if (cacheContext !== engine.ctx) { cache = new Map(); cacheContext = engine.ctx; warmed = 0; } }
  function buffer(slot, made, variant = 0, rate = made.variantGain ? MEASURED_RATE : engine.ctx.sampleRate) {
    fresh();
    const key = `${slot}:${made.id}:${variant}`;
    let result = cache.get(key);
    if (!result) {
      const data = samplesOf(slot, made, variant, rate);
      result = engine.ctx.createBuffer(1, data.length, rate);
      result.getChannelData(0).set(data);
      samples.delete(`${key}:${rate}`); cache.set(key, result);
    }
    return result;
  }
  // Source and gain (plus a filter or a panner when asked) into the engine's
  // output, tracked by the engine so its stop, mute and pause release them.
  function voice(made, gain, { rate = 1, when = engine.ctx.currentTime, set = voices, filter = null, pan = null, bus = engine.output } = {}) {
    const ctx = engine.ctx, source = ctx.createBufferSource(), level = ctx.createGain(), stereo = pan === null ? null : ctx.createStereoPanner?.() ?? null;
    const nodes = filter ? [filter, level] : [level];
    source.buffer = made; source.loop = false; source.playbackRate.value = rate; level.gain.value = gain;
    if (filter) { source.connect(filter); filter.connect(level); } else source.connect(level);
    if (stereo) { stereo.pan.value = pan; level.connect(stereo); stereo.connect(bus); nodes.push(stereo); } else level.connect(bus);
    engine.track(source, nodes);
    const entry = { source, level, when }, ended = source.onended;
    source.onended = () => { set.delete(entry); ended?.(); };
    set.add(entry);
    source.start(when); source.stop(when + made.duration / rate + .02);
    return entry;
  }
  // The current groan take, slower and darker: read in memory, never changed.
  function take(made, scale) {
    const entries = engine.catalog?.effects?.[made.take];
    if (!entries?.length) return false;
    const entry = any(entries), record = engine.loadBuffer?.(entry.src);
    if (!record?.buffer) return false;
    const filter = engine.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = made.lowpass; filter.Q.value = .7;
    voice(record.buffer, entry.gain * made.boost * scale, { rate: any(made.rates), filter });
    return true;
  }
  // Ends a voice at `from`: its gain held until then, at 0 by from + seconds,
  // stopped 5 ms later. Scheduled on the audio clock (engine.fade always
  // starts its ramp now), so a choke can wait for the sound that replaces it.
  function chokeAt(entry, from, seconds) {
    try {
      const param = entry.level.gain;
      param.cancelScheduledValues(from); param.setValueAtTime(param.value, from); param.linearRampToValueAtTime(0, from + seconds);
      entry.source.stop(from + seconds + .005);
    } catch {}
  }
  // The kill player (KILL-SOUND.md 3.3), for any kill candidate: `kind` is
  // 'shot', 'stream', 'melee' or 'blast'; `heavy` a brute or a boss; `delay`
  // the seconds to the visible hit (a rocket's flight) on the visual clock. A
  // delayed kill waits in the ring until land() reaches it; the others play the
  // zombie's voice now and the sound KILL_LAG later, merged into a crack that
  // starts within the gap, trimmed by heat and kind. The head shot plays the
  // same sound (its fele ping marks the head). Returns true when handled.
  // Kills of one rocket share a slot, which lands with the nearest victim: the
  // client plays each victim's marker and chain at its own landing (up to 23.5
  // ms apart in the splash), in the server's order, not by distance.
  function kill(id, headshot = false, kind = 'shot', heavy = false, delay = 0) {
    const made = candidate('kill', id);
    if (!made || !live()) return false;
    if (delay > 0 && Number.isFinite(frameTime)) {
      const at = frameTime + Math.min(.6, delay);
      for (const slot of held) if (Math.abs(at - slot.at) < KILL_GAP) { slot.heavy ||= heavy === true; slot.at = Math.min(slot.at, at); return true; }
      for (const slot of held) if (slot.at === Infinity) { slot.at = at; slot.id = id; slot.kind = kind; slot.heavy = heavy === true; return true; }
      // No free slot: it plays at once.
    }
    const now = engine.ctx.currentTime, when = now + KILL_LAG, gap = kind === 'stream' ? KILL_GAP_STREAM : KILL_GAP;
    // Merged into the crack that starts within the gap (one the engine has
    // stopped, a pause or a mute, is no longer there to merge into).
    if (crack && killVoices.has(crack) && when - crack.when < gap) return true;
    heat = heat * Math.exp(-(now - heatAt) / HEAT_TIME) + 1; heatAt = now;
    const trim = Math.max(HEAT_FLOOR, -HEAT_STEP * Math.max(0, heat - HEAT_FREE)) + (Object.hasOwn(KILL_TRIM, kind) ? KILL_TRIM[kind] : 0);
    if (made.voice) engine.groan(made.voice);
    if (crack && killVoices.has(crack)) chokeAt(crack, when - .006, .008);
    const n = made.variants, variant = n > 1 ? (lastVariant + 1 + Math.floor(engine.random() * (n - 1)) % (n - 1)) % n : 0;
    lastVariant = variant;
    const rate = made.pitched ? 1 : heavy === true ? HEAVY_RATE : .97 + engine.random() * .06;
    // The crack goes around the master compressor, straight to the master
    // volume, as shooters route their kill confirm: 40 ms after a shot the
    // compressor is still pulling everything down, and the owner heard nothing
    // (14 October, evening: « j'entends rien du tout […] il faudrait le monter »).
    // KILL_BOOST raises it on top, by his request.
    crack = voice(buffer('kill', made, variant), made.gain * KILL_BOOST * (made.variantGain?.[variant] ?? 1) * 10 ** (trim / 20), { rate, when, set: killVoices, bus: engine.master ?? engine.output });
    return true;
  }
  // Every frame (the visual clock, stopped in a team pause): plays the held
  // kills whose landing has come, or drops one found too late. No allocation.
  // `phase` is the client's (the frame's snapshot): when it turns, the held
  // kills follow the client's own rocket cues (client.js, phaseChanged): at the
  // extraction they land at once, with the night's last kill's marker and
  // chain; at a countdown, a victory or a game over they are dropped, as its
  // blast sound is. Without a phase nothing turns.
  function land(time, phase) {
    if (!Number.isFinite(time)) return;
    frameTime = time;
    let flush = false, drop = false;
    if (phase !== undefined && phase !== framePhase) {
      flush = phase === 'extraction';
      drop = phase === 'countdown' || phase === 'victory' || phase === 'gameover';
      framePhase = phase;
    }
    for (const slot of held) {
      if (slot.at === Infinity || !(flush || drop || slot.at <= time)) continue;
      const late = time - slot.at;
      slot.at = Infinity;
      if (!drop && (flush || late <= HELD_STALE)) kill(slot.id, false, slot.kind, slot.heavy, 0);
    }
  }
  function play(slot, id, volume) {
    if (slot === 'kill') return kill(id);
    const made = candidate(slot, id);
    if (!made || !ONE_SHOTS.has(slot) || !live()) return false;
    const now = engine.ctx.currentTime;
    if (now - (last.get(slot) ?? -Infinity) < made.cooldown || voices.size >= VOICE_CAP) return true;
    last.set(slot, now);
    if (made.tink) engine.famille('headshot');
    if (made.voice) engine.groan(made.voice);
    const scale = slot === 'groan' ? Math.max(0, Number.isFinite(volume) ? volume : .055) / .055 : 1;
    if (!scale || made.take && take(made, scale)) return true;
    const synth = made.take ? candidate(slot, made.fallback) : made;
    voice(buffer(slot, synth, Math.floor(engine.random() * synth.variants) % synth.variants), synth.gain * scale, { rate: .97 + engine.random() * .06 });
    return true;
  }
  // The kill-chain jingle: the rung's own buffer at rate 1, one at a time (a
  // new chain fades the one still ringing over 30 ms, so a horde never piles
  // jingles into a wash), on voices of its own: never refused by the one-shots'
  // cap, a chain always answers.
  // A series starts on its kill's crack, never before it (KILL-SOUND.md 1.3):
  // on a crack started within the gap or still pending, otherwise KILL_LAG from
  // now when a kill sound is chosen (a rocket's crack lands later in the same
  // frame), or now with none (lot 1). A jingle that starts later chokes the one
  // before at its own start; one that has not started by then never sounds
  // (two counts on one crack would otherwise start together, the first rung
  // held at full gain over the second's attack).
  function chain(id, count) {
    const made = candidate('chain', id), rung = chainRung(count);
    if (!made || !(rung >= 2) || !live()) return false;
    const now = engine.ctx.currentTime, at = crack && crack.when > now - KILL_GAP ? Math.max(now, crack.when) : killId ? now + KILL_LAG : now;
    if (chainVoice && chainVoices.has(chainVoice)) {
      if (at > now && chainVoice.when >= at - 1e-6) try { chainVoice.source.stop(at); } catch {}
      else if (at > now) chokeAt(chainVoice, at, .03);
      else try { engine.fade(chainVoice.level.gain, 0, .03); chainVoice.source.stop(now + .035); } catch {}
    }
    chainVoice = voice(buffer('chain', made, rung - 2), made.gain * made.rungGain[rung - 2], { rate: 1, when: at, set: chainVoices });
    return true;
  }
  function creak(id) {
    const made = candidate('ambience', id);
    if (!made || !live()) return false;
    voice(buffer('creak', CREAK, Math.floor(engine.random() * CREAK.variants) % CREAK.variants), made.creakGain, { rate: .9 + engine.random() * .2, pan: (engine.random() * 2 - 1) * .7 });
    return true;
  }
  function cancel(current) { if (current.timer !== null) { engine.cancel(current.timer); current.timer = null; } }
  function creakLater(current) {
    const [min, max] = current.made.creaks ?? [];
    if (!(max > 0)) return;
    current.timer = engine.schedule(() => {
      current.timer = null;
      if (bed !== current) return;
      // A context suspended under the bed (device change, Safari) skips this creak, not the next ones.
      if (live()) creak(current.id);
      creakLater(current);
    }, (min + (max - min) * engine.random()) * 1000);
  }
  function stopBed() {
    const current = bed;
    if (!current) return;
    bed = null; cancel(current);
    try { engine.fade(current.level.gain, 0, .6); current.source.stop(engine.ctx.currentTime + .65); } catch {}
  }
  // The bed loops until it is turned off; the engine also stops it with every
  // other source (pause, mute, leaving), which ends it here too.
  function ambience(id, on) {
    const made = on ? candidate('ambience', id) : null;
    if (!made || !live()) { stopBed(); return false; }
    if (bed?.id === id) return true;
    stopBed();
    const ctx = engine.ctx, now = ctx.currentTime, source = ctx.createBufferSource(), level = ctx.createGain();
    source.buffer = buffer('ambience', made, 0, Math.min(BED_RATE, ctx.sampleRate)); source.loop = true;
    level.gain.setValueAtTime(0, now); level.gain.linearRampToValueAtTime(made.gain, now + 3);
    source.connect(level); level.connect(engine.output); engine.track(source, [level]);
    const current = bed = { id, made, source, level, timer: null }, ended = source.onended;
    source.onended = () => { if (bed === current) bed = null; cancel(current); ended?.(); };
    source.start(now);
    creakLater(current);
    return true;
  }
  function stopHeart() {
    heart.id = null; heart.next = -Infinity;
    if (!heart.voices.size) return;
    const now = engine.ctx.currentTime;
    for (const entry of [...heart.voices]) try {
      if (entry.when > now) entry.source.stop(now);
      else { engine.fade(entry.level.gain, 0, .04); entry.source.stop(now + .05); }
    } catch {}
  }
  // Called every frame while it beats: schedules the beats due in the next
  // 200 ms. A stalled frame restarts the rhythm instead of catching up.
  function heartbeat(id, level) {
    const made = level > 0 ? candidate('heartbeat', id) : null;
    if (!made || !live()) { stopHeart(); return false; }
    if (heart.id !== id) { stopHeart(); heart.id = id; }
    const now = engine.ctx.currentTime, amount = Math.min(1, level), interval = 60 / (made.bpm[0] + (made.bpm[1] - made.bpm[0]) * amount);
    if (heart.next < now) heart.next = now + .03;
    while (heart.next < now + LOOKAHEAD) {
      voice(buffer('heartbeat', made), made.gain * (.35 + .65 * amount), { when: heart.next, set: heart.voices });
      heart.next += interval;
    }
    return true;
  }
  function stop() {
    stopBed(); stopHeart();
    if (engine?.ctx) {
      const now = engine.ctx.currentTime;
      for (const entry of [...voices, ...chainVoices, ...killVoices]) try {
        // One scheduled ahead (a crack, a jingle on it) never starts.
        if (entry.when > now) entry.source.stop(now);
        else { engine.fade(entry.level.gain, 0, .03); entry.source.stop(now + .04); }
      } catch {}
    }
    for (const slot of held) slot.at = Infinity;
    last.clear(); samples.clear(); cache = new Map(); cacheContext = null; chainVoice = null;
    crack = null; heat = 0; heatAt = -Infinity; lastVariant = -1; frameTime = -Infinity; framePhase = undefined;
  }
  // About 50 ms for a 16 s bed: done when the pack installs, not at the first wave.
  function warm() {
    const id = chosen('ambience');
    if (id) samplesOf('ambience', candidate('ambience', id), 0, BED_RATE);
  }
  // The other chosen buffers need the context's rate. With the default CHOSEN that
  // is 22 buffers (heartbeat, the jingle's nine rungs, fele's three variants,
  // eclat's three, prise's three fallback groans, the three creaks); a new kill
  // crack would bring six (25). In Node at 48 kHz (14 October): 1 to 8 ms each
  // warm, 14 ms for the very first and up to 11 ms for a fallback groan, cold.
  // One per frame (install's frame hook), and none renders when it first plays mid-fight.
  function prepare() {
    if (!live()) return false;
    fresh();
    if (warmed >= ahead.length) return false;
    buffer(...ahead[warmed++]);
    return true;
  }

  const chosen = slot => { const id = choices?.[slot]; return id != null && candidate(slot, id) ? id : null; };
  const style = {}, chainId = chosen('chain'), killId = chosen('kill');
  if (chainId) style.chain = count => { chain(chainId, count); };
  for (const slot of ['hit', 'headshot']) { const id = chosen(slot); if (id) style[slot] = () => { play(slot, id); }; }
  if (killId) style.kill = (headshot, kind, heavy, delay) => { kill(killId, headshot, kind, heavy, delay); };
  const groan = chosen('groan'), bedId = chosen('ambience'), beat = chosen('heartbeat');
  if (groan) style.groan = volume => { play('groan', groan, volume); };
  if (bedId) style.ambience = on => { ambience(bedId, on); };
  if (beat) style.heartbeat = level => { heartbeat(beat, level); };
  // Heartbeat first (the first low-HP frame), then the jingle's rungs 2 to 10,
  // every variant the one-shots pick from (prise's fallback too), the creaks.
  if (beat) ahead.push(['heartbeat', candidate('heartbeat', beat), 0]);
  if (chainId) for (let variant = 0; variant < 9; variant++) ahead.push(['chain', candidate('chain', chainId), variant]);
  for (const slot of ['hit', 'headshot', 'kill', 'groan']) {
    const id = chosen(slot), made = id && candidate(slot, id), synth = made?.take ? candidate(slot, made.fallback) : made;
    for (let variant = 0; synth && variant < synth.variants; variant++) ahead.push([slot, synth, variant]);
  }
  if (bedId) for (let variant = 0; variant < CREAK.variants; variant++) ahead.push(['creak', CREAK, variant]);
  return {
    style: Object.freeze(style),
    play, kill, land, chain, creak, ambience, heartbeat, stop, warm, prepare,
    state: () => ({ ambience: bed?.id ?? null, heartbeat: heart.id, voices: voices.size + heart.voices.size + chainVoices.size + killVoices.size }),
  };
}

// index.js passes only ctx; tests may pass other choices than CHOSEN.
export async function install(ctx, choices = CHOSEN) {
  const engine = ctx?.sound;
  if (typeof engine?.setStyle !== 'function') return { uninstall() {} };
  const bank = createSounds(engine, choices), hooks = ctx.hooks ?? {};
  // The frame event is the client's, refilled every frame: read at once.
  const frame = event => { bank.prepare(); bank.land(event?.time, event?.snapshot?.phase); engine.heartbeat(heartbeatLevel(event?.self)); };
  // A blow is heard at once; the next frame keeps the level up to date.
  const hurt = event => { const level = heartbeatLevel(event); if (level > 0) engine.heartbeat(level); };
  hooks.frame = frame; hooks.hurt = hurt;
  bank.warm();
  engine.setStyle(bank.style);
  return {
    uninstall() {
      if (hooks.frame === frame) hooks.frame = null;
      if (hooks.hurt === hurt) hooks.hurt = null;
      if (engine.style === bank.style) engine.setStyle(null);
      bank.stop();
    },
  };
}
