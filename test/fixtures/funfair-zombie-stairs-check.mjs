import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { LEVEL } from '../../public/level-config.js';
import { SPACE, spaceFlightAt } from '../../public/level-space.js';

const DT = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const starts = [
  ['centre', 'c', 0, 2.1],
  ['east-cheek', 'X', -0.04, 1],
  ['west-cheek', 'x', 0.01, 1],
  ['east-outer', 'X', 0.7, 0.2],
  ['west-outer', 'x', -0.7, 0.2],
  ['east-approach', 'X', 1, 1.65],
  ['west-approach', 'x', -1, 1.65],
];
const measured = [
  ['measured-east', 'X', -0.04, 0.81],
  ['measured-west', 'x', 0.01, 0.83],
  ['measured-east-outer', 'X', 0.55, 0.2],
  ['measured-west-edge', 'x', 0.14, 0.81],
  ['measured-east-edge', 'X', -0.01, 0.81],
  ['measured-east-far', 'X', 0.52, 0.23],
  ['measured-east-back', 'X', 0.54, 0.06],
];
const silhouettes = [
  { id: 'walker', kind: 'walker', scale: 1, boss: false },
  { id: 'crawler', kind: 'crawler', scale: 1, boss: false },
  { id: 'colossus', kind: 'brute', scale: 1.32, boss: true },
];
const scenarios = SPACE.flights.flatMap(flight => silhouettes.flatMap(body => starts.map(start => ({ flight, body, start })))
  .concat(measured.map(start => ({ flight, body: silhouettes[0], start }))));
const serviceDx = id => ({ 'west-cheek': .4, 'west-outer': .45, 'measured-west': .4 })[id];

function verify({ flight, body, start: [id, side, rawDx, dz] }) {
  const label = `${flight.id}/${body.id}/${id}`;
  const dx = flight.id === 'service-stair' ? serviceDx(id) ?? rawDx : rawDx;
  const x = side === 'c' ? flight.upper.x : side === 'X' ? flight.maxX + dx : flight.minX + dx;
  const z = flight.maxZ + dz;
  const sim = new RoomSimulation('STAIRS' + label, { random: () => .5, raids: false });
  const player = sim.addPlayer('player', 'Player');
  sim.start('player');
  sim.phase = 'wave';
  Object.assign(player, { x: flight.lower.x + 1.2, y: flight.baseY, z: flight.lower.z - 1.5, hp: 1000000, alive: true, downed: false });
  const zombie = sim.spawnZombie();
  Object.assign(zombie, {
    x, y: 0, z, kind: body.kind, scale: body.scale, boss: body.boss,
    speed: 2.2, damage: 0, entered: true, navigation: null, portalRoute: null, stairState: null,
    attackAfter: 0, pushX: 0, pushZ: 0, pushLeft: 0,
  });
  const radius = .29 * body.scale;
  assert.ok(sim.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius), `${label} starts in a solid`);
  let last = { x: zombie.x, y: zombie.y, z: zombie.z }, lastMovementAt = sim.time, longestStall = 0;
  let descended = false, arrived = false;
  const others = new Set();
  for (let tick = 0; tick < 30 * 30; tick++) {
    sim.time += DT;
    sim.updateZombie(zombie, DT, [player]);
    const on = spaceFlightAt(zombie.x, zombie.z, zombie.y);
    if (on?.id === flight.id && zombie.y < -.3) descended = true;
    if (on && on.id !== flight.id) others.add(on.id);
    if (flat(zombie, player) < 1.2 && Math.abs(zombie.y - player.y) < .3) { arrived = true; break; }
    const moved = Math.hypot(zombie.x - last.x, zombie.y - last.y, zombie.z - last.z);
    if (moved >= .01) {
      last = { x: zombie.x, y: zombie.y, z: zombie.z };
      lastMovementAt = sim.time;
    }
    longestStall = Math.max(longestStall, sim.time - lastMovementAt);
    assert.ok(sim.time - lastMovementAt < 3 - 1e-8, `${label} stuck for 3 s at ${JSON.stringify(zombie)}`);
    assert.ok(sim.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius), `${label} entered a solid`);
  }
  assert.ok(arrived, `${label} did not reach the cellar player: ${JSON.stringify(zombie)}`);
  assert.ok(descended, `${label} did not descend ${flight.id}`);
  assert.equal(others.size, 0, `${label} took ${[...others].join(', ')} instead of ${flight.id}`);
  return { label, seconds: +sim.time.toFixed(2), longestStall: +longestStall.toFixed(2) };
}

assert.equal(LEVEL.id, 'funfair');
assert.deepEqual(SPACE.flights.map(flight => flight.id), ['main-stair', 'service-stair']);
assert.equal(scenarios.length, 56);
const routes = scenarios.map(verify);
const slowest = Math.max(...routes.map(route => route.seconds));
const longestStall = Math.max(...routes.map(route => route.longestStall));
console.log(`funfair zombie stair heads verified: ${routes.length}; slowest ${slowest.toFixed(2)} s; longest stall ${longestStall.toFixed(2)} s`);
