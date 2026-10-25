import { REVIVE } from '../../public/rules.js';

// A teammate revive now takes REVIVE.duration seconds of holding E (owner,
// 13 October). Tests about what a revive does, not how long it takes, start
// it with the real interact() and run its hold to the end without moving the
// rest of the world. The timing itself is tested in test/revive.test.mjs.
export function completeRevive(simulation, reviverId) {
  if (!simulation.interact(reviverId)) return false;
  const channel = simulation.players.get(reviverId)?.reviving;
  if (!channel) return true; // interact did something else (a repair, a pickup…)
  channel.startedAt -= REVIVE.duration;
  channel.lastAt = simulation.time;
  simulation.updateRevives(0);
  return true;
}
