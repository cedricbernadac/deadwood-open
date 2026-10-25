// The player's side of a manual save (owner, 18 October): the file name, the
// copies kept in this browser, the label of a saved night and the chunks a
// file is uploaded in. The server checks everything again; nothing here is
// trusted by it.
export const SAVE_STORAGE_KEY = 'deadwood-saves-v1';
export const SAVE_KEEP = 5;
export const SAVE_UPLOAD = Object.freeze({ chunkChars: 3000, maxChunks: 200, maxSize: 600000, chunkBytes: 3900 });

const pad = value => String(value).padStart(2, '0');

export function saveFileName(wave, date = new Date()) {
  return `deadwood-vague-${wave}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}h${pad(date.getMinutes())}.json`;
}

// What the menus show of a save; null when the value is not a Deadwood save.
export function saveSummary(save) {
  if (!save || typeof save !== 'object' || Array.isArray(save) || save.format !== 'deadwood-save' || save.version !== 1
    || !Array.isArray(save.players) || !save.players.length || !Number.isInteger(save.wave) || save.wave < 0) return null;
  const players = save.players.filter(player => player && typeof player === 'object' && player.companion !== true && typeof player.name === 'string')
    .map(player => player.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24)).filter(Boolean).slice(0, 4);
  return { ...(typeof save.mapId === 'string' ? { mapId: save.mapId } : {}), ...(typeof save.spaceId === 'string' ? { spaceId: save.spaceId } : {}), wave: save.wave, ambiance: typeof save.ambiance === 'string' ? save.ambiance : 'family',
    difficulty: typeof save.difficulty === 'string' ? save.difficulty : 'normal', players,
    // Friendly fire only marks the nights that had it on; older saves and
    // 'off' keep the summary they always had.
    ...(save.friendlyFire === 'reduced' || save.friendlyFire === 'full' ? { friendlyFire: save.friendlyFire } : {}),
    savedAt: typeof save.savedAt === 'string' ? save.savedAt : null };
}

// Every access may throw (blocked site data, private windows, full quota).
export function readSaves(storage) {
  try {
    const entries = JSON.parse(storage?.getItem(SAVE_STORAGE_KEY) ?? '[]');
    return Array.isArray(entries) ? entries.filter(entry => entry && typeof entry.id === 'string' && saveSummary(entry.save)) : [];
  } catch { return []; }
}

function writeSaves(storage, entries) {
  try { storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(entries)); return true; } catch { return false; }
}

// Newest first, five at most; a full storage drops the oldest copies before
// giving up. Returns whether this browser kept the copy.
export function keepSave(storage, save, { now = new Date(), id = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}` } = {}) {
  const summary = saveSummary(save);
  if (!summary || !storage) return false;
  const entry = { id, ...(summary.mapId ? { mapId: summary.mapId } : {}), ...(summary.friendlyFire ? { friendlyFire: summary.friendlyFire } : {}), savedAt: now.toISOString(), wave: summary.wave, ambiance: summary.ambiance, difficulty: summary.difficulty, players: summary.players, save };
  for (let entries = [entry, ...readSaves(storage).filter(item => item.id !== id)].slice(0, SAVE_KEEP); entries.length; entries = entries.slice(0, -1))
    if (writeSaves(storage, entries)) return true;
  return false;
}

export function forgetSave(storage, id) {
  return writeSaves(storage, readSaves(storage).filter(entry => entry.id !== id));
}

// « 18/10 21:40 » (day first in French, month first in English).
export function saveDateLabel(value, language = 'fr') {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const day = pad(date.getDate()), month = pad(date.getMonth() + 1), time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return language === 'en' ? `${month}/${day} ${time}` : `${day}/${month} ${time}`;
}

// The text in chunks of at most 3000 characters whose JSON form stays well
// under the servers' 4096-byte message limit (quotes and accents grow it).
export function splitSaveText(text, { chunkChars = SAVE_UPLOAD.chunkChars, chunkBytes = SAVE_UPLOAD.chunkBytes } = {}) {
  const encoder = new TextEncoder(), chunks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + chunkChars);
    while (end > start + 1 && encoder.encode(JSON.stringify(text.slice(start, end))).length > chunkBytes) end = start + Math.max(1, Math.floor((end - start) * .8));
    // Never cut a surrogate pair in two.
    const code = text.charCodeAt(end - 1);
    if (end < text.length && end - start > 1 && code >= 0xd800 && code <= 0xdbff) end--;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

// Null when the file is too big for the server to accept.
export function uploadPlan(text) {
  if (typeof text !== 'string' || !text.length || text.length > SAVE_UPLOAD.maxSize) return null;
  const chunks = splitSaveText(text);
  return chunks.length > SAVE_UPLOAD.maxChunks ? null : { size: text.length, chunks };
}

// The file the browser saves: a temporary link, removed at once.
export function downloadText(document, text, name, { Blob = globalThis.Blob, URL = globalThis.URL, later = callback => setTimeout(callback, 1000) } = {}) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.hidden = true;
    document.body.append(link); link.click(); link.remove?.();
    later(() => URL.revokeObjectURL(url));
    return true;
  } catch { return false; }
}
