// Revive bonuses (owner, 18 October): lifting a teammate earns, at the end
// of the wave, the damage they then dealt, at least 150 (simulation.mjs
// payReviveCredits). The end-of-wave card gives this survivor one line per
// bonus, the revived teammate a toast. Pure helpers, no DOM.
export const REVIVE_CARD_LINES = 4;
export const REVIVE_COUNT_MS = 900;
export const REVIVE_STAGGER_MS = 250;

const valid = payout => payout && typeof payout === 'object' && Number.isFinite(payout.amount) && payout.amount > 0;
const nameOf = value => typeof value === 'string' && value.trim() ? value : '?';

// This survivor's bonuses as card lines: four at most, then one summary of
// the others ({ more: count }), so the card stays readable.
export function reviveCardItems(event, localId) {
  const mine = (Array.isArray(event?.payouts) ? event.payouts : []).filter(payout => valid(payout) && payout.reviverId === localId && localId);
  const lines = mine.length > REVIVE_CARD_LINES ? mine.slice(0, REVIVE_CARD_LINES - 1) : mine;
  const items = lines.map(payout => ({ name: nameOf(payout.revivedName), amount: Math.round(payout.amount) }));
  const rest = mine.slice(lines.length);
  if (rest.length) items.push({ more: rest.length, amount: rest.reduce((sum, payout) => sum + Math.round(payout.amount), 0) });
  return items;
}

// What the revived survivor reads: their teammate earns their points too
// (a copy, never a transfer), or the floor when they dealt less.
export function reviveToastLines(event, localId) {
  return (Array.isArray(event?.payouts) ? event.payouts : [])
    .filter(payout => valid(payout) && localId && payout.revivedId === localId && payout.reviverId !== localId)
    .map(payout => ({ name: nameOf(payout.reviverName), amount: Math.round(payout.amount), floor: !(payout.amount <= (payout.damage ?? 0)) }));
}

// The line's number while it counts up (ease-out), whole points.
export function reviveCountUp(amount, elapsed, duration = REVIVE_COUNT_MS) {
  if (!(elapsed > 0)) return 0;
  const progress = Math.min(1, elapsed / duration);
  return Math.round(amount * (1 - (1 - progress) ** 3));
}
