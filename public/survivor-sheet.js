// «Mon survivant» (owner, 18 October): "les bonus, je vois mes niveaux, mais
// où est-ce que je peux voir ce que ça me donne effectivement ?", then "à
// droite, verticalement … on appuie une fois, ça l'affiche, on ré-appuie, ça
// la fait disparaître". Tab shows or hides a readable sheet on the right of
// the HUD: the weapon in hand (base → now), the survivor's numbers that differ
// from the standard survivor, and one row per carried bonus or sheet debt.
// Every number comes from the functions the game itself uses: characterStats
// for the survivor, upgradedWeapon (bonuses AND sheet debts) for the weapon,
// claimStep for the next crate claim. This module only presents them.
import { characterStats, characterBonusDescription } from './character-bonuses.js';
import { SUPPLY_BONUSES, MAX_BONUS_LEVEL, upgradedWeapon } from './weapon-upgrades.js';
import { claimStep, effectiveBonusLevel, bonusDebt, sheetStat, SHEET_STAT_IDS } from './character-sheet.js';
import { bonusHudCard, sheetMalusEffect } from './bonus-hud.js';
import { characterLabel, signedValue } from './character-sheet-ui.js';
import { reconLevel } from './radar-rules.js';
import { weaponLabel } from './i18n.js';

// One small choice per browser, like the other HUD preferences: hidden by
// default, so the HUD stays exactly as before until someone presses Tab.
export const SURVIVOR_SHEET_KEY = 'deadwood-survivor-sheet-v1';
export function readSheetShown(storage) {
  try { return storage?.getItem?.(SURVIVOR_SHEET_KEY) === 'shown'; } catch { return false; }
}
export function saveSheetShown(storage, shown) {
  try { storage?.setItem?.(SURVIVOR_SHEET_KEY, shown ? 'shown' : 'hidden'); return true; } catch { return false; }
}

const STANDARD = Object.freeze(characterStats({ bonus: null }));
const own = (object, key) => object && typeof object === 'object' && Object.hasOwn(object, key) ? object[key] : undefined;
const decimal = (value, language) => {
  const text = String(Math.round(value * 100) / 100);
  return language === 'en' ? text : text.replace('.', ',');
};
// «+9», «−8» (a real minus sign, as everywhere in the HUD).
const signed = value => signedValue(Math.round(value));
const delta = multiplier => Math.round((multiplier - 1) * 100);
// Effective levels read «N3» (FR) / «L3» (EN), debts «−2», an offset debt «0».
const levelText = (level, t) => level >= 1 ? t('survivor.levelShort', { level }) : signedValue(level);

// The second weapon of a dual-wielding survivor, as the snapshot gives it.
const offhandOf = player => own(player, 'dualWield') === true ? own(own(player, 'hands'), 'secondary') ?? null : null;
// The weapon types in hand: the main one, and the second one when dual.
const weaponsInHand = player => [own(player, 'weapon'), own(offhandOf(player), 'weapon')].filter(type => typeof type === 'string');

// The carried bonuses and debts, in the crate's order (the tray's order).
export function sheetBonusKinds(player) {
  return Object.keys(SUPPLY_BONUSES).filter(kind => {
    const carried = own(own(player, 'bonus'), kind);
    return (Number.isFinite(carried) && carried >= 1) || bonusDebt(player, kind) > 0;
  });
}

