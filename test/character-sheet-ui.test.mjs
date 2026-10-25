import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCharacterPicker, readCharacters, writeCharacters, readCharacterChoice, writeCharacterChoice, sheetForChoice, characterLabel, characterChips,
  signedValue, CHARACTERS_KEY, CHARACTER_KEY, MAX_CUSTOM_CHARACTERS, CREATE_CHARACTER, SEAT_CHARACTER } from '../public/character-sheet-ui.js';
import { SHEET_PRESETS, SHEET_STAT_IDS, normalizeSheet } from '../public/character-sheet.js';
import { SUPPLY_BONUSES } from '../public/weapon-upgrades.js';
import { sheetMalusEffect, bonusHudCard } from '../public/bonus-hud.js';
import { t, setLanguage } from '../public/i18n.js';

// The home picker, its editor and the lobby select on a small fake DOM: plain
// text everywhere, native controls, every storage access guarded.
class Element {
  constructor(tag = 'div', id = null) {
    Object.assign(this, { tagName: tag.toUpperCase(), id, children: [], dataset: {}, attributes: {}, hidden: false, disabled: false, textContent: '', className: '', title: '', html: '' });
    this.classList = { values: new Set(), toggle: (name, force) => { const on = force ?? !this.classList.values.has(name); if (on) this.classList.values.add(name); else this.classList.values.delete(name); return on; }, contains: name => this.classList.values.has(name) };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { focused = this; }
  get innerHTML() { return this.html; }
  set innerHTML(value) { this.html = value; }
  get text() { return [this.textContent, ...this.children.map(child => child.text)].filter(Boolean).join(' '); }
}
let focused = null;
const ids = ['character-select', 'character-card', 'character-edit', 'character-storage-note', 'character-editor', 'character-name', 'character-stats', 'character-moved',
  'character-issue', 'character-save', 'character-cancel', 'character-delete', 'lobby-select', 'lobby-detail'];
function storage(initial = {}, blocked = false) {
  const values = new Map(Object.entries(initial)), writes = [];
  return { values, writes,
    getItem(key) { if (blocked) throw new Error('blocked'); return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { if (blocked) throw new Error('blocked'); writes.push([key, value]); values.set(key, String(value)); } };
}
function harness(saved, { blocked = false } = {}) {
  const nodes = new Map(ids.map(id => [id, new Element(id === 'character-select' || id === 'lobby-select' ? 'select' : 'div', id)]));
  nodes.get('character-editor').hidden = true; nodes.get('character-delete').hidden = true;
  const store = saved?.getItem ? saved : storage(saved ?? {}, blocked), changes = [];
  const document = { createElement: tag => new Element(tag), getElementById: id => nodes.get(id) };
  const picker = createCharacterPicker({ document, storage: store, t, byId: id => nodes.get(id), onChange: sheet => changes.push(sheet) });
  const $ = id => nodes.get(id);
  const row = stat => $('character-stats').children.find(item => item.dataset.stat === stat);
  return { picker, $, store, changes,
    select(value) { $('character-select').value = value; $('character-select').onchange(); },
    options: () => $('character-select').children.map(option => [option.value, option.textContent]),
    press(stat, sign) { const button = row(stat).children[sign > 0 ? 3 : 1]; assert.equal(button.disabled, false, `${stat} ${sign}`); button.onclick(); },
    button: (stat, sign) => row(stat).children[sign > 0 ? 3 : 1], value: stat => row(stat).children[2].textContent };
}
const custom = (id, name, stats) => ({ id, name, stats: { strength: 0, agility: 0, ballistics: 0, tinkering: 0, chemistry: 0, ...stats } });

test('saved characters are validated, capped at six and survive a blocked storage', () => {
  const stored = [custom('c1', 'Kim', { strength: 1, agility: -1 }), custom('c1', 'Again', {}), { id: 'x9', name: 'Bad id', stats: {} },
    custom('c2', 'Cheat', { strength: 2, agility: 2, chemistry: -4 }), { id: 'c3', name: 'No stats' }, 'text', null,
    custom('c4', '  Léa\u0007  ', { chemistry: 2, strength: -2 }), ...[5, 6, 7, 8, 9, 10].map(n => custom(`c${n}`, `N${n}`, {}))];
  const list = readCharacters(storage({ [CHARACTERS_KEY]: JSON.stringify(stored) }));
  assert.deepEqual(list.map(item => item.id), ['c1', 'c4', 'c5', 'c6', 'c7', 'c8']);
  assert.equal(list.length, MAX_CUSTOM_CHARACTERS); assert.equal(list[1].name, 'Léa');
  for (const raw of ['not json', '{"c1":1}', 'null']) assert.deepEqual(readCharacters(storage({ [CHARACTERS_KEY]: raw })), []);
  const blocked = storage({}, true);
  assert.deepEqual(readCharacters(blocked), []); assert.equal(readCharacterChoice(blocked), 'standard');
  assert.equal(writeCharacters(blocked, list), false); assert.equal(writeCharacterChoice(blocked, 'pyro'), false);
  assert.equal(writeCharacters(null, list), false); assert.deepEqual(readCharacters(null), []);
  const written = storage(); assert.equal(writeCharacters(written, [...list, custom('c11', 'Extra', {})]), true);
  assert.equal(JSON.parse(written.values.get(CHARACTERS_KEY)).length, 6);
  assert.equal(readCharacterChoice(storage({ [CHARACTER_KEY]: 'custom:c4' }), list), 'custom:c4');
  for (const value of ['custom:c99', 'wizard', '__proto__', 'toString']) assert.equal(readCharacterChoice(storage({ [CHARACTER_KEY]: value }), list), 'standard', value);
  assert.deepEqual(sheetForChoice('custom:c4', list), { preset: null, name: 'Léa', stats: list[1].stats });
  assert.deepEqual(sheetForChoice('pyro', list), normalizeSheet({ preset: 'pyro' }));
});

test('the home select lists Standard, the six ready-made characters, saved ones and creation, with a card per choice', () => {
  setLanguage('fr');
  const ui = harness({ [CHARACTERS_KEY]: JSON.stringify([custom('c1', 'Kim', { strength: 1, agility: -1 })]) });
  assert.deepEqual(ui.options(), [['standard', 'Survivant'], ['lumberjack', 'Le Bûcheron'], ['mechanic', 'La Mécano'], ['hunter', 'La Chasseuse'],
    ['pyro', 'L’Artificier'], ['scout', 'La Scoute'], ['nurse', 'L’Infirmière'], ['custom:c1', 'Kim'], [CREATE_CHARACTER, 'Créer un personnage…']]);
  assert.equal(ui.$('character-select').value, 'standard'); assert.equal(ui.picker.joinSheet(), null, 'the standard join is unchanged');
  assert.equal(ui.$('character-edit').textContent, 'Personnaliser');
  ui.select('lumberjack');
  assert.deepEqual(ui.store.values.get(CHARACTER_KEY), 'lumberjack');
  assert.deepEqual(ui.changes.at(-1), normalizeSheet({ preset: 'lumberjack' })); assert.deepEqual(ui.picker.joinSheet(), normalizeSheet({ preset: 'lumberjack' }));
  const card = ui.$('character-card').children;
  assert.equal(card[0].textContent, 'Le Bûcheron'); assert.match(card[1].textContent, /fendait du bois/);
  const rows = card.slice(2);
  assert.deepEqual(rows.map(row => [row.dataset.stat, row.dataset.value]), [['strength', '2'], ['agility', '0'], ['ballistics', '0'], ['tinkering', '-1'], ['chemistry', '-1']]);
  const [label, pips, value, icons] = rows[0].children;
  assert.equal(label.textContent, 'Force'); assert.equal(value.textContent, '+2'); assert.equal(rows[3].children[2].textContent, '−1');
  assert.equal(pips.children.length, 5); assert.deepEqual(pips.children.map(pip => pip.className), ['character-pip', 'character-pip', 'character-pip centre', 'character-pip plus', 'character-pip plus']);
  assert.deepEqual(rows[4].children[1].children.map(pip => pip.className), ['character-pip', 'character-pip minus', 'character-pip centre', 'character-pip', 'character-pip']);
  assert.equal(pips.attributes['aria-label'], 'Force : +2');
  for (const kind of ['stone', 'vitality', 'rainproof', 'toughskin']) assert.match(icons.innerHTML, new RegExp(`/bonus-icons/${kind}\\.webp`));
  assert.match(icons.title, /Armes renforcées, Vitalité/);
  assert.match(rows[4].title, /^Grenades \(les pétards\)/, 'the HUD’s word, explained in kid-friendly, Famille-safe words');
  ui.select('custom:c1');
  assert.equal(ui.$('character-edit').textContent, 'Modifier'); assert.equal(ui.$('character-card').children[0].textContent, 'Kim');
  assert.match(ui.$('character-card').children[1].textContent, /fait maison/);
  // A choice saved earlier comes back on the next page load.
  assert.equal(harness(ui.store).$('character-select').value, 'custom:c1');
  ui.$('character-select').value = 'custom:c404'; ui.$('character-select').onchange();
  assert.equal(ui.$('character-select').value, 'custom:c1', 'an unknown choice is refused');
  setLanguage('en'); ui.picker.render();
  assert.deepEqual(ui.options().slice(0, 2), [['standard', 'Survivor'], ['lumberjack', 'The Lumberjack']]);
  assert.equal(ui.options().at(-1)[1], 'Create a character…'); assert.equal(ui.$('character-edit').textContent, 'Edit');
  setLanguage('fr');
});

test('the editor keeps −2..+2 and two moved points, explains a wrong total and saves only a valid sheet', () => {
  setLanguage('fr');
  const ui = harness();
  ui.select('pyro'); const changes = ui.changes.length;
  ui.select(CREATE_CHARACTER);
  assert.equal(ui.$('character-select').value, 'pyro', 'creation is not a choice');
  assert.equal(ui.changes.length, changes); assert.equal(ui.$('character-editor').hidden, false);
  assert.equal(ui.$('character-card').hidden, true); assert.equal(ui.$('character-select').disabled, true);
  assert.equal(focused, ui.$('character-name'));
  assert.deepEqual(SHEET_STAT_IDS.map(ui.value), ['0', '0', '0', '0', '0']);
  assert.equal(ui.$('character-moved').textContent, 'Points déplacés : 0 / 2');
  assert.equal(ui.$('character-save').disabled, false, 'an all-zero sheet is valid');
  assert.equal(ui.$('character-delete').hidden, true);
  const plus = ui.button('strength', 1);
  ui.press('strength', 1);
  assert.equal(ui.button('strength', 1), plus, 'the pressed button survives, so keyboard and controller focus stay on it');
  assert.equal(ui.$('character-save').disabled, true);
  assert.equal(ui.$('character-issue').textContent, 'Le total doit faire 0 : retire un point ailleurs.');
  ui.press('strength', 1);
  assert.equal(ui.$('character-issue').textContent, 'Le total doit faire 0 : retire 2 points ailleurs.');
  assert.equal(ui.$('character-moved').textContent, 'Points déplacés : 2 / 2');
  assert.equal(ui.button('strength', 1).disabled, true, 'never above +2');
  assert.equal(ui.button('agility', 1).disabled, true, 'never more than two points moved');
  ui.press('chemistry', -1); ui.press('chemistry', -1);
  assert.equal(ui.button('tinkering', -1).disabled, true, 'never more than two points taken');
  assert.equal(ui.button('chemistry', -1).disabled, true, 'never below −2');
  assert.equal(ui.$('character-issue').textContent, 'Équilibré : le total fait 0.');
  assert.equal(ui.$('character-save').disabled, false);
  ui.press('chemistry', 1);
  assert.equal(ui.$('character-issue').textContent, 'Le total doit faire 0 : retire un point ailleurs.');
  ui.press('tinkering', -1);
  assert.equal(ui.$('character-save').disabled, false);
  ui.$('character-name').value = '  Mamie\u0000 Jo  '; ui.$('character-name').oninput();
  ui.$('character-save').onclick();
  const saved = JSON.parse(ui.store.values.get(CHARACTERS_KEY));
  assert.deepEqual(saved, [custom('c1', 'Mamie Jo', { strength: 2, tinkering: -1, chemistry: -1 })]);
  assert.equal(ui.store.values.get(CHARACTER_KEY), 'custom:c1');
  assert.deepEqual(ui.changes.at(-1), { preset: null, name: 'Mamie Jo', stats: saved[0].stats });
  assert.equal(ui.$('character-editor').hidden, true); assert.equal(ui.$('character-select').disabled, false);
  // Modifier edits in place; a blank name gets a default one.
  ui.$('character-edit').onclick();
  assert.equal(ui.$('character-delete').hidden, false); assert.equal(ui.$('character-name').value, 'Mamie Jo');
  ui.press('strength', -1); ui.press('tinkering', 1);
  ui.$('character-name').value = '   '; ui.$('character-save').onclick();
  assert.deepEqual(JSON.parse(ui.store.values.get(CHARACTERS_KEY)), [custom('c1', 'Personnage 1', { strength: 1, chemistry: -1 })]);
  // Cancel discards; Supprimer removes and falls back to Standard.
  ui.$('character-edit').onclick(); ui.press('agility', 1); ui.$('character-cancel').onclick();
  assert.deepEqual(ui.picker.sheet().stats, { ...SHEET_PRESETS.standard, strength: 1, chemistry: -1 });
  ui.$('character-edit').onclick(); ui.$('character-delete').onclick();
  assert.deepEqual(JSON.parse(ui.store.values.get(CHARACTERS_KEY)), []);
  assert.equal(ui.picker.choice(), 'standard'); assert.equal(ui.changes.at(-1).preset, 'standard');
});

test('Personnaliser copies a ready-made character, and a seventh custom character cannot be saved', () => {
  setLanguage('fr');
  const full = Array.from({ length: 6 }, (_, index) => custom(`c${index + 1}`, `Perso ${index + 1}`, {}));
  const ui = harness({ [CHARACTERS_KEY]: JSON.stringify(full.slice(0, 5)), [CHARACTER_KEY]: 'nurse' });
  ui.$('character-edit').onclick();
  assert.deepEqual(SHEET_STAT_IDS.map(ui.value), ['−1', '+1', '−1', '0', '+1']);
  assert.equal(ui.$('character-name').value, '');
  ui.$('character-name').value = 'Ma nurse'; ui.$('character-save').onclick();
  assert.equal(ui.picker.choice(), 'custom:c6'); assert.deepEqual(ui.picker.sheet().stats, SHEET_PRESETS.nurse);
  assert.equal(ui.picker.sheet().preset, null, 'a copy is a custom character');
  ui.select('scout'); ui.$('character-edit').onclick();
  assert.equal(ui.$('character-save').disabled, true);
  assert.equal(ui.$('character-issue').textContent, '6 personnages au maximum : supprime-en un pour en créer un autre.');
  ui.$('character-save').onclick(); assert.equal(ui.picker.characters().length, 6);
});

test('a browser that blocks storage keeps characters for the page and says so', () => {
  const ui = harness({}, { blocked: true });
  assert.equal(ui.$('character-storage-note').hidden, true);
  ui.select(CREATE_CHARACTER); ui.press('agility', 1); ui.press('ballistics', -1);
  ui.$('character-name').value = 'Sam'; ui.$('character-save').onclick();
  assert.equal(ui.picker.choice(), 'custom:c1'); assert.equal(ui.picker.sheet().name, 'Sam');
  assert.equal(ui.$('character-storage-note').hidden, false);
});

test('lobby chips and labels are plain text, plus points first, and the lobby select changes or locks the choice', () => {
  setLanguage('fr');
  assert.equal(characterChips(normalizeSheet({ preset: 'lumberjack' }), t), 'Force +2 · Bricolage −1 · Chimie −1');
  assert.equal(characterChips(normalizeSheet({ preset: 'mechanic' }), t), 'Bricolage +2 · Force −1 · Agilité −1');
  assert.equal(characterChips(normalizeSheet({ preset: 'nurse' }), t), 'Agilité +1 · Chimie +1 · Force −1 · Balistique −1');
  assert.equal(characterChips(normalizeSheet(null), t), '');
  assert.equal(characterChips({ stats: { strength: 9, chemistry: '<b>' } }, t), 'Force +2', 'server values are bounded');
  assert.equal(characterLabel({ preset: 'pyro', name: '' }, t), 'L’Artificier');
  assert.equal(characterLabel({ preset: null, name: '<img src=x onerror=1>' }, t), '<img src=x onerror=1>', 'plain text, never parsed');
  assert.equal(characterLabel({ preset: 'constructor' }, t), 'Personnage');
  assert.equal(characterLabel(null, t), 'Personnage');
  assert.deepEqual([signedValue(2), signedValue(-1), signedValue(0)], ['+2', '−1', '0']);
  const ui = harness({ [CHARACTERS_KEY]: JSON.stringify([custom('c1', 'Kim', { strength: 1, agility: -1 })]) });
  const select = ui.$('lobby-select'), detail = ui.$('lobby-detail');
  ui.picker.renderChoice(select, detail, { editable: true, character: normalizeSheet(null) });
  assert.deepEqual(select.children.map(option => option.value), ['standard', 'lumberjack', 'mechanic', 'hunter', 'pyro', 'scout', 'nurse', 'custom:c1']);
  assert.equal(select.disabled, false); assert.match(detail.textContent, /avant la nuit/);
  const options = select.children;
  for (let frame = 0; frame < 30; frame++) ui.picker.renderChoice(select, detail, { editable: true });
  assert.equal(select.children, options, 'snapshots keep the same options for keyboard and controller focus');
  select.value = 'custom:c1'; select.onchange();
  assert.equal(ui.changes.at(-1).name, 'Kim'); assert.equal(ui.$('character-select').value, 'custom:c1', 'the home select follows');
  const kim = ui.picker.sheet();
  assert.equal(ui.picker.applied(kim), true); assert.equal(ui.picker.applied(null), true, 'an older server sends no character');
  ui.picker.renderChoice(select, detail, { editable: false, character: kim });
  assert.equal(select.disabled, true); assert.equal(detail.textContent, 'Force +1 · Agilité −1 · Personnage verrouillé pendant la nuit.');
  ui.picker.renderChoice(select, detail, { editable: false, character: kim, locked: 'sheet.lobbyPaused' });
  assert.equal(detail.textContent, 'Force +1 · Agilité −1 · Partie en pause : personnage verrouillé pour l’instant.');
  const sent = ui.changes.length; select.value = 'pyro'; select.onchange();
  assert.equal(ui.changes.length, sent); assert.equal(select.value, 'custom:c1');
  // The server still plays another character: the chips are its own, and the
  // select's choice is said to be waiting rather than passing for it.
  const hunter = normalizeSheet({ preset: 'hunter' });
  assert.equal(ui.picker.applied(hunter), false);
  ui.picker.renderChoice(select, detail, { editable: false, character: hunter });
  assert.equal(detail.textContent, 'Balistique +2 · Agilité −1 · Chimie −1 · En jeu : La Chasseuse. Ton choix, Kim, sera pris dès que possible.');
  ui.picker.renderChoice(select, detail, { editable: true, character: hunter });
  assert.match(detail.textContent, /Tu peux en changer avant la nuit/, 'editable: the client sends it again instead');
});

// A seat taken back in a loaded night (client.js syncCharacterSheet).
test('a seat’s saved character becomes the page’s choice without being stored, and can be kept from the editor', () => {
  setLanguage('fr');
  const ui = harness({ [CHARACTERS_KEY]: JSON.stringify([custom('c1', 'Kim', { strength: 1, agility: -1 })]), [CHARACTER_KEY]: 'scout' });
  const writes = ui.store.writes.length;
  // A ready-made or saved character in play is simply selected.
  assert.equal(ui.picker.adopt(normalizeSheet({ preset: 'scout' })), false, 'already this choice');
  assert.equal(ui.picker.adopt(null), false);
  assert.equal(ui.picker.adopt(normalizeSheet({ preset: 'mechanic' })), true);
  assert.equal(ui.picker.choice(), 'mechanic'); assert.equal(ui.$('character-select').value, 'mechanic');
  assert.equal(ui.picker.adopt(sheetForChoice('custom:c1', ui.picker.characters())), true); assert.equal(ui.picker.choice(), 'custom:c1');
  assert.equal(ui.changes.length, 0, 'nothing to send: the server already plays it');
  // One only the save knows is offered by name while the page lives.
  const chemist = normalizeSheet({ name: 'Chimiste', stats: { agility: -1, ballistics: -1, chemistry: 2 } });
  assert.equal(ui.picker.adopt(chemist), true);
  assert.equal(ui.picker.choice(), SEAT_CHARACTER); assert.deepEqual(ui.picker.sheet(), chemist); assert.equal(ui.picker.applied(chemist), true);
  assert.deepEqual(ui.options().at(-2), [SEAT_CHARACTER, 'Chimiste (sauvegarde)']);
  assert.equal(ui.$('character-card').children[0].textContent, 'Chimiste');
  assert.deepEqual(ui.picker.joinSheet(), chemist, 'a new room is joined with it');
  assert.equal(ui.store.writes.length, writes, 'taking a seat back stores nothing'); assert.equal(ui.store.values.get(CHARACTER_KEY), 'scout');
  const select = ui.$('lobby-select'), detail = ui.$('lobby-detail');
  ui.picker.renderChoice(select, detail, { editable: false, character: chemist, seat: true });
  assert.equal(select.value, SEAT_CHARACTER);
  assert.equal(detail.textContent, 'Chimie +2 · Agilité −1 · Balistique −1 · Place reprise : tu joues Chimiste, comme dans la sauvegarde. Tu pourras en changer une fois la nuit finie.');
  setLanguage('en'); ui.picker.render();
  assert.deepEqual(ui.options().at(-2), [SEAT_CHARACTER, 'Chimiste (saved game)']); assert.equal(ui.$('character-edit').textContent, 'Keep this character');
  setLanguage('fr'); ui.picker.render();
  // Another pick, then the save's one again: never written as the stored choice.
  ui.select('pyro'); assert.equal(ui.store.values.get(CHARACTER_KEY), 'pyro');
  ui.select(SEAT_CHARACTER); assert.deepEqual(ui.changes.at(-1), chemist); assert.equal(ui.store.values.get(CHARACTER_KEY), 'pyro');
  // «Garder ce personnage» opens the editor with its name; Save keeps it here.
  assert.equal(ui.$('character-edit').textContent, 'Garder ce personnage');
  ui.$('character-edit').onclick();
  assert.equal(ui.$('character-editor').hidden, false); assert.equal(ui.$('character-name').value, 'Chimiste');
  ui.$('character-save').onclick();
  assert.deepEqual(readCharacters(ui.store).map(item => item.name), ['Kim', 'Chimiste']);
  assert.equal(ui.picker.choice(), 'custom:c2'); assert.equal(ui.store.values.get(CHARACTER_KEY), 'custom:c2');
  assert.equal(ui.options().some(([value]) => value === SEAT_CHARACTER), false, 'kept: offered once');
  assert.deepEqual(ui.picker.sheet(), chemist);
  // Kept from another tab instead: the page follows the stored copy.
  const other = harness({ [CHARACTERS_KEY]: '[]' });
  assert.equal(other.picker.adopt(chemist), true); assert.equal(other.picker.choice(), SEAT_CHARACTER);
  other.store.values.set(CHARACTERS_KEY, JSON.stringify([custom('c4', 'Chimiste', { agility: -1, ballistics: -1, chemistry: 2 })]));
  other.picker.storageChanged(CHARACTERS_KEY);
  assert.equal(other.picker.choice(), 'custom:c4'); assert.equal(other.options().some(([value]) => value === SEAT_CHARACTER), false);
  assert.equal(other.changes.length, 0, 'the same character: nothing to send');
  // A storage cleared elsewhere leaves the save's character on offer.
  const third = harness();
  third.picker.adopt(chemist); third.picker.storageChanged(null);
  assert.equal(third.picker.choice(), SEAT_CHARACTER);
});

test('two tabs of one browser share the saved list: a save or a delete starts from what the other tab stored', () => {
  setLanguage('fr');
  const shared = storage(), a = harness(shared), b = harness(shared); // both opened on an empty list
  a.select(CREATE_CHARACTER); a.press('strength', 1); a.press('agility', -1);
  a.$('character-name').value = 'Mon bûcheron'; a.$('character-save').onclick();
  b.select(CREATE_CHARACTER); b.press('tinkering', 1); b.press('strength', -1);
  b.$('character-name').value = 'Ma mécano'; b.$('character-save').onclick();
  const stored = () => JSON.parse(shared.values.get(CHARACTERS_KEY)).map(item => [item.id, item.name]);
  assert.deepEqual(stored(), [['c1', 'Mon bûcheron'], ['c2', 'Ma mécano']], 'the stale tab adds to the list instead of replacing it');
  assert.equal(b.picker.choice(), 'custom:c2');
  // The page's storage event brings the other tab's characters into the select.
  const changes = a.changes.length;
  a.picker.storageChanged('deadwood-name'); assert.equal(a.options().length, 9, 'other keys are ignored');
  a.picker.storageChanged(CHARACTERS_KEY);
  assert.deepEqual(a.options().slice(7, 9), [['custom:c1', 'Mon bûcheron'], ['custom:c2', 'Ma mécano']]);
  assert.equal(a.picker.choice(), 'custom:c1'); assert.equal(a.changes.length, changes, 'its own character did not change');
  // A delete keeps the other tab's characters; the tab whose character went
  // away follows, back to the standard one.
  b.select('custom:c1'); b.$('character-edit').onclick(); b.$('character-delete').onclick();
  assert.deepEqual(stored(), [['c2', 'Ma mécano']]);
  a.picker.storageChanged(null);
  assert.equal(a.picker.choice(), 'standard'); assert.equal(a.changes.at(-1).preset, 'standard');
  // Edited here while deleted there: saved again as a new character.
  a.select('custom:c2'); a.$('character-edit').onclick(); a.press('tinkering', -1); a.press('agility', 1);
  b.select('custom:c2'); b.$('character-edit').onclick(); b.$('character-delete').onclick();
  assert.deepEqual(stored(), []);
  a.$('character-save').onclick();
  assert.deepEqual(stored(), [['c1', 'Ma mécano']]); assert.equal(a.picker.choice(), 'custom:c1');
  assert.deepEqual(a.picker.sheet().stats, { strength: -1, agility: 1, ballistics: 0, tinkering: 0, chemistry: 0 });
  // A blocked storage still keeps the page's own list.
  const blocked = harness({}, { blocked: true });
  blocked.select(CREATE_CHARACTER); blocked.$('character-save').onclick(); blocked.picker.storageChanged(CHARACTERS_KEY);
  assert.equal(blocked.picker.characters().length, 1);
});

test('a blank name takes the lowest free «Personnage N», so two options never look the same', () => {
  setLanguage('fr');
  const ui = harness();
  const blank = () => { ui.select(CREATE_CHARACTER); ui.$('character-name').value = ''; ui.$('character-save').onclick(); };
  blank(); blank();
  assert.deepEqual(ui.picker.characters().map(item => [item.id, item.name]), [['c1', 'Personnage 1'], ['c2', 'Personnage 2']]);
  ui.select('custom:c1'); ui.$('character-edit').onclick(); ui.$('character-delete').onclick();
  blank();
  assert.deepEqual(ui.picker.characters().map(item => [item.id, item.name]), [['c2', 'Personnage 2'], ['c3', 'Personnage 1']]);
  // Clearing the name of an existing one never takes another's number.
  ui.select('custom:c2'); ui.$('character-edit').onclick(); ui.$('character-name').value = ' '; ui.$('character-save').onclick();
  assert.deepEqual(ui.picker.characters().map(item => item.name), ['Personnage 2', 'Personnage 1']);
  blank();
  assert.equal(new Set(ui.picker.characters().map(item => item.name)).size, 3);
});

test('the keyboard and controller focus stays in the editor when a step button or the editor itself goes away', () => {
  setLanguage('fr');
  const ui = harness();
  ui.select(CREATE_CHARACTER);
  ui.button('strength', 1).focus(); ui.press('strength', 1);
  assert.equal(focused, ui.button('strength', 1), 'still usable: the focus stays');
  ui.press('strength', 1);
  assert.equal(ui.button('strength', 1).disabled, true);
  assert.equal(focused, ui.button('strength', -1), 'to the other button of the row, not the top of the menu');
  ui.button('chemistry', -1).focus(); ui.press('chemistry', -1); ui.press('chemistry', -1);
  assert.equal(focused, ui.button('chemistry', 1));
  ui.$('character-save').onclick(); assert.equal(focused, ui.$('character-select'), 'Enregistrer');
  ui.$('character-edit').onclick(); assert.equal(focused, ui.$('character-name'));
  ui.$('character-delete').onclick(); assert.equal(focused, ui.$('character-select'), 'Supprimer');
});

test('every malus and the sheet copy have real French and English text', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of ['character-select', 'character-card', 'character-editor', 'character-name', 'character-save', 'character-cancel', 'character-delete',
    'character-moved', 'character-issue', 'character-choice-select', 'character-choice-select-results']) assert.ok(html.includes(`id="${id}"`), id);
  const menu = html.slice(html.indexOf('<main id="menu"'), html.indexOf('</main>'));
  assert.ok(menu.includes('id="character-editor"') && menu.indexOf('id="player-name"') < menu.indexOf('id="character-select"'), 'after the name, inside #menu');
  // Controller navigation only reaches controls inside its known roots.
  const section = id => html.slice(html.indexOf(`<section id="${id}"`), html.indexOf('</section>', html.indexOf(`<section id="${id}"`) + 30));
  assert.ok(html.slice(html.indexOf('<section id="lobby"'), html.indexOf('<div id="hud"')).includes('id="character-choice-select"'), 'inside #lobby');
  assert.ok(section('gameover').includes('id="character-choice-select-results"'), 'inside #gameover');
  for (const language of ['fr', 'en']) {
    setLanguage(language);
    for (const kind of Object.keys(SUPPLY_BONUSES)) for (const level of [-2, -1, 0]) {
      const text = sheetMalusEffect(kind, level, t);
      assert.ok(text.length > 5 && !/undefined|NaN|sheetMalus|\{/.test(text), `${language} ${kind} ${level}: ${text}`);
    }
    for (const id of SHEET_STAT_IDS) for (const key of [`sheet.stat.${id}`, `sheet.statDetail.${id}`]) assert.notEqual(t(key), key);
    for (const id of Object.keys(SHEET_PRESETS)) for (const key of [`sheet.preset.${id}`, `sheet.story.${id}`]) assert.notEqual(t(key), key);
  }
  setLanguage('fr');
  assert.equal(sheetMalusEffect('vitality', -2, t), '80 PV maximum');
  assert.equal(sheetMalusEffect('frostaura', -1, t), 'Odeur de produits : zombies 10 % plus rapides à 4 m');
  assert.equal(sheetMalusEffect('medic', -1, t), 'Relève en 6 s · les médikits soignent 25 % de moins');
  assert.equal(sheetMalusEffect('medic', -2, t), 'Relève en 7,5 s · les médikits soignent 50 % de moins');
  assert.equal(sheetMalusEffect('perforating', -1, t), 'Pas de malus : il faut juste une prise de plus à la caisse');
  assert.equal(sheetMalusEffect('perforating', -2, t), 'Pas de malus : il faut juste deux prises de plus à la caisse');
  assert.equal(sheetMalusEffect('grenadier', -2, t), '1 grenade au plus · −30 % dégâts de grenade');
  assert.equal(sheetMalusEffect('extended', -1, t), '−10 % chargeur et réserve');
  setLanguage('en');
  assert.equal(sheetMalusEffect('switching', -2, t), '350 ms weapon switch');
  assert.equal(sheetMalusEffect('radar', -1, t), 'Repairs restore 20 HP instead of 25');
  assert.equal(sheetMalusEffect('frostaura', -2, t), 'Chemical smell: zombies 15% faster within 5 m');
  assert.equal(sheetMalusEffect('medic', -1, t), 'Revive in 6 s · medkits heal 25% less');
  // The HUD card's next step follows the sheet: a talent announces two levels.
  assert.equal(bonusHudCard('vitality', 2, 'pistol', t, 4).next, '140 maximum HP at lvl 4');
  assert.equal(bonusHudCard('vitality', 2, 'pistol', t).next, '130 maximum HP at lvl 3');
  assert.equal(bonusHudCard('extended', 3, 'pistol', t, 5).next, '+50% at lvl 5');
  setLanguage('fr');
});

test('the bonus catalogue explains the optional sheet with every family and malus in both languages', async () => {
  const { SHEET_STATS } = await import('../public/character-sheet.js');
  const { bonusIcon } = await import('../public/bonus-icons.js');
  const node = () => ({ children: [], dataset: {}, listeners: new Map(), textContent: '', className: '', html: '',
    set innerHTML(value) { this.html = value; }, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, addEventListener(name, callback) { this.listeners.set(name, callback); } });
  const elements = new Map(), get = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const html = readFileSync(new URL('../public/bonus-catalog.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 2, 'the bonus cards keep their own first script');
  const vm = await import('node:vm');
  vm.runInNewContext(scripts[1].replace(/^import[^\n]+;\s*$/gm, ''), { SHEET_STATS, sheetMalusEffect, bonusIcon, t, document: { getElementById: get, createElement: node } });
  for (const language of ['fr', 'en']) {
    setLanguage(language); get('language').listeners.get('change')();
    assert.equal(get('sheet-title').textContent, t('sheetCatalog.title'));
    assert.equal(get('sheet-rules').children.length, 3);
    const cards = get('sheet-stats').children;
    assert.deepEqual(cards.map(card => card.dataset.stat), SHEET_STAT_IDS);
    for (const card of cards) {
      const rows = card.children[2].children.slice(1);
      assert.deepEqual(rows.map(row => row.dataset.bonus), SHEET_STATS.find(stat => stat.id === card.dataset.stat).bonuses);
      for (const row of rows) assert.deepEqual(row.children.slice(1).map(cell => cell.textContent), [-1, -2].map(level => sheetMalusEffect(row.dataset.bonus, level, t)));
    }
  }
  assert.match(get('sheet-intro').textContent, /No intelligence stat/);
  setLanguage('fr');
});
