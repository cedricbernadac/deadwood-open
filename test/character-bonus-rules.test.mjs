import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHARACTER_BONUSES, characterBonusLevel, characterEffect, characterStats, characterBonusDescription } from '../public/character-bonuses.js';
import { SUPPLY_BONUSES, SUPPLY_WAVES, bonusEntries } from '../public/weapon-upgrades.js';

test('the playable character ladders match every approved catalogue value and register as recoverable bonuses', () => {
  const catalogue = JSON.parse(readFileSync(new URL('../validation/character-bonus-catalog-2026-10-17.json', import.meta.url)));
  assert.equal(Object.keys(CHARACTER_BONUSES).length, 10);
  assert.deepEqual(Object.keys(CHARACTER_BONUSES).sort(), catalogue.definitions.map(definition => definition.id).sort());
  for (const definition of catalogue.definitions) {
    assert.deepEqual(CHARACTER_BONUSES[definition.id].effects, definition.effects, definition.id);
    assert.equal(SUPPLY_BONUSES[definition.id].label.fr, definition.name);
    assert.deepEqual(bonusEntries({ [definition.id]: 8 }), [[definition.id, 8]]);
    for (const language of ['fr', 'en']) for (let level = 1; level <= 8; level++) {
      const description = characterBonusDescription(definition.id, level, language);
      assert.ok(description.length > 5 && !/undefined|NaN/.test(description));
    }
  }
  assert.deepEqual(SUPPLY_WAVES, Array.from({ length: 17 }, (_, index) => index + 2));
});

test('no bonus leaves the existing baseline intact; levels compose from the base rather than compounding', () => {
  assert.deepEqual(characterStats(null), {
    speedMultiplier: 1, reloadMultiplier: 1, switchSeconds: .25, maxHp: 100,
    rainMultiplier: 1, combatMultiplier: 1, reviveSeconds: 5, grenadeIntervalSeconds: 0, grenadeDamageMultiplier: 1, maxGrenades: 2, auraRadius: 0, auraSlow: 0, dualWield: false,
    // Character-sheet maluses only (character-sheet.js); the base is unchanged.
    repairHp: 25, hasteRadius: 0, haste: 0, medkitHealMultiplier: 1,
  });
  const player = { bonus: Object.fromEntries(Object.keys(CHARACTER_BONUSES).map(kind => [kind, 8])) };
  const stats = characterStats(player);
  assert.equal(stats.speedMultiplier, 1.24); assert.equal(stats.reloadMultiplier, .5);
  assert.equal(stats.switchSeconds, .02); assert.equal(stats.maxHp, 180);
  assert.ok(Math.abs(stats.rainMultiplier - .2) < 1e-12);
  assert.equal(stats.combatMultiplier, .76); assert.equal(stats.reviveSeconds, 2);
  assert.equal(stats.grenadeIntervalSeconds, 10);
  assert.equal(stats.grenadeDamageMultiplier, 1.5);
  assert.equal(stats.maxGrenades, 5);
  assert.equal(stats.auraRadius, 4); assert.equal(stats.auraSlow, .25); assert.equal(stats.dualWield, true);
  assert.equal(characterStats({ switching: 7 }).dualWield, false);
  for (let level = 2; level <= 8; level++) {
    const before = characterStats({ frostaura: level - 1 }), after = characterStats({ frostaura: level });
    assert.ok(after.auraRadius > before.auraRadius || after.auraSlow > before.auraSlow, `aura level ${level} improves immediately`);
  }
});

test('malformed and legacy bonus values never produce non-finite stats or exceed the level cap', () => {
  for (const value of [null, false, {}, { bonus: null }, { vitamins: NaN }, { vitamins: Infinity }, { vitamins: -5 }]) {
    for (const stat of Object.values(characterStats(value))) assert.ok(typeof stat === 'boolean' || Number.isFinite(stat));
  }
  assert.equal(characterBonusLevel({ vitamins: 999 }, 'vitamins'), 8);
  assert.equal(characterBonusLevel({ bonus: { vitamins: 3 } }, 'vitamins'), 3);
  assert.equal(characterBonusLevel('vitamins', 'vitamins'), 1);
  assert.equal(characterBonusLevel({ kind: 'vitamins', level: 4 }, 'vitamins'), 4);
  assert.equal(characterEffect('missing', 'missing', 8, 17), 17);
});