// What the survivor's numbers are, only where they differ from the standard
// survivor (no bonus, no debt). `tone` is the direction for the player.
export function survivorStatRows(player, { t, language = 'fr' }) {
  if (!player || typeof player !== 'object') return [];
  const stats = characterStats(player), rows = [];
  const add = (id, value, better) => rows.push({ id, label: t(`survivor.stat.${id}`), value, tone: better ? 'bonus' : 'malus' });
  const percent = value => t('survivor.percent', { value: signed(value) });
  if (stats.maxHp !== STANDARD.maxHp) add('maxHp', t('survivor.arrow', { from: STANDARD.maxHp, to: stats.maxHp }), stats.maxHp > STANDARD.maxHp);
  const speed = delta(stats.speedMultiplier);
  if (speed) add('speed', percent(speed), speed > 0);
  const reload = delta(stats.reloadMultiplier);
  if (reload) add('reload', percent(reload), reload < 0);
  const swap = Math.round(stats.switchSeconds * 1000), standardSwap = Math.round(STANDARD.switchSeconds * 1000);
  if (swap !== standardSwap) add('switch', t('survivor.arrowMs', { from: standardSwap, to: swap }), swap < standardSwap);
  if (stats.dualWield) add('dualWield', t('survivor.unlocked'), true);
  const combat = delta(stats.combatMultiplier);
  if (combat) add('combat', percent(combat), combat < 0);
  const rain = delta(stats.rainMultiplier);
  if (rain) add('rain', percent(rain), rain < 0);
  if (stats.reviveSeconds !== STANDARD.reviveSeconds) add('revive', t('survivor.arrowSeconds', { from: decimal(STANDARD.reviveSeconds, language), to: decimal(stats.reviveSeconds, language) }), stats.reviveSeconds < STANDARD.reviveSeconds);
  const medkit = Math.round(stats.medkitHealMultiplier * 100);
  if (medkit !== 100) add('medkit', t('survivor.arrowPercent', { from: 100, to: medkit }), medkit > 100);
  // A maximum, not the grenades carried right now (the weapon panel counts those).
  if (stats.maxGrenades !== STANDARD.maxGrenades) add('grenades', t('survivor.arrow', { from: STANDARD.maxGrenades, to: stats.maxGrenades }), stats.maxGrenades > STANDARD.maxGrenades);
  if (stats.grenadeIntervalSeconds > 0) add('freeGrenade', t('survivor.every', { seconds: decimal(stats.grenadeIntervalSeconds, language) }), true);
  const grenade = delta(stats.grenadeDamageMultiplier);
  if (grenade) add('grenadeDamage', percent(grenade), grenade > 0);
  if (stats.auraRadius > 0 && stats.auraSlow > 0) add('aura', t('survivor.zone', { value: signed(-stats.auraSlow * 100), radius: decimal(stats.auraRadius, language) }), true);
  if (stats.hasteRadius > 0 && stats.haste > 0) add('smell', t('survivor.zone', { value: signed(stats.haste * 100), radius: decimal(stats.hasteRadius, language) }), false);
  const recon = reconLevel(player);
  if (recon >= 1) add('radar', characterBonusDescription('radar', recon, language), true);
  if (stats.repairHp !== STANDARD.repairHp) add('repair', t('survivor.arrowHp', { from: STANDARD.repairHp, to: stats.repairHp }), stats.repairHp > STANDARD.repairHp);
  return rows;
}

// One weapon: base → now, through upgradedWeapon with the carried bonuses and
// the sheet's debts, like the server's weaponProfile. `weapons` is the base
// table the server publishes (/world.json); without it only the snapshot's own
// magazine and reserve are shown. `hand` is 'primary' (the weapon in hand) or
// 'secondary' (the second weapon of a dual-wielding survivor, or null).
export function survivorWeaponSection(player, { weapons = null, t, language = 'fr', hand = 'primary' } = {}) {
  const held = hand === 'secondary' ? offhandOf(player) : player;
  const type = typeof own(held, 'weapon') === 'string' ? held.weapon : null;
  if (!type) return hand === 'secondary' ? null : { id: null, hand, name: t('ground.unarmed'), rows: [] };
  const base = weapons && typeof weapons === 'object' && Object.hasOwn(weapons, type) ? weapons[type] : null;
  const current = base ? upgradedWeapon(base, type, own(player, 'bonus'), own(player, 'sheetDebt')) : null;
  const rows = [];
  const row = (id, label, from, to) => {
    if (!Number.isFinite(to)) return;
    const start = Number.isFinite(from) ? from : to;
    rows.push({ id, label, base: start, value: to, text: start === to ? String(to) : t('survivor.arrow', { from: start, to }), tone: to > start ? 'bonus' : to < start ? 'malus' : null });
  };
  // A line whose number is missing is left out, never invented.
  const damage = value => Math.round(value);
  if (base?.melee) {
    row('light', t('survivor.lightHit'), damage(base.attacks?.light?.damage), damage(current.attacks?.light?.damage));
    row('heavy', t('survivor.heavyHit'), damage(base.attacks?.heavy?.damage), damage(current.attacks?.heavy?.damage));
    row('targets', t('survivor.targets'), base.attacks?.light?.maxTargets, current.attacks?.light?.maxTargets);
  } else if (base && !base.fuel) {
    const label = base.explosive ? t('survivor.blast') : base.pellets > 1 ? t('survivor.damagePellet', { count: base.pellets }) : t('survivor.damage');
    row('damage', label, damage(base.damage), damage(current.damage));
  }
  if (!base?.melee) {
    const magazine = current?.magazine ?? own(held, 'magazine'), reserve = current?.reserve ?? own(held, 'reserveCapacity');
    if (magazine > 0) {
      row('magazine', t(base?.fuel ? 'survivor.tank' : 'survivor.magazine'), base?.magazine, magazine);
      // The most it can carry (the weapon panel counts what is left).
      if (reserve > 0 || base?.reserve > 0) row('reserve', t('survivor.reserve'), base?.reserve, reserve);
    }
  }
  // penetrationTargets counts every body a bullet hits, the first one too
  // (simulation.mjs stops at ++index >= penetrationTargets): «targets per
  // bullet», never «pierced». One target is the plain bullet: no line.
  if (base && !base.melee && !base.fuel && !base.explosive) {
    const from = base.penetrationTargets ?? 1, to = current.penetrationTargets ?? from;
    if (from > 1 || to !== from) row('pierce', t(base.pellets > 1 ? 'survivor.piercePellet' : 'survivor.pierce'), from, to);
  }
  return { id: type, hand, name: weaponLabel(type, { language }), rows };
}

