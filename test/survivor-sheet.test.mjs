import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { characterStats } from '../public/character-bonuses.js';
import { claimStep } from '../public/character-sheet.js';
import { SUPPLY_BONUSES } from '../public/weapon-upgrades.js';
import { t, setLanguage } from '../public/i18n.js';
import { upgradedWeapon } from '../public/weapon-upgrades.js';
import { survivorSheetModel, survivorSheetKey, survivorStatRows, survivorWeaponSection, renderSurvivorSheet, readSheetShown, saveSheetShown,
  SURVIVOR_SHEET_KEY, SHEET_MODES, SHEET_COLUMN_WIDTH, sheetRegion, sheetSlot, sheetSlots, distributeSheet, fillSlots, chooseSheetLayout,
  placeSurvivorSheet, sheetFeedPlace, sheetBreachRight, SHEET_GAP, SHEET_BREACH_BAND } from '../public/survivor-sheet.js';

// «Mon survivant» (owner, 18 October): what the bonuses really give. Every
// number is checked against the server's own characterStats and weaponProfile
// for the same player, read through a real snapshot and the base table the
// server publishes in /world.json (the same JSON round trip as the browser).
const PUBLISHED = JSON.parse(JSON.stringify(WEAPONS));
function survivor({ sheet = null, bonus = null, debt, weapon = 'pistol' } = {}) {
  const simulation = new RoomSimulation('ABC123');
  simulation.addPlayer('p', 'Jules', undefined, { sheet });
  const player = simulation.players.get('p');
  if (bonus) player.bonus = { ...bonus };
  if (debt !== undefined) player.sheetDebt = { ...debt };
  player.inventory = { [weapon]: { ammo: 0, reserve: 0 } }; player.weapon = weapon; player.weaponId = weapon;
  const snapshot = simulation.snapshot().players.find(entry => entry.id === 'p');
  return { simulation, player, snapshot, profile: simulation.weaponProfile(player), stats: characterStats(player) };
}
const model = (snapshot, language = 'fr') => { setLanguage(language); try { return survivorSheetModel(snapshot, { weapons: PUBLISHED, t, language }); } finally { setLanguage('fr'); } };
const statValue = (sheet, id) => sheet.stats.find(row => row.id === id);
const weaponRow = (sheet, id) => sheet.weapon.rows.find(row => row.id === id);
const signed = value => value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0';

test('the standard survivor: one short line, and the pistol exactly as the server builds it', () => {
  const { snapshot, profile } = survivor();
  const sheet = model(snapshot);
  assert.equal(sheet.who, 'Jules');
  assert.equal(sheet.standard, true);
  assert.deepEqual(sheet.stats, []); assert.deepEqual(sheet.bonuses, []);
  assert.equal(sheet.weapon.name, 'PISTOLET');
  assert.equal(weaponRow(sheet, 'damage').text, String(Math.round(profile.damage)));
  assert.equal(weaponRow(sheet, 'damage').tone, null);
  assert.equal(weaponRow(sheet, 'magazine').value, profile.magazine); assert.equal(weaponRow(sheet, 'magazine').value, snapshot.magazine);
  assert.equal(weaponRow(sheet, 'reserve').value, profile.reserve); assert.equal(weaponRow(sheet, 'reserve').value, snapshot.reserveCapacity);
  assert.equal(weaponRow(sheet, 'pierce'), undefined, 'a pistol bullet stops in the first body: no line');
  const english = model(snapshot, 'en');
  assert.equal(english.weapon.name, 'PISTOL'); assert.equal(weaponRow(english, 'damage').label, 'Damage per bullet');
  // Without the published table the snapshot's own magazine still shows, never a guess.
  setLanguage('fr');
  const bare = survivorSheetModel(snapshot, { weapons: null, t, language: 'fr' });
  assert.deepEqual(bare.weapon.rows.map(row => [row.id, row.text]), [['magazine', String(snapshot.magazine)], ['reserve', String(snapshot.reserveCapacity)]]);
});

