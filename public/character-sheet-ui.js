// The optional character sheet in the home menu, the lobby and the results:
// a native select (Standard, the ready-made characters, the saved custom
// ones, «Créer un personnage…»), a compact card and a small editor. The rules
// come from character-sheet.js; text from the injected t() (i18n.js), so the
// page and its tests share one language state. No user text enters HTML:
// names are textContent, icons are fixed local markup.
import { SHEET_STATS, SHEET_STAT_IDS, SHEET_PRESETS, SHEET_PRESET_IDS, SHEET_LIMITS, normalizeSheet, sheetProblem, sheetName, sheetTotals, sheetStat } from './character-sheet.js';
import { bonusIcon } from './bonus-icons.js';

export const CHARACTERS_KEY = 'deadwood-characters-v1';
export const CHARACTER_KEY = 'deadwood-character-v1';
export const MAX_CUSTOM_CHARACTERS = 6;
export const CREATE_CHARACTER = '__create__';
// A seat's saved character that this browser does not store (see adopt).
export const SEAT_CHARACTER = '__seat__';
const CUSTOM_PREFIX = 'custom:';
const own = (object, key) => object && typeof object === 'object' && Object.hasOwn(object, key) ? object[key] : undefined;

// Signed values with a real minus sign: «+2», «−1», «0».
export const signedValue = value => value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0';

// Saved custom characters: at most six, each a valid sheet. Anything else in
// storage is skipped rather than trusted; a blocked storage reads as empty.
export function readCharacters(storage) {
  let raw;
  try { raw = JSON.parse(storage?.getItem(CHARACTERS_KEY) ?? 'null'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const list = [], seen = new Set();
  for (const item of raw) {
    if (list.length >= MAX_CUSTOM_CHARACTERS) break;
    const id = own(item, 'id'), stats = own(item, 'stats');
    if (typeof id !== 'string' || !/^c\d{1,6}$/.test(id) || seen.has(id) || sheetProblem(stats)) continue;
    const sheet = normalizeSheet({ name: own(item, 'name'), stats });
    seen.add(id); list.push({ id, name: sheet.name, stats: sheet.stats });
  }
  return list;
}
export function writeCharacters(storage, list) {
  try { storage.setItem(CHARACTERS_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM_CHARACTERS).map(({ id, name, stats }) => ({ id, name, stats })))); return true; }
  catch { return false; }
}
const validChoice = (value, characters) => typeof value === 'string'
  && (Object.hasOwn(SHEET_PRESETS, value) || (value.startsWith(CUSTOM_PREFIX) && characters.some(item => CUSTOM_PREFIX + item.id === value)));
export function readCharacterChoice(storage, characters = readCharacters(storage)) {
  try { const value = storage?.getItem(CHARACTER_KEY); return validChoice(value, characters) ? value : 'standard'; } catch { return 'standard'; }
}
export function writeCharacterChoice(storage, value) {
  try { storage.setItem(CHARACTER_KEY, value); return true; } catch { return false; }
}
// The sheet a choice stands for, exactly as the server will normalise it.
export function sheetForChoice(choice, characters = []) {
  if (typeof choice === 'string' && Object.hasOwn(SHEET_PRESETS, choice)) return normalizeSheet({ preset: choice });
  const custom = typeof choice === 'string' && choice.startsWith(CUSTOM_PREFIX) ? characters.find(item => CUSTOM_PREFIX + item.id === choice) : null;
  return custom ? normalizeSheet({ name: custom.name, stats: custom.stats }) : normalizeSheet(null);
}

