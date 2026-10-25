import assert from 'node:assert/strict';
// Hospital zombies pressed against an exterior prop (the cars, the ambulance,
// the bus shelter, the sign, the hedges, the lamps) must still walk round it
// to an open door, or the wave never ends. The exterior escape test in
// segmentClear used boxes wider than the prop's collider (max(.425, r+.13)),
// so a legal walker whose centre was 0.3 or 0.4 m off a face had no escape
// segment, routeAroundObstacles returned [] and the walker stood there for
// the rest of the wave: 49/49 starts per distance moved 0 m, as did the
// reported crawler by the north-west hedge and a walker at the sign's west
// end. A prop is now tested against its real collider; the facade keeps its
// own rule. The bus shelter is an open shelter of four colliders (back wall,
// glazed side, front post, bench): a face turned to another of its parts has
// no room, and walkers starting under its roof, by the bench and in the
// pocket at its open west end, must walk out and get inside too. Run with
// DEADWOOD_LEVEL=hospital.
import { RoomSimulation } from '../../simulation.mjs';
import { IS_HOSPITAL, LEVEL } from '../../public/level-config.js';
import { SPACE } from '../../public/level-space.js';

assert.equal(IS_HOSPITAL, true, 'run with DEADWOOD_LEVEL=hospital');
const DT = 1 / 30;
const ID = '0123456789abcdef';
const RADIUS = .29;
const SPEED = { walker: 1.32, crawler: .9 };
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const round = value => Number(value.toFixed(2));
const inside = (point, box, padding = 0) => point.x >= box.minX - padding && point.x <= box.maxX + padding
  && point.z >= box.minZ - padding && point.z <= box.maxZ + padding;