test('a talented Lumberjack: melee lines, his numbers and «N2 → N4 · Talent ×2», all from the server rules', () => {
  const { snapshot, player, profile, stats } = survivor({ sheet: { preset: 'lumberjack' }, bonus: { stone: 3, vitality: 2 }, weapon: 'katana' });
  const sheet = model(snapshot);
  assert.equal(sheet.who, 'Jules · Le Bûcheron');
  const base = WEAPONS.katana;
  assert.equal(weaponRow(sheet, 'light').text, `${Math.round(base.attacks.light.damage)} → ${Math.round(profile.attacks.light.damage)}`);
  assert.equal(weaponRow(sheet, 'heavy').text, `${Math.round(base.attacks.heavy.damage)} → ${Math.round(profile.attacks.heavy.damage)}`);
  assert.equal(weaponRow(sheet, 'targets').value, profile.attacks.light.maxTargets);
  assert.equal(weaponRow(sheet, 'light').tone, 'bonus');
  assert.equal(weaponRow(sheet, 'magazine'), undefined, 'a blade has no magazine line');
  assert.equal(statValue(sheet, 'maxHp').value, `100 → ${stats.maxHp}`); assert.equal(statValue(sheet, 'maxHp').tone, 'bonus');
  // Tinkering −1: a weaker plank repair, in red with the word «malus».
  assert.equal(statValue(sheet, 'repair').value, `25 → ${stats.repairHp} PV`); assert.equal(statValue(sheet, 'repair').tone, 'malus');
  // Chemistry −1: the smell and the weaker medkits.
  assert.equal(statValue(sheet, 'smell').value, `zombies +${Math.round(stats.haste * 100)} % à ${String(stats.hasteRadius).replace('.', ',')} m`);
  assert.equal(statValue(sheet, 'medkit').value, `100 → ${Math.round(stats.medkitHealMultiplier * 100)} %`);
  assert.equal(statValue(sheet, 'grenades').value, `2 → ${stats.maxGrenades}`);
  const vitality = sheet.bonuses.find(row => row.kind === 'vitality'), step = claimStep(player, 'vitality');
  assert.equal(step.talent, true);
  assert.equal(vitality.levelText, 'N2/8'); assert.equal(vitality.effect, `${stats.maxHp} PV maximum`);
  assert.equal(vitality.next, `Prochaine prise : N2 → N${step.to} · Talent ×2`);
  const stone = sheet.bonuses.find(row => row.kind === 'stone');
  assert.equal(stone.active, true); assert.match(stone.effect, /^Mêlée \+30 %/);
  const english = model(snapshot, 'en');
  assert.equal(english.bonuses.find(row => row.kind === 'vitality').next, `Next claim: L2 → L${step.to} · Talent ×2`);
  assert.equal(statValue(english, 'repair').value, `25 → ${stats.repairHp} HP`);
});

test('a debt survivor (the Pyro): red lines that match the server, and «−1 → 0» for the next claim', () => {
  const { snapshot, player, profile, stats } = survivor({ sheet: { preset: 'pyro' } });
  assert.deepEqual(player.sheetDebt, { stone: 1, vitality: 1, rainproof: 1, toughskin: 1, perforating: 1, reinforced: 1 });
  const sheet = model(snapshot);
  assert.equal(sheet.standard, false);
  // Reinforced rounds at −1: the pistol hits softer, exactly as upgradedWeapon says.
  assert.ok(profile.damage < WEAPONS.pistol.damage);
  assert.equal(weaponRow(sheet, 'damage').text, `${Math.round(WEAPONS.pistol.damage)} → ${Math.round(profile.damage)}`);
  assert.equal(weaponRow(sheet, 'damage').tone, 'malus');
  assert.equal(statValue(sheet, 'maxHp').value, `100 → ${stats.maxHp}`); assert.equal(stats.maxHp, 90);
  assert.equal(statValue(sheet, 'maxHp').tone, 'malus');
  assert.equal(statValue(sheet, 'rain').value, `${signed(Math.round((stats.rainMultiplier - 1) * 100))} %`);
  assert.equal(statValue(sheet, 'combat').value, `+${Math.round((stats.combatMultiplier - 1) * 100)} %`);
  assert.equal(statValue(sheet, 'combat').tone, 'malus');
  assert.deepEqual(sheet.bonuses.map(row => row.kind), ['stone', 'perforating', 'reinforced', 'vitality', 'rainproof', 'toughskin']);
  for (const row of sheet.bonuses) {
    assert.equal(row.levelText, '−1', row.kind); assert.equal(row.tone, 'malus', row.kind);
    assert.equal(row.next, 'Prochaine prise : −1 → 0', row.kind);
  }
  assert.equal(sheet.bonuses.find(row => row.kind === 'perforating').effect, 'Pas de malus : il faut juste une prise de plus à la caisse');
  // A picked-up level offsets a debt: «0», neutral, then a real level.
  player.bonus = { vitality: 1 };
  const offset = model(survivorSnapshot(player));
  const vitality = offset.bonuses.find(row => row.kind === 'vitality');
  assert.equal(vitality.levelText, '0'); assert.equal(vitality.tone, 'neutral'); assert.equal(vitality.effect, 'Malus compensé');
  assert.equal(statValue(offset, 'maxHp'), undefined, 'offset: 100 HP like a standard survivor');
});
function survivorSnapshot(player) {
  const simulation = new RoomSimulation('ABC123'); simulation.players.set(player.id, player); return simulation.snapshot().players.find(entry => entry.id === player.id);
}

