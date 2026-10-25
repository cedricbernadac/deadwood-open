import test from 'node:test';
import assert from 'node:assert/strict';
import { SHEET_STATS, SHEET_STAT_IDS, BONUS_FAMILY, SHEET_PRESETS, SHEET_PRESET_IDS, SHEET_MALUS, STANDARD_SHEET, normalizeSheet, sheetProblem,
  sheetName, innateDebt, bonusDebt, effectiveBonusLevel, claimStep } from '../public/character-sheet.js';
import { characterStats, effectiveCharacterLevel } from '../public/character-bonuses.js';
import { SUPPLY_BONUSES, upgradedWeapon } from '../public/weapon-upgrades.js';
import { reconLevel } from '../public/radar-rules.js';
import { WEAPONS } from '../simulation.mjs';

// The optional character sheet (owner, 18 October): stats sum to zero, each
// −2..+2, at most two points moved. Numbers are provisional.
const zeros = Object.fromEntries(SHEET_STAT_IDS.map(id => [id, 0]));
const near = (actual, expected, why = '') => assert.ok(Math.abs(actual - expected) < 1e-9, `${why} ${actual} vs ${expected}`);
const player = (bonus = null, sheetDebt = null, stats = zeros) => ({ bonus, sheetDebt, sheet: { preset: null, name: '', stats } });

test('the five families cover the fourteen crate bonuses exactly once', () => {
  assert.deepEqual(SHEET_STAT_IDS, ['strength', 'agility', 'ballistics', 'tinkering', 'chemistry']);
  const all = SHEET_STATS.flatMap(stat => stat.bonuses);
  assert.equal(all.length, 14);
  assert.equal(new Set(all).size, 14, 'no bonus in two families');
  assert.deepEqual([...all].sort(), Object.keys(SUPPLY_BONUSES).sort());
  assert.deepEqual(SHEET_STATS.map(stat => [stat.id, [...stat.bonuses]]), [
    ['strength', ['stone', 'vitality', 'rainproof', 'toughskin']], ['agility', ['vitamins', 'reload', 'switching']],
    ['ballistics', ['perforating', 'reinforced']], ['tinkering', ['extended', 'radar']], ['chemistry', ['grenadier', 'frostaura', 'medic']]]);
  for (const kind of Object.keys(SUPPLY_BONUSES)) assert.ok(SHEET_STATS.find(stat => stat.id === BONUS_FAMILY[kind]).bonuses.includes(kind), kind);
  assert.deepEqual(Object.keys(SHEET_MALUS).sort(), Object.keys(SUPPLY_BONUSES).sort(), 'every bonus has a malus row');
});

test('every ready-made character is a valid sheet with the decided stats', () => {
  assert.deepEqual(SHEET_PRESET_IDS, ['standard', 'lumberjack', 'mechanic', 'hunter', 'pyro', 'scout', 'nurse']);
  const expected = {
    standard: {}, lumberjack: { strength: 2, tinkering: -1, chemistry: -1 }, mechanic: { tinkering: 2, strength: -1, agility: -1 },
    hunter: { ballistics: 2, agility: -1, chemistry: -1 }, pyro: { chemistry: 2, strength: -1, ballistics: -1 },
    scout: { agility: 2, strength: -1, ballistics: -1 }, nurse: { chemistry: 1, agility: 1, strength: -1, ballistics: -1 },
  };
  for (const id of SHEET_PRESET_IDS) {
    assert.deepEqual(SHEET_PRESETS[id], { ...zeros, ...expected[id] }, id);
    assert.equal(sheetProblem(SHEET_PRESETS[id]), null, id);
    assert.deepEqual(normalizeSheet({ preset: id }), { preset: id, name: '', stats: { ...zeros, ...expected[id] } });
    assert.deepEqual(normalizeSheet({ preset: id, stats: SHEET_PRESETS[id] }).preset, id);
  }
  assert.deepEqual(normalizeSheet(undefined), { ...STANDARD_SHEET, stats: zeros });
  assert.ok(Object.isFrozen(SHEET_PRESETS.lumberjack) && Object.isFrozen(STANDARD_SHEET));
});

