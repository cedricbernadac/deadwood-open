import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WORLD, WEAPONS } from '../simulation.mjs';
import { ARMORY_RACK, EXTERIOR, WEAPON_MOVEMENT } from '../public/rules.js';
import { stairTreadY } from '../public/stairs.js';

function setup(position = {}) {
  const simulation = new RoomSimulation('JUMP01', { random: () => 0.5 });
  const player = simulation.addPlayer('a');
  Object.assign(player, { vy: 0, grounded: true, jumpHeld: false, jumpRequested: false, ...position });
  return { simulation, player };
}

function step(simulation, input = {}, delta = 1 / 30) {
  simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, ...input });
  simulation.tick(delta);
}

function advance(simulation, ticks, input = {}, delta = 1 / 30) {
  for (let i = 0; i < ticks; i++) step(simulation, input, delta);
}

test('walking and sprinting use only the equipped weapon weight and ignore client speed fields', () => {
  for (const [weapon, multiplier] of Object.entries(WEAPON_MOVEMENT)) {
    for (const sprint of [false, true]) {
      const { simulation, player } = setup({ x: -3, y: 0, z: -4 });
      player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
      assert.equal(simulation.chooseWeapon(player.id, weapon), true);
      const input = { forward: 0, strafe: 1, yaw: 0, pitch: 0, sprint, speed: 999, weapon: 'pistol', movementMultiplier: 999 };
      simulation.setInput(player.id, input);
      simulation.movePlayer(player, .1);
      assert.ok(Math.abs((player.x + 3) - (sprint ? 5.4 : 3.5) * multiplier * .1) < 1e-8, `${weapon}, sprint=${sprint}`);
      assert.equal(player.weapon, weapon);
      assert.equal(player.inventory[weapon].ammo, WEAPONS[weapon].magazine);
    }
  }
});

test('switching to a bought minigun immediately slows the survivor and switching back restores pistol speed', () => {
  const { simulation, player } = setup({ x: -3, y: 0, z: -4 });
  player.inventory.minigun = { ammo: 60, reserve: 15 };
  const displacement = weapon => {
    player.x = -3;
    simulation.chooseWeapon(player.id, weapon);
    simulation.setInput(player.id, { forward: 0, strafe: 1, yaw: 0, pitch: 0 });
    simulation.movePlayer(player, .1);
    return player.x + 3;
  };
  const pistol = displacement('pistol');
  const heavy = displacement('minigun');
  const restored = displacement('pistol');
  assert.ok(Math.abs(heavy / pistol - 2 / 3) < 1e-8);
  assert.ok(Math.abs(restored - pistol) < 1e-8);
  assert.equal(simulation.chooseWeapon(player.id, 'rifle'), false);
  assert.equal(player.weapon, 'pistol');
});

test('players climb and descend all visual stair treads at normal and larger tick sizes', () => {
  for (const delta of [1 / 30, 0.1]) {
    const { simulation, player } = setup({ x: 3.8, z: 4.4 });
    advance(simulation, Math.ceil(2.1 / delta), { forward: 1 }, delta);
    assert.equal(player.y, WORLD.loftY);
    assert.ok(player.z < WORLD.stair.minZ);
    advance(simulation, Math.ceil(2.1 / delta), { forward: -1 }, delta);
    assert.equal(player.y, 0);
    assert.ok(player.z > WORLD.stair.maxZ);
    assert.equal(player.grounded, true);
  }
});

test('walking into the stair opening from the loft falls onto the exact visible tread', () => {
  const { simulation, player } = setup({ x: 5.1, y: WORLD.loftY, z: 1.1 });
  advance(simulation, 9, { strafe: -1 });
  assert.ok(player.x > 3.25 && player.x < 4.35);
  assert.equal(player.grounded, false);
  assert.ok(player.y < WORLD.loftY && player.y > 1.7);
  advance(simulation, 30);
  const tread = stairTreadY(player.z);
  assert.equal(player.y, tread);
  assert.equal(player.grounded, true);
  assert.equal(player.hp, 100);
});

test('a jump uses server gravity and holding the key does not automatically jump again', () => {
  const { simulation, player } = setup({ x: 0, z: 2 });
  step(simulation, { jump: true });
  assert.ok(player.y > 0);
  assert.equal(player.grounded, false);
  advance(simulation, 45, { jump: true });
  assert.equal(player.y, 0);
  assert.equal(player.grounded, true);
  step(simulation, { jump: false });
  step(simulation, { jump: true });
  assert.ok(player.y > 0);
});

test('a jump can cross into the stairwell and land after input packets stop', () => {
  const { simulation, player } = setup({ x: 4.9, y: WORLD.loftY, z: 0.8 });
  advance(simulation, 7, { strafe: -1, jump: true });
  assert.ok(player.y > WORLD.loftY);
  assert.ok(player.x < 4.35);
  simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: false });
  for (let i = 0; i < 60; i++) simulation.tick();
  assert.equal(player.grounded, true);
  assert.equal(player.y, stairTreadY(player.z));
});

test('ground-floor players cannot climb the stairs through their side', () => {
  const { simulation, player } = setup({ x: 2.6, z: 1 });
  advance(simulation, 30, { strafe: 1, jump: true });
  assert.ok(player.x < WORLD.stair.minX);
  assert.equal(player.y, 0);
});

