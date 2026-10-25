// Facts for decisions come from the shared ladders, never a second balance.
import { CHARACTER_BONUSES, characterStats, characterBonusDescription } from '../public/character-bonuses.js';
import { GRENADES } from '../public/rules.js';
import { claimStep } from '../public/character-sheet.js';

export const characterBonusCatalogue = () => Object.values(CHARACTER_BONUSES).map(({ id, effects }) => ({ id, effects }));
// What the next claim gives, from the shared step (character-sheet.js).
// Companions play the standard sheet, so a repayment never reaches a prompt yet.
export function nextCharacterBonus(player, kind) {
  const { to } = claimStep(player, kind);
  return to >= 1 ? characterBonusDescription(kind, to, 'en') : `repays an innate malus to ${to}`;
}
export function characterSummary(player, sim) {
  const stats = characterStats(player), base = characterStats(null), parts = [];
  for (const [key, name] of [['speedMultiplier', 'move'], ['reloadMultiplier', 'reload'], ['switchSeconds', 'switch s'],
    ['rainMultiplier', 'rain damage'], ['combatMultiplier', 'combat damage'], ['reviveSeconds', 'revive s']]) {
    if (stats[key] !== base[key]) parts.push(`${name} ${Math.round(stats[key] * 100) / 100}`);
  }
  if (stats.auraRadius) parts.push(`frost ${stats.auraRadius}m -${Math.round(stats.auraSlow * 100)}% movement; not bites/raiders; no stacking`);
  if (stats.dualWield) parts.push(`dual wield ${player.dualWield ? 'active' : 'optional/unlocked'}`);
  if (stats.grenadeIntervalSeconds) {
    const left = sim?.grenadierLeft?.(player);
    parts.push(`grenades ${player.grenades ?? 0}/${stats.maxGrenades ?? GRENADES.maxCarry}; +1 every ${stats.grenadeIntervalSeconds}s active time; no bank at cap`
      + `; grenade damage x${stats.grenadeDamageMultiplier ?? 1}`
      + (Number.isFinite(left) ? `; next in ${Math.ceil(left * 10) / 10}s` : ''));
  }
  return parts.length ? `CHARACTER: ${parts.join('; ')}.` : '';
}