test('normalizeSheet keeps only valid five-stat sheets and falls back to the standard one', () => {
  const standard = { preset: 'standard', name: '', stats: zeros };
  for (const input of [null, undefined, 0, 'lumberjack', true, [], [1, -1], () => {}, { stats: [] }, { stats: 'strength' }, { stats: null }])
    assert.deepEqual(normalizeSheet(input), standard, JSON.stringify(input) ?? String(input));
  for (const stats of [{ strength: 3, agility: -3 }, { strength: -3, agility: 2, ballistics: 1 }, { strength: 1.5, agility: -1.5 }, { strength: '1', agility: -1 },
    { strength: NaN, agility: 0 }, { strength: Infinity, agility: -Infinity }, { strength: null }, { strength: true, agility: -1 },
    { strength: 1 }, { strength: 2, agility: -1 }, { strength: -2, agility: 1 }, { strength: 2, agility: 1, tinkering: -2, chemistry: -1 },
    { strength: 1, agility: 1, ballistics: 1, tinkering: -2, chemistry: -1 }])
    assert.deepEqual(normalizeSheet({ stats }), standard, JSON.stringify(stats));
  // Missing stats count as zero; two points may go into one or two stats.
  assert.deepEqual(normalizeSheet({ stats: { strength: 1, chemistry: -1 } }).stats, { ...zeros, strength: 1, chemistry: -1 });
  assert.deepEqual(normalizeSheet({ stats: { agility: 1, ballistics: 1, tinkering: -1, chemistry: -1 } }).stats, { ...zeros, agility: 1, ballistics: 1, tinkering: -1, chemistry: -1 });
  assert.deepEqual(normalizeSheet({ stats: { strength: 2, chemistry: -2 } }).stats, { ...zeros, strength: 2, chemistry: -2 });
  // Unknown keys are dropped, at both levels.
  const extra = normalizeSheet({ stats: { strength: 1, chemistry: -1, intelligence: 2, hp: 500 }, hp: 999, debt: {}, name: 'Kim' });
  assert.deepEqual(Object.keys(extra).sort(), ['name', 'preset', 'stats']);
  assert.deepEqual(Object.keys(extra.stats), SHEET_STAT_IDS);
  // Prototype keys never count, neither from JSON nor from a crafted prototype.
  const parsed = normalizeSheet(JSON.parse('{"__proto__":{"stats":{"strength":2,"agility":-2}},"stats":{"__proto__":{"agility":2},"strength":1,"tinkering":-1}}'));
  assert.deepEqual(parsed.stats, { ...zeros, strength: 1, tinkering: -1 });
  assert.equal({}.agility, undefined); assert.equal({}.stats, undefined);
  assert.deepEqual(normalizeSheet(Object.create({ stats: { strength: 2, agility: -2 }, preset: 'pyro' })), standard);
  assert.deepEqual(normalizeSheet({ stats: Object.create({ strength: 2, agility: -2 }) }), standard);
  // A preset id must be known, and a changed preset is a custom character.
  assert.equal(normalizeSheet({ preset: 'wizard', stats: { strength: 1, agility: -1 } }).preset, null);
  assert.equal(normalizeSheet({ preset: 'toString' }).preset, 'standard');
  assert.equal(normalizeSheet({ preset: 'lumberjack', stats: { strength: 1, tinkering: -1 } }).preset, null);
  assert.equal(normalizeSheet({ preset: 'standard', name: 'Jules' }).preset, 'standard');
  assert.equal(normalizeSheet({ name: 'Jules' }).preset, null, 'a named custom with zeros is not the standard character');
});

test('names lose control characters, keep 24 code points and never become HTML', () => {
  assert.equal(sheetName('  Bob\u0000\u0007\u001f\u007f\u0085 le\nbûcheron  '), 'Bob lebûcheron');
  assert.equal(sheetName('x'.repeat(40)), 'x'.repeat(24));
  assert.equal([...sheetName('🪓'.repeat(30))].length, 24, 'emoji are never split in half');
  for (const value of [null, 3, {}, ['a']]) assert.equal(sheetName(value), '');
  assert.equal(normalizeSheet({ name: '<b>Kim</b>', stats: { strength: 1, agility: -1 } }).name, '<b>Kim</b>', 'kept as text; the client never parses it');
});

test('the innate debt is 1 or 2 on every bonus of a minus family and lives apart from the bonus map', () => {
  assert.deepEqual(innateDebt(normalizeSheet({ preset: 'lumberjack' })), { extended: 1, radar: 1, grenadier: 1, frostaura: 1, medic: 1 });
  assert.deepEqual(innateDebt(normalizeSheet({ stats: { strength: -2, agility: 2 } })), { stone: 2, vitality: 2, rainproof: 2, toughskin: 2 });
  assert.deepEqual(innateDebt(normalizeSheet(null)), {});
  assert.deepEqual(innateDebt(undefined), {});
  assert.equal(bonusDebt({ sheetDebt: { stone: 7 } }, 'stone'), 2, 'a forged debt is bounded');
  assert.equal(bonusDebt({ sheetDebt: { stone: -1 } }, 'stone'), 0);
  assert.equal(bonusDebt({ sheetDebt: Object.create({ stone: 2 }) }, 'stone'), 0);
});

