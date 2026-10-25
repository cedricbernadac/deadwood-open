// Impact numbers (owner, 18 October): one number per impact, the score that
// hit earned, which is the damage it really dealt. The server sends each
// survivor their own, and only theirs, already grouped per enemy and per
// tick (shotgun pellets, simultaneous hits) and burns in at most four
// batches a second. Here they are merged a little more, capped and drawn:
// no collision, damage or score is worked out in the browser.
export const IMPACT_NUMBERS_KEY = 'deadwood-impact-numbers-v1';
export const IMPACT_NUMBERS_DEFAULT = true;
// The setting replaces the opt-in « Dégâts à l'impact » and the score half
// of « Score et pièces qui s'envolent » (feedback-hud.js, `scorePopups`).
export const LEGACY_DAMAGE_NUMBERS_KEY = 'deadwood-damage-numbers-v1';
export const LEGACY_FEEDBACK_KEY = 'deadwood-feedback-v1';
export const MAX_DAMAGE_NUMBERS = 12;
export const DAMAGE_NUMBER_LIFETIME = 750;
// Automatic fire (a hit every 55-130 ms) keeps adding to the enemy's newest
// number while hits keep coming (at most this far apart) and the number is
// still young: one number for each burst of about half a second, never a
// pile of them at one spot.
export const DAMAGE_MERGE_WINDOW = 200;
export const DAMAGE_MERGE_AGE = 450;
// Held flames and burns hit a body eight times a second: their number on it
// keeps adding up a little longer, so one body never stacks three of them.
export const CONTINUOUS_MERGE_WINDOW = 400;
// The server's record flags (simulation.mjs takeImpactNumbers); a burn
// batch (8) is continuous fire too. A rocket's blast (16) is resolved at
// once by the server: its number waits for the visible rocket (client.js).
export const IMPACT_FLAGS = Object.freeze({ headshot: 1, continuous: 2, killed: 4, burn: 8, rocket: 16 });
// 16 px for a scratch, 28 px from about a thousand points; smaller screens
// shrink it down to three quarters.
export const DAMAGE_FONT = Object.freeze({ min: 16, max: 28, perDecade: 4 });
// How a number that does not fly rises and fades: [share of its life,
// pixels up, scale, opacity]. Concave (fastest first), so a number that
// starts above another on the same enemy only draws away from it.
export const DAMAGE_RISE = Object.freeze([[0, 0, .8, 1], [.2, 18, 1.08, 1], [.6, 30, 1, .9], [1, 40, .95, 0]].map(Object.freeze));
// The smallest gap kept between two numbers on one enemy, in pixels.
export const DAMAGE_NUMBER_GAP = 6;
const MAX_RISE_SCALE = Math.max(...DAMAGE_RISE.map(step => step[2]));
const RISE_FRAMES = DAMAGE_RISE.map(([offset, up, size, opacity]) =>
  ({ transform: `translate(-50%,-50%) translateY(${-up}px) scale(${size})`, opacity, offset }));

// Pixels risen and scale `age` ms into a rising number's life.
export function damageRise(age) {
  const share = Math.min(1, Math.max(0, age / DAMAGE_NUMBER_LIFETIME));
  for (let index = 1; index < DAMAGE_RISE.length; index++) {
    const [from, up, size] = DAMAGE_RISE[index - 1], [to, nextUp, nextSize] = DAMAGE_RISE[index];
    if (share > to && index < DAMAGE_RISE.length - 1) continue;
    const blend = to > from ? (share - from) / (to - from) : 1;
    return { up: up + (nextUp - up) * blend, scale: size + (nextSize - size) * blend };
  }
  return { up: 0, scale: 1 };
}

// The stored choice, else the first run of this setting. Someone who had
// turned the old « Dégâts à l'impact » on (an opt-in, off by default) chose
// these numbers: they stay on. Otherwise someone who had explicitly turned
// the flying score off keeps the numbers off; that opt-out is written down
// at once, so a later change of the coin setting (which took over the old
// field) can never flip it. Nothing is stored otherwise until the player
// changes the setting.
export function loadImpactNumbersSetting(storage) {
  let saved = null;
  try { saved = storage?.getItem?.(IMPACT_NUMBERS_KEY) ?? null; } catch { return IMPACT_NUMBERS_DEFAULT; }
  if (saved === '1' || saved === '0') return saved === '1';
  let damageOptIn = null;
  try { damageOptIn = storage?.getItem?.(LEGACY_DAMAGE_NUMBERS_KEY) ?? null; } catch {}
  if (damageOptIn === '1') return true;
  let legacy = null;
  try { legacy = JSON.parse(storage?.getItem?.(LEGACY_FEEDBACK_KEY) ?? 'null'); } catch {}
  if (!(legacy && typeof legacy === 'object' && legacy.scorePopups === false)) return IMPACT_NUMBERS_DEFAULT;
  try { storage?.setItem?.(IMPACT_NUMBERS_KEY, '0'); } catch {}
  return false;
}

