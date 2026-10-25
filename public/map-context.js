// Same-origin map routing. Each page keeps one immutable simulation geometry.
export const MAP_ROOTS = Object.freeze({ cabin: '/', supermarket: '/maps/supermarket/', hospital: '/maps/hospital/', funfair: '/maps/funfair/' });
export const MAP_HANDOFF = Object.freeze({ key: 'deadwood-map-handoff-v1', marker: 'deadwood-map-handoff-v1:', version: 1, ttl: 180000, maxChars: 1300000 });
// Room codes name their map: S+5 supermarket, H+5 hospital, F+5 funfair, 6 hex
// digits cabin. F is a hex digit: a funfair code always holds a letter past F
// in its five (server.mjs), so a code of hex digits only is always a cabin's.
const ROOM_CODES = [[/^S[A-Z0-9]{5}$/, 'supermarket'], [/^H[A-Z0-9]{5}$/, 'hospital'], [/^[A-F0-9]{6}$/, 'cabin'], [/^F(?![A-F0-9]{5}$)[A-Z0-9]{5}$/, 'funfair']];
export const mapForRoomCode = code => { const value = String(code).trim().toUpperCase(); return ROOM_CODES.find(([pattern]) => pattern.test(value))?.[1] ?? null; };
const MAP_PREFIXES = Object.values(MAP_ROOTS).filter(root => root !== '/').sort((a, b) => b.length - a.length);
export const mapEndpoint = (path, pathname = globalThis.location?.pathname ?? '/') => (MAP_PREFIXES.find(root => pathname.startsWith(root)) ?? '/') + String(path).replace(/^\/+/, '');
const known = value => Object.hasOwn(MAP_ROOTS, value);
// Only the LAN gateway names its maps (deadwood-maps); online.html keeps these two.
const ONLINE_MAPS = Object.freeze(['cabin', 'supermarket']);
function offeredMaps(content) {
  if (typeof content !== 'string') return ONLINE_MAPS;
  const listed = new Set(content.split(',').map(id => id.trim()));
  const maps = Object.keys(MAP_ROOTS).filter(id => listed.has(id));
  return maps.includes('cabin') ? Object.freeze(maps) : ONLINE_MAPS;
}
function browserStorage(win) { try { return win?.sessionStorage; } catch { return null; } }
export function createMapContext({ document = globalThis.document, location = globalThis.location, window = globalThis.window, storage = browserStorage(window), now = () => Date.now(), mapId = 'cabin' } = {}) {
  const enabled = document?.querySelector?.('meta[name="deadwood-multi-map"]')?.content === 'true';
  const maps = offeredMaps(document?.querySelector?.('meta[name="deadwood-maps"]')?.content), offers = id => maps.includes(id);
  const here = new URL(location?.href ?? 'http://localhost/');
  const active = known(mapId) ? mapId : 'cabin';
  const endpoint = path => mapEndpoint(path, here.pathname);
  const pageUrl = (target, room = null) => { const url = new URL(MAP_ROOTS[known(target) ? target : 'cabin'], here.origin); if (room) url.searchParams.set('room', room); return url; };
  function clear() {
    try { storage?.removeItem(MAP_HANDOFF.key); } catch {}
    try { if (String(window?.name ?? '').startsWith(MAP_HANDOFF.marker)) window.name = ''; } catch {}
  }
  function consumeHandoff() {
    let raw = null;
    try { raw = storage?.getItem(MAP_HANDOFF.key); } catch {}
    if (!raw) try { const value = String(window?.name ?? ''); if (value.startsWith(MAP_HANDOFF.marker)) raw = value.slice(MAP_HANDOFF.marker.length); } catch {}
    clear(); // Consume once, before any asynchronous artwork/network loading.
    if (!enabled || typeof raw !== 'string' || raw.length > MAP_HANDOFF.maxChars) return null;
    try {
      const value = JSON.parse(raw), age = now() - value.at;
      if (value.version !== MAP_HANDOFF.version || value.origin !== here.origin || value.target !== active || !offers(value.target)
        || !Number.isFinite(age) || age < -5000 || age > MAP_HANDOFF.ttl || !['create','join','load','practice'].includes(value.draft?.action)) return null;
      if (typeof value.draft.name !== 'string' || value.draft.name.length > 24 || value.draft.sheet != null && JSON.stringify(value.draft.sheet).length > 4096
        || value.draft.action === 'load' && (typeof value.draft.text !== 'string' || value.draft.text.length > 600000)
        || value.draft.action === 'join' && mapForRoomCode(value.draft.room) !== value.target) return null;
      return value.draft;
    } catch { return null; }
  }
  function navigate(target, draft) {
    if (!enabled || !offers(target) || target === active) return false;
    const value = { version: MAP_HANDOFF.version, at: now(), origin: here.origin, target, draft }, raw = JSON.stringify(value);
    if (raw.length > MAP_HANDOFF.maxChars) return false;
    clear();
    let kept = false;
    try { storage?.setItem(MAP_HANDOFF.key, raw); kept = storage?.getItem(MAP_HANDOFF.key) === raw; } catch {}
    if (!kept) {
      try { window.name = MAP_HANDOFF.marker + raw; kept = window.name === MAP_HANDOFF.marker + raw; } catch {}
    }
    if (!kept) return false;
    const url = pageUrl(target, draft.action === 'join' ? draft.room : null);
    try { location.assign(url.href); return true; } catch { clear(); return false; }
  }
  return Object.freeze({ enabled, active, maps, offers, endpoint, consumeHandoff, navigate,
    socketUrl() { const url = new URL(endpoint('ws'), here.origin); url.protocol = here.protocol === 'https:' ? 'wss:' : 'ws:'; return url.href; },
    shareUrl(origin, room) { const url = new URL(enabled ? MAP_ROOTS[active] : '/', origin); url.searchParams.set('room', room); return url.href; },
  });
}
