import assert from 'node:assert/strict';
import test from 'node:test';
import { importPublicModule } from './helpers/public-modules.mjs';

const {
  FEEDBACK_SETTINGS_KEY, FEEDBACK_DEFAULTS, HIT_TIERS, HIT_DURATIONS,
  MAX_SCORE_POPUPS, CHAIN_DURATION, TEAM_CHAIN_DURATION, MAX_TEAM_LINES,
  normalizeFeedbackSettings, loadFeedbackSettings, saveFeedbackSettings,
  chainLabelKey, createFeedbackHud, CHAIN_STEPS, CHAIN_REPEAT, chainStep, chainAnnounced, chainTier,
} = await importPublicModule('feedback-hud.js');
const i18n = await importPublicModule('i18n.js');

// French copy the module asks for; mirrors i18n.js so tests read like the game.
const labels = {
  'feedback.headshot': 'TÊTE',
  'feedback.chain2': 'DOUBLÉ !', 'feedback.chain3': 'TRIPLÉ !', 'feedback.chain4': 'QUADRUPLÉ !',
  'feedback.chain5': 'SÉRIE INFERNALE !', 'feedback.chain6': 'INARRÊTABLE !', 'feedback.chain8': 'DÉCHAÎNÉ !',
  'feedback.chain10': 'TORNADE !', 'feedback.chain12': 'OURAGAN !', 'feedback.chain15': 'SÉISME !',
  'feedback.chain20': 'RAZ-DE-MARÉE !', 'feedback.chain25': 'APOCALYPSE !', 'feedback.chain30': 'LÉGENDAIRE !',
  'feedback.chain40': 'SURHUMAIN !', 'feedback.chain50': 'MYTHIQUE !', 'feedback.chain75': 'DIVIN !',
  'feedback.chain100': 'INTERGALACTIQUE !', 'feedback.chainCount': '{count} D’AFFILÉE',
  'feedback.chainBonus': '★ +{points} BONUS DE SÉRIE', 'feedback.teammateChain': '{name} · {label}',
};
const t = (key, params = {}) => (labels[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);

function fakeElement(tag = 'div') {
  const classes = new Set();
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    parent: null,
    hidden: false,
    textContent: '',
    style: {},
    offsetWidth: 0,
    value: '',
    checked: false,
    listeners: new Map(),
    append(...nodes) { for (const node of nodes) { node.parent = element; element.children.push(node); } },
    remove() {
      if (!element.parent) return;
      const index = element.parent.children.indexOf(element);
      if (index >= 0) element.parent.children.splice(index, 1);
      element.parent = null;
    },
    get firstElementChild() { return element.children[0] ?? null; },
    querySelector(selector) { return element.children.find(child => child.tagName === selector.toUpperCase()) ?? null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    addEventListener(type, handler) {
      if (!element.listeners.has(type)) element.listeners.set(type, []);
      element.listeners.get(type).push(handler);
    },
    dispatch(type) { for (const handler of element.listeners.get(type) ?? []) handler({ target: element }); },
    // Names come from other players: the module must never write HTML.
    set innerHTML(_) { throw new Error('innerHTML is forbidden'); },
  };
  Object.defineProperty(element, 'className', {
    get: () => [...classes].join(' '),
    set: value => { classes.clear(); for (const name of String(value).split(/\s+/)) if (name) classes.add(name); },
  });
  element.classList = {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
    contains: name => classes.has(name),
  };
  return element;
}

function setup({ storage = null, scoreRect = { left: 10, top: 20, width: 100, height: 20 }, withScoreTarget = true } = {}) {
  let time = 0;
  const marker = fakeElement(); marker.className = 'hit-marker'; marker.hidden = true;
  const popupLayer = fakeElement();
  const scoreTarget = withScoreTarget ? fakeElement('span') : null;
  if (scoreTarget) scoreTarget.getBoundingClientRect = () => ({ ...scoreRect, right: scoreRect.left + scoreRect.width, bottom: scoreRect.top + scoreRect.height });
  const chainBanner = fakeElement(); chainBanner.hidden = true;
  chainBanner.append(fakeElement('strong'), fakeElement('small'));
  const teamFeed = fakeElement();
  const document = { createElement: tag => fakeElement(tag) };
  const hud = createFeedbackHud({ document, marker, popupLayer, scoreTarget, chainBanner, teamFeed, t, storage, now: () => time });
  return { hud, marker, popupLayer, scoreTarget, chainBanner, teamFeed, advance: ms => { time += ms; }, time: () => time };
}

const memoryStorage = () => {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map };
};

