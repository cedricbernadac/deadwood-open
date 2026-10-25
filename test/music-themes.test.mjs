import assert from 'node:assert/strict';
import test from 'node:test';
import { MUSIC_THEME_STORAGE, DEFAULT_MUSIC_THEME, readMusicTheme, saveMusicTheme } from '../public/music-themes.js';

test('music preference defaults to the owner\'s pick and accepts only known local choices', () => {
  for (const saved of [null, 'tactical', 'TACTICAL-A', '__proto__', 'https://music.example/theme.mp3', 'original']) {
    assert.equal(readMusicTheme({ getItem: () => saved }), DEFAULT_MUSIC_THEME);
  }
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  for (const choice of ['tactical-a', DEFAULT_MUSIC_THEME, 'night-b']) {
    assert.equal(saveMusicTheme(choice, storage), true);
    assert.equal(values.get(MUSIC_THEME_STORAGE), choice);
    assert.equal(readMusicTheme(storage), choice);
  }
  for (const refused of ['unknown', 'original']) assert.equal(saveMusicTheme(refused, storage), false, refused);
  assert.equal(readMusicTheme(storage), 'night-b', 'a refused choice leaves the saved one in place');
});

test('blocked browser storage keeps music usable on the default theme', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readMusicTheme(blocked), DEFAULT_MUSIC_THEME);
  assert.equal(saveMusicTheme('tactical-b', blocked), true);
  assert.equal(saveMusicTheme(null, blocked), false);
});

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MUSIC_THEME_CATALOG } from '../public/music-themes.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('public/audio/manifest.json'));
const themes = Object.entries(MUSIC_THEME_CATALOG);

test('the catalogue lists the six owner-chosen tracks, each with its own manifest key, and no longer the original', () => {
  assert.deepEqual(themes.map(([theme]) => theme), ['tactical-a', 'tactical-b', 'covert-a', 'covert-b', 'night-a', 'night-b']);
  assert.equal(Object.hasOwn(MUSIC_THEME_CATALOG, 'original'), false);
  assert.equal(Object.values(MUSIC_THEME_CATALOG).includes('ambient'), false, 'the original atmosphere is a fallback, not a choice');
  assert.ok(Object.hasOwn(MUSIC_THEME_CATALOG, DEFAULT_MUSIC_THEME), 'the default is one of the offered tracks');
  assert.equal(new Set(Object.values(MUSIC_THEME_CATALOG)).size, themes.length);
});

