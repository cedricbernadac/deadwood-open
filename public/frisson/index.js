// The Frisson (15+) pack (art/frisson/DESIGN.md): loaded only by ambiance.js
// for a Frisson room, never in Famille. Each part installs itself and hands
// back its uninstall; they come off in reverse order. The bodies sit on the
// heads' style (art/frisson/BODIES.md), so they install right after them,
// and the markers (art/frisson/MARKERS.md) on top of both. The survivors
// (art/frisson/SURVIVORS.md) come right after the markers, then the weapons
// (art/frisson/WEAPONS.md) and the pickups (art/frisson/PICKUPS.md: the coins
// and the ammo boxes, reusing the weapons' dress program); the cabin's
// surfaces and dressing
// (art/frisson/CABIN.md) follow the night; the feedback
// (art/frisson/UI-SOUND.md: hit bursts, death puff, HUD look and words)
// comes last, after the sounds. ctx.signal
// (leaving, the 20 s fallback, the Famille lock) calls it off: no
// part starts after it, the parts already on come off at once, install
// rejects with its reason (an AbortError), and a part still busy comes off
// as soon as it lands. Nothing of a load called off stays on: not the grim
// night, not a hook, not a zombie or survivor style.
// ctx.variant (ambiance.js FRISSON_VARIANTS) reaches every part as it is:
// heads.js reads its head file, blood.js its share of the blood, pickups.js
// its tier; the other parts ignore it, so Frisson léger is Frisson but for
// those three.
import * as heads from './heads.js';
import * as bodies from './bodies.js';
import * as markers from './markers.js';
import * as survivors from './survivors.js';
import * as weapons from './weapons.js';
import * as pickups from './pickups.js';
import * as atmosphere from './atmosphere.js';
import * as cabin from './cabin.js';
import * as blood from './blood.js';
import * as sounds from './sounds.js';
import * as feedback from './feedback.js';

export const PARTS = Object.freeze([heads, bodies, markers, survivors, weapons, pickups, atmosphere, cabin, blood, sounds, feedback]);
export const HOOKS = Object.freeze(['impact', 'death', 'frame', 'hurt']);

export function install(ctx) { return installParts(ctx, PARTS); }

// A part's install, or the call-off if it comes first. A part that lands
// after the call-off is taken off there and then.
function unlessCalledOff(installing, signal) {
  if (!signal) return installing;
  return new Promise((resolve, reject) => {
    let over = false;
    const stop = () => { if (!over) { over = true; reject(signal.reason); } };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    installing.then(handle => {
      signal.removeEventListener('abort', stop);
      if (!over) { over = true; resolve(handle); return; }
      try { handle?.uninstall?.(); } catch {}
    }, error => {
      signal.removeEventListener('abort', stop);
      if (!over) { over = true; reject(error); }
    });
  });
}

// The parts in order (tests pass their own list around the real parts).
export async function installParts(ctx, parts = PARTS) {
  const signal = ctx.signal ?? null;
  signal?.throwIfAborted();
  // Each part gets its own hook slots; the game's single slots fan out to
  // all of them, so two parts listening to the same moment never clash.
  const slots = [];
  const shared = ctx.hooks ?? {};
  const installed = [];
  const undo = () => {
    signal?.removeEventListener('abort', undo);
    for (const name of HOOKS) if (shared[name]?.frisson) shared[name] = null;
    for (const handle of [...installed].reverse()) try { handle?.uninstall?.(); } catch {}
    installed.length = 0;
  };
  for (const name of HOOKS) {
    const fan = event => { for (const own of slots) if (own[name]) try { own[name](event); } catch {} };
    fan.frisson = true;
    shared[name] = fan;
  }
  signal?.addEventListener('abort', undo, { once: true });
  try {
    for (const part of parts) {
      signal?.throwIfAborted();
      const own = Object.fromEntries(HOOKS.map(name => [name, null]));
      slots.push(own);
      installed.push(await unlessCalledOff(Promise.resolve(part.install({ ...ctx, hooks: own })), signal));
    }
    // Called off as the last part landed: it comes off with the rest.
    signal?.throwIfAborted();
  } catch (error) { undo(); throw error; }
  return { uninstall: undo };
}
