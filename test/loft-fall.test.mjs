import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WORLD } from '../simulation.mjs';
import { LOFT_RAIL, FALL_DAMAGE, fallDamage } from '../public/movement.js';
import { EXTERIOR } from '../public/rules.js';
import { completeRevive } from './helpers/revive.mjs';

function fixture(position = {}) {
  const events = [];
  const simulation = new RoomSimulation('FALL01', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.start(player.id);
  Object.assign(player, { x: WORLD.loft.minX + .8, y: WORLD.loftY, z: -3.6, ...position });
  const step = (input = {}, delta = 1 / 30) => {
    simulation.time += delta;
    simulation.setInput(player.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0, ...input });
    simulation.movePlayer(player, delta);
  };
  return { simulation, player, events, step };
}

function jumpOff(fixture, delta = 1 / 30) {
  const { player, step } = fixture;
  for (let i = 0; i < Math.ceil(2.4 / delta); i++) {
    step({ strafe: player.x > WORLD.loft.minX - .65 ? -1 : 0, jump: i === 0 }, delta);
  }
}

test('fall damage has a forgiving threshold and grows with the lost platform height', () => {
  assert.equal(FALL_DAMAGE.safeDrop, 2.4);
  assert.equal(fallDamage(0), 0);
  assert.equal(fallDamage(2.4), 0);
  assert.equal(fallDamage(WORLD.loftY), 15);
  assert.equal(fallDamage(WORLD.loftY + 1), 30);
  for (const value of [NaN, Infinity, -Infinity, undefined]) assert.equal(fallDamage(value), 0);
});

test('the normal jump crosses the visible low loft rail at its north and south ends and hurts only upon landing', () => {
  for (const z of [-3.6, 4.5]) for (const delta of [1 / 30, .1]) {
    const state = fixture({ z });
    const { player, events, step } = state;
    let crossed = false, sawFall = false;
    for (let i = 0; i < Math.ceil(2.4 / delta); i++) {
      const oldHp = player.hp;
      step({ strafe: player.x > WORLD.loft.minX - .65 ? -1 : 0, jump: i === 0 }, delta);
      if (player.x < WORLD.loft.minX - .3 && player.y > WORLD.loftY) crossed = true;
      if (!player.grounded && player.y < WORLD.loftY) sawFall = true;
      if (!player.grounded) assert.equal(player.hp, oldHp, 'there is no damage in flight');
    }
    assert.ok(crossed, `z ${z}, dt ${delta}: the jump actually clears the rail`);
    assert.ok(sawFall, 'the player falls through the open living-room side');
    assert.equal(player.y, 0);
    assert.equal(player.grounded, true);
    assert.equal(player.hp, 85);
    assert.equal(player.fallStartY, null);
    const hits = events.filter(event => event.event === 'hit');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].source, 'fall');
    assert.equal(hits[0].damage, 15);
    for (let i = 0; i < 30; i++) step({}, delta);
    assert.equal(player.hp, 85, 'grounded ticks cannot charge the fall twice');
  }
});

test('walking stays behind the finite guardrail and an ordinary jump can land on its visible top', () => {
  const { simulation, player, step } = fixture({ x: WORLD.loft.minX + .4 });
  for (let i = 0; i < 60; i++) step({ strafe: -1 });
  assert.ok(player.x >= WORLD.loft.minX + LOFT_RAIL.thickness / 2 + .25 - 1e-8);
  assert.equal(player.y, WORLD.loftY);
  assert.equal(player.hp, 100);
  Object.assign(player, { x: WORLD.loft.minX, y: WORLD.loftY + LOFT_RAIL.height + .1, grounded: false, vy: -1, fallStartY: WORLD.loftY });
  for (let i = 0; i < 30; i++) step();
  assert.equal(player.y, WORLD.loftY + LOFT_RAIL.height);
  assert.equal(player.grounded, true);
  assert.equal(player.hp, 100);
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true);
});

test('every weapon weight can clear both open loft ends without a special jump impulse', () => {
  for (const weapon of ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'magnum']) {
    for (const z of [-3.6, 4.5]) for (const delta of [1 / 30, .1]) {
      const state = fixture({ z, weapon });
      jumpOff(state, delta);
      assert.ok(state.player.x < WORLD.loft.minX - .3, `${weapon} at z ${z}, dt ${delta}`);
      assert.equal(state.player.y, 0);
      assert.equal(state.player.grounded, true);
      // A slower weapon can briefly land on the rail first. The subsequent
      // fall then starts on its real, 72 cm higher support instead of the loft.
      assert.ok(state.player.hp >= 74 && state.player.hp <= 85);
      assert.equal(state.events.filter(event => event.event === 'hit').length, 1);
    }
  }
});