// One row per carried bonus or debt: its level, what it does now (with the
// weapons in hand) and what the next crate claim gives.
const WEAPON_BONUSES = Object.freeze(['stone', 'perforating', 'extended', 'reinforced']);
// The debts that weigh on some weapons only (perforating's only cost is a
// later claim); same weapon test as the tiles, which matches upgradedWeapon.
const WEAPON_DEBTS = Object.freeze(['stone', 'extended', 'reinforced']);
export function survivorBonusRows(player, { t }) {
  if (!player || typeof player !== 'object') return [];
  const held = weaponsInHand(player);
  const hands = held.length ? held : [own(player, 'weapon')];
  return sheetBonusKinds(player).map(kind => {
    const level = effectiveBonusLevel(player, kind), step = claimStep(player, kind);
    let effect, active = true;
    if (level >= 1) {
      const cards = hands.map(weapon => bonusHudCard(kind, level, weapon, t, step.to)), info = cards[0];
      active = cards.some(card => card.active);
      // The tiles' terse weapon effects («+30 %») get their subject back.
      const said = WEAPON_BONUSES.includes(kind) ? `${t(`hudBonus.label.${kind}`)} ${info.effect}` : info.effect;
      effect = active ? said : `${said} · ${t('hudBonus.inactive')}`;
    } else {
      effect = sheetMalusEffect(kind, level, t);
      // A weapon debt costs nothing to a weapon it does not concern.
      if (level < 0 && WEAPON_DEBTS.includes(kind)) {
        active = hands.some(weapon => bonusHudCard(kind, 1, weapon, t).active);
        if (!active) effect = `${effect} · ${t('hudBonus.inactive')}`;
      }
    }
    const max = !step.repay && step.gain <= 0 && level >= MAX_BONUS_LEVEL;
    const next = max ? t('survivor.max')
      : `${t('sheet.nextClaim', { from: levelText(step.from, t), to: levelText(step.to, t) })}${step.talent ? ` · ${t('sheet.talent')}` : ''}`;
    return { kind, name: t(`bonus.${kind}`), level, levelText: level >= 1 ? t('survivor.level', { level, max: MAX_BONUS_LEVEL }) : signedValue(level),
      levelShort: level >= 1 ? t('survivor.levelShort', { level }) : signedValue(level),
      effect, next, max, talent: step.talent === true, tone: level >= 1 ? 'bonus' : level < 0 ? 'malus' : 'neutral', active };
  });
}

// The whole sheet for one player snapshot. Pure: no DOM, no clock.
export function survivorSheetModel(player, { weapons = null, t, language = 'fr' } = {}) {
  if (!player || typeof player !== 'object') return null;
  const character = own(player, 'character') ?? own(player, 'sheet');
  const standardSheet = SHEET_STAT_IDS.every(id => sheetStat(character, id) === 0) && !own(character, 'name');
  const name = typeof player.name === 'string' && player.name ? player.name : t('player.unknown');
  const bonuses = survivorBonusRows(player, { t });
  const stats = survivorStatRows(player, { t, language });
  return {
    who: standardSheet ? name : `${name} · ${characterLabel(character, t)}`,
    weapon: survivorWeaponSection(player, { weapons, t, language }),
    // Two weapons in hand: the second one gets its own block.
    offhand: survivorWeaponSection(player, { weapons, t, language, hand: 'secondary' }),
    stats, bonuses,
    // Nothing carried, nothing owed: one short line instead of two sections.
    standard: bonuses.length === 0 && stats.length === 0,
  };
}

// Everything the sheet shows depends on these; the client rebuilds the DOM
// only when this key changes (never per frame).
export function survivorSheetKey(player, { weapons = null, language = 'fr' } = {}) {
  if (!player || typeof player !== 'object') return '';
  const offhand = offhandOf(player);
  return JSON.stringify([language, player.name ?? null, own(player, 'character') ?? null, own(player, 'bonus') ?? null, own(player, 'sheetDebt') ?? null,
    player.weapon ?? null, player.magazine ?? null, player.reserveCapacity ?? null, Boolean(weapons),
    own(player, 'dualWield') === true, own(player, 'secondaryWeaponId') ?? null, own(offhand, 'weapon') ?? null, own(offhand, 'magazine') ?? null, own(offhand, 'reserveCapacity') ?? null]);
}