test('a heavy loadout: eleven bonuses and three debts, every number from characterStats and weaponProfile', () => {
  const { snapshot, player, profile, stats } = survivor({
    sheet: { preset: null, name: 'Fusée', stats: { strength: 1, agility: -2, ballistics: 1, tinkering: 0, chemistry: 0 } },
    bonus: { stone: 3, perforating: 6, extended: 3, reinforced: 4, radar: 5, vitality: 4, rainproof: 4, toughskin: 2, grenadier: 5, frostaura: 3, medic: 3, switching: 2 },
    debt: { vitamins: 2, reload: 1, switching: 2 }, weapon: 'assault' });
  const sheet = model(snapshot);
  assert.equal(sheet.who, 'Jules · Fusée');
  // The weapon: the server's profile, with the bonuses AND the debts.
  const base = WEAPONS.assault;
  assert.deepEqual(sheet.weapon.rows.map(row => [row.id, row.base, row.value]), [
    ['damage', Math.round(base.damage), Math.round(profile.damage)],
    ['magazine', base.magazine, profile.magazine], ['reserve', base.reserve, profile.reserve],
    ['pierce', base.penetrationTargets, profile.penetrationTargets]]);
  assert.equal(profile.magazine, snapshot.magazine); assert.equal(profile.reserve, snapshot.reserveCapacity);
  assert.deepEqual([Math.round(profile.damage), profile.magazine, profile.reserve, profile.penetrationTargets], [55, 31, 94, 4]);
  // The survivor: only what differs from the standard one, signs included.
  const pct = value => Math.round((value - 1) * 100);
  assert.deepEqual(Object.fromEntries(sheet.stats.map(row => [row.id, [row.value, row.tone]])), {
    maxHp: [`100 → ${stats.maxHp}`, 'bonus'],
    speed: [`${signed(pct(stats.speedMultiplier))} %`, 'malus'],
    reload: [`${signed(pct(stats.reloadMultiplier))} %`, 'malus'],
    combat: [`${signed(pct(stats.combatMultiplier))} %`, 'bonus'],
    rain: [`${signed(pct(stats.rainMultiplier))} %`, 'bonus'],
    revive: [`5 → ${String(stats.reviveSeconds).replace('.', ',')} s`, 'bonus'],
    grenades: [`2 → ${stats.maxGrenades}`, 'bonus'],
    freeGrenade: [`toutes les ${stats.grenadeIntervalSeconds} s`, 'bonus'],
    grenadeDamage: [`+${pct(stats.grenadeDamageMultiplier)} %`, 'bonus'],
    aura: [`zombies −${Math.round(stats.auraSlow * 100)} % à ${String(stats.auraRadius).replace('.', ',')} m`, 'bonus'],
    radar: ['Types d’ennemis · 4 s · 25 m', 'bonus'],
  });
  assert.equal(stats.switchSeconds, .25, 'switching N2 − debt 2 = offset: no swap line');
  // One row per bonus or debt, in the crate's order.
  assert.deepEqual(sheet.bonuses.map(row => row.kind), Object.keys(SUPPLY_BONUSES).filter(kind => player.bonus[kind] || player.sheetDebt[kind]));
  assert.equal(sheet.bonuses.length, 14);
  const row = kind => sheet.bonuses.find(entry => entry.kind === kind);
  assert.deepEqual([row('vitamins').levelText, row('vitamins').effect, row('vitamins').next], ['−2', '−8 % vitesse de déplacement', 'Prochaine prise : −2 → −1']);
  assert.deepEqual([row('switching').levelText, row('switching').next], ['0', 'Prochaine prise : 0 → N1']);
  assert.equal(row('stone').active, false); assert.match(row('stone').effect, /Autre arme$/);
  assert.equal(row('perforating').effect, 'Perforation +2 cibles');
  assert.equal(row('toughskin').next, `Prochaine prise : N2 → N${claimStep(player, 'toughskin').to} · Talent ×2`);
  player.bonus.vitality = 8;
  assert.equal(model(survivorSnapshot(player)).bonuses.find(entry => entry.kind === 'vitality').next, 'Niveau maximum');
});

test('every weapon shows only the lines that apply to it, from the published table', () => {
  const bonus = { stone: 4, perforating: 8, extended: 2, reinforced: 2 };
  for (const weapon of Object.keys(WEAPONS)) {
    const { snapshot, profile } = survivor({ bonus, weapon });
    const ids = model(snapshot).weapon.rows.map(row => row.id), base = WEAPONS[weapon];
    if (base.melee) assert.deepEqual(ids, ['light', 'heavy', 'targets'], weapon);
    else if (base.fuel) assert.deepEqual(ids, ['magazine', 'reserve'], weapon);
    else if (base.explosive) assert.deepEqual(ids, ['damage', 'magazine', 'reserve'], weapon);
    else assert.deepEqual(ids, base.penetrationTargets > 1 || profile.penetrationTargets !== base.penetrationTargets ? ['damage', 'magazine', 'reserve', 'pierce'] : ['damage', 'magazine', 'reserve'].filter(id => id !== 'reserve' || base.reserve > 0 || profile.reserve > 0), weapon);
    for (const row of model(snapshot).weapon.rows) if (['magazine', 'reserve'].includes(row.id)) assert.equal(row.value, profile[row.id], `${weapon} ${row.id}`);
  }
  const shotgun = model(survivor({ weapon: 'shotgun' }).snapshot);
  assert.equal(weaponRow(shotgun, 'damage').label, 'Dégâts par plomb (×9)');
  const rocket = model(survivor({ bonus, weapon: 'rocket' }).snapshot);
  assert.equal(weaponRow(rocket, 'damage').text, String(WEAPONS.rocket.damage), 'no bonus reaches the rocket');
  assert.equal(survivorWeaponSection({ weapon: null }, { t }).name, t('ground.unarmed'));
});

test('a missing player or a waiting spectator never throws', () => {
  assert.equal(survivorSheetModel(null, { t }), null);
  assert.equal(survivorSheetKey(undefined), '');
  assert.deepEqual(survivorStatRows(null, { t }), []);
  const sheet = survivorSheetModel({ id: 'x', name: '', bonus: null }, { weapons: PUBLISHED, t });
  assert.equal(sheet.who, t('player.unknown')); assert.equal(sheet.standard, true);
});