test('a falling player cannot pass through the loft slab beside the stairwell', () => {
  const { simulation, player } = setup({ x: 3.8, y: 2.5, z: 1, grounded: false, vy: -1 });
  advance(simulation, 4, { strafe: 1 });
  assert.ok(player.x < WORLD.stair.maxX - 0.2);
  assert.ok(player.y < 2.5);
});

test('jumping underneath the loft hits its underside instead of crossing its floor', () => {
  const { simulation, player } = setup({ x: 6, y: 1.2, z: 1, grounded: false, vy: 5.6 });
  advance(simulation, 3);
  assert.ok(player.y <= WORLD.loftY - 0.24 - 1.75);
  assert.ok(player.vy <= 0);
  advance(simulation, 30);
  assert.equal(player.y, 0);
});

test('the former shotgun island is free to walk and jump through after wall mounting', () => {
  const { simulation, player } = setup({ x: 5, y: 0, z: -3.9 });
  advance(simulation, 15, { strafe: 1, jump: true });
  assert.ok(player.x > 6.5);
  advance(simulation, 30);
  assert.equal(player.y, 0);
});

test('the upstairs magnum wall rack has no collider on the ground floor beneath it', () => {
  const crate = WORLD.armory.find(item => item.weapon === 'magnum');
  assert.ok(crate && crate.y === WORLD.loftY);
  const { simulation, player } = setup({ x: crate.x - .28, y: 0, z: crate.z });
  assert.equal(simulation.canOccupy(player, player.x, crate.z, 0, 0.25), true);
  assert.equal(simulation.canOccupy(player, player.x, crate.z, crate.y, 0.25), false, 'The same body footprint meets the rack on its own floor');
});

test('the upstairs magnum rack blocks its narrow wall area but frees the former island', () => {
  const crate = WORLD.armory.find(item => item.weapon === 'magnum');
  assert.ok(crate && crate.y === WORLD.loftY);
  const { simulation, player } = setup({ x: crate.x - 1.2, y: crate.y, z: crate.z });
  assert.equal(simulation.canOccupy(player, 6.6, crate.z, crate.y, .25), true, 'The old island center is clear');
  advance(simulation, 12, { strafe: 1 });
  assert.ok(player.x <= crate.x - ARMORY_RACK.depth - .25 + 1e-6);
  advance(simulation, 35, { strafe: 1, jump: true });
  assert.ok(player.x <= crate.x - ARMORY_RACK.depth - .25 + 1e-6);
  assert.equal(player.y, crate.y);
  assert.equal(player.grounded, true);
});

test('an airborne player lands on the physical top of the suspended rack at its absolute height', () => {
  const crate = WORLD.armory.find(item => item.weapon === 'magnum');
  assert.ok(crate && crate.y === WORLD.loftY);
  const { simulation, player } = setup({ x: crate.x - ARMORY_RACK.depth / 2, y: crate.y + 2.8, z: crate.z, grounded: false, vy: -1 });
  advance(simulation, 30);
  assert.equal(player.y, crate.y + ARMORY_RACK.baseY + ARMORY_RACK.height);
  assert.equal(player.grounded, true);
});

test('zombies avoid the narrow wall rack while the former upstairs island stays traversable', () => {
  const crate = WORLD.armory.find(item => item.weapon === 'magnum');
  assert.ok(crate && crate.y === WORLD.loftY);
  const { simulation } = setup();
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: 6.6, z: crate.z + 1.2, y: 0, speed: 2 });
  const groundTarget = { x: zombie.x, z: crate.z - 0.7 };
  for (let i = 0; i < 40; i++) simulation.moveZombieTowards(zombie, groundTarget, 1 / 30);
  assert.ok(zombie.z < crate.z);
  assert.equal(zombie.y, 0);
  Object.assign(zombie, { x: 6.6, z: crate.z + 1.2, y: crate.y, navigation: null });
  const loftTarget = { x: 6.6, z: crate.z - .7 };
  for (let i = 0; i < 150; i++) {
    simulation.moveZombieTowards(zombie, loftTarget, 1 / 30);
    assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, 0.29), true);
  }
  assert.ok(Math.hypot(zombie.x - loftTarget.x, zombie.z - loftTarget.z) < 0.1);
  assert.equal(zombie.y, WORLD.loftY);
});

test('the loft railing prevents walking off while exterior bounds still contain jumps', () => {
  const { simulation, player } = setup({ x: 2.3, y: WORLD.loftY, z: -3 });
  advance(simulation, 30, { strafe: -1 });
  assert.ok(player.x >= WORLD.loft.minX + 0.25);
  assert.equal(player.y, WORLD.loftY);
  Object.assign(player, { x: EXTERIOR.bounds.maxX, y: 0, z: 1, grounded: true, vy: 0, jumpHeld: false });
  advance(simulation, 30, { strafe: 1, jump: true });
  assert.equal(player.x, EXTERIOR.bounds.maxX);
});

test('stale or airborne jump requests do not produce a second impulse', () => {
  const { simulation, player } = setup({ x: 0, z: 2 });
  step(simulation, { jump: true });
  step(simulation, { jump: false });
  const velocity = player.vy;
  step(simulation, { jump: true });
  assert.ok(player.vy < velocity);
  advance(simulation, 30, { jump: true });
  assert.equal(player.y, 0);
  simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: false });
  simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: true });
  simulation.time += 1;
  simulation.tick();
  assert.equal(player.y, 0);
});
