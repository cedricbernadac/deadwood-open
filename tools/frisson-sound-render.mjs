// Renders and measures the Frisson feedback sounds offline (art/frisson/UI-SOUND.md
// section 5.2): every candidate and variant as a 16-bit mono WAV, the chain
// rungs, the Rafale and each rung over the veille bed, and the Famille
// references from audio.js's own code. It checks every rule of sections
// 3.1-3.5 and 5.4 (intervals, no major third, levels L1-L5, brightness, clean
// ending, memory, Node render time), prints the table and each chain
// candidate's measured rungGain, and writes analysis.json. Exit code 1 when a
// rule fails. --themes reads each music theme through ffmpeg (read-only) and
// prints its tonal centre.
//
// The kill confirm (art/frisson/KILL-SOUND.md 6.2; --slot kill alone): every
// kill candidate's variants, the lag sweep, each candidate over the owner's
// gun takes through a model of the master compressor (K5-K7, the sniper, the
// streams and the blasts reported), the rafale through the real kill player
// (K8), the analysis rules, the measured gain and variantGain at the lowest
// level that still cuts through, and Famille's clacs (Part B: B1-B3 and the
// provisional default). Report-only rules (4.3) never fail it. The mixes are
// measured at 48 kHz and again at 44.1 kHz (a device at that rate: the takes
// at their own rate, the crack as the game plays it there).
//
//   node tools/frisson-sound-render.mjs --out <dir> [--slot chain|kill] [--rate 48000] [--themes]
//
// The WAVs are derived and reproducible, at the level the engine sends to its
// output (before the master compressor and volume): never commit them, never
// write them under public/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATES, CHOSEN, CREAK, KILL_LAG, SLOTS, chainRung, createSounds, render } from '../public/frisson/sounds.js';
import { MUSIC_THEME_CATALOG } from '../public/music-themes.js';
import {
  RATE, RAFALE, RUNG_COUNTS, LENGTH_CAPS, DOUBLE, TRIPLE, bandLevel, cents, centroid, chainNotes, chroma, ending, engineClass,
  glidingPeaks, instantPitch, levels, offlineRender, pitch, rafale, resample, rmsMax, scaled, semitones, shortTerm, thirdProbe, tonalCentre,
  KILL_EDGE_FLOOR, KILL_GUNS, KILL_K, KILL_MIX_REPORT_ONLY, bandPass, clacCalls, compress, cutThrough, killMix, killRafale, killRules, peakDb, readWav, rise, times,
} from './frisson-sound-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const outArg = option('--out'), slotArg = option('--slot'), wavRate = Number(option('--rate') ?? RATE), themes = args.includes('--themes');
if (!outArg) { console.error('usage: node tools/frisson-sound-render.mjs --out <dir> [--slot chain] [--rate 48000] [--themes]'); process.exit(2); }
const out = resolve(outArg), inside = relative(join(root, 'public'), out);
if (!inside.startsWith('..') && !isAbsolute(inside)) { console.error(`refused: ${out} is inside public/`); process.exit(2); }
if (!Number.isInteger(wavRate) || wavRate < 8000 || wavRate > 192000) { console.error('--rate: an integer sample rate'); process.exit(2); }
if (slotArg && !SLOTS.includes(slotArg)) { console.error(`--slot: one of ${SLOTS.join(', ')}`); process.exit(2); }

const failures = [], report = { rate: RATE, wavRate, famille: {}, chain: {}, headshot: {}, themes: null, failures };
const fail = text => failures.push(text);
const round = (value, digits = 2) => Number(value.toFixed(digits));