// «Le Bûcheron», a custom name, or a neutral word; never server HTML.
export function characterLabel(character, t) {
  const name = sheetName(own(character, 'name')), preset = own(character, 'preset');
  return name || (typeof preset === 'string' && Object.hasOwn(SHEET_PRESETS, preset) ? t(`sheet.preset.${preset}`) : t('sheet.custom'));
}
// «Force +2 · Bricolage −1 · Chimie −1»: plus points first, then minus, in
// stat order; empty for the standard sheet.
export function characterChips(character, t) {
  const values = SHEET_STAT_IDS.map((id, index) => ({ id, index, value: sheetStat(character, id) })).filter(item => item.value);
  values.sort((a, b) => Math.sign(b.value) - Math.sign(a.value) || b.value - a.value || a.index - b.index);
  return values.map(({ id, value }) => t('sheet.chip', { stat: t(`sheet.stat.${id}`), value: signedValue(value) })).join(' · ');
}
// One comparable line per sheet, server snapshot or local choice alike.
const sheetKey = value => JSON.stringify([own(value, 'preset') ?? null, sheetName(own(value, 'name')), SHEET_STAT_IDS.map(id => sheetStat(value, id))]);

export function createCharacterPicker({ document, storage = null, t, byId, onChange = () => {} }) {
  const $ = byId ?? (id => document.getElementById(id));
  let characters = readCharacters(storage), choice = readCharacterChoice(storage, characters), draft = null, storageKept = true;
  // A seat's saved character known only from the save: offered while this
  // page lives, never stored unless the player keeps it from the editor.
  let seated = null;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const stored = () => [...SHEET_PRESET_IDS, ...characters.map(item => CUSTOM_PREFIX + item.id)];
  const choices = () => [...stored(), ...(seated ? [SEAT_CHARACTER] : [])];
  const optionLabel = value => value === SEAT_CHARACTER ? t('sheet.fromSave', { name: characterLabel(seated, t) })
    : value.startsWith(CUSTOM_PREFIX) ? characterLabel(characters.find(item => CUSTOM_PREFIX + item.id === value), t) : t(`sheet.preset.${value}`);
  const valid = value => value === SEAT_CHARACTER ? Boolean(seated) : validChoice(value, characters);
  const persist = written => { if (!written) storageKept = false; };
  const sheet = () => choice === SEAT_CHARACTER && seated ? normalizeSheet(seated) : sheetForChoice(choice, characters);
  // The preset or saved character that is exactly this sheet, if any.
  const storedChoice = character => stored().find(value => sheetKey(sheetForChoice(value, characters)) === sheetKey(character)) ?? null;
  // Kept in this browser (here or in another tab): the save's copy goes.
  const settleSeat = () => {
    const match = seated ? storedChoice(seated) : null;
    if (!match) return;
    if (choice === SEAT_CHARACTER) choice = match;
    seated = null;
  };
  // Another tab of this browser may have saved or deleted characters since
  // this page read them: every change starts from the stored list, never from
  // a stale copy. A blocked storage, or one that refused a write, keeps this
  // page's own list.
  const latest = () => {
    if (!storage || !storageKept) return characters;
    try { storage.getItem(CHARACTERS_KEY); } catch { return characters; }
    return readCharacters(storage);
  };
  const editingId = () => draft?.id && characters.some(item => item.id === draft.id) ? draft.id : null;
  // «Personnage N» for a blank name: the lowest number no other character
  // uses, so a deletion never leaves two identical options.
  const defaultName = except => {
    const taken = new Set(characters.filter(item => item.id !== except).map(item => item.name));
    let number = 1; while (taken.has(t('sheet.unnamed', { number }))) number++;
    return t('sheet.unnamed', { number });
  };
  // Five −2..+2 pips around a centre mark, minus side and plus side.
  const pips = (stat, value) => {
    const group = element('span', 'character-pips');
    group.setAttribute('role', 'img');
    group.setAttribute('aria-label', t('sheet.value', { stat: t(`sheet.stat.${stat.id}`), value: signedValue(value) }));
    for (let at = SHEET_LIMITS.min; at <= SHEET_LIMITS.max; at++) {
      const pip = element('i', at === 0 ? 'character-pip centre' : 'character-pip');
      if (at < 0 && value <= at) pip.className += ' minus';
      if (at > 0 && value >= at) pip.className += ' plus';
      group.append(pip);
    }
    return group;
  };
  const icons = stat => {
    const group = element('span', 'character-icons');
    group.innerHTML = stat.bonuses.map(bonusIcon).join('');
    group.title = t('sheet.family', { names: stat.bonuses.map(kind => t(`bonus.${kind}`)).join(', ') });
    return group;
  };
  const statRow = (stat, value) => {
    const row = element('div', 'character-stat');
    row.dataset.stat = stat.id; row.dataset.value = String(value); row.title = t(`sheet.statDetail.${stat.id}`);
    row.append(element('span', 'character-stat-label', t(`sheet.stat.${stat.id}`)), pips(stat, value), element('b', 'character-stat-value', signedValue(value)), icons(stat));
    return row;
  };
  // Made once per set of choices and language, then updated in place: a
  // select focused with the keyboard or the controller keeps its focus.
  function fillSelect(select, creation) {
    if (!select) return;
    const values = [...choices(), ...(creation ? [CREATE_CHARACTER] : [])];
    const key = JSON.stringify([t('sheet.label'), values, values.map(value => value === CREATE_CHARACTER ? t('sheet.create') : optionLabel(value))]);
    if (select.dataset.renderKey !== key) {
      select.dataset.renderKey = key;
      select.replaceChildren(...values.map(value => {
        const option = element('option', '', value === CREATE_CHARACTER ? t('sheet.create') : optionLabel(value));
        option.value = value; return option;
      }));
    }
    if (select.value !== choice) select.value = choice;
  }
  function choose(value) {
    if (!valid(value)) return false;
    choice = value; if (value !== SEAT_CHARACTER) persist(writeCharacterChoice(storage, choice));
    render(); onChange(sheet());
    return true;
  }
  function openEditor(next) {
    draft = { id: next.id ?? null, name: next.name ?? '', stats: Object.fromEntries(SHEET_STAT_IDS.map(id => [id, sheetStat(next, id)])) };
    const name = $('character-name'); if (name) name.value = draft.name;
    render();
    name?.focus?.();
  }
  function closeEditor() { draft = null; render(); $('character-select')?.focus?.(); }
  function renderEditor() {
    const editor = $('character-editor'); if (!editor) return;
    editor.hidden = !draft;
    if (!draft) return;
    const rows = $('character-stats'), totals = sheetTotals(draft.stats), problem = sheetProblem(draft.stats);
    const full = !editingId() && characters.length >= MAX_CUSTOM_CHARACTERS;
    // Rows are made once per language, then updated in place: the − / +
    // button pressed with the keyboard or the controller keeps the focus.
    const key = t('sheet.label');
    if (rows.dataset.renderKey !== key) {
      rows.dataset.renderKey = key;
      rows.replaceChildren(...SHEET_STATS.map(stat => {
        const label = t(`sheet.stat.${stat.id}`);
        const row = element('div', 'character-edit-row'); row.dataset.stat = stat.id;
        const heading = element('div', 'character-edit-heading');
        heading.append(element('strong', 'character-stat-label', label), icons(stat));
        const minus = element('button', 'character-step minus', '−'), plus = element('button', 'character-step plus', '+');
        minus.type = plus.type = 'button';
        minus.setAttribute('aria-label', t('sheet.minus', { stat: label })); plus.setAttribute('aria-label', t('sheet.plus', { stat: label }));
        // A press that reaches ±2 or the two moved points disables its own
        // button: the focus moves to the other one in the row, so the next
        // keyboard or controller step does not restart from the top of #menu.
        const step = (button, change, other) => () => {
          if (button.disabled || !draft) return;
          draft.stats[stat.id] += change; renderEditor();
          if (button.disabled) (other.disabled ? $('character-name') : other)?.focus?.();
        };
        minus.onclick = step(minus, -1, plus); plus.onclick = step(plus, 1, minus);
        row.append(heading, minus, element('output', 'character-step-value'), plus, element('small', 'character-stat-detail', t(`sheet.statDetail.${stat.id}`)));
        return row;
      }));
    }
    for (const row of rows.children) {
      const value = draft.stats[row.dataset.stat], [, minus, shown, plus] = row.children;
      // Never past −2/+2, never more than two points out or in, even mid-edit.
      minus.disabled = value <= SHEET_LIMITS.min || (value <= 0 && totals.minus >= SHEET_LIMITS.moved);
      plus.disabled = value >= SHEET_LIMITS.max || (value >= 0 && totals.plus >= SHEET_LIMITS.moved);
      shown.textContent = signedValue(value);
    }
    $('character-moved').textContent = t('sheet.moved', { count: Math.max(totals.plus, totals.minus), max: SHEET_LIMITS.moved });
    const issue = $('character-issue');
    issue.textContent = full ? t('sheet.issue.full') : problem === 'sum'
      ? t(totals.sum > 0 ? (totals.sum === 1 ? 'sheet.issue.removeOne' : 'sheet.issue.removeMany') : (totals.sum === -1 ? 'sheet.issue.addOne' : 'sheet.issue.addMany'), { count: Math.abs(totals.sum) })
      : t('sheet.balanced');
    issue.classList?.toggle('valid', !problem && !full);
    $('character-save').disabled = Boolean(problem) || full;
    $('character-delete').hidden = !editingId();
  }
  function render() {
    fillSelect($('character-select'), true);
    const select = $('character-select'); if (select) select.disabled = Boolean(draft);
    const current = sheet(), card = $('character-card');
    if (card) {
      card.hidden = Boolean(draft);
      card.replaceChildren(element('strong', 'character-card-name', characterLabel(current, t)),
        element('p', 'character-card-story', current.preset ? t(`sheet.story.${current.preset}`) : t('sheet.customStory')),
        ...SHEET_STATS.map(stat => statRow(stat, current.stats[stat.id])));
    }
    const edit = $('character-edit');
    if (edit) { edit.hidden = Boolean(draft); edit.textContent = t(choice.startsWith(CUSTOM_PREFIX) ? 'sheet.edit' : choice === SEAT_CHARACTER ? 'sheet.keep' : 'sheet.customize'); }
    const note = $('character-storage-note'); if (note) note.hidden = storageKept;
    renderEditor();
  }
  // Save and Delete hide the editor: the focus goes back to the select, as
  // Cancel does, rather than to the top of the menu.
  function save() {
    if (!draft || sheetProblem(draft.stats)) return false;
    characters = latest();
    // Edited here but deleted in another tab: saved again as a new one.
    const editing = editingId();
    if (!editing && characters.length >= MAX_CUSTOM_CHARACTERS) { render(); return false; }
    const next = editing ?? `c${Math.max(0, ...characters.map(item => Number(item.id.slice(1)))) + 1}`;
    const normal = normalizeSheet({ name: sheetName($('character-name')?.value ?? draft.name) || defaultName(editing), stats: draft.stats });
    const entry = { id: next, name: normal.name, stats: normal.stats };
    characters = editing ? characters.map(item => item.id === editing ? entry : item) : [...characters, entry];
    persist(writeCharacters(storage, characters));
    draft = null; choice = CUSTOM_PREFIX + next; persist(writeCharacterChoice(storage, choice)); settleSeat();
    render(); $('character-select')?.focus?.(); onChange(sheet());
    return true;
  }
  function remove() {
    if (!draft?.id) return false;
    const removed = CUSTOM_PREFIX + draft.id;
    characters = latest().filter(item => item.id !== draft.id);
    persist(writeCharacters(storage, characters));
    draft = null;
    const changed = choice === removed;
    if (changed) { choice = 'standard'; persist(writeCharacterChoice(storage, choice)); }
    render(); $('character-select')?.focus?.(); if (changed) onChange(sheet());
    return true;
  }
  // The stored list changed in another tab: show it, and follow it when the
  // chosen character was edited or deleted there.
  function refresh() {
    const before = sheetKey(sheet());
    characters = latest();
    if (!valid(choice)) choice = 'standard';
    settleSeat(); render();
    if (sheetKey(sheet()) !== before) onChange(sheet());
  }
  const select = $('character-select');
  if (select) select.onchange = () => {
    if (select.value === CREATE_CHARACTER) { select.value = choice; openEditor({ stats: SHEET_PRESETS.standard }); return; }
    if (!choose(select.value)) select.value = choice;
  };
  const edit = $('character-edit');
  if (edit) edit.onclick = () => {
    const custom = characters.find(item => CUSTOM_PREFIX + item.id === choice);
    // The save's character keeps its name: Save stores it in this browser.
    openEditor(custom ? { id: custom.id, name: custom.name, stats: custom.stats } : { name: choice === SEAT_CHARACTER ? sheet().name : '', stats: sheet().stats });
  };
  const name = $('character-name');
  if (name) name.oninput = () => { if (draft) draft.name = name.value; };
  const saveButton = $('character-save'); if (saveButton) saveButton.onclick = () => save();
  const cancel = $('character-cancel'); if (cancel) cancel.onclick = () => closeEditor();
  const deleteButton = $('character-delete'); if (deleteButton) deleteButton.onclick = () => remove();
  render();
  return {
    sheet,
    // The plain standard character stays exactly today's join message.
    joinSheet() { const current = sheet(); return current.preset === 'standard' && !current.name ? null : current; },
    choice: () => choice,
    characters: () => characters.map(item => ({ ...item, stats: { ...item.stats } })),
    editing: () => Boolean(draft),
    render,
    // The page's `storage` event: only the saved list concerns the picker
    // (null: the whole storage was cleared).
    storageChanged(key) { if (key === CHARACTERS_KEY || key === null) refresh(); },
    // Whether the server's character is the one chosen here.
    applied: character => !character || sheetKey(character) === sheetKey(sheet()),
    // A seat taken back in a loaded night plays its saved character: this
    // page takes it as its own choice (not stored), so the select shows the
    // character in play and the next night keeps it unless the player picks
    // another. A character only the save knows is offered as «… (sauvegarde)»
    // while this page lives. True when the choice changed.
    adopt(character) {
      if (!character || typeof character !== 'object') return false;
      const normal = normalizeSheet(character);
      if (sheetKey(normal) === sheetKey(sheet())) return false;
      const match = storedChoice(normal);
      if (match) choice = match; else { seated = normal; choice = SEAT_CHARACTER; }
      render();
      return true;
    },
    // The lobby and results select: same choices without creation, which
    // lives on the home screen next to the editor.
    // `character` is the server's: while locked, a choice it has not taken
    // yet is said plainly instead of passing for the one in play. `seat`: a
    // seat taken back in a loaded night plays its saved character (adopted
    // as this page's choice) and cannot change it before that night ends.
    renderChoice(target, detail, { editable = true, character = null, locked = 'sheet.lobbyLocked', seat = false } = {}) {
      if (!target) return;
      fillSelect(target, false);
      target.disabled = !editable;
      target.onchange = () => { if (!editable || !choose(target.value)) target.value = choice; };
      if (detail) {
        const chips = characterChips(character ?? sheet(), t);
        const differs = Boolean(character) && sheetKey(character) !== sheetKey(sheet());
        const note = seat && character ? t('sheet.seatLocked', { current: characterLabel(character, t) })
          : (!editable && differs ? t('sheet.lobbyPending', { current: characterLabel(character, t), name: characterLabel(sheet(), t) }) : '') || t(editable ? 'sheet.lobbyDetail' : locked);
        detail.textContent = [chips, note].filter(Boolean).join(' · ');
      }
    },
  };
}