// The DOM, plain text everywhere (bonusIcon is fixed markup, never user text).
// The sheet is a flat list of blocks (the header, each section's heading, each
// row) that placeSurvivorSheet distributes into columns; `data-block` says
// what each one is and `data-section` which section it belongs to.
export function renderSurvivorSheet(root, model, { document, t, icon = () => '' }) {
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const block = (node, kind, section) => { node.dataset.block = kind; node.dataset.section = section; return node; };
  const valueRow = (section, label, value, tone, { malusTag = false, from = null } = {}) => {
    const row = block(element('div', 'sheet-row'), 'item', section);
    if (tone) row.dataset.tone = tone;
    const name = element('span', 'sheet-label', label);
    if (malusTag) name.append(element('small', 'sheet-tag', t('survivor.malus')));
    const number = element('span', 'sheet-value');
    // «25 → 33»; at the tightest steps only the value now («33») shows.
    if (from !== null) number.append(element('span', 'sheet-full', t('survivor.arrow', { from, to: value })), element('span', 'sheet-now', String(value)));
    else number.textContent = value;
    row.append(name, number);
    return row;
  };
  const heading = (section, title) => block(typeof title === 'string' ? element('h3', 'sheet-heading', title) : title, 'heading', section);
  if (!model) { root.replaceChildren(); return []; }
  const head = block(element('header', 'sheet-head'), 'head', 'head');
  head.append(element('strong', 'sheet-title', t('survivor.title')), element('small', 'sheet-who', model.who));
  const blocks = [head];
  const weaponBlocks = (weapon, section, label) => {
    // «Arme en main ·» steps aside when space runs out; the name stays.
    const title = element('h3', 'sheet-heading');
    title.append(element('span', 'sheet-heading-label', `${label} · `), element('span', 'sheet-weapon-name', weapon.name));
    blocks.push(heading(section, title), ...weapon.rows.map(row => valueRow(section, row.label, row.value, row.tone,
      { malusTag: row.tone === 'malus', from: row.base !== row.value ? row.base : null })));
  };
  weaponBlocks(model.weapon, 'weapon', t(model.offhand ? 'survivor.primary' : 'survivor.weapon'));
  if (model.offhand) weaponBlocks(model.offhand, 'offhand', t('dual.secondary'));
  if (model.standard) blocks.push(block(element('p', 'sheet-standard', t('survivor.standard')), 'item', 'standard'));
  else {
    blocks.push(heading('stats', t('survivor.stats')));
    if (model.stats.length) blocks.push(...model.stats.map(row => valueRow('stats', row.label, row.value, row.tone, { malusTag: row.tone === 'malus' })));
    else blocks.push(block(element('p', 'sheet-standard', t('survivor.statsStandard')), 'item', 'stats'));
    if (model.bonuses.length) blocks.push(heading('bonuses', t('survivor.bonuses')), ...model.bonuses.map(bonus => {
      const row = block(element('div', `sheet-bonus ${bonus.kind}`), 'item', 'bonuses');
      row.dataset.tone = bonus.tone; row.dataset.active = String(bonus.active);
      const picture = element('span', 'sheet-icon'); picture.innerHTML = icon(bonus.kind);
      // «N3/8»; at the tightest steps «N3» (the «/8» steps aside).
      const level = element('b', 'sheet-level');
      if (bonus.levelShort !== bonus.levelText) level.append(element('span', 'sheet-level-now', bonus.levelShort), element('span', 'sheet-level-max', bonus.levelText.slice(bonus.levelShort.length)));
      else level.textContent = bonus.levelText;
      row.append(picture, element('span', 'sheet-name', bonus.name), level,
        element('small', 'sheet-effect', bonus.effect), element('small', 'sheet-next', bonus.next));
      return row;
    }));
  }
  // Before placement everything sits in one column; placeSurvivorSheet then
  // spreads the blocks over the room the HUD leaves.
  const column = element('div', 'sheet-col');
  column.append(...blocks);
  root.replaceChildren(column);
  return blocks;
}