test('ground jumps, loft jumps in place and ordinary stairs remain harmless', () => {
  for (const position of [{ x: -1, z: 3.8, y: 0 }, { x: 1.5, z: 4, y: WORLD.loftY }]) {
    const { player, step } = fixture(position);
    for (let i = 0; i < 60; i++) step({ jump: i === 0 });
    assert.equal(player.y, position.y);
    assert.equal(player.hp, 100);
  }
  const { player, step } = fixture({ x: 3.8, z: WORLD.stair.maxZ + .6, y: 0 });
  for (let i = 0; i < 63; i++) step({ forward: 1 });
  assert.equal(player.y, WORLD.loftY);
  for (let i = 0; i < 63; i++) step({ forward: -1 });
  assert.equal(player.y, 0);
  assert.equal(player.hp, 100);
});

test('fall damage ignores client-supplied height and damage fields and preserves exterior walls', () => {
  const { simulation, player, step } = fixture({ x: 7.3, z: 0 });
  for (let i = 0; i < 45; i++) step({ strafe: 1, jump: i === 0, y: 999, vy: -999, fallStartY: 999, fallDamage: 999 });
  assert.ok(player.x < 8);
  assert.equal(player.y, WORLD.loftY);
  assert.equal(player.hp, 100);
  Object.assign(player, { x: EXTERIOR.bounds.maxX, y: 0, z: 2, grounded: true, vy: 0 });
  for (let i = 0; i < 30; i++) step({ strafe: 1, jump: i === 0 });
  assert.equal(player.x, EXTERIOR.bounds.maxX);
  assert.equal(player.hp, 100);
  assert.equal(simulation.snapshot().players[0].hp, 100);
});

test('a lethal landing downs once, then revival and a new round never reuse its damage', () => {
  const state = fixture({ hp: 10 });
  const { simulation, player, events, step } = state;
  const helper = simulation.addPlayer('b');
  jumpOff(state);
  assert.equal(player.y, 0);
  assert.equal(player.hp, 0);
  assert.equal(player.downed, true);
  assert.equal(events.filter(event => event.event === 'hit').length, 1);
  assert.equal(events.filter(event => event.event === 'down').length, 1);
  for (let i = 0; i < 30; i++) step();
  assert.equal(events.filter(event => event.event === 'hit').length, 1);
  Object.assign(helper, { x: player.x, z: player.z + .6, y: 0 });
  assert.equal(completeRevive(simulation, helper.id), true);
  assert.equal(player.hp, 55);
  for (let i = 0; i < 30; i++) step();
  assert.equal(player.hp, 55);
  simulation.endGame();
  player.fallStartY = 10;
  assert.equal(simulation.start(player.id), true);
  assert.equal(player.fallStartY, null);
  for (let i = 0; i < 30; i++) step();
  assert.equal(player.hp, 100);
});

test('an already downed falling body settles without taking another hit and dead bodies remain fixed', () => {
  const { simulation, player, events, step } = fixture({ x: -.3, y: WORLD.loftY, grounded: false, downed: true, hp: 0, fallStartY: WORLD.loftY });
  for (let i = 0; i < 60; i++) step();
  assert.equal(player.y, 0);
  assert.equal(player.grounded, true);
  assert.equal(player.fallStartY, null);
  assert.equal(events.filter(event => event.event === 'hit' || event.event === 'down').length, 0);
  Object.assign(player, { y: WORLD.loftY, alive: false, grounded: false, vy: -1 });
  for (let i = 0; i < 60; i++) step();
  assert.equal(player.y, WORLD.loftY);
  assert.equal(simulation.snapshot().players[0].hp, 0);
});

test('preparation and frozen phases cannot deliver fall damage and in-flight snapshots keep full health', () => {
  const state = fixture({ x: -.3, grounded: false });
  const { simulation, player, events, step } = state;
  step();
  assert.equal(simulation.snapshot().players[0].hp, 100);
  assert.ok(player.y > 0 && !player.grounded);
  simulation.phase = 'lobby';
  for (let i = 0; i < 60; i++) step();
  assert.equal(player.y, 0);
  assert.equal(player.hp, 100);
  assert.equal(player.fallStartY, null);
  assert.equal(events.filter(event => event.event === 'hit').length, 0);
  Object.assign(player, { y: WORLD.loftY, grounded: false, vy: -1, fallStartY: WORLD.loftY });
  for (const phase of ['extraction', 'victory', 'gameover']) {
    simulation.phase = phase;
    step();
    assert.equal(player.y, WORLD.loftY);
    assert.equal(player.hp, 100);
  }
});
