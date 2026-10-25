import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { COMPANION_PROFILE_CHOICES, companionArchetype } from '../public/companion-profiles.js';
import { t, setLanguage } from '../public/i18n.js';

const client = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8');
const pickerSource = client.slice(client.indexOf('const MAX_SURVIVORS = 4, COMPANION_COUNTS'), client.indexOf('// A companion says what it is doing:'));
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

// Exercise the real client picker without starting WebGL or a network client.
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  get value() { return this._value ?? this.children[0]?.value ?? ''; }
  set value(value) { this._value = String(value); }
  set innerHTML(_) { throw new Error('Server data must stay plain text'); }
}
const companion = (slot, selection = 'random', archetype = 'veteran') => ({ id: `bot-${slot}`, name: ['Max', 'Léa', 'Sam'][slot], companion: true, companionSlot: slot, companionProfile: { selection, archetype } });
function harness(extra = {}) {
  const nodes = new Map(), sent = [];
  for (const suffix of ['', '-results']) for (const name of ['picker', 'options', 'detail', 'notice', 'profiles', 'variation']) nodes.set(`companions-${name}${suffix}`, new Element());
  const context = vm.createContext({ document: { createElement: tag => new Element(tag) }, $: id => nodes.get(id), snapshot: { hostId: 'host', companionsAvailable: true, phase: 'lobby', players: [{ id: 'host' }, companion(0), companion(1)], companionSelections: ['random', 'random', 'random'], ...extra }, myId: 'host', send: message => sent.push(JSON.parse(JSON.stringify(message))), toast() {}, getLanguage: () => currentLanguage, t, COMPANION_PROFILE_CHOICES, companionArchetype });
  vm.runInContext(`${pickerSource}\nglobalThis.ui = {renderCompanions, companionBadge};`, context);
  return { context, sent, nodes, render: suffix => context.ui.renderCompanions(suffix), row: (slot, suffix = '') => nodes.get(`companions-profiles${suffix}`).children[slot], button: count => nodes.get('companions-options').children[count] };
}
let currentLanguage = 'fr';
function language(value) { currentLanguage = value; setLanguage(value); }

test('both lobby and results offer labelled native profile choices, including random and veteran', () => {
  language('fr'); const ui = harness();
  for (const suffix of ['', '-results']) {
    assert.ok(html.includes(`id="companions-profiles${suffix}"`));
    assert.ok(html.includes(`id="companions-variation${suffix}"`));
    ui.render(suffix);
    for (const slot of [0, 1]) {
      const [label, select, detail] = ui.row(slot, suffix).children;
      assert.equal(label.htmlFor, select.id);
      assert.equal(select.tagName, 'SELECT'); assert.equal(select.disabled, false);
      assert.equal(select.attributes['aria-describedby'], `${detail.id} companions-variation${suffix}`);
      assert.deepEqual(select.children.map(option => option.value), [...COMPANION_PROFILE_CHOICES]);
      assert.equal(select.children[0].textContent, 'Aléatoire');
      assert.equal(select.children.at(-1).textContent, 'Vétéran');
      assert.match(detail.textContent, /cinq profils/);
    }
    assert.equal(ui.row(2, suffix).hidden, true);
  }
  language('en'); ui.render();
  assert.equal(ui.row(0).children[0].textContent, 'Max · profile');
  assert.equal(ui.row(0).children[1].children[0].textContent, 'Random');
  assert.equal(ui.row(0).children[1].children.at(-1).textContent, 'Veteran');
  assert.match(ui.nodes.get('companions-variation').textContent, /same profile more than once/);
  language('fr');
});

test('profile rows use a dedicated slot attribute outside the global weapon-slot renderer', () => {
  const ui = harness(); ui.render(); ui.render('-results');
  for (const suffix of ['', '-results']) for (const slot of [0, 1, 2]) {
    const row = ui.row(slot, suffix);
    assert.equal(row.dataset.companionSlot, String(slot));
    assert.equal(Object.hasOwn(row.dataset, 'slot'), false, 'the weapon HUD owns data-slot globally');
    assert.equal(row.children[0].tagName, 'LABEL');
    assert.equal(row.children[1].tagName, 'SELECT');
    assert.equal(row.children[2].tagName, 'SMALL');
  }
  assert.doesNotMatch(pickerSource, /dataset\.slot\s*=/);
});

test('changing a profile sends all three slots and permits identical archetypes', () => {
  const ui = harness({ players: [{ id: 'host' }, companion(0), companion(1), companion(2)], companionSelections: ['veteran', 'veteran', 'random'] });
  ui.render(); const select = ui.row(2).children[1]; select.value = 'veteran'; select.onchange();
  assert.deepEqual(ui.sent, [{ type: 'companions', count: 3, profiles: ['veteran', 'veteran', 'veteran'] }]);
  ui.context.snapshot.companionSelections = ['timid', 'timid', 'timid']; ui.render();
  assert.deepEqual([0, 1, 2].map(slot => ui.row(slot).children[1].value), ['timid', 'timid', 'timid']);
});