// ── Fitting the sheet (point 4 of the request) ─────────────────────────────
// The sheet lives on the right, right-aligned with the weapon panel. Its room
// is a set of column slots measured from the HUD as laid out (in a real wave
// as on the weapon stand): every slot ends above the weapon panel; a slot
// under the score starts below it, one under the breach alert's place beside
// the score below that, one further left level with the score; a slot never
// goes left of the crosshair's clearance nor over the wave panel. Only when
// nothing else fits may a slot stand beside the weapon panel, down to the
// centred plaques. Each column is its own card; a section that goes on in the
// next column repeats its heading there («Mes bonus (suite)»).
//
// The content densifies step by step (SHEET_MODES), every step keeping every
// bonus and every changed number on screen, never under 11 px, never
// scrolled, never cut with an ellipsis:
//   0 everything · 1 without the «prochaine prise» lines · 2 tighter, 12 px
//   3 one line per bonus (its numbers are in Mes chiffres and the weapon)
//   4 the same at 11 px · 5 no Mes chiffres: each bonus row carries its own
//   effect, wrapped, and the weapon shows its values now only · 6 the same
//   without the weapon lines (the bonus effects still say what they give).
export const SHEET_GAP = 8;
export const SHEET_COLUMN_GAP = 8;
// The smallest slot worth a column, in CSS px.
export const SHEET_MIN_SLOT = 60;
// While the sheet shows, the breach alert stands beside the score, level
// with it (sheetBreachRight): the slots below it start under it. «12
// BRÈCHES» is about 110 px wide.
export const SHEET_BREACH_BAND = 28;
export const SHEET_BREACH_WIDTH = 130;
// Column widths in CSS px: [ideal, minimum] per density.
export const SHEET_COLUMN_WIDTH = Object.freeze([[300, 240], [300, 240], [280, 210], [260, 170], [240, 160], [260, 150], [260, 150]].map(Object.freeze));
export const SHEET_MODES = Object.freeze([
  [0, 1], [1, 1], [2, 1], [1, 2], [2, 2],
  [3, 1], [3, 2], [4, 1], [4, 2], [3, 3], [4, 3],
  [5, 1], [5, 2], [5, 3], [6, 1], [6, 2], [6, 3],
].map(([density, columns]) => Object.freeze({ density, columns })));

// The HUD around the sheet, in viewport coordinates. `score`, `weapon` and
// `wave` are rectangles (the wave panel may be missing); `null` while the HUD
// is not laid out. Small changes of the wave panel's size are rounded up so
// a counter going from 9 to 10 does not move the sheet.
export function sheetRegion({ viewport, score = null, weapon, wave = null }) {
  if (!weapon || !(weapon.right > weapon.left) || !viewport) return null;
  const width = viewport.width, height = viewport.height, centre = width / 2;
  const scoreTop = Number.isFinite(score?.top) ? score.top : 0, scoreBottom = Number.isFinite(score?.bottom) ? score.bottom : scoreTop;
  const up = (value, step) => Math.ceil(value / step) * step;
  const region = {
    viewport: { width, height }, centre,
    weapon: { left: Math.floor(weapon.left), right: Math.floor(weapon.right), top: Math.ceil(weapon.top), bottom: Math.floor(weapon.bottom) },
    score: { left: Math.floor(score?.left ?? width), right: Math.ceil(score?.right ?? width) },
    // Left of the score, the slots start level with it; under the breach
    // alert's place, below it; under the score, below the score.
    top: Math.ceil(scoreTop),
    breach: { left: Math.floor((score?.left ?? width) - SHEET_GAP - SHEET_BREACH_WIDTH), bottom: Math.ceil(scoreTop + SHEET_BREACH_BAND) },
    underScore: Math.ceil(scoreBottom + SHEET_GAP),
    wave: wave && wave.right > wave.left ? { left: Math.floor(centre - up(centre - wave.left, 16)), right: Math.ceil(centre + up(wave.right - centre, 16)), bottom: up(wave.bottom, 8) } : null,
    // The crosshair keeps its room.
    minLeft: Math.ceil(centre + Math.max(80, width * .07)),
    // The centred plaques at the bottom (end-of-wave card, pickups, next
    // wave, downed notice): a slot beside the weapon panel stops above them.
    // (the end-of-wave card is about 120 px tall, 128 px above the bottom).
    plaques: { left: Math.floor(centre - 230), right: Math.ceil(centre + 230), top: Math.floor(Math.min(height * .69, height - 240)) },
  };
  region.key = JSON.stringify([region.viewport, region.weapon, region.score, region.top, region.breach, region.underScore, region.wave]);
  return region;
}

const crosses = (left, right, from, to) => left < to && right > from;
// One slot between `left` and `right`.
export function sheetSlot(region, left, right, { beside = false } = {}) {
  let top = region.top;
  if (crosses(left, right, region.breach.left, Infinity)) top = Math.max(top, region.breach.bottom);
  if (crosses(left, right, region.score.left - SHEET_GAP, Infinity)) top = Math.max(top, region.underScore);
  if (region.wave && crosses(left, right, region.wave.left - SHEET_GAP, region.wave.right + SHEET_GAP)) top = Math.max(top, region.wave.bottom + SHEET_GAP);
  let bottom = region.weapon.top - SHEET_GAP;
  if (beside && !crosses(left, right, region.weapon.left - SHEET_GAP, Infinity)) {
    bottom = region.weapon.bottom;
    if (crosses(left, right, region.plaques.left, region.plaques.right)) bottom = Math.min(bottom, region.plaques.top - SHEET_GAP);
  }
  return { left, right, top, bottom, height: Math.max(0, bottom - top) };
}