test('feedback settings are clamped, rounded and rebuilt field by field from junk', () => {
  assert.deepEqual(normalizeFeedbackSettings(null), FEEDBACK_DEFAULTS);
  assert.deepEqual(normalizeFeedbackSettings('shake'), FEEDBACK_DEFAULTS);
  assert.deepEqual(normalizeFeedbackSettings(7), FEEDBACK_DEFAULTS);
  assert.deepEqual(FEEDBACK_DEFAULTS, { shake: 1, coinPopups: true });
  assert.deepEqual(normalizeFeedbackSettings({ shake: 1.7, coinPopups: false }), { shake: 1, coinPopups: false });
  assert.deepEqual(normalizeFeedbackSettings({ shake: -0.4 }), { shake: 0, coinPopups: true });
  assert.deepEqual(normalizeFeedbackSettings({ shake: 0.63 }), { shake: 0.65, coinPopups: true }, 'shake rounds to 0.05');
  assert.deepEqual(normalizeFeedbackSettings({ shake: NaN, coinPopups: 'yes' }), FEEDBACK_DEFAULTS);
  assert.deepEqual(normalizeFeedbackSettings({ shake: '0.5', coinPopups: 1 }), FEEDBACK_DEFAULTS);
  // « Score et pièces qui s'envolent » is now « Pièces qui s'envolent »: its old field decides the coins.
  assert.deepEqual(normalizeFeedbackSettings({ shake: .5, scorePopups: false }), { shake: .5, coinPopups: false });
  assert.deepEqual(normalizeFeedbackSettings({ scorePopups: false, coinPopups: true }), { shake: 1, coinPopups: true }, 'the new field wins');
});

test('feedback settings survive null storage, throwing storage and a full round trip', () => {
  assert.deepEqual(loadFeedbackSettings(null), FEEDBACK_DEFAULTS);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => loadFeedbackSettings(blocked));
  assert.deepEqual(loadFeedbackSettings(blocked), FEEDBACK_DEFAULTS);
  assert.doesNotThrow(() => saveFeedbackSettings(blocked, { shake: 0.5, coinPopups: false }));
  assert.doesNotThrow(() => saveFeedbackSettings(null, FEEDBACK_DEFAULTS));
  const storage = memoryStorage();
  saveFeedbackSettings(storage, { shake: 0.5, coinPopups: false });
  assert.deepEqual(JSON.parse(storage.map.get(FEEDBACK_SETTINGS_KEY)), { shake: 0.5, coinPopups: false });
  assert.deepEqual(loadFeedbackSettings(storage), { shake: 0.5, coinPopups: false });
  storage.map.set(FEEDBACK_SETTINGS_KEY, JSON.stringify({ shake: 0.5, scorePopups: false }));
  assert.deepEqual(loadFeedbackSettings(storage), { shake: 0.5, coinPopups: false }, 'a stored legacy value keeps the coins off');
  storage.map.set(FEEDBACK_SETTINGS_KEY, '{broken json');
  assert.deepEqual(loadFeedbackSettings(storage), FEEDBACK_DEFAULTS);
});

test('chain labels start at a double and follow the ladder steps', () => {
  assert.equal(chainLabelKey(0), null);
  assert.equal(chainLabelKey(1), null);
  for (const count of [2, 3, 4, 5, 6]) assert.equal(chainLabelKey(count), `feedback.chain${count}`);
  assert.equal(chainLabelKey(7), 'feedback.chain6');
  assert.equal(chainLabelKey(9), 'feedback.chain8');
  assert.equal(chainLabelKey(1000), 'feedback.chain100');
  assert.equal(chainLabelKey(NaN), null);
});

