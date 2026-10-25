import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8').replace(/^export /gm, '');
function harness(saved = null, blocked = false) {
  const writes = [], events = [], nodes = [];
  const selector = { value: '' };
  const document = {
    documentElement: { lang: 'fr' },
    querySelectorAll: query => nodes.filter(node => node.attributes.has(query.slice(1, -1))),
    querySelector: query => query === '#language-select' ? selector : null,
  };
  const context = vm.createContext({ document,
    localStorage: { getItem() { if (blocked) throw new Error('blocked'); return saved; }, setItem(key, value) { if (blocked) throw new Error('blocked'); writes.push([key, value]); } },
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { Object.assign(this, { type, detail: options.detail }); } },
  });
  vm.runInContext(`${source}\nglobalThis.api={getLanguage,setLanguage,t,weaponLabel,phaseLabel,translateMessage,translateDom,frenchOf};`, context);
  return { ...context.api, document, writes, events, selector,
    node(attributes) {
      const node = { attributes: new Map(Object.entries(attributes)), textContent: '',
        getAttribute(key) { return this.attributes.get(key); }, setAttribute(key, value) { this.attributes.set(key, value); },
        set innerHTML(_) { throw new Error('Translations must not write HTML'); },
      }; nodes.push(node); return node;
    },
  };
}

test('language defaults to French, persists per browser and survives blocked storage', () => {
  for (const saved of [null, 'xx', 'EN']) assert.equal(harness(saved).getLanguage(), 'fr');
  const first = harness('en'); assert.equal(first.getLanguage(), 'en');
  first.setLanguage('fr');
  assert.deepEqual(first.writes, [['deadwood-language', 'fr']]);
  assert.equal(first.document.documentElement.lang, 'fr');
  assert.equal(first.events.length, 1); assert.equal(first.events[0].type, 'deadwood-language-change');
  assert.equal(first.events[0].detail.language, 'fr');
  first.setLanguage('fr'); assert.equal(first.events.length, 1);
  const second = harness(); assert.equal(second.getLanguage(), 'fr');
  const blocked = harness(null, true); assert.doesNotThrow(() => blocked.setLanguage('en')); assert.equal(blocked.getLanguage(), 'en');
});

test('all annotated game copy and accessibility strings have French and English translations', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)].map(match => match[1]);
  assert.ok(new Set(keys).size >= 80);
  assert.match(html, /<label for="language-select"/);
  assert.match(html, /<option value="fr" lang="fr">Français<\/option>/);
  assert.match(html, /<option value="en" lang="en">English<\/option>/);
  const api = harness();
  for (const language of ['fr', 'en']) {
    api.setLanguage(language);
    for (const key of keys) assert.notEqual(api.t(key), key, `Missing ${language}: ${key}`);
  }
  assert.equal(api.t('setup.create'), 'CREATE A SHELTER');
  assert.match(api.t('setup.armory'), /Carry any two weapons/);
  assert.match(api.t('setup.armory'), /swaps your held weapon/);
  assert.equal(api.t('ammo.loaded'), 'LOADED');
  assert.equal(api.t('ammo.reserve'), 'RESERVE');
  assert.equal(api.t('ammo.rounds'), 'ROUNDS');
  assert.equal(api.t('ammo.slot', { slot: 2, name: 'SMG', ammo: 5, capacity: 30, reserve: 60 }), '2 SMG · 5/30 · RESERVE 60');
  assert.equal(api.t('hud.armor'), 'ARMOR');
  assert.equal(api.t('controls.crouch'), 'CROUCH');
  assert.match(api.t('controls.guide'), /Shift: sprint.*V: drop weapon.*G: grenade/);
  assert.match(api.t('controls.guide'), /Hold C: crouch/);
  assert.equal(api.t('posture.crouched'), 'CROUCHED');
  assert.equal(api.t('posture.standing'), 'HOLD C · CROUCH');
  api.setLanguage('fr'); assert.equal(api.t('ammo.slot', { slot: 2, name: 'SMG', ammo: 5, capacity: 30, reserve: 60 }), '2 SMG · 5/30 · RÉSERVE 60');
  assert.equal(api.t('pickup.armor', { armor: 100 }), 'GILET · +100 ARMURE · PROTECTION COMPLÈTE');
});

