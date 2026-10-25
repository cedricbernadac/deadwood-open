import { CHARACTER_BONUSES, characterBonusDescription } from '../public/character-bonuses.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bonusHudCard } from '../public/bonus-hud.js';
import { setLanguage, t } from '../public/i18n.js';

const levels = [1, 2, 3, 4, 5, 6, 7, 8];
const card = (kind, level, weapon = 'pistol') => bonusHudCard(kind, level, weapon, t);
const damage = percent => t('hudBonus.damage', { percent });
const targets = count => t(count === 1 ? 'pg.gainSingle' : 'pg.gainPlural', { count });
const next = (effect, level) => t('hudBonus.next', { effect, level });
const capacity = percent => t('hudBonus.percent', { percent });

test('all five bonus cards expose their exact cumulative level ladders', () => {
  setLanguage('fr');
  const piercing = [0, 0, 1, 1, 1, 2, 2, 3];
  const rounds = [0, 15, 15, 30, 30, 45, 45, 60];
  for (const [index, level] of levels.entries()) {
    assert.equal(card('perforating', level).effect, targets(piercing[index]), `piercing level ${level}`);
    assert.equal(card('reinforced', level).effect, damage(rounds[index]), `rounds level ${level}`);
    assert.equal(card('extended', level).effect, capacity(level * 10), `magazine level ${level}`);
    const melee = card('stone', level, 'katana');
    assert.ok(melee.effect.startsWith(damage(level * 10)), `melee level ${level}`);
    assert.equal(card('radar', level).effect, characterBonusDescription('radar', level), `radar level ${level}`);
  }
});

test('piercing cards announce the next cumulative gain, skipping levels without an effect', () => {
  setLanguage('fr');
  for (const level of [1, 2]) assert.equal(card('perforating', level).next, next(targets(1), 3));
  for (const level of [3, 4, 5]) assert.equal(card('perforating', level).next, next(targets(2), 6));
  for (const level of [6, 7]) assert.equal(card('perforating', level).next, next(targets(3), 8));
  assert.equal(card('perforating', 8).next, t('hudBonus.max'));
});

test('reinforced rounds announce 15/30/45/60 percent totals at levels 2/4/6/8', () => {
  setLanguage('fr');
  const upcoming = [[2, 15], [4, 30], [4, 30], [6, 45], [6, 45], [8, 60], [8, 60]];
  upcoming.forEach(([at, percent], index) => {
    assert.equal(card('reinforced', index + 1).next, next(damage(percent), at));
  });
  assert.equal(card('reinforced', 1).effect, damage(0), 'level one is an investment, not +15%');
  assert.equal(card('reinforced', 8).next, t('hudBonus.max'));
});

test('one melee card keeps both damage and extra targets, with their distinct next steps', () => {
  setLanguage('fr');
  for (const weapon of ['bat', 'fireaxe', 'hammer', 'katana']) {
    for (const level of levels) {
      const result = card('stone', level, weapon);
      const extraTargets = level < 4 ? 0 : level < 8 ? 1 : 2;
      assert.equal(result.effect, damage(level * 10) + (extraTargets ? ' · ' + targets(extraTargets) : ''));
      assert.equal(result.next, level === 8 ? t('hudBonus.max') : next(damage((level + 1) * 10), level + 1));
      assert.equal(result.extra, level === 8 ? '' : next(targets(level < 4 ? 1 : 2), level < 4 ? 4 : 8));
    }
  }
});

test('extended magazines show the next total capacity rather than another incremental ten percent', () => {
  setLanguage('fr');
  for (const level of levels) {
    assert.equal(card('extended', level).next, level === 8 ? t('hudBonus.max')
      : next(capacity((level + 1) * 10), level + 1));
  }
  assert.equal(card('extended', 1, 'magnum').active, true);
  assert.equal(card('extended', 1, 'flamethrower').active, true);
});

