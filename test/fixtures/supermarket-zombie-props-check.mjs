import assert from 'node:assert/strict';
// Supermarket zombies pressed against an exterior prop (the two cars, the
// van, the trolley corral, the two loose trolleys, the four lamp posts) must
// still walk round it to an open door. The exterior escape test in
// segmentClear used boxes wider than the prop's collider (max(.425, r+.13)):
// a legal walker whose centre was 0.3 or 0.4 m off a face had no escape
// segment and stood there for the rest of the wave (40/40 starts per distance
// moved 0 m on main's code, the hospital's 49/49 before its own fix). A prop
// is now tested against its real collider on both maps; the facade keeps its
// rule. The terrace planters stand inside the building bounds and are routed
// by the interior graph, not here. Run with DEADWOOD_LEVEL=supermarket.
import { RoomSimulation } from '../../simulation.mjs';
import { IS_SUPERMARKET, LEVEL } from '../../public/level-config.js';
import { SPACE } from '../../public/level-space.js';

assert.equal(IS_SUPERMARKET, true, 'run with DEADWOOD_LEVEL=supermarket');
const DT = 1 / 30;
const ID = '0123456789abcdef';
const RADIUS = .29;
const GAPS = [.3, .4];
const FACES = [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']];
const round = value => Number(value.toFixed(2));
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = (point, box, padding = 0) => point.x >= box.minX - padding && point.x <= box.maxX + padding
  && point.z >= box.minZ - padding && point.z <= box.maxZ + padding;
const census = props => props.map(prop => ({ id: prop.id, kind: prop.kind, bounds: [prop.minX, prop.maxX, prop.minZ, prop.maxZ].map(round) }));
// Every exterior prop is driven: the census names them, a moved prop still counts.
assert.deepEqual(SPACE.props.map(prop => `${prop.kind}:${prop.id}`), [
  'car:prop-car-west', 'car:prop-car-east', 'van:prop-van-north', 'corral:prop-trolley-corral', 'trolley:prop-trolley-south',
  'trolley:prop-trolley-west', 'lamp:prop-lamp-sw', 'lamp:prop-lamp-se', 'lamp:prop-lamp-nw', 'lamp:prop-lamp-ne',
], 'exterior props: two cars, the van, the trolley corral, two trolleys and four lamp posts');
assert.ok(SPACE.props.every(prop => !inside({ x: (prop.minX + prop.maxX) / 2, z: (prop.minZ + prop.maxZ) / 2 }, LEVEL.buildingBounds)), 'every prop stands outside the building');

function setup() {
  const sim = new RoomSimulation('SMPROP', { random: () => .5, raids: false });
  const player = sim.addPlayer(ID, 'Jules');
  sim.start(ID);
  Object.assign(sim, { phase: 'wave', wave: 1, toSpawn: 100, spawnTimer: 1e9 });
  for (const door of sim.doors) {
    door.boards.fill(0);
    door.sealed = false;
    door.sealPending = false;
  }
  Object.assign(player, { x: 0, y: 0, z: .7, hp: 1e6, maxHp: 1e6, alive: true, downed: false, grounded: true, vy: 0 });
  assert.equal(sim.canOccupy(player, player.x, player.z, player.y, .25), true, 'the human stands on free floor inside');
  return { sim, player };
}

function drive({ label, x, z }) {
  const { sim, player } = setup();
  const enemy = sim.spawnZombie();
  assert.ok(enemy, `${label} spawned through RoomSimulation`);
  Object.assign(enemy, {
    kind: 'walker', x, y: 0, z, scale: 1, speed: 1.32, hp: 1e5, maxHp: 1e5, entered: false,
    navigation: null, portalRoute: null, stairState: null, attackAfter: 0, pushX: 0, pushZ: 0, pushLeft: 0,
  });
  let moved = 0, tick = 0, collision = null;
  let previous = { x: enemy.x, z: enemy.z };
  const state = () => ({
    label, seconds: round(tick * DT), moved: round(moved), entered: enemy.entered === true,
    end: { x: round(enemy.x), y: round(enemy.y), z: round(enemy.z) },
    navigation: enemy.navigation, portalRoute: enemy.portalRoute,
  });
  while (tick < 40 * 30) {
    sim.time += DT;
    sim.updateZombie(enemy, DT, [player]);
    tick++;
    moved += flat(enemy, previous);
    previous = { x: enemy.x, z: enemy.z };
    if (!sim.canOccupy(enemy, enemy.x, enemy.z, enemy.y, RADIUS)) {
      collision = state();
      break;
    }
    if (enemy.entered === true) break;
  }
  return { ...state(), collision };
}

const results = [], skipped = [], invalidStarts = [];
for (const gap of GAPS) for (const prop of SPACE.props) {
  const middleX = (prop.minX + prop.maxX) / 2, middleZ = (prop.minZ + prop.maxZ) / 2;
  for (const [dx, dz, face] of FACES) {
    const start = {
      x: dx ? (dx < 0 ? prop.minX : prop.maxX) + dx * gap : middleX,
      z: dz ? (dz < 0 ? prop.minZ : prop.maxZ) + dz * gap : middleZ,
    };
    const label = `walker ${gap} m off the ${face} face of ${prop.id}`;
    const { sim } = setup();
    if (!sim.canOccupy({ kind: 'walker', scale: 1 }, start.x, start.z, 0, RADIUS)) {
      const record = { gap, prop: prop.id, face, start, label };
      if (inside(start, LEVEL.buildingBounds, RADIUS)) skipped.push({ ...record, reason: 'facade' });
      else invalidStarts.push(record);
      continue;
    }
    results.push({ gap, prop: prop.id, face, start: { x: round(start.x), z: round(start.z) }, ...drive({ label, ...start }) });
  }
}

const totals = GAPS.map(gap => {
  const starts = results.filter(result => result.gap === gap);
  const distances = starts.map(result => result.moved), times = starts.map(result => result.seconds);
  return {
    gap,
    starts: starts.length,
    movedAtLeast5m: starts.filter(result => result.moved >= 5).length,
    entered: starts.filter(result => result.entered).length,
    colliderFree: starts.filter(result => !result.collision).length,
    facadeSkips: skipped.filter(result => result.gap === gap).length,
    invalidStarts: invalidStarts.filter(result => result.gap === gap).length,
    movedRange: distances.length ? [Math.min(...distances), Math.max(...distances)] : null,
    secondsRange: times.length ? [Math.min(...times), Math.max(...times)] : null,
  };
});
const failures = results.filter(result => result.moved < 5 || !result.entered || result.collision);
console.log(`CENSUS ${JSON.stringify(census(SPACE.props))}`);
console.log(`TOTALS ${JSON.stringify(totals)}`);
console.log(`SKIPPED ${JSON.stringify(skipped)}`);
console.log(`INVALID_STARTS ${JSON.stringify(invalidStarts)}`);
for (const result of results) console.log(`START ${JSON.stringify(result)}`);
console.log(`FAILURES ${JSON.stringify(failures)}`);

assert.equal(results.length + skipped.length + invalidStarts.length, GAPS.length * SPACE.props.length * FACES.length,
  'every prop face at both gaps is either driven or explicitly reported');
assert.deepEqual(invalidStarts, [], 'no start may be blocked by anything other than the facade');
assert.deepEqual(results.filter(result => result.collision), [], 'no walker may enter a real collider');
for (const gap of GAPS) {
  const starts = results.filter(result => result.gap === gap);
  const stuck = starts.filter(result => result.moved < 5 || !result.entered);
  assert.equal(stuck.length, 0,
    `${stuck.length}/${starts.length} walkers ${gap} m off a prop face moved less than 5 m or stayed outside for 40 s`);
}
const least = Math.min(...results.map(result => result.moved));
const latest = Math.max(...results.map(result => result.seconds));
console.log(`supermarket zombie props verified: ${results.length} prop starts walked at least 5 m and got inside within 40 s (minimum ${least} m, latest ${latest} s); ${skipped.length} facade-only faces skipped`);
