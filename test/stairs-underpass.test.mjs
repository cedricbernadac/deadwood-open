import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import { ballisticDistance } from '../public/ballistics.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WORLD } from '../simulation.mjs';
import { STAIRS, STAIR_TREADS, stairTreadY, stairCeiling } from '../public/stairs.js';
import { playerHeight } from '../public/movement.js';

function fixture(position) {
  const events = [], simulation = new RoomSimulation('UNDER1', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  Object.assign(player, { x: 2.3, y: 0, z: -.6, grounded: true, vy: 0, ...position });
  const step = (input = {}, delta = 1 / 30) => {
    simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, ...input });
    simulation.tick(delta);
  };
  return { simulation, player, events, step };
}

test('the steeper staircase has sixteen shared solid treads and its lower landing ends at z2.5', () => {
  assert.equal(WORLD.stair, STAIRS);
  assert.equal(STAIRS.maxZ - STAIRS.minZ, 4.5);
  assert.equal(STAIR_TREADS.length, 16);
  assert.equal(STAIR_TREADS.at(-1).maxY, WORLD.loftY);
  for (const tread of STAIR_TREADS) {
    assert.ok(Math.abs(tread.maxY - tread.minY - .2) < 1e-12);
    assert.equal(stairTreadY((tread.minZ + tread.maxZ) / 2), tread.maxY);
  }
});

test('standing and crouching cross the real high underpass in both directions without climbing or falling', () => {
  for (const [crouch, z] of [[false, -.6], [true, .45]]) {
    for (const direction of [-1, 1]) {
      for (const delta of [1 / 30, .1]) {
        const { player, step } = fixture({ x: direction > 0 ? 2.3 : 5.3, z });
        let ticks = 0;
        while ((direction > 0 ? player.x < 5.3 : player.x > 2.3) && ticks++ < 200) {
          step({ strafe: direction, crouch }, delta);
          assert.equal(player.y, 0, 'An overhead tread must never attract the feet');
          assert.equal(player.grounded, true);
          assert.ok(player.y + playerHeight(player) <= stairCeiling(player.x, player.z, player.y) + 1e-6);
        }
        assert.ok(ticks < 200, `crouch=${crouch}, direction=${direction}, delta=${delta}, x=${player.x}`);
      }
    }
  }
});

test('a low section requires Ctrl, and the lowest section blocks even a crouched body', () => {
  const { player, step } = fixture({ z: .45 });
  for (let tick = 0; tick < 40; tick++) step({ strafe: 1 });
  assert.ok(player.x < STAIRS.minX - .25);
  assert.equal(player.y, 0);
  for (let tick = 0; tick < 50; tick++) step({ strafe: 1, crouch: true });
  assert.ok(player.x > STAIRS.maxX + .25);
  assert.equal(player.y, 0);
  const low = fixture({ z: 1.3 });
  for (let tick = 0; tick < 80; tick++) low.step({ strafe: 1, crouch: true });
  assert.ok(low.player.x < STAIRS.minX - .25);
  assert.equal(low.player.y, 0);
});

test('releasing Ctrl or losing fresh input cannot stand through an overhead tread or stringer', () => {
  const { simulation, player, step } = fixture({ x: 3.8, z: .45, crouched: true });
  step();
  assert.equal(player.crouched, true);
  simulation.time += .61; simulation.tick(1 / 30);
  assert.equal(player.crouched, true);
  for (let tick = 0; tick < 45 && player.x < 5.3; tick++) step({ strafe: 1 });
  assert.ok(player.x > 5.1);
  assert.equal(player.crouched, false, 'Standing returns after the head leaves the sloping wood');
  assert.equal(player.y, 0);
});

test('a crouched jump under a tread hits its exact underside and returns to the ground floor', () => {
  const { player, step } = fixture({ x: 3.8, z: .45, crouched: true });
  const limit = stairCeiling(player.x, player.z, 0) - playerHeight(player);
  let highest = 0;
  for (let tick = 0; tick < 50; tick++) {
    step({ crouch: true, jump: tick === 0 });
    highest = Math.max(highest, player.y);
    assert.ok(player.y <= limit + 1e-6);
  }
  assert.ok(highest > 0 && Math.abs(highest - limit) < 1e-6);
  assert.equal(player.y, 0);
  assert.equal(player.grounded, true);
});

test('the shortened stairwell retains solid loft floor over its former lower section', () => {
  const { player, step } = fixture({ x: 5.1, z: 3.3, y: WORLD.loftY });
  for (let tick = 0; tick < 14; tick++) {
    step({ strafe: -1 });
    assert.equal(player.y, WORLD.loftY);
    assert.equal(player.grounded, true);
  }
  assert.ok(player.x < STAIRS.maxX && player.x > STAIRS.minX);
});

test('bullets can travel through the clear underpass but stop in the visible overhead treads', () => {
  const clear = fixture({ x: 2.3, z: .45, crouched: true });
  clear.simulation.phase = 'wave'; clear.simulation.wave = 1;
  clear.simulation.zombies.set('target', { id: 'target', x: 5.2, y: 0, z: .45, hp: 1000, maxHp: 1000, kind: 'walker' });
  clear.simulation.setInput('a', { forward: 0, strafe: 0, crouch: true, yaw: -Math.PI / 2, pitch: 0 });
  assert.equal(clear.simulation.shoot('a'), true);
  settleBallisticFlight(clear.simulation);
  assert.ok(clear.simulation.zombies.get('target').hp < 1000);
  const overhead = fixture({ x: 3.8, z: .45, crouched: true });
  overhead.simulation.phase = 'wave'; overhead.simulation.wave = 1;
  overhead.simulation.setInput('a', { forward: 0, strafe: 0, crouch: true, yaw: 0, pitch: 1.3 });
  assert.equal(overhead.simulation.shoot('a'), true);
  settleBallisticFlight(overhead.simulation);
  const shot = overhead.events.find(event => event.event === 'shot');
  const impact = overhead.events.find(event => event.event === 'bullet-impact');
  assert.equal(impact.stop, 'solid');
  assert.ok(ballisticDistance(shot.projectiles[0], impact.age) < 2);
});
