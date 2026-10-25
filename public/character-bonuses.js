// One shared ladder for simulation, prediction, HUD and companion decisions.
// Values are cumulative from the base, never compounded after each claim.
import { bonusDebt, sheetMalus } from './character-sheet.js';
const definition = (id, fr, en, effects) => Object.freeze({ id,
  label: Object.freeze({ fr, en }),
  effects: Object.freeze(Object.fromEntries(Object.entries(effects).map(([key, values]) => [key, Object.freeze(values)]))) });
export const CHARACTER_BONUSES = Object.freeze({
  vitamins: definition('vitamins', 'Vitamines', 'Vitamins', {
    horizontalSpeedBonusPercent: [3, 6, 9, 12, 15, 18, 21, 24] }),
  reload: definition('reload', 'Huile de coude', 'Elbow grease', {
    reloadDurationReductionPercent: [10, 15, 20, 25, 30, 35, 40, 50] }),
  switching: definition('switching', 'Mains vives', 'Quick hands', {
    switchFireLockMs: [200, 160, 125, 95, 70, 45, 20, 20],
    dualWieldUnlocked: [false, false, false, false, false, false, false, true] }),
  vitality: definition('vitality', 'Vitalité', 'Vitality', { maxHp: [110, 120, 130, 140, 150, 160, 170, 180] }),
  rainproof: definition('rainproof', 'Imperméable', 'Rainproof', {
    rainDamageReductionPercent: [10, 20, 30, 40, 50, 60, 70, 80] }),
  toughskin: definition('toughskin', 'Peau dure', 'Tough skin', {
    combatDamageReductionPercent: [3, 6, 9, 12, 15, 18, 21, 24] }),
  medic: definition('medic', 'Secouriste', 'First aider', {
    manualReviveSeconds: [4.5, 4.2, 3.9, 3.6, 3.3, 3, 2.5, 2] }),
  grenadier: definition('grenadier', 'Grenadier', 'Grenadier', {
    grenadeIntervalSeconds: [20, 20, 17, 17, 14, 14, 12, 10],
    maxGrenades: [2, 2, 3, 3, 3, 4, 4, 5],
    grenadeDamageBonusPercent: [0, 10, 10, 20, 20, 30, 40, 50] }),
  radar: definition('radar', 'Lunettes de reconnaissance', 'Recon glasses', {
    information: ['local_presence', 'coarse_sectors', 'position_triangles', 'position_triangles', 'enemy_type', 'enemy_type_and_floor', 'quarter_health_bar', 'exact_current_and_max_hp'],
    refreshSeconds: [8, 7, 6, 5, 4, 3, 2, .2] }),
  frostaura: definition('frostaura', 'Aura de froid', 'Frost aura', {
    slowPercent: [15, 15, 18, 18, 21, 21, 25, 25],
    radiusMeters: [2, 2.5, 2.5, 3, 3, 3.5, 3.5, 4] }),
});