test('DOM translation uses plain text, translates input hints and leaves entered names intact', () => {
  const api = harness();
  const label = api.node({ 'data-i18n': 'setup.title' });
  const input = api.node({ 'data-i18n-placeholder': 'setup.namePlaceholder', 'data-i18n-aria-label': 'setup.loadoutLabel' });
  input.value = '<b>PISTOLET</b>';
  const title = api.node({ 'data-i18n-title': 'sound.toggle' });
  api.setLanguage('en');
  assert.equal(label.textContent, 'Survive, together.');
  assert.equal(input.attributes.get('placeholder'), 'Survivor');
  assert.equal(input.attributes.get('aria-label'), 'Shared starting loadout');
  assert.equal(title.attributes.get('title'), 'Enable / mute sound');
  assert.equal(input.value, '<b>PISTOLET</b>');
  assert.equal(api.selector.value, 'en');
  api.setLanguage('fr'); assert.equal(label.textContent, 'Survivre, ensemble.');
  assert.equal(input.value, '<b>PISTOLET</b>');
  assert.equal(api.t('boot.detail', { error: '<img onerror=alert(1)>' }), 'Vérifie que ton navigateur prend en charge WebGL et recharge la page. <img onerror=alert(1)>');
});

test('server errors and economy templates translate without altering the protocol', () => {
  const api = harness('en');
  for (const [fr, en] of [
    ['Salle introuvable. Vérifie le code et le serveur.', 'Room not found. Check the code and server.'],
    ['Cette salle contient déjà 4 survivants.', 'This room already has 4 survivors.'],
    ['Dégage le passage avant de réparer.', 'Clear the doorway before repairing.'],
    ['MAGNUM DORÉ disponible à la vague 8.', 'GOLDEN MAGNUM available at wave 8.'],
    ['Il te manque 430 pièces pour pistolet-mitrailleur.', 'You need 430 more coins for the smg.'],
    ['Acheter fusil à pompe · 850 pièces · manque 200', 'Buy shotgun · 850 coins · need 200 more'],
    ['Acheter mitrailleuse · 650 pièces · remplace pistolet', 'Buy machine gun · 650 coins · replaces pistol'],
    ['Acheter minigun · 3000 pièces · emplacement libre', 'Buy minigun · 3000 coins · empty slot'],
    ['MUNITIONS · MITRAILLEUSE +10 · MAGNUM DORÉ +1', 'AMMO · MACHINE GUN +10 · GOLDEN MAGNUM +1'],
    ['Réparer la barricade · 80 % · 4/5 planches', 'Repair the barricade · 80% · 4/5 boards'],
    ['REFUGE A7C3F2 · CONNECTÉ', 'SHELTER A7C3F2 · CONNECTED'],
  ]) assert.equal(api.translateMessage(fr), en);
  assert.equal(api.translateMessage('http://192.168.1.50:3002/?room=A7C3F2'), 'http://192.168.1.50:3002/?room=A7C3F2');
  assert.equal(api.translateMessage('Unknown future server message'), 'Unknown future server message');
});

test('player names remain literal inside messages and parameter values are never interpreted', () => {
  const api = harness('en');
  for (const name of ['Un survivant', 'PISTOLET', 'HÔTE', 'Léa · points', '<b>MITRAILLEUSE</b>', 'A a rejoint le refuge. B']) {
    assert.equal(api.translateMessage(`${name} a rejoint le refuge.`), `${name} joined the shelter.`);
    assert.equal(api.translateMessage(`Relever ${name}`), `Revive ${name}`);
    assert.equal(api.translateMessage(`${name} est de nouveau sur pied.`), `${name} is back on their feet.`);
    assert.equal(api.t('event.downed', { name }), `${name} is down. Get close and press E.`);
  }
});

