// The optional character sheet (owner, 18 October). A sheet moves at most two
// points between five stats; the standard sheet (all zeros) is exactly the
// usual game. A plus point speeds up the crate in its family; a minus point
// starts every bonus of that family in debt (negative levels with a malus),
// bought back at the crate. No intelligence stat: that one is the player's.
// No imports: the server, the client, the bonus ladders and the bots all read
// this module, and the ladders import it without a cycle. Every number here is
// provisional, tuned in play.
export const SHEET_LIMITS = Object.freeze({ min: -2, max: 2, moved: 2, maxLevel: 8, nameLength: 24 });
const family = (id, bonuses) => Object.freeze({ id, bonuses: Object.freeze(bonuses) });
// Every crate bonus belongs to exactly one family (a test checks the 14).
export const SHEET_STATS = Object.freeze([
  family('strength', ['stone', 'vitality', 'rainproof', 'toughskin']),
  family('agility', ['vitamins', 'reload', 'switching']),
  family('ballistics', ['perforating', 'reinforced']),
  family('tinkering', ['extended', 'radar']),
  family('chemistry', ['grenadier', 'frostaura', 'medic']),
]);
export const SHEET_STAT_IDS = Object.freeze(SHEET_STATS.map(stat => stat.id));
export const BONUS_FAMILY = Object.freeze(Object.fromEntries(SHEET_STATS.flatMap(stat => stat.bonuses.map(kind => [kind, stat.id]))));
const statLine = (values = {}) => Object.freeze(Object.fromEntries(SHEET_STAT_IDS.map(id => [id, values[id] ?? 0])));
// Ready-made characters; their names and stories live in i18n.js.
export const SHEET_PRESETS = Object.freeze({
  standard: statLine(),
  lumberjack: statLine({ strength: 2, tinkering: -1, chemistry: -1 }),
  mechanic: statLine({ tinkering: 2, strength: -1, agility: -1 }),
  hunter: statLine({ ballistics: 2, agility: -1, chemistry: -1 }),
  pyro: statLine({ chemistry: 2, strength: -1, ballistics: -1 }),
  scout: statLine({ agility: 2, strength: -1, ballistics: -1 }),
  nurse: statLine({ chemistry: 1, agility: 1, strength: -1, ballistics: -1 }),
});
export const SHEET_PRESET_IDS = Object.freeze(Object.keys(SHEET_PRESETS));
export const STANDARD_SHEET = Object.freeze({ preset: 'standard', name: '', stats: SHEET_PRESETS.standard });

// The innate malus of one negative effective level (index 0 = −1, 1 = −2),
// in the units of the bonus ladders, so characterStats/upgradedWeapon read
// them like any level. Chemistry is deliberately harsher (owner: otherwise
// everybody would park their minus point there). Its grenade cap, grenade
// damage and revive time only bite a grenade thrower or a reviver, so two
// costs reach every play style: a smell wide enough to hasten every zombie
// that comes for you, and weaker medkits. (Grenade regeneration is the
// Grenadier bonus itself: the standard game never had it, so losing it is no
// malus.)
export const SHEET_MALUS = Object.freeze(Object.fromEntries(Object.entries({
  stone: { meleeDamageMultiplier: [.9, .8] },
  vitality: { maxHp: [90, 80] },
  rainproof: { rainDamageReductionPercent: [-10, -20] },
  toughskin: { combatDamageReductionPercent: [-4, -8] },
  vitamins: { horizontalSpeedBonusPercent: [-4, -8] },
  reload: { reloadDurationReductionPercent: [-10, -20] },
  switching: { switchFireLockMs: [300, 350] },
  // The debt only costs extra claims: armor piercing has nothing to remove.
  perforating: {},
  reinforced: { bulletDamageMultiplier: [.92, .85] },
  extended: { capacityMultiplier: [.9, .8] },
  // Bricolage: each barricade repair action restores less than 25 HP.
  radar: { repairHp: [20, 15] },
  grenadier: { maxGrenades: [1, 1], grenadeDamageBonusPercent: [-15, -30] },
  // «Odeur de produits»: the mirror of the frost aura, bosses half. 4–5 m
  // covers a zombie's whole approach, not only its last step.
  frostaura: { hastePercent: [10, 15], hasteRadiusMeters: [4, 5] },
  // Slower revives by hand, and a medkit restores only part of what is missing.
  medic: { manualReviveSeconds: [6, 7.5], medkitHealPercent: [75, 50] },
}).map(([kind, effects]) => [kind, Object.freeze(Object.fromEntries(Object.entries(effects).map(([effect, values]) => [effect, Object.freeze(values)])))])));
export function sheetMalus(kind, effect, level) {
  return Number.isFinite(level) && level <= -1 ? SHEET_MALUS[kind]?.[effect]?.[Math.min(2, Math.floor(-level)) - 1] : undefined;
}