test('the cache key follows what the sheet shows, and only that', () => {
  const { snapshot } = survivor({ bonus: { vitality: 2 } });
  const key = survivorSheetKey(snapshot, { weapons: PUBLISHED, language: 'fr' });
  assert.equal(survivorSheetKey({ ...snapshot, x: 3, hp: 12, ammo: 1 }, { weapons: PUBLISHED, language: 'fr' }), key, 'moving, health and ammo do not rebuild it');
  for (const changed of [{ ...snapshot, bonus: { vitality: 3 } }, { ...snapshot, weapon: 'smg' }, { ...snapshot, sheetDebt: { vitamins: 1 } }])
    assert.notEqual(survivorSheetKey(changed, { weapons: PUBLISHED, language: 'fr' }), key);
  assert.notEqual(survivorSheetKey(snapshot, { weapons: PUBLISHED, language: 'en' }), key);
  assert.notEqual(survivorSheetKey(snapshot, { weapons: null, language: 'fr' }), key);
});

test('the shown/hidden choice is remembered per browser and survives a blocked storage', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readSheetShown(storage), false, 'hidden by default');
  assert.equal(saveSheetShown(storage, true), true); assert.equal(values.get(SURVIVOR_SHEET_KEY), 'shown');
  assert.equal(readSheetShown(storage), true);
  saveSheetShown(storage, false); assert.equal(readSheetShown(storage), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readSheetShown(blocked), false); assert.equal(saveSheetShown(blocked, true), false);
  assert.equal(readSheetShown(null), false);
});

test('the DOM is plain text, with a «malus» word beside every red number', () => {
  class Node {
    constructor(tag) { Object.assign(this, { tagName: tag, children: [], dataset: {}, className: '', html: '', text: '' }); }
    append(...children) { this.children.push(...children); } replaceChildren(...children) { this.children = children; }
    set textContent(value) { this.text = String(value); } get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { this.html = value; }
    all() { return [this, ...this.children.flatMap(child => child.all())]; }
  }
  const document = { createElement: tag => new Node(tag) }, root = new Node('aside');
  const { snapshot } = survivor({ sheet: { preset: 'pyro' }, bonus: { grenadier: 2 } });
  setLanguage('fr');
  renderSurvivorSheet(root, survivorSheetModel(snapshot, { weapons: PUBLISHED, t, language: 'fr' }), { document, t, icon: kind => `<i data-kind="${kind}"></i>` });
  const nodes = root.all();
  assert.equal(nodes.find(node => node.className === 'sheet-title').textContent, 'Mon survivant');
  assert.equal(nodes.find(node => node.className === 'sheet-who').textContent, 'Jules · L’Artificier');
  const malus = nodes.filter(node => node.className === 'sheet-row' && node.dataset.tone === 'malus');
  assert.ok(malus.length >= 4);
  for (const row of malus) assert.ok(row.all().some(node => node.className === 'sheet-tag' && node.textContent === 'malus'), row.textContent);
  const bonuses = nodes.filter(node => node.className.startsWith('sheet-bonus '));
  assert.deepEqual(bonuses.map(node => node.dataset.tone), ['malus', 'malus', 'malus', 'malus', 'malus', 'malus', 'bonus']);
  assert.equal(bonuses.at(-1).children[0].html, '<i data-kind="grenadier"></i>', 'only the fixed icon markup is HTML');
  assert.ok(nodes.every(node => node.className === 'sheet-icon' ? /^<i data-kind="\w+"><\/i>$/.test(node.html) : node.html === ''), 'no other HTML');
  assert.match(root.textContent, /Arme en main · PISTOLET/);
  renderSurvivorSheet(root, null, { document, t }); assert.equal(root.children.length, 0);
});


// Review fixes (18 October). The label of the piercing line says what the
// number is: every body a bullet hits, the first one included.
test('«Cibles par balle» counts the bodies a bullet hits, as the server does: a pistol with N3 hits two', () => {
  const plain = model(survivor().snapshot);
  assert.equal(weaponRow(plain, 'pierce'), undefined, 'a plain pistol bullet stops in its first body: no line');
  const { snapshot, profile } = survivor({ bonus: { perforating: 3 } });
  assert.equal(profile.penetrationTargets, 2);
  const row = weaponRow(model(snapshot), 'pierce');
  assert.deepEqual([row.label, row.text, row.tone], ['Cibles par balle', '1 → 2', 'bonus']);
  assert.equal(weaponRow(model(snapshot, 'en'), 'pierce').label, 'Targets per bullet');
  const rifle = survivor({ weapon: 'rifle' });
  assert.equal(weaponRow(model(rifle.snapshot), 'pierce').text, String(rifle.profile.penetrationTargets));
  const shotgun = survivor({ bonus: { perforating: 6 }, weapon: 'shotgun' });
  assert.deepEqual([weaponRow(model(shotgun.snapshot), 'pierce').label, weaponRow(model(shotgun.snapshot), 'pierce').value], ['Cibles par plomb', shotgun.profile.penetrationTargets]);
  assert.equal(weaponRow(model(shotgun.snapshot, 'en'), 'pierce').label, 'Targets per pellet');
  // «Perforation +1 cible» on the bonus row: the same body, one more.
  assert.equal(model(snapshot).bonuses[0].effect, 'Perforation +1 cible');
});