// A quiet wave with every exterior door open and a human standing inside.
function setup() {
  const sim = new RoomSimulation('HOSPROP', { random: () => .5, raids: false });
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

// Drives one outdoor zombie toward the human; stop(state) ends the drive early.
function drive({ label, x, z, kind, seconds, stop }) {
  const { sim, player } = setup();
  const enemy = sim.spawnZombie();
  assert.ok(enemy, `${label} spawned through RoomSimulation`);
  Object.assign(enemy, {
    kind, x, y: 0, z, scale: 1, speed: SPEED[kind], hp: 1e5, maxHp: 1e5, entered: false,
    navigation: null, portalRoute: null, stairState: null, attackAfter: 0, pushX: 0, pushZ: 0, pushLeft: 0,
  });
  let moved = 0, previous = { x: enemy.x, z: enemy.z }, tick = 0;
  const state = () => ({ label, seconds: round(tick * DT), moved: round(moved), entered: enemy.entered === true,
    end: { x: round(enemy.x), y: round(enemy.y), z: round(enemy.z) }, navigation: enemy.navigation, portalRoute: enemy.portalRoute });
  for (; tick < seconds * 30; tick++) {
    sim.time += DT;
    sim.updateZombie(enemy, DT, [player]);
    moved += flat(enemy, previous);
    previous = { x: enemy.x, z: enemy.z };
    // The escape segment may leave the graph's padding, never the collider.
    assert.equal(sim.canOccupy(enemy, enemy.x, enemy.z, enemy.y, RADIUS), true, `${label} illegal enemy body: ${JSON.stringify(state())}`);
    if (stop(state())) { tick++; break; }
  }
  return state();
}

// 0.3 and 0.4 m off the middle of each face of every exterior prop (the
// walker's radius is .29, so the body touches or nearly touches the prop):
// each walker leaves the prop (5 m at least) and gets inside within 40 s.
assert.ok(SPACE.props.length >= 10, `the hospital lists its exterior props: ${SPACE.props.length}`);
const results = [], skipped = [];
for (const gap of [.3, .4]) for (const prop of SPACE.props) {
  const middleX = (prop.minX + prop.maxX) / 2, middleZ = (prop.minZ + prop.maxZ) / 2;
  let faces = 0;
  for (const [dx, dz, face] of [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']]) {
    const start = {
      x: dx ? (dx < 0 ? prop.minX : prop.maxX) + dx * gap : middleX,
      z: dz ? (dz < 0 ? prop.minZ : prop.maxZ) + dz * gap : middleZ,
    };
    const label = `walker ${gap} m off the ${face} face of ${prop.id}`;
    const { sim } = setup();
    if (!sim.canOccupy({ kind: 'walker', scale: 1 }, start.x, start.z, 0, RADIUS)) {
      // Only a face turned to the facade (the hedges' inner ends) or to
      // another part of the same shelter has no room.
      const sibling = prop.shelter && SPACE.props.some(other => other !== prop && other.shelter === prop.shelter && inside(start, other, RADIUS));
      assert.ok(inside(start, LEVEL.buildingBounds, RADIUS) || sibling, `${label} is blocked by something other than the facade: ${JSON.stringify(start)}`);
      skipped.push(label);
      continue;
    }
    results.push({ gap, ...drive({ label, ...start, kind: 'walker', seconds: 40, stop: state => state.entered }) });
    faces++;
  }
  assert.ok(faces >= (prop.shelter ? 1 : 3), `${prop.id} keeps at least ${prop.shelter ? 'one open face' : 'three open faces'} at ${gap} m: ${faces}`);
}
// Under the bus shelter's roof: in front of the bench at both ends and in
// its middle, and in the pocket between the bench's west end and the back wall.
const shelterParts = SPACE.props.filter(prop => prop.shelter === 'bus-shelter-east');
assert.equal(shelterParts.length, 4, 'the bus shelter has four colliders');
const roof = SPACE.slabs.find(slab => slab.id === 'bus-shelter-east-roof');
for (const spot of [{ x: 24.95, z: 8.1 }, { x: 26.5, z: 8.05 }, { x: 28.05, z: 8.4 }, { x: 24.7, z: 7.65 }]) {
  const label = `walker under the bus shelter roof at (${spot.x}, ${spot.z})`;
  const { sim } = setup();
  assert.ok(inside(spot, roof), `${label} is under the roof`);
  assert.equal(sim.canOccupy({ kind: 'walker', scale: 1 }, spot.x, spot.z, 0, RADIUS), true, `${label} starts on free ground`);
  results.push({ gap: 'shelter', ...drive({ label, ...spot, kind: 'walker', seconds: 40, stop: state => state.entered }) });
}
for (const gap of [.3, .4, 'shelter']) {
  const starts = results.filter(result => result.gap === gap), stuck = starts.filter(result => result.moved < 5 || !result.entered);
  assert.equal(stuck.length, 0, `${stuck.length}/${starts.length} walkers ${gap} m off a prop face moved less than 5 m or stayed outside for 40 s: ${JSON.stringify(stuck.slice(0, 3))}`);
}

// The two spots reported in play: both must get inside within a minute.
const reported = [
  { label: 'crawler by the north-west hedge', x: -17.1, z: -20.38, kind: 'crawler' },
  { label: 'walker at the sign\'s west end', x: -13.3, z: -19.3, kind: 'walker' },
].map(spot => {
  const { sim } = setup();
  assert.equal(sim.canOccupy({ kind: spot.kind, scale: 1 }, spot.x, spot.z, 0, RADIUS), true, `${spot.label} starts on free ground`);
  return drive({ ...spot, seconds: 60, stop: state => state.entered });
});
const outside = reported.filter(result => !result.entered);
assert.equal(outside.length, 0, `${outside.length}/2 reported spots did not get inside within 60 s: ${JSON.stringify(outside)}`);

const least = Math.min(...results.map(result => result.moved));
console.log(JSON.stringify({ starts: results.length, skipped, reported: reported.map(({ label, seconds, moved }) => ({ label, seconds, moved })) }));
console.log(`hospital zombie props verified: ${results.length} prop starts walked at least ${least} m and got inside within 40 s (${skipped.length} faces against the facade or another shelter part skipped); ${reported.map(result => `${result.label} inside after ${result.seconds} s`).join(', ')}`);
