// Local measurements only. Selected files are read unchanged; no subjective audition.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SoundEngine } from '../public/audio.js';
import { MINIGUN_TIMING } from '../public/minigun.js';

const root = new URL('../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(new URL(path, root));
const db = value => 20 * Math.log10(Math.max(1e-12, value));
const rounded = value => Number(value.toFixed(4));
const context = { createBuffer(channels, length, sampleRate) {
  const arrays = Array.from({ length: channels }, () => new Float32Array(length));
  return { length, sampleRate, duration: length / sampleRate, numberOfChannels: channels,
    getChannelData: channel => arrays[channel] };
} };

export function decodeWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Expected RIFF PCM WAV');
  let format, pcm;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
    if (name === 'fmt ') format = { codec: bytes.readUInt16LE(offset + 8), channels: bytes.readUInt16LE(offset + 10),
      rate: bytes.readUInt32LE(offset + 12), bits: bytes.readUInt16LE(offset + 22) };
    if (name === 'data') pcm = bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  if (format?.codec !== 1 || format.bits !== 16 || !pcm) throw new Error('Expected PCM16 WAV');
  const buffer = context.createBuffer(format.channels, pcm.length / (2 * format.channels), format.rate);
  for (let channel = 0; channel < format.channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = pcm.readInt16LE((i * format.channels + channel) * 2) / 32768;
  }
  return buffer;
}

export function pcmMetrics(samples, gain = 1) {
  let sum = 0, peak = 0;
  for (const sample of samples) { const value = sample * gain; sum += value * value; peak = Math.max(peak, Math.abs(value)); }
  return { rmsDbfs: rounded(db(Math.sqrt(sum / Math.max(1, samples.length)))), peakDbfs: rounded(db(peak)) };
}

function ebu(samples, rate, gain) {
  const bytes = Buffer.alloc(samples.length * 4);
  for (let i = 0; i < samples.length; i++) bytes.writeFloatLE(samples[i] * gain, i * 4);
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', String(rate), '-ac', '1',
    '-i', 'pipe:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { input: bytes, maxBuffer: 2 ** 21 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.toString());
  const log = result.stderr.toString(), summary = log.slice(log.lastIndexOf('Summary:'));
  const integrated = /I:\s*(-?[\d.]+) LUFS/.exec(summary), peak = /Peak:\s*(-?[\d.]+) dBFS/.exec(summary);
  const moments = [...log.matchAll(/\bM:\s*(-?[\d.]+)/g)].map(match => Number(match[1]));
  if (!integrated || !peak || !moments.length) throw new Error('Cannot parse EBU R128 measurements');
  return { integratedLufs: Number(integrated[1]), maxMomentaryLufs: Math.max(...moments), truePeakDbfs: Number(peak[1]),
    ...pcmMetrics(samples, gain) };
}

export function playbackWindow(kind, entry, buffer, seconds = 6) {
  const engine = new SoundEngine(); engine.ctx = context;
  const rate = buffer.sampleRate;
  if (['rifle','smg','assault','flamethrower'].includes(kind)) {
    const loop = engine.fireLoopBuffer(entry, buffer).getChannelData(0), samples = new Float32Array(Math.round(rate * seconds));
    for (let i = 0; i < samples.length; i++) samples[i] = loop[i % loop.length];
    return { samples, rate, mode: 'sustained-loop', loopSeconds: loop.length / rate };
  }
  if (kind === 'minigunFire') {
    const prepared = engine.minigunFireBuffer(entry, buffer), pcm = prepared.buffer.getChannelData(0);
    const start = Math.round(prepared.loopStart * rate), end = Math.round(prepared.loopEnd * rate),
      first = Math.round(MINIGUN_TIMING.fireOffset * rate), samples = new Float32Array(Math.round(rate * seconds));
    for (let i = 0; i < samples.length; i++) {
      const source = first + i;
      samples[i] = pcm[source < end ? source : start + (source - end) % (end - start)];
    }
    return { samples, rate, mode: 'confirmed-fire-prefix-and-loop', loopSeconds: (end - start) / rate };
  }
  // A short pistol recording needs padding for a 400 ms perceptual window.
  // Retain the complete single event and its natural tail; never compare a
  // 230 ms pistol's invalid integrated LUFS directly with a sustained weapon.
  const samples = new Float32Array(Math.max(buffer.length, Math.round(rate * .8)));
  samples.set(buffer.getChannelData(0));
  return { samples, rate, mode: 'single-complete-event-with-analysis-padding' };
}

