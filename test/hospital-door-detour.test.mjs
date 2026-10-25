import test from 'node:test';
import assert from 'node:assert/strict';

// Owner decision (24 October): on the hospital a zombie outside keeps
// attacking its nearest door when the only open door is a long walk round the
// 40 x 30 m building; it still takes an open door whose walked route is at
// most about 15 m longer. These tests drive the real RoomSimulation zombie
// loop and read the door bashes from the simulation's event stream.
process.env.DEADWOOD_LEVEL = 'hospital';
const { RoomSimulation } = await import('../simulation.mjs');
const { LEVEL } = await import('../public/level-config.js');

const DT = 1 / 30;
const ID = '0123456789abcdef';
const BOUNDS = LEVEL.buildingBounds;
const insideBuilding = point => point.x > BOUNDS.minX && point.x < BOUNDS.maxX && point.z > BOUNDS.minZ && point.z < BOUNDS.maxZ;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function setup(openDoorIds = []) {
  const events = [];
  const sim = new RoomSimulation('HOSDET', { random: () => .5, raids: false, onEvent: message => events.push(message) });
  const player = sim.addPlayer(ID, 'Jules');
  sim.start(ID);
  Object.assign(sim, { phase: 'wave', wave: 1, toSpawn: 100, spawnTimer: 1e9 });
  for (const door of sim.doors) {
    door.sealed = false;
    door.sealPending = false;
    if (openDoorIds.includes(door.id)) door.boards.fill(0);
  }
  // The survivor waits at the corridor spine: every walker outside must pick
  // a door, and nobody outside pulls it into a melee instead.
  Object.assign(player, { x: 0, y: 0, z: 0, hp: 1e6, maxHp: 1e6, alive: true, downed: false, grounded: true, vy: 0 });
  assert.equal(sim.canOccupy(player, player.x, player.z, player.y, .25), true, 'the spine post is free');
  return { sim, player, events };
}

function spawnWalker(sim, start, speed = 2.2) {
  const zombie = sim.spawnZombie();
  assert.ok(zombie, 'walker materialised through RoomSimulation');
  Object.assign(zombie, { y: 0, ...start }, {
    kind: 'walker', boss: false, scale: 1, speed, entered: false, hp: 1e5, maxHp: 1e5,
    navigation: null, portalRoute: null, stairState: null,
    attackAfter: 0, pushX: 0, pushZ: 0, pushLeft: 0, crowdedSince: null, routeCheckAt: 0,
  });
  assert.equal(sim.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true, `walker start is free: ${JSON.stringify(start)}`);
  return zombie;
}

// Ticks one walker; records the first door it was routed to and the metres
// it walked; stops when until() holds or after `seconds`.
function drive(sim, player, zombie, { seconds, until, each = () => {} }) {
  let traveled = 0, firstDoorId = null, tick = 0;
  const doorIds = new Set();
  for (const ticks = Math.round(seconds / DT); tick < ticks; tick++) {
    const before = { x: zombie.x, z: zombie.z };
    sim.time += DT;
    each(tick * DT);
    sim.updateZombie(zombie, DT, [player]);
    traveled += flat(zombie, before);
    if (zombie.portalRoute) { firstDoorId ??= zombie.portalRoute.doorId; doorIds.add(zombie.portalRoute.doorId); }
    if (until(zombie)) { tick++; break; }
  }
  return { firstDoorId, doorIds: [...doorIds], traveled: Number(traveled.toFixed(2)), seconds: Number((tick * DT).toFixed(2)) };
}

const door = (sim, id) => sim.doors.find(item => item.id === id);
const bashes = (events, id) => events.filter(message => message.event === 'door' && message.doorId === id).length;

test('a hospital walker at the closed west door attacks its boards instead of walking round to an open east or south door', () => {
  // West entries to the west threshold: 5.9 m. To the south door 38.8 m, to
  // the east door 74-79 m: both far beyond the 15 m allowance.
  for (const open of ['east', 'south']) for (const start of [{ x: -25.4, z: -3.6 }, { x: -25.4, z: 3.6 }]) {
    const { sim, player, events } = setup([open]);
    const west = door(sim, 'west');
    const zombie = spawnWalker(sim, start);
    const run = drive(sim, player, zombie, { seconds: 30, until: () => bashes(events, 'west') >= 3 });
    const label = `${open} open, walker from (${start.x}, ${start.z})`;
    assert.deepEqual(run.doorIds, ['west'], `${label}: routed only to its closed west door: ${JSON.stringify(run)}`);
    assert.ok(bashes(events, 'west') >= 3 && west.hp < west.maxHp, `${label}: the walker bashes the west boards (${west.hp}/${west.maxHp})`);
    assert.equal(bashes(events, open), 0, `${label}: the open door is never touched`);
    assert.ok(run.traveled < 10, `${label}: no walk round the building (${run.traveled} m)`);
    assert.equal(zombie.entered, false, `${label}: still outside, at its boards`);
  }
});

