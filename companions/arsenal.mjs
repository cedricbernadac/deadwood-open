// The weapons a companion carries (owner, 13 October: Max bought the SMG
// holding his shotgun, and the purchase replaced the shotgun, not the pistol).
// One policy, shared by the eyes (what a purchase may replace, and which) and
// the body (the weapon it takes out before buying, and whether the purchase is
// still worth it at the rack): a weapon's rack price, and nothing for a gun
// with no ammo left at all. A blade never runs dry ("le katana ... il n'y a
// pas besoin de munitions"): it keeps its price, so a katana outranks a
// shotgun or an SMG, and the starter pistol is the first to go. Reads the
// simulation only. A validated team plan can protect sufficiently supplied preferred guns
// and choose a cheaper role weapon; without a plan the price policy remains.
import { ARMORY } from '../public/rules.js';
import { weaponType, weaponEntries, weaponStock } from '../public/weapon-inventory.js';
import { assignmentFor } from './team-plan.mjs';

const PRICES = Object.freeze(Object.fromEntries(ARMORY.map(rack => [rack.weapon, rack.price])));
const melee = (sim, player, weapon) => Boolean(sim.weaponProfile(player, weapon)?.melee);
const rounds = (player, weapon) => (weaponStock(player, weapon)?.ammo ?? 0) + (weaponStock(player, weapon)?.reserve ?? 0);
const assignment = (sim, player) => player?.companion === true ? assignmentFor(sim, player.id) : null;
const preferred = (plan, player, weapon) => {
  const type = weaponType(weapon, weaponStock(player, weapon));
  return !plan ? 0 : type === plan.goalWeapon ? 2 : type === plan.keepWeapon ? 1 : 0;
};
// A last round can still be fired, but cannot reserve an equipment slot
// against a useful purchase. Small magazines retain a minimum of two rounds.
const sustained = (sim, player, weapon) => melee(sim, player, weapon)
  || rounds(player, weapon) >= Math.max(2, Math.ceil((sim.weaponProfile(player, weapon)?.magazine ?? 0) * .15));
// A gun with a round left, in the magazine or in reserve.
export const loaded = (sim, player, weapon) => Object.hasOwn(player.inventory ?? {}, weapon) && !melee(sim, player, weapon) && rounds(player, weapon) > 0;

// What `weapon` is worth to `player`: carried, as it is; not carried, as it
// comes from its rack (full).
export function weaponWorth(sim, player, weapon) {
  if (Object.hasOwn(player.inventory ?? {}, weapon) && !melee(sim, player, weapon) && !(rounds(player, weapon) > 0)) return 0;
  return PRICES[weaponType(weapon, weaponStock(player, weapon))] ?? 0;
}
// The weapon it can best spare: protect sufficiently supplied goal/keep weapons when a plan
// exists, then the least worth, then the one with less ammo,
// then the cheaper (an empty pistol before an empty machine gun, which the
// break refills). Null when it carries nothing.
export function spareWeapon(sim, player) {
  const weapons = weaponEntries(player).map(item => item.id);
  const plan = assignment(sim, player);
  const cost = weapon => [preferred(plan, player, weapon) && sustained(sim, player, weapon) ? 1 : 0,
    weaponWorth(sim, player, weapon), rounds(player, weapon), PRICES[weaponType(weapon, weaponStock(player, weapon))] ?? 0];
  return weapons.sort((a, b) => {
    const [first, second] = [cost(a), cost(b)];
    return first[0] - second[0] || first[1] - second[1] || first[2] - second[2] || first[3] - second[3];
  })[0] ?? null;
}
// With every slot full, the weapon a purchase replaces once the body has taken
// it out: the one it can best spare. Null with a slot free.
export const replaced = (sim, player) => Object.keys(player.inventory ?? {}).length >= sim.weaponSlots(player) ? spareWeapon(sim, player) : null;
// A purchase worth making: without a plan, never a blade while a gun has ammo (the bodies
// fight at range; melee puts them in the crowd), and with every slot full only
// something worth more than what it replaces. The eyes offer it, and the body
// asks again at the rack: a break may have refilled the empty gun it was to
// replace (review of 13 October). An explicit role goal can override price
// and the melee restriction, while a preferred pair with adequate stock stays.
export function worthBuying(sim, player, weapon) {
  const plan = assignment(sim, player), goal = plan?.goalWeapon === weaponType(weapon);
  if (!goal && melee(sim, player, weapon) && Object.keys(player.inventory ?? {}).some(item => loaded(sim, player, item))) return false;
  const spare = replaced(sim, player);
  if (spare && preferred(plan, player, spare) && sustained(sim, player, spare)) return false;
  // A role is allowed to trade a costly, non-preferred gun for its cheaper
  // objective. A plan is a preference, never a reason to keep a dry or nearly
  // dry gun against a useful survival purchase.
  if (goal) return true;
  if (plan && spare && !sustained(sim, player, spare) && !melee(sim, player, weapon)) return true;
  return !spare || weaponWorth(sim, player, weapon) > weaponWorth(sim, player, spare);
}
// Whether it would rather fight with `weapon` than with `other`: a gun with
// ammo, then a blade, then an empty gun; with a plan, adequate stock precedes
// goal/keep preference, then worth.
// Only between the two
// (after a purchase: the one bought and the one it held), never its whole
// inventory: the dearest is not always the one for the fight (a sniper or a
// rocket launcher in the cabin, review of 13 October).
export function fightsBetter(sim, player, weapon, other) {
  const plan = assignment(sim, player);
  const rank = item => [loaded(sim, player, item) ? 2 : melee(sim, player, item) ? 1 : 0,
    plan && sustained(sim, player, item) ? 1 : 0, preferred(plan, player, item), weaponWorth(sim, player, item)];
  const [first, second] = [rank(weapon), rank(other)];
  return (first[0] - second[0] || first[1] - second[1] || first[2] - second[2] || first[3] - second[3]) > 0;
}