export function buildReport() {
  const manifestBytes = read('public/audio/manifest.json'), configBytes = read('validation/audio-mix.json');
  const manifest = JSON.parse(manifestBytes), config = JSON.parse(configBytes), effects = [];
  for (const [kind, gain] of Object.entries(config.effects)) {
    const entries = manifest.effects[kind];
    if (entries?.length !== 1) throw new Error(`Expected one owner-selected ${kind} take`);
    const entry = entries[0];
    if (entry.gain !== gain) throw new Error(`${kind}: manifest gain differs from reproducible mix`);
    const path = `public${entry.src}`, bytes = read(path), buffer = decodeWav(bytes), playback = playbackWindow(kind, entry, buffer);
    const attack = playback.samples.slice(0, Math.round(playback.rate * .4));
    const before = ebu(playback.samples, playback.rate, config.baseline[kind]), after = ebu(playback.samples, playback.rate, gain);
    effects.push({ kind, path, sha256: sha(bytes), sourceSeconds: buffer.duration, playbackMode: playback.mode,
      loopSeconds: playback.loopSeconds, analysisSeconds: playback.samples.length / playback.rate,
      baselineGain: config.baseline[kind], gain, gainChangeDb: rounded(db(gain / config.baseline[kind])),
      before, after, attack400msBefore: ebu(attack, playback.rate, config.baseline[kind]), attack400msAfter: ebu(attack, playback.rate, gain) });
  }
  const byKind = Object.fromEntries(effects.map(effect => [effect.kind, effect]));
  return { date: '2026-10-09', referenceCommit: config.referenceCommit, mediaModified: false, subjectiveListening: false,
    analysis: 'FFmpeg EBU R128 K-weighted integrated/momentary LUFS and oversampled true peak, plus PCM RMS. Actual production loop preparation, six seconds of continuous fire; complete single events with analysis-only silence padding. Playback gains included before the shared compressor and master.',
    mixSha256: sha(configBytes), manifestSha256: sha(manifestBytes), soundEngineSha256: sha(read('public/audio.js')), effects,
    checks: {
      automaticIntegratedSpreadLu: rounded(Math.max(...['rifle', 'smg', 'minigunFire'].map(kind => byKind[kind].after.integratedLufs))
        - Math.min(...['rifle', 'smg', 'minigunFire'].map(kind => byKind[kind].after.integratedLufs))),
      heavyRifleAdvantageOverSmgLu: rounded(byKind.rifle.after.integratedLufs - byKind.smg.after.integratedLufs),
      allIndividualTruePeaksBelowMinus3: effects.every(effect => effect.after.truePeakDbfs <= -3),
      explosionMomentaryAdvantageOverRifleLu: rounded(byKind.explosion.after.maxMomentaryLufs - byKind.rifle.after.maxMomentaryLufs),
    },
    limits: 'No subjective listening or complete-game perceptual approval. Measurements exclude shared browser compressor/master, team overlap, actual event distances, music and loudspeaker/headphone response. A single impact integrated LUFS includes its decay and cannot be directly matched to continuous fire. True peak safety of individual events does not prove mixed-output safety. Short attack comparisons use 400 ms windows; no media are cropped or normalized by this script.' };
}

function markdown(report) {
  const lines = ['# Deadwood — weapon and explosion mix, 9 October 2026', '',
    'Reproduce: `node validation/audio-volume-report.mjs`. Local files only; no generation, network request, media rewrite or model listening.', '',
    '| Effect | Gain before → after | Change dB | Integrated LUFS before → after | Max momentary LUFS before → after | True peak after dBFS |',
    '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const effect of report.effects) lines.push(`| ${effect.kind} | ${effect.baselineGain} → ${effect.gain} | ${effect.gainChangeDb.toFixed(2)} | ${effect.before.integratedLufs.toFixed(1)} → ${effect.after.integratedLufs.toFixed(1)} | ${effect.before.maxMomentaryLufs.toFixed(1)} → ${effect.after.maxMomentaryLufs.toFixed(1)} | ${effect.after.truePeakDbfs.toFixed(1)} |`);
  lines.push('', report.analysis, '', `Automatic-fire integrated spread: **${report.checks.automaticIntegratedSpreadLu} LU**. Machine gun advantage over SMG: **${report.checks.heavyRifleAdvantageOverSmgLu} LU**.`, '', report.limits, '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = buildReport(), stem = new URL('audio-volume-2026-10-09', import.meta.url);
  writeFileSync(fileURLToPath(stem) + '.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync(fileURLToPath(stem) + '.md', markdown(report));
  console.log(JSON.stringify({ checks: report.checks, effects: report.effects.map(effect => ({ kind: effect.kind, gain: effect.gain,
    before: effect.before, after: effect.after, attack400msAfter: effect.attack400msAfter })) }, null, 2));
}
