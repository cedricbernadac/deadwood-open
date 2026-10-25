import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { IS_FUNFAIR, LEVEL } from '../../public/level-config.js';
import { SPACE } from '../../public/level-space.js';

assert.equal(IS_FUNFAIR, true, 'run with DEADWOOD_LEVEL=funfair');
const DT = 1 / 30;
const ID = '0123456789abcdef';
const RADIUS = .29;
const SPEED = { walker: 1.32, crawler: .9 };
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const round = value => Number(value.toFixed(2));
const inside = (point, box, padding = 0) => point.x >= box.minX - padding && point.x <= box.maxX + padding
  && point.z >= box.minZ - padding && point.z <= box.maxZ + padding;

function setup() {
  const sim = new RoomSimulation('FUNPROP', { random: () => .5, raids: false });
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
    assert.equal(sim.canOccupy(enemy, enemy.x, enemy.z, enemy.y, RADIUS), true, `${label} illegal enemy body: ${JSON.stringify(state())}`);
    if (stop(state())) { tick++; break; }
  }
  return state();
}

assert.equal(SPACE.props.length, 14, `the funfair lists its fourteen exterior props: ${SPACE.props.length}`);
const results = [];
for (const gap of [.3, .4]) for (const prop of SPACE.props) {
  const middleX = (prop.minX + prop.maxX) / 2, middleZ = (prop.minZ + prop.maxZ) / 2;
  for (const [dx, dz, face] of [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']]) {
    const start = {
      x: dx ? (dx < 0 ? prop.minX : prop.maxX) + dx * gap : middleX,
      z: dz ? (dz < 0 ? prop.minZ : prop.maxZ) + dz * gap : middleZ,
    };
    const label = `walker ${gap} m off the ${face} face of ${prop.id}`;
    const { sim } = setup();
    assert.equal(sim.canOccupy({ kind: 'walker', scale: 1 }, start.x, start.z, 0, RADIUS), true,
      `${label} starts on free outdoor ground: ${JSON.stringify(start)}`);
    assert.equal(inside(start, LEVEL.buildingBounds, RADIUS), false, `${label} is not an interior start`);
    results.push({ gap, ...drive({ label, ...start, kind: 'walker', seconds: 40, stop: state => state.entered && state.moved >= 5 }) });
  }
}
for (const gap of [.3, .4]) {
  const starts = results.filter(result => result.gap === gap), stuck = starts.filter(result => result.moved < 5 || !result.entered);
  assert.equal(stuck.length, 0, `${stuck.length}/${starts.length} walkers ${gap} m off a prop face moved less than 5 m or stayed outside for 40 s: ${JSON.stringify(stuck.slice(0, 4))}`);
}

const tightCorners = [
  { label: 'crawler at the carousel south-west corner', x: -30.3, z: 23.7, kind: 'crawler' },
  { label: 'walker beside the west ticket-arch support', x: -2.7, z: -15.5, kind: 'walker' },
].map(spot => {
  const { sim } = setup();
  assert.equal(sim.canOccupy({ kind: spot.kind, scale: 1 }, spot.x, spot.z, 0, RADIUS), true, `${spot.label} starts on free ground`);
  return drive({ ...spot, seconds: 60, stop: state => state.entered });
});
const outside = tightCorners.filter(result => !result.entered);
assert.equal(outside.length, 0, `${outside.length}/2 tight-corner starts did not get inside within 60 s: ${JSON.stringify(outside)}`);

const least = Math.min(...results.map(result => result.moved));
console.log(JSON.stringify({ starts: results.length, tightCorners: tightCorners.map(({ label, seconds, moved }) => ({ label, seconds, moved })) }));
console.log(`funfair zombie props verified: ${results.length} prop starts walked at least ${least} m and got inside within 40 s; ${tightCorners.map(result => `${result.label} inside after ${result.seconds} s`).join(', ')}`);
