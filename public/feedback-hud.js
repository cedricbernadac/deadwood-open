// Combat feedback HUD: tiered hit marker, flying coins and bonuses, kill-chain
// banner and teammate chain feed. Plain DOM only; translations are injected
// as t so the module stays testable without i18n or three.js. Since the
// score became the damage dealt (owner, 18 October), kills no longer pop a
// score: each impact shows its own number (damage-numbers.js); the flight
// below now carries the coins and the end-of-wave revive bonuses.
export const FEEDBACK_SETTINGS_KEY = 'deadwood-feedback-v1';
// `coinPopups` was `scorePopups` (« Score et pièces qui s'envolent »): a
// stored value of the old name still decides the coins.
export const FEEDBACK_DEFAULTS = Object.freeze({ shake: 1, coinPopups: true });
// friendly: the local shot hurt a teammate (friendly fire): it outranks any
// zombie marker of the same moment, the warning matters more.
export const HIT_TIERS = Object.freeze({ hit: 1, headshot: 2, kill: 3, headshotKill: 4, friendly: 5 });
export const HIT_DURATIONS = Object.freeze({ hit: 140, headshot: 220, kill: 300, headshotKill: 380, friendly: 450 }); // ms
export const MAX_SCORE_POPUPS = 8;
export const CHAIN_DURATION = 1300;      // ms, local banner
export const TEAM_CHAIN_DURATION = 2600; // ms, teammate feed line
export const MAX_TEAM_LINES = 3;

const POPUP_DURATION = 950; // ms, matches the WAAPI keyframes below
const BUMP_DURATION = 260;  // ms, score readout pulse when a popup lands

// Any input -> safe settings; invalid fields fall back to the defaults one by one.
export function normalizeFeedbackSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const shake = typeof source.shake === 'number' && Number.isFinite(source.shake)
    ? Math.round(Math.min(1, Math.max(0, source.shake)) * 20) / 20
    : FEEDBACK_DEFAULTS.shake;
  const coinPopups = typeof source.coinPopups === 'boolean' ? source.coinPopups
    : typeof source.scorePopups === 'boolean' ? source.scorePopups : FEEDBACK_DEFAULTS.coinPopups;
  return { shake, coinPopups };
}

// The flight to a counter: up first, then along the edge of the screen so it
// never crosses the crosshair; without a counter, it rises and fades.
export function popupKeyframes(flight, rise = 'translate(-50%,-50%) translateY(-30px)') {
  return flight ? [
    { transform: 'translate(-50%,-50%) scale(.6)', opacity: 1, offset: 0, easing: 'ease-out' },
    { transform: `${rise} scale(1.15)`, opacity: 1, offset: .12, easing: 'ease-out' },
    { transform: `${rise} scale(1)`, opacity: 1, offset: .4, easing: 'ease-in' },
    { transform: `translate(-50%,-50%) translate(${flight.dx * .2}px,${flight.dy * .75}px) scale(.7)`, opacity: .8, offset: .72, easing: 'ease-out' },
    { transform: `translate(-50%,-50%) translate(${flight.dx}px,${flight.dy}px) scale(.45)`, opacity: .25, offset: 1 },
  ] : [
    { transform: 'translate(-50%,-50%) scale(.6)', opacity: 1, offset: 0, easing: 'ease-out' },
    { transform: `${rise} scale(1.15)`, opacity: 1, offset: .12, easing: 'ease-out' },
    { transform: `${rise} scale(1)`, opacity: 1, offset: .4, easing: 'ease-in' },
    { transform: 'translate(-50%,-50%) translateY(-46px) scale(.9)', opacity: 0, offset: 1 },
  ];
}

// Storage is optional and may refuse every call (private mode): never throw.
export function loadFeedbackSettings(storage) {
  try {
    const raw = storage?.getItem?.(FEEDBACK_SETTINGS_KEY);
    return normalizeFeedbackSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...FEEDBACK_DEFAULTS };
  }
}

export function saveFeedbackSettings(storage, settings) {
  try { storage?.setItem?.(FEEDBACK_SETTINGS_KEY, JSON.stringify(normalizeFeedbackSettings(settings))); } catch {}
}