test('maximums say so: «Réserve max» and «Grenades max», next to the counts the weapon panel shows', () => {
  const { snapshot, profile, stats } = survivor({ bonus: { extended: 2, grenadier: 3 } });
  const sheet = model(snapshot);
  assert.deepEqual([weaponRow(sheet, 'reserve').label, weaponRow(sheet, 'reserve').value], ['Réserve max', profile.reserve]);
  assert.deepEqual([statValue(sheet, 'grenades').label, statValue(sheet, 'grenades').value], ['Grenades max', `2 → ${stats.maxGrenades}`]);
  const english = model(snapshot, 'en');
  assert.equal(weaponRow(english, 'reserve').label, 'Max reserve'); assert.equal(statValue(english, 'grenades').label, 'Max grenades');
});

test('a weapon debt the weapon in hand does not feel says «Autre arme», like the bonuses', () => {
  // The Pyro (Ballistics −1) holding a katana: his bullet debt does not touch a blade.
  const pyro = model(survivor({ sheet: { preset: 'pyro' }, weapon: 'katana' }).snapshot);
  const reinforced = pyro.bonuses.find(row => row.kind === 'reinforced'), stone = pyro.bonuses.find(row => row.kind === 'stone');
  assert.deepEqual([reinforced.active, reinforced.effect], [false, '−8 % dégâts des balles · Autre arme']);
  assert.equal(stone.active, true, 'his Strength debt does weaken the katana'); assert.doesNotMatch(stone.effect, /Autre arme/);
  // The Mechanic (Strength −1) holding a pistol: no melee malus on a pistol.
  const mechanic = model(survivor({ sheet: { preset: 'mechanic' } }).snapshot);
  assert.deepEqual([mechanic.bonuses.find(row => row.kind === 'stone').active, mechanic.bonuses.find(row => row.kind === 'stone').effect], [false, '−10 % dégâts de mêlée · Autre arme']);
  // Every weapon and every weapon debt: «in effect» exactly when upgradedWeapon changes the weapon.
  for (const kind of ['stone', 'extended', 'reinforced']) for (const weapon of Object.keys(WEAPONS)) {
    const { snapshot } = survivor({ debt: { [kind]: 1 }, weapon });
    const row = model(snapshot).bonuses.find(entry => entry.kind === kind);
    const felt = JSON.stringify(upgradedWeapon(WEAPONS[weapon], weapon, null, { [kind]: 1 })) !== JSON.stringify(WEAPONS[weapon]);
    assert.equal(row.active, felt, `${kind} on ${weapon}`);
    assert.equal(/Autre arme$/.test(row.effect), !felt, `${kind} on ${weapon}`);
  }
});

test('two weapons in hand: the second one gets its own block, from the server profile', () => {
  const simulation = new RoomSimulation('ABC123');
  simulation.addPlayer('p', 'Jules');
  const player = simulation.players.get('p');
  player.bonus = { switching: 8, extended: 4 };
  player.inventory = { pistol: { ammo: 12, reserve: 36 }, sniper: { ammo: 5, reserve: 10 } }; player.weapon = 'pistol'; player.weaponId = 'pistol';
  assert.equal(simulation.setDualWield('p', true, 'sniper'), true);
  const snapshot = JSON.parse(JSON.stringify(simulation.snapshot().players.find(entry => entry.id === 'p')));
  assert.equal(snapshot.dualWield, true); assert.equal(snapshot.hands.secondary.weapon, 'sniper');
  const sheet = model(snapshot), second = simulation.weaponProfile(player, 'sniper');
  assert.equal(sheet.weapon.name, 'PISTOLET'); assert.equal(sheet.offhand.name, 'FUSIL À VERROU');
  assert.equal(sheet.offhand.rows.find(row => row.id === 'magazine').value, second.magazine);
  assert.equal(sheet.offhand.rows.find(row => row.id === 'magazine').value, snapshot.hands.secondary.magazine);
  assert.equal(sheet.offhand.rows.find(row => row.id === 'reserve').value, second.reserve);
  assert.equal(sheet.offhand.rows.find(row => row.id === 'damage').value, Math.round(second.damage));
  // The DOM names both hands.
  const nodes = [];
  class Node { constructor() { Object.assign(this, { children: [], dataset: {}, className: '', text: '' }); nodes.push(this); }
    append(...children) { this.children.push(...children); } replaceChildren(...children) { this.children = children; }
    set textContent(value) { this.text = String(value); } get textContent() { return this.text + this.children.map(child => child.textContent ?? child).join(''); } set innerHTML(value) {} }
  setLanguage('fr');
  renderSurvivorSheet(new Node(), sheet, { document: { createElement: () => new Node() }, t });
  assert.ok(nodes.some(node => node.dataset.section === 'offhand' && node.dataset.block === 'heading' && node.textContent === 'Arme secondaire · FUSIL À VERROU'));
  assert.ok(nodes.some(node => node.dataset.section === 'weapon' && node.dataset.block === 'heading' && node.textContent === 'Arme principale · PISTOLET'));
  // Not dual: no second block. The cache key follows the second hand.
  assert.equal(model({ ...snapshot, dualWield: false }).offhand, null);
  const key = survivorSheetKey(snapshot, { weapons: PUBLISHED });
  assert.notEqual(survivorSheetKey({ ...snapshot, dualWield: false }, { weapons: PUBLISHED }), key);
  assert.notEqual(survivorSheetKey({ ...snapshot, secondaryWeaponId: 'smg', hands: { ...snapshot.hands, secondary: { ...snapshot.hands.secondary, weapon: 'smg' } } }, { weapons: PUBLISHED }), key);
});