test('hit marker tiers: no downgrade, upgrade restarts, expiry hides, junk ignored', () => {
  const { hud, marker, advance } = setup();
  assert.equal(HIT_TIERS.kill, 3);
  assert.equal(HIT_DURATIONS.headshotKill, 380);
  hud.hit('kill');
  assert.equal(marker.hidden, false);
  assert.ok(marker.classList.contains('tier-kill'));
  assert.equal(marker.textContent, '×');
  hud.hit('hit'); // the plain hit of the same shot arrives in the same tick
  assert.ok(marker.classList.contains('tier-kill') && !marker.classList.contains('tier-hit'), 'a kill is not downgraded');
  advance(100);
  hud.hit('hit');
  assert.ok(marker.classList.contains('tier-kill'), 'still within the kill lifetime');
  advance(250);
  hud.update();
  assert.equal(marker.hidden, true, 'hidden once 300 ms are up');
  hud.hit('hit');
  assert.ok(marker.classList.contains('tier-hit'));
  advance(50);
  hud.hit('headshotKill'); // equal or higher tier upgrades and restarts
  assert.ok(marker.classList.contains('tier-headshotKill') && !marker.classList.contains('tier-hit'));
  advance(HIT_DURATIONS.headshotKill + 1);
  hud.update();
  assert.equal(marker.hidden, true);
  hud.hit('scratch');
  assert.equal(marker.hidden, true, 'unknown kinds are ignored');
  assert.ok(!marker.classList.contains('tier-scratch'));
});

test('score popups fly, land with a bump, expire and stay capped at eight', () => {
  const { hud, popupLayer, scoreTarget, advance } = setup();
  hud.score(130, { x: 400, y: 300, headshot: true });
  assert.equal(popupLayer.children.length, 1);
  const popup = popupLayer.children[0];
  assert.equal(popup.className, 'score-popup headshot');
  assert.equal(popup.textContent, '+130');
  assert.equal(popup.children[0].textContent, 'TÊTE');
  assert.equal(popup.style.left, '400px');
  assert.equal(popup.style.top, '300px');
  advance(951);
  hud.update();
  assert.equal(popupLayer.children.length, 0, 'removed after 950 ms');
  assert.ok(scoreTarget.classList.contains('score-bump'), 'landing bumps the score readout');
  advance(261);
  hud.update();
  assert.ok(!scoreTarget.classList.contains('score-bump'), 'the bump lasts 260 ms');
  for (let index = 0; index < MAX_SCORE_POPUPS + 1; index++) hud.score(100, { x: 10, y: 10 });
  assert.equal(popupLayer.children.length, MAX_SCORE_POPUPS, 'the ninth popup evicts the oldest');
});

test('score popups are skipped when disabled, invalid, or the score box has no size', () => {
  const { hud, popupLayer } = setup();
  hud.score(0, { x: 1, y: 1 }); hud.score(-5, { x: 1, y: 1 }); hud.score(NaN, { x: 1, y: 1 });
  hud.score('100', { x: 1, y: 1 }); hud.score(100, { x: NaN, y: 1 }); hud.score(100);
  assert.equal(popupLayer.children.length, 0, 'invalid amounts and positions are ignored');
  hud.setSettings({ coinPopups: false });
  assert.equal(hud.score(24, { x: 1, y: 1, coin: true }), false);
  assert.equal(popupLayer.children.length, 0, 'disabled coin popups stay off');
  // A revive bonus is part of the end-of-wave card, never a coin setting.
  assert.equal(hud.score(150, { x: 1, y: 1, bonus: true }), true);
  assert.equal(popupLayer.children[0].className, 'score-popup bonus');
  assert.equal(popupLayer.children[0].textContent, '+150');
  popupLayer.children[0].remove();
  // A bonus leaving a card line is written like that line (« +1 840 », « +1,840 »).
  assert.equal(hud.score(1840, { x: 1, y: 1, bonus: true, label: '+1 840' }), true);
  assert.equal(popupLayer.children[0].textContent, '+1 840');
  popupLayer.children[0].remove();
  hud.score(1840, { x: 1, y: 1, bonus: true, label: '' });
  assert.equal(popupLayer.children[0].textContent, '+1840', 'no label: the plain amount');
  popupLayer.children[0].remove();
  const flat = setup({ scoreRect: { left: 0, top: 0, width: 0, height: 0 } });
  flat.hud.score(100, { x: 5, y: 5 });
  assert.equal(flat.popupLayer.children.length, 1, 'an empty score box only skips the flight, not the popup');
  const orphan = setup({ withScoreTarget: false });
  assert.doesNotThrow(() => orphan.hud.score(100, { x: 5, y: 5 }));
  orphan.advance(951); orphan.hud.update();
  assert.equal(orphan.popupLayer.children.length, 0);
});

