import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import { ballisticDistance } from '../public/ballistics.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WORLD } from '../simulation.mjs';
import { ARMORY, ARMORY_RACK, ARMORY_REACH, ARMORY_HEIGHT_REACH, GENERATOR, LOFT, LOFT_RAIL, armoryRackBounds } from '../public/rules.js';

function fixture() {
  const events = [];
  const simulation = new RoomSimulation('RACKS1', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.start(player.id);
  return { simulation, player, events };
}

test('racks are suspended narrow wall volumes in all three orientations', () => {
  assert.deepEqual(ARMORY_RACK, { width: 1.3, depth: .22, baseY: .9, height: 1.25 });
  for (const [facing, expected] of [
    [0, { minX: -.65, maxX: .65, minZ: 0, maxZ: .22 }],
    [Math.PI / 2, { minX: 0, maxX: .22, minZ: -.65, maxZ: .65 }],
    [-Math.PI / 2, { minX: -.22, maxX: 0, minZ: -.65, maxZ: .65 }],
  ]) {
    const bounds = armoryRackBounds({ id: 'fixture', x: 0, y: 3.4, z: 0, facing });
    for (const [axis, value] of Object.entries(expected)) assert.ok(Math.abs(bounds[axis] - value) < 1e-9);
    assert.equal(bounds.id, 'rack-fixture');
    assert.equal(bounds.baseY, 4.3);
    assert.equal(bounds.height, 1.25);
  }
  assert.equal(WORLD.covers.filter(cover => cover.id.startsWith('rack-')).length, ARMORY.length);
  assert.equal(WORLD.covers.some(cover => cover.id.startsWith('crate-')), false);
});

test('standing players meet the wall rack while its low empty space does not block a short object', () => {
  const { simulation, player } = fixture();
  const rack = ARMORY.find(item => item.weapon === 'shotgun');
  Object.assign(player, { x: rack.x - .28, y: 0, z: rack.z });
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), false);
  Object.assign(player, { x: rack.x - .6 });
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
  const pickup = { x: rack.x - .28, y: 0, z: rack.z };
  assert.equal(simulation.canCollectPickup(player, pickup), true, 'An actual clear low ray can reach under the suspended rack');
});

test('rack AABBs stop actual bullets before the wall in both west and east orientations', () => {
  for (const weapon of ['rifle', 'shotgun']) {
    const { simulation, player, events } = fixture();
    const rack = ARMORY.find(item => item.weapon === weapon), direction = Math.sin(rack.facing);
    Object.assign(player, { x: rack.x + direction * 1.4, y: 0, z: rack.z, yaw: rack.facing, pitch: 0 });
    assert.equal(simulation.shoot(player.id), true);
    settleBallisticFlight(simulation);
    const shot = events.find(event => event.event === 'shot');
    const impact = events.find(event => event.event === 'bullet-impact');
    assert.equal(impact.stop, 'solid');
    assert.ok(Math.abs(ballisticDistance(shot.projectiles[0], impact.age) - (1.4 - ARMORY_RACK.depth)) < .002,
      `${weapon}: bullet meets the .22 m rack front, not an old island or the wall behind it`);
  }
});

test('all former floor islands are now clear independently of the nearby wall rack', () => {
  const { simulation, player } = fixture();
  for (const position of [
    { x: -3.6, y: 0, z: -5 }, { x: -6.7, y: 0, z: -4.1 }, { x: 6, y: 0, z: -3.9 },
    { x: 6.6, y: 0, z: 4.7 }, { x: -6.7, y: 0, z: 4.7 }, { x: 6.6, y: 3.4, z: -4.1 },
  ]) {
    Object.assign(player, position);
    assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true, JSON.stringify(position));
  }
});

test('the moved pistol rack cannot be reached by a sprint jump towards it from sofa or loft', () => {
  const pistol = ARMORY.find(crate => crate.weapon === 'pistol'), rack = armoryRackBounds(pistol);
  for (const delta of [.1, 1 / 30]) for (const origin of [
    { x: pistol.x, y: 1, z: 3.6 }, { x: .9, y: 3.4, z: 5.3 },
  ]) {
    const { simulation, player } = fixture();
    Object.assign(player, origin, { grounded: true, vy: 0 });
    assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
    const yaw = Math.atan2(origin.x - pistol.x, origin.z - pistol.z);
    for (let elapsed = 0; elapsed < 2; elapsed += delta) {
      simulation.time += delta;
      simulation.setInput(player.id, { forward: 1, strafe: 0, yaw, pitch: 0, sprint: true, jump: elapsed === 0 });
      simulation.movePlayer(player, delta);
      assert.ok(!(player.grounded && Math.abs(player.y - rack.baseY - rack.height) < 1e-6
        && player.x >= rack.minX - .25 && player.x <= rack.maxX + .25
        && player.z >= rack.minZ - .25 && player.z <= rack.maxZ + .25), `rack reached from ${JSON.stringify(origin)} at ${elapsed}`);
    }
  }
});