test('one crate claim follows the step table for every stat value and level', () => {
  const plain = [1, 2, 3, 4, 5, 6, 7, 8, 8];
  const table = { 2: [2, 3, 4, 5, 6, 7, 8, 8, 8], 1: [2, 3, 4, 5, 5, 6, 7, 8, 8], 0: plain, [-1]: plain, [-2]: plain };
  for (const value of [-2, -1, 0, 1, 2]) for (const stat of SHEET_STATS) for (const kind of stat.bonuses) {
    const stats = { ...zeros, [stat.id]: value };
    for (let level = 0; level <= 8; level++) {
      const step = claimStep(player(level ? { [kind]: level } : null, null, stats), kind);
      assert.equal(step.level, table[value][level], `${kind} ${value} N${level}`);
      assert.equal(step.from, level); assert.equal(step.to, table[value][level]);
      assert.equal(step.repay, false); assert.equal(step.debt, 0);
      assert.equal(step.talent, table[value][level] - level === 2);
    }
    // With the innate debt, each claim repays one level first: −2 → −1 → 0.
    if (value < 0) for (let debt = -value; debt >= 1; debt--) {
      const step = claimStep(player(null, { [kind]: debt }, stats), kind);
      assert.deepEqual({ from: step.from, to: step.to, level: step.level, debt: step.debt, repay: step.repay, talent: step.talent },
        { from: -debt, to: 1 - debt, level: 0, debt: debt - 1, repay: true, talent: false });
    }
  }
  // Claims for a whole climb from the innate state to level 8.
  const climb = value => {
    const family = SHEET_STATS[0], kind = family.bonuses[0], stats = { ...zeros, [family.id]: value };
    const state = player(null, innateDebt({ stats }), stats);
    let claims = 0;
    while (effectiveBonusLevel(state, kind) < 8) {
      const step = claimStep(state, kind); claims++;
      if (step.level) (state.bonus ??= {})[kind] = step.level;
      state.sheetDebt = step.debt ? { [kind]: step.debt } : {};
    }
    return claims;
  };
  assert.deepEqual([2, 1, 0, -1, -2].map(climb), [4, 6, 8, 9, 10]);
});

test('effective levels subtract the debt from carried or picked-up levels, and claims repay before climbing', () => {
  const picked = player({ stone: 3 }, { stone: 2 });
  assert.equal(effectiveBonusLevel(picked, 'stone'), 1);
  assert.deepEqual(claimStep(picked, 'stone'), { kind: 'stone', from: 1, to: 2, level: 3, debt: 1, repay: true, gain: 1, talent: false });
  const full = player({ vitality: 8 }, { vitality: 2 });
  assert.equal(effectiveBonusLevel(full, 'vitality'), 6);
  assert.equal(characterStats(full).maxHp, 160, 'a picked-up N8 with a debt of 2 acts as N6');
  full.sheetDebt = {};
  assert.equal(claimStep(full, 'vitality').gain, 0, 'nothing beyond level 8');
  assert.equal(effectiveBonusLevel(player(null, { radar: 1 }), 'radar'), -1);
  assert.equal(effectiveCharacterLevel({ vitality: 1 }, 'vitality'), 1, 'bare bonus maps carry no debt');
  assert.equal(reconLevel({ bonus: { radar: 3 }, sheetDebt: { radar: 2 } }), 1);
  assert.equal(reconLevel({ bonus: { radar: 1 }, sheetDebt: { radar: 2 } }), 0);
  assert.equal(reconLevel({ bonus: { radar: 5 } }), 5);
});

test('a chemistry minus point costs every player something, not only grenade throwers and revivers', () => {
  // Owner: otherwise everybody would park their minus point in Chimie.
  for (const debt of [1, 2]) {
    const chemistry = characterStats(player(null, innateDebt({ stats: { chemistry: -debt, agility: debt } }))), base = characterStats(null);
    assert.ok(chemistry.hasteRadius >= 4 && chemistry.haste >= .1, 'the smell reaches the whole approach of a zombie');
    assert.ok(chemistry.medkitHealMultiplier < base.medkitHealMultiplier, 'every medkit heals less');
  }
});

