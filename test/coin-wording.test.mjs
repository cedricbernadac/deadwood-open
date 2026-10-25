import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three';
import { RoomSimulation } from '../simulation.mjs';
import { ARMORY } from '../public/rules.js';
import { setLanguage, t, translateMessage, weaponLabel } from '../public/i18n.js';
import { importPublicModule } from './helpers/public-modules.mjs';

const { createWorld } = await importPublicModule('world.js');

// The spendable money is « pièces » / "coins" everywhere players read it; the
// score keeps the words "score" and "points" (the impact numbers' help, the
// revive bonus toast), and the spiked mace keeps its « pointes ».
const SCORE_KEYS = new Set(['feedback.help', 'feedback.impactHelp',
  // The revived survivor's toast: the score points their teammate earns.
  'revive.bonusToast', 'revive.bonusToastFloor',
  // The character sheet's stat points (owner's wording «Points déplacés»), never money.
  'sheet.help', 'sheet.moved', 'sheet.minus', 'sheet.plus', 'sheet.issue.removeOne', 'sheet.issue.removeMany', 'sheet.issue.addOne', 'sheet.issue.addMany',
  'sheet.story.standard', 'sheetCatalog.intro', 'sheetCatalog.plus', 'sheetCatalog.minus']);

function wording() {
  const source = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({});
  vm.runInContext(`${source}\nglobalThis.api = { text, exact, phases, weapons };`, context);
  return context.api;
}

test('no French or English value in i18n.js speaks of money as point(s) or pts', () => {
  const { text, exact, phases, weapons } = wording();
  const moneyWord = /\bpoints?\b|\bpts\b/i;
  for (const [key, [french, english]] of Object.entries(text)) {
    if (SCORE_KEYS.has(key)) continue;
    for (const value of [french, english]) {
      const resolved = value.replace(/\{\w+\}/g, '');
      assert.doesNotMatch(resolved, moneyWord, `${key}: ${value}`);
    }
  }
  // The verbatim message pairs outside the text table follow the same rule.
  const base = new Set([...Object.values(text), ...Object.values(phases), ...Object.values(weapons)].map(pair => pair[0]));
  for (const [source, target] of exact) {
    if (base.has(source)) continue;
    assert.doesNotMatch(source, moneyWord, source);
    assert.doesNotMatch(target, moneyWord, target);
  }
  setLanguage('fr');
  assert.equal(t('hud.points'), 'PIÈCES');
  setLanguage('en');
  assert.equal(t('hud.points'), 'COINS');
  setLanguage('fr');
  assert.equal(weaponLabel('hammer'), 'MASSE À POINTES', 'the spiked mace is not money');
  assert.equal(weaponLabel('hammer', { language: 'en' }), 'SPIKED MACE');
});

function withCanvas(run) {
  const previous = globalThis.document;
  const drawn = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const context = new Proxy({
        measureText(value) { return { width: value.length * Number.parseInt(this.font?.match(/\d+/)?.[0] ?? 42) * .6 }; },
        fillText(value) { drawn.push({ value, size: Number.parseInt(this.font?.match(/\d+/)?.[0] ?? 42) }); },
      }, { get: (object, key) => key in object ? object[key] : () => {} });
      return { width: 0, height: 0, getContext: () => context };
    },
  };
  try { run(drawn); } finally { globalThis.document = previous; setLanguage('fr'); }
}

const rackLabels = world => {
  const labels = [];
  world.root.traverse(node => { if (typeof node.userData.setLabel === 'function') labels.push(node.userData.label); });
  return labels;
};

test('every armory rack sign prices in PIÈCES and COINS, and both languages fit the board', () => withCanvas(drawn => {
  setLanguage('fr');
  const world = createWorld(new THREE.Scene());
  const french = rackLabels(world);
  for (const crate of ARMORY) {
    const label = `${weaponLabel(crate.weapon, { language: 'fr' })} · ${crate.price} PIÈCES`;
    assert.ok(french.includes(label), `missing French sign: ${label}`);
  }
  world.setLanguage('en');
  const english = rackLabels(world);
  for (const crate of ARMORY) {
    const label = `${weaponLabel(crate.weapon, { language: 'en' })} · ${crate.price} COINS`;
    assert.ok(english.includes(label), `missing English sign: ${label}`);
  }
  // world.js shrinks the 42px sign font until the text is at most 470px wide
  // (20px minimum); with the tests' measureText estimate both languages must fit.
  const prices = drawn.filter(call => /· \d+ (PIÈCES|COINS)$/.test(call.value));
  assert.ok(prices.length >= ARMORY.length * 2, 'every rack sign was drawn in both languages');
  for (const call of prices) assert.ok(call.value.length * call.size * .6 <= 470, `${call.value} overflows at ${call.size}px`);
}));

test('a rack purchase denial from the real simulation reads pièces, and coins in English', () => {
  const events = [];
  const simulation = new RoomSimulation('COIN01', { onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a', 'Alice');
  simulation.start('a');
  const crate = ARMORY.find(item => item.weapon === 'bat');
  simulation.wave = crate.unlockWave;
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.1, y: crate.y, z: crate.z + Math.cos(crate.facing) * 1.1, points: crate.price - 120 });
  assert.equal(simulation.buyWeapon('a', crate.id), false);
  const denied = events.find(event => event.event === 'purchase-denied');
  assert.ok(denied);
  assert.equal(denied.message, 'Il te manque 120 pièces pour batte en bois.');
  setLanguage('en');
  assert.equal(translateMessage(denied.message), 'You need 120 more coins for the wooden bat.');
  setLanguage('fr');
});

test('the pickup notice for collected money reads PIÈCES RAMASSÉES and COINS COLLECTED', () => {
  // The notice is a hard-coded French HUD string in client.js; client-flow
  // tests exercise the real client, here the source and its translation agree.
  const client = readFileSync(new URL('../public/client.js', import.meta.url), 'utf8');
  assert.match(client, /`\+\$\{pickupPoints\} PIÈCES RAMASSÉES`/);
  setLanguage('fr');
  assert.equal(translateMessage('+24 PIÈCES RAMASSÉES'), '+24 PIÈCES RAMASSÉES');
  setLanguage('en');
  assert.equal(translateMessage('+24 PIÈCES RAMASSÉES'), '+24 COINS COLLECTED');
  setLanguage('fr');
});

test('every French message the LAN server sends is translated, and none speaks of money as points', () => {
  const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const messages = [...source.matchAll(/message: '([^']+)'/g)].map(match => match[1]);
  assert.ok(messages.length >= 5);
  setLanguage('en');
  for (const message of messages) {
    assert.doesNotMatch(message, /points?|pts/i, message);
    assert.notEqual(translateMessage(message), message, `untranslated: ${message}`);
  }
  assert.equal(translateMessage('Cette arme est indisponible. Achète-la à son râtelier avec tes pièces.'), 'This weapon is unavailable. Buy it at its rack with your coins.');
  setLanguage('fr');
});
