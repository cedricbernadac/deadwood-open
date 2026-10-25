import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WORLD as LAN_WORLD } from '../simulation.mjs';
import { PARTITION_CAPS, partitionCapSupport } from '../public/layout.js';
import { WEAPON_MOVEMENT, EXTERIOR } from '../public/rules.js';
import { playerHeight } from '../public/movement.js';
import { stairCeiling } from '../public/stairs.js';
import { WORLD, movementMethods, createPhysicsContext, clonePredictedPlayer,
  applyPredictedInput, stepPredictedPlayer, predictMovement } from '../public/online/physics.js';

const DT = 1 / 30;
const input = changes => ({ forward: 0, strafe: 0, yaw: 0, pitch: .17, ...changes });
const rawSnapshot = room => ({ time: room.time, phase: room.phase, paused: room.paused,
  players: [...room.players.values()], zombies: [...room.zombies.values()], doors: room.doors });
function fixture(position = {}, { zombies = [], inventory, practice = true } = {}) {
  const room = new RoomSimulation('ONLINE', { practice, random: () => .5 });
  const player = room.addPlayer('a');
  room.phase = 'wave'; room.zombies.clear();
  Object.assign(player, { x: -2.8, y: 0, z: 1.7, grounded: true, vy: 0, ...position });
  if (inventory) player.inventory = Object.fromEntries(inventory.map(id => [id, { ammo: 1, reserve: 2 }]));
  for (const zombie of zombies) room.zombies.set(zombie.id, { hp: 100, kind: 'walker', y: 0, scale: 1, ...zombie });
  const predicted = clonePredictedPlayer(player), context = createPhysicsContext(rawSnapshot(room));
  let sample = 0;
  const step = (command = input(), dt = DT) => {
    if (command) room.setInput(player.id, command);
    if (!room.paused) { room.time += Math.min(.1, dt); room.movePlayer(player, dt); }
    stepPredictedPlayer(predicted, command, dt, context); sample++;
    for (const key of ['x', 'y', 'z', 'yaw', 'pitch', 'vy', 'lastInputAt', 'partitionSlideLeft', 'motionX', 'motionZ'])
      assert.ok(Math.abs((predicted[key] ?? 0) - (player[key] ?? 0)) < 1e-11, `sample ${sample} ${key}: ${predicted[key]} vs ${player[key]}`);
    for (const key of ['grounded', 'crouched', 'jumpHeld', 'jumpRequested', 'fallStartY', 'input'])
      assert.deepEqual(predicted[key], player[key], `sample ${sample} ${key}`);
    assert.equal(context.time, room.time);
  };
  return { room, player, predicted, context, step };
}