// The room, from the HUD as laid out in a real wave at 1280 × 720 (weapon
// panel with its grenade row, wave panel with the generator line).
const HUD_1280 = { viewport: { width: 1280, height: 720 }, score: { left: 1128, right: 1246, top: 91, bottom: 172 },
  weapon: { left: 935, right: 1245, top: 358, bottom: 686 }, wave: { left: 565, right: 715, top: 97, bottom: 215 } };
test('the room: under the score, stepped up beside it, clear of the crosshair, the wave panel and the breach alert', () => {
  const region = sheetRegion(HUD_1280);
  assert.equal(region.minLeft, 730, 'the crosshair keeps 90 px on its right');
  const under = sheetSlot(region, 1000, 1245), band = sheetSlot(region, 1000, 1100), free = sheetSlot(region, 760, 980);
  assert.deepEqual([under.top, under.bottom], [172 + SHEET_GAP, 358 - SHEET_GAP], 'under the score, above the weapon panel');
  assert.equal(band.top, 91 + SHEET_BREACH_BAND, 'under the breach alert beside the score');
  assert.equal(free.top, 91, 'further left, level with the score');
  assert.ok(sheetSlot(region, 700, 900).top > 215, 'over the wave panel only below it');
  assert.equal(sheetBreachRight(region), 1280 - 1128 + SHEET_GAP, 'the breach alert stands just left of the score');
  // Slots right to left from the weapon panel's right edge, read left to right.
  const slots = sheetSlots(region, { width: 240, columns: 2 });
  assert.deepEqual(slots.map(slot => [slot.left, slot.right, slot.top]), [[757, 997, 119], [1005, 1245, 180]]);
  assert.deepEqual(sheetSlots(region, { width: 240, columns: 2, aligned: true }).map(slot => slot.top), [180, 180]);
  assert.equal(sheetSlots(region, { width: 260, columns: 2 }), null, 'never into the crosshair room');
  // A short screen (1280 × 600): the slot under the score is too short and
  // stays empty; beside the weapon panel, a slot steps left of its edge.
  const short = sheetRegion({ ...HUD_1280, viewport: { width: 1280, height: 600 }, weapon: { left: 935, right: 1245, top: 238, bottom: 566 } });
  assert.deepEqual(sheetSlots(short, { width: 191, columns: 2, anchor: 1120, beside: true }).map(slot => [slot.left, slot.right, slot.top, slot.bottom]),
    [[730, 921, 91, 600 - 240 - SHEET_GAP], [929, 1120, 119, 230]]);
  assert.deepEqual(sheetSlots(short, { width: 191, columns: 1 }).map(slot => [slot.left, slot.top, slot.bottom]), [[855, 119, 230]], 'the 50 px under the score are skipped');
});

const blocks = (...entries) => entries.map(([kind, section, height]) => ({ kind, section, height }));
test('columns: a heading keeps its first row, a section that goes on repeats its heading, reading order kept', () => {
  const content = blocks(['head', 'head', 20], ['heading', 'weapon', 16], ['item', 'weapon', 14], ['item', 'weapon', 14],
    ['heading', 'stats', 16], ['item', 'stats', 14], ['item', 'stats', 14], ['item', 'stats', 14], ['heading', 'bonuses', 16], ['item', 'bonuses', 20], ['item', 'bonuses', 20]);
  const columns = distributeSheet(content, [110, 110]);
  const ids = columns.map(column => column.items.map(item => `${item.index}${item.repeat ? '+' : ''}`));
  assert.deepEqual(ids, [['0', '1', '2', '3', '4', '5', '6'], ['4+', '7', '8', '9', '10']], 'Mes chiffres goes on under its own heading');
  // A heading never ends a column: it moves with its first row.
  assert.deepEqual(distributeSheet(content, [82, 200]).map(column => column.items.map(item => `${item.index}${item.repeat ? '+' : ''}`)), [['0', '1', '2', '3'], ['4', '5', '6', '7', '8', '9', '10']]);
  assert.equal(distributeSheet(content, [90, 90]), null, 'does not fit');
  assert.equal(distributeSheet(blocks(['item', 'bonuses', 120]), [100, 200]), null, 'a block taller than an empty column fits nowhere');
  // One section only: nothing to mix up, no copy.
  const single = blocks(['heading', 'bonuses', 16], ['item', 'bonuses', 30], ['item', 'bonuses', 30], ['item', 'bonuses', 30]);
  assert.deepEqual(distributeSheet(single, [80, 80], { repeat: false }).map(column => column.items.map(item => item.repeat)), [[false, false, false], [false]]);
  // Balanced: the lowest common bottom line that fits.
  const filled = fillSlots([{ top: 100, bottom: 400 }, { top: 100, bottom: 400 }], blocks(['heading', 'bonuses', 10], ['item', 'bonuses', 50], ['item', 'stats', 50], ['item', 'stats', 50], ['item', 'stats', 50]), 10);
  assert.equal(filled.bottom, 100 + 10 + 110, 'two rows a column, not four in the first');
});

