// Measures for the Frisson feedback sounds (art/frisson/UI-SOUND.md sections
// 3.5 and 5.2), shared by tools/frisson-sound-render.mjs and
// test/frisson-feedback-sounds.test.mjs. Pure functions, arrays in and numbers
// out: no file, no audio device. An offline stand-in for the few WebAudio nodes
// audio.js and sounds.js make renders the real engine code, so the Famille
// references are audio.js's own tone() and noise() calls, not a transcription.
import vm from 'node:vm';
import { MINIGUN_TIMING, FIRE_INTERVALS, MAX_WAVES, MELEE_WEAPONS } from '../public/rules.js';
import { MUSIC_THEME_CATALOG, DEFAULT_MUSIC_THEME, isMusicTheme } from '../public/music-themes.js';

export const RATE = 48000;
// The brief's tonic (1.2) and the chain's score, written from the brief, never
// read from sounds.js: what the renders are measured against.
export const TONIC = 293.66;
export const pitch = semitones => TONIC * 2 ** (semitones / 12);
const MINOR = [0, 3, 7, 12, 15, 19], BOITE_AT = [0, .065, .136, .213, .296, .385];
// The melodic onsets of a chain rung: [{ at (s), target (Hz) }], in playing order.
export function chainScore(id, rung) {
  const m = Math.min(rung, 6), list = [];
  for (let i = 0; i < m; i++) {
    if (id === 'mineur') list.push({ at: i * .075, target: pitch(MINOR[i]) });
    else if (id === 'glauque') list.push({ at: i * .08, target: pitch((m === 2 ? [0, 6] : [0, 3, 6, 12, 15, 18])[i]) });
    else if (id === 'boite') list.push({ at: BOITE_AT[i], target: pitch(MINOR[i]) * 2 ** (-8 * i / 1200) });
    else if (id === 'glas') list.push({ at: i * .1, target: pitch(MINOR[m - 1 - i]) });
  }
  return list;
}
// The rung a count plays (audio.js chain(): min(count, 6) more notes at 8, 15, 30, 75).
export const RUNG_COUNTS = Object.freeze([2, 3, 4, 5, 6, 8, 15, 30, 75]);
// The double's step and the triple's steps, in semitones (5.1).
export const DOUBLE = Object.freeze({ mineur: 3, boite: 3, glauque: 6, glas: -3 });
export const TRIPLE = Object.freeze({ mineur: [3, 4], boite: [3, 4], glauque: [3, 3], glas: [-4, -3] });
// The brief's length caps per rung (3.2: 1.25 × Famille's), glas exempt.
export const LENGTH_CAPS = Object.freeze([.40, .475, .55, .625, .70, .86, 1.04, 1.21, 1.39]);

export const db = value => 20 * Math.log10(Math.max(value, 1e-12));
export const cents = (frequency, target) => 1200 * Math.log2(frequency / target);
export const semitones = (from, to) => 12 * Math.log2(to / from);

// In-place radix-2 FFT (length a power of two).
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle), half = size >> 1;
    for (let start = 0; start < n; start += size) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const powerOfTwo = n => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
// Hann-windowed magnitude spectrum of data[from, from + length), zero-padded.
export function spectrum(data, rate, from, length, size = powerOfTwo(length * 4)) {
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let k = 0; k < length && k < size; k++) {
    const i = from + k;
    if (i >= 0 && i < data.length) re[k] = data[i] * (.5 - .5 * Math.cos(2 * Math.PI * (k + .5) / length));
  }
  fft(re, im);
  const magnitude = new Float64Array(size / 2 + 1);
  for (let k = 0; k <= size / 2; k++) magnitude[k] = Math.hypot(re[k], im[k]);
  return { magnitude, binHz: rate / size };
}
// The strongest bin in [lo, hi] Hz, refined by a parabola through the log magnitudes.
export function peak(magnitude, binHz, lo, hi) {
  let best = -1;
  for (let k = Math.max(1, Math.ceil(lo / binHz)); k <= Math.min(magnitude.length - 2, Math.floor(hi / binHz)); k++) if (best < 0 || magnitude[k] > magnitude[best]) best = k;
  if (best < 0 || !(magnitude[best] > 0)) return { frequency: NaN, magnitude: 0 };
  const [a, b, c] = [magnitude[best - 1], magnitude[best], magnitude[best + 1]].map(value => Math.log(Math.max(value, 1e-30)));
  const shift = a - 2 * b + c < 0 ? .5 * (a - c) / (a - 2 * b + c) : 0;
  return { frequency: (best + shift) * binHz, magnitude: magnitude[best] };
}

// The pitch a note starts on: the strongest peak in 100-1200 Hz of the
// difference spectrum (this Hann window, from 8 ms after the onset, minus the
// one just before it, positive part), so what rang before is ignored. The
// window is 50 ms, not the brief's 30: at 30 ms a minor third's lobes overlap
// (67 Hz half-width), and two pure decaying sines D4 then F4, 65 ms apart,
// read 19 cents flat (F4 then D4, 29 cents sharp); at 50 ms they read within
// 4.2 cents, and the window still ends before the next note (65 ms at least).
export function onsetPitch(data, rate, at, { lo = 100, hi = 1200, window = .05, delay = .008, size = 16384 } = {}) {
  const length = Math.round(window * rate), from = Math.round((at + delay) * rate);
  const now = spectrum(data, rate, from, length, size), before = spectrum(data, rate, from - length, length, size);
  const rise = now.magnitude.map((value, k) => Math.max(0, value - before.magnitude[k]));
  return peak(rise, now.binHz, lo, hi).frequency;
}

// The level of narrow bands (±width cents around each pitch) in data[from, to)
// s, in dB under the strongest peak of that window (30 Hz to Nyquist). A
// band's level is its strongest spectral peak, a local maximum whose refined
// centre lies in the band: the slope of a neighbour a semitone away is not a
// peak (at 185 Hz a semitone is 10 Hz, inside the 20 Hz half-width of a 100 ms
// window), while a third of its own makes one. No peak there: Infinity dB under.
export function bandLevels(data, rate, from, to, pitches, { width = 40 } = {}) {
  const start = Math.round(from * rate), length = Math.round((to - from) * rate);
  const { magnitude, binHz } = spectrum(data, rate, start, length, powerOfTwo(Math.max(length * 4, 16384))), peaks = [];
  for (let k = Math.ceil(30 / binHz); k < magnitude.length - 1; k++) if (magnitude[k] > magnitude[k - 1] && magnitude[k] >= magnitude[k + 1]) peaks.push(peak(magnitude, binHz, (k - .5) * binHz, (k + .5) * binHz));
  const strongest = peaks.reduce((best, one) => one.magnitude > best.magnitude ? one : best, { frequency: NaN, magnitude: 0 });
  return {
    strongest: { frequency: strongest.frequency, db: db(strongest.magnitude) },
    bands: pitches.map(at => {
      const lo = at * 2 ** (-width / 1200), hi = at * 2 ** (width / 1200);
      const top = peaks.reduce((best, one) => one.frequency >= lo && one.frequency <= hi ? Math.max(best, one.magnitude) : best, 0);
      return { pitch: at, below: top ? db(strongest.magnitude) - db(top) : Infinity };
    }),
  };
}
// The F# and C# of every octave from 100 Hz to 3 kHz (a major third over D or over A).
export const THIRDS = Object.freeze([185.00, 369.99, 739.99, 1479.98, 2959.96, 138.59, 277.18, 554.37, 1108.73, 2217.46]);