test('a hospital walker still takes an open door a few metres further than its closed nearest door', () => {
  // By the north-east corner: the closed east door is 16.5 m of walk away,
  // the open north door 21.5 m (5 m further, inside the allowance).
  const { sim, player, events } = setup(['north']);
  const east = door(sim, 'east');
  const zombie = spawnWalker(sim, { x: 21.5, z: -16.5 });
  const run = drive(sim, player, zombie, { seconds: 40, until: body => body.entered && insideBuilding(body) });
  assert.equal(run.firstDoorId, 'north', `the open north door is taken: ${JSON.stringify(run)}`);
  assert.equal(zombie.entered && insideBuilding(zombie), true, `the walker got inside: ${JSON.stringify({ x: zombie.x, z: zombie.z, ...run })}`);
  assert.equal(bashes(events, 'east'), 0, 'the closed east boards were never bashed');
  assert.equal(east.hp, east.maxHp);
  assert.ok(run.traveled < 30, `the open door is walked to directly: ${run.traveled} m in ${run.seconds} s`);
});

test('a hospital walker bound for closed boards turns to a door that opens within the allowance, and not to a far one', () => {
  // On its way from the north-east corner to the closed east door, the north
  // door is broken open half a second in: it is 5 m further, so the walker turns.
  {
    const { sim, player, events } = setup([]);
    const north = door(sim, 'north');
    const zombie = spawnWalker(sim, { x: 21.5, z: -16.5 });
    const run = drive(sim, player, zombie, { seconds: 40, until: body => body.entered && insideBuilding(body),
      each: time => { if (time >= .5 && north.hp > 0) north.boards.fill(0); } });
    assert.equal(run.firstDoorId, 'east', 'it first heads for its nearest door');
    assert.deepEqual(run.doorIds, ['east', 'north'], `then turns to the open north door: ${JSON.stringify(run)}`);
    assert.ok(zombie.entered && insideBuilding(zombie), `and gets in: ${JSON.stringify(run)}`);
    assert.equal(bashes(events, 'east'), 0, 'it never reached the east boards');
  }
  // At the west boards, the east door opening (73 m round) changes nothing,
  // and the walker does not re-plan every tick: walks are measured at most
  // once a second (4 doors each), not 30 times.
  {
    const { sim, player, events } = setup([]);
    const east = door(sim, 'east'), west = door(sim, 'west');
    let walks = 0;
    const measure = sim.exteriorWalk.bind(sim);
    sim.exteriorWalk = (...args) => { walks++; return measure(...args); };
    const zombie = spawnWalker(sim, { x: -25.4, z: 3.6 });
    const run = drive(sim, player, zombie, { seconds: 10, until: () => false, each: time => { if (time >= 3 && east.hp > 0) east.boards.fill(0); } });
    assert.deepEqual(run.doorIds, ['west'], `the walker stays on the west boards: ${JSON.stringify(run)}`);
    assert.ok(bashes(events, 'west') >= 5 && west.hp < west.maxHp, 'and keeps bashing them');
    console.log(JSON.stringify({ walkedRoutesMeasuredIn10s: walks }));
    assert.ok(walks <= 4 * 9, `${walks} walked routes measured in 10 s`);
  }
});