test('French elides «de» before a name starting with a vowel or a mute h; English has its own form', () => {
  const i18n = harness();
  assert.deepEqual(['Léa', 'Inès', 'Émile', 'Hugo', 'Yves', 'Yann', 'Œdipe', 'Jules', 'Zoé', '3D', 'Y'].map(name => i18n.frenchOf(name)),
    ['de Léa', 'd’Inès', 'd’Émile', 'd’Hugo', 'd’Yves', 'de Yann', 'd’Œdipe', 'de Jules', 'de Zoé', 'de 3D', 'de Y']);
  assert.equal(i18n.frenchOf('<b>Ana</b>'), 'de <b>Ana</b>', 'the name is kept literally');
  const seat = name => ({ name, ofName: i18n.frenchOf(name), character: 'La Mécano' });
  assert.equal(i18n.t('save.claimSeat', seat('Inès')), 'Reprendre la place d’Inès');
  assert.equal(i18n.t('save.claimSeatAs', seat('Léa')), 'Reprendre la place de Léa (La Mécano)');
  i18n.setLanguage('en');
  assert.equal(i18n.t('save.claimSeat', seat('Inès')), 'Take Inès’s place back');
});

test('weapon and phase labels cover every game identifier in both languages', () => {
  const api = harness('en');
  assert.equal(api.weaponLabel('rifle'), 'MACHINE GUN');
  assert.equal(api.weaponLabel('shotgun'), 'SHOTGUN');
  assert.equal(api.weaponLabel('smg'), 'SMG');
  assert.equal(api.weaponLabel('magnum'), 'GOLDEN MAGNUM');
  assert.equal(api.weaponLabel('assault'), 'ASSAULT RIFLE');
  assert.equal(api.weaponLabel('rocket'), 'ROCKET LAUNCHER');
  assert.equal(api.weaponLabel('flamethrower'), 'FLAMETHROWER');
  assert.equal(api.weaponLabel('hammer'), 'SPIKED MACE');
  assert.equal(api.weaponLabel('sniper'), 'BOLT-ACTION RIFLE');
  assert.equal(api.weaponLabel('hammer', { language: 'fr' }), 'MASSE À POINTES');
  assert.equal(api.weaponLabel('sniper', { language: 'fr' }), 'FUSIL À VERROU');
  assert.equal(api.weaponLabel('assault', { language: 'fr' }), 'FUSIL D’ASSAUT');
  assert.equal(api.weaponLabel('rocket', { language: 'fr' }), 'LANCE-ROQUETTES');
  assert.equal(api.weaponLabel('flamethrower', { language: 'fr' }), 'LANCE-FLAMMES');
  assert.equal(api.weaponLabel('rifle', { language: 'fr' }), 'MITRAILLEUSE');
  assert.equal(api.weaponLabel('magnum', { short: true }), 'MAGNUM');
  for (const id of ['lobby', 'countdown', 'wave', 'intermission', 'extraction', 'victory', 'gameover']) assert.notEqual(api.phaseLabel(id), id);
  api.setLanguage('fr'); assert.equal(api.phaseLabel('gameover'), 'LA LUMIÈRE S’EST ÉTEINTE');
  assert.equal(api.translateMessage('Tu es à terre. Appelle un coéquipier !'), 'Tu es à terre. Appelle un coéquipier !');
});