test('online movement kernel is mechanically identical to preserved LAN methods', () => {
  assert.deepEqual(WORLD, LAN_WORLD);
  for (const [name, method] of Object.entries(movementMethods))
    assert.equal(method.toString(), RoomSimulation.prototype[name].toString(), name);
});
test('pure prediction preserves original snapshot and health, armor, money, ammo and umbrella', () => {
  const { room, player } = fixture();
  const snapshot = structuredClone(rawSnapshot(room)), before = structuredClone(snapshot), original = structuredClone(player);
  const next = predictMovement(player, input({ forward: 1, sprint: true }), DT, snapshot);
  assert.notEqual(next.z, player.z); assert.deepEqual(snapshot, before); assert.deepEqual(player, original);
  for (const key of ['hp', 'armor', 'inventory', 'umbrella', 'points', 'score', 'grenades']) assert.deepEqual(next[key], original[key]);
});
test('prediction preserves separate duplicate slots and their backpack weight without mutating authoritative stocks', () => {
  const weapons = [
    { id: 'pistol', weapon: 'pistol', ammo: 2, reserve: 3 },
    { id: 'pistol#2', weapon: 'pistol', ammo: 7, reserve: 11 },
    { id: 'pistol#3', weapon: 'pistol', ammo: 1, reserve: 13 },
  ];
  const source = { weapon: 'pistol', weaponId: 'pistol#2', backpack: true, ownedWeapons: ['pistol', 'pistol', 'pistol'], weapons };
  const predicted = clonePredictedPlayer(source);
  assert.deepEqual(Object.keys(predicted.inventory), ['pistol', 'pistol#2', 'pistol#3']);
  assert.equal(predicted.weaponId, 'pistol#2');
  assert.equal(movementMethods.backpackMovementMultiplier(predicted), .9, 'three copies count as three carried weapons');
  assert.deepEqual([predicted.inventory.pistol.ammo, predicted.inventory['pistol#2'].ammo], [2, 7]);
  predicted.inventory['pistol#2'].ammo = 0;
  assert.equal(predicted.inventory.pistol.ammo, 2); assert.equal(weapons[1].ammo, 7);
  const authoritative = { ...source, inventory: { pistol: { ammo: 4, reserve: 8 }, 'pistol#2': { ammo: 6, reserve: 10 } } };
  const direct = clonePredictedPlayer(authoritative);
  assert.deepEqual(Object.keys(direct.inventory), ['pistol', 'pistol#2'], 'actual inventory takes precedence over legacy and snapshot fields');
  direct.inventory['pistol#2'].reserve = 0;
  assert.equal(authoritative.inventory['pistol#2'].reserve, 10);
});
test('a mezzanine fall predicts its pose but only the authority applies damage', () => {
  const { room, player, predicted, context } = fixture({ x: -.3, y: 3.4, z: .8, vy: 0, grounded: false }, { practice: false });
  for (let tick = 0; tick < 80 && !player.grounded; tick++) {
    const command = input(); room.setInput('a', command); room.time += DT; room.movePlayer(player, DT);
    stepPredictedPlayer(predicted, command, DT, context);
    assert.equal(predicted.y, player.y); assert.equal(predicted.vy, player.vy);
  }
  assert.equal(player.grounded, true); assert.ok(player.hp < 100); assert.equal(predicted.hp, 100);
});
for (const dt of [DT, .1]) {
  test(`parity stair ascent, upper landing and descent dt=${dt}`, () => {
    const { player, step } = fixture({ x: 3.8, z: 2.9 });
    for (let tick = 0; tick < Math.ceil(3 / dt) && player.z > -2.4; tick++) step(input({ forward: 1, sprint: true }), dt);
    assert.equal(player.y, 3.4);
    for (let tick = 0; tick < Math.ceil(3 / dt) && player.z < 2.9; tick++) step(input({ forward: -1, sprint: true }), dt);
    assert.equal(player.y, 0); assert.equal(player.grounded, true);
  });
  for (const [crouch, z] of [[false, -.6], [true, .45]]) for (const direction of [-1, 1])
    test(`parity real underpass crouch=${crouch} direction=${direction} dt=${dt}`, () => {
      const { player, step } = fixture({ x: direction > 0 ? 2.3 : 5.3, z });
      let ticks = 0;
      while ((direction > 0 ? player.x < 5.3 : player.x > 2.3) && ticks++ < 200) {
        step(input({ strafe: direction, crouch }), dt); assert.equal(player.y, 0);
        assert.ok(playerHeight(player) <= stairCeiling(player.x, player.z, 0) + 1e-6);
      }
      assert.ok(ticks < 200);
    });
}
test('diagonal stairwell entrance retains one shared height allowance', () => {
  for (const side of [-1, 1]) {
    const { player, step } = fixture({ x: side < 0 ? 2.4 : 5.2, y: 3.4, z: -2 });
    const yaw = side * 3 * Math.PI / 4;
    for (let tick = 0; tick < 4; tick++) step(input({ forward: 1, sprint: true, yaw }));
    assert.equal(player.y, 3.4); step(input({ forward: 1, sprint: true, yaw }));
    assert.ok(player.y > 3.16); assert.equal(player.grounded, false);
    for (let tick = 0; tick < 30; tick++) step(input({ yaw })); assert.equal(player.y, 2.975);
  }
});
test('head clearance, held jump and releasing crouch match the real stair wood', () => {
  const { player, step } = fixture({ x: 3.8, y: 0, z: .45, crouched: true });
  for (let tick = 0; tick < 50; tick++) step(input({ jump: tick < 20, crouch: true }));
  assert.equal(player.y, 0); step(input()); assert.equal(player.crouched, true);
  for (let tick = 0; tick < 45; tick++) step(input({ strafe: 1 }));
  assert.equal(player.crouched, false); assert.ok(player.x > 5.1);
});
test('side stair exits, partition cap slide and jumping the loft rail retain LAN physics', () => {
  for (const side of [-1, 1]) {
    const path = fixture({ x: 3.8, z: 2.9 });
    for (let tick = 0; tick < 50 && path.player.z > -.4; tick++) path.step(input({ forward: 1 }));
    assert.ok(path.player.y > 0);
    for (let tick = 0; tick < 50; tick++) path.step(input({ strafe: side }));
    for (let tick = 0; tick < 70; tick++) path.step(input({ strafe: side, forward: -1 }));
    for (let tick = 0; tick < 50; tick++) path.step(input()); assert.equal(path.player.y, 0);
  }
  const cap = PARTITION_CAPS[0], path = fixture({ x: 0, z: -2, y: partitionCapSupport(cap, 0, -2, .25), vy: 0 });
  for (let tick = 0; tick < 50; tick++) path.step(input({ forward: 1, sprint: true }));
  assert.equal(path.player.y, 0); assert.ok(path.player.z > cap.maxZ + .25, 'the feet clear the narrow cap before returning against the wall');
  const loft = fixture({ x: .9, y: 3.4, z: -3.6 });
  for (let tick = 0; tick < 15; tick++) loft.step(input({ strafe: -1 })); assert.equal(loft.player.y, 3.4);
  for (let tick = 0; tick < 50; tick++) loft.step(input({ strafe: -1, jump: tick === 0 })); assert.equal(loft.player.y, 0);
});
test('ordinary interior walls and furnishing stay solid in both engines', () => {
  for (const position of [{ x: 0, z: -1.2 }, { x: -4.6, z: 2 }, { x: -2.8, z: -.4 }, { x: 6.2, z: -4.8 }]) {
    const { player, step } = fixture(position);
    for (let tick = 0; tick < 75; tick++) step(input({ forward: tick < 35 ? 1 : -1, strafe: tick % 3 ? .3 : -.4, sprint: true }));
    assert.ok(Number.isFinite(player.y));
  }
});
for (const id of ['north', 'south', 'west', 'east']) for (const sealed of [false, true])
  test(`parity ${id} entrance ${sealed ? 'wood wall' : 'open'} and omitted snapshot orientation`, () => {
    const positions = { north: { x: 0, z: -5.1, yaw: 0 }, south: { x: 0, z: 5.1, yaw: Math.PI },
      west: { x: -7.1, z: 0, yaw: Math.PI / 2 }, east: { x: 7.1, z: 0, yaw: -Math.PI / 2 } };
    const { room, player, context, step } = fixture(positions[id]);
    const door = room.doors.find(item => item.id === id); door.boards.fill(0); door.sealed = sealed;
    const received = room.snapshot(); assert.equal(received.doors.find(item => item.id === id).outZ, undefined);
    const reconstructed = createPhysicsContext(received).doors.find(item => item.id === id);
    assert.equal(reconstructed.outX, door.outX); assert.equal(reconstructed.outZ, door.outZ);
    context.doors = createPhysicsContext(received).doors;
    for (let tick = 0; tick < 45; tick++) step(input({ forward: 1, yaw: positions[id].yaw }));
    assert.equal(Math.abs(player.x) > 8 || Math.abs(player.z) > 6, !sealed);
  });