test('the minigun card respects six total targets and never promises a third effective extra body', () => {
  setLanguage('fr');
  for (const level of [6, 7, 8]) assert.equal(card('perforating', level, 'minigun').effect, targets(2));
  assert.equal(card('perforating', 5, 'minigun').next, next(targets(2), 6));
  for (const level of [6, 7]) assert.equal(card('perforating', level, 'minigun').next, t('hudBonus.capped'));
  assert.equal(card('perforating', 8, 'minigun').next, t('hudBonus.max'));
  assert.equal(card('perforating', 8, 'rifle').effect, targets(3), 'the normal ladder still reaches three');
});

test('carried cards distinguish weapon compatibility for every supported weapon and empty hands', () => {
  setLanguage('fr');
  const compatible = {
    stone: ['bat', 'fireaxe', 'hammer', 'katana'],
    perforating: ['pistol', 'smg', 'assault', 'rifle', 'shotgun', 'minigun'],
    reinforced: ['pistol', 'smg', 'assault', 'rifle', 'shotgun', 'minigun', 'sniper'],
    extended: ['pistol', 'smg', 'assault', 'rifle', 'shotgun', 'minigun', 'sniper', 'magnum', 'flamethrower'],
  };
  const weapons = ['pistol', 'smg', 'assault', 'rifle', 'shotgun', 'minigun', 'sniper', 'magnum',
    'flamethrower', 'rocket', 'bat', 'fireaxe', 'hammer', 'katana', null];
  for (const weapon of weapons) {
    for (const [kind, eligible] of Object.entries(compatible)) {
      const result = card(kind, 4, weapon);
      assert.equal(result.active, eligible.includes(weapon), `${kind} with ${weapon}`);
      assert.ok(result.effect.length > 0, 'an incompatible carried bonus still has a readable description');
    }
    assert.equal(card('radar', 4, weapon).active, true, 'radar does not depend on the weapon');
  }
});

test('radar level seven announces continuous level eight and the maximum has no imaginary next level', () => {
  setLanguage('fr');
  for (const level of [1, 2, 3, 4, 5, 6]) {
    assert.equal(card('radar', level).next, next(characterBonusDescription('radar', level + 1), level + 1));
  }
  assert.equal(card('radar', 7).next, next(characterBonusDescription('radar', 8), 8));
  assert.equal(card('radar', 8).next, t('hudBonus.max'));
  assert.equal(card('radar', 8).extra, '');
});

test('all five cards render real French and English translations, including the next effect and cap', () => {
  const rendered = {};
  for (const language of ['fr', 'en']) {
    setLanguage(language);
    const examples = [card('stone', 4, 'katana'), card('perforating', 1), card('extended', 2),
      card('reinforced', 4), card('radar', 7), card('radar', 8), card('perforating', 6, 'minigun')];
    const labels = ['stone', 'perforating', 'extended', 'reinforced', 'radar'].map(kind => t(`hudBonus.label.${kind}`));
    rendered[language] = labels.join(' | ') + ' | ' + examples.map(({ effect, next: future, extra }) => [effect, future, extra].join(' ')).join(' | ');
    assert.doesNotMatch(rendered[language], /hudBonus\.|pg\.|\{\w+\}/, 'no missing key or unsubstituted parameter');
    assert.match(examples[0].effect, /40/);
    assert.match(examples[3].effect, /30/);
    assert.match(examples[2].next, /30/);
    assert.match(examples[4].next, /8/);
  }
  assert.match(rendered.fr, /dégâts/i);
  assert.match(rendered.en, /damage/i);
  assert.notEqual(rendered.fr, rendered.en);
  setLanguage('fr');
});

test('finite out-of-range levels clamp to the supported eight levels', () => {
  setLanguage('fr');
  assert.deepEqual(card('reinforced', -4), card('reinforced', 1));
  assert.deepEqual(card('reinforced', 0), card('reinforced', 1));
  assert.deepEqual(card('reinforced', 1.8), card('reinforced', 2));
  assert.deepEqual(card('reinforced', 99), card('reinforced', 8));
});