test('score popup animation keeps its centring and the finished promise removes it once', async () => {
  const { hud, popupLayer, scoreTarget } = setup();
  const recordings = [];
  const originalAppend = popupLayer.append.bind(popupLayer);
  popupLayer.append = (...nodes) => {
    for (const node of nodes) node.animate = (keyframes, options) => { recordings.push({ keyframes, options }); return { finished: Promise.resolve() }; };
    originalAppend(...nodes);
  };
  hud.score(100, { x: 400, y: 300 });
  assert.equal(recordings.length, 1);
  assert.equal(recordings[0].options.duration, 950);
  assert.equal(recordings[0].options.fill, 'forwards');
  for (const frame of recordings[0].keyframes) assert.ok(frame.transform.startsWith('translate(-50%,-50%)'), `centring kept: ${frame.transform}`);
  assert.ok(recordings[0].keyframes.at(-1).transform.includes('translate(-340px,-270px)'), 'flight targets the score centre');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(popupLayer.children.length, 0, 'the finished promise removes the popup');
  assert.ok(scoreTarget.classList.contains('score-bump'));
  hud.update();
  assert.equal(popupLayer.children.length, 0, 'update() does not double-remove');
});

test('kill chain: local banner tiers, bonus line, expiry, and teammate feed rules', () => {
  const { hud, chainBanner, teamFeed, advance } = setup();
  hud.chain(1);
  assert.equal(chainBanner.hidden, true, 'a single kill has no banner');
  hud.chain(2, { bonus: 25 });
  assert.equal(chainBanner.hidden, false);
  assert.equal(chainBanner.querySelector('strong').textContent, 'DOUBLÉ !');
  assert.equal(chainBanner.querySelector('small').textContent, '★ +25 BONUS DE SÉRIE');
  assert.ok(chainBanner.classList.contains('chain-2'));
  advance(400);
  hud.chain(4); // no bonus, no count yet: no line
  assert.equal(chainBanner.querySelector('small').textContent, '', 'no bonus, no line');
  hud.chain(9); // crosses the step at 8 and restarts the timer
  assert.equal(chainBanner.querySelector('strong').textContent, 'DÉCHAÎNÉ !');
  assert.equal(chainBanner.querySelector('small').textContent, '9 D’AFFILÉE', 'the count, without a bonus');
  assert.ok(chainBanner.classList.contains('chain-6') && chainBanner.classList.contains('chain-tier-3') && !chainBanner.classList.contains('chain-2') && !chainBanner.classList.contains('chain-tier-1'));
  advance(CHAIN_DURATION + 1);
  hud.update();
  assert.equal(chainBanner.hidden, true, 'banner hides after 1300 ms');
  hud.chain(2, { name: 'Léa' });
  assert.equal(teamFeed.children.length, 0, 'a teammate double stays discreet');
  hud.chain(3, { name: 'Léa' });
  assert.equal(teamFeed.children.length, 1);
  assert.equal(teamFeed.children[0].className, 'team-chain');
  assert.equal(teamFeed.children[0].textContent, 'Léa · TRIPLÉ !');
  hud.chain(4, { name: '<b>Bo</b>' });
  assert.equal(teamFeed.children[1].textContent, '<b>Bo</b> · QUADRUPLÉ !', 'names stay plain text');
  for (const name of ['A', 'B', 'C']) hud.chain(5, { name });
  assert.equal(teamFeed.children.length, MAX_TEAM_LINES, 'the feed keeps at most three lines');
  assert.equal(teamFeed.children[0].textContent, 'A · SÉRIE INFERNALE !', 'the oldest lines were removed');
  advance(TEAM_CHAIN_DURATION + 1);
  hud.update();
  assert.equal(teamFeed.children.length, 0, 'feed lines expire');
});

test('the chain banner builds its strong and small when they are missing', () => {
  let time = 0;
  const chainBanner = fakeElement(); chainBanner.hidden = true;
  const document = { createElement: tag => fakeElement(tag) };
  const hud = createFeedbackHud({ document, marker: fakeElement(), popupLayer: fakeElement(), scoreTarget: null, chainBanner, teamFeed: fakeElement(), t, now: () => time });
  hud.chain(2, { bonus: 50 });
  assert.equal(chainBanner.children.length, 2);
  assert.equal(chainBanner.querySelector('strong').textContent, 'DOUBLÉ !');
  assert.equal(chainBanner.querySelector('small').textContent, '★ +50 BONUS DE SÉRIE');
});