test('plank heights and crouch gaps retain exact occupancy parity', () => {
  const { room, player, context } = fixture();
  for (const door of room.doors) {
    door.sealed = false;
    for (let pattern = 0; pattern < 16; pattern++) {
      door.boards = door.boards.map((_, index) => pattern & (1 << index) ? 0 : 100);
      context.doors = createPhysicsContext(rawSnapshot(room)).doors;
      for (const crouched of [false, true]) for (const y of [0, .4, 1.1, 1.8, 2.9]) {
        player.crouched = crouched;
        assert.equal(context.canOccupy(player, door.x, door.z, y, .25), room.canOccupy(player, door.x, door.z, y, .25));
      }
    }
  }
});
test('crowd approach blocks and overlap escape works for walkers, crawlers and scaled brutes', () => {
  for (const zombie of [{ id: 'z', x: -2.8, z: .7 }, { id: 'z', x: -2.8, z: .7, kind: 'crawler' },
    { id: 'z', x: -2.8, z: .7, kind: 'brute', scale: 1.2 }]) {
    const path = fixture({}, { zombies: [zombie] });
    for (let tick = 0; tick < 45; tick++) path.step(input({ forward: 1 })); assert.ok(path.player.z > .7);
    const overlap = fixture({ x: zombie.x, z: zombie.z + .1 }, { zombies: [zombie] });
    for (let tick = 0; tick < 30; tick++) overlap.step(input({ forward: -1 })); assert.ok(overlap.player.z > zombie.z + 2);
  }
  const dead = fixture({}, { zombies: [{ id: 'dead', x: -2.8, z: .7, hp: 0 }] });
  for (let tick = 0; tick < 15; tick++) dead.step(input({ forward: 1 })); assert.ok(dead.player.z < .7);
});
test('all weapon speeds, backpack tiers, sprint, crouch and umbrella match LAN mobility', () => {
  for (const weapon of Object.keys(WEAPON_MOVEMENT)) for (const count of [1, 2, 3, 4]) {
    const ids = [...new Set([weapon, 'pistol', 'rifle', 'shotgun', 'smg'])].slice(0, count);
    const path = fixture({ x: 15, y: 0, z: 15, weapon, backpack: true, umbrella: { open: true, remaining: 75 } }, { inventory: ids });
    assert.equal(path.context.playerMovementMultiplier(path.predicted), WEAPON_MOVEMENT[weapon] * (count === 3 ? .9 : count === 4 ? .85 : 1));
    for (const posture of [{}, { sprint: true }, { sprint: true, crouch: true }])
      for (let tick = 0; tick < 5; tick++) path.step(input({ forward: .7, strafe: .9, ...posture }));
  }
});
test('jump edge, diagonal normalization and stale command timeout match LAN', () => {
  const path = fixture({ x: 15, y: 0, z: 15 }), before = { ...path.player };
  path.step(input({ forward: 4, strafe: -4, yaw: 20, pitch: 4 }));
  assert.ok(Math.hypot(path.player.x - before.x, path.player.z - before.z) <= 3.5 * DT + 1e-8); assert.equal(path.player.pitch, 1.48);
  for (let tick = 0; tick < 80; tick++) path.step(input({ jump: true })); assert.equal(path.player.y, 0);
  path.step(input({ forward: 1, jump: false })); for (let tick = 0; tick < 30; tick++) path.step(null);
  const stopped = path.player.z; for (let tick = 0; tick < 20; tick++) path.step(null); assert.equal(path.player.z, stopped);
});
test('paused, frozen, dead and downed states retain authoritative movement', () => {
  for (const state of ['paused', 'extraction', 'victory', 'gameover', 'dead', 'downed']) {
    const path = fixture();
    if (state === 'paused') path.room.paused = path.context.paused = true;
    else if (['extraction', 'victory', 'gameover'].includes(state)) path.room.phase = path.context.phase = state;
    else if (state === 'dead') path.player.alive = path.predicted.alive = false;
    else path.player.downed = path.predicted.downed = true;
    const start = { x: path.player.x, y: path.player.y, z: path.player.z };
    for (let tick = 0; tick < 20; tick++) path.step(input({ forward: 1, sprint: true, jump: true }));
    assert.deepEqual({ x: path.player.x, y: path.player.y, z: path.player.z }, start);
  }
});
test('invalid input is refused, nonfinite delta rejected and world bounds clamp identically', () => {
  const path = fixture();
  for (const key of ['forward', 'strafe', 'yaw', 'pitch']) for (const bad of [NaN, Infinity, '1', undefined]) {
    const command = input({ [key]: bad }); assert.equal(applyPredictedInput(path.predicted, command, path.context), false); path.step(command);
  }
  for (const dt of [NaN, Infinity, -1]) assert.throws(() => stepPredictedPlayer(path.predicted, input(), dt, path.context), RangeError);
  path.player.x = path.predicted.x = EXTERIOR.bounds.maxX - .001; path.player.z = path.predicted.z = 15;
  path.step(input({ strafe: 1 }), .3); assert.equal(path.player.x, EXTERIOR.bounds.maxX);
});
