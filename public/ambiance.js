// The night's ambiance (art/frisson/DESIGN.md). Famille is the game itself.
// Frisson (15+) is an opt-in pack under ./frisson/, and this file is the only
// one that may name that folder: no three, no assets, nothing of the pack is
// fetched until a Frisson room asks for it.
export const FRISSON_BASE = '/frisson/';
// The ambiances drawn with the pack, and what each asks of it (ctx.variant):
// Frisson as it is, and Frisson léger (the owner, 15 October 2026), the same
// pack with the rounder B heads, half the blood and the light pickups. The
// pack accepts only its own head files (heads.js HEAD_FILES). Anything else
// is Famille.
export const FRISSON_VARIANTS = Object.freeze({
  frisson: Object.freeze({ id: 'frisson', heads: 'heads.glb', blood: 1 }),
  'frisson-leger': Object.freeze({ id: 'frisson-leger', heads: 'heads-b.glb', blood: .5, pickups: 'light' }),
});
const variantOf = id => typeof id === 'string' && Object.hasOwn(FRISSON_VARIANTS, id) ? FRISSON_VARIANTS[id] : null;
const importFrisson = () => import('./frisson/index.js'); // relative, no query: one module instance
// A load called off stops its fetches at once and takes itself off when its
// install lands. The next load waits that long for it at most: only a part
// stuck on something else than a fetch can hold it.
export const CALLED_OFF_GRACE_MS = 8000;

async function fetchFrissonAsset(path, signal) {
  const response = await fetch(FRISSON_BASE + path, { signal });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

function uninstall(handle) {
  try { handle?.uninstall?.(); } catch (error) { console.warn('Ambiance:', error); }
}
// Rejects once the load is called off.
function calledOff(signal) {
  const promise = new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  promise.catch(() => {});
  return promise;
}
function settledOrLate(previous, grace) {
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(resolve, grace); });
  return Promise.race([previous.catch(() => {}), late]).finally(() => clearTimeout(timer));
}

// One loader per page. The pack is imported once. Each request takes a
// generation and calls off the one before: the pack in place comes off at
// once; a load on its way has its fetches cut and takes itself off when it
// lands. Installs never overlap (within the grace above). The game's hooks
// are filled only by an install that landed and is still wanted, so a load
// in progress or called off never reaches them.
// Both Frisson ambiances load the same pack, each with its variant; going
// from one to the other takes the pack off and installs it again.
// Results: { id: 'family' | 'frisson' | 'frisson-leger', stale?, undone?,
// failed?, error? }; undone: a load called off had begun installing and is
// now off again.
export function createAmbianceLoader({ grace = CALLED_OFF_GRACE_MS } = {}) {
  let generation = 0, controller = null, active = null, pack = null, previous = Promise.resolve();
  async function install(token, signal, ctx, importer, variant) {
    if (token !== generation) return { id: 'family', stale: true };
    const off = calledOff(signal), hooks = ctx.hooks ?? null;
    const own = hooks ? Object.fromEntries(Object.keys(hooks).map(name => [name, null])) : undefined;
    const fetcher = ctx.fetchAsset ?? fetchFrissonAsset;
    const fetchAsset = path => signal.aborted ? Promise.reject(signal.reason)
      : Promise.race([new Promise(resolve => resolve(fetcher(path, signal))), off]);
    let begun = false;
    try {
      pack ??= Promise.resolve(importer()).catch(error => { pack = null; throw error; });
      const module = await Promise.race([pack, off]);
      if (token !== generation) return { id: 'family', stale: true };
      begun = true;
      const handle = await module.install({ base: FRISSON_BASE, ...ctx, variant, hooks: own, signal, fetchAsset });
      if (token !== generation) { uninstall(handle); return { id: 'family', stale: true, undone: true }; }
      if (hooks) for (const name in own) hooks[name] = own[name];
      active = { id: variant.id, handle, hooks, own };
      return { id: variant.id };
    } catch (error) {
      if (token !== generation) return { id: 'family', stale: true, ...(begun ? { undone: true } : {}) };
      // Famille is the safe direction: the caller says so with a toast.
      console.warn('Ambiance Frisson:', error);
      return { id: 'family', failed: true, error };
    }
  }
  function apply(id, ctx = {}, importer = importFrisson) {
    const variant = variantOf(id);
    if (variant && active?.id === variant.id) return Promise.resolve({ id: variant.id });
    const token = ++generation;
    controller?.abort(); controller = null;
    if (active) {
      const { handle, hooks, own } = active;
      active = null;
      if (hooks) for (const name in own) hooks[name] = null;
      uninstall(handle);
    }
    // Famille is answered once a load called off has landed (or the grace
    // ran out): nothing of it is left on when the caller goes ahead.
    if (!variant) return settledOrLate(previous, grace).then(() => token === generation ? { id: 'family' } : { id: 'family', stale: true });
    const { signal } = controller = new AbortController();
    const run = settledOrLate(previous, grace).then(() => install(token, signal, ctx, importer, variant));
    previous = run;
    return run;
  }
  return { apply, get id() { return active?.id ?? 'family'; } };
}

const loader = createAmbianceLoader();
export function applyAmbiance(id, ctx, importer) { return loader.apply(id, ctx, importer); }
