// How a body moves on a SPACE map's flights, for the companion follow
// fixtures (supermarket-companion-follow-check, space-companion-follow-
// midflight-check). Imported after DEADWOOD_LEVEL is set.
import { spaceFlightAt } from '../../public/level-space.js';

// Vertical reversals (hysteresis 0.25 m). The last direction is kept through
// a landing: a body that goes up a flight, steps off its head and comes back
// down has turned back once. (Reset on every exit, as the hospital orders
// fixture counts, a shuttle from landing to landing counted 0.)
export function flightReversals() {
  let direction = 0, extreme = null, count = 0;
  return {
    step(player) {
      if (!spaceFlightAt(player.x, player.z, player.y)) { extreme = player.y; return; }
      extreme ??= player.y;
      if (direction === 0) { if (player.y > extreme + .25) { direction = 1; extreme = player.y; } else if (player.y < extreme - .25) { direction = -1; extreme = player.y; } }
      else if (direction === 1) { if (player.y > extreme) extreme = player.y; else if (player.y < extreme - .25) { count++; direction = -1; extreme = player.y; } }
      else if (player.y < extreme) extreme = player.y; else if (player.y > extreme + .25) { count++; direction = 1; extreme = player.y; }
    },
    get count() { return count; },
  };
}

// Metres walked (3D) and flight exits (on the band, then off it), counted
// from start() on.
export function flightTravel() {
  let last = null, on = null, path = 0, exits = 0, counting = false;
  return {
    start() { counting = true; },
    step(player) {
      const here = Boolean(spaceFlightAt(player.x, player.z, player.y));
      if (counting && last) {
        path += Math.hypot(player.x - last.x, player.y - last.y, player.z - last.z);
        if (on && !here) exits++;
      }
      last = { x: player.x, y: player.y, z: player.z }; on = here;
    },
    get path() { return path; },
    get exits() { return exits; },
  };
}
