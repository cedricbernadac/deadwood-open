// The Frisson feedback sounds, measured (art/frisson/UI-SOUND.md sections 3
// and 5.1): the jingle's intervals, no major third, brightness, the head
// shot's falling pair, levels L1-L5 against the Famille references, clean
// endings and memory. Every measure is tools/frisson-sound-analysis.mjs, the
// one tools/frisson-sound-render.mjs prints; this file never listens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANDIDATES, createSounds, render } from '../public/frisson/sounds.js';
import {
  RATE, RAFALE, RUNG_COUNTS, DOUBLE, TRIPLE, THIRDS, bandLevel, bandLevels, cents, centroid, chainNotes, ending, engineClass,
  glidingPeaks, instantPitch, levels, offlineRender, onsetPitch, pitch, rafale, resample, rmsMax, scaled, semitones, shortTerm, thirdProbe,
} from '../tools/frisson-sound-analysis.mjs';

const AUDIO = readFileSync(new URL('../public/audio.js', import.meta.url), 'utf8');
// The Famille references, resynthesized from audio.js's own calls (M_K LUFS,
// M_HP and M_flat dB at the engine's output; 14 October 2026), as sounds.md
// gives them. The Rafale's were re-measured once the offline renderer stopped
// playing a sample before its source's start (a false spike at 1.9 s).
const FAMILLE = Object.freeze({
  chain: [[-39.30, -30.63, -30.63], [-38.64, -30.63, -30.63], [-37.82, -30.65, -30.65], [-36.32, -30.18, -30.18], [-35.62, -30.19, -30.19],
    [-34.42, -29.66, -29.66], [-33.02, -28.13, -28.12], [-32.34, -27.74, -27.74], [-31.69, -27.40, -27.40]].map(([k, hp, flat]) => ({ k, hp, flat })),
  headshot: { k: -43.88, hp: -36.77, flat: -36.77 },
  rafale: { k: -35.59, mean: -39.07, flat: -30.17 },
});
const CHAIN = CANDIDATES.chain, FELE = CANDIDATES.headshot.find(made => made.id === 'fele');
const rungs = made => Array.from({ length: 9 }, (_, variant) => ({ rung: variant + 2, variant, data: render('chain', made.id, { variant }) }));
const RENDERS = new Map(CHAIN.map(made => [made.id, rungs(made)]));

test('the measures read what they should on sounds made to measure', () => {
  const tones = notes => { const data = new Float64Array(.6 * RATE); for (const [f, at, tau, level = 1] of notes) for (let i = Math.round(at * RATE); i < data.length; i++) { const t = i / RATE - at; data[i] += level * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / tau); } return data; };
  // A note after a decaying minor third, either way, reads within 5 cents (the window is 50 ms, sounds.md).
  for (const [a, b, gap] of [[0, 3, .065], [3, 0, .1], [0, 6, .08], [7, 3, .1]]) assert.ok(Math.abs(cents(onsetPitch(tones([[pitch(a), 0, .09], [pitch(b), gap, .09]]), RATE, gap), pitch(b))) <= 5, `${a} -> ${b}`);
  // The no-third probe passes a triangle's 5th harmonic (D4's falls on F#6, 28 dB down) and catches a real F#4 20 dB down.
  const triangle = new Float64Array(.3 * RATE);
  for (let i = 0; i < triangle.length; i++) for (let n = 1; n < 30; n += 2) triangle[i] += (n % 4 === 1 ? 1 : -1) / (n * n) * Math.sin(2 * Math.PI * n * pitch(0) * i / RATE);
  assert.ok(Math.min(...bandLevels(triangle, RATE, .1, .2, THIRDS).bands.map(band => band.below)) >= 24);
  const third = tones([[pitch(0), 0, 1], [pitch(7), 0, 1], [pitch(4), 0, 1, .1]]);
  assert.ok(bandLevels(third, RATE, .1, .2, THIRDS).bands.find(band => band.pitch === 369.99).below < 24);
  // Two tones gliding together are read at their starting pitches.
  const glide = new Float64Array(.2 * RATE), phases = [0, 0];
  for (let i = 0; i < glide.length; i++) { const t = i / RATE, g = .944 + .056 * Math.exp(-t / .03); [500, 530].forEach((f, k) => { phases[k] += 2 * Math.PI * f * g / RATE; glide[i] += Math.sin(phases[k]) * Math.exp(-t / .05); }); }
  assert.deepEqual(glidingPeaks(glide, RATE, { ratio: .944, time: .03, seconds: .15, lo: 450, hi: 600 }).map(Math.round), [500, 530]);
});