export function characterBonusLevel(playerOrBonus, kind) {
  const bonus = playerOrBonus && Object.hasOwn(playerOrBonus, 'bonus') ? playerOrBonus.bonus : playerOrBonus;
  const value = typeof bonus === 'string' ? (bonus === kind ? 1 : 0)
    : bonus?.kind ? (bonus.kind === kind ? bonus.level ?? 1 : 0) : bonus?.[kind];
  return Number.isFinite(value) ? Math.max(0, Math.min(8, Math.floor(value))) : 0;
}
// A sheet's innate debt (character-sheet.js) lowers a player's level down to
// −2; bare bonus maps carry no debt.
export function effectiveCharacterLevel(playerOrBonus, kind) {
  const player = playerOrBonus && typeof playerOrBonus === 'object' && Object.hasOwn(playerOrBonus, 'bonus') ? playerOrBonus : null;
  return characterBonusLevel(playerOrBonus, kind) - bonusDebt(player, kind);
}
// Negative levels read the sheet's malus in the same units as the ladder.
export function characterEffect(kind, effect, level, fallback = 0) {
  if (Number.isFinite(level) && level <= -1) return sheetMalus(kind, effect, level) ?? fallback;
  const bounded = Number.isFinite(level) ? Math.max(0, Math.min(8, Math.floor(level))) : 0;
  return bounded ? CHARACTER_BONUSES[kind]?.effects?.[effect]?.[bounded - 1] ?? fallback : fallback;
}
export function characterStats(playerOrBonus) {
  const at = (kind, effect, fallback = 0) => characterEffect(kind, effect, effectiveCharacterLevel(playerOrBonus, kind), fallback);
  return {
    speedMultiplier: 1 + at('vitamins', 'horizontalSpeedBonusPercent') / 100,
    reloadMultiplier: 1 - at('reload', 'reloadDurationReductionPercent') / 100,
    switchSeconds: at('switching', 'switchFireLockMs', 250) / 1000,
    maxHp: at('vitality', 'maxHp', 100),
    rainMultiplier: 1 - at('rainproof', 'rainDamageReductionPercent') / 100,
    combatMultiplier: 1 - at('toughskin', 'combatDamageReductionPercent') / 100,
    reviveSeconds: at('medic', 'manualReviveSeconds', 5),
    grenadeIntervalSeconds: at('grenadier', 'grenadeIntervalSeconds'),
    grenadeDamageMultiplier: 1 + at('grenadier', 'grenadeDamageBonusPercent') / 100,
    // Same baseline as GRENADES.maxCarry. Importing rules.js here would create
    // a cycle through weapon-upgrades.js while its catalogue is initialising.
    maxGrenades: at('grenadier', 'maxGrenades', 2),
    auraRadius: at('frostaura', 'radiusMeters'),
    auraSlow: at('frostaura', 'slowPercent') / 100,
    dualWield: at('switching', 'dualWieldUnlocked', false),
    // Sheet maluses only (positive ladders leave the base): Bricolage repairs,
    // the Chimie smell that hastens nearby zombies and its weaker medkits.
    repairHp: at('radar', 'repairHp', 25),
    hasteRadius: at('frostaura', 'hasteRadiusMeters'),
    haste: at('frostaura', 'hastePercent') / 100,
    medkitHealMultiplier: at('medic', 'medkitHealPercent', 100) / 100,
  };
}

export function characterBonusDescription(kind, level, language = 'fr') {
  const en = language === 'en', definition = CHARACTER_BONUSES[kind];
  if (!definition) return '';
  const at = (effect, fallback = 0) => characterEffect(kind, effect, level, fallback);
  const number = value => String(value).replace('.', en ? '.' : ',');
  if (kind === 'vitamins') return `+${at('horizontalSpeedBonusPercent')} % ${en ? 'movement speed' : 'vitesse de déplacement'}`;
  if (kind === 'reload') return `−${at('reloadDurationReductionPercent')} % ${en ? 'reload time' : 'durée de recharge'}`;
  if (kind === 'switching') return `${at('switchFireLockMs', 250)} ms ${en ? 'weapon switch' : 'changement d’arme'}${at('dualWieldUnlocked', false) ? (en ? ' · dual wield unlocked' : ' · double maniement débloqué') : ''}`;
  if (kind === 'vitality') return `${at('maxHp', 100)} ${en ? 'maximum HP' : 'PV maximum'}`;
  if (kind === 'rainproof') return `−${at('rainDamageReductionPercent')} % ${en ? 'rain damage' : 'dégâts de pluie'}`;
  if (kind === 'toughskin') return `−${at('combatDamageReductionPercent')} % ${en ? 'combat damage' : 'dégâts de combat'}`;
  if (kind === 'medic') return `${en ? 'Revive in' : 'Réanimation en'} ${number(at('manualReviveSeconds', 5))} s`;
  if (kind === 'grenadier') return `${en ? 'One free grenade every' : 'Une grenade gratuite toutes les'} ${number(at('grenadeIntervalSeconds'))} s · ${en ? 'capacity' : 'capacité'} ${at('maxGrenades', 2)} · +${at('grenadeDamageBonusPercent')} % ${en ? 'grenade damage' : 'dégâts de grenade'}`;
  if (kind === 'frostaura') return `−${at('slowPercent')} % ${en ? 'enemy speed within' : 'vitesse des zombies à'} ${number(at('radiusMeters'))} m`;
  const information = en ? ['Nearby presence', 'Coarse sectors', 'Position triangles', 'Faster triangles', 'Enemy types', 'Types and floors', 'Approximate health', 'Exact HP']
    : ['Présence proche', 'Secteurs approximatifs', 'Triangles de position', 'Triangles plus fréquents', 'Types d’ennemis', 'Types et étages', 'Santé approximative', 'PV exacts'];
  return `${information[Math.max(0, Math.min(7, Math.floor(level) - 1))]} · ${number(at('refreshSeconds', 8))} s · 25 m`;
}