// The slots of one mode, left to right: `columns` slots of `width` placed
// from `anchor` leftwards (a slot too short for a column is skipped and left
// empty), or null when they run into the crosshair's room. `aligned` gives
// them one common top, the lowest of them. With `beside`, a slot that would
// straddle the weapon panel's left edge moves left of it, to go down beside it.
export function sheetSlots(region, { width, columns, anchor = region.weapon.right, beside = false, aligned = false }) {
  const slots = [], edge = region.weapon.left - SHEET_GAP;
  for (let right = anchor; slots.length < columns; right -= width + SHEET_COLUMN_GAP) {
    if (beside && right > edge && right - width < edge) right = edge;
    const left = right - width;
    if (left < region.minLeft) return null;
    const slot = sheetSlot(region, left, right, { beside });
    if (slot.height >= SHEET_MIN_SLOT) slots.unshift(slot);
  }
  if (!aligned) return slots;
  const top = Math.max(...slots.map(slot => slot.top));
  const even = slots.map(slot => ({ ...slot, top, height: Math.max(0, slot.bottom - top) }));
  return even.every(slot => slot.height >= SHEET_MIN_SLOT) ? even : null;
}

// Distributes the measured blocks into columns of the given content heights,
// in reading order (top to bottom, left to right). A heading never ends a
// column (it goes with its first row); a section that goes on in the next
// column repeats its heading there, so no row ever sits under another
// section's heading. When a single section shows (`repeat` false), there is
// nothing to mix up and no copy is made. Returns the columns as lists of
// { index, repeat } (repeat: the heading copied above a continued section),
// or null when the blocks do not fit.
export function distributeSheet(blocks, capacities, { repeat: repeating = true } = {}) {
  const columns = capacities.map(capacity => ({ capacity, used: 0, items: [] }));
  let index = 0, heading = -1;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind === 'heading') heading = i;
    else if (block.kind === 'head') heading = -1;
    const following = blocks[i + 1];
    const need = block.height + (block.kind === 'heading' && following?.kind === 'item' && following.section === block.section ? following.height : 0);
    for (;;) {
      const column = columns[index];
      if (!column) return null;
      const repeat = repeating && block.kind === 'item' && column.items.length === 0 && heading >= 0 && blocks[heading].section === block.section ? blocks[heading].height : 0;
      if (column.used + repeat + need <= column.capacity) {
        if (repeat) { column.items.push({ index: heading, repeat: true }); column.used += repeat; }
        column.items.push({ index: i, repeat: false }); column.used += block.height;
        break;
      }
      // A block too tall for an empty column fits nowhere better.
      if (column.items.length === 0) return null;
      index++;
    }
  }
  return columns;
}

// The columns for some slots, with the lowest common bottom line that fits
// (so the columns come out balanced), or null. `chrome` is a card's padding
// and borders.
export function fillSlots(slots, blocks, chrome) {
  const capacities = bottom => slots.map(slot => Math.max(0, Math.min(slot.bottom, bottom) - slot.top - chrome));
  // Headings are repeated only when two sections or more are on screen.
  const options = { repeat: new Set(blocks.filter(block => block.kind === 'item' && block.height > 0).map(block => block.section)).size > 1 };
  const lowest = Math.max(...slots.map(slot => slot.bottom));
  if (!distributeSheet(blocks, capacities(lowest), options)) return null;
  let low = Math.min(...slots.map(slot => slot.top)), high = lowest;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (distributeSheet(blocks, capacities(middle), options)) high = middle; else low = middle;
  }
  const columns = distributeSheet(blocks, capacities(high), options);
  return { bottom: high, columns: columns.map((column, index) => ({ slot: slots[index], items: column.items })).filter(column => column.items.length) };
}