test('the jingle keeps its intervals: every onset on its note, the double and the triple as the brief gives them', () => {
  for (const made of CHAIN) for (const { rung, data } of RENDERS.get(made.id)) {
    const notes = chainNotes(data, made.id, rung);
    for (const note of notes) assert.ok(Math.abs(note.cents) <= 20, `${made.id} rung ${rung}: ${note.frequency.toFixed(1)} Hz for ${note.target.toFixed(1)} (${note.cents.toFixed(1)} cents)`);
    for (const note of notes) assert.ok(note.frequency <= 880 * 2 ** (20 / 1200), `${made.id} rung ${rung}: no fundamental above A5`);
    const steps = notes.slice(1).map((note, i) => semitones(notes[i].frequency, note.frequency));
    if (rung === 2) assert.ok(Math.abs(steps[0] - DOUBLE[made.id]) <= .25, `${made.id}: double ${steps[0]}`);
    if (rung === 3) TRIPLE[made.id].forEach((want, i) => assert.ok(Math.abs(steps[i] - want) <= .25, `${made.id}: triple ${steps}`));
    // The top note rises with the count (glas: its first, highest stroke);
    // glauque's double and triple share their Ab4 by the brief's own notes.
    if (rung <= 6 && rung > 2) {
      const top = Math.max(...notes.map(note => note.target)), before = Math.max(...chainNotes(RENDERS.get(made.id)[rung - 3].data, made.id, rung - 1).map(note => note.target));
      assert.ok(made.id === 'glauque' && rung === 3 ? top === before : top > before, `${made.id} rung ${rung}: top note`);
    }
  }
});

test('no major third rings in any rung, and every rung stays dark', () => {
  for (const made of CHAIN) for (const { rung, data } of RENDERS.get(made.id)) {
    const probe = thirdProbe(data, made.id, rung);
    assert.ok(probe.margin >= 24, `${made.id} rung ${rung}: ${probe.pitch} Hz only ${probe.margin.toFixed(1)} dB down`);
    const bright = centroid(data, RATE);
    assert.ok(bright <= 1200, `${made.id} rung ${rung}: centroid ${bright.toFixed(0)} Hz`);
  }
});

test('fele is a minor-second pair on G5 and Ab5 that falls at least 70 cents in 60 ms', () => {
  const data = render('headshot', 'fele', { variant: 1 });
  const pair = glidingPeaks(data, RATE, { ratio: .944, time: .03, seconds: .15, lo: 700, hi: 900 });
  assert.equal(pair.length, 2);
  assert.ok(Math.abs(cents(pair[0], pitch(17))) <= 20 && Math.abs(cents(pair[1], pitch(18))) <= 20, `pair ${pair}`);
  const start = instantPitch(data, RATE, .001, .004, 600, 1000), late = instantPitch(data, RATE, .057, .063, 600, 1000);
  assert.ok(-cents(late, start) >= 70, `${start} -> ${late} Hz`);
});

test('the Famille references are audio.js\'s own, as pinned', async () => {
  for (const [i, count] of RUNG_COUNTS.entries()) {
    const measured = levels(await offlineRender(engineClass(AUDIO), engine => engine.chain(count), 1.6));
    for (const key of ['k', 'hp', 'flat']) assert.ok(Math.abs(measured[key] - FAMILLE.chain[i][key]) <= .011, `count ${count} ${key}: ${measured[key]}`);
  }
  const tink = levels(await offlineRender(engineClass(AUDIO), engine => engine.headshot(), .3));
  for (const key of ['k', 'hp', 'flat']) assert.ok(Math.abs(tink[key] - FAMILLE.headshot[key]) <= .011, `tink ${key}: ${tink[key]}`);
  const raf = await offlineRender(engineClass(AUDIO), rafale, 3.5);
  assert.ok(Math.abs(levels(raf).k - FAMILLE.rafale.k) <= .011 && Math.abs(shortTerm(raf) - FAMILLE.rafale.mean) <= .011 && Math.abs(rmsMax(raf) - FAMILLE.rafale.flat) <= .011);
});

