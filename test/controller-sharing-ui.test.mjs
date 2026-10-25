import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CONTROLLER_DEFAULTS, normalizeControllerSettings } from '../public/controller-ui.js';
import { GAMEPAD_BUTTONS } from '../public/gamepad-controls.js';
import { setLanguage, t } from '../public/i18n.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const opening = id => {
  const match = html.match(new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(match, `Missing control: ${id}`);
  const attributes = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]]));
  return { tag: match[1], text: match[0], ...attributes };
};
const options = id => {
  const content = html.match(new RegExp(`<select\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)<\\/select>`))[1];
  return [...content.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(match => ({
    value: /value="([^"]+)"/.exec(match[1])[1], selected: /\bselected\b/.test(match[1]), text: match[2],
  }));
};

test('sharing and controller controls have unique IDs, native accessible controls and explicit labels', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs would bind one menu to another control');
  for (const id of ['input-mode-start', 'input-mode', 'gamepad-sensitivity', 'gamepad-deadzone', 'gamepad-aim-assist', 'gamepad-invert-y', 'room-share-address']) {
    assert.match(html, new RegExp(`<label\\b[^>]*\\bfor="${id}"`), `Visible label for ${id}`);
  }
  for (const id of ['copy-room-code', 'copy-room-link', 'hud-room', 'admission-ready']) {
    assert.equal(opening(id).tag, 'button');
    assert.equal(opening(id).type, 'button');
  }
  assert.equal(opening('hud-room')['data-i18n-aria-label'], 'roomShare.open');
  assert.equal(opening('gamepad-settings').tag, 'details');
  for (const id of ['room-share-status', 'gamepad-status', 'admission-status']) {
    assert.equal(opening(id).role, 'status');
    assert.equal(opening(id)['aria-live'], 'polite');
  }
});

test('visible controller settings agree with the saved settings defaults and supported ranges', () => {
  for (const id of ['input-mode-start', 'input-mode']) {
    const choices = options(id);
    assert.deepEqual(choices.map(option => option.value), ['auto', 'mouse', 'gamepad']);
    assert.equal((choices.find(option => option.selected) ?? choices[0]).value, CONTROLLER_DEFAULTS.mode);
  }
  const speed = opening('gamepad-sensitivity'), deadzone = opening('gamepad-deadzone');
  assert.equal(Number(speed.value), CONTROLLER_DEFAULTS.sensitivity);
  assert.equal(Number(deadzone.value), CONTROLLER_DEFAULTS.deadzone);
  assert.equal(Number(speed.min), normalizeControllerSettings({ sensitivity: -1 }).sensitivity);
  assert.equal(Number(speed.max), normalizeControllerSettings({ sensitivity: 1e6 }).sensitivity);
  assert.equal(Number(deadzone.min), normalizeControllerSettings({ deadzone: -1 }).deadzone);
  assert.equal(Number(deadzone.max), normalizeControllerSettings({ deadzone: 1e6 }).deadzone);
  const assist = options('gamepad-aim-assist');
  assert.deepEqual(assist.map(option => option.value), ['off', 'light', 'normal', 'strong']);
  assert.equal(assist.find(option => option.selected).value, CONTROLLER_DEFAULTS.aimAssist);
  assert.equal(/\bchecked\b/.test(opening('gamepad-invert-y').text), CONTROLLER_DEFAULTS.invertY);
});

test('the Strong option and linked help explain all assistance levels in French and English', () => {
  assert.equal(opening('gamepad-aim-assist')['aria-describedby'], 'gamepad-aim-assist-help');
  const help = opening('gamepad-aim-assist-help');
  assert.equal(help['data-i18n'], 'gamepad.aimAssistHelp');
  assert.doesNotMatch(help.text, /\bhidden\b/);
  const selectorEnd = html.indexOf('</select>', html.indexOf('id="gamepad-aim-assist"'));
  assert.ok(html.indexOf('id="gamepad-aim-assist-help"') > selectorEnd, 'help appears below the selector');
  assert.equal(options('gamepad-aim-assist').find(option => option.value === 'strong').text, 'Forte');
  try {
    for (const [language, label, previous, motion, mouse, head] of [
      ['fr', 'Forte', /ancienne aide normale/, /mouvements au stick/, /souris/, /visée automatique de la tête/],
      ['en', 'Strong', /previous Normal assist/, /move the stick/, /mouse aim/, /automatic head targeting/],
    ]) {
      setLanguage(language);
      assert.equal(t('gamepad.assistStrong'), label);
      for (const expectation of [previous, motion, mouse, head]) assert.match(t('gamepad.aimAssistHelp'), expectation);
    }
  } finally { setLanguage('fr'); }
});

