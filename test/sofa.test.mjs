import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WORLD } from '../simulation.mjs';
import { SOFA, coverPieces } from '../public/layout.js';
import { createPhysicsContext, clonePredictedPlayer, stepPredictedPlayer } from '../public/online/physics.js';

// The living-room sofa can be jumped onto from any side (owner, 13 October),
// identically on the LAN server and in the online movement kernel.
const DT = 1 / 30;
const pieceHeights = SOFA.parts.map(part => part.height);
const onSofa = player => player.grounded && pieceHeights.some(height => Math.abs(player.y - height) < 1e-9)
  && player.x > SOFA.minX - .25 && player.x < SOFA.maxX + .25 && player.z > SOFA.minZ - .25 && player.z < SOFA.maxZ + .25;

function fixture(position) {
  const room = new RoomSimulation('SOFA', { random: () => .5 });
  const player = room.addPlayer('a');
  room.start('a'); room.phase = 'intermission'; room.timeLeft = 1e9; room.zombies.clear();
  Object.assign(player, { y: 0, grounded: true, vy: 0, ...position });
  const predicted = clonePredictedPlayer(player);
  const context = createPhysicsContext({ time: room.time, phase: room.phase, paused: false, players: [...room.players.values()], zombies: [], doors: room.doors });
  const step = command => {
    room.setInput('a', command); room.time += DT; room.movePlayer(player, DT);
    stepPredictedPlayer(predicted, command, DT, context);
    for (const key of ['x', 'y', 'z', 'vy']) assert.ok(Math.abs(predicted[key] - player[key]) < 1e-9, `online ${key}: ${predicted[key]} vs ${player[key]}`);
    assert.equal(predicted.grounded, player.grounded);
  };
  return { room, player, step };
}

// Run at the sofa, jump once, stop pushing as soon as the feet rest on it.
function jumpAt(position, yaw, { jump = true, ticks = 45 } = {}) {
  const { player, step } = fixture(position);
  for (let tick = 0; tick < ticks; tick++) {
    const landed = tick > 2 && onSofa(player);
    step({ forward: landed ? 0 : 1, strafe: 0, yaw, pitch: 0, jump: jump && tick === 0, sprint: false, crouch: false });
  }
  return player;
}
const SIDES = {
  front: { place: d => ({ x: -4.6, z: SOFA.minZ - d }), yaw: Math.PI },
  back: { place: d => ({ x: -4.6, z: SOFA.maxZ + d }), yaw: 0 },
  west: { place: d => ({ x: SOFA.minX - d, z: 2.8 }), yaw: -Math.PI / 2 },
  east: { place: d => ({ x: SOFA.maxX + d, z: 2.8 }), yaw: Math.PI / 2 },
};

test('the sofa is a seat, two arms and a back, all within a jump, inside its unchanged footprint', () => {
  const sofa = WORLD.covers.find(cover => cover.id === 'sofa');
  assert.equal(sofa, SOFA);
  assert.deepEqual([sofa.minX, sofa.maxX, sofa.minZ, sofa.maxZ], [-6, -3.2, 2.4, 3.5], 'zombies still walk around the same footprint');
  assert.deepEqual(SOFA.parts.map(part => [part.part, part.height]), [['seat', .48], ['back', .8], ['arm-west', .72], ['arm-east', .72]]);
  const apex = 5.6 ** 2 / (2 * 18);
  for (const part of coverPieces(SOFA)) {
    assert.ok(part.height < apex - .04, `${part.part} is within a jump`);
    assert.ok(part.minX >= SOFA.minX && part.maxX <= SOFA.maxX && part.minZ >= SOFA.minZ && part.maxZ <= SOFA.maxZ);
  }
});

for (const [side, { place, yaw }] of Object.entries(SIDES)) {
  test(`a jump from the ${side} side lands on the sofa (LAN and online alike)`, () => {
    const landed = [.6, .8, 1, 1.2, 1.4, 1.6].filter(distance => onSofa(jumpAt(place(distance), yaw)));
    assert.ok(landed.length >= 2, `${side}: landed from ${landed.join(', ')} m`);
  });
}

test('walking into the sofa without a jump stays on the floor', () => {
  for (const [side, { place, yaw }] of Object.entries(SIDES)) {
    const player = jumpAt(place(.8), yaw, { jump: false, ticks: 40 });
    assert.equal(player.y, 0, side);
  }
});

test('from the seat an arm is a step and the back a small jump', () => {
  const walk = (position, yaw) => {
    const { player, step } = fixture(position);
    let highest = 0;
    for (let tick = 0; tick < 12; tick++) {
      step({ forward: 1, strafe: 0, yaw, pitch: 0, jump: false, sprint: false, crouch: false });
      if (player.grounded) highest = Math.max(highest, player.y);
    }
    return highest;
  };
  assert.equal(walk({ x: -4, z: 2.8, y: .48 }, -Math.PI / 2), .72, 'east arm: one step up');
  assert.equal(walk({ x: -4.6, z: 2.8, y: .48 }, Math.PI), .48, 'the back is too high to step onto');
  const back = fixture({ x: -4.6, z: 2.95, y: .48 });
  let highest = 0;
  for (let tick = 0; tick < 30; tick++) {
    back.step({ forward: back.player.z < 3.3 ? 1 : 0, strafe: 0, yaw: Math.PI, pitch: 0, jump: tick === 0, sprint: false, crouch: false }); // let go once above it
    if (back.player.grounded) highest = Math.max(highest, back.player.y);
  }
  assert.equal(highest, .8, 'a small jump reaches the back');
});

