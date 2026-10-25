import test from 'node:test';
import assert from 'node:assert/strict';
import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import { ballisticDistance } from '../public/ballistics.js';
import { BARRICADE_BOARDS } from '../public/rules.js';
import { RoomSimulation, WEAPONS, MINIGUN_WINDUP, damageFalloff } from '../simulation.mjs';

const FULL = BARRICADE_BOARDS.map(board => board.maxHp);
const DOOR_HP = FULL.reduce((sum, hp) => sum + hp, 0);
const boardsWith = (index, hp) => FULL.map((full, other) => other === index ? hp : full);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
const closeBoards = (actual, expected) => actual.forEach((hp, index) => close(hp, expected[index]));
const damageAt = distance => WEAPONS.rifle.damage * damageFalloff(WEAPONS.rifle, distance);
const boardDamage = (player, door, index, retention = 1) => {
  const normalDistance = Math.abs((player.x - door.x) * door.outX + (player.z - door.z) * door.outZ);
  return damageAt((normalDistance - BARRICADE_BOARDS[index].depth / 2) / Math.cos(player.pitch)) * retention;
};

function room(weapon = 'rifle') {
  const events = [];
  const simulation = new RoomSimulation('BOARDS', { random: () => 0.5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  simulation.start('a');
  player.weapon = weapon;
  player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
  if (weapon === 'minigun') { assert.equal(simulation.setMinigunSpin(player.id, true), true); simulation.time += MINIGUN_WINDUP; }
  return { simulation, player, events };
}

function aimAtBoard(player, door, index, tangent = 0, height = BARRICADE_BOARDS[index].y) {
  const yaw = Math.atan2(-door.outX, -door.outZ);
  Object.assign(player, {
    x: door.x - door.outX * 2 + Math.cos(yaw) * tangent,
    y: 0, z: door.z - door.outZ * 2 - Math.sin(yaw) * tangent,
    yaw, pitch: Math.atan2(height - 1.55, 2),
  });
}

function target(simulation, id, options = {}) {
  const zombie = { id, x: 0, y: 0, z: -7, hp: 1000, maxHp: 1000, kind: 'walker', scale: 1, ...options };
  simulation.zombies.set(id, zombie);
  return zombie;
}

test('every board on every doorway absorbs accurately aimed bullets independently until it breaks', () => {
  for (const id of ['north', 'south', 'west', 'east']) {
    for (const board of BARRICADE_BOARDS) {
      const { simulation, player, events } = room();
      const door = simulation.doors.find(door => door.id === id);
      aimAtBoard(player, door, board.index);
      assert.equal(simulation.shoot(player.id), true);
      settleBallisticFlight(simulation);
      const damage = boardDamage(player, door, board.index);
      closeBoards(door.boards, boardsWith(board.index, board.maxHp - damage));
      close(door.hp, DOOR_HP - damage);
      simulation.time = Math.max(simulation.time, player.shotAfter);
      assert.equal(simulation.shoot(player.id), true);
      settleBallisticFlight(simulation);
      assert.deepEqual(door.boards, boardsWith(board.index, 0), `${id}, board ${board.index} after its second round`);
      assert.equal(player.inventory.rifle.ammo, 28);
      assert.equal(player.score, 0);
      assert.equal(player.points, 0);
      const broken = events.filter(event => event.event === 'board').at(-1);
      assert.equal(broken.id, player.id);
      assert.equal(broken.doorId, door.id);
      assert.equal(broken.boardIndex, board.index);
      assert.deepEqual(broken.boards, door.boards);
      assert.deepEqual(events.filter(event => event.event === 'bullet-impact').map(event => event.boardHits), [1, 1]);
    }
  }
});

test('reinforced planks take 2.5 times the punishment: three pistol rounds, two machine-gun rounds, one shell', () => {
  const expected = { pistol: 3, rifle: 2, shotgun: 1, smg: 3, minigun: 2, magnum: 1, assault: 2, sniper: 1 };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(WEAPONS).filter(name => !WEAPONS[name].explosive && !WEAPONS[name].fuel && !WEAPONS[name].melee).sort());
  assert.ok(FULL.every(hp => hp === 60), 'each plank holds 2.5 times the original 24 HP');
  for (const [weapon, rounds] of Object.entries(expected)) {
    const { simulation, player, events } = room(weapon);
    const door = simulation.doors[0];
    aimAtBoard(player, door, 2);
    let fired = 0;
    while (door.boards[2] > 0 && fired < 10) {
      simulation.time = Math.max(simulation.time, player.shotAfter);
      assert.equal(simulation.shoot(player.id), true, weapon);
      settleBallisticFlight(simulation);
      fired++;
      if (door.boards[2] > 0) assert.deepEqual(door.boards, boardsWith(2, door.boards[2]), `${weapon} only damages the aimed plank`);
    }
    assert.equal(fired, rounds, weapon);
    assert.deepEqual(door.boards, boardsWith(2, 0), weapon);
    assert.equal(player.inventory[weapon].ammo, WEAPONS[weapon].magazine - rounds);
    assert.ok(events.filter(event => event.event === 'board').length >= rounds, weapon);
  }
});

test('shots through the real gaps leave every board untouched on all four walls', () => {
  for (const id of ['north', 'south', 'west', 'east']) {
    const { simulation, player, events } = room();
    const door = simulation.doors.find(door => door.id === id);
    aimAtBoard(player, door, 2, 0, 1.55);
    simulation.shoot(player.id);
    settleBallisticFlight(simulation);
    assert.deepEqual(door.boards, FULL);
    assert.equal(events.filter(event => event.event === 'board').length, 0);
  }
});

test('oriented plank collisions preserve an angled visible gap that an enclosing AABB would block', () => {
  const gap = room();
  aimAtBoard(gap.player, gap.simulation.doors[0], 0, -1.2, 0.56);
  gap.simulation.shoot(gap.player.id);
  settleBallisticFlight(gap.simulation);
  assert.deepEqual(gap.simulation.doors[0].boards, FULL);
  const wood = room();
  aimAtBoard(wood.player, wood.simulation.doors[0], 0, 1.2, 0.56);
  wood.simulation.shoot(wood.player.id);
  settleBallisticFlight(wood.simulation);
  const contact = wood.events.find(event => event.event === 'bullet-impact');
  const projectile = wood.events.find(event => event.event === 'shot').projectiles[0];
  assert.equal(contact.stop, 'board');
  assert.ok(Math.abs(wood.simulation.doors[0].boards[0] - (FULL[0] - damageAt(ballisticDistance(projectile, contact.age)))) < .0001,
    'the physical contact age includes the tilted edge of the plank');
  assert.deepEqual(wood.simulation.doors[0].boards.slice(1), FULL.slice(1));
});

test('a plank stops every projectile until it breaks, then the exact opening allows zombie penetration', () => {
  const { simulation, player, events } = room();
  const door = simulation.doors[0];
  aimAtBoard(player, door, 2);
  const targets = [6.8, 7.8, 8.8].map((distance, index) => target(simulation, `z${index}`, { z: -distance }));
  for (let round = 0; round < 2; round++) {
    simulation.time = Math.max(simulation.time, player.shotAfter);
    simulation.shoot(player.id);
    settleBallisticFlight(simulation);
    assert.ok(targets.every(zombie => zombie.hp === 1000));
    assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie').length, 0);
  }
  assert.deepEqual(door.boards, boardsWith(2, 0));
  simulation.time = Math.max(simulation.time, player.shotAfter);
  simulation.shoot(player.id);
  settleBallisticFlight(simulation);
  targets.forEach((target, index) => close(target.hp, 1000 - damageAt((player.z - target.z - .32) / Math.cos(player.pitch)) * .65 ** index));
  assert.deepEqual(door.boards, boardsWith(2, 0));
});

test('physical intersection order damages a nearer zombie and then the board, sparing the rear zombie', () => {
  const { simulation, player } = room();
  aimAtBoard(player, simulation.doors[0], 2);
  const rear = target(simulation, 'rear', { z: -7 });
  const near = target(simulation, 'near', { z: -5.2 });
  simulation.shoot(player.id);
  settleBallisticFlight(simulation);
  close(near.hp, 1000 - damageAt((player.z - near.z - .32) / Math.cos(player.pitch)));
  assert.equal(rear.hp, 1000);
  closeBoards(simulation.doors[0].boards, boardsWith(2, FULL[2] - boardDamage(player, simulation.doors[0], 2, .65)));
});

test('solid walls occlude a board before the projectile can destroy it', () => {
  const { simulation, player } = room();
  Object.assign(player, { x: 10, y: 0, z: 4, yaw: Math.PI / 4, pitch: Math.atan2(1.34 - 1.55, Math.hypot(10, 10)) });
  simulation.shoot(player.id);
  settleBallisticFlight(simulation);
  assert.ok(simulation.doors.every(door => door.hp === DOOR_HP));
});

test('aggregate HP and snapshots always follow individual boards, while legacy writes remain coherent', () => {
  const { simulation } = room();
  const door = simulation.doors[0];
  assert.equal(door.maxHp, 300);
  door.hp = 75;
  assert.deepEqual(door.boards, [60, 15, 0, 0, 0]);
  assert.equal(door.hp, 75);
  door.boards[4] = 60;
  assert.equal(door.hp, 135);
  const state = simulation.snapshot().doors.find(item => item.id === door.id);
  assert.deepEqual(state.boards, [60, 15, 0, 0, 60]);
  state.boards[0] = 0;
  assert.equal(door.hp, 135, 'A snapshot must not expose the live server array');
  door.hp = -500;
  assert.deepEqual(door.boards, [0, 0, 0, 0, 0]);
  door.hp = 999;
  assert.deepEqual(door.boards, FULL);
});

test('enemy damage and 25-HP repairs change the actual boards without aggregate drift', () => {
  const { simulation, player, events } = room();
  const door = simulation.doors[0];
  Object.assign(player, { x: 0, y: 0, z: -5 });
  assert.equal(simulation.damageDoor(door, 72, { zombieId: 'brute' }), 72);
  assert.deepEqual(door.boards, [0, 48, 60, 60, 60]);
  assert.equal(door.hp, 228);
  assert.equal(door.repairCredit, 72);
  assert.deepEqual(events.find(event => event.event === 'door').boards, door.boards);
  assert.equal(simulation.interact(player.id), true);
  // Damaged planks are finished before broken ones are rebuilt.
  assert.deepEqual(door.boards, [13, 60, 60, 60, 60]);
  assert.equal(door.hp, 253);
  assert.equal(door.repairCredit, 47);
  assert.equal(player.points, 1);
  assert.equal(player.score, 25, 'a repair scores the health the zombies broke and it put back (owner, 18 October)');
  for (const [boards, credit] of [[[38, 60, 60, 60, 60], 22], [[60, 60, 60, 60, 60], 0]]) {
    simulation.time += 1;
    assert.equal(simulation.interact(player.id), true);
    assert.deepEqual(door.boards, boards);
    assert.equal(door.repairCredit, credit);
  }
  assert.equal(door.hp, 300);
  assert.equal(player.points, 3);
  assert.equal(player.score, 25 + 25 + 22, 'the last repair only had 22 broken HP left');
  simulation.time += 1;
  assert.equal(simulation.interact(player.id), false, 'A complete barricade has nothing left to repair');
});

test('a ruined barricade needs twelve 25-HP repairs, 2.5 times the original five', () => {
  const { simulation, player, events } = room();
  const door = simulation.doors[0];
  Object.assign(player, { x: 0, y: 0, z: -5 });
  simulation.damageDoor(door, DOOR_HP, { zombieId: 'brute' });
  assert.equal(door.hp, 0);
  let repairs = 0;
  while (door.hp < door.maxHp && repairs < 20) {
    simulation.time += 1;
    assert.equal(simulation.interact(player.id), true);
    repairs++;
  }
  // 300 HP at 25 HP per press; the former 120-HP barricade needed five.
  assert.equal(repairs, 12);
  assert.deepEqual(door.boards, FULL);
  assert.equal(events.filter(event => event.event === 'repair').length, 12);
  assert.equal(player.points, 12, 'every legitimate repair pays one spendable point');
  assert.equal(player.score, DOOR_HP, 'the 300 HP the zombies broke, put back');
  assert.ok(events.filter(event => event.event === 'repair').every(event => event.points === 1));
});

test('shooting and repairing your own boards never farms points or resets unrelated planks', () => {
  const { simulation, player } = room();
  const door = simulation.doors[0];
  for (let repeat = 0; repeat < 4; repeat++) {
    aimAtBoard(player, door, 2);
    simulation.time += 1;
    assert.equal(simulation.shoot(player.id), true);
    settleBallisticFlight(simulation);
    const damage = boardDamage(player, door, 2);
    closeBoards(door.boards, boardsWith(2, FULL[2] - damage));
    Object.assign(player, { x: 0, y: 0, z: -5 });
    assert.equal(simulation.interact(player.id), true);
    closeBoards(door.boards, boardsWith(2, FULL[2] - damage + 25));
    simulation.time += 1;
    assert.equal(simulation.interact(player.id), true);
    assert.deepEqual(door.boards, FULL);
    assert.equal(player.points, 0);
    assert.equal(player.score, 0);
  }
});

test('an actual zombie attack damages a real plank and its repair earns only legitimate points', () => {
  const { simulation, player } = room();
  const door = simulation.doors[0];
  Object.assign(player, { x: 0, y: 0, z: -4 });
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: 0, y: 0, z: -6.75, doorId: door.id, attackAfter: 0 });
  simulation.updateZombie(zombie, 1 / 30, [player]);
  assert.deepEqual(door.boards, boardsWith(0, 48));
  assert.equal(door.hp, 288);
  assert.equal(door.repairCredit, 12);
  player.z = -5;
  assert.equal(simulation.interact(player.id), true);
  assert.equal(door.hp, 300);
  assert.equal(player.points, 1);
  assert.equal(player.score, 12, 'the 12 HP the zombie broke');
  assert.equal(door.repairCredit, 0);
});