// Each melodic onset of a chain rung, read against its target.
export function chainNotes(data, id, rung, rate = RATE) {
  return chainScore(id, rung).map(({ at, target }) => { const frequency = onsetPitch(data, rate, at); return { at, target, frequency, cents: cents(frequency, target) }; });
}
// No major third (5.1): the F# and C# bands and the major third over the last
// note, 100-200 ms after the last onset (100-400 ms for glas), each in dB
// under the strongest peak. glas strikes its large bell again 250 ms after the
// last stroke from rung 9 on, and a strike inside the window splits a partial's
// line (a sideband 17 dB down at 139.9 Hz, 8 Hz under the large bell's prime,
// in the C#3 band), so glas is probed from 100 ms after its last strike.
export function thirdProbe(data, id, rung, rate = RATE) {
  const last = chainScore(id, rung).at(-1), from = last.at + (id === 'glas' && rung >= 9 ? .25 : 0) + .1, to = from + (id === 'glas' ? .3 : .1);
  const { bands } = bandLevels(data, rate, from, to, [...THIRDS, last.target * 2 ** (4 / 12)]);
  const worst = bands.reduce((a, b) => b.below < a.below ? b : a);
  return { margin: worst.below, pitch: worst.pitch, bands };
}

// Magnitude-weighted spectral centroid over [lo, hi] Hz of the whole sound.
export function centroid(data, rate, lo = 50, hi = 8000) {
  const size = powerOfTwo(data.length), re = new Float64Array(size), im = new Float64Array(size);
  re.set(data);
  fft(re, im);
  let weighted = 0, total = 0;
  for (let k = Math.ceil(lo * size / rate); k <= Math.min(size / 2, Math.floor(hi * size / rate)); k++) { const m = Math.hypot(re[k], im[k]); weighted += m * k * rate / size; total += m; }
  return total ? weighted / total : 0;
}

