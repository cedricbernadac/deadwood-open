import { CHARACTER_BONUSES, characterBonusDescription } from './character-bonuses.js';
import { getLanguage } from './i18n.js';
import { MAX_BONUS_LEVEL, perforatingTargets, reinforcedMeleeTargets, reinforcedDamagePercent } from './weapon-upgrades.js';
import { radarBlipSeconds } from './radar-rules.js';
import { sheetMalus } from './character-sheet.js';

// The card describes the actual improvement, including weapon exceptions.
// All gains come from the shared rules; this module only presents them.
// `inputStep` is the level the next crate claim reaches (claimStep in
// character-sheet.js: a talent family climbs two levels at a time).
export function bonusHudCard(kind, inputLevel, weapon, t, inputStep) {
  const level = Math.max(1, Math.min(MAX_BONUS_LEVEL, Number.isFinite(inputLevel) ? Math.round(inputLevel) : 1));
  const step = Math.min(MAX_BONUS_LEVEL, Math.max(level + 1, Number.isFinite(inputStep) ? Math.round(inputStep) : level + 1));
  const melee = ['bat', 'fireaxe', 'hammer', 'katana'].includes(weapon);
  const bullets = ['pistol', 'smg', 'assault', 'rifle', 'shotgun', 'sniper', 'minigun'].includes(weapon);
  const active = Object.hasOwn(CHARACTER_BONUSES, kind) || (kind === 'stone' ? melee
    : kind === 'perforating' ? bullets && weapon !== 'sniper'
    : kind === 'reinforced' ? bullets
    : kind === 'extended' ? bullets || weapon === 'magnum' || weapon === 'flamethrower' : false);
  let effect = '', next = '', extra = '';
  const upcoming = (value, at) => t('hudBonus.next', { effect: value, level: at });
  const targets = count => t(count === 1 ? 'pg.gainSingle' : 'pg.gainPlural', { count });
  const damage = percent => t('hudBonus.damage', { percent });
  if (Object.hasOwn(CHARACTER_BONUSES, kind)) {
    effect = characterBonusDescription(kind, level, getLanguage());
    if (level < 8) next = upcoming(characterBonusDescription(kind, step, getLanguage()), step);
  } else if (kind === 'perforating') {
    const gain = at => Math.min(weapon === 'minigun' ? 2 : 3, perforatingTargets(at));
    effect = targets(gain(level));
    const at = [3, 6, 8].find(at => at > level && gain(at) > gain(level));
    if (at) next = upcoming(targets(gain(at)), at);
    else if (weapon === 'minigun' && level < 8) next = t('hudBonus.capped');
  } else if (kind === 'reinforced') {
    effect = damage(reinforcedDamagePercent(level));
    const at = [2, 4, 6, 8].find(at => at > level);
    if (at) next = upcoming(damage(reinforcedDamagePercent(at)), at);
  } else if (kind === 'extended') {
    effect = t('hudBonus.percent', { percent: level * 10 });
    if (level < 8) next = upcoming(t('hudBonus.percent', { percent: step * 10 }), step);
  } else if (kind === 'stone') {
    effect = damage(level * 10);
    const count = reinforcedMeleeTargets(level);
    if (count) effect += ' · ' + targets(count);
    if (level < 8) {
      next = upcoming(damage(step * 10), step);
      extra = upcoming(targets(level < 4 ? 1 : 2), level < 4 ? 4 : 8);
    }
  } else if (kind === 'radar') {
    const pulse = at => at === 8 ? t('hudBonus.continuous') : t('hudBonus.pulse', { seconds: radarBlipSeconds(at) });
    effect = pulse(level);
    if (level < 8) next = upcoming(pulse(step), step);
  }
  return { level, active, effect, next: next || t('hudBonus.max'), extra };
}

// What a negative effective level (a character sheet's innate debt) costs,
// from the shared malus table; 0 means a picked-up level offsets the debt.
export function sheetMalusEffect(kind, inputLevel, t) {
  const level = Math.max(-2, Math.min(0, Number.isFinite(inputLevel) ? Math.round(inputLevel) : 0));
  if (level === 0) return t('sheet.malusCleared');
  const value = effect => sheetMalus(kind, effect, level) ?? 0;
  const number = amount => String(amount).replace('.', getLanguage() === 'en' ? '.' : ',');
  const loss = factor => Math.round(Math.abs(1 - factor) * 100);
  const params = {
    stone: () => ({ percent: loss(value('meleeDamageMultiplier')) }),
    vitality: () => ({ hp: value('maxHp') }),
    rainproof: () => ({ percent: -value('rainDamageReductionPercent') }),
    toughskin: () => ({ percent: -value('combatDamageReductionPercent') }),
    vitamins: () => ({ percent: -value('horizontalSpeedBonusPercent') }),
    reload: () => ({ percent: -value('reloadDurationReductionPercent') }),
    switching: () => ({ ms: value('switchFireLockMs') }),
    perforating: () => ({}),
    reinforced: () => ({ percent: loss(value('bulletDamageMultiplier')) }),
    extended: () => ({ percent: loss(value('capacityMultiplier')) }),
    radar: () => ({ hp: value('repairHp') }),
    grenadier: () => ({ cap: value('maxGrenades'), percent: -value('grenadeDamageBonusPercent') }),
    frostaura: () => ({ percent: value('hastePercent'), radius: number(value('hasteRadiusMeters')) }),
    medic: () => ({ seconds: number(value('manualReviveSeconds')), percent: 100 - value('medkitHealPercent') }),
  }[kind];
  // «One more claim» or «two more claims»: the only cost of a perforating debt.
  const key = kind === 'perforating' && level === -2 ? 'sheetMalus.perforatingTwo' : `sheetMalus.${kind}`;
  return params ? t(key, params()) : '';
}