// The first mode (in SHEET_MODES order) whose columns fit, trying for each
// the slots under the score with one common top, then stepped up beside the
// score; only when no mode fits there, slots beside the weapon panel too.
// `measure(density, width)` gives { blocks: [{ kind, section, height }],
// chrome, overflow }. When nothing fits at all: the densest mode in the
// roomiest slots, cut at the bottom (`clipped`), never scrolled.
export function chooseSheetLayout(region, measure, modes = SHEET_MODES) {
  const measured = new Map();
  const sizes = (density, width) => {
    const key = `${density}/${width}`;
    if (!measured.has(key)) measured.set(key, measure(density, width));
    return measured.get(key);
  };
  // Columns share the room from the anchor to the crosshair's clearance, or
  // only to the wave panel's right edge (so they can start beside the score
  // rather than under the wave panel).
  const limits = [...new Set([region.wave ? Math.max(region.minLeft, region.wave.right + SHEET_GAP) : region.minLeft, region.minLeft])];
  const widthsFor = (mode, anchor, beside) => [...new Set(limits.flatMap(limit => {
    const [ideal, minimum] = SHEET_COLUMN_WIDTH[mode.density];
    const shared = Math.floor(Math.min(ideal, (anchor - limit - (mode.columns - 1) * SHEET_COLUMN_GAP) / mode.columns));
    // Beside the weapon panel, a column as wide as the room left of it.
    const left = beside ? Math.floor(Math.min(ideal, region.weapon.left - SHEET_GAP - limit)) : 0;
    return [shared, left].filter(width => width >= minimum);
  }))];
  const attempts = [
    ...modes.flatMap(mode => [{ mode, aligned: true }, { mode, aligned: false }].map(variant => ({ ...variant, anchor: region.weapon.right, beside: false }))),
    // Beside the weapon panel: from its right edge, from its left edge, or
    // from the score's left edge (a short column above the weapon panel and
    // a tall one beside it).
    ...modes.flatMap(mode => [...new Set([region.weapon.right, region.weapon.left - SHEET_GAP, Math.min(region.weapon.right, region.score.left - SHEET_GAP)])]
      .map(anchor => ({ mode, anchor, aligned: false, beside: true }))),
  ].flatMap(attempt => widthsFor(attempt.mode, attempt.anchor, attempt.beside).map(width => ({ ...attempt, width })));
  let roomiest = null;
  for (const { mode, anchor, aligned, beside, width } of attempts) {
    const slots = sheetSlots(region, { width, columns: mode.columns, anchor, beside, aligned });
    if (!slots) continue;
    const { blocks, chrome, overflow } = sizes(mode.density, width);
    if (mode.density === modes.at(-1).density) {
      const room = slots.reduce((sum, slot) => sum + slot.height, 0);
      if (!roomiest || room > roomiest.room) roomiest = { room, mode, width, slots, blocks, chrome, beside };
    }
    if (overflow) continue;
    const filled = fillSlots(slots, blocks, chrome);
    if (filled) return { ...mode, width, beside, aligned, bottom: filled.bottom, columns: filled.columns };
  }
  if (!roomiest) return null;
  // Cut: the blocks fill the columns in order, the rest goes under the last.
  const { mode, width, slots, blocks, chrome, beside } = roomiest;
  const columns = slots.map(slot => ({ slot, items: [], used: 0 }));
  let index = 0;
  blocks.forEach((block, i) => {
    while (index < columns.length - 1 && columns[index].items.length && columns[index].used + block.height > columns[index].slot.height - chrome) index++;
    columns[index].items.push({ index: i, repeat: false }); columns[index].used += block.height;
  });
  return { ...mode, width, beside, aligned: false, clipped: true, bottom: Math.max(...slots.map(slot => slot.bottom)), columns: columns.filter(column => column.items.length) };
}

const rectOf = node => {
  if (!node || node.hidden || typeof node.getBoundingClientRect !== 'function') return null;
  const box = node.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? box : null;
};
// The region from the live DOM, or null while the HUD is not laid out.
export function measureSheetRegion({ viewport, score, weapon, wave }) {
  const weaponBox = rectOf(weapon);
  if (!weaponBox) return null;
  return sheetRegion({ viewport, score: rectOf(score), weapon: weaponBox, wave: rectOf(wave) });
}

