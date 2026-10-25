import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { CHARACTER_BONUSES, characterBonusDescription } from '../public/character-bonuses.js';
import { SUPPLY_BONUSES } from '../public/weapon-upgrades.js';
import { bonusHudCard } from '../public/bonus-hud.js';
import { BONUS_ICONS, bonusIcon } from '../public/bonus-icons.js';
import { buildRadarFrame, createRadarUI } from '../public/radar-ui.js';
import { radarInformation, radarPulseIndex } from '../public/radar-rules.js';
import { setLanguage, t } from '../public/i18n.js';
import { importPublicModule } from './helpers/public-modules.mjs';

test('every supply bonus has distinct local artwork and every character level describes the shared actual effect in both languages', () => {
  assert.equal(Object.keys(SUPPLY_BONUSES).length, 14);
  assert.equal(new Set(Object.values(BONUS_ICONS)).size, 14);
  for (const kind of Object.keys(SUPPLY_BONUSES)) assert.ok(typeof BONUS_ICONS[kind] === 'string' && BONUS_ICONS[kind].length > 0, kind);
  for (const language of ['fr', 'en']) {
    setLanguage(language);
    for (const kind of Object.keys(CHARACTER_BONUSES)) for (let level = 1; level <= 8; level++) {
      const card = bonusHudCard(kind, level, 'pistol', t);
      assert.equal(card.active, true, `${kind} is a character effect regardless of weapon`);
      assert.equal(card.effect, characterBonusDescription(kind, level, language));
      assert.ok(card.effect.length > 3);
      assert.equal(card.next, level === 8 ? t('hudBonus.max') : t('hudBonus.next', { effect: characterBonusDescription(kind, level + 1, language), level: level + 1 }));
      assert.doesNotMatch(t(`bonus.${kind}`), /^bonus\./);
    }
  }
  setLanguage('fr');
});

test('all fourteen bonus icons use their own fixed local WebP asset', () => {
  for (const kind of Object.keys(SUPPLY_BONUSES)) {
    const markup = bonusIcon(kind), source = markup.match(/\bsrc="([^"]+)"/)?.[1];
    assert.match(markup, /^<span\b[^>]*class="bonus-silhouette"/, kind); assert.match(markup, /<img\b/, kind);
    assert.equal(source, `./bonus-icons/${kind}.webp`);
    assert.equal(markup.match(/--bonus-silhouette:url\('([^']+)'\)/)?.[1], source, `${kind} uses the same local artwork for the mask and its image fallback`);
    assert.match(markup, /width="128" height="128"/, kind);
    assert.ok(/aria-hidden="true"|alt=""/.test(markup), `${kind} does not repeat the adjacent accessible label`);
    const data = readFileSync(new URL(`../public/${source.slice(2)}`, import.meta.url));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF', kind); assert.equal(data.toString('ascii', 8, 12), 'WEBP', kind);
    assert.ok(data.length > 128, `${kind} has a real image payload`);
  }
});

const state = level => ({ room: 'RECON', phase: 'wave', wave: 2, time: 0, doors: [],
  players: [{ id: 'self', x: 0, y: 0, z: 0, alive: true, bonus: { radar: level } }],
  zombies: [{ id: 'hidden', kind: 'armored', x: 5, y: 3.4, z: -2, hp: 13, maxHp: 80 }] });

test('reconnaissance stages expose only earned position, type, floor and health information', () => {
  for (let level = 1; level <= 8; level++) {
    const frame = buildRadarFrame(state(level), 'self'), info = radarInformation(level);
    assert.equal(frame.presence, 'few');
    assert.equal(frame.enemies.length, info.positions ? 1 : 0);
    if (!info.positions) { assert.equal(frame.sectors.length, info.sectors ? 4 : 0); continue; }
    const enemy = frame.enemies[0];
    assert.equal(enemy.shape, info.types ? 'armored' : 'ordinary');
    assert.equal(enemy.family !== undefined, info.types);
    assert.equal(enemy.floor, info.floor ? 1 : 0);
    assert.equal(enemy.health, info.health ? info.exactHealth ? 13 / 80 : .25 : undefined);
    assert.equal(enemy.hp, info.exactHealth ? 13 : undefined);
    assert.equal(enemy.maxHp, info.exactHealth ? 80 : undefined);
  }
  assert.equal(radarPulseIndex(3, 5.99), 0);
  assert.equal(radarPulseIndex(3, 6), 1);
});

test('reconnaissance samples stay stale between scans and disappear immediately when the bonus is lost', () => {
  setLanguage('fr');
  const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : () => {} });
  const root = { hidden: true, classList: { remove() {}, toggle() {} } }, legend = {};
  const ui = createRadarUI({ root, canvas: { getContext: () => context, setAttribute() {} }, title: {}, battery: {}, legend, translate: t });
  const snapshot = state(1);
  ui.update(snapshot, 'self', { now: 0 });
  assert.equal(legend.textContent, t('recon.presence.few'));
  snapshot.zombies = Array.from({ length: 20 }, (_, index) => ({ ...snapshot.zombies[0], id: `h${index}` }));
  snapshot.time = 1; ui.update(snapshot, 'self', { now: 1000 });
  assert.equal(legend.textContent, t('recon.presence.few'), 'no live count leaks between pulses');
  snapshot.time = 8; ui.update(snapshot, 'self', { now: 8000 });
  assert.equal(legend.textContent, t('recon.presence.horde'));
  snapshot.players[0].bonus = null;
  ui.update(snapshot, 'self', { now: 8100 });
  assert.equal(root.hidden, true, 'a stale detailed scan cannot survive a lost bonus');
});