// A server batch -> safe records; anything malformed is dropped.
export function impactRecords(batch) {
  const list = Array.isArray(batch) ? batch : Array.isArray(batch?.impacts) ? batch.impacts : [];
  const records = [];
  for (const item of list.slice(0, 64)) {
    if (!Array.isArray(item)) continue;
    const [zombieId, x, y, z, amount, flags = 0] = item;
    if (typeof zombieId !== 'string' || ![x, y, z].every(Number.isFinite) || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(flags)) continue;
    records.push({ zombieId, x, y, z, amount: Math.round(amount), headshot: (flags & IMPACT_FLAGS.headshot) !== 0,
      continuous: (flags & (IMPACT_FLAGS.continuous | IMPACT_FLAGS.burn)) !== 0, killed: (flags & IMPACT_FLAGS.killed) !== 0,
      rocket: (flags & IMPACT_FLAGS.rocket) !== 0 });
  }
  return records;
}

export const damageText = amount => String(Math.max(0, Math.round(amount)));
export const damageFontSize = (amount, scale = 1) => {
  const size = Math.min(DAMAGE_FONT.max, DAMAGE_FONT.min + Math.log10(1 + Math.max(0, amount)) * DAMAGE_FONT.perDecade);
  return Math.round(size * Math.min(1, Math.max(.75, Number.isFinite(scale) ? scale : 1)) * 10) / 10;
};

