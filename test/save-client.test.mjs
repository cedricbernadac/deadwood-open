import test from 'node:test';
import assert from 'node:assert/strict';
import { saveFileName, saveSummary, readSaves, keepSave, forgetSave, saveDateLabel, splitSaveText, uploadPlan, downloadText, SAVE_STORAGE_KEY, SAVE_UPLOAD } from '../public/save-game.js';

const save = (wave = 12, players = [{ name: 'Jules' }, { name: 'Léa' }]) => ({ format: 'deadwood-save', version: 1, wave, ambiance: 'family', difficulty: 'hard', savedAt: '2026-10-18T19:40:00.000Z', players });
function storage({ limit = Infinity, blocked = false } = {}) {
  const values = new Map();
  return { values, getItem(key) { if (blocked) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked || value.length > limit) throw new Error('QuotaExceededError'); values.set(key, value); } };
}

test('the file name, the summary and the label of a saved night', () => {
  assert.equal(saveFileName(7, new Date(2026, 0, 5, 9, 3)), 'deadwood-vague-7-2026-01-05-09h03.json');
  assert.deepEqual(saveSummary(save(12, [{ name: 'Jules' }, { name: 'Max', companion: true }, { name: ' Lé\u0007a ' }])),
    { wave: 12, ambiance: 'family', difficulty: 'hard', players: ['Jules', 'Léa'], savedAt: '2026-10-18T19:40:00.000Z' });
  for (const bad of [null, [], { ...save(), format: 'x' }, { ...save(), version: 2 }, { ...save(), wave: -1 }, { ...save(), wave: 1.5 }, { ...save(), players: [] }, 'deadwood-save'])
    assert.equal(saveSummary(bad), null);
  assert.equal(saveDateLabel(new Date(2026, 9, 18, 21, 40).toISOString()), '18/10 21:40');
  assert.equal(saveDateLabel(new Date(2026, 9, 18, 21, 40).toISOString(), 'en'), '10/18 21:40');
  assert.equal(saveDateLabel('not a date'), '');
});

test('copies in this browser: newest first, five at most, oldest dropped when storage is full, nothing when blocked', () => {
  const kept = storage();
  for (let wave = 1; wave <= 7; wave++) assert.equal(keepSave(kept, save(wave), { id: `w${wave}`, now: new Date(2026, 9, wave) }), true);
  assert.deepEqual(readSaves(kept).map(entry => entry.id), ['w7', 'w6', 'w5', 'w4', 'w3']);
  assert.deepEqual(readSaves(kept)[0].players, ['Jules', 'Léa']);
  assert.equal(forgetSave(kept, 'w6'), true);
  assert.deepEqual(readSaves(kept).map(entry => entry.id), ['w7', 'w5', 'w4', 'w3']);
  // Room for about two entries only: the new one stays, the oldest go.
  const one = JSON.stringify([{ id: 'x', savedAt: new Date(0).toISOString(), wave: 1, ambiance: 'family', difficulty: 'hard', players: ['Jules', 'Léa'], save: save(1) }]).length;
  const tight = storage({ limit: one * 2 + 10 });
  for (let wave = 1; wave <= 4; wave++) keepSave(tight, save(wave), { id: `t${wave}` });
  assert.deepEqual(readSaves(tight).map(entry => entry.id), ['t4', 't3']);
  const blocked = storage({ blocked: true });
  assert.equal(keepSave(blocked, save()), false); assert.deepEqual(readSaves(blocked), []); assert.equal(forgetSave(blocked, 'x'), false);
  assert.equal(keepSave(kept, { not: 'a save' }), false);
  kept.values.set(SAVE_STORAGE_KEY, '{broken');
  assert.deepEqual(readSaves(kept), []);
});

test('uploads split into chunks under both servers’ limits without cutting a character in two', () => {
  const text = 'a'.repeat(2999) + '🌲' + 'b'.repeat(10);
  const chunks = splitSaveText(text);
  assert.equal(chunks.join(''), text);
  assert.equal(chunks[0].length, 2999, 'the pine tree stays whole');
  assert.ok(chunks.every(chunk => chunk.length <= SAVE_UPLOAD.chunkChars));
  const quotes = '"\\'.repeat(5000);
  assert.ok(splitSaveText(quotes).every(chunk => Buffer.byteLength(JSON.stringify(chunk)) <= SAVE_UPLOAD.chunkBytes));
  assert.equal(uploadPlan('x'.repeat(SAVE_UPLOAD.maxSize + 1)), null);
  assert.equal(uploadPlan(''), null);
  assert.deepEqual(uploadPlan('{"a":1}'), { size: 7, chunks: ['{"a":1}'] });
});

test('the download is a temporary link clicked once and released later', () => {
  const calls = [], later = [];
  const link = { click() { calls.push(['click', this.download, this.href]); }, remove() { calls.push(['remove']); } };
  const document = { createElement: tag => (calls.push(['create', tag]), link), body: { append: node => calls.push(['append', node === link]) } };
  class FakeBlob { constructor(parts, options) { this.parts = parts; this.type = options.type; } }
  const FakeURL = { createObjectURL: blob => (calls.push(['url', blob.type, blob.parts.join('')]), 'blob:1'), revokeObjectURL: url => calls.push(['revoke', url]) };
  assert.equal(downloadText(document, '{"a":1}', 'deadwood.json', { Blob: FakeBlob, URL: FakeURL, later: callback => later.push(callback) }), true);
  assert.deepEqual(calls, [['url', 'application/json', '{"a":1}'], ['create', 'a'], ['append', true], ['click', 'deadwood.json', 'blob:1'], ['remove']]);
  later[0]();
  assert.deepEqual(calls.at(-1), ['revoke', 'blob:1']);
  assert.equal(downloadText(document, 'x', 'y', { Blob: FakeBlob, URL: { createObjectURL() { throw new Error('no'); } } }), false);
});
