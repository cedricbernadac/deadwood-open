// A local listening preference: it never changes the room or a teammate's score.
export const MUSIC_THEME_STORAGE = 'deadwood-music-theme';
// The original atmosphere (manifest key 'ambient') is no longer offered: the
// owner found it depressing (24 October). Its file stays as the fallback when a
// chosen track cannot load. Covert Ostinato · B is the default (owner's pick).
export const DEFAULT_MUSIC_THEME = 'covert-b';
export const MUSIC_THEME_CATALOG = Object.freeze({
  'tactical-a': 'tacticalA',
  'tactical-b': 'tacticalB',
  // Owner-supplied Suno tracks of 10 October; A/B is download order, not a ranking.
  'covert-a': 'covertA',
  'covert-b': 'covertB',
  'night-a': 'nightA',
  'night-b': 'nightB',
});
export const isMusicTheme = value => typeof value === 'string' && Object.hasOwn(MUSIC_THEME_CATALOG, value);
export function readMusicTheme(storage) {
  try { const value = (storage ?? globalThis.localStorage)?.getItem(MUSIC_THEME_STORAGE); return isMusicTheme(value) ? value : DEFAULT_MUSIC_THEME; }
  catch { return DEFAULT_MUSIC_THEME; }
}
export function saveMusicTheme(value, storage) {
  if (!isMusicTheme(value)) return false;
  try { (storage ?? globalThis.localStorage)?.setItem(MUSIC_THEME_STORAGE, value); } catch { /* Private browsing can block storage. */ }
  return true;
}
// The music's own level, 1 being exactly the original mix.
export const MUSIC_VOLUME_STORAGE = 'deadwood.musicVolume';
export function readMusicVolume(storage) {
  try { const raw = (storage ?? globalThis.localStorage)?.getItem(MUSIC_VOLUME_STORAGE); const value = Number(raw); return raw && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1; }
  catch { return 1; }
}
export function saveMusicVolume(value, storage) {
  if (!Number.isFinite(value)) return false;
  try { (storage ?? globalThis.localStorage)?.setItem(MUSIC_VOLUME_STORAGE, String(Math.max(0, Math.min(1, value)))); } catch { /* Private browsing can block storage. */ }
  return true;
}