// A synthetic measure: every block height grows as the density falls; the
// stats disappear from density 5 and the weapon from density 6.
function fakeMeasure(rows) {
  return (density, width) => {
    const line = density >= 4 ? 13 : density >= 2 ? 15 : 17, wide = width >= 250 ? 1 : 1.25;
    return { chrome: 12, overflow: false, blocks: [['head', 'head'], ['heading', 'weapon'], ...Array(4).fill(['item', 'weapon']),
      ['heading', 'stats'], ...Array(rows).fill(['item', 'stats']), ['heading', 'bonuses'], ...Array(rows).fill(['item', 'bonuses'])].map(([kind, section]) => ({ kind, section,
      height: kind === 'head' ? (density >= 4 ? 0 : 18) : section === 'stats' && density >= 5 ? 0 : section === 'weapon' && density >= 6 ? 0
        : kind === 'heading' ? 16 : section === 'bonuses' ? line * (density === 0 ? 3 : density <= 2 ? 2 : 1) * wide : line * wide })) };
  };
}
test('the steps: the roomiest readable step that fits, the tightest last, cut only when nothing fits', () => {
  const region = sheetRegion({ viewport: { width: 1920, height: 1080 }, score: { left: 1768, right: 1886, top: 91, bottom: 172 },
    weapon: { left: 1575, right: 1885, top: 682, bottom: 1018 }, wave: { left: 885, right: 1035, top: 97, bottom: 215 } });
  const light = chooseSheetLayout(region, fakeMeasure(3));
  assert.deepEqual([light.density, light.columns.length, light.clipped], [0, 1, undefined]);
  const heavy = chooseSheetLayout(region, fakeMeasure(14));
  assert.ok(heavy.density <= 2, 'a big screen keeps the bonus effects'); assert.equal(heavy.beside, false);
  // A 720p wave: denser, still whole, never beside the weapon panel when above it is enough.
  const small = chooseSheetLayout(sheetRegion(HUD_1280), fakeMeasure(14));
  assert.ok(!small.clipped); assert.equal(small.beside, false);
  for (const column of small.columns) assert.ok(column.slot.left >= 730 && column.slot.bottom <= 350);
  // Order of the steps: less dense first; within a step, one column first.
  assert.deepEqual(SHEET_MODES.slice(0, 3).map(mode => [mode.density, mode.columns]), [[0, 1], [1, 1], [2, 1]]);
  assert.ok(SHEET_MODES.every(mode => SHEET_COLUMN_WIDTH[mode.density][1] >= 150), 'never narrower than 150 px');
  assert.ok(SHEET_MODES.findIndex(mode => mode.density === 5) > SHEET_MODES.findIndex(mode => mode.density === 4 && mode.columns === 3));
  // Nothing fits at all: the densest step in the roomiest slots, cut.
  const tiny = chooseSheetLayout(sheetRegion({ ...HUD_1280, viewport: { width: 1280, height: 400 }, weapon: { left: 935, right: 1245, top: 200, bottom: 390 } }), fakeMeasure(40));
  assert.equal(tiny.clipped, true); assert.equal(tiny.density, 6);
});

test('the chain feed never goes towards the crosshair: its usual place, beside the weapon panel, or over the sheet', () => {
  const region = sheetRegion(HUD_1280);
  assert.equal(sheetFeedPlace(region, [{ left: 945, top: 180, right: 1245, bottom: 260 }]), null, 'a short sheet leaves its usual place free');
  const beside = sheetFeedPlace(region, [{ left: 731, top: 91, right: 984, bottom: 320 }, { left: 992, top: 180, right: 1245, bottom: 313 }]);
  assert.deepEqual(beside, { mode: 'beside', right: 1280 - 927, bottom: 720 - 472, maxWidth: 197, maxHeight: 100 });
  assert.ok(1280 - beside.right - beside.maxWidth >= region.minLeft, 'its left edge stays right of the crosshair room');
  // 700 × 800: no room beside the weapon panel, so over the sheet, above the panel.
  const narrow = sheetRegion({ viewport: { width: 700, height: 800 }, score: { left: 571, right: 685, top: 91, bottom: 154 }, weapon: { left: 435, right: 685, top: 460, bottom: 776 }, wave: { left: 275, right: 425, top: 97, bottom: 203 } });
  const over = sheetFeedPlace(narrow, [{ left: 438, top: 162, right: 685, bottom: 420 }]);
  assert.equal(over.mode, 'over'); assert.equal(over.bottom, 800 - 460 + 8);
  assert.ok(700 - over.right - over.maxWidth >= narrow.minLeft && narrow.minLeft > 350 + 40, 'clear of the crosshair');
  assert.equal(sheetFeedPlace(null), null);
});