test('every theme and the kept original fallback have a local track whose playback level matches the original atmosphere', { skip: 'needs the art and audio originals, kept out of the open edition' }, () => {
  const report = JSON.parse(read('validation/music-themes-2026-10-10.json'));
  const reference = report.tracks.find(track => track.key === 'ambient').afterIntegratedLufs;
  // 'ambient' is no longer offered but still ships: it plays when a chosen track cannot load.
  for (const [theme, key] of [...themes, ['original fallback', 'ambient']]) {
    const entry = manifest.music[key];
    assert.match(entry?.src ?? '', /^\/audio\/[a-z0-9-]+\.mp3$/, theme);
    assert.ok(existsSync(new URL(`../public${entry.src}`, import.meta.url)), `${theme}: file present`);
    assert.ok(entry.gain > 0 && entry.gain <= .22, `${theme}: gain ${entry.gain}`);
    const measured = report.tracks.find(track => track.key === key);
    assert.equal(measured.gain, entry.gain, `${theme}: report measured the shipped gain`);
    assert.ok(Math.abs(measured.afterIntegratedLufs - reference) < .2, `${theme}: ${measured.afterIntegratedLufs} LUFS`);
    const bytes = readFileSync(new URL(`../public${entry.src}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), measured.sha256, `${theme}: report matches the shipped file`);
  }
  for (const key of Object.keys(manifest.music)) assert.ok(['ambient', 'brute', 'finale'].includes(key) || Object.values(MUSIC_THEME_CATALOG).includes(key), key);
});

test('both in-game selectors and the audio preview offer exactly the catalogue, in both languages', async () => {
  const html = read('public/index.html'), preview = read('public/audio-preview.html');
  for (const id of ['music-theme', 'pause-music-theme']) {
    const select = new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(html)[1];
    const options = [...select.matchAll(/<option value="([^"]+)" data-i18n="([^"]+)">/g)].map(([, value, key]) => [value, key]);
    assert.deepEqual(options, themes.map(([theme, key]) => [theme, `music.${key}`]), id);
  }
  const previewThemes = [...preview.matchAll(/<button type="button" data-mode="ambient" data-theme="([^"]+)" aria-pressed="false" data-preview-text="([^"]+)">/g)].map(([, theme, key]) => [theme, key]);
  assert.deepEqual(previewThemes, themes, 'the preview offers exactly the catalogue, each button wired as a theme');
  const i18n = read('public/i18n.js');
  for (const [theme, key] of themes) {
    assert.match(i18n, new RegExp(`'music\\.${key}': \\['[^']+', '[^']+'\\]`), `${key}: French and English labels`);
    assert.match(preview, new RegExp(`data-theme="${theme}"[^>]*data-preview-text="${key}"`), `${theme}: preview button`);
    assert.match(preview, new RegExp(`${key}:'[^']+'`), `${key}: English preview label`);
  }
});

test('the four tracks added on 10 October keep their exact Suno identity, file and take order', { skip: 'needs the art and audio originals, kept out of the open edition' }, () => {
  const provenance = JSON.parse(read('validation/audio-provenance.json'));
  const expected = {
    covertA: ['covert_a', 'Covert Ostdinato.mp3', 'Covert Ostdinato', '094e6f62-4322-445d-b0ac-fff3ad82d96c', 'A'],
    covertB: ['covert_b', 'Covert Ostinato.mp3', 'Covert Ostinato', '21ca2ffb-3554-4666-8760-cc0fb79af3d9', 'B'],
    nightA: ['night_a', 'Night Resolve.mp3', 'Night Resolve', '629bd7da-ce85-47f2-97db-ff5b93cff484', 'A'],
    nightB: ['night_b', 'Night Resolve (1).mp3', 'Night Resolve', '1ebbcf2f-035e-4126-b301-3b3472b477ae', 'B'],
  };
  for (const [key, [sourceKey, filename, title, id, take]] of Object.entries(expected)) {
    const source = provenance.sources[sourceKey];
    assert.equal(source.filename, filename);
    assert.equal(source.id3Title, title, 'the Suno title is kept as written');
    assert.equal(source.sourceId, id);
    assert.match(source.identityEvidence.comment, new RegExp(`id=${id}`));
    assert.equal(source.take, take);
    const original = readFileSync(new URL(`../${source.originalPath}`, import.meta.url));
    assert.equal(createHash('sha256').update(original).digest('hex'), source.sha256, `${filename}: preserved original`);
    const output = provenance.outputs.find(item => item.usage === key);
    assert.equal(output.sourceKey, sourceKey);
    assert.equal(`/${output.path.replace(/^public\//, '')}`, manifest.music[key].src);
    assert.ok(Math.abs(output.sourceDurationSeconds - source.duration) < .2, `${key}: complete track, not cropped`);
  }
  for (const output of provenance.outputs.filter(item => item.path.endsWith('.mp3'))) {
    const reached = Math.abs(output.decodedPeakDbfs + 3) < .035;
    assert.equal(/normalized to -3 dBFS/.test(output.processing), reached, `${output.usage}: the peak claim matches ${output.decodedPeakDbfs} dBFS`);
    assert.equal(output.clippedSampleCount, 0);
  }
  assert.doesNotMatch(provenance.ownerMusicImport.processing, /decoded peak -3 dBFS/);
  // originalRemainsDefault records the 10 October import and stays as written.
  // The rule since 24 October: the default is the owner's pick among his tracks.
  const defaultKey = MUSIC_THEME_CATALOG[DEFAULT_MUSIC_THEME], defaultTrack = provenance.ownerMusicImport.tracks[defaultKey];
  assert.ok(defaultTrack, `${DEFAULT_MUSIC_THEME}: an owner-supplied track`);
  assert.deepEqual([defaultTrack.id3Title, defaultTrack.take], ['Covert Ostinato', 'B'], 'the owner chose Covert Ostinato · B on 24 October');
  assert.equal(`/${defaultTrack.export.replace(/^public\//, '')}`, manifest.music[defaultKey].src, 'the default plays the imported file');
  assert.equal(provenance.ownerMusicImport.agentGenerations, 0);
});

test('the original atmosphere is no longer offered anywhere, and a saved "original" plays the default', () => {
  // The owner on 24 October: the original theme is too gloomy; Covert Ostinato · B replaces it as the default.
  for (const page of ['public/index.html', 'public/online.html']) {
    const html = read(page);
    for (const id of ['music-theme', 'pause-music-theme']) {
      const select = new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(html)?.[1];
      assert.ok(select, `${page}: #${id}`);
      const values = [...select.matchAll(/<option value="([^"]+)"/g)].map(([, value]) => value);
      assert.deepEqual(values, Object.keys(MUSIC_THEME_CATALOG), `${page}: #${id} offers exactly the catalogue`);
      assert.doesNotMatch(select, /value="original"|music\.original/, `${page}: #${id}`);
    }
  }
  const preview = read('public/audio-preview.html');
  assert.doesNotMatch(preview, /data-theme="original"/, 'the preview has no button for the original');
  assert.doesNotMatch(preview, /ambiance originale reste le choix par défaut|original atmosphere remains the default/i, 'the preview note no longer calls it the default');
  const stored = new Map([[MUSIC_THEME_STORAGE, 'original']]);
  assert.equal(readMusicTheme({ getItem: key => stored.get(key) }), DEFAULT_MUSIC_THEME, 'an old saved preference falls back to the default');
  assert.equal(DEFAULT_MUSIC_THEME, 'covert-b');
});