test('raid copy has explicit French and English keys and keeps the French typography', () => {
  const api = harness();
  const keys = ['raid.kicker', 'raid.title', 'raid.squad', 'raid.side.north', 'raid.side.south', 'raid.side.west', 'raid.side.east', 'raid.waveWarning', 'raid.nextWave',
    'raid.infectedOne', 'raid.infectedMany', 'raid.raiderOne', 'raid.raiderMany', 'raid.repelled', 'raid.repelledOne', 'raid.retreated', 'raid.bonus', 'raid.retreat',
    'raid.drillHits', 'raid.try', 'practice.raiders', 'enemyGuide.raiders'];
  const french = {};
  for (const language of ['fr', 'en']) {
    api.setLanguage(language);
    for (const key of keys) { assert.notEqual(api.t(key), key, `${language}: ${key}`); if (language === 'fr') french[key] = api.t(key); else assert.notEqual(api.t(key), french[key], `${key} is translated`); }
  }
  api.setLanguage('fr');
  assert.equal(api.t('raid.kicker'), 'PILLARDS !');
  assert.equal(api.t('raid.title', { index: 1, count: 3, side: api.t('raid.side.west') }), 'Raid 1/3 · côté ouest');
  assert.equal(api.t('raid.squad', { side: api.t('raid.side.north') }), 'Renforts pillards · côté nord');
  assert.equal(api.t('raid.waveWarning', { wave: '05' }), 'Vague 05 : des pillards attaqueront en fin de vague.');
  assert.equal(`${api.t('raid.repelled', { index: 1, count: 3, killed: 3 })} · ${api.t('raid.bonus', { bonus: 50 })}`, 'Raid 1/3 repoussé · 3 pillards abattus · +50 pièces chacun');
  assert.equal(api.t('raid.retreated'), 'Les pillards se sont repliés');
  assert.equal(api.t('raid.retreat'), 'Les pillards battent en retraite !');
  assert.equal(api.t('raid.try'), 'Essayer les pillards');
  assert.match(api.t('enemyGuide.raiders'), /l’appui/);
  assert.match(api.t('radar.legend'), /✕ pillard/);
  api.setLanguage('en');
  assert.equal(api.t('raid.kicker'), 'RAIDERS!');
  assert.equal(api.t('raid.title', { index: 2, count: 3, side: api.t('raid.side.east') }), 'Raid 2/3 · east side');
  assert.equal(api.t('raid.try'), 'Try the raiders');
  assert.match(api.t('radar.legend'), /✕ raider/);
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<p id="enemy-guide-raiders" class="enemy-guide-raiders" data-i18n="enemyGuide.raiders">/);
  assert.match(html, /<button id="practice-raiders" class="outline" data-i18n="raid.try">Essayer les pillards<\/button>/);
  const source = readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf("'raid.kicker'") < source.indexOf("'aim.title'"), 'raid copy sits with the HUD keys, before the aim diagnostics');
});

test('supply choices, denials and scope controls translate independently from room messages',()=>{
  const api=harness();
  const keys=['sniper.scope','sniper.bolt','supply.crate','supply.station','supply.context','supply.crateHint','supply.claimedHint','supply.stationHint','supply.lockedHint','supply.crateNote','supply.stationNote','supply.expiry','supply.live','supply.return','supply.active','supply.price','supply.funds','supply.purchased','supply.ineligible','supply.claimed','supply.bought','supply.droppedBonus','supply.replacesBonus','armory.magnumUnavailable','armory.magnumUnique'];
  for(const bonus of ['stone','perforating','extended'])keys.push(`bonus.${bonus}`,`bonus.${bonus}Detail`);
  for(const service of ['grenade','armor','ammo'])keys.push(`service.${service}`,`service.${service}Detail`);
  for(const reason of ['claimed','missing','unavailable','ineligible','funds','full','purchased','out-of-reach','generic'])keys.push(`supply.denied.${reason}`);
  for(const language of ['fr','en']){
    api.setLanguage(language);
    for(const key of keys)assert.notEqual(api.t(key),key,`${language}:${key}`);
  }
  assert.equal(api.t('supply.expiry',{wave:7}),'Next choice at wave 7');
  assert.equal(api.t('sniper.bolt',{seconds:'0.8'}),'BOLT · 0.8 S');
  assert.equal(api.translateMessage('Acheter masse à pointes · 1000 pièces · emplacement libre'),'Buy spiked mace · 1000 coins · empty slot');
  assert.equal(api.translateMessage('Acheter fusil à verrou · 3200 pièces · emplacement libre'),'Buy bolt-action rifle · 3200 coins · empty slot');
});