// Places and sizes the sheet in the live DOM: one measuring pass per density
// and column width tried (only when the content or the room changes), then
// the chosen columns as cards. Returns the layout and the sheet's outer box.
export function placeSurvivorSheet(sheet, region, { document = sheet?.ownerDocument, continued = '' } = {}) {
  if (!sheet || sheet.hidden || !region || !document || typeof sheet.getBoundingClientRect !== 'function') return null;
  const blocks = [...sheet.querySelectorAll('[data-block]')].filter(node => node.dataset.repeat !== 'true');
  if (!blocks.length) return null;
  const style = sheet.style;
  const card = document.createElement('div');
  card.className = 'sheet-col';
  card.append(...blocks);
  sheet.replaceChildren(card);
  style.left = '0px'; style.top = '0px'; style.width = `${region.viewport.width}px`; style.height = 'auto';
  const measure = (density, width) => {
    sheet.className = `survivor-sheet density-${density}`;
    card.style.width = `${width}px`;
    const heights = blocks.map(node => node.getBoundingClientRect().height);
    const chrome = Math.max(0, card.getBoundingClientRect().height - heights.reduce((sum, value) => sum + value, 0));
    return { blocks: blocks.map((node, index) => ({ kind: node.dataset.block, section: node.dataset.section, height: heights[index] })), chrome, overflow: card.scrollWidth > card.clientWidth + 1 };
  };
  const layout = chooseSheetLayout(region, measure);
  if (!layout) {
    // No room at all (a tiny window): nothing shows, the blocks wait.
    sheet.className = 'survivor-sheet'; card.hidden = true; style.width = '0px';
    return null;
  }
  sheet.className = `survivor-sheet density-${layout.density}${layout.clipped ? ' clipped' : ''}${layout.beside ? ' sheet-beside' : ''}`;
  const left = Math.min(...layout.columns.map(column => column.slot.left)), top = Math.min(...layout.columns.map(column => column.slot.top));
  const right = Math.max(...layout.columns.map(column => column.slot.right));
  style.left = `${left}px`; style.top = `${top}px`; style.width = `${right - left}px`; style.height = `${layout.bottom - top}px`;
  const cards = layout.columns.map(column => {
    const node = document.createElement('div');
    node.className = 'sheet-col';
    node.style.left = `${column.slot.left - left}px`; node.style.top = `${column.slot.top - top}px`; node.style.width = `${layout.width}px`;
    if (layout.clipped) node.style.maxHeight = `${column.slot.bottom - column.slot.top}px`;
    for (const item of column.items) {
      if (!item.repeat) { node.append(blocks[item.index]); continue; }
      // «Mes bonus (suite)»: the heading again where its section goes on.
      const copy = blocks[item.index].cloneNode(true);
      copy.dataset.repeat = 'true'; copy.setAttribute?.('aria-hidden', 'true');
      if (continued) {
        const mark = document.createElement('small');
        mark.className = 'sheet-continued'; mark.textContent = ` ${continued}`;
        copy.append(mark);
      }
      node.append(copy);
    }
    return node;
  });
  sheet.replaceChildren(...cards);
  // The outer box of the cards as laid out (interaction plaques avoid it).
  const boxes = cards.map(node => { const box = node.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }; });
  const outer = { left: Math.min(...boxes.map(box => box.left)), top: Math.min(...boxes.map(box => box.top)), right: Math.max(...boxes.map(box => box.right)), bottom: Math.max(...boxes.map(box => box.bottom)) };
  return { density: layout.density, columns: layout.columns.length, width: layout.width, beside: layout.beside, clipped: layout.clipped === true, rect: outer, cards: boxes };
}

// Where a teammate's chain feed and the companions' callouts go while the
// sheet shows (`cards`: the sheet's column boxes). Never towards the
// crosshair: the feed's left edge stays right of the crosshair's room.
//  · 'default': its usual place (right edge, 40 % down) when the sheet leaves
//    it free: nothing changes (null);
//  · 'beside': else just left of the weapon panel, above the centred plaques,
//    the newest three lines, when that room is wide enough and free;
//  · 'over': else stacked up from just above the weapon panel, right-aligned
//    with it, over the sheet's last lines for the few seconds a line lasts
//    (the newest three, on an opaque background).
// Pure: CSS pixel values for the feed's style.
export const SHEET_FEED_WIDTH = 300;
export const SHEET_FEED_HEIGHT = 100;
export function sheetFeedPlace(region, cards = []) {
  if (!region) return null;
  const { viewport, weapon } = region;
  const free = (left, top, right, bottom) => !cards.some(card => card.left < right && card.right > left && card.top < bottom && card.bottom > top);
  const usual = { right: viewport.width - 35, top: viewport.height * .4 };
  if (free(Math.max(region.minLeft, usual.right - SHEET_FEED_WIDTH), usual.top, usual.right, usual.top + SHEET_FEED_HEIGHT)) return null;
  const edge = weapon.left - SHEET_GAP, floor = Math.min(weapon.bottom, region.plaques.top - SHEET_GAP);
  const room = Math.min(SHEET_FEED_WIDTH, edge - region.minLeft);
  if (room >= 180 && free(edge - room, floor - SHEET_FEED_HEIGHT, edge, floor))
    return { mode: 'beside', right: Math.round(viewport.width - edge), bottom: Math.round(viewport.height - floor), maxWidth: Math.round(room), maxHeight: SHEET_FEED_HEIGHT };
  return { mode: 'over',
    right: Math.max(0, Math.round(viewport.width - weapon.right)),
    bottom: Math.max(0, Math.round(viewport.height - weapon.top + 8)),
    maxWidth: Math.max(0, Math.round(Math.min(SHEET_FEED_WIDTH, weapon.right - region.minLeft))),
    maxHeight: Math.max(0, Math.min(SHEET_FEED_HEIGHT, Math.round(weapon.top - 8 - region.underScore))),
  };
}

// Where the breach alert stands while the sheet shows: level with the score,
// just left of it (CSS gives the top), whatever the score's width.
export function sheetBreachRight(region) {
  return region ? Math.max(0, Math.round(region.viewport.width - region.score.left + SHEET_GAP)) : null;
}