// Biquads (direct form I) for the measures.
function biquad(data, [b0, b1, b2, a1, a2]) {
  const out = new Float64Array(data.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) { const x = data[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; out[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y; }
  return out;
}
// RBJ cookbook (WebAudio's own formulas), q linear.
function cookbook(type, frequency, q, rate) {
  const w = 2 * Math.PI * frequency / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  const [b0, b1, b2] = type === 'lowpass' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : type === 'highpass' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [alpha, 0, -alpha];
  const a0 = 1 + alpha;
  return [b0 / a0, b1 / a0, b2 / a0, -2 * cos / a0, (1 - alpha) / a0];
}
export const highpass = (data, rate, frequency) => biquad(data, cookbook('highpass', frequency, Math.SQRT1_2, rate));
// What a sound holds between lo and hi Hz (the 250-1000 Hz band of rule L5),
// cut exactly in the frequency domain: a filter's sloping edges would take
// 3.7 dB off D4 (294 Hz) at a fourth-order 250 Hz edge, energy that is in the band.
export function band(data, rate, lo, hi) {
  const size = powerOfTwo(data.length * 2), re = new Float64Array(size), im = new Float64Array(size);
  re.set(data);
  fft(re, im);
  for (let k = 0; k < size; k++) { const f = Math.min(k, size - k) * rate / size; if (f < lo || f > hi) { re[k] = 0; im[k] = 0; } }
  fft(re, im, true);
  return re.subarray(0, data.length);
}
// ITU-R BS.1770-4 K weighting: the 48 kHz pre-filter (a high shelf of about
// +4 dB above 1.5 kHz) and the RLB high-pass near 38 Hz. At another rate (a
// 44.1 kHz device), the same two filters from their analogue prototypes
// (libebur128's derivation, which gives the standard coefficients at 48 kHz).
export function kWeighted(data, rate = RATE) {
  if (rate === 48000) {
    const shelf = biquad(data, [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, .73248077421585]);
    return biquad(shelf, [1, -2, 1, -1.99004745483398, .99007225036621]);
  }
  return biquad(biquad(data, kShelf(rate)), kHighpass(rate));
}
export function kShelf(rate) {
  const K = Math.tan(Math.PI * 1681.974450955533 / rate), Q = .7071752369554196, Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** .4996667741545416, a0 = 1 + K / Q + K * K;
  return [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
}
export function kHighpass(rate) {
  const K = Math.tan(Math.PI * 38.13547087602444 / rate), Q = .5003270373238773, a0 = 1 + K / Q + K * K;
  return [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
}
// The largest mean square over windows of `window` s every `hop` s, the
// signal taken as silent outside itself (a short sound fits in one window).
function slidingMeanSquare(data, rate, window, hop) {
  const n = data.length, length = Math.max(1, Math.round(window * rate)), step = Math.max(1, Math.round(hop * rate)), sums = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sums[i + 1] = sums[i] + data[i] * data[i];
  let best = 0;
  for (let start = -length + step; start < n; start += step) best = Math.max(best, sums[Math.min(n, start + length)] - sums[Math.max(0, start)]);
  return best / length;
}
const loudness = meanSquare => -.691 + 10 * Math.log10(Math.max(meanSquare, 1e-30));
// M_K: maximum momentary loudness (K-weighted, 400 ms, every 10 ms), LUFS.
export const momentary = (data, rate = RATE) => loudness(slidingMeanSquare(kWeighted(data, rate), rate, .4, .01));
// The K-weighted mean over `seconds` (the rafale rule), the loudest such window.
export const shortTerm = (data, rate = RATE, seconds = 3) => loudness(slidingMeanSquare(kWeighted(data, rate), rate, seconds, .01));
// The largest 50 ms RMS, in dB (every sample), optionally after a 100 Hz
// high-pass (second-order Butterworth): sounds.md's M_HP.
export const rmsMax = (data, rate = RATE, window = .05) => 10 * Math.log10(Math.max(slidingMeanSquare(data, rate, window, 1 / rate), 1e-30));
export const levels = (data, rate = RATE) => ({ k: momentary(data, rate), hp: rmsMax(highpass(data, rate, 100), rate), flat: rmsMax(data, rate) });
export const scaled = (data, gain) => Float64Array.from(data, value => value * gain);
// Linear interpolation from one rate to another (the bed is rendered at 22,050 Hz and played at the context's rate).
export function resample(data, from, to) {
  const length = Math.round(data.length * to / from), result = new Float64Array(length);
  for (let i = 0; i < length; i++) { const x = i * from / to, k = Math.floor(x), f = x - k; result[i] = (data[k] ?? 0) * (1 - f) + (data[k + 1] ?? 0) * f; }
  return result;
}
// L5's two sides: the largest 50 ms RMS of what lies in 250-1000 Hz, dB.
export const bandLevel = (data, rate = RATE) => rmsMax(band(data, rate, 250, 1000), rate);

// The clean-ending rule (3.1): the release spans min(80 ms, a quarter of the
// buffer); the 50 ms RMS centred on its start must be 20 dB under the
// sound's largest 50 ms RMS.
export function ending(data, rate = RATE, release = .08) {
  const tail = Math.min(Math.round(release * rate), Math.floor(data.length / 4)), at = data.length - tail, half = Math.round(.025 * rate);
  let sum = 0;
  for (let i = Math.max(0, at - half); i < Math.min(data.length, at + half); i++) sum += data[i] * data[i];
  return { tail: tail / rate, below: rmsMax(data, rate) - 10 * Math.log10(Math.max(sum / (2 * half), 1e-30)), last: data[data.length - 1] };
}

// The analytic signal of a band (raised-cosine edges 40 Hz wide), for the
// instantaneous pitch of a falling ping.
function analytic(data, rate, lo, hi) {
  const size = powerOfTwo(data.length * 2), re = new Float64Array(size), im = new Float64Array(size), edge = 40;
  re.set(data);
  fft(re, im);
  for (let k = 0; k < size; k++) {
    const f = k * rate / size, keep = k > 0 && k < size / 2 ? Math.min(1, Math.max(0, (f - lo + edge) / edge), Math.max(0, (hi + edge - f) / edge)) : 0;
    const w = keep >= 1 ? 2 : 2 * (.5 - .5 * Math.cos(Math.PI * keep));
    re[k] *= w; im[k] *= w;
  }
  fft(re, im, true);
  return { re, im };
}
// The median instantaneous frequency of the band [lo, hi] over [from, to) s,
// skipping samples under 30 % of the strongest there (the nulls of a beat).
export function instantPitch(data, rate, from, to, lo, hi) {
  const { re, im } = analytic(data, rate, lo, hi), start = Math.round(from * rate), end = Math.min(data.length - 1, Math.round(to * rate));
  let top = 0;
  for (let i = start; i < end; i++) top = Math.max(top, Math.hypot(re[i], im[i]));
  const values = [];
  for (let i = start; i < end; i++) {
    if (Math.hypot(re[i], im[i]) < .3 * top) continue;
    values.push(Math.atan2(re[i] * im[i + 1] - im[i] * re[i + 1], re[i] * re[i + 1] + im[i] * im[i + 1]) * rate / (2 * Math.PI));
  }
  values.sort((a, b) => a - b);
  return values.length ? values[values.length >> 1] : NaN;
}
// The steady pitches under a common glide (to `ratio`, time constant `time`):
// the sound is read along the glide's own clock u(t) = ∫ ratio + (1 - ratio)
// e^(-s/time) ds, where a tone gliding that way is steady, then the `count`
// strongest peaks in [lo, hi] Hz of a Hann window over [0, seconds).
export function glidingPeaks(data, rate, { ratio, time, seconds, lo, hi, count = 2 }) {
  const clock = t => ratio * t + (1 - ratio) * time * (1 - Math.exp(-t / time));
  const span = clock(seconds), length = Math.round(span * rate), warped = new Float64Array(length);
  let t = 0;
  for (let k = 0; k < length; k++) {
    const u = k / rate;
    for (let step = 0; step < 4; step++) t -= (clock(t) - u) / (ratio + (1 - ratio) * Math.exp(-t / time));
    const x = t * rate, i = Math.floor(x), f = x - i;
    warped[k] = i + 1 < data.length ? data[i] * (1 - f) + data[i + 1] * f : 0;
  }
  const { magnitude, binHz } = spectrum(warped, rate, 0, length, 65536), peaks = [];
  for (let k = Math.ceil(lo / binHz); k <= Math.floor(hi / binHz); k++) if (magnitude[k] > magnitude[k - 1] && magnitude[k] >= magnitude[k + 1]) peaks.push(k);
  return peaks.sort((a, b) => magnitude[b] - magnitude[a]).slice(0, count).map(k => peak(magnitude, binHz, (k - 1) * binHz, (k + 1) * binHz).frequency).sort((a, b) => a - b);
}

// A 12-bin chroma (C = 0) of a decoded piece, frames of 8192 at its rate, 55 Hz to 2 kHz.
export function chroma(data, rate) {
  const size = 8192, bins = new Float64Array(12), re = new Float64Array(size), im = new Float64Array(size);
  for (let from = 0; from + size <= data.length; from += size) {
    re.fill(0); im.fill(0);
    for (let k = 0; k < size; k++) re[k] = data[from + k] * (.5 - .5 * Math.cos(2 * Math.PI * (k + .5) / size));
    fft(re, im);
    for (let k = Math.ceil(55 * size / rate); k <= Math.floor(2000 * size / rate); k++) {
      const note = Math.round(12 * Math.log2(k * rate / size / 440)) + 9;
      bins[((note % 12) + 12) % 12] += re[k] * re[k] + im[k] * im[k];
    }
  }
  const total = bins.reduce((a, b) => a + b, 0) || 1;
  return Array.from(bins, value => value / total);
}
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
// Krumhansl-Kessler key profiles: the best-correlated of the 24 keys is the tonal centre.
const PROFILES = { major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] };
export function tonalCentre(vector) {
  const correlate = (a, b) => { const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12; let n = 0, da = 0, dbb = 0; for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; } return n / Math.sqrt(da * dbb); };
  const keys = [];
  for (const [mode, profile] of Object.entries(PROFILES)) for (let tonic = 0; tonic < 12; tonic++) keys.push({ tonic: NAMES[tonic], mode, r: correlate(vector, profile.map((_, i) => profile[((i - tonic) % 12 + 12) % 12])) });
  keys.sort((a, b) => b.r - a.r);
  return { key: `${keys[0].tonic} ${keys[0].mode}`, r: keys[0].r, second: `${keys[1].tonic} ${keys[1].mode}`, r2: keys[1].r, strongest: NAMES.map((name, i) => [name, vector[i]]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, value]) => `${name} ${(value * 100).toFixed(1)}%`) };
}