// A tiny DOM that lays blocks out like the stylesheet's density steps, to
// check the placement itself: cards, copies of a continued heading, again.
function fakeDocument() {
  class FakeNode {
    constructor(tag) { Object.assign(this, { tagName: tag, children: [], dataset: {}, style: {}, className: '', text: '', attributes: {}, parent: null }); }
    append(...nodes) { for (const node of nodes) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
    get lastChild() { return this.children.at(-1); }
    set textContent(value) { this.text = String(value); this.children = []; } get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { this.html = value; }
    setAttribute(name, value) { this.attributes[name] = value; }
    cloneNode() { const copy = new FakeNode(this.tagName); Object.assign(copy, { className: this.className, text: this.text, dataset: { ...this.dataset } }); copy.append(...this.children.map(child => child.cloneNode())); return copy; }
    querySelectorAll() { const found = []; const walk = node => { for (const child of node.children) { if (child.dataset.block) found.push(child); walk(child); } }; walk(this); return found; }
    get root() { let node = this; while (node.parent) node = node.parent; return node; }
    height() {
      const density = Number(/density-(\d)/.exec(this.root.className)?.[1] ?? 0);
      if (this.className === 'sheet-col') return 10 + this.children.reduce((sum, child) => sum + child.height(), 0);
      if (this.dataset.section === 'stats' && density >= 5) return 0;
      return this.dataset.block === 'heading' ? 16 : this.dataset.block === 'head' ? 18 : 14;
    }
    getBoundingClientRect() {
      const own = this.className === 'sheet-col' ? this : null, root = this.root;
      const left = (parseFloat(root.style.left) || 0) + (own ? parseFloat(own.style.left) || 0 : 0), top = (parseFloat(root.style.top) || 0) + (own ? parseFloat(own.style.top) || 0 : 0);
      const height = this.height(), width = parseFloat(this.style.width) || 300;
      return { left, top, right: left + width, bottom: top + height, width, height };
    }
    get scrollWidth() { return 0; } get clientWidth() { return 0; }
  }
  return { createElement: tag => new FakeNode(tag) };
}
test('placing the sheet: every block once, a continued section under a copy of its heading, and again after a change', () => {
  const document = fakeDocument(), sheet = document.createElement('aside');
  sheet.className = 'survivor-sheet'; sheet.hidden = false;
  // The heavy loadout: its fourteen bonus rows cannot stand in one column here.
  const { snapshot } = survivor({ bonus: { stone: 3, perforating: 6, extended: 3, reinforced: 4, radar: 5, vitality: 4, rainproof: 4, toughskin: 2, grenadier: 5, frostaura: 3, medic: 3, switching: 2 },
    debt: { vitamins: 2, reload: 1, switching: 2 }, weapon: 'assault' });
  setLanguage('fr');
  const rendered = renderSurvivorSheet(sheet, survivorSheetModel(snapshot, { weapons: PUBLISHED, t, language: 'fr' }), { document, t });
  const region = sheetRegion(HUD_1280);
  const placed = placeSurvivorSheet(sheet, region, { document, continued: '(suite)' });
  assert.ok(placed && !placed.clipped && placed.columns >= 2, JSON.stringify(placed));
  const originals = sheet.querySelectorAll().filter(node => node.dataset.repeat !== 'true');
  assert.deepEqual(originals, rendered, 'every block exactly once, in reading order');
  const copies = sheet.querySelectorAll().filter(node => node.dataset.repeat === 'true');
  assert.ok(copies.length >= 1, 'Mes bonus goes on in the next column');
  for (const card of sheet.children) assert.ok(['head', 'heading'].includes(card.children[0].dataset.block), 'no column opens on a row without its heading');
  for (const copy of copies) {
    assert.equal(copy.dataset.block, 'heading'); assert.equal(copy.attributes['aria-hidden'], 'true');
    assert.equal(copy.lastChild.className, 'sheet-continued'); assert.equal(copy.lastChild.textContent, ' (suite)');
    assert.equal(copy.parent.children[0], copy, 'the copy opens its column');
  }
  for (const card of sheet.children) {
    const box = card.getBoundingClientRect();
    assert.ok(box.left >= region.minLeft && box.right <= 1245 && box.bottom <= 350, JSON.stringify(box));
  }
  assert.equal(placed.cards.length, sheet.children.length);
  // A new room (the weapon panel grew): placed again from the same blocks, no copy kept.
  const again = placeSurvivorSheet(sheet, sheetRegion({ ...HUD_1280, weapon: { ...HUD_1280.weapon, top: 300 } }), { document, continued: '(suite)' });
  assert.ok(again);
  assert.deepEqual(sheet.querySelectorAll().filter(node => node.dataset.repeat !== 'true'), rendered);
  assert.ok(sheet.querySelectorAll().filter(node => node.dataset.repeat === 'true').every(copy => copy.parent.children[0] === copy));
  // No room at all (a tiny window): nothing shows, and the blocks wait for room.
  const tiny = sheetRegion({ viewport: { width: 420, height: 500 }, score: { left: 340, right: 405, top: 91, bottom: 140 }, weapon: { left: 255, right: 405, top: 300, bottom: 480 } });
  assert.equal(placeSurvivorSheet(sheet, tiny, { document }), null);
  assert.equal(sheet.children.length, 1); assert.equal(sheet.children[0].hidden, true);
  assert.deepEqual(sheet.querySelectorAll().filter(node => node.dataset.repeat !== 'true'), rendered);
  assert.ok(placeSurvivorSheet(sheet, region, { document, continued: '(suite)' }), 'room again: placed again');
  // Hidden or missing: nothing happens.
  sheet.hidden = true; assert.equal(placeSurvivorSheet(sheet, region, { document }), null);
});