test('jumping from the loft onto its railing then towards the pistol rack cannot reach a safe ledge', () => {
  const pistol = ARMORY.find(crate => crate.weapon === 'pistol'), rack = armoryRackBounds(pistol);
  for (const delta of [.1, 1 / 30]) {
    const { simulation, player } = fixture();
    Object.assign(player, { x: .9, y: LOFT.y, z: 5.3, grounded: true, vy: 0 });
    let launchedFromRail = false, railPose;
    const corner = { x: rack.maxX + .2, z: rack.minZ - .23 };
    for (let index = 0; index < Math.ceil(4 / delta); index++) {
      simulation.time += delta;
      const launch = !launchedFromRail && index > 1 && player.grounded
        && Math.abs(player.y - LOFT.y - LOFT_RAIL.height) < 1e-6;
      if (launch) { launchedFromRail = true; railPose = { x: player.x, y: player.y, z: player.z }; }
      const forward = launchedFromRail ? Number(Math.hypot(player.x - corner.x, player.z - corner.z) > .055) : Number(player.x > .5);
      simulation.setInput(player.id, { forward, strafe: 0, sprint: true, pitch: 0,
        yaw: launchedFromRail ? Math.atan2(player.x - corner.x, player.z - corner.z) : Math.PI / 2,
        jump: index === 0 || launch });
      simulation.movePlayer(player, delta);
      assert.ok(!(player.grounded && Math.abs(player.y - rack.baseY - rack.height) < 1e-6
        && player.x >= rack.minX - .25 && player.x <= rack.maxX + .25
        && player.z >= rack.minZ - .25 && player.z <= rack.maxZ + .25), `rack reached via railing at ${delta} s ticks`);
    }
    assert.equal(launchedFromRail, true, 'Exercise both jumps, including a real landing on the railing');
    assert.ok(railPose.x <= .5);
    assert.equal(player.y, 0);
    assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
  }
});

test('every rack still has a separate purchase approach when the umbrella needs repair', () => {
  for (const crate of ARMORY) {
    const { simulation, player } = fixture();
    simulation.wave = crate.unlockWave; player.umbrella.remaining = 12; player.points = crate.price;
    if (crate.weapon === 'pistol') {
      assert.equal(simulation.dropWeapon(player.id), true);
      simulation.finishWave(); simulation.time += 1; simulation.wave++;
    }
    const normal = { x: Math.sin(crate.facing), z: Math.cos(crate.facing) };
    const tangent = { x: Math.cos(crate.facing), z: -Math.sin(crate.facing) };
    const positions = [.6, .75, .9, 1.1].flatMap(inset => [0, .4, -.4, .8, -.8, 1.1, -1.1].map(side => ({
      x: crate.x + normal.x * inset + tangent.x * side, y: crate.y,
      z: crate.z + normal.z * inset + tangent.z * side,
    })));
    const approach = positions.find(position => {
      Object.assign(player, position);
      if (!simulation.canOccupy(player, player.x, player.z, player.y, .25) || simulation.expeditionAction(player.id)) return false;
      const targets = ARMORY.filter(target => Math.hypot(player.x - target.x, player.z - target.z) < ARMORY_REACH
        && Math.abs(player.y - target.y) < ARMORY_HEIGHT_REACH);
      return targets.length === 1 && targets[0].id === crate.id
        && simulation.interactionVisible(player, crate, `rack-${crate.id}`);
    });
    assert.ok(approach, crate.id); Object.assign(player, approach);
    assert.equal(simulation.interact(player.id), true, crate.id);
    assert.ok(player.inventory[crate.weapon], crate.id);
    assert.equal(player.points, 0, `${crate.id}: purchase, not free umbrella repair`);
    assert.equal(player.umbrella.remaining, 12, crate.id);
  }
  const { simulation, player } = fixture();
  Object.assign(player, { x: GENERATOR.x + 1.3, y: GENERATOR.y, z: GENERATOR.z });
  player.umbrella.remaining = 12; player.points = 29;
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
  assert.equal(simulation.expeditionAction(player.id), 'repair-umbrella');
  assert.equal(simulation.interact(player.id), true);
  assert.equal(player.umbrella.remaining, 100); assert.equal(player.points, 29);
});

test('the south pistol rack preserves the route from generator around the sofa to the Gatling', () => {
  const { simulation, player } = fixture();
  const pistol = ARMORY.find(crate => crate.weapon === 'pistol');
  Object.assign(player, { x: GENERATOR.x + 1.3, y: 0, z: GENERATOR.z, grounded: true, vy: 0 });
  for (const target of [
    { x: player.x, z: GENERATOR.z + 1.1 }, { x: -6.8, z: GENERATOR.z + 1.1 },
    { x: -6.8, z: 4.6 }, { x: -7.15, z: 5.15 },
    { x: -6.8, z: 4.6 }, { x: pistol.x, z: pistol.z - 1.2 },
  ]) {
    let steps = 0;
    while (Math.hypot(player.x - target.x, player.z - target.z) > .08 && steps++ < 300) {
      simulation.time += 1 / 30;
      simulation.setInput(player.id, { forward: 1, strafe: 0,
        yaw: Math.atan2(player.x - target.x, player.z - target.z), pitch: 0 });
      simulation.movePlayer(player, 1 / 30);
      assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
    }
    assert.ok(steps < 300, `blocked route to ${JSON.stringify(target)}`);
    assert.equal(player.y, 0);
  }
});