// The kill-chain ladder (owner request, 12 October): every kill is named up
// to 6, then a new, stronger name comes only at these steps, so a 30-kill
// gatling spree reads very differently from a 6-kill one. Past the last step
// its name comes back every CHAIN_REPEAT kills.
export const CHAIN_STEPS = Object.freeze([2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100]);
export const CHAIN_REPEAT = 50;
export const CHAIN_COUNT_FROM = 5; // the banner shows the count once the name no longer says it

export function chainStep(count) {
  if (!Number.isFinite(count) || count < 2) return null;
  const whole = Math.floor(count);
  let step = null;
  for (const value of CHAIN_STEPS) if (value <= whole) step = value;
  return step;
}

export function chainLabelKey(count) {
  const step = chainStep(count);
  return step ? `feedback.chain${step}` : null;
}

// Whether this exact count is announced (banner and sound).
export function chainAnnounced(count) {
  if (!Number.isFinite(count) || count < 2) return false;
  const whole = Math.floor(count), last = CHAIN_STEPS[CHAIN_STEPS.length - 1];
  return whole <= 6 || CHAIN_STEPS.includes(whole) || (whole > last && (whole - last) % CHAIN_REPEAT === 0);
}

// Banner look, 1 (double) to 6 (75 and more): bigger, hotter, then cosmic.
export function chainTier(count) {
  const step = chainStep(count);
  if (!step) return 0;
  return step < 5 ? 1 : step < 8 ? 2 : step < 15 ? 3 : step < 30 ? 4 : step < 75 ? 5 : 6;
}