test('a Bricolage debt repairs and scores 20 or 15 HP per action, still one coin', () => {
  for (const [tinkering, amount] of [[0, 25], [-1, 20], [-2, 15]]) {
    const events = [];
    const simulation = new RoomSimulation('BOARDS', { random: () => 0.5, onEvent: event => events.push(event) });
    const sheet = tinkering === 0 ? null : { stats: tinkering === -1 ? { tinkering: -1, strength: 1 } : { tinkering: -2, strength: 2 } };
    const player = simulation.addPlayer('a', 'Alice', undefined, { sheet });
    simulation.start('a');
    const door = simulation.doors[0];
    Object.assign(player, { x: 0, y: 0, z: -5 });
    simulation.damageDoor(door, 72, { zombieId: 'brute' });
    assert.equal(simulation.interact(player.id), true);
    assert.equal(door.hp, 228 + amount, `tinkering ${tinkering}`);
    assert.equal(player.score, amount, `tinkering ${tinkering}: the credited HP`);
    assert.equal(player.points, 1);
  }
});

test('four broken lower boards let ordinary zombies pass while a brute must break the remaining upper board', () => {
  for (const brute of [false, true]) {
    const { simulation, player } = room();
    const door = simulation.doors[0];
    door.boards = [0, 0, 0, 0, 60];
    Object.assign(player, { x: 0, y: 0, z: -4 });
    const zombie = simulation.spawnZombie();
    Object.assign(zombie, {
      x: 0, y: 0, z: -6.75, doorId: door.id, attackAfter: 0,
      kind: brute ? 'brute' : 'walker', scale: brute ? 1.22 : 1,
      barricadeDamage: brute ? 36 : 12, attackInterval: brute ? 1.2 : 0.95,
    });
    assert.equal(simulation.doorPassable(door, 0, 1.82 * zombie.scale), !brute);
    simulation.updateZombie(zombie, 1 / 30, [player]);
    if (brute) {
      // A 36-damage brute now needs two blows on the reinforced upper plank.
      assert.equal(door.hp, 24);
      assert.equal(zombie.entered, false);
      simulation.time = zombie.attackAfter;
      simulation.updateZombie(zombie, 1 / 30, [player]);
      assert.equal(door.hp, 0);
      assert.equal(zombie.entered, false);
      simulation.updateZombie(zombie, 1 / 30, [player]);
      assert.equal(zombie.entered, true);
    } else {
      assert.equal(door.hp, 60);
      assert.equal(zombie.entered, true);
      assert.ok(zombie.z > -6.75);
    }
  }
});