const own = (object, key) => object && typeof object === 'object' && Object.hasOwn(object, key) ? object[key] : undefined;
const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// Control characters never reach a name; code points, not halves of one.
export function sheetName(value) {
  if (typeof value !== 'string') return '';
  return [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()].slice(0, SHEET_LIMITS.nameLength).join('').trim();
}
export function sheetTotals(stats) {
  let sum = 0, plus = 0, minus = 0;
  for (const id of SHEET_STAT_IDS) {
    const value = Number(own(stats, id) ?? 0) || 0;
    sum += value; if (value > 0) plus += value; else minus -= value;
  }
  return { sum, plus, minus };
}
// Why a stat line is refused (null when valid): the server and the editor's
// Save button share this rule.
export function sheetProblem(stats) {
  if (!plainObject(stats)) return 'range';
  for (const id of SHEET_STAT_IDS) {
    const value = own(stats, id) ?? 0;
    if (!Number.isInteger(value) || value < SHEET_LIMITS.min || value > SHEET_LIMITS.max) return 'range';
  }
  const { sum, plus } = sheetTotals(stats);
  return plus > SHEET_LIMITS.moved ? 'moved' : sum !== 0 ? 'sum' : null;
}
const standardSheet = () => ({ preset: 'standard', name: '', stats: { ...SHEET_PRESETS.standard } });
// Five integer stats in −2..+2, summing to 0, at most two points moved.
// Anything else is the standard sheet. Only the known keys are read (own
// properties: prototype keys never count) and unknown keys are dropped. A
// preset id alone stands for its stats; a preset whose stats were changed is
// a custom character, so a lobby label never lies.
export function normalizeSheet(input) {
  if (!plainObject(input)) return standardSheet();
  const requested = own(input, 'preset'), source = own(input, 'stats');
  const preset = typeof requested === 'string' && Object.hasOwn(SHEET_PRESETS, requested) ? requested : null;
  if (source !== undefined && !plainObject(source)) return standardSheet();
  const stats = Object.fromEntries(SHEET_STAT_IDS.map(id => [id, source ? own(source, id) ?? 0 : preset ? SHEET_PRESETS[preset][id] : 0]));
  if (sheetProblem(stats)) return standardSheet();
  const name = sheetName(own(input, 'name'));
  const matches = preset && SHEET_STAT_IDS.every(id => stats[id] === SHEET_PRESETS[preset][id]);
  const standard = SHEET_STAT_IDS.every(id => stats[id] === 0);
  return { preset: matches ? preset : standard && !name ? 'standard' : null, name, stats };
}

// The server keeps the sheet on `player.sheet`; snapshots carry it as
// `character`. Both shapes read the same.
const sheetOf = player => own(player, 'sheet') ?? own(player, 'character') ?? null;
export function sheetStat(sheet, id) {
  const value = own(own(sheet, 'stats'), id);
  return Number.isInteger(value) ? Math.max(SHEET_LIMITS.min, Math.min(SHEET_LIMITS.max, value)) : 0;
}
const playerSheetStat = (player, id) => sheetStat(sheetOf(player), id);
// The innate debt of a sheet: every bonus of a −1/−2 family owes 1/2 levels.
// It lives apart from player.bonus, which falls to teammates on death.
export function innateDebt(sheet) {
  const debt = {};
  for (const stat of SHEET_STATS) {
    const value = sheetStat(sheet, stat.id);
    if (value < 0) for (const kind of stat.bonuses) debt[kind] = -value;
  }
  return debt;
}
export function debtOf(debt, kind) {
  const value = own(debt, kind);
  return Number.isInteger(value) ? Math.max(0, Math.min(-SHEET_LIMITS.min, value)) : 0;
}
export const bonusDebt = (player, kind) => debtOf(own(player, 'sheetDebt'), kind);
const carriedLevel = (player, kind) => {
  const value = own(own(player, 'bonus'), kind);
  return Number.isFinite(value) && value >= 1 ? Math.min(SHEET_LIMITS.maxLevel, Math.floor(value)) : 0;
};
// What a kind actually does: the carried level (0 when absent) minus its debt.
// A picked-up teammate bonus keeps its level and the debt stays: L − debt.
export const effectiveBonusLevel = (player, kind) => carriedLevel(player, kind) - bonusDebt(player, kind);

// One crate claim on `kind`: a debt is repaid first (−2 → −1 → 0) and gives no
// positive level; then +2 per claim at +2, +2 below level 4 at +1, else +1.
// Always capped at 8. `from`/`to` are effective levels, `level`/`debt` the
// new carried level and debt. Every "+1 per claim" preview reads this.
export function claimStep(player, kind) {
  const level = carriedLevel(player, kind), debt = bonusDebt(player, kind), from = level - debt;
  if (debt > 0) return { kind, from, to: from + 1, level, debt: debt - 1, repay: true, gain: 1, talent: false };
  const stat = playerSheetStat(player, BONUS_FAMILY[kind]);
  const next = Math.min(SHEET_LIMITS.maxLevel, level + (stat >= 2 || (stat === 1 && level < 4) ? 2 : 1));
  return { kind, from, to: next, level: next, debt: 0, repay: false, gain: next - level, talent: next - level > 1 };
}