export function createFeedbackHud({ document, marker, popupLayer, scoreTarget, coinTarget = null, chainBanner, teamFeed, t, storage = null, now = () => performance.now() }) {
  let settings = loadFeedbackSettings(storage);
  // An optional look, set at run time by another look: style.text(key,
  // params) answers a line or null, style.popupFrames(flight, rise) the score
  // popup's keyframes or null. Anything else, a throw included, keeps the
  // lines and frames below; with no style, say() is the very same t() call.
  let style = null;
  const say = (key, params) => { let own = null; try { own = style?.text?.(key, params ?? {}) ?? null; } catch {} return typeof own === 'string' ? own : t(key, params); };
  const framesOf = (flight, rise) => { let own = null; try { own = style?.popupFrames?.(flight, rise) ?? null; } catch {} return Array.isArray(own) ? own : null; };
  // Start hidden even if the markup forgot its hidden attribute.
  if (marker) marker.hidden = true;
  if (chainBanner) chainBanner.hidden = true;
  let markerTier = 0, markerKind = null, markerUntil = 0;
  let chainVisible = false, chainClasses = [], chainUntil = 0, localCount = 0, localAt = -Infinity, localChainId = null;
  const teamChains = new Map(); // teammate -> { count, chainId }
  let bumpUntil = 0;
  const popups = [], teamLines = [];

  const detach = (list, entry) => {
    const index = list.indexOf(entry);
    if (index >= 0) list.splice(index, 1);
  };
  // A dropped popup (cap, clear, settings) leaves quietly; a landed one bumps
  // its counter. Either way its owner hears of it once (`onDone(landed)`).
  const dropPopup = (popup, landed = false) => {
    if (popup.removed) return;
    popup.removed = true;
    popup.element.remove();
    detach(popups, popup);
    try { popup.onDone?.(landed); } catch {}
  };
  const bumped = new Set();
  const bump = target => {
    if (!target?.classList) return;
    target.classList.add('score-bump'); bumped.add(target);
    bumpUntil = now() + BUMP_DURATION;
  };
  const landPopup = popup => {
    if (popup.removed) return;
    dropPopup(popup, true);
    bump(popup.target);
  };
  const removeTeamLine = line => {
    line.element.remove();
    detach(teamLines, line);
  };

  function hit(kind) {
    const tier = HIT_TIERS[kind];
    if (!tier) return; // unknown kinds are not feedback
    const at = now();
    // A stronger marker already on screen is never downgraded by the same shot.
    if (markerTier && at < markerUntil && tier < markerTier) return;
    markerTier = tier;
    markerUntil = at + HIT_DURATIONS[kind];
    if (markerKind) marker.classList.remove(`tier-${markerKind}`);
    void marker.offsetWidth; // force a reflow so the pop animation restarts
    marker.classList.add(`tier-${kind}`);
    markerKind = kind;
    marker.textContent = kind === 'friendly' ? '☠' : '×';
    marker.hidden = false;
  }

  // `coin`: gold coins flying to the purse (their own setting) instead of
  // score to the score panel (an end-of-wave revive bonus). `label`: the
  // text to show, already formatted like the line it leaves (« +1 840 »);
  // « +amount » otherwise. Returns whether it shows; `onDone(landed)`
  // follows once it is gone.
  function score(amount, { x, y, headshot = false, coin = false, bonus = false, label = null, onDone = null } = {}) {
    if (coin && !settings.coinPopups) return false;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (popups.length >= MAX_SCORE_POPUPS) dropPopup(popups[0]);
    const element = document.createElement('div');
    element.className = coin ? 'score-popup coin' : `score-popup${headshot ? ' headshot' : ''}${bonus ? ' bonus' : ''}`;
    element.textContent = typeof label === 'string' && label ? label : `+${amount}`;
    if (headshot && !coin) {
      const label = document.createElement('small');
      label.textContent = say('feedback.headshot');
      element.append(label);
    }
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    popupLayer.append(element);
    const target = coin ? coinTarget : scoreTarget;
    const popup = { element, expiry: now() + POPUP_DURATION, removed: false, target, coin, onDone: typeof onDone === 'function' ? onDone : null };
    popups.push(popup);
    // Fly to its readout only when it has a real box; otherwise fade in place.
    const rect = target?.getBoundingClientRect?.();
    const flight = rect && rect.width > 0 ? { dx: rect.left + rect.width / 2 - x, dy: rect.top + rect.height / 2 - y } : null;
    if (typeof element.animate === 'function') {
      const animation = element.animate(flightFrames(flight), { duration: POPUP_DURATION, fill: 'forwards' });
      if (animation?.finished) animation.finished.then(() => landPopup(popup), () => {});
    }
    return true;
  }

  // The look's flight when it has one (Frisson), else the arc above.
  function flightFrames(flight, rise = 'translate(-50%,-50%) translateY(-30px)') {
    return framesOf(flight, rise) ?? popupKeyframes(flight, rise);
  }

  // Returns true when the chain was announced (the caller then plays its sound).
  // `chainId` numbers the server's chains; without it, only a double or a
  // long silence starts a new chain.
  function chain(count, { bonus = 0, name = null, chainId = null, who = name } = {}) {
    const labelKey = chainLabelKey(count);
    if (!labelKey) return false;
    count = Math.floor(count);
    if (name === null) {
      // Several kills can land in one frame (a rocket, a gatling burst): the
      // banner is announced when any count since the last one is a step.
      const at = now(), numbered = chainId !== null && chainId !== undefined;
      const fresh = numbered ? chainId !== localChainId : count <= 2 || at - localAt > 3000;
      // A late kill of the current chain (lower count) changes nothing.
      if (!fresh && count <= localCount) return false;
      let announced = false;
      for (let value = fresh ? 2 : localCount + 1; value <= count && !announced; value++) announced = chainAnnounced(value);
      localCount = count; localAt = at; localChainId = numbered ? chainId : null;
      let strong = chainBanner.querySelector('strong');
      if (!strong) { strong = document.createElement('strong'); chainBanner.append(strong); }
      let small = chainBanner.querySelector('small');
      if (!small) { small = document.createElement('small'); chainBanner.append(small); }
      const parts = [];
      if (count >= CHAIN_COUNT_FROM) parts.push(say('feedback.chainCount', { count }));
      if (bonus > 0) parts.push(say('feedback.chainBonus', { points: bonus }));
      if (!announced) {
        // Between two steps, a visible banner only keeps counting, quietly.
        if (chainVisible) small.textContent = parts.join(' · ');
        return false;
      }
      strong.textContent = say(labelKey);
      small.textContent = parts.join(' · ');
      for (const value of chainClasses) chainBanner.classList.remove(value);
      void chainBanner.offsetWidth; // restart the banner animation on every announced chain
      chainClasses = [`chain-${Math.min(count, 6)}`, `chain-tier-${chainTier(count)}`];
      for (const value of chainClasses) chainBanner.classList.add(value);
      chainBanner.hidden = false;
      chainVisible = true;
      chainUntil = at + CHAIN_DURATION;
      return true;
    }
    // A teammate's double stays discreet, and long sprees only at the steps
    // they crossed (several kills of a blast can arrive in one frame).
    const numbered = chainId !== null && chainId !== undefined, known = teamChains.get(who);
    if (!numbered) { if (count < 3 || !chainAnnounced(count)) return false; }
    else {
      const fresh = !known || known.chainId !== chainId;
      if (!fresh && count <= known.count) return false;
      teamChains.set(who, { count, chainId });
      let crossed = false;
      for (let value = Math.max(3, fresh ? 3 : known.count + 1); value <= count && !crossed; value++) crossed = chainAnnounced(value);
      if (!crossed) return false;
    }
    const line = document.createElement('div');
    line.className = 'team-chain';
    // Names come from other players: textContent only, never innerHTML.
    line.textContent = say('feedback.teammateChain', { name, label: say(labelKey) });
    teamFeed.append(line);
    teamLines.push({ element: line, expiry: now() + TEAM_CHAIN_DURATION });
    while (teamLines.length > MAX_TEAM_LINES) removeTeamLine(teamLines[0]);
    return true;
  }

  function update() {
    const at = now();
    if (markerTier && at >= markerUntil) { marker.hidden = true; markerTier = 0; }
    for (const popup of [...popups]) if (at >= popup.expiry) landPopup(popup);
    if (bumpUntil && at >= bumpUntil) { for (const element of bumped) element.classList.remove('score-bump'); bumped.clear(); bumpUntil = 0; }
    if (chainVisible && at >= chainUntil) { chainBanner.hidden = true; chainVisible = false; }
    for (const line of [...teamLines]) if (at >= line.expiry) removeTeamLine(line);
  }

  function clear() {
    marker.hidden = true;
    markerTier = 0;
    if (markerKind) { marker.classList.remove(`tier-${markerKind}`); markerKind = null; }
    chainBanner.hidden = true;
    chainVisible = false;
    localCount = 0; localAt = -Infinity; localChainId = null; teamChains.clear();
    for (const popup of [...popups]) dropPopup(popup);
    for (const line of [...teamLines]) removeTeamLine(line);
    scoreTarget?.classList.remove('score-bump'); coinTarget?.classList.remove('score-bump'); bumped.clear();
    bumpUntil = 0;
  }

  function setSettings(partial) {
    settings = normalizeFeedbackSettings({ ...settings, ...partial });
    saveFeedbackSettings(storage, settings);
    if (!settings.coinPopups) for (const popup of [...popups]) if (popup.coin) dropPopup(popup);
    return settings;
  }

  function bindSettings({ shake, shakeValue, coinPopups: popupsToggle } = {}) {
    if (shake) {
      shake.value = String(Math.round(settings.shake * 100));
      if (shakeValue) shakeValue.textContent = `${Math.round(settings.shake * 100)} %`;
      shake.addEventListener('input', () => {
        const value = Number(shake.value);
        setSettings({ shake: value / 100 });
        if (shakeValue) shakeValue.textContent = `${Math.round(value)} %`;
      });
    }
    if (popupsToggle) {
      popupsToggle.checked = settings.coinPopups;
      popupsToggle.addEventListener('change', () => setSettings({ coinPopups: popupsToggle.checked }));
    }
  }

  // Never touches the DOM: the next line, popup or banner takes the look.
  function setStyle(next = null) {
    style = next && typeof next === 'object' ? next : null;
    return style;
  }

  return {
    get settings() { return settings; },
    get style() { return style; },
    hit, score, chain, update, clear, setSettings, bindSettings, setStyle, flightFrames,
    // A landing elsewhere (an impact number) bumps the score counter too.
    bump: () => bump(scoreTarget),
  };
}