// `target`: the score counter a killing blow's number flies to (when
// `canFly()`); `frames(flight)`: the flight's keyframes (feedback-hud.js);
// `onLand`: it arrived. Every other number rises and fades where it hit.
// `variant` adds a class (damage-<variant>) and `sign` a prefix to every
// number: friendly fire's red « −6 » over a teammate (client.js).
export function createDamageNumbers({ document, layer, storage = null, now = () => performance.now(),
  target = null, frames = null, scale = () => 1, canFly = () => true, onLand = () => {}, onChange = () => {}, variant = '', sign = '' }) {
  let enabled = loadImpactNumbersSetting(storage);
  const entries = [];
  let createdAt = -Infinity, created = 0;
  function creationRoom(at) { if (at - createdAt >= DAMAGE_MERGE_WINDOW) { createdAt = at; created = 0; } return created < MAX_DAMAGE_NUMBERS; }
  const remove = entry => { entry.animation?.cancel?.(); entry.pulse?.cancel?.(); entry.element.remove(); const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1); };
  function clear() { while (entries.length) remove(entries[0]); createdAt = -Infinity; created = 0; }
  function setEnabled(value) {
    enabled = value === true;
    if (!enabled) clear();
    try { storage?.setItem?.(IMPACT_NUMBERS_KEY, enabled ? '1' : '0'); } catch {}
    onChange(enabled);
  }
  function bindSettings(control) {
    if (!control) return;
    control.checked = enabled;
    control.addEventListener('change', () => setEnabled(control.checked));
  }
  function update() {
    const at = now();
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (at < entry.expires) continue;
      if (entry.flying) { try { onLand(); } catch {} }
      remove(entry);
    }
  }
  const flightTo = (x, y) => {
    let rect = null;
    try { rect = target?.getBoundingClientRect?.() ?? null; } catch {}
    return rect && rect.width > 0 ? { dx: rect.left + rect.width / 2 - x, dy: rect.top + rect.height / 2 - y } : null;
  };
  // A rise in place, or, for a killing blow, the arc to the score counter.
  function animate(entry, at) {
    entry.animation?.cancel?.();
    entry.animation = null;
    const flight = entry.killed && canFly() ? flightTo(entry.x, entry.y) : null;
    entry.flying = flight !== null;
    entry.started = at; entry.expires = at + DAMAGE_NUMBER_LIFETIME;
    if (typeof entry.element.animate !== 'function') return;
    let keyframes = null;
    if (flight) try { keyframes = frames?.(flight) ?? null; } catch {}
    keyframes ??= RISE_FRAMES.map(frame => ({ ...frame }));
    entry.animation = entry.element.animate(keyframes, { duration: DAMAGE_NUMBER_LIFETIME, fill: 'forwards' }) ?? null;
  }
  // A hit added to a number on screen: a short swell of its size, where it is.
  function pulse(entry) {
    if (typeof entry.element.animate !== 'function') return;
    entry.pulse?.cancel?.();
    entry.pulse = entry.element.animate([{ fontSize: `${Math.round(entry.size * 1.22 * 10) / 10}px` }, { fontSize: `${entry.size}px` }],
      { duration: 140, easing: 'ease-out' }) ?? null;
  }
  // A rising number's box (centre and height, in pixels) `age` ms into its life.
  const boxAt = (entry, age) => { const { up, scale: size } = damageRise(age); return { y: entry.y - up, height: entry.size * size }; };
  // Would a number of `size` px starting now at `startY` stay clear of
  // `entry` (same enemy) for as long as both are on screen?
  function staysClear(entry, startY, size, at) {
    const age = at - entry.started, left = Math.min(DAMAGE_NUMBER_LIFETIME, entry.expires - at);
    for (let elapsed = 0; ; elapsed = Math.min(left, elapsed + 10)) {
      const mine = boxAt({ y: startY, size }, elapsed), theirs = boxAt(entry, age + elapsed);
      if (Math.abs(mine.y - theirs.y) < (mine.height + theirs.height) / 2 + DAMAGE_NUMBER_GAP) return false;
      if (elapsed >= left) return true;
    }
  }
  // Where a new number on an enemy starts: at its impact, unless that would
  // run into one of the enemy's numbers still rising there; then the lowest
  // spot just above one of them that stays clear of all.
  function startY(zombieId, y, size, at) {
    const others = entries.filter(entry => entry.target === zombieId && !entry.flying && at < entry.expires);
    if (!others.length) return y;
    const spots = [y, ...others.map(entry => boxAt(entry, at - entry.started).y - (entry.size + size) * MAX_RISE_SCALE / 2 - DAMAGE_NUMBER_GAP)]
      .filter(spot => spot <= y).sort((a, b) => b - a);
    return spots.find(spot => others.every(entry => staysClear(entry, spot, size, at))) ?? spots.at(-1);
  }
  // The enemy's newest number that can still take this record.
  function mergeTarget(record, at) {
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (entry.target !== record.zombieId || at >= entry.expires) continue;
      const young = entry.continuous && record.continuous ? at - entry.born < CONTINUOUS_MERGE_WINDOW
        : at - entry.merged < DAMAGE_MERGE_WINDOW && at - entry.born < DAMAGE_MERGE_AGE;
      return young ? entry : null;
    }
    return null;
  }
  function classes(entry) {
    return `damage-number${variant ? ` damage-${variant}` : ''}${entry.headshot ? ' damage-headshot' : ''}${entry.continuous ? ' damage-continuous' : ''}${entry.killed ? ' damage-kill' : ''}`;
  }
  // Records of one batch for this survivor; `project(record)` is its screen
  // point, or null off screen (never moved to the crosshair).
  function addImpacts(batch, project) {
    if (!enabled || !layer) return;
    update();
    for (const record of impactRecords(batch)) {
      const at = now();
      const previous = mergeTarget(record, at);
      if (previous) {
        previous.amount += record.amount; previous.merged = at;
        previous.size = damageFontSize(previous.amount, scale());
        previous.element.textContent = sign + damageText(previous.amount);
        previous.element.style.fontSize = `${previous.size}px`;
        const killed = record.killed && !previous.killed;
        previous.headshot ||= record.headshot; previous.killed ||= record.killed; previous.continuous &&= record.continuous;
        previous.element.className = classes(previous);
        if (killed) animate(previous, at); else if (record.amount > 0) pulse(previous);
        continue;
      }
      if (!(record.amount > 0) || !creationRoom(at)) continue;
      let point = null;
      try { point = project(record); } catch {}
      if (!point || ![point.x, point.y].every(Number.isFinite)) continue;
      created++;
      if (entries.length >= MAX_DAMAGE_NUMBERS) remove(entries[0]);
      const element = document.createElement('span'), size = damageFontSize(record.amount, scale());
      const entry = { element, target: record.zombieId, amount: record.amount, headshot: record.headshot, continuous: record.continuous,
        killed: record.killed, x: point.x + 14, y: startY(record.zombieId, point.y - 10, size, at), size,
        born: at, merged: at, started: at, expires: at + DAMAGE_NUMBER_LIFETIME, flying: false, animation: null, pulse: null };
      element.className = classes(entry);
      element.textContent = sign + damageText(record.amount);
      element.style.left = `${entry.x}px`; element.style.top = `${entry.y}px`;
      element.style.fontSize = `${size}px`;
      layer.append(element);
      entries.push(entry);
      animate(entry, at);
    }
  }
  // Each number's box now (centre, height): for tests and diagnostics.
  function boxes() {
    const at = now();
    return entries.filter(entry => at < entry.expires).map(entry => ({ target: entry.target, x: entry.x, flying: entry.flying, text: entry.element.textContent,
      ...(entry.flying ? { y: entry.y, height: entry.size } : boxAt(entry, at - entry.started)) }));
  }
  return { get enabled() { return enabled; }, get count() { return entries.length; }, bindSettings, setEnabled, addImpacts, clear, update, boxes };
}
