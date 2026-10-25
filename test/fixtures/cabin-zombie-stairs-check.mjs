import assert from 'node:assert/strict';
import { RoomSimulation, WORLD } from '../../simulation.mjs';
import { LEVEL } from '../../public/level-config.js';

const DT = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const stairX = (WORLD.stair.minX + WORLD.stair.maxX) / 2;
const bodies = [
  { id: 'walker', kind: 'walker', scale: 1, boss: false },
  { id: 'crawler', kind: 'crawler', scale: 1, boss: false },
  { id: 'colossus', kind: 'brute', scale: 1.32, boss: true },
];

function verify(body, ascending) {
  const label = `${body.id}/${ascending ? 'up' : 'down'}`;
  const sim = new RoomSimulation('CABIN' + label, { random: () => 0.5, raids: false });
  const player = sim.addPlayer('player', 'Player');
  sim.start('player');
  sim.phase = 'wave';
  Object.assign(player, ascending
    ? { x: 5.5, y: WORLD.loftY, z: -3, hp: 1000000, alive: true, downed: false }
    : { x: -2.8, y: 0, z: 1.7, hp: 1000000, alive: true, downed: false });
  const zombie = sim.spawnZombie();
  Object.assign(zombie, {
    x: stairX, y: ascending ? 0 : WORLD.loftY,
    z: ascending ? WORLD.stair.maxZ + 0.5 : WORLD.stair.minZ - 0.5,
    kind: body.kind, scale: body.scale, boss: body.boss, speed: 2.2, damage: 0,
    entered: true, navigation: null, portalRoute: null, stairState: null,
    attackAfter: 0, pushX: 0, pushZ: 0, pushLeft: 0,
  });
  let last = { x: zombie.x, y: zombie.y, z: zombie.z };
  let lastMovementAt = sim.time;
  let longestStall = 0;
  let arrived = false;
  for (let tick = 0; tick < 45 * 30; tick++) {
    sim.time += DT;
    sim.updateZombie(zombie, DT, [player]);
    if (flat(zombie, player) < 1.2 && Math.abs(zombie.y - player.y) < 0.3) { arrived = true; break; }
    if (Math.hypot(zombie.x - last.x, zombie.y - last.y, zombie.z - last.z) >= 0.01) {
      last = { x: zombie.x, y: zombie.y, z: zombie.z };
      lastMovementAt = sim.time;
    }
    longestStall = Math.max(longestStall, sim.time - lastMovementAt);
    assert.ok(sim.time - lastMovementAt < 3 - 1e-8, `${label} stuck for 3 s at ${JSON.stringify(zombie)}`);
  }
  assert.ok(arrived, `${label} did not reach the player: ${JSON.stringify(zombie)}`);
  return { label, seconds: +sim.time.toFixed(2), longestStall: +longestStall.toFixed(2) };
}

assert.equal(LEVEL.id, 'cabin');
const routes = bodies.flatMap(body => [verify(body, true), verify(body, false)]);
const longestStall = Math.max(...routes.map(route => route.longestStall));
console.log(`cabin zombie stair routes unchanged: ${routes.length}; longest stall ${longestStall.toFixed(2)} s`);