test('frost presentation reuses one lightweight ring and never alters zombie materials', async () => {
  const world = await importPublicModule('world.js');
  const first = world.createZombie(), second = world.createZombie();
  world.setZombieFrost(first, .15); world.setZombieFrost(second, .25);
  const ring = first.userData.frostRing;
  assert.ok(ring.visible);
  assert.equal(ring.geometry, second.userData.frostRing.geometry);
  assert.equal(ring.material, second.userData.frostRing.material);
  world.setZombieFrost(first, 0);
  assert.equal(ring.visible, false);
  world.setZombieFrost(first, .2);
  assert.equal(first.userData.frostRing, ring, 'reactivation allocates no new mesh');
  world.disposeZombie(first); world.disposeZombie(second);
});


test('teammate dual models have independent muzzles, flashes, sniper mechanisms and minigun rotors, then restore the ordinary grip', async () => {
  const world = await importPublicModule('world.js'), body = world.createSurvivor(0x6299a2, { weapon: 'minigun' }), data = body.userData;
  const ordinaryGrip = data.arms[0].quaternion.clone();
  world.setSurvivorSecondaryWeapon(body, 'minigun');
  const primary = data.gun, secondary = data.secondaryGun;
  assert.notEqual(world.survivorMuzzle(body).x, world.survivorMuzzle(body, undefined, 'secondary').x);
  world.animateSurvivor(body, { time: 1, delta: .1, spinning: true, spinLeft: 0, secondary: { minigunSpinning: false, minigunSpinLeft: 0 } });
  assert.ok(primary.userData.rotor.rotation.z < 0); assert.equal(secondary.userData.rotor.rotation.z, 0);
  const mainAngle = primary.userData.rotor.rotation.z;
  world.fireSurvivor(body, 1, 'secondary');
  world.animateSurvivor(body, { time: 1.02, delta: .1, spinning: false, secondary: { minigunSpinning: true, minigunSpinLeft: 0 } });
  assert.equal(primary.userData.rotor.rotation.z, mainAngle); assert.ok(secondary.userData.rotor.rotation.z < 0);
  assert.equal(data.flash.visible, false); assert.equal(data.secondaryFlash.visible, true);
  world.setSurvivorSecondaryWeapon(body, 'sniper'); world.fireSurvivor(body, 2, 'secondary');
  world.animateSurvivor(body, { time: 2.6, delta: .1, secondary: { reloading: false } });
  assert.ok(data.secondaryGun.userData.bolt.position.z > .018);
  world.animateSurvivor(body, { time: 2.61, delta: .01, secondary: { reloading: true } });
  assert.equal(data.secondaryGun.userData.bolt.position.z, .018);
  world.setSurvivorSecondaryWeapon(body, 'flamethrower'); world.fireSurvivor(body, 3, 'secondary');
  world.animateSurvivor(body, { time: 3.01, delta: .01 }); assert.equal(data.secondaryFlash.visible, false);
  world.setSurvivorSecondaryWeapon(body, null);
  assert.ok(data.arms[0].quaternion.angleTo(ordinaryGrip) < 1e-7); assert.equal(data.secondaryFlash, null);
});


test('the actual bonus catalogue renders all fourteen choices and each Grenadier interval with its cap and first-wait rule in both languages', () => {
  const node = () => ({ children: [], dataset: {}, value: '', listeners: new Map(), append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, addEventListener(name, callback) { this.listeners.set(name, callback); } });
  const elements = new Map(), get = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  get('level').value = '1'; get('language').value = 'fr';
  const html = readFileSync(new URL('../public/bonus-catalog.html', import.meta.url), 'utf8');
  const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import[^\n]+;\s*$/gm, '');
  vm.runInNewContext(source, { SUPPLY_BONUSES, CHARACTER_BONUSES, characterBonusDescription, bonusHudCard, bonusIcon, setLanguage, t,
    document: { getElementById: get, createElement: node, documentElement: {} } });
  for (const language of ['fr', 'en']) {
    get('language').value = language; get('language').listeners.get('change')();
    for (let level = 1; level <= 8; level++) {
      get('level').value = String(level); get('level').listeners.get('input')();
      const cards = get('bonuses').children; assert.equal(cards.length, 14);
      assert.deepEqual(new Set(cards.map(card => card.dataset.bonus)), new Set(Object.keys(SUPPLY_BONUSES)));
      const grenadier = cards.find(card => card.dataset.bonus === 'grenadier');
      assert.equal(grenadier.children[2].textContent, 'Grenadier');
      assert.equal(grenadier.children[3].textContent, characterBonusDescription('grenadier', level, language));
      assert.match(grenadier.children[3].textContent, new RegExp(`${[0, 10, 10, 20, 20, 30, 40, 50][level - 1]}\\s*%`), 'the current grenade power is visible at every level');
      assert.match(grenadier.children[4].textContent, language === 'fr' ? /première.*intervalle complet/ : /first.*full interval/);
      assert.match(grenadier.children[4].textContent, /50\s*%/); assert.match(grenadier.children[4].textContent, /2/); assert.match(grenadier.children[4].textContent, language === 'fr' ? /3 à N3, 4 à N6 et 5 à N8/ : /3 at level 3, 4 at level 6 and 5 at level 8/);
      const table = grenadier.children[5].children[1]; assert.equal(table.children.length, 8);
      assert.equal(table.children[level - 1].className, 'selected');
      for (let at = 1; at <= 8; at++) assert.equal(table.children[at - 1].children[1].textContent, characterBonusDescription('grenadier', at, language));
    }
  }
  setLanguage('fr');
});