test('bullets meet the real sofa pieces', () => {
  const room = new RoomSimulation('SOFA2', { random: () => .5 });
  const player = room.addPlayer('a'); room.start('a'); room.phase = 'wave'; room.zombies.clear();
  // Over the seat, a survivor at seat height sees across the lower sofa.
  Object.assign(player, { x: -4.6, y: 0, z: 1.2 });
  const over = { x: -4.6, y: .9, z: 4.5 }, through = { x: -4.6, y: .4, z: 4.5 };
  assert.equal(room.raiderLineClear({ x: -4.6, y: .9, z: 1.2 }, over), true, 'over the 0.8 m back (the old 1 m block stopped it)');
  assert.equal(room.raiderLineClear({ x: -4.6, y: .4, z: 1.2 }, through), false, 'into the seat and back');
});

test('no safe perch: zombies still reach a survivor standing on any part of the sofa', () => {
  for (const [part, position] of [['seat', { x: -4.6, z: 2.8 }], ['back', { x: -4.6, z: 3.35 }], ['arm-west', { x: -5.85, z: 2.8 }], ['arm-east', { x: -3.35, z: 2.8 }]]) {
    const room = new RoomSimulation('PERCH', { random: () => .5 });
    const player = room.addPlayer('a');
    room.start('a'); room.phase = 'wave'; room.toSpawn = 0; room.spawnTimer = 1e9; room.zombies.clear();
    const height = SOFA.parts.find(piece => piece.part === part).height;
    Object.assign(player, position, { y: height, grounded: true, vy: 0 });
    for (const [index, spot] of [{ x: -4.6, z: 1.4 }, { x: -4.6, z: 4.6 }, { x: -7, z: 2.9 }].entries()) {
      const zombie = room.spawnZombie();
      Object.assign(zombie, { y: 0, entered: true, speed: 1.4, ...spot, id: zombie.id ?? `z${index}` });
    }
    for (let tick = 0; tick < 30 * 8 && player.hp === 100; tick++) {
      room.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      room.tick(DT);
    }
    assert.ok(player.hp < 100, `${part}: a zombie reached the survivor`);
  }
});

// Review of 13 October: every zombie reaches a survivor anywhere on the sofa
// or in the middle of the table, the boss and brutes included.
function reached(spot, kind, from) {
  const room = new RoomSimulation('REACH', { random: () => .5 });
  const player = room.addPlayer('a');
  room.start('a'); room.phase = 'wave'; room.toSpawn = 0; room.spawnTimer = 1e9; room.zombies.clear(); room.timeLeft = 1e9;
  Object.assign(player, spot, { grounded: true, vy: 0 });
  const zombie = room.spawnZombie();
  const body = kind === 'boss' ? { kind: 'brute', scale: 1.32, boss: true } : kind === 'brute' ? { kind: 'brute', scale: 1.22 } : { kind, scale: 1 };
  Object.assign(zombie, { y: 0, entered: true, speed: 1.4, attackAfter: 0, ...body, ...from });
  room.zombies.clear(); room.zombies.set(zombie.id, zombie);
  for (let tick = 0; tick < 30 * 30 && player.hp === 100; tick++) { room.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0 }); room.tick(DT); }
  return player.hp < 100;
}
test('the boss, brutes, walkers and crawlers reach a survivor in the middle of the table or leaning on the sofa back', () => {
  for (const [label, spot, from] of [
    ['table centre', { x: -.9, y: .8, z: -.4 }, { x: -.9, z: -3 }],
    ['leaning on the sofa back', { x: -4.6, y: .48, z: 2.93 }, { x: -4.6, z: -1.5 }],
    ['front edge of the sofa back', { x: -4.6, y: .8, z: 2.96 }, { x: -4.6, z: 5 }],
    ['on the sofa back', { x: -4.6, y: .8, z: 3.35 }, { x: -4.6, z: 5 }],
  ]) for (const kind of ['boss', 'brute', 'walker', 'crawler']) assert.ok(reached(spot, kind, from), `${kind}, ${label}`);
});

test('coins pulled off the sofa seat fall to the floor instead of floating', () => {
  const room = new RoomSimulation('COINS', { random: () => .5 });
  const player = room.addPlayer('a');
  room.start('a'); room.phase = 'wave'; room.zombies.clear();
  Object.assign(player, { x: -4.6, y: 0, z: 1.2 });
  room.pickups.set('c', { id: 'c', kind: 'points', amount: 100, x: -4.6, y: .48, z: 2.6, special: false, expiresAt: Infinity });
  for (let tick = 0; tick < 12; tick++) room.attractCoins(DT);
  const coin = room.pickups.get('c');
  assert.ok(coin.z < SOFA.minZ - .05, 'pulled off the seat');
  assert.equal(coin.y, 0);
});

test('coins on the stairs or the loft keep their height while pulled toward a survivor above them', () => {
  const room = new RoomSimulation('COINS2', { random: () => .5 });
  const player = room.addPlayer('a');
  room.start('a'); room.phase = 'wave'; room.zombies.clear();
  for (const [survivor, coin] of [
    [{ x: 3.8, y: 3.4, z: -2.9 }, { x: 3.8, y: 3.1875, z: -1.5 }], // loft landing, coin on tread 15
    [{ x: 5.1, y: 3.4, z: 0 }, { x: 2.6, y: 3.4, z: 0 }], // across the stair well opening
  ]) {
    room.pickups.clear();
    Object.assign(player, survivor, { grounded: true });
    room.pickups.set('c', { id: 'c', kind: 'points', amount: 50, ...coin, special: false, expiresAt: Infinity });
    const before = player.points;
    for (let tick = 0; tick < 20 && room.pickups.size; tick++) { room.attractCoins(DT); room.collectPickups(); }
    assert.equal(player.points, before + 50, JSON.stringify(coin));
  }
});