test('bindSettings reflects settings, saves slider input and clears popups when unchecked', () => {
  const storage = memoryStorage();
  const { hud, popupLayer } = setup({ storage });
  const shake = fakeElement('input'), shakeValue = fakeElement('output'), coinPopups = fakeElement('input');
  hud.bindSettings({ shake, shakeValue, coinPopups });
  assert.equal(shake.value, '100');
  assert.equal(shakeValue.textContent, '100 %');
  assert.equal(coinPopups.checked, true);
  shake.value = '40';
  shake.dispatch('input');
  assert.equal(hud.settings.shake, 0.4);
  assert.equal(shakeValue.textContent, '40 %');
  assert.deepEqual(JSON.parse(storage.map.get(FEEDBACK_SETTINGS_KEY)), { shake: 0.4, coinPopups: true }, 'input events persist');
  hud.score(24, { x: 1, y: 1, coin: true });
  hud.score(150, { x: 1, y: 1, bonus: true });
  assert.equal(popupLayer.children.length, 2);
  coinPopups.checked = false;
  coinPopups.dispatch('change');
  assert.equal(hud.settings.coinPopups, false);
  assert.deepEqual(popupLayer.children.map(popup => popup.className), ['score-popup bonus'], 'unchecking removes live coin popups only');
  assert.deepEqual(loadFeedbackSettings(storage), { shake: 0.4, coinPopups: false });
  assert.doesNotThrow(() => hud.bindSettings({ shake: null, shakeValue: null, coinPopups: null }));
});

test('stored settings are loaded at creation and reflected in the bound inputs', () => {
  const storage = memoryStorage();
  saveFeedbackSettings(storage, { shake: 0.5, coinPopups: false });
  const { hud } = setup({ storage });
  assert.deepEqual(hud.settings, { shake: 0.5, coinPopups: false });
  const shake = fakeElement('input'), shakeValue = fakeElement('output'), coinPopups = fakeElement('input');
  hud.bindSettings({ shake, shakeValue, coinPopups });
  assert.equal(shake.value, '50');
  assert.equal(shakeValue.textContent, '50 %');
  assert.equal(coinPopups.checked, false);
});

test('clear() hides the marker and banner and empties both layers', () => {
  const { hud, marker, popupLayer, scoreTarget, chainBanner, teamFeed, advance } = setup();
  hud.hit('kill');
  hud.score(100, { x: 10, y: 10 });
  hud.chain(4, { bonus: 75 });
  hud.chain(3, { name: 'Léa' });
  advance(951); // let one popup land so the bump is visible too
  hud.update();
  assert.ok(scoreTarget.classList.contains('score-bump'));
  hud.clear();
  assert.equal(marker.hidden, true);
  assert.ok(!marker.classList.contains('tier-kill'));
  assert.equal(chainBanner.hidden, true);
  assert.equal(popupLayer.children.length, 0);
  assert.equal(teamFeed.children.length, 0);
  assert.ok(!scoreTarget.classList.contains('score-bump'));
  hud.update(); // a frame after clearing stays quiet
  assert.equal(marker.hidden, true);
});