test('hospital walkers held at closed boards spread their door reviews over the second instead of all on one tick', () => {
  // Sixteen walkers outside the west door, only the far east door open, and
  // the west boards kept whole: every body stays bound for boards and looks
  // for a worthwhile open door once a second, 4 walked routes per look. The
  // looks fall on each body's own beat (from its id), so no tick carries the
  // whole crowd's walks; each body still looks about once a second.
  const { sim, player } = setup(['east']);
  const west = door(sim, 'west'), whole = [...west.boards];
  const starts = [];
  for (const x of [-25.4, -26.6, -27.8, -29, -30.2]) for (const z of [-4.2, -2.8, -1.4, 0, 1.4, 2.8, 4.2]) {
    if (starts.length < 16 && sim.canOccupy({ y: 0 }, x, z, 0, .29) && starts.every(other => flat(other, { x, z }) >= .7)) starts.push({ x, z });
  }
  assert.equal(starts.length, 16, `sixteen free starts west of the building: ${JSON.stringify(starts)}`);
  const walkers = starts.map(start => spawnWalker(sim, start, 1.3));
  let walks = 0;
  const perZombie = new Map(walkers.map(zombie => [zombie, 0]));
  const measure = sim.exteriorWalk.bind(sim);
  sim.exteriorWalk = (zombie, ...rest) => { walks++; perZombie.set(zombie, (perZombie.get(zombie) ?? 0) + 1); return measure(zombie, ...rest); };
  const perTick = [], doorIds = new Set();
  for (let tick = 0; tick < 5 * 30; tick++) {
    sim.time += DT;
    for (let index = 0; index < whole.length; index++) west.boards[index] = whole[index];
    walks = 0;
    for (const zombie of walkers) {
      sim.updateZombie(zombie, DT, [player]);
      if (zombie.portalRoute) doorIds.add(zombie.portalRoute.doorId);
    }
    sim.separateZombies(DT);
    perTick.push(walks);
  }
  // Tick 0 is every body's first door choice (they all appeared together).
  const reviewTicks = perTick.slice(1), busiest = Math.max(...reviewTicks), total = reviewTicks.reduce((sum, count) => sum + count, 0);
  const firstChoice = perTick[0], looks = [...perZombie.values()].map(count => (count - 4) / 4);
  console.log(JSON.stringify({ firstChoiceWalks: firstChoice, busiestReviewTick: busiest, reviewWalksIn5s: total, looksPerBody: looks }));
  assert.deepEqual([...doorIds], ['west'], 'every walker stays on the west boards');
  assert.equal(firstChoice, 16 * 4, 'the first choice measures 4 doors per body');
  assert.ok(busiest <= 4 * 3, `at most three bodies look on any one tick (busiest tick: ${busiest} walks; the whole crowd together would be ${16 * 4})`);
  assert.ok(looks.every(count => count >= 4 && count <= 5), `each body still looks once a second (${JSON.stringify(looks)} looks in 5 s)`);
});

test('a hospital walker with every door closed still attacks the nearest door', () => {
  const { sim, player, events } = setup([]);
  const zombie = spawnWalker(sim, { x: -25.4, z: 3.6 });
  const run = drive(sim, player, zombie, { seconds: 30, until: () => bashes(events, 'west') >= 3 });
  assert.deepEqual(run.doorIds, ['west'], `all doors closed: the nearest door stays the target: ${JSON.stringify(run)}`);
  assert.ok(bashes(events, 'west') >= 3, 'the event stream carries door bashes on the west door');
});

test('a short hospital batch from the west entries breaks in by the west door instead of walking round to the open east door', () => {
  // Six walkers at 1.3 m/s from both west entries, only the east door open.
  // Before the owner's rule they all walked ~80 m round the building and the
  // last one was inside after ~61 s; now they break the west boards together.
  const { sim, player, events } = setup(['east']);
  const west = door(sim, 'west');
  const entries = [{ x: -25.4, z: -3.6 }, { x: -25.4, z: 3.6 }], laterals = [-1.5, 0, 1.5];
  const walkers = Array.from({ length: 6 }, (_, index) => {
    const entry = entries[index % 2];
    return { zombie: spawnWalker(sim, { x: entry.x, z: entry.z + laterals[Math.floor(index / 2)] }, 1.3), traveled: 0, insideAt: null, doors: new Set() };
  });
  let seconds = 0;
  for (let tick = 0; tick < 90 * 30 && walkers.some(walker => walker.insideAt === null); tick++) {
    sim.time += DT;
    seconds = (tick + 1) * DT;
    for (const walker of walkers) {
      const before = { x: walker.zombie.x, z: walker.zombie.z };
      sim.updateZombie(walker.zombie, DT, [player]);
      if (walker.insideAt === null) walker.traveled += flat(walker.zombie, before);
      if (walker.zombie.portalRoute) walker.doors.add(walker.zombie.portalRoute.doorId);
    }
    sim.separateZombies(DT);
    for (const walker of walkers) if (walker.insideAt === null && walker.zombie.entered && insideBuilding(walker.zombie)) walker.insideAt = seconds;
  }
  const rows = walkers.map(walker => ({ doors: [...walker.doors], traveled: Number(walker.traveled.toFixed(1)), insideAt: walker.insideAt === null ? null : Number(walker.insideAt.toFixed(1)) }));
  const latest = Math.max(...rows.map(row => row.insideAt ?? Infinity));
  console.log(JSON.stringify({ latestInsideAt: latest, westBashes: bashes(events, 'west'), westHp: west.hp, walkers: rows }));
  assert.ok(rows.every(row => row.doors.includes('west') && !row.doors.includes('east')), `every walker went for the west door: ${JSON.stringify(rows)}`);
  assert.ok(bashes(events, 'west') > 0 && sim.doorPassable(west, 0, 1.82), `the west boards were broken open (${west.hp}/${west.maxHp})`);
  assert.ok(latest <= 30, `all six inside within 30 s (latest ${latest} s): ${JSON.stringify(rows)}`);
  assert.ok(rows.every(row => row.traveled < 20), `nobody walked round the building: ${JSON.stringify(rows)}`);
});