test('room invitations remain readable and selectable without automatic clipboard access', () => {
  const address = opening('room-share-address');
  assert.equal(address.tag, 'input');
  assert.equal(address.type, 'text');
  assert.match(address.text, /\breadonly\b/);
  assert.doesNotMatch(address.text, /\bdisabled\b/);
  assert.equal(address['aria-describedby'], 'room-share-help');
  assert.equal(opening('room-share-panel')['aria-labelledby'], 'room-share-title');
  assert.equal(opening('pause-room-code')['data-i18n-aria-label'], 'setup.code');
  assert.ok(html.indexOf('id="room-share-panel"') > html.indexOf('id="pause"'));
  assert.ok(html.indexOf('id="room-share-panel"') < html.indexOf('id="resume-button"'));
});

test('late-join readiness starts hidden in the lobby and explains admission without calling the player eliminated', () => {
  assert.match(opening('admission-panel').text, /\bhidden\b/);
  assert.equal(opening('admission-panel')['aria-labelledby'], 'admission-title');
  assert.ok(html.indexOf('id="admission-panel"') > html.indexOf('id="lobby"'));
  assert.ok(html.indexOf('id="admission-ready"') < html.indexOf('id="start-button"'));
  for (const language of ['fr', 'en']) {
    setLanguage(language);
    assert.doesNotMatch(t('admission.waiting'), /élimin|eliminat|dead|mort/i);
    assert.match(t('admission.help'), language === 'fr' ? /pause entre deux vagues/ : /break between waves/);
  }
  setLanguage('fr');
});

test('the complete Xbox legend agrees with the standard button mapping and every new label translates', () => {
  const expected = { jump: [0, 'A', 'jump'], umbrella: [1, 'B', 'umbrella'], reload: [2, 'X', 'reload'], cycle: [3, 'Y', 'cycle'],
    grenade: [4, 'LB', 'grenade'], interact: [5, 'RB', 'interact'], alternate: [6, 'LT', 'aim'], fire: [7, 'RT', 'fire'],
    menu: [9, 'Start', 'menu'], sprint: [10, 'L3', 'sprint'], crouch: [11, 'R3', 'crouch'], radar: [12, '↑', 'radar'], drop: [13, '↓', 'drop'] };
  for (const [action, [button, label, key]] of Object.entries(expected)) {
    assert.equal(GAMEPAD_BUTTONS[action], button);
    assert.ok(html.includes(`<kbd>${label}</kbd></dt><dd data-i18n="gamepad.${key}"`), `Legend for ${action}`);
  }
  const keys = [...new Set([...html.matchAll(/data-i18n(?:-aria-label|-title)?="((?:input|gamepad|roomShare|admission)\.[^"]+)"/g)].map(match => match[1]))];
  const french = new Map();
  for (const language of ['fr', 'en']) {
    setLanguage(language);
    for (const key of keys) {
      assert.notEqual(t(key), key, `${language} translation for ${key}`);
      if (language === 'fr') french.set(key, t(key)); else assert.notEqual(t(key), french.get(key), `${key} is translated`);
    }
  }
  assert.match(t('gamepad.paddles'), /Xbox Accessories/);
  assert.match(t('roomShare.copyFallback'), /Select the link/);
  assert.equal(t('roomShare.codeCopied', { code: 'AB12CD' }), 'Code copied: AB12CD');
  setLanguage('fr');
});