test('10 Hz snapshots preserve the same controls and handlers read the latest snapshot', () => {
  const ui = harness(); ui.render(); const row = ui.row(0), select = row.children[1], button = ui.button(1);
  for (let frame = 0; frame < 100; frame++) { ui.context.snapshot = { ...ui.context.snapshot, time: frame / 10 }; ui.render(); }
  assert.equal(ui.row(0), row); assert.equal(ui.row(0).children[1], select); assert.equal(ui.button(1), button);
  ui.context.snapshot.companionSelections = ['protector', 'timid', 'veteran']; ui.render();
  assert.equal(ui.row(0).children[1], select); assert.equal(select.value, 'protector');
  select.value = 'sharpshooter'; select.onchange();
  assert.deepEqual(ui.sent.at(-1), { type: 'companions', count: 2, profiles: ['sharpshooter', 'timid', 'veteran'] });
  ui.button(3).onclick();
  assert.deepEqual(ui.sent.at(-1), { type: 'companions', count: 3, profiles: ['protector', 'timid', 'veteran'] });
});

test('noncontiguous slots remain attached to their named companion after a human replacement', () => {
  const ui = harness({ players: [{ id: 'host' }, { id: 'guest' }, companion(1), companion(2)], companionSelections: ['sharpshooter', 'protector', 'timid'] });
  ui.render();
  assert.equal(ui.row(0).hidden, true);
  assert.equal(ui.row(0).children[1].disabled, true);
  assert.equal(ui.row(1).hidden, false); assert.equal(ui.row(1).children[0].textContent, 'Léa · profil');
  assert.equal(ui.row(2).hidden, false); assert.equal(ui.row(2).children[0].textContent, 'Sam · profil');
  const sam = ui.row(2).children[1]; assert.equal(sam.value, 'timid'); sam.value = 'veteran'; sam.onchange();
  assert.deepEqual(ui.sent, [{ type: 'companions', count: 2, profiles: ['sharpshooter', 'protector', 'veteran'] }]);
  const inactive = ui.row(0).children[1]; inactive.value = 'veteran'; inactive.onchange(); assert.equal(ui.sent.length, 1);
  ui.context.snapshot.players = [{ id: 'host' }, companion(0), companion(1), companion(2)]; ui.render();
  assert.equal(ui.row(0).hidden, false);
});

test('guests, active nights, disconnected brains, practice and full rooms cannot modify profiles', () => {
  for (const extra of [{ hostId: 'someone-else' }, { phase: 'wave' }, { phase: 'intermission' }]) {
    const ui = harness(extra); ui.render(); const select = ui.row(0).children[1];
    assert.equal(select.disabled, true); assert.equal(ui.button(1).disabled, true);
    select.value = 'veteran'; select.onchange(); ui.button(1).onclick(); assert.deepEqual(ui.sent, []);
    assert.match(ui.nodes.get('companions-detail').textContent, /hôte/);
  }
  for (const extra of [{ companionsAvailable: false }, { practice: true }]) {
    const ui = harness(); ui.render(); const select = ui.row(0).children[1]; ui.context.snapshot = { ...ui.context.snapshot, ...extra }; ui.render();
    assert.equal(ui.nodes.get('companions-picker').hidden, true);
    select.value = 'veteran'; select.onchange(); ui.button(3).onclick(); assert.deepEqual(ui.sent, []);
  }
  const full = harness({ players: [{ id: 'host' }, { id: 'guest' }, companion(0), companion(1)] }); full.render();
  assert.equal(full.button(3).disabled, true); full.button(3).onclick(); assert.deepEqual(full.sent, []);
  for (const phase of ['gameover', 'victory']) { const ui = harness({ phase }); ui.render('-results'); assert.equal(ui.row(0, '-results').children[1].disabled, false); }
});

test('badges show the effective random identity and safely ignore unknown server archetypes', () => {
  const ui = harness(); const name = new Element('span');
  ui.context.ui.companionBadge(companion(0, 'random', 'veteran'), name);
  assert.equal(name.children[0].textContent, 'IA · Vétéran');
  assert.equal(name.children[0].title, companionArchetype('veteran').descriptions.fr);
  const unknown = new Element('span'); ui.context.ui.companionBadge(companion(0, 'random', '<img src=x onerror=alert(1)>'), unknown);
  assert.equal(unknown.children[0].textContent, 'IA');
  const human = new Element('span'); ui.context.ui.companionBadge({ companion: false }, human); assert.equal(human.children.length, 0);
  const old = harness({ companionSelections: undefined }); old.render(); assert.equal(old.row(0).children[1].value, 'random');
});
