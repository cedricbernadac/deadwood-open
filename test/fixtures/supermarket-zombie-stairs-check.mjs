import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { LEVEL } from '../../public/level-config.js';
import { spaceFlightAt } from '../../public/level-space.js';

const DT = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const starts = [
  { id: 'centre', x: 4.2, z: 1.1 },
  { id: 'east-cheek', x: 5.36, z: 0 },
  { id: 'west-cheek', x: 3.01, z: 0 },
  { id: 'east-outer', x: 6.1, z: -0.8 },
  { id: 'west-outer', x: 2.3, z: -0.8 },
  { id: 'east-approach', x: 6.4, z: 0.65 },
  { id: 'west-approach', x: 2, z: 0.65 },
];
const measured = [
  { id: 'measured-east', x: 5.36, z: -0.19 },
  { id: 'measured-west', x: 3.01, z: -0.17 },
  { id: 'measured-east-outer', x: 5.95, z: -0.8 },
  { id: 'measured-west-edge', x: 3.14, z: -0.19 },
  { id: 'measured-east-edge', x: 5.39, z: -0.19 },
  { id: 'measured-east-far', x: 5.92, z: -0.77 },
  { id: 'measured-east-back', x: 5.94, z: -0.94 },
];
const silhouettes = [
  { id: 'walker', kind: 'walker', scale: 1, boss: false },
  { id: 'crawler', kind: 'crawler', scale: 1, boss: false },
  { id: 'colossus', kind: 'brute', scale: 1.32, boss: true },
];
const scenarios = silhouettes.flatMap(body => starts.map(start => ({ body, start })))
  .concat(measured.map(start => ({ body: silhouettes[0], start })));

function verify({ body, start }) {
  const label = `${body.id}/${start.id}`;
  const sim = new RoomSimulation('STAIRS' + label, { random: () => 0.5, raids: false });
  const player = sim.addPlayer('player', 'Player');
  sim.start('player');
  sim.phase = 'wave';
  Object.assign(player, { x: 6, y: -3.4, z: -8.9, hp: 1000000, alive: true, downed: false });
  const zombie = sim.spawnZombie();
  Object.assign(zombie, {
    x: start.x, y: 0, z: start.z, kind: body.kind, scale: body.scale, boss: body.boss,
    speed: 2.2, damage: 0, entered: true, navigation: null, portalRoute: null, stairState: null,
    attackAfter: 0, pushX: 0, pushZ: 0, pushLeft: 0,
  });
  const radius = 0.29 * body.scale;
  assert.ok(sim.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius), `${label} starts in a solid`);
  let last = { x: zombie.x, y: zombie.y, z: zombie.z };
  let lastMovementAt = sim.time;
  let longestStall = 0;
  let usedStockStair = false;
  let usedGardenStair = false;
  let arrived = false;
  for (let tick = 0; tick < 30 * 30; tick++) {
    sim.time += DT;
    sim.updateZombie(zombie, DT, [player]);
    const flight = spaceFlightAt(zombie.x, zombie.z, zombie.y);
    if (flight?.id === 'stock-stair' && zombie.y < -0.3) usedStockStair = true;
    if (flight?.id === 'garden-stair') usedGardenStair = true;
    if (flat(zombie, player) < 1.2 && Math.abs(zombie.y - player.y) < 0.3) { arrived = true; break; }
    const moved = Math.hypot(zombie.x - last.x, zombie.y - last.y, zombie.z - last.z);
    if (moved >= 0.01) {
      last = { x: zombie.x, y: zombie.y, z: zombie.z };
      lastMovementAt = sim.time;
    }
    longestStall = Math.max(longestStall, sim.time - lastMovementAt);
    assert.ok(sim.time - lastMovementAt < 3 - 1e-8, `${label} stuck for 3 s at ${JSON.stringify(zombie)}`);
    assert.ok(sim.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius), `${label} entered a solid`);
  }
  assert.ok(arrived, `${label} did not reach the cellar player: ${JSON.stringify(zombie)}`);
  assert.ok(usedStockStair, `${label} did not descend the interior stock-stair`);
  assert.equal(usedGardenStair, false, `${label} took the garden stair instead`);
  return { label, seconds: +sim.time.toFixed(2), longestStall: +longestStall.toFixed(2) };
}

assert.equal(LEVEL.id, 'supermarket');
const routes = scenarios.map(verify);
const slowest = Math.max(...routes.map(route => route.seconds));
const longestStall = Math.max(...routes.map(route => route.longestStall));
console.log(`supermarket zombie stock-stair routes verified: ${routes.length}; slowest ${slowest.toFixed(2)} s; longest stall ${longestStall.toFixed(2)} s`);
