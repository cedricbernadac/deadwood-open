import test from 'node:test';
import assert from 'node:assert/strict';

// Owner decision (24 October): the car park's bus shelter is a real rain
// shelter, not a solid 2.35 m box. Small colliders (back wall, glazed side,
// lone front post, bench), an open front and an open end, a roof slab in
// SPACE.shelters: the simulation's rain and the companions' trips treat its
// footprint as dry, and zombies walk round its posts.
process.env.DEADWOOD_LEVEL = 'hospital';
const { RoomSimulation } = await import('../simulation.mjs');
const { LEVEL } = await import('../public/level-config.js');
const { SPACE, spaceRainShelter, spaceCanOccupy } = await import('../public/level-space.js');
const { SPAWN_ENTRIES, FAR_SPAWN_ENTRIES } = await import('../public/expedition.js');
const { PLAYER_POSTURE, ARMORY } = await import('../public/rules.js');
const { wayOut, rainCost, shelterMetres } = await import('../companions/outdoors.mjs');
const { createCompanionBody } = await import('../companions/body.mjs');

const DT = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const within = (point, box) => point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ;
const parts = SPACE.props.filter(prop => prop.shelter === 'bus-shelter-east');
const part = kind => parts.find(prop => prop.kind === `bus-shelter-${kind}`);
const roof = SPACE.slabs.find(slab => slab.id === 'bus-shelter-east-roof');
const seat = SPACE.slabs.find(slab => slab.id === 'bus-shelter-east-seat');
const east = LEVEL.doors.find(door => door.id === 'east');
// A standing body in front of the bench, under the roof, and one 1.5 m out in the open.
const UNDER = { x: 26.5, y: 0, z: 8.6 }, OPEN = { x: 26.5, y: 0, z: (roof?.maxZ ?? 9.3) + 1.5 };

function room() {
  const sim = new RoomSimulation('HOSBUS', { random: () => .5, raids: false });
  const papa = sim.addPlayer('papa0123456789ab', 'Papa');
  const max = sim.addPlayer('bot0123456789abc', 'Max', undefined, { companion: true });
  sim.start(papa.id);
  Object.assign(sim, { phase: 'wave', wave: 3, toSpawn: 0, spawnTimer: 1e9 });
  sim.zombies.clear();
  for (const door of sim.doors) { door.sealed = false; door.sealPending = false; door.boards.fill(0); }
  for (const player of [papa, max]) Object.assign(player, { hp: 100, grounded: true, vy: 0 });
  return { sim, papa, max };
}

test('the bus shelter is four small colliders under a roof slab that clears the colossus', () => {
  assert.deepEqual(parts.map(prop => prop.kind).sort(), ['bus-shelter-back', 'bus-shelter-bench', 'bus-shelter-post', 'bus-shelter-side']);
  assert.equal(SPACE.props.some(prop => prop.kind === 'bus-shelter'), false, 'the old solid box is gone');
  const area = prop => (prop.maxX - prop.minX) * (prop.maxZ - prop.minZ);
  assert.ok(parts.reduce((sum, prop) => sum + area(prop), 0) < .3 * area(roof), 'the colliders cover a small part of the roof footprint');
  assert.ok(roof.minY >= 1.91 * 1.32 + .03, `the roof underside (${roof.minY} m) is above the 2.52 m colossus`);
  assert.ok(SPACE.shelters.some(shelter => shelter.id === roof.id), 'the roof is a rain shelter');
  assert.ok(!SPACE.shelters.some(shelter => shelter.id === seat.id), 'the bench seat is not');
  for (const prop of parts) assert.ok(within({ x: prop.minX, z: prop.minZ }, roof) && within({ x: prop.maxX, z: prop.maxZ }, roof), `${prop.id} stands under the roof`);
  assert.equal(seat.maxY, part('bench').maxY, 'the seat slab tops the bench collider');
  // Open front (south) and open west end at body height; a standing body fits under the roof.
  assert.equal(spaceCanOccupy(UNDER.x, UNDER.z, 0, PLAYER_POSTURE.standingHeight, .3), true, 'a body stands in front of the bench');
  for (const z of [part('bench').maxZ + .35, (part('bench').maxZ + roof.maxZ) / 2, roof.maxZ + .3]) {
    assert.equal(spaceCanOccupy(UNDER.x, z, 0, 1.82, .3), true, `the open front at z ${z}`);
  }
  const lane = (part('bench').maxZ + part('post').minZ) / 2;
  for (let x = roof.minX - .5; x < part('side').minX - .35; x += .25) assert.equal(spaceCanOccupy(x, lane, 0, 1.82, .3), true, `walk in by the open west end at x ${x}, z ${lane}`);
  // Near the east door, clear of the spawn points and their fallbacks.
  assert.ok(flat({ x: east.x + east.outX, z: east.z + east.outZ }, UNDER) < 12, 'a companion trip out of the east door reaches the roof');
  for (const entry of [...SPAWN_ENTRIES, ...FAR_SPAWN_ENTRIES]) {
    for (const depth of [0, 1.6, 4]) for (const lateral of [-2.25, 0, 2.25]) {
      const door = LEVEL.doors.find(item => item.id === entry.doorId);
      const point = { x: entry.x + door.outX * depth + Math.abs(door.outZ) * lateral, z: entry.z + door.outZ * depth + Math.abs(door.outX) * lateral };
      for (const prop of parts) assert.ok(!(point.x > prop.minX - .8 && point.x < prop.maxX + .8 && point.z > prop.minZ - .8 && point.z < prop.maxZ + .8),
        `spawn fallback ${JSON.stringify(point)} of ${entry.id} stays clear of ${prop.id}`);
    }
  }
});