// 16-bit mono PCM.
function wav(path, data, rate = RATE) {
  const samples = rate === RATE ? data : resample(data, RATE, rate), bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples.length * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
const trim = data => { let end = data.length; while (end > 1 && Math.abs(data[end - 1]) < 1e-7) end--; return data.subarray(0, Math.min(data.length, end + Math.round(.02 * RATE))); };
// Render time in Node: median and slowest of five, after one warm-up of the whole set.
function timed(fn) { const times = []; let result; for (let i = 0; i < 5; i++) { const t = performance.now(); result = fn(); times.push(performance.now() - t); } times.sort((a, b) => a - b); return { result, median: times[2], max: times[4] }; }

// ---- Famille references, from audio.js itself ------------------------------
// A fresh realm for each render, so its noise (the shimmer from 5 kills) is
// the same seeded draw whatever was rendered before.
const AUDIO = readFileSync(join(root, 'public', 'audio.js'), 'utf8'), engines = { get Engine() { return engineClass(AUDIO); } };
const famille = { chain: [], headshot: null, rafale: null };
for (const [index, count] of RUNG_COUNTS.entries()) {
  const data = await offlineRender(engines.Engine, engine => engine.chain(count), 1.6);
  famille.chain.push({ rung: index + 2, count, data, ...levels(data) });
}
{
  const data = await offlineRender(engines.Engine, engine => engine.headshot(), .3);
  famille.headshot = { data, ...levels(data) };
  const raf = await offlineRender(engines.Engine, rafale, 3.5);
  famille.rafale = { data: raf, k: levels(raf).k, mean: shortTerm(raf), flat: rmsMax(raf) };
}
report.famille = {
  chain: famille.chain.map(({ rung, count, k, hp, flat }) => ({ rung, count, k: round(k), hp: round(hp), flat: round(flat) })),
  headshot: { k: round(famille.headshot.k), hp: round(famille.headshot.hp), flat: round(famille.headshot.flat) },
  rafale: { k: round(famille.rafale.k), mean: round(famille.rafale.mean), flat: round(famille.rafale.flat) },
};

// The veille bed at its game gain, rendered at its own rate (22,050 Hz) and read at 48 kHz, as the engine plays it.
const veille = CANDIDATES.ambience.find(made => made.id === 'veille');
const bed = scaled(resample(render('ambience', 'veille', { rate: 22050 }), 22050, RATE), veille.gain);
const bedBand = bandLevel(bed);
report.bedBand = round(bedBand);

// --slot kill measures the kill confirm only (KILL-SOUND.md 6.2); --slot chain the jingle only.
const chainRuns = !slotArg || slotArg === 'chain';
// Warm the JIT on the whole set once, so the times below are a frame's, not a first compile.
const firstTimes = new Map();
for (const made of chainRuns ? CANDIDATES.chain : []) for (let variant = 0; variant < 9; variant++) { const t = performance.now(); render('chain', made.id, { variant }); firstTimes.set(`${made.id}:${variant}`, performance.now() - t); }

// ---- The chain candidates ---------------------------------------------------
for (const made of chainRuns ? CANDIDATES.chain : []) {
  const rows = [], units = [];
  let memory = 0;
  for (let variant = 0; variant < 9; variant++) {
    const rung = variant + 2, ref = famille.chain[variant], timing = timed(() => render('chain', made.id, { variant })), data = timing.result;
    const gain = made.gain * made.rungGain[variant], output = scaled(data, gain), measured = levels(output), unit = levels(scaled(data, made.gain));
    memory += data.length * 4;
    // Intervals: every melodic onset against its target, the steps between them.
    const notes = chainNotes(data, made.id, rung).map(({ at, target, frequency, cents }) => ({ at: round(at, 3), target: round(target), frequency: round(frequency), cents: round(cents, 1) }));
    for (const note of notes) if (!(Math.abs(note.cents) <= 20)) fail(`${made.id} rung ${rung}: onset at ${note.at} s is ${note.cents} cents from ${note.target} Hz`);
    const steps = notes.slice(1).map((note, i) => round(semitones(notes[i].frequency, note.frequency), 2));
    if (rung === 2 && !(Math.abs(steps[0] - DOUBLE[made.id]) <= .25)) fail(`${made.id}: the double is ${steps[0]} semitones, not ${DOUBLE[made.id]}`);
    if (rung === 3 && steps.some((step, i) => !(Math.abs(step - TRIPLE[made.id][i]) <= .25))) fail(`${made.id}: the triple steps are ${steps}, not ${TRIPLE[made.id]}`);
    for (const note of notes) if (note.frequency > 880 * 2 ** (20 / 1200)) fail(`${made.id} rung ${rung}: a fundamental at ${note.frequency} Hz`);
    // No major third: F#, C# in every octave and the third over the last note.
    const probe = thirdProbe(data, made.id, rung), thirdMargin = probe.margin;
    if (!(thirdMargin >= 24)) fail(`${made.id} rung ${rung}: a major-third band only ${round(thirdMargin, 1)} dB under the strongest peak (${round(probe.pitch, 1)} Hz)`);
    const bright = centroid(data, RATE);
    if (!(bright <= 1200)) fail(`${made.id} rung ${rung}: centroid ${round(bright, 0)} Hz`);
    const end = ending(data, RATE);
    if (!(end.below >= 20)) fail(`${made.id} rung ${rung}: only ${round(end.below, 1)} dB down where the release starts`);
    if (end.last !== 0) fail(`${made.id} rung ${rung}: does not end at zero`);
    const seconds = data.length / RATE;
    if (made.id !== 'glas' && seconds > LENGTH_CAPS[variant] + 1e-9) fail(`${made.id} rung ${rung}: ${seconds} s over the ${LENGTH_CAPS[variant]} s cap`);
    if (timing.max > 15) fail(`${made.id} rung ${rung}: renders in ${round(timing.max, 1)} ms in Node`);
    // L5: over the bed, 250-1000 Hz, at least 12 dB above it.
    const mixBand = bandLevel(output);
    if (!(mixBand - bedBand >= 12)) fail(`${made.id} rung ${rung}: only ${round(mixBand - bedBand, 1)} dB over the bed in 250-1000 Hz`);
    units.push({ ...unit, band: bandLevel(scaled(data, made.gain)) });
    rows.push({ rung, count: RUNG_COUNTS[variant], seconds: round(seconds, 3), rungGain: made.rungGain[variant], notes, steps, thirdMargin: round(thirdMargin, 1), centroid: round(bright, 0), ending: round(end.below, 1), overBed: round(mixBand - bedBand, 1), k: round(measured.k), hp: round(measured.hp), flat: round(measured.flat), famille: { k: round(ref.k), flat: round(ref.flat) }, ms: round(timing.median, 2), msMax: round(timing.max, 2), msFirst: round(firstTimes.get(`${made.id}:${variant}`), 2), measured });
  }
  // L1-L3 on the current rungGain.
  const loudness = rows.map(row => row.measured.k);
  rows.forEach((row, i) => {
    const ref = famille.chain[i], { k, flat } = row.measured;
    if (k > ref.k + 1e-6) fail(`${made.id} rung ${row.rung}: M_K ${round(k)} over Famille's ${round(ref.k)} (L1)`);
    if (k < ref.k - 3 - 1e-6) fail(`${made.id} rung ${row.rung}: M_K ${round(k)} under Famille - 3 (${round(ref.k - 3)}) (L1)`);
    // L2, or the named exemption: L1's floor and L2 cannot both hold there, and M_flat stays within Famille + 3 dB.
    const conflict = k - (flat - ref.flat - 1) < ref.k - 3;
    row.exemption = flat > ref.flat + 1 + 1e-6 ? conflict && flat <= ref.flat + 3 + 1e-6 : false;
    if (flat > ref.flat + 1 + 1e-6 && !row.exemption) fail(`${made.id} rung ${row.rung}: M_flat ${round(flat)} over Famille + 1 (${round(ref.flat + 1)}) (L2)`);
    if (i && k < loudness[i - 1] - 1e-6) fail(`${made.id} rung ${row.rung}: quieter than rung ${row.rung - 1} (L3)`);
    delete row.measured;
  });
  if (memory > 2.5e6) fail(`${made.id}: ${memory} bytes for nine rungs`);
  // The measured rungGain (3.5), as levels: each rung aims at Famille - 1 LU,
  // held under L2 (or, where L1's floor and L2 cannot both hold, at L1's floor:
  // a named exemption); raised to 12 dB over the bed (L5) but never past Famille
  // (L1) or L2; raised so no rung is quieter than the one below (L3); then
  // rungs 2-6 come down together while the Rafale is over Famille's (L4), never
  // under L1's floor, L5 or the rung below.
  const dbOf = f => 20 * Math.log10(f), target = units.map((unit, i) => {
    const ref = famille.chain[i];
    let k = ref.k - 1, exemption = false;
    if (unit.flat + k - unit.k > ref.flat + 1) {
      const capped = unit.k + ref.flat + 1 - unit.flat;
      if (capped >= ref.k - 3) k = capped; else { k = ref.k - 3; exemption = true; }
    }
    const ceiling = Math.min(ref.k, unit.k + ref.flat + (exemption ? 3 : 1) - unit.flat), l5 = unit.k + bedBand + 12.05 - unit.band;
    return { k: Math.max(k, Math.min(l5, ceiling)), floor: Math.max(ref.k - 3, Math.min(l5, ceiling)), ceiling };
  });
  target.forEach((entry, i) => { if (i) entry.k = Math.min(entry.ceiling, Math.max(entry.k, target[i - 1].k)); });
  const factors = () => target.map((entry, i) => Number((10 ** ((entry.k - units[i].k) / 20)).toFixed(3)));
  const rafaleOf = async rungGain => {
    const current = made.rungGain;
    made.rungGain = rungGain;
    try {
      const raf = await offlineRender(engines.Engine, async (engine, ctx) => { engine.setStyle(createSounds(engine, { chain: made.id }).style); rafale(engine, ctx); }, 3.5);
      return { data: raf, k: levels(raf).k, mean: shortTerm(raf), flat: rmsMax(raf) };
    } finally { made.rungGain = current; }
  };
  let rafaleSuggested = await rafaleOf(factors());
  for (let pass = 0; pass < 12; pass++) {
    const over = Math.max(rafaleSuggested.mean - famille.rafale.mean, rafaleSuggested.k - famille.rafale.k, rafaleSuggested.flat - famille.rafale.flat - 1);
    if (over <= -.05) break;
    for (let i = 0; i < RAFALE.length; i++) target[i].k = Math.max(target[i].floor, i ? target[i - 1].k : -Infinity, target[i].k - over - .1);
    rafaleSuggested = await rafaleOf(factors());
  }
  const suggested = factors(), rafaleLevels = await rafaleOf(made.rungGain);
  if (rafaleLevels.k > famille.rafale.k + 1e-6) fail(`${made.id}: Rafale M_K ${round(rafaleLevels.k)} over Famille's ${round(famille.rafale.k)} (L4)`);
  if (rafaleLevels.mean > famille.rafale.mean + 1e-6) fail(`${made.id}: Rafale 3 s mean ${round(rafaleLevels.mean)} over Famille's ${round(famille.rafale.mean)} (L4)`);
  if (rafaleLevels.flat > famille.rafale.flat + 1 + 1e-6) fail(`${made.id}: Rafale M_flat ${round(rafaleLevels.flat)} over Famille + 1 (L4)`);
  const raf = rafaleLevels.data, three = value => ({ k: round(value.k), mean: round(value.mean), flat: round(value.flat) });
  report.chain[made.id] = { gain: made.gain, rungGain: made.rungGain, suggested, exemptions: rows.filter(row => row.exemption).map(row => row.rung), memory, rafale: three(rafaleLevels), rafaleSuggested: three(rafaleSuggested), rows };
  // WAVs: each rung, the Rafale, each rung over the bed.
  for (let variant = 0; variant < 9; variant++) {
    const output = scaled(render('chain', made.id, { variant }), made.gain * made.rungGain[variant]), mixed = Float64Array.from(bed.subarray(0, output.length + RATE / 2), (value, i) => value + (output[i] ?? 0));
    wav(join(out, 'chain', `${made.id}-rung${variant + 2}.wav`), output, wavRate);
    wav(join(out, 'chain', `${made.id}-rung${variant + 2}-veille.wav`), mixed, wavRate);
  }
  wav(join(out, 'chain', `${made.id}-rafale.wav`), trim(raf), wavRate);
}
famille.chain.forEach(({ rung, data }) => wav(join(out, 'famille', `chain-rung${rung}.wav`), trim(data), wavRate));
wav(join(out, 'famille', 'chain-rafale.wav'), trim(famille.rafale.data), wavRate);
wav(join(out, 'famille', 'headshot.wav'), trim(famille.headshot.data), wavRate);

// ---- The head shot: fele ----------------------------------------------------
if (slotArg !== 'chain' && slotArg !== 'kill') {
  const fele = CANDIDATES.headshot.find(made => made.id === 'fele'), ref = famille.headshot, variants = [];
  for (let variant = 0; variant < fele.variants; variant++) {
    const timing = timed(() => render('headshot', 'fele', { variant })), data = timing.result, measured = levels(scaled(data, fele.gain)), end = ending(data, RATE);
    if (measured.k > ref.k + 1e-6 || measured.k < ref.k - 3 - 1e-6) fail(`fele ${variant}: M_K ${round(measured.k)} outside [${round(ref.k - 3)}, ${round(ref.k)}] (L1)`);
    if (measured.flat > ref.flat + 1 + 1e-6) fail(`fele ${variant}: M_flat ${round(measured.flat)} over Famille + 1 (L2)`);
    if (!(end.below >= 20) || end.last !== 0) fail(`fele ${variant}: release ${round(end.below, 1)} dB down, last sample ${end.last}`);
    if (timing.max > 15) fail(`fele ${variant}: renders in ${round(timing.max, 1)} ms in Node`);
    variants.push({ variant, k: round(measured.k), hp: round(measured.hp), flat: round(measured.flat), ending: round(end.below, 1), ms: round(timing.median, 2), msMax: round(timing.max, 2) });
  }
  const one = render('headshot', 'fele', { variant: 1 }), pair = glidingPeaks(one, RATE, { ratio: .944, time: .03, seconds: .15, lo: 700, hi: 900 });
  const start = instantPitch(one, RATE, .001, .004, 600, 1000), at60 = instantPitch(one, RATE, .057, .063, 600, 1000), fall = -cents(at60, start);
  const pairCents = [cents(pair[0], pitch(17)), cents(pair[1], pitch(18))];
  if (pair.length < 2 || pairCents.some(value => !(Math.abs(value) <= 20))) fail(`fele: the pair reads ${pair.map(value => round(value, 1))} Hz`);
  if (!(fall >= 70)) fail(`fele: falls ${round(fall, 1)} cents in 60 ms`);
  // A gain from the measure: Famille - 1 LU, held under L2.
  const unit = levels(scaled(render('headshot', 'fele', { variant: 1 }), 1));
  let gain = 10 ** ((ref.k - 1 - unit.k) / 20);
  if (unit.flat + 20 * Math.log10(gain) > ref.flat + 1) gain *= 10 ** ((ref.flat + 1 - unit.flat - 20 * Math.log10(gain)) / 20);
  report.headshot.fele = { gain: fele.gain, suggested: round(gain, 4), pair: pair.map(value => round(value, 2)), pairCents: pairCents.map(value => round(value, 1)), fall: round(fall, 1), start: round(start, 1), at60: round(at60, 1), variants };
  for (let variant = 0; variant < fele.variants; variant++) wav(join(out, 'headshot', `fele-${variant}.wav`), scaled(render('headshot', 'fele', { variant }), fele.gain), wavRate);
  // Every other candidate too, at its output level, for listening side by side.
  for (const slot of SLOTS.filter(slot => slot !== 'chain')) for (const made of CANDIDATES[slot]) {
    if (made.take || made.id === 'fele' && slot === 'headshot') continue;
    const rate = slot === 'ambience' ? 22050 : RATE;
    for (let variant = 0; variant < (made.variants ?? 1); variant++) {
      const data = scaled(render(slot, made.id, { rate, variant }), made.gain);
      wav(join(out, slot, `${made.id}${made.variants > 1 ? `-${variant}` : ''}.wav`), rate === RATE ? data : resample(data, rate, RATE), wavRate);
    }
  }
  for (let variant = 0; variant < CREAK.variants; variant++) wav(join(out, 'ambience', `creak-${variant}.wav`), scaled(render('creak', null, { variant }), veille.creakGain), wavRate);
}
// The rung each Famille count plays, from the engine's own steps (a sanity line).
if (RUNG_COUNTS.some((count, i) => chainRung(count) !== i + 2)) fail('chainRung disagrees with the rung table');

// ---- The kill confirm (art/frisson/KILL-SOUND.md sections 4, 5 and 6.2) ---
// The owner's gun takes at their manifest gains, played whole from 0: the four
// single-shot ones through the RIFF reader, the sniper, the streams and the
// blasts through ffmpeg (read-only; reported, no threshold). Each candidate at
// its output level (render x gain x variantGain) lands at the lag; every mix
// goes through the compressor model, a pre-check: Edge's real
// DynamicsCompressorNode decides K5-K7 (art/frisson/tools/feedback-shot).
// The rules a report-only candidate is known to fail among K5-K7 (4.3,
// KILL_MIX_REPORT_ONLY): a change either way is reported as a failure, so it shows up.
// Their analysis-rule failures (the same list as test/frisson-kill-sound.test.mjs).
const KILL_REPORT_ONLY = Object.freeze({ os: ['K4.peak', 'body', 'centroid'] });
// The lag is swept on the first new crack, craque (4.2): the owner's eclat
// cannot rise above the guns, so its sweep is reported only.
const LAG_BY = 'craque', LAGS = [.03, .035, .04, .045, .05], MIX_SECONDS = .7;
// A brute or boss kill plays at sounds.js's HEAVY_RATE: K5 is reported there too.
const HEAVY = .95;
// The other device rate measured: the game renders a candidate with
// variantGain at 48 kHz whatever the context's rate (sounds.js MEASURED_RATE)
// and the source resamples it; the others render at the context's rate.
const RATE44 = 44100;
if (!slotArg || slotArg === 'kill') {
  const K = KILL_K, manifest = JSON.parse(readFileSync(join(root, 'public', 'audio', 'manifest.json'), 'utf8')), entry = kind => manifest.effects[kind][0];
  const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
  const killReport = report.kill = { lag: KILL_LAG, candidates: {}, guns: {}, famille: {} };
  // The guns, at 48 kHz (resampled) and at 44.1 kHz (their own rate).
  const guns = {}, guns44 = {};
  for (const [name, file] of Object.entries(KILL_GUNS)) {
    const take = entry(name);
    if (take.src !== `/audio/${file}`) fail(`kill: the ${name} take is ${take.src}, not ${file}`);
    const { rate, data } = readWav(readFileSync(join(root, 'public', take.src)));
    guns[name] = scaled(resample(data, rate, RATE).subarray(0, Math.round(MIX_SECONDS * RATE)), take.gain);
    killReport.guns[name] = { src: take.src, gain: take.gain, k: round(levels(guns[name]).k), peak: round(peakDb(guns[name]), 1) };
    guns44[name] = scaled((rate === RATE44 ? data : resample(data, rate, RATE44)).subarray(0, Math.round(MIX_SECONDS * RATE44)), take.gain);
  }
  const ffmpeg = process.env.FFMPEG || 'ffmpeg', hasFfmpeg = spawnSync(ffmpeg, ['-version']).status === 0;
  const decode = (src, start) => {
    const result = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(start), '-i', join(root, 'public', src), '-t', String(MIX_SECONDS), '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 26 });
    if (result.status !== 0) return null;
    const bytes = new Uint8Array(result.stdout);
    return Float64Array.from(new Float32Array(bytes.buffer, 0, bytes.length >> 2));
  };
  // Reported only: the sniper from its start; a stream from inside its held
  // loop (smg x .85, audio.js's loop trim; the minigun after its 1 s spin-up);
  // the blasts at full and half volume (explosion(volume) from distance).
  const others = { sniper: ['sniperShot', 0, 1], smg: ['smg', .3, .85], rifle: ['rifle', .3, 1], minigun: ['minigunFire', 1.5, 1], flamethrower: ['flamethrower', 1, 1], grenade: ['explosion', 0, 1], 'grenade-half': ['explosion', 0, .5], rocket: ['rocketExplosion', 0, 1], 'rocket-half': ['rocketExplosion', 0, .5] };
  const extra = {};
  if (hasFfmpeg) for (const [name, [kind, start, trimGain]] of Object.entries(others)) {
    const take = entry(kind), data = decode(take.src, start);
    if (data) extra[name] = scaled(data, take.gain * trimGain);
  }
  killReport.reportedGuns = hasFfmpeg ? Object.keys(extra) : `ffmpeg not found (${ffmpeg})`;
  // The quieter tiers K3 sets the kill over: Famille's hit thud and head-shot tink, fele.
  const hit = mean(await Promise.all([0, 1, 2, 3, 4].map(async seed => levels(await offlineRender(engineClass(AUDIO, 20261013 + seed), engine => engine.hit(), .3)).k)));
  const fele = CANDIDATES.headshot.find(made => made.id === 'fele'), feleK = Math.max(...[0, 1, 2].map(variant => levels(scaled(render('headshot', 'fele', { variant }), fele.gain)).k));
  const tiers = { hit, tink: famille.headshot.k, fele: feleK };
  killReport.tiers = Object.fromEntries(Object.entries(tiers).map(([key, value]) => [key, round(value)]));
  // Renders, warm, timed (the slowest of five), twice the same.
  for (const made of CANDIDATES.kill) for (let variant = 0; variant < made.variants; variant++) render('kill', made.id, { variant });
  const renders = new Map(), renderMs = new Map();
  for (const made of CANDIDATES.kill) {
    const list = [], ms = [];
    for (let variant = 0; variant < made.variants; variant++) {
      const timing = timed(() => render('kill', made.id, { variant }));
      const again = render('kill', made.id, { variant });
      if (again.length !== timing.result.length || !timing.result.every((value, i) => value === again[i])) fail(`kill/${made.id} ${variant}: two renders differ`);
      list.push(Float64Array.from(timing.result)); ms.push(timing.max);
    }
    renders.set(made.id, list); renderMs.set(made.id, ms);
  }
  const outputs = (made, gain = made.gain, variantGain = made.variantGain) => renders.get(made.id).map((data, v) => scaled(data, gain * (variantGain?.[v] ?? 1)));
  const outputs44 = (made, gain = made.gain, variantGain = made.variantGain) => renders.get(made.id).map((data, v) => scaled(made.variantGain ? resample(data, RATE, RATE44) : render('kill', made.id, { rate: RATE44, variant: v }), gain * (variantGain?.[v] ?? 1)));
  // K5 and K6 over the four guns at one lag, means over the variants, worst variant reported.
  const overGuns = (outs, lag, set = guns, rate = RATE) => Object.fromEntries(Object.entries(set).map(([name, gun]) => {
    const r = outs.map(x => cutThrough(gun, x, lag, rate));
    return [name, { rise: mean(r.map(v => v.rise)), riseMin: Math.min(...r.map(v => v.rise)), audible: mean(r.map(v => v.audible)), audibleMin: Math.min(...r.map(v => v.audible)), startle: Math.max(...r.map(v => v.startle)) }];
  }));
  const k5Fails = per => {
    const failed = [], riseMean = mean(Object.keys(KILL_GUNS).map(name => per[name].rise));
    for (const name of Object.keys(KILL_GUNS)) if (!(per[name].rise >= K.rise[name])) failed.push(`K5.${name}`);
    if (!(riseMean >= K.rise.mean)) failed.push('K5.mean');
    for (const name of ['shotgun', 'assault', 'magnum']) if (!(per[name].audible >= K.audible)) failed.push(`K5.audible.${name}`);
    return { failed, riseMean };
  };
  // The level a target K1 asks: gain brings the variants' mean to it,
  // variantGain each variant (a variant over the peak cap goes lower, within
  // the tolerance). Rounded as sounds.js writes them.
  const levelsFor = (made, target) => {
    const mks = renders.get(made.id).map(data => levels(data).k), gain = Number((10 ** ((target - mean(mks)) / 20)).toFixed(4));
    const variantGain = mks.map((mk, v) => {
      let g = 10 ** ((target - mk) / 20) / gain;
      const peak = peakDb(scaled(renders.get(made.id)[v], gain * g)), floor = 10 ** ((target - K.tolerance + .02 - mk) / 20) / gain;
      if (peak > K.maxPeak - .02) g = Math.max(floor, g * 10 ** ((K.maxPeak - .02 - peak) / 20));
      return Number(g.toFixed(3));
    });
    return { gain, variantGain };
  };
  // The model passes at every device rate measured.
  const passesAt = (made, target, lag) => { const { gain, variantGain } = levelsFor(made, target); return !k5Fails(overGuns(outputs(made, gain, variantGain), lag)).failed.length && !k5Fails(overGuns(outputs44(made, gain, variantGain), lag, guns44, RATE44)).failed.length; };
  // The lag (4.2): every per-gun mean >= +2.5 dB, the best mean of the four,
  // then the shortest lag within 0.5 dB of it.
  const sweep = made => LAGS.map(lag => { const per = overGuns(outputs(made), lag); return { lag, per: Object.fromEntries(Object.entries(per).map(([name, v]) => [name, round(v.rise)])), mean: mean(Object.values(per).map(v => v.rise)), eligible: Object.values(per).every(v => v.rise >= 2.5) }; });
  const sweeps = Object.fromEntries(CANDIDATES.kill.map(made => [made.id, sweep(made)]));
  const eligible = sweeps[LAG_BY].filter(row => row.eligible), best = Math.max(...eligible.map(row => row.mean));
  const pickedLag = eligible.find(row => row.mean >= best - .5)?.lag ?? null;
  if (pickedLag === null || Math.abs(pickedLag - KILL_LAG) > 1e-9) fail(`kill: the lag sweep picks ${pickedLag === null ? 'no lag' : `${round(pickedLag * 1000, 0)} ms`}, KILL_LAG is ${KILL_LAG * 1000} ms (4.2)`);
  killReport.lagSweep = Object.fromEntries(Object.entries(sweeps).map(([id, rows]) => [id, rows.map(row => ({ ...row, mean: round(row.mean) }))]));
  killReport.pickedLag = pickedLag;
  // The chosen jingle (K7), rungs 2 and 3, at its game level.
  const jingleMade = CANDIDATES.chain.find(made => made.id === CHOSEN.chain), jingleAt = rate => [2, 3].map(rung => jingleMade ? scaled(render('chain', jingleMade.id, { rate, variant: rung - 2 }), jingleMade.gain * jingleMade.rungGain[rung - 2]) : null);
  const jingles = jingleAt(RATE), jingles44 = jingleAt(RATE44);
  const placeAt = (n, x, lag, into = new Float64Array(n), rate = RATE) => { const start = Math.round(lag * rate); for (let i = 0; i < x.length && start + i < n; i++) into[start + i] += x[i]; return into; };
  const bandRms = (x, from, to, rate = RATE) => rmsMax(bandPass(x.subarray(0, Math.round((to + .05) * rate)), 250, 1000, rate).subarray(Math.round(from * rate), Math.round(to * rate)), rate);
  const withJingle = (outs, lag, rate = RATE) => {
    if (!jingleMade) return null;
    const result = {}, set = rate === RATE ? jingles : jingles44, gunSet = rate === RATE ? guns : guns44;
    for (const [index, jingle] of set.entries()) for (const gunName of ['none', 'pistol', 'assault']) {
      const changes = [], rises = [];
      for (const x of outs) {
        const n = Math.round(MIX_SECONDS * rate), base = gunName === 'none' ? new Float64Array(n) : Float64Array.from(gunSet[gunName]);
        placeAt(n, jingle, lag, base, rate);
        const sum = placeAt(n, x, lag, Float64Array.from(base), rate), m0 = times(base, compress(base, { rate })), m1 = times(sum, compress(sum, { rate }));
        changes.push(bandRms(m1, lag, lag + .12, rate) - bandRms(m0, lag, lag + .12, rate));
        if (gunName !== 'none') rises.push(rise(m1, m0, lag, { rate }));
      }
      result[`rung${index + 2}-${gunName}`] = { change: mean(changes), worst: changes.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0), rise: rises.length ? mean(rises) : null };
    }
    return result;
  };
  // Each candidate: the analysis rules and K1-K4 (killRules), the lowest
  // passing level, K5-K6 at the lag, the heavy rate, K7, K8.
  for (const made of CANDIDATES.kill) {
    const fresh = Array.isArray(made.variantGain), outs = outputs(made), rules = killRules(made, renders.get(made.id), Object.values(tiers));
    const failed = new Set(rules.failed), entryReport = { gain: made.gain, variantGain: made.variantGain ?? null, report: fresh ? (KILL_REPORT_ONLY[made.id] || KILL_MIX_REPORT_ONLY[made.id] ? 'report only' : 'rules') : 'report only (the 13 October candidates, never re-levelled)' };
    for (const ms of renderMs.get(made.id)) if (ms > K.renderMs) failed.add('time');
    const per = overGuns(outs, KILL_LAG), five = k5Fails(per);
    for (const id of five.failed) failed.add(id);
    for (const name of Object.keys(KILL_GUNS)) if (!(per[name].startle <= K.startle)) failed.add('K6');
    // Reported: the other guns and the blasts, and the four guns at the heavy rate.
    entryReport.reported = Object.fromEntries(Object.entries(overGuns(outs, KILL_LAG, extra)).map(([name, v]) => [name, { rise: round(v.rise), audible: round(v.audible, 1), startle: round(v.startle, 1) }]));
    entryReport.heavy = made.pitched ? 'rate 1 always' : Object.fromEntries(Object.entries(overGuns(outs.map(x => resample(x, HEAVY, 1)), KILL_LAG)).map(([name, v]) => [name, round(v.rise)]));
    const seven = withJingle(outs, KILL_LAG);
    if (seven) for (const [key, value] of Object.entries(seven)) {
      if (!(value.change >= K.jingle[0] && value.change <= K.jingle[1])) failed.add('K7');
      if (value.rise !== null && !(value.rise >= K.rise[key.endsWith('pistol') ? 'pistol' : 'assault'])) failed.add('K7.rise');
    }
    // At 44.1 kHz: each variant's level as the game plays it there (K1), and
    // K5-K7 through the model; a candidate meant to pass must pass there too.
    const outs44 = outputs44(made), mk44 = outs44.map(x => levels(x, RATE44).k), per44 = overGuns(outs44, KILL_LAG, guns44, RATE44), five44 = k5Fails(per44), seven44 = withJingle(outs44, KILL_LAG, RATE44);
    if (fresh && Math.max(...mk44) - Math.min(...mk44) > 2 * K.tolerance + 1e-9) failed.add('K1.44k');
    const mix44 = [...five44.failed];
    for (const name of Object.keys(KILL_GUNS)) if (!(per44[name].startle <= K.startle)) mix44.push('K6');
    if (seven44) for (const [key, value] of Object.entries(seven44)) {
      if (!(value.change >= K.jingle[0] && value.change <= K.jingle[1])) mix44.push('K7');
      if (value.rise !== null && !(value.rise >= K.rise[key.endsWith('pistol') ? 'pistol' : 'assault'])) mix44.push('K7.rise');
    }
    if (fresh && !KILL_MIX_REPORT_ONLY[made.id]) for (const id of new Set(mix44)) failed.add(`${id}@44.1k`);
    entryReport.at44 = {
      k: round(mean(mk44)), spread: round(Math.max(...mk44) - Math.min(...mk44)), variants: mk44.map(value => round(value)),
      k5: Object.fromEntries(Object.entries(per44).map(([name, v]) => [name, { rise: round(v.rise), riseMin: round(v.riseMin), audible: round(v.audible, 1), startle: round(v.startle, 1) }])), riseMean: round(five44.riseMean),
      k7: seven44 && Object.fromEntries(Object.entries(seven44).map(([key, v]) => [key, { change: round(v.change), rise: v.rise === null ? null : round(v.rise) }])), failed: [...new Set(mix44)].sort(),
    };
    const raf = await killRafale(engines.Engine, createSounds, made, renders.get(made.id).map(data => Float32Array.from(data)));
    const rafale6 = { k: levels(raf.data).k, mean: shortTerm(raf.data), trims: raf.trims, sixth: raf.trims[5] - raf.trims[0] };
    if (!(rafale6.k <= rules.k + K.rafaleOver)) failed.add('K8.k');
    if (!(rafale6.mean <= rules.k)) failed.add('K8.mean');
    if (!(rafale6.sixth >= K.sixth[0] && rafale6.sixth <= K.sixth[1])) failed.add('K8.sixth');
    // The lowest level that still cuts through (K5), within the range.
    let lowest = null;
    if (fresh) {
      if (passesAt(made, K.range[0], KILL_LAG)) lowest = K.range[0];
      else if (passesAt(made, K.range[1], KILL_LAG)) {
        let lo = K.range[0], hi = K.range[1];
        while (hi - lo > .05) { const mid = (lo + hi) / 2; if (passesAt(made, mid, KILL_LAG)) hi = mid; else lo = mid; }
        lowest = Math.ceil(hi * 20) / 20;
      }
      // Edge's own compressor decides K5-K7 (6.3): where it asks more than
      // the model, its measured level (KILL_EDGE_FLOOR: the lowest that passes
      // at 48 and 44.1 kHz, plus KILL_EDGE_MARGIN) is the lowest level.
      const edgeFloor = KILL_EDGE_FLOOR[made.id] ?? null;
      entryReport.modelLowest = lowest; entryReport.edgeFloor = edgeFloor;
      if (lowest !== null && edgeFloor !== null && edgeFloor > lowest) lowest = edgeFloor;
      if (edgeFloor !== null && rules.k < edgeFloor - .05) failed.add('K1.edge');
      // A candidate that passes nowhere sits at the floor: no rule asks for more.
      const target = lowest ?? K.range[0];
      entryReport.measured = { target, ...levelsFor(made, target) };
      if (lowest !== null && rules.k > lowest + .2) failed.add('K1.lowest');
    }
    entryReport.lowest = lowest;
    // The 13 October candidates are never re-levelled: what the loudest
    // level the brief allows (K1's top) would buy them, for the owner.
    if (!fresh) {
      const mks = renders.get(made.id).map(data => levels(data).k), top = overGuns(renders.get(made.id).map((data, v) => scaled(data, 10 ** ((K.range[1] - mks[v]) / 20))), KILL_LAG);
      entryReport.atTop = { k: K.range[1], gain: round(10 ** ((K.range[1] - mean(mks)) / 20), 3), k5: Object.fromEntries(Object.entries(top).map(([name, v]) => [name, { rise: round(v.rise), audible: round(v.audible, 1) }])), riseMean: round(mean(Object.values(top).map(v => v.rise))) };
    }
    const all = [...failed].sort(), mixFailed = all.filter(id => /^K[567]/.test(id)), ruleFailed = all.filter(id => !/^K[567]/.test(id));
    if (fresh) {
      const known = KILL_MIX_REPORT_ONLY[made.id] ?? [], knownRules = KILL_REPORT_ONLY[made.id] ?? [];
      const same = (a, b) => a.length === b.length && a.every((id, i) => id === [...b].sort()[i]);
      if (!same(mixFailed, known)) fail(`kill/${made.id}: fails ${mixFailed.join(', ') || 'no cut-through rule'} where its list says ${known.join(', ') || 'none'} (4.3)`);
      if (!same(ruleFailed, knownRules)) fail(`kill/${made.id}: fails ${ruleFailed.join(', ') || 'no analysis rule'} where its list says ${knownRules.join(', ') || 'none'}`);
    }
    Object.assign(entryReport, {
      failed: all, k: round(rules.k), spread: round(rules.spread * 100, 1), closest: round(rules.closest, 3), renderMs: renderMs.get(made.id).map(ms => round(ms, 1)),
      variants: rules.rows.map(row => ({ k: round(row.k), hp: round(row.hp), flat: round(row.flat), peak: round(row.peak, 1), attack: round(row.attack), firstPeak: round(row.firstPeak, 1), centroid: round(row.centroid, 0), body: round(row.body, 1), shape: round(row.shape, 1), share60: round(row.share60, 3), clean: round(row.clean, 1), third: row.third === undefined ? undefined : round(row.third, 1) })),
      k5: Object.fromEntries(Object.entries(per).map(([name, v]) => [name, { rise: round(v.rise), riseMin: round(v.riseMin), audible: round(v.audible, 1), audibleMin: v.audibleMin, startle: round(v.startle, 1) }])), riseMean: round(five.riseMean),
      k7: seven && Object.fromEntries(Object.entries(seven).map(([key, v]) => [key, { change: round(v.change), worst: round(v.worst), rise: v.rise === null ? null : round(v.rise) }])),
      k8: { k: round(rafale6.k), overK1: round(rafale6.k - rules.k), mean: round(rafale6.mean), trims: rafale6.trims.map(value => round(value)), sixth: round(rafale6.sixth) },
    });
    killReport.candidates[made.id] = entryReport;
    // WAVs: the variants, the rafale, the mixes (through the compressor model).
    outs.forEach((x, v) => wav(join(out, 'kill', `${made.id}-v${v}.wav`), x, wavRate));
    wav(join(out, 'kill', `${made.id}-rafale.wav`), trim(raf.data), wavRate);
    for (const [name, gun] of Object.entries({ ...guns, ...(extra.smg ? { smg: extra.smg } : {}), ...(extra.sniper ? { sniper: extra.sniper } : {}) })) for (const lag of [0, KILL_LAG, .05]) wav(join(out, 'kill', `${made.id}-${name}-lag${round(lag * 1000, 0)}.wav`), killMix(gun, outs[0], lag).mixed, wavRate);
    for (const name of ['grenade', 'grenade-half', 'rocket', 'rocket-half']) if (extra[name]) wav(join(out, 'kill', `${made.id}-${name}.wav`), killMix(extra[name], outs[0], KILL_LAG).mixed, wavRate);
    jingles.forEach((jingle, index) => { if (!jingle) return; const n = Math.round(MIX_SECONDS * RATE), sum = placeAt(n, outs[0], KILL_LAG, placeAt(n, jingle, KILL_LAG)); wav(join(out, 'kill', `${made.id}-chain${index + 2}.wav`), times(sum, compress(sum)), wavRate); });
  }
  // ---- Famille, Part B: today's thump and the three clacs ----------------
  // Each from audio.js's own tone() and noise() (5 renders, their noise
  // averaged), alone at the output; B2 its 2-3 kHz rise over the four guns
  // at the 40 ms lag (the clac starts 40 ms after the call).
  const tinkK = famille.headshot.k, floorK = Math.max(K.famille.k[0], tinkK + K.famille.overTink), groanTake = manifest.effects.groan[0];
  const groan = (() => { try { const { rate, data } = readWav(readFileSync(join(root, 'public', groanTake.src))); return scaled(resample(data, rate, RATE), groanTake.gain * .09 / .055); } catch { return null; } })();
  const familleKill = /^const FAMILLE_KILL=(null|'([a-z]+)');$/m.exec(AUDIO), current = familleKill?.[2] ?? null;
  if (!familleKill) fail('kill: no one-line FAMILLE_KILL in audio.js');
  const clacs = {};
  for (const id of ['thump', 'bois', 'pop', 'tac']) {
    const data = await Promise.all([0, 1, 2, 3, 4].map(seed => offlineRender(engineClass(AUDIO, 20261013 + seed), engine => id === 'thump' ? engine.noise(.12, .1, 350) : engine.clac(id), .4)));
    const measured = data.map(x => levels(x)), b2 = scale => Object.fromEntries(Object.entries(guns).map(([name, gun]) => [name, mean(data.map(x => { const m = killMix(gun, scaled(x, scale), 0); return rise(m.mixed, m.aloneOut, KILL_LAG, { lo: 2000, hi: 3000 }); }))]));
    const k = mean(measured.map(v => v.k)), rises = b2(1), entryReport = { k: round(k), hp: round(mean(measured.map(v => v.hp))), flat: round(mean(measured.map(v => v.flat))), peak: round(Math.max(...data.map(peakDb)), 1), b2: Object.fromEntries(Object.entries(rises).map(([name, value]) => [name, round(value)])), b2Mean: round(mean(Object.values(rises))) };
    if (id !== 'thump') {
      // B3: the recipe's own calls, tone(from, to, seconds, volume, type, delay)
      // and noise(seconds, volume, frequency, type, delay).
      const calls = clacCalls(engines.Engine, id) ?? [];
      const clean = ([kind, ...args]) => kind === 'noise' ? args[2] <= K.famille.maxHz
        : args[4] === 'sine' ? Math.max(args[0], args[1]) <= K.famille.maxHz : args[4] === 'triangle' && Math.max(args[0], args[1]) <= K.famille.triangleHz;
      if (!calls.length || !calls.every(clean)) fail(`famille ${id}: a sine or band above ${K.famille.maxHz} Hz, or a triangle above ${K.famille.triangleHz} Hz (B3)`);
      if (!(k >= floorK - .01 && k <= K.famille.k[1] + .01)) fail(`famille ${id}: M_K ${round(k)} outside [${round(floorK)}, ${K.famille.k[1]}] (B1)`);
      if (!(entryReport.b2Mean >= K.famille.rise)) fail(`famille ${id}: B2 mean rise ${entryReport.b2Mean} dB under +${K.famille.rise} (B2)`);
      // The lowest level that passes: B2 holds far above its floor, so B1's floor, rounding apart.
      if (k > floorK + .2) fail(`famille ${id}: M_K ${round(k)} more than 0.2 LU over the lowest level that passes (${round(floorK)})`);
      if (entryReport.peak > K.famille.peak) fail(`famille ${id}: peak ${entryReport.peak} dBFS over ${K.famille.peak} (B3)`);
      // The lowest level that passes B1 (its floor: 4 LU over the tink) and B2, as a scale of today's volumes.
      const atFloor = 10 ** ((floorK + .02 - k) / 20), floorRises = b2(atFloor);
      entryReport.atFloor = { scale: round(atFloor, 3), b2: Object.fromEntries(Object.entries(floorRises).map(([name, value]) => [name, round(value)])), b2Mean: round(mean(Object.values(floorRises))) };
      entryReport.calls = calls.map(([kind, ...rest]) => `${kind}(${rest.map(value => typeof value === 'number' ? round(value, 4) : `'${value}'`).join(',')})`);
      entryReport.scaledCalls = calls.map(([kind, ...rest]) => `${kind}(${rest.map((value, i) => typeof value !== 'number' ? `'${value}'` : (kind === 'tone' ? i === 3 : i === 1) ? Number((value * atFloor).toFixed(3)) : value).join(',')})`);
    }
    clacs[id] = { data, ...entryReport };
    killReport.famille[id] = entryReport;
    const listen = Float64Array.from({ length: Math.max(data[0].length, groan?.length ?? 0) }, (_, i) => (data[0][i] ?? 0) + (groan?.[i] ?? 0));
    wav(join(out, 'famille', id === 'thump' ? 'kill.wav' : `kill-${id}.wav`), listen, wavRate);
  }
  // The provisional default (5): the better of bois and pop by the mean B2 rise
  // at the 40 ms lag, both at the same level (B1's floor); a tie goes to bois.
  const pick = clacs.pop.atFloor.b2Mean > clacs.bois.atFloor.b2Mean ? 'pop' : 'bois';
  killReport.famille.pick = { pick, bois: clacs.bois.atFloor.b2Mean, pop: clacs.pop.atFloor.b2Mean, by: round(Math.abs(clacs.pop.atFloor.b2Mean - clacs.bois.atFloor.b2Mean)), current, floor: round(floorK) };
  if (current !== pick) fail(`famille: FAMILLE_KILL is ${current === null ? 'null' : `'${current}'`}, the B2 measurement picks '${pick}' (5)`);
}