test('negative levels read the malus table through the shared character stats', () => {
  const at = (kind, debt) => characterStats(player(null, { [kind]: debt }));
  assert.deepEqual([at('vitality', 1).maxHp, at('vitality', 2).maxHp], [90, 80]);
  near(at('vitamins', 1).speedMultiplier, .96); near(at('vitamins', 2).speedMultiplier, .92);
  near(at('reload', 1).reloadMultiplier, 1.1); near(at('reload', 2).reloadMultiplier, 1.2);
  near(at('switching', 1).switchSeconds, .3); near(at('switching', 2).switchSeconds, .35);
  near(at('rainproof', 1).rainMultiplier, 1.1); near(at('rainproof', 2).rainMultiplier, 1.2);
  near(at('toughskin', 1).combatMultiplier, 1.04); near(at('toughskin', 2).combatMultiplier, 1.08);
  assert.deepEqual([at('medic', 1).reviveSeconds, at('medic', 2).reviveSeconds], [6, 7.5]);
  assert.deepEqual([at('medic', 1).medkitHealMultiplier, at('medic', 2).medkitHealMultiplier], [.75, .5]);
  assert.deepEqual([at('radar', 1).repairHp, at('radar', 2).repairHp], [20, 15]);
  for (const debt of [1, 2]) {
    const grenadier = at('grenadier', debt);
    assert.equal(grenadier.maxGrenades, 1); assert.equal(grenadier.grenadeIntervalSeconds, 0);
    near(grenadier.grenadeDamageMultiplier, debt === 1 ? .85 : .7);
    const smell = at('frostaura', debt);
    assert.deepEqual([smell.hasteRadius, smell.haste], debt === 1 ? [4, .1] : [5, .15]);
    assert.deepEqual([smell.auraRadius, smell.auraSlow], [0, 0], 'no frost aura from a debt');
    assert.equal(at('switching', debt).dualWield, false);
  }
  // The standard sheet and bare bonus maps are the usual game exactly.
  assert.deepEqual(characterStats(player()), characterStats(null));
  assert.deepEqual(characterStats({ vitality: 2 }), characterStats(player({ vitality: 2 })));
});

test('weapon maluses keep the bonus scopes and never touch base profiles', () => {
  const before = structuredClone(WEAPONS);
  const pistol = debt => upgradedWeapon(WEAPONS.pistol, 'pistol', null, { extended: debt });
  assert.deepEqual([pistol(1).magazine, pistol(1).reserve, pistol(2).magazine, pistol(2).reserve], [11, 32, 10, 29]);
  const magnum = upgradedWeapon(WEAPONS.magnum, 'magnum', null, { extended: 2 });
  assert.deepEqual([magnum.magazine, magnum.reserve], [5, 0], 'no reserve is created');
  assert.equal(upgradedWeapon(WEAPONS.rocket, 'rocket', null, { extended: 2 }), WEAPONS.rocket, 'single-shot launcher untouched');
  assert.equal(upgradedWeapon(WEAPONS.flamethrower, 'flamethrower', null, { extended: 1 }).magazine, 72);
  assert.equal(upgradedWeapon({ magazine: 2, reserve: 1, damage: 1 }, 'test', null, { extended: 2 }).magazine, 2, 'rounded, at least one');
  for (const id of ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'assault', 'sniper'])
    for (const [debt, factor] of [[1, .92], [2, .85]]) near(upgradedWeapon(WEAPONS[id], id, null, { reinforced: debt }).damage, WEAPONS[id].damage * factor, id);
  for (const id of ['magnum', 'flamethrower', 'rocket', 'katana', 'bat'])
    assert.equal(upgradedWeapon(WEAPONS[id], id, null, { reinforced: 2 }), WEAPONS[id], `${id} outside reinforced scope`);
  for (const id of ['katana', 'hammer', 'bat', 'fireaxe']) for (const [debt, factor] of [[1, .9], [2, .8]]) {
    const profile = upgradedWeapon(WEAPONS[id], id, null, { stone: debt });
    for (const mode of ['light', 'heavy']) {
      near(profile.attacks[mode].damage, WEAPONS[id].attacks[mode].damage * factor, `${id} ${mode}`);
      assert.equal(profile.attacks[mode].maxTargets, WEAPONS[id].attacks[mode].maxTargets);
    }
    assert.equal(profile.penetrationTargets, WEAPONS[id].penetrationTargets);
  }
  assert.equal(upgradedWeapon(WEAPONS.rifle, 'rifle', null, { stone: 2 }), WEAPONS.rifle);
  assert.equal(upgradedWeapon(WEAPONS.rifle, 'rifle', null, { perforating: 2 }), WEAPONS.rifle, 'armor piercing has no malus');
  // Positive effective levels keep the ladders, zero does nothing.
  assert.equal(upgradedWeapon(WEAPONS.pistol, 'pistol', { extended: 3 }, { extended: 1 }).magazine, upgradedWeapon(WEAPONS.pistol, 'pistol', { extended: 2 }).magazine);
  assert.equal(upgradedWeapon(WEAPONS.pistol, 'pistol', { extended: 2 }, { extended: 2 }), WEAPONS.pistol);
  near(upgradedWeapon(WEAPONS.rifle, 'rifle', { perforating: 8, extended: 2 }, { reinforced: 1 }).damage, WEAPONS.rifle.damage * .92);
  assert.deepEqual(WEAPONS, before);
});