test('a player standing under the bus shelter takes no rain, one in the open beside it does', () => {
  const { sim, papa, max } = room();
  Object.assign(papa, UNDER); Object.assign(max, OPEN);
  assert.equal(sim.canOccupy(papa, papa.x, papa.z, 0, .25), true, 'Papa stands on free ground in front of the bench');
  assert.equal(spaceRainShelter(papa, PLAYER_POSTURE.standingHeight), true, 'under the bus shelter roof');
  assert.equal(sim.rainExposed(papa), false, 'under the roof: not exposed');
  assert.equal(sim.canOccupy(max, max.x, max.z, 0, .25), true, 'Max stands on free ground in the open');
  assert.equal(sim.rainExposed(max), true, 'in the open: exposed');
  for (let tick = 0; tick < 10 * 30; tick++) sim.tick(DT);
  assert.equal(papa.hp, 100, `the sheltered player keeps every HP (${papa.hp})`);
  assert.ok(max.hp < 100, `the player in the open loses HP to the rain (${max.hp})`);
  assert.ok(Math.abs(papa.x - UNDER.x) < 1e-6 && Math.abs(papa.z - UNDER.z) < 1e-6, 'nobody moved');
});

test('a player who jumps onto the bench stands on its seat, dry, and steps off again', () => {
  const { sim, papa } = room();
  Object.assign(papa, { x: 26.5, y: 0, z: part('bench').maxZ + .45, yaw: 0 });
  let tick = 0, jumped = false;
  for (; tick < 60; tick++) {
    sim.setInput(papa.id, { forward: tick < 12 ? 1 : 0, strafe: 0, yaw: 0, pitch: 0, jump: tick === 2 });
    sim.tick(DT);
    jumped ||= papa.y > seat.maxY + .1;
  }
  assert.ok(jumped, 'the jump cleared the seat');
  assert.ok(Math.abs(papa.y - seat.maxY) < 1e-6 && papa.grounded, `standing on the seat: y ${papa.y}, grounded ${papa.grounded}`);
  assert.ok(within(papa, part('bench')), `above the bench: ${JSON.stringify({ x: papa.x, z: papa.z })}`);
  assert.equal(sim.rainExposed(papa), false, 'dry on the bench too');
  for (tick = 0; tick < 45; tick++) { sim.setInput(papa.id, { forward: -1, strafe: 0, yaw: 0, pitch: 0 }); sim.tick(DT); }
  assert.ok(papa.y === 0 && papa.z > part('bench').maxZ + .2, `stepped back off onto the ground: ${JSON.stringify({ y: papa.y, z: papa.z })}`);
});