// ---- Themes: tonal centres, read-only through ffmpeg ------------------------
if (themes) {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg', manifest = JSON.parse(readFileSync(join(root, 'public', 'audio', 'manifest.json'), 'utf8'));
  const probe = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' });
  if (probe.status !== 0) report.themes = { error: `ffmpeg not found (${ffmpeg})` };
  else {
    report.themes = {};
    const entries = [...Object.entries(MUSIC_THEME_CATALOG).map(([theme, key]) => [theme, key]), ['(original fallback)', 'ambient'], ['(brute)', 'brute'], ['(finale)', 'finale']];
    for (const [theme, key] of entries) {
      const src = manifest.music?.[key]?.src;
      if (!src) { report.themes[theme] = { error: 'no file' }; continue; }
      const decoded = spawnSync(ffmpeg, ['-v', 'error', '-i', join(root, 'public', src), '-vn', '-ac', '1', '-ar', '11025', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28 });
      if (decoded.status !== 0) { report.themes[theme] = { error: String(decoded.stderr).trim() }; continue; }
      const data = new Float32Array(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.byteLength >> 2);
      report.themes[theme] = { src, seconds: round(data.length / 11025, 1), ...tonalCentre(chroma(data, 11025)) };
    }
  }
}

// ---- Report -----------------------------------------------------------------
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'analysis.json'), `${JSON.stringify(report, null, 1)}\n`);
const pad = (value, width) => String(value).padStart(width);
console.log(`Famille (resynthesized from audio.js)        M_K LUFS   M_HP dB  M_flat dB`);
for (const row of report.famille.chain) console.log(`  chain rung ${pad(row.rung, 2)} (count ${pad(row.count, 2)})            ${pad(row.k.toFixed(2), 8)} ${pad(row.hp.toFixed(2), 9)} ${pad(row.flat.toFixed(2), 10)}`);
console.log(`  headshot tink                         ${pad(report.famille.headshot.k.toFixed(2), 8)} ${pad(report.famille.headshot.hp.toFixed(2), 9)} ${pad(report.famille.headshot.flat.toFixed(2), 10)}`);
console.log(`  Rafale 2-6: M_K ${report.famille.rafale.k.toFixed(2)}, 3 s mean ${report.famille.rafale.mean.toFixed(2)}, M_flat ${report.famille.rafale.flat.toFixed(2)}`);
console.log(`  veille bed at .031, 250-1000 Hz: max 50 ms RMS ${bedBand.toFixed(2)} dB`);
for (const [id, entry] of Object.entries(report.chain)) {
  console.log(`\n${id}  gain ${entry.gain}  memory ${(entry.memory / 1e6).toFixed(2)} MB  Rafale M_K ${entry.rafale.k} (Famille ${report.famille.rafale.k}), mean ${entry.rafale.mean} (${report.famille.rafale.mean}), flat ${entry.rafale.flat} (${report.famille.rafale.flat})`);
  console.log(`  rung  s      rungGain  M_K (Famille)    M_flat (Famille)  M_HP    steps (semitones)       worst onset  3rd margin  centroid  release  over bed  ms med/max/first`);
  for (const row of entry.rows) {
    const worst = row.notes.reduce((a, b) => Math.abs(b.cents) > Math.abs(a) ? b.cents : a, 0);
    console.log(`  ${pad(row.rung, 4)}  ${row.seconds.toFixed(3)}  ${pad(row.rungGain, 8)}  ${pad(row.k.toFixed(2), 6)} (${row.famille.k.toFixed(2)})  ${pad(row.flat.toFixed(2), 6)} (${row.famille.flat.toFixed(2)})${row.exemption ? '*' : ' '}  ${pad(row.hp.toFixed(2), 6)}  ${(row.steps.map(step => step.toFixed(2)).join(' ') || '-').padEnd(22)}  ${pad(worst.toFixed(1), 6)} c  ${pad(row.thirdMargin.toFixed(1), 6)} dB  ${pad(row.centroid, 5)} Hz  ${pad(row.ending.toFixed(1), 5)} dB  ${pad(row.overBed.toFixed(1), 5)} dB  ${row.ms.toFixed(1)}/${row.msMax.toFixed(1)}/${row.msFirst.toFixed(1)}`);
  }
  console.log(`  measured rungGain: [${entry.suggested.join(', ')}]  (its Rafale: M_K ${entry.rafaleSuggested.k}, mean ${entry.rafaleSuggested.mean}, flat ${entry.rafaleSuggested.flat})${entry.exemptions.length ? `  L2 exemption (*): rungs ${entry.exemptions.join(', ')}` : ''}`);
}
if (report.headshot.fele) {
  const f = report.headshot.fele;
  console.log(`\nfele  gain ${f.gain} (measured ${f.suggested})  pair ${f.pair.join(' + ')} Hz (${f.pairCents.join(', ')} cents)  fall ${f.fall} cents in 60 ms (${f.start} -> ${f.at60} Hz)`);
  for (const row of f.variants) console.log(`  variant ${row.variant}: M_K ${row.k} (Famille ${report.famille.headshot.k})  M_flat ${row.flat} (${report.famille.headshot.flat})  M_HP ${row.hp}  release ${row.ending} dB  ${row.ms}/${row.msMax} ms`);
}
if (report.kill) {
  const k = report.kill, f = value => (value >= 0 ? '+' : '') + value.toFixed(1);
  console.log(`\nKill confirm (KILL-SOUND.md), KILL_LAG ${k.lag * 1000} ms (the sweep on ${LAG_BY} picks ${k.pickedLag === null ? 'none' : `${k.pickedLag * 1000} ms`}); quieter tiers: hit ${k.tiers.hit}, tink ${k.tiers.tink}, fele ${k.tiers.fele} LUFS`);
  console.log(`  guns: ${Object.entries(k.guns).map(([name, g]) => `${name} ${g.src} x${g.gain} (M_K ${g.k}, peak ${g.peak})`).join('; ')}; reported: ${Array.isArray(k.reportedGuns) ? k.reportedGuns.join(', ') : k.reportedGuns}`);
  for (const [id, rows] of Object.entries(k.lagSweep)) console.log(`  lag sweep ${id.padEnd(8)} ${rows.map(row => `${row.lag * 1000} ms ${f(row.mean)}${row.eligible ? '' : '*'}`).join('  ')}   (* a gun under +2.5)`);
  for (const [id, c] of Object.entries(k.candidates)) {
    console.log(`\n  ${id}  [${c.report}]  gain ${c.gain}  variantGain ${c.variantGain ? `[${c.variantGain.join(', ')}]` : '-'}  M_K mean ${c.k} (spread ${c.variants.length ? (Math.max(...c.variants.map(v => v.k)) - Math.min(...c.variants.map(v => v.k))).toFixed(2) : '-'} LU)  lowest passing ${c.lowest ?? 'none in range'}${c.edgeFloor !== null && c.edgeFloor !== undefined ? ` (the model ${c.modelLowest ?? 'none'}, Edge's floor ${c.edgeFloor})` : ''}`);
    if (c.measured) console.log(`    measured for ${c.measured.target} LUFS: gain ${c.measured.gain}, variantGain [${c.measured.variantGain.join(', ')}]`);
    if (c.atTop) console.log(`    at K1's top (${c.atTop.k} LUFS, gain about ${c.atTop.gain}): ${Object.entries(c.atTop.k5).map(([name, v]) => `${name} ${f(v.rise)} (${v.audible} ms)`).join('; ')}; mean ${f(c.atTop.riseMean)}`);
    console.log(`    per variant M_K ${c.variants.map(v => v.k.toFixed(2)).join(' ')} | peak ${c.variants.map(v => v.peak.toFixed(1)).join(' ')} | M_flat ${c.variants.map(v => v.flat.toFixed(1)).join(' ')} | M_HP ${c.variants.map(v => v.hp.toFixed(1)).join(' ')}`);
    console.log(`    attack ${c.variants.map(v => v.attack.toFixed(2)).join(' ')} ms | first peak ${c.variants.map(v => v.firstPeak.toFixed(1)).join(' ')} ms | centroid ${c.variants.map(v => v.centroid).join(' ')} Hz (range ${c.spread} %) | body ${c.variants.map(v => v.body.toFixed(1)).join(' ')} | shape ${c.variants.map(v => v.shape.toFixed(1)).join(' ')} | 60 ms ${c.variants.map(v => (v.share60 * 100).toFixed(0)).join(' ')} % | release ${c.variants.map(v => v.clean.toFixed(0)).join(' ')} dB${c.variants[0].third !== undefined ? ` | thirds ${c.variants.map(v => v.third.toFixed(0)).join(' ')} dB down` : ''} | closest r ${c.closest} | ${c.renderMs.join(' ')} ms`);
    console.log(`    K5 at the lag: ${Object.entries(c.k5).map(([name, v]) => `${name} ${f(v.rise)} (worst ${f(v.riseMin)}) ${v.audible} ms (worst ${v.audibleMin})`).join('; ')}; mean ${f(c.riseMean)}`);
    console.log(`    at 44.1 kHz: M_K ${c.at44.variants.map(value => value.toFixed(2)).join(' ')} (spread ${c.at44.spread} LU) | K5 ${Object.entries(c.at44.k5).map(([name, v]) => `${name} ${f(v.rise)} ${v.audible} ms`).join('; ')}; mean ${f(c.at44.riseMean)} | K6 ${Object.values(c.at44.k5).map(v => v.startle).join(', ')} dB${c.at44.k7 ? ` | K7 ${Object.values(c.at44.k7).map(v => f(v.change)).join('/')}` : ''} | fails ${c.at44.failed.join(', ') || 'nothing'}`);
    console.log(`    K6 (crack - gun, 5 ms): ${Object.entries(c.k5).map(([name, v]) => `${name} ${v.startle}`).join(', ')} dB | heavy rate: ${typeof c.heavy === 'string' ? c.heavy : Object.entries(c.heavy).map(([name, v]) => `${name} ${f(v)}`).join(', ')}`);
    console.log(`    reported: ${Object.entries(c.reported).map(([name, v]) => `${name} ${f(v.rise)} (${v.audible} ms)`).join('; ')}`);
    if (c.k7) console.log(`    K7: ${Object.entries(c.k7).map(([key, v]) => `${key} ${f(v.change)}${v.rise === null ? '' : ` (K5 ${f(v.rise)})`}`).join('; ')}`);
    console.log(`    K8: max M_K ${c.k8.k} (K1 + ${c.k8.overK1}), 3 s mean ${c.k8.mean}, trims ${c.k8.trims.join(' ')} dB, sixth ${c.k8.sixth} dB`);
    console.log(`    fails: ${c.failed.join(', ') || 'nothing'}`);
  }
  console.log(`\n  Famille (Part B; 5 renders, noise averaged): ${Object.entries(k.famille).filter(([id]) => id !== 'pick').map(([id, c]) => `${id} M_K ${c.k} M_HP ${c.hp} peak ${c.peak} B2 ${Object.values(c.b2).map(f).join('/')} mean ${f(c.b2Mean)}${c.atFloor ? ` | at B1's floor (x${c.atFloor.scale}): ${Object.values(c.atFloor.b2).map(f).join('/')} mean ${f(c.atFloor.b2Mean)}` : ''}`).join('\n    ')}`);
  for (const [id, c] of Object.entries(k.famille)) if (c.scaledCalls) console.log(`    ${id} at B1's floor: ${c.scaledCalls.join(';')}`);
  console.log(`    provisional default: '${k.famille.pick.pick}' (bois ${f(k.famille.pick.bois)}, pop ${f(k.famille.pick.pop)} dB at ${k.famille.pick.floor} LUFS; by ${k.famille.pick.by} dB); FAMILLE_KILL is ${k.famille.pick.current === null ? 'null' : `'${k.famille.pick.current}'`}`);
}
if (report.themes) {
  console.log('\nThemes (tonal centre, Krumhansl-Kessler on the whole track):');
  if (report.themes.error) console.log(`  ${report.themes.error}`);
  else for (const [theme, entry] of Object.entries(report.themes)) console.log(`  ${theme.padEnd(11)} ${entry.error ?? `${entry.key} (r ${entry.r.toFixed(2)}; next ${entry.second}, r ${entry.r2.toFixed(2)})  strongest ${entry.strongest.join(', ')}  ${entry.seconds} s`}`);
}
console.log(failures.length ? `\n${failures.length} rule(s) failed:\n${failures.map(text => `  - ${text}`).join('\n')}` : '\nEvery rule holds.');
console.log(`Written: ${out}`);
process.exit(failures.length ? 1 : 0);