// ---- An offline stand-in for the WebAudio nodes the engine makes ----------

// An AudioParam: its own value until the first event, then set and ramp
// events evaluated as the Web Audio spec does.
class Param {
  constructor(ctx, value) { this.ctx = ctx; this.value = value; this.events = []; }
  add(event) { if (event.type !== 'set' && !this.events.length) this.events.push({ type: 'set', value: this.value, time: this.ctx.currentTime }); this.events.push(event); this.events.sort((a, b) => a.time - b.time); }
  setValueAtTime(value, time) { this.add({ type: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.add({ type: 'linear', value, time }); }
  exponentialRampToValueAtTime(value, time) { this.add({ type: 'exponential', value, time }); }
  setTargetAtTime(value, time, constant) { this.add({ type: 'target', value, time, constant }); }
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
  cancelAndHoldAtTime(time) {
    const value = this.at(time), index = this.events.findIndex(event => event.time > time), current = this.events[index];
    this.events = this.events.filter(event => event.time <= time);
    if (current && index > 0 && (current.type === 'linear' || current.type === 'exponential')) this.events.push({ type: current.type, value, time });
    else this.events.push({ type: 'set', value, time });
  }
  at(time) {
    let value = this.value, previous = null;
    for (const event of this.events) {
      if (event.time > time) {
        if (previous && (event.type === 'linear' || event.type === 'exponential')) {
          const share = (time - previous.time) / (event.time - previous.time);
          if (event.type === 'linear') return value + (event.value - value) * share;
          return value * value > 0 && value * event.value > 0 ? value * (event.value / value) ** share : value;
        }
        return value;
      }
      if (event.type === 'target') { const next = this.events.find(other => other.time > event.time); const until = Math.min(time, next?.time ?? time); value = event.value + (value - event.value) * Math.exp(-(until - event.time) / event.constant); }
      else value = event.value;
      previous = event;
    }
    return value;
  }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.connections = []; ctx.nodes.push(this); }
  connect(node) { this.connections.push(node); return node; }
  // The engine disconnects a voice once it has ended; its wiring is kept for the render.
  disconnect() { this.disconnectedAt ??= this.ctx.currentTime; }
}
class Source extends Node {
  start(time = this.ctx.currentTime, offset = 0) { this.startAt = time; this.offset = offset; }
  stop(time = this.ctx.currentTime) { this.stopAt = time; if (time <= this.ctx.currentTime) this.end(); }
  end() { if (!this.ended) { this.ended = true; this.onended?.(); } }
}
export class RecordingContext {
  constructor(sampleRate = RATE) { this.sampleRate = sampleRate; this.currentTime = 0; this.state = 'suspended'; this.nodes = []; this.destination = new Node(this, 'destination'); }
  async resume() { this.state = 'running'; }
  createGain() { const node = new Node(this, 'gain'); node.gain = new Param(this, 1); return node; }
  createBiquadFilter() { const node = new Node(this, 'filter'); node.type = 'lowpass'; node.frequency = new Param(this, 350); node.Q = new Param(this, 1); node.gain = new Param(this, 0); return node; }
  createDynamicsCompressor() { const node = new Node(this, 'compressor'); for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Param(this, 0); return node; }
  createStereoPanner() { const node = new Node(this, 'panner'); node.pan = new Param(this, 0); return node; }
  createOscillator() { const node = new Source(this, 'oscillator'); node.type = 'sine'; node.frequency = new Param(this, 440); node.detune = new Param(this, 0); return node; }
  createBufferSource() { const node = new Source(this, 'buffer'); node.buffer = null; node.loop = false; node.playbackRate = new Param(this, 1); return node; }
  createBuffer(channels, length, sampleRate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, getChannelData: channel => data[channel] }; }
  decodeAudioData() { return Promise.reject(new Error('offline')); }
  // Moves the clock; sources whose stop time has passed end, as in a browser.
  advance(seconds) { this.currentTime += seconds; for (const node of this.nodes) if (node.stopAt !== undefined && node.stopAt <= this.currentTime) node.end(); }
}
// WebAudio filter coefficients: lowpass and highpass Q in dB, bandpass Q linear.
function filterCoefficients(node, time, rate) {
  const frequency = node.frequency.at(time), q = node.Q.at(time);
  return cookbook(node.type, frequency, node.type === 'bandpass' ? q : 10 ** (q / 20), rate);
}
// One sample of a built-in oscillator: its band-limited Fourier series, odd
// harmonics through the Chebyshev recurrence (one Math.sin per sample).
function wave(type, phase, harmonics) {
  const s1 = Math.sin(2 * Math.PI * phase);
  if (type === 'sine' || harmonics < 2) return s1;
  let sum = 0;
  if (type === 'triangle' || type === 'square') {
    const c2 = 1 - 2 * s1 * s1;
    let before = -s1, current = s1;
    for (let n = 1; n <= harmonics; n += 2) {
      sum += type === 'triangle' ? 8 / (Math.PI * Math.PI * n * n) * ((n - 1) / 2 % 2 ? -1 : 1) * current : 4 / (Math.PI * n) * current;
      const next = 2 * c2 * current - before; before = current; current = next;
    }
    return sum;
  }
  const c1 = Math.cos(2 * Math.PI * phase);
  let before = 0, current = s1;
  for (let n = 1; n <= harmonics; n++) { sum += 2 / (Math.PI * n) * (n % 2 ? 1 : -1) * current; const next = 2 * c1 * current - before; before = current; current = next; }
  return sum;
}
// Renders every source whose path reaches `sink` over [from, from + seconds):
// sources, filters and gains sample by sample, summed (panners pass through).
export function renderGraph(ctx, sink, { from = 0, seconds }) {
  const rate = ctx.sampleRate, n = Math.round(seconds * rate), out = new Float64Array(n), paths = [];
  const walk = (node, path) => { if (node === sink) { paths.push(path); return; } for (const next of node.connections) walk(next, [...path, next]); };
  for (const node of ctx.nodes) if (node instanceof Source && node.startAt !== undefined) walk(node, [node]);
  for (const [source, ...steps] of paths) {
    // The first sample at or after the start, as a browser plays it: a start
    // time just over a sample (1.9000000000000001 s, 91,200 x 1/48,000 once
    // rounded) must not play that sample, whose gains read their default 1
    // before their first event (a false spike in the Rafale, 14 October).
    let begin = Math.max(0, Math.ceil((source.startAt - from) * rate));
    if (from + begin / rate < source.startAt) begin++;
    const stop = source.stopAt ?? Infinity, temp = new Float64Array(n);
    let phase = 0, position = source.offset * (source.buffer?.sampleRate ?? rate), last = begin;
    for (let i = begin; i < n; i++) {
      const time = from + i / rate;
      if (time >= stop) break;
      if (source.kind === 'oscillator') {
        const frequency = source.frequency.at(time);
        temp[i] = wave(source.type, phase, Math.floor(rate / 2 / Math.max(1, frequency)));
        phase += frequency / rate; phase -= Math.floor(phase);
      } else {
        const buffer = source.buffer, data = buffer.getChannelData(0), index = Math.floor(position), share = position - index;
        if (index + 1 >= data.length && !source.loop) break;
        const a = data[index % data.length], b = data[(index + 1) % data.length];
        temp[i] = a + (b - a) * share;
        position += buffer.sampleRate / rate * source.playbackRate.at(time);
        if (source.loop) position %= data.length;
      }
      last = i + 1;
    }
    for (const step of steps) {
      if (step.kind === 'filter') {
        const [b0, b1, b2, a1, a2] = filterCoefficients(step, from + begin / rate, rate);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = begin; i < n; i++) { const x = temp[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; temp[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y; }
      } else if (step.kind === 'gain') for (let i = begin; i < n; i++) temp[i] *= step.gain.at(from + i / rate);
    }
    for (let i = begin; i < n; i++) out[i] += temp[i];
    void last;
  }
  return out;
}

// audio.js's SoundEngine in a fresh realm whose Math.random is seeded (its
// noise buffer and offsets), loaded from its source text as test/audio.test.mjs does.
export function engineClass(source, seed = 20261013) {
  const code = source.replace(/^import .*;\r?\n/gm, '').replace(/^export class /m, 'class ');
  const context = vm.createContext({ MINIGUN_TIMING, FIRE_INTERVALS, MAX_WAVES, MELEE_WEAPONS, MUSIC_THEME_CATALOG, DEFAULT_MUSIC_THEME, isMusicTheme, URL, setTimeout, clearTimeout });
  vm.runInContext(`{let s=${seed};Math.random=()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}\n${code}\nglobalThis.Engine=SoundEngine;`, context);
  return context.Engine;
}
// An unlocked engine on a recording context, its clock at 0.
export async function offlineEngine(Engine, rate = RATE) {
  const ctx = new RecordingContext(rate);
  const engine = new Engine({ contextFactory: () => ctx, random: () => .5, fetcher: async () => ({ ok: false }), schedule: () => 0, cancel: () => {} });
  await engine.unlock();
  return { engine, ctx };
}
// What `play(engine, ctx)` sends to the engine's output (before its
// compressor and master volume, where Famille and Frisson meet).
export async function offlineRender(Engine, play, seconds, rate = RATE) {
  const { engine, ctx } = await offlineEngine(Engine, rate);
  await play(engine, ctx);
  return renderGraph(ctx, engine.output, { seconds });
}
// Counts 2 to 6, .4 s apart, as in a horde (rule L4). Famille's jingles
// overlap freely; a style's chain chokes the one before.
export const RAFALE = Object.freeze([2, 3, 4, 5, 6]);
export const rafale = (engine, ctx) => { RAFALE.forEach((count, i) => { if (i) ctx.advance(.4); engine.chain(count); }); };

// ---- The kill confirm (art/frisson/KILL-SOUND.md sections 4 and 6) ---------

// A model of the engine's master compressor (audio.js: threshold -18 dB, knee
// 18, ratio 5, attack 3 ms, release 180 ms): a peak detector on each sample in
// dB, the soft knee's static curve, its gain smoothed in dB (attack while the
// gain falls, release while it comes back). No make-up gain and no pre-delay,
// unlike Web Audio's DynamicsCompressorNode: a pre-check, the browser decides.
// Returns the gain curve (linear, one value a sample).
export function compress(x, { threshold = -18, knee = 18, ratio = 5, attack = .003, release = .18, rate = RATE } = {}) {
  const fall = Math.exp(-1 / (attack * rate)), back = Math.exp(-1 / (release * rate)), gains = new Float64Array(x.length);
  let g = 0;
  for (let i = 0; i < x.length; i++) {
    const level = 20 * Math.log10(Math.abs(x[i]) + 1e-12), over = level - threshold;
    const out = 2 * over < -knee ? level : 2 * Math.abs(over) <= knee ? level + (1 / ratio - 1) * (over + knee / 2) ** 2 / (2 * knee) : threshold + over / ratio;
    const target = out - level;
    g = target < g ? fall * g + (1 - fall) * target : back * g + (1 - back) * target;
    gains[i] = 10 ** (g / 20);
  }
  return gains;
}
export const times = (x, gains) => Float64Array.from(x, (value, i) => value * (gains[i] ?? 1));
// A forward FFT with its bit-reversal and twiddle tables cached per size: the
// kill measures take thousands of short windows (fft() above stays lot 1's).
const tables = new Map();
function quickFft(re, im) {
  const n = re.length;
  let table = tables.get(n);
  if (!table) {
    const reverse = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); reverse[i] = r; }
    for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos(-2 * Math.PI * k / n); sin[k] = Math.sin(-2 * Math.PI * k / n); }
    tables.set(n, table = { reverse, cos, sin });
  }
  const { reverse, cos, sin } = table;
  for (let i = 0; i < n; i++) { const j = reverse[i]; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) for (let k = 0; k < half; k++) {
      const a = start + k, b = a + half, wr = cos[k * step], wi = sin[k * step], tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
// band() with the cached FFT: what x holds in [lo, hi] Hz, cut exactly.
export function bandPass(x, lo, hi, rate = RATE) {
  const size = powerOfTwo(x.length * 2), re = new Float64Array(size), im = new Float64Array(size);
  re.set(x);
  quickFft(re, im);
  for (let k = 0; k < size; k++) { const f = Math.min(k, size - k) * rate / size; if (f < lo || f > hi) { re[k] = 0; im[k] = 0; } else im[k] = -im[k]; }
  quickFft(re, im);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = re[i] / size;
  return out;
}
// The first sample within 40 dB of the peak: where a sound starts.
export function onsetOf(x) {
  let top = 0;
  for (const value of x) top = Math.max(top, Math.abs(value));
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= top * .01) return i;
  return 0;
}
// The energy of x in each [lo, hi) Hz band over [start, start + length) s: a
// Tukey window with 1 ms tapers (a Hann window would hide a crack at the start
// of the window), zero-padded to `size` points (8192, or more for a longer
// window). One FFT for every band asked.
const scratch = new Map();
export function bandEnergies(x, bands, start, length, rate = RATE, size = 8192) {
  const from = Math.floor(start * rate + 1e-6), to = Math.min(x.length, Math.floor((start + length) * rate + 1e-6)), n = to - from;
  if (n < 8) return bands.map(() => 1e-30);
  size = Math.max(size, powerOfTwo(n));
  let buffers = scratch.get(size);
  if (!buffers) scratch.set(size, buffers = [new Float64Array(size), new Float64Array(size)]);
  const [re, im] = buffers, taper = Math.min(Math.round(.001 * rate), n >> 1);
  re.fill(0); im.fill(0);
  for (let k = 0; k < n; k++) {
    const edge = k < taper ? k : k >= n - taper ? n - 1 - k : -1;
    re[k] = (x[from + k] ?? 0) * (edge < 0 ? 1 : .5 - .5 * Math.cos(Math.PI * edge / taper));
  }
  quickFft(re, im);
  return bands.map(([lo, hi]) => {
    let sum = 0;
    for (let k = Math.ceil(lo * size / rate); k <= size / 2 && k * rate / size < hi; k++) sum += re[k] * re[k] + im[k] * im[k];
    return sum + 1e-30;
  });
}
export const bandEnergy = (x, lo, hi, start, length, rate = RATE) => bandEnergies(x, [[lo, hi]], start, length, rate)[0];
// K5's rise: the 2-3.5 kHz energy of the mix (gun + crack, through its own
// compressor gain) over [lag, lag + 30 ms], against the gun alone through its
// own, in dB. Famille's B2 reads 2-3 kHz.
export function rise(mixed, alone, lag, { lo = 2000, hi = 3500, length = .03, rate = RATE } = {}) {
  return 10 * Math.log10(bandEnergy(mixed, lo, hi, lag, length, rate) / bandEnergy(alone, lo, hi, lag, length, rate));
}
// K5's audible duration: 10 ms frames every 2.5 ms over [lag, lag + 120 ms)
// where the crack alone carries at least the gun's energy, both ducked by the
// mix's compressor gain, in the 2-4 kHz or the 4-8 kHz octave; count x 2.5 ms.
const OCTAVES = [[2000, 4000], [4000, 8000]];
export function audibleMs(crack, gun, gains, lag, rate = RATE, size = 8192) {
  const n = Math.min(Math.max(crack.length, gun.length), Math.ceil((lag + .14) * rate)), a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) { const g = gains[i] ?? 1; a[i] = (crack[i] ?? 0) * g; b[i] = (gun[i] ?? 0) * g; }
  let frames = 0;
  for (let k = 0; k < 48; k++) {
    const t = lag + k * .0025, [a2, a4] = bandEnergies(a, OCTAVES, t, .01, rate, size), [b2, b4] = bandEnergies(b, OCTAVES, t, .01, rate, size);
    if (a2 >= b2 || a4 >= b4) frames++;
  }
  return frames * 2.5;
}
// The loudest 5 ms RMS, dB (K6).
export const rms5 = (x, rate = RATE) => 10 * Math.log10(Math.max(slidingMeanSquare(x, rate, .005, .0005), 1e-30));
// The attack (6.1): a 0.5 ms RMS envelope after a 1 kHz high-pass (an exact
// cut), from 10 % of its maximum to the first local maximum above 50 % of it,
// in ms; and when that first peak comes, in ms after the onset.
export function attack(x, rate = RATE) {
  const y = bandPass(x, 1000, rate / 2, rate), n = Math.round(.0005 * rate), sums = new Float64Array(y.length + 1), e = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) sums[i + 1] = sums[i] + y[i] * y[i];
  let top = 0;
  for (let i = 0; i < y.length; i++) { const from = Math.max(0, i - (n >> 1)), to = Math.min(y.length, i + n - (n >> 1)); e[i] = Math.sqrt(Math.max(0, sums[to] - sums[from]) / n); top = Math.max(top, e[i]); }
  let i = 0;
  while (i < e.length && e[i] < .1 * top) i++;
  const start = i;
  while (i + 1 < e.length && !(e[i] >= .5 * top && e[i + 1] < e[i])) i++;
  return { ms: (i - start) / rate * 1000, peakMs: (i - onsetOf(x)) / rate * 1000 };
}
// The power-weighted centroid of the first 20 ms, from 1 ms before the onset (Tukey window, 50-8,000 Hz).
export function crackCentroid(x, rate = RATE) {
  const from = Math.max(0, onsetOf(x) - Math.round(.001 * rate)), n = Math.round(.021 * rate), size = 8192, re = new Float64Array(size), im = new Float64Array(size), taper = Math.round(.001 * rate);
  for (let k = 0; k < n; k++) { const edge = k < taper ? k : k >= n - taper ? n - 1 - k : -1; re[k] = (x[from + k] ?? 0) * (edge < 0 ? 1 : .5 - .5 * Math.cos(Math.PI * edge / taper)); }
  quickFft(re, im);
  let weighted = 0, total = 0;
  for (let k = Math.ceil(50 * size / rate); k * rate / size <= 8000; k++) { const power = re[k] * re[k] + im[k] * im[k]; weighted += power * k * rate / size; total += power; }
  return total ? weighted / total : 0;
}
// The body's share: E(80-200 Hz) - E(1-4 kHz) over the first 80 ms, dB.
export const bodyShare = (x, rate = RATE) => 10 * Math.log10(bandEnergy(x, 80, 200, 0, .08, rate) / bandEnergy(x, 1000, 4000, 0, .08, rate));
// The shape guard: over the first 30 ms from the onset, the loudest 1/3-octave
// band from 1.6 to 4 kHz, in dB over the mean energy of the 1-6.3 kHz bands.
export function thirdOctaveShape(x, rate = RATE) {
  const at = onsetOf(x) / rate, centres = Array.from({ length: 12 }, (_, k) => 1000 * 2 ** ((k - 3) / 3));
  const energies = centres.map(f => bandEnergy(x, f / 2 ** (1 / 6), f * 2 ** (1 / 6), at, .03, rate));
  const wide = energies.filter((_, k) => centres[k] >= 1000 && centres[k] <= 6400), ref = 10 * Math.log10(wide.reduce((a, b) => a + b, 0) / wide.length);
  return Math.max(...energies.filter((_, k) => centres[k] >= 1580 && centres[k] <= 4000).map(value => 10 * Math.log10(value) - ref));
}
// The share of the energy within `seconds` of the onset.
export function energyShare(x, seconds, rate = RATE) {
  const from = onsetOf(x), to = Math.min(x.length, from + Math.round(seconds * rate));
  let part = 0, total = 0;
  for (let i = 0; i < x.length; i++) { const e = x[i] * x[i]; total += e; if (i >= from && i < to) part += e; }
  return total ? part / total : 0;
}
// The sample peak, dBFS.
export const peakDb = x => { let top = 0; for (const value of x) top = Math.max(top, Math.abs(value)); return db(top); };
// Pearson correlation over the shorter length.
export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, dbb = b[i] - mb; ab += da * dbb; aa += da * da; bb += dbb * dbb; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}
// A RIFF/PCM16 reader (the owner's WAV takes: mono, 16-bit, 44.1 kHz), its
// channels averaged, as a Float64Array in [-1, 1).
export function readWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = at => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let format = null, at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at), size = view.getUint32(at + 4, true), body = at + 8;
    if (id === 'fmt ') format = { code: view.getUint16(body, true), channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    else if (id === 'data') {
      if (!format || format.code !== 1 || format.bits !== 16) throw new Error('only 16-bit PCM is read');
      const frames = Math.floor(Math.min(size, bytes.length - body) / (2 * format.channels)), data = new Float64Array(frames);
      for (let i = 0; i < frames; i++) { let sum = 0; for (let c = 0; c < format.channels; c++) sum += view.getInt16(body + (i * format.channels + c) * 2, true); data[i] = sum / format.channels / 32768; }
      return { rate: format.rate, data };
    }
    at = body + size + (size & 1);
  }
  throw new Error('no data chunk');
}
// The four single-shot takes K5 and K6 are measured over, played whole at
// their manifest gains (public/audio/manifest.json), as the game plays them.
export const KILL_GUNS = Object.freeze({ pistol: 'pistol-1.wav', shotgun: 'shotgun-heavy-2.wav', assault: 'assault-shot-4.wav', magnum: 'magnum-impact.wav' });
// A gun at 0 and a crack at `lag`: the mix and the gun alone, each through its
// own compressor gain, plus the placed crack and the mix's gain for K5's audible
// duration and K6 (the crack alone, ducked as in the mix).
// The gun alone through the compressor, once per gun array and length.
const alones = new WeakMap();
export function killMix(gun, crack, lag, rate = RATE) {
  const start = Math.round(lag * rate), n = Math.max(gun.length, start + crack.length, Math.round((lag + .3) * rate)), alone = new Float64Array(n), placed = new Float64Array(n), sum = new Float64Array(n);
  alone.set(gun.length > n ? gun.subarray(0, n) : gun);
  placed.set(crack.length > n - start ? crack.subarray(0, n - start) : crack, start);
  for (let i = 0; i < n; i++) sum[i] = alone[i] + placed[i];
  let cached = alones.get(gun)?.get(n);
  if (!cached) { cached = times(alone, compress(alone, { rate })); if (!alones.has(gun)) alones.set(gun, new Map()); alones.get(gun).set(n, cached); }
  const gains = compress(sum, { rate });
  return { alone, placed, gains, mixed: times(sum, gains), aloneOut: cached };
}
// K5 (rise and audible duration) and K6 (the crack alone, ducked as in the mix,
// against the gun's own loudest 5 ms) of one crack over one gun at one lag.
export function cutThrough(gun, crack, lag, rate = RATE) {
  const m = killMix(gun, crack, lag, rate);
  return { rise: rise(m.mixed, m.aloneOut, lag, { rate }), audible: audibleMs(m.placed, m.alone, m.gains, lag, rate), startle: rms5(times(m.placed, m.gains), rate) - rms5(m.aloneOut, rate) };
}
// The K rules' numbers (KILL-SOUND.md 4.1), the analysis rules' (6.1) and
// Famille's clac rules (5, B1-B3).
export const KILL_K = Object.freeze({
  range: Object.freeze([-34, -31.5]), tolerance: .5, tierGap: 6, maxK: -30.5, maxPeak: -9, maxFlat: -24,
  rise: Object.freeze({ pistol: 2.5, shotgun: 6, assault: 6, magnum: 6, mean: 8 }), audible: 25, startle: -3,
  jingle: Object.freeze([-1, .5]), rafaleOver: 5.5, sixth: Object.freeze([-3, -1]),
  attack: 2, firstPeak: 6, centroid: Object.freeze([1500, 3000]), pitchedCentroid: Object.freeze([600, 1500]), body: Object.freeze([-9, 0]),
  shape: 6, share60: .85, length: .26, clean: 20, centroidSpread: .4, correlation: .99, third: 24, renderMs: 15,
  famille: Object.freeze({ k: Object.freeze([-40, -38]), overTink: 4, rise: 1.5, peak: -14, maxHz: 3000, triangleHz: 200 }),
});
// The cut-through rules (K5-K7) a report-only candidate is known to fail (4.3),
// for the render tool's model and the browser's kill-mix page alike
// (art/frisson/tools/feedback-shot): a change either way shows up.
export const KILL_MIX_REPORT_ONLY = Object.freeze({
  claque: Object.freeze(['K5.audible.assault', 'K5.audible.magnum', 'K5.audible.shotgun', 'K5.mean', 'K5.pistol', 'K7', 'K7.rise']),
  os: Object.freeze(['K5.audible.assault', 'K5.audible.magnum', 'K5.audible.shotgun', 'K5.mean', 'K5.pistol', 'K7', 'K7.rise']),
});
// The level (K1, LUFS) at which Edge's own master compressor passes K5-K7,
// for a measured new candidate whose Node model passes lower: the kill-mix
// page of art/frisson/tools/feedback-shot (headless Edge, 14 October 2026)
// finds the lowest passing K1 at 48 and at 44.1 kHz, with the takes decoded
// by Edge as the game decodes them and the 48 kHz crack the game plays; this
// is the higher of the two plus KILL_EDGE_MARGIN, on a 0.05 LU step (craque
// -33.78 and -33.68, coquille -32.39 and -32.25). Edge decides (KILL-SOUND.md
// 6.3; 4.3's knob, K1 moved within its range): the render tool levels these
// candidates here, and fails one set lower (K1.edge); the page fails when
// Edge asks for another value.
export const KILL_EDGE_FLOOR = Object.freeze({ craque: -33.6, coquille: -32.2 });
export const KILL_EDGE_MARGIN = .05;
// The K5-K7 rules one compressor's numbers break, read as the render tool
// reads them: `guns` holds, for each of KILL_GUNS, the means over the variants
// ({ rise, audible } and the loudest `startle`); `k7` each jingle mix
// ('rung2-pistol'…) as { change, rise } (rise null without a gun).
export function killMixFailures({ guns, k7 = null }, K = KILL_K) {
  const failed = new Set(), names = Object.keys(guns);
  for (const name of names) if (!(guns[name].rise >= K.rise[name])) failed.add(`K5.${name}`);
  if (!(names.reduce((sum, name) => sum + guns[name].rise, 0) / names.length >= K.rise.mean)) failed.add('K5.mean');
  for (const name of ['shotgun', 'assault', 'magnum']) if (guns[name] && !(guns[name].audible >= K.audible)) failed.add(`K5.audible.${name}`);
  for (const name of names) if (!(guns[name].startle <= K.startle)) failed.add('K6');
  for (const [key, value] of Object.entries(k7 ?? {})) {
    if (!(value.change >= K.jingle[0] && value.change <= K.jingle[1])) failed.add('K7');
    if (value.rise !== null && !(value.rise >= K.rise[key.endsWith('pistol') ? 'pistol' : 'assault'])) failed.add('K7.rise');
  }
  return [...failed].sort();
}
// Every rule a kill candidate's renders break, at its output level (render x
// gain x variantGain): K1 (each variant within the tolerance of the
// candidate's mean, the mean inside the range), K3 (at least tierGap LU over
// the quieter tiers, `tiers` their M_K), K4, and the analysis rules of 6.1.
// The cut-through rules (K5-K7) need the owner's takes: the render tool's.
export function killRules(made, renders, tiers = []) {
  const failed = new Set(), K = KILL_K, out = renders.map((data, v) => scaled(data, made.gain * (made.variantGain?.[v] ?? 1)));
  const rows = out.map((x, v) => {
    const level = levels(x), hit = attack(x), row = { k: level.k, hp: level.hp, flat: level.flat, peak: peakDb(x), attack: hit.ms, firstPeak: hit.peakMs, centroid: crackCentroid(x), body: bodyShare(x), shape: thirdOctaveShape(x), share60: energyShare(x, .06), seconds: renders[v].length / RATE, end: renders[v][renders[v].length - 1], clean: ending(renders[v]).below };
    if (made.pitched) {
      const from = onsetOf(x) / RATE, { bands } = bandLevels(x, RATE, from + .03, from + .15, THIRDS);
      row.third = Math.min(...bands.map(one => one.below));
    }
    return row;
  });
  const k = rows.reduce((sum, row) => sum + row.k, 0) / rows.length, centroids = rows.map(row => row.centroid), band = made.pitched ? K.pitchedCentroid : K.centroid;
  const top = Math.max(...tiers), lowest = Math.min(...rows.map(row => row.k)), loudest = Math.max(...rows.map(row => row.k));
  // K1: one target in the range, every variant within the tolerance of it.
  if (loudest - lowest > 2 * K.tolerance + 1e-9) failed.add('K1');
  for (const row of rows) {
    if (row.k < K.range[0] - K.tolerance - 1e-9 || row.k > K.range[1] + K.tolerance + 1e-9) failed.add('K1');
    if (tiers.length && row.k < top + K.tierGap) failed.add('K3');
    if (row.k > K.maxK) failed.add('K4.k');
    if (row.peak > K.maxPeak) failed.add('K4.peak');
    if (row.flat > K.maxFlat) failed.add('K4.flat');
    if (!(row.attack <= K.attack)) failed.add('attack');
    if (!(row.firstPeak <= K.firstPeak)) failed.add('firstPeak');
    if (!(row.centroid >= band[0] && row.centroid <= band[1])) failed.add('centroid');
    if (!(row.body >= K.body[0] && row.body <= K.body[1])) failed.add('body');
    if (!(row.shape <= K.shape)) failed.add('shape');
    if (!(row.share60 >= K.share60)) failed.add('share60');
    if (!(row.seconds <= K.length + 1e-9)) failed.add('length');
    if (row.end !== 0) failed.add('end');
    if (!(row.clean >= K.clean)) failed.add('clean');
    if (made.pitched && !(row.third >= K.third)) failed.add('third');
  }
  const spread = (Math.max(...centroids) - Math.min(...centroids)) / (centroids.reduce((a, b) => a + b, 0) / centroids.length);
  if (spread > K.centroidSpread) failed.add('centroidSpread');
  let closest = 0;
  for (let i = 0; i < renders.length; i++) for (let j = i + 1; j < renders.length; j++) closest = Math.max(closest, Math.abs(correlation(renders[i], renders[j])));
  if (closest > K.correlation) failed.add('correlation');
  return { failed: [...failed].sort(), k, spread, closest, rows };
}
// Mulberry32, as sounds.js renders: a seeded engine.random for the player model.
export function mulberry(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// K8: `kills` kills `spacing` s apart through the real kill player (gap,
// choke, heat), the zombie's voice left out, on an offline engine whose random
// is seeded. `createSounds` is sounds.js's (passed in: this module reads
// nothing of the pack). Returns what reaches the engine's output and each
// crack's gain over its untrimmed level (gain x variantGain), in dB.
export async function killRafale(Engine, createSounds, made, renders, { kills = 6, spacing = .15, kind = 'shot', seed = 7 } = {}) {
  const { engine, ctx } = await offlineEngine(Engine);
  engine.random = mulberry(seed); engine.groan = () => {};
  const bank = createSounds(engine, { kill: made.id }), mark = ctx.nodes.length;
  for (let i = 0; i < kills; i++) { if (i) ctx.advance(spacing); bank.kill(made.id, false, kind, false, 0); }
  const sums = renders.map(data => { let s = 0; for (let i = 0; i < Math.min(4000, data.length); i++) s += Math.abs(data[i]); return s; });
  const trims = ctx.nodes.slice(mark).filter(node => node.kind === 'buffer').map(node => {
    const data = node.buffer.getChannelData(0); let s = 0;
    for (let i = 0; i < Math.min(4000, data.length); i++) s += Math.abs(data[i]);
    const v = sums.reduce((best, value, i) => Math.abs(value - s) < Math.abs(sums[best] - s) ? i : best, 0);
    return db(node.connections[0].gain.value / (made.gain * (made.variantGain?.[v] ?? 1)));
  });
  return { data: renderGraph(ctx, engine.output, { seconds: spacing * kills + .5 }), trims };
}
// What a Famille clac asks of the engine: each tone() and noise() call, from
// audio.js's own recipe (B3 reads it).
export function clacCalls(Engine, id) {
  const engine = new Engine({ contextFactory: () => null }), calls = [];
  engine.ctx = { currentTime: 1 }; engine.ready = () => true; engine.volume = 1;
  engine.tone = (...args) => { calls.push(['tone', ...args]); }; engine.noise = (...args) => { calls.push(['noise', ...args]); };
  return engine.clac(id) ? calls : null;
}