test('a companion trip out of the east door reaches the shelter, counts its roof dry and folds the umbrella under it', () => {
  const { sim, papa, max } = room();
  // The planner: a way out to an ammo box under the roof, with dry metres.
  const box = { x: 26.5, y: 0, z: 8.9 };
  const way = wayOut(sim, box);
  assert.ok(way && way.door.id === 'east', `a trip out of the east door: ${JSON.stringify(way)}`);
  assert.ok(way.dry > 1.5 && Math.abs(way.dry - shelterMetres({ x: east.x + east.outX, z: east.z + east.outZ }, box)) < 1e-9, `metres under the roof: ${way.dry}`);
  max.umbrella.remaining = 0;
  const cost = rainCost(sim, max, way.distance, way), open = rainCost(sim, max, way.distance, { ...way, dry: 0 });
  assert.ok(cost.seconds < open.seconds && cost.burn < open.burn, `the roof saves rain: ${JSON.stringify({ cost, open })}`);
  max.umbrella.remaining = 100;
  // The body: from inside by the east door, out, onto the box under the roof, back in.
  Object.assign(papa, { x: 0, y: 0, z: .7 });
  // An SMG bought at its rack, its spare ammo gone: the box is worth the trip.
  const rack = ARMORY.find(item => item.weapon === 'smg');
  Object.assign(max, { x: rack.x + Math.sin(rack.facing ?? 0) * .95, y: rack.y, z: rack.z + Math.cos(rack.facing ?? 0) * .95, interactAfter: 0, points: 50000 });
  sim.wave = 16;
  assert.ok(sim.buyWeapon(max.id, rack.id), 'setup: SMG bought');
  sim.chooseWeapon(max.id, 'smg');
  Object.assign(max, { x: 17.5, y: 0, z: 0, interactAfter: 0, grounded: true, vy: 0, points: 50000, companionSlot: 0 });
  for (const stock of Object.values(max.inventory)) if (stock && typeof stock === 'object') stock.reserve = 0;
  sim.companionOrders = new Map();
  const id = `pa${sim.nextPickupId++}`;
  sim.pickups.set(id, { id, kind: 'ammo', ...box, amount: 1, special: false, expiresAt: Infinity });
  const body = createCompanionBody(sim, max.id, { random: () => .5 });
  body.setOrder({ kind: 'collect', pickupId: id });
  let underRoof = 0, openUnderRoof = 0, wetUnderRoof = 0, reached = false;
  for (let tick = 0; tick < 40 * 30 && body.status === 'running'; tick++) {
    sim.setInput(papa.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
    body.tick(DT);
    sim.tick(DT);
    // Well under the roof (the umbrella is judged a step ahead).
    if (within(max, { minX: roof.minX + .5, maxX: roof.maxX - .5, minZ: roof.minZ + .5, maxZ: roof.maxZ - .5 })) {
      underRoof++;
      if (max.umbrella.open) openUnderRoof++;
      if (sim.rainExposed(max)) wetUnderRoof++;
    }
    reached ||= flat(max, box) < 1.2;
  }
  assert.equal(body.status, 'done', `the trip completes: ${body.status}`);
  assert.ok(max.inventory.smg.reserve > 0, `the box refilled the SMG (${max.inventory.smg.reserve} spare rounds)`);
  assert.ok(reached && underRoof >= 3, `the body stood under the roof (${underRoof} ticks)`);
  assert.equal(wetUnderRoof, 0, 'never in the rain under the roof');
  assert.equal(openUnderRoof, 0, `umbrella folded under the roof (${openUnderRoof} of ${underRoof} ticks open)`);
  assert.ok(max.umbrella.remaining > 100 - 20, `the umbrella only spent the open stretches: ${max.umbrella.remaining} s left`);
});

test('zombies walk round the shelter posts and get inside from under its roof', () => {
  for (const spot of [{ x: 24.7, z: 7.65 }, { x: 26.5, z: 8.05 }, { x: 28.05, z: 8.4 }]) {
    const { sim, papa } = room();
    Object.assign(papa, { x: 0, y: 0, z: .7, hp: 1e6, maxHp: 1e6 });
    const zombie = sim.spawnZombie();
    Object.assign(zombie, { ...spot, y: 0, kind: 'walker', boss: false, scale: 1, speed: 1.32, hp: 1e5, maxHp: 1e5, entered: false,
      navigation: null, portalRoute: null, stairState: null, attackAfter: 0, pushX: 0, pushZ: 0, pushLeft: 0 });
    assert.equal(sim.canOccupy(zombie, zombie.x, zombie.z, 0, .29), true, `walker under the roof at ${JSON.stringify(spot)} starts free`);
    let tick = 0;
    for (; tick < 40 * 30 && !zombie.entered; tick++) {
      sim.time += DT;
      sim.updateZombie(zombie, DT, [papa]);
      assert.equal(sim.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), true, `never inside a shelter collider: ${JSON.stringify({ x: zombie.x, z: zombie.z })}`);
    }
    assert.equal(zombie.entered, true, `walker from ${JSON.stringify(spot)} got inside (${(tick * DT).toFixed(1)} s)`);
  }
});