test('the chain ladder names every kill up to 6, then only its steps, up to the top name and beyond', () => {
  assert.deepEqual([...CHAIN_STEPS], [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100]);
  const announced = [];
  for (let count = 0; count <= 260; count++) if (chainAnnounced(count)) announced.push(count);
  assert.deepEqual(announced, [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250]);
  assert.equal(CHAIN_REPEAT, 50);
  assert.equal(chainStep(1), null);
  assert.equal(chainStep(14), 12);
  assert.equal(chainStep(99), 75);
  assert.equal(chainStep(Infinity), null);
  assert.deepEqual([2, 4, 5, 6, 8, 12, 15, 25, 30, 50, 75, 300].map(chainTier), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  assert.equal(chainTier(1), 0);
  assert.equal(chainAnnounced(NaN), false);
});

test('every step of the ladder has its own, distinct name in French and English', () => {
  for (const language of ['fr', 'en']) {
    i18n.setLanguage(language);
    const names = CHAIN_STEPS.map(step => i18n.t(`feedback.chain${step}`));
    for (const [index, name] of names.entries()) assert.ok(name && !name.startsWith('feedback.'), `${language} step ${CHAIN_STEPS[index]}`);
    assert.equal(new Set(names).size, names.length, `${language}: no name repeats`);
    assert.match(i18n.t('feedback.chainCount', { count: 12 }), /12/);
  }
  i18n.setLanguage('fr');
  assert.equal(i18n.t('feedback.chain2'), 'DOUBLÉ !');
  assert.equal(i18n.t('feedback.chain100'), 'INTERGALACTIQUE !');
});

test('a long spree pops the banner only at its steps and keeps counting quietly in between', () => {
  const { hud, chainBanner, advance } = setup();
  const pops = [];
  for (let count = 2; count <= 32; count++) {
    if (hud.chain(count, { bonus: Math.min(100, 25 * (count - 1)) })) pops.push(count);
    if (count === 9) {
      assert.equal(chainBanner.querySelector('strong').textContent, 'DÉCHAÎNÉ !', 'the name waits for the next step');
      assert.equal(chainBanner.querySelector('small').textContent, '9 D’AFFILÉE · ★ +100 BONUS DE SÉRIE', 'the count keeps up');
    }
    advance(300); // a gatling kill every 0.3 s keeps the chain and the banner alive
    hud.update();
  }
  assert.deepEqual(pops, [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]);
  assert.equal(chainBanner.querySelector('strong').textContent, 'LÉGENDAIRE !');
  assert.ok(chainBanner.classList.contains('chain-tier-5'));
  advance(CHAIN_DURATION);
  hud.update();
  assert.equal(chainBanner.hidden, true);
  assert.equal(hud.chain(33), false, 'a hidden banner stays hidden between steps');
  assert.equal(chainBanner.hidden, true);
});

test('kills landing in one frame announce the step they crossed; a new chain number starts over', () => {
  const { hud, chainBanner } = setup();
  hud.chain(7, { chainId: 1 });
  assert.equal(hud.chain(9, { chainId: 1 }), true, 'a rocket from 7 to 9 crosses the step at 8');
  assert.equal(chainBanner.querySelector('strong').textContent, 'DÉCHAÎNÉ !');
  assert.equal(hud.chain(10, { chainId: 1 }), true);
  assert.equal(hud.chain(11, { chainId: 1 }), false);
  assert.equal(hud.chain(3, { chainId: 2 }), true, 'a new chain number is a new chain, even mid-count');
  assert.equal(chainBanner.querySelector('strong').textContent, 'TRIPLÉ !');
  hud.clear();
  assert.equal(hud.chain(7, { chainId: 2 }), true, 'clear() forgets the chain');
});

test('rocket kills arriving out of order never send the ladder backwards', () => {
  const { hud, chainBanner } = setup();
  for (let count = 2; count <= 13; count++) hud.chain(count, { chainId: 4 });
  // One rocket kills chains 14, 15 and 16; they land by distance: 16, 14, 15.
  assert.equal(hud.chain(16, { chainId: 4 }), true, '16 crosses the step at 15');
  assert.equal(chainBanner.querySelector('strong').textContent, 'SÉISME !');
  assert.equal(chainBanner.querySelector('small').textContent, '16 D’AFFILÉE');
  assert.equal(hud.chain(14, { chainId: 4 }), false, 'a late kill changes nothing');
  assert.equal(hud.chain(15, { chainId: 4 }), false);
  assert.equal(chainBanner.querySelector('strong').textContent, 'SÉISME !');
  assert.equal(chainBanner.querySelector('small').textContent, '16 D’AFFILÉE', 'the counter never goes back');
});

test('without chain numbers (an older server), only a double or a long silence starts a new chain', () => {
  const { hud, chainBanner, advance } = setup();
  for (let count = 2; count <= 9; count++) hud.chain(count);
  assert.equal(hud.chain(7), false, 'a late lower count is ignored');
  assert.equal(hud.chain(2), true, 'a double is a new chain');
  assert.equal(chainBanner.querySelector('strong').textContent, 'DOUBLÉ !');
  hud.chain(3); hud.chain(4); hud.chain(5); hud.chain(6);
  advance(3500);
  assert.equal(hud.chain(4), true, 'after a long silence the chain is new again');
  assert.equal(chainBanner.querySelector('strong').textContent, 'QUADRUPLÉ !');
});

test('teammates appear in the feed from their triple, then only at the steps', () => {
  const { hud, teamFeed } = setup();
  for (let count = 2; count <= 13; count++) hud.chain(count, { name: 'Jules' });
  assert.deepEqual(teamFeed.children.map(line => line.textContent), ['Jules · DÉCHAÎNÉ !', 'Jules · TORNADE !', 'Jules · OURAGAN !']);
  assert.equal(hud.chain(14, { name: 'Jules' }), false);
});

test('coins fly to the purse and bump it; score flies to the score along an arc', () => {
  let time = 0;
  const recordings = [];
  const make = tag => { const element = fakeElement(tag); element.animate = (keyframes, options) => { recordings.push({ element, keyframes, options }); return { finished: new Promise(() => {}) }; }; return element; };
  const scoreTarget = fakeElement('strong'), coinTarget = fakeElement('strong'), popupLayer = fakeElement();
  scoreTarget.getBoundingClientRect = () => ({ left: 900, top: 20, width: 100, height: 40 });
  coinTarget.getBoundingClientRect = () => ({ left: 40, top: 700, width: 60, height: 20 });
  const hud = createFeedbackHud({ document: { createElement: make }, marker: fakeElement(), popupLayer, scoreTarget, coinTarget, chainBanner: fakeElement(), teamFeed: fakeElement(), t, now: () => time });
  hud.score(24, { x: 500, y: 500, coin: true });
  hud.score(100, { x: 500, y: 400, headshot: true });
  const [coin, star] = popupLayer.children;
  assert.equal(coin.className, 'score-popup coin');
  assert.equal(coin.children.length, 0, 'coins never carry the HEAD label');
  assert.equal(star.className, 'score-popup headshot');
  assert.ok(recordings[0].keyframes.at(-1).transform.includes('translate(-430px,210px)'), 'coins fly to the purse centre');
  const flight = recordings[1].keyframes;
  assert.ok(flight.at(-1).transform.includes('translate(450px,-360px)'), 'score flies to the score centre');
  assert.ok(flight.at(-2).transform.includes('translate(90px,-270px)'), 'vertical first: the arc stays clear of the crosshair');
  time += 951;
  hud.update();
  assert.ok(coinTarget.classList.contains('score-bump') && scoreTarget.classList.contains('score-bump'));
  time += 300;
  hud.update();
  assert.ok(!coinTarget.classList.contains('score-bump') && !scoreTarget.classList.contains('score-bump'));
});

test('a teammate blast gives one feed line per frame, at the highest step crossed', () => {
  const { hud, teamFeed } = setup();
  assert.equal(hud.chain(12, { name: 'Hôte', chainId: 1, who: 'host' }), true, 'one rocket, kills 3 to 12 in one frame');
  assert.deepEqual(teamFeed.children.map(line => line.textContent), ['Hôte · OURAGAN !']);
  assert.equal(hud.chain(11, { name: 'Hôte', chainId: 1, who: 'host' }), false, 'a late kill changes nothing');
  assert.equal(hud.chain(13, { name: 'Hôte', chainId: 1, who: 'host' }), false, 'no step crossed');
  assert.equal(hud.chain(16, { name: 'Hôte', chainId: 1, who: 'host' }), true, '15 was crossed');
  assert.equal(teamFeed.children.at(-1).textContent, 'Hôte · SÉISME !');
  assert.equal(hud.chain(4, { name: 'Hôte', chainId: 2, who: 'host' }), true, 'a new chain number starts over');
  assert.equal(teamFeed.children.at(-1).textContent, 'Hôte · QUADRUPLÉ !');
  assert.equal(hud.chain(5, { name: 'Léa', chainId: 1, who: 'lea' }), true, 'each teammate has their own chain');
});

test('a flight reports once when it is gone, landed or dropped, and bump() pulses the score', () => {
  const { hud, popupLayer, scoreTarget, advance } = setup();
  const done = [];
  hud.score(150, { x: 100, y: 500, bonus: true, onDone: landed => done.push(landed) });
  advance(951); hud.update(); hud.update();
  assert.deepEqual(done, [true], 'landed, reported once');
  assert.ok(scoreTarget.classList.contains('score-bump'));
  hud.score(150, { x: 100, y: 500, bonus: true, onDone: landed => done.push(landed) });
  hud.clear();
  assert.deepEqual(done, [true, false], 'a cleared flight still settles');
  assert.equal(popupLayer.children.length, 0);
  hud.bump();
  assert.ok(scoreTarget.classList.contains('score-bump'));
  assert.equal(hud.flightFrames({ dx: 10, dy: -20 }).at(-1).transform.includes('translate(10px,-20px)'), true);
});