test('levels: never louder than Famille, never far below, louder up the ladder, a Rafale no louder, clear of the bed', async () => {
  const bed = bandLevel(scaled(resample(render('ambience', 'veille', { rate: 22050 }), 22050, RATE), CANDIDATES.ambience.find(made => made.id === 'veille').gain));
  for (const made of CHAIN) {
    let below = -Infinity;
    for (const { rung, variant, data } of RENDERS.get(made.id)) {
      const output = scaled(data, made.gain * made.rungGain[variant]), measured = levels(output), ref = FAMILLE.chain[variant];
      assert.ok(measured.k <= ref.k && measured.k >= ref.k - 3, `${made.id} rung ${rung}: M_K ${measured.k.toFixed(2)} for Famille ${ref.k} (L1)`);
      // L2 holds on every rung: no exemption was needed (sounds.md).
      assert.ok(measured.flat <= ref.flat + 1, `${made.id} rung ${rung}: M_flat ${measured.flat.toFixed(2)} (L2)`);
      assert.ok(measured.k >= below, `${made.id} rung ${rung}: quieter than the rung below (L3)`);
      below = measured.k;
      assert.ok(bandLevel(output) - bed >= 12, `${made.id} rung ${rung}: ${(bandLevel(output) - bed).toFixed(2)} dB over the bed (L5)`);
    }
    // L4: counts 2 to 6, .4 s apart, through the engine with the jingle's choke.
    const raf = await offlineRender(engineClass(AUDIO), (engine, ctx) => { engine.setStyle(createSounds(engine, { chain: made.id }).style); rafale(engine, ctx); }, 3.5);
    assert.ok(levels(raf).k <= FAMILLE.rafale.k && shortTerm(raf) <= FAMILLE.rafale.mean && rmsMax(raf) <= FAMILLE.rafale.flat + 1, `${made.id}: Rafale (L4)`);
  }
  assert.deepEqual(RAFALE, [2, 3, 4, 5, 6]);
  for (let variant = 0; variant < FELE.variants; variant++) {
    const measured = levels(scaled(render('headshot', 'fele', { variant }), FELE.gain)), ref = FAMILLE.headshot;
    assert.ok(measured.k <= ref.k && measured.k >= ref.k - 3 && measured.flat <= ref.flat + 1, `fele ${variant}: ${measured.k.toFixed(2)} / ${measured.flat.toFixed(2)}`);
  }
});

test('every new sound renders the same twice, ends at zero, decays before its release, and fits its memory', () => {
  for (const made of CHAIN) {
    let bytes = 0;
    for (const { rung, variant, data } of RENDERS.get(made.id)) {
      assert.deepEqual(render('chain', made.id, { variant }), data, `${made.id} rung ${rung} renders the same`);
      const end = ending(data, RATE);
      assert.ok(end.last === 0); assert.ok(end.below >= 20, `${made.id} rung ${rung}: ${end.below.toFixed(1)} dB down at the release`);
      bytes += Math.round(made.secondsFor(variant) * 48000) * 4;
    }
    assert.ok(bytes <= 2.5e6, `${made.id}: ${bytes} bytes`);
  }
  for (let variant = 0; variant < FELE.variants; variant++) {
    const data = render('headshot', 'fele', { variant }), end = ending(data, RATE);
    assert.deepEqual(render('headshot', 'fele', { variant }), data);
    assert.ok(end.last === 0); assert.ok(end.below >= 20, `fele ${variant}: ${end.below.toFixed(1)} dB`);
  }
});
