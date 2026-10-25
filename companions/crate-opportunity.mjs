// Shared facts for crate advice and the repair body guard. A geometrically
// viable, rain-affordable trip is not a promise of safety under enemy fire.
import { SUPPLY_BONUSES, SUPPLY_WAVES } from '../public/weapon-upgrades.js';
import { wayOut, rainCost } from './outdoors.mjs';

export function crateOpportunity(sim, player, doors = sim.doors) {
  const crate = sim.supplyCrate;
  if (!crate || crate.active === false || sim.practice || !SUPPLY_WAVES.includes(sim.wave)
    || !['countdown', 'wave', 'intermission'].includes(sim.phase)
    || (crate.wave ?? sim.wave) !== sim.wave || !player?.alive || player.waiting || player.downed
    || crate.claimed.has(player.id) || !Object.keys(SUPPLY_BONUSES).some(kind => sim.bonusEligible(player, kind))) return null;
  const way = wayOut(sim, crate, doors);
  if (!way) return null;
  const rain = rainCost(sim, player, way.distance, way);
  return rain.affordable ? { way, rain } : null;
}

// The next crate (owner, 18 October: late in a break a bot walked out to a
// crate it had already claimed and back, rather than wait for the new one).
// This survivor's claim is spent (claimed, or the crate inactive) in a break
// before an active crate wave: the next wave's number, else 0. NEXT_CRATE_LEAD:
// the break's last seconds when the eyes offer to wait for it. The brain asks
// every 2 s when calm and its answer must land before the wave starts (the
// director drops one across a phase change), and the walk from the far end of
// the cabin or the loft to the exit takes 4-5 s: 8 of the 12 s, leaving the
// first 4 s to repairs and shopping.
export const NEXT_CRATE_LEAD = 8;
export function nextCrateWave(sim, player) {
  const crate = sim.supplyCrate, next = sim.wave + 1;
  return crate && !sim.practice && ['countdown', 'intermission'].includes(sim.phase) && SUPPLY_WAVES.includes(next)
    && player?.alive && !player.waiting && !player.downed && (crate.active === false || crate.claimed.has(player.id))
    && Object.keys(SUPPLY_BONUSES).some(kind => sim.bonusEligible(player, kind)) ? next : 0;
}

// Only warn/protect this door when closing it would remove a survivor's last
// affordable route. No plan, selected bonus or model response is required.
export function crateAccessAtDoor(sim, door) {
  const crate = sim.supplyCrate, way = crate && wayOut(sim, crate, [door]);
  if (!way) return null;
  const alternatives = sim.doors.filter(other => other.id !== door.id);
  const claimants = [...sim.players.values()].filter(player => crateOpportunity(sim, player, [door])
    && !crateOpportunity(sim, player, alternatives));
  return claimants.length ? { way, claimants } : null;
}
