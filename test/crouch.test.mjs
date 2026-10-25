import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { PLAYER_POSTURE, playerHeight, playerEyeHeight } from '../public/movement.js';
import { WEAPON_MOVEMENT, MAX_WAVES } from '../public/rules.js';
import { completeRevive } from './helpers/revive.mjs';

function fixture(position = {}) {
  const events = [], simulation = new RoomSimulation('CROUCH', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  Object.assign(player, { x: -3, z: 1.7, ...position });
  const input = (extra = {}) => simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, ...extra });
  return { simulation, player, events, input };
}

test('crouch is authoritative, uses equipped weight and takes priority over sprint', () => {
  for (const weapon of ['pistol', 'rifle', 'minigun']) {
    const { simulation, player, input } = fixture();
    player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
    player.weapon = weapon;
    input({ crouch: true, sprint: true, strafe: 1, eyeHeight: 99, height: .01, speed: 99 });
    simulation.movePlayer(player, .1);
    assert.equal(player.crouched, true);
    assert.equal(playerHeight(player), PLAYER_POSTURE.crouchedHeight);
    assert.equal(playerEyeHeight(player), PLAYER_POSTURE.crouchedEye);
    assert.ok(Math.abs(player.x + 3 - 3.5 * PLAYER_POSTURE.crouchSpeed * WEAPON_MOVEMENT[weapon] * .1) < 1e-8);
    const snapshot = simulation.snapshot().players[0];
    assert.equal(snapshot.crouched, true);
    assert.equal(snapshot.eyeHeight, .88);
    input({ crouch: 'true' }); simulation.movePlayer(player, .1);
    assert.equal(player.crouched, false);
    assert.equal(simulation.snapshot().players[0].eyeHeight, 1.55);
  }
});

test('standing can fire above the living cover but crouched bullets stop in it', () => {
  const { simulation, player, events, input } = fixture({ x: 1.8, z: 3.3 });
  simulation.phase = 'wave'; simulation.wave = 1;
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { kind: 'walker', x: -.4, y: 0, z: 3.3, hp: 1000, scale: 1 });
  input({ yaw: Math.PI / 2 });
  assert.equal(simulation.shoot('a'), true);
  settleBallisticFlight(simulation);
  assert.ok(zombie.hp < 1000);
  const hp = zombie.hp;
  input({ yaw: Math.PI / 2, crouch: true }); simulation.movePlayer(player, .01);
  simulation.time += WEAPONS.pistol.interval + .01;
  assert.equal(simulation.shoot('a'), true);
  settleBallisticFlight(simulation);
  assert.equal(zombie.hp, hp);
  assert.equal(events.filter(event => event.event === 'bullet-impact').at(-1).stop, 'solid');
});

test('crouching fits a low barricade opening and cannot stand up into its planks', () => {
  const { simulation, player, input } = fixture({ x: 0, z: -6 });
  const door = simulation.doors[0];
  door.boards[0] = 0; door.boards[1] = 0;
  input({ crouch: true }); simulation.movePlayer(player, .01);
  assert.equal(simulation.canOccupy(player, 0, -6, 0, .25), true);
  input(); simulation.movePlayer(player, .01);
  assert.equal(player.crouched, true);
  player.z = -5.4; simulation.movePlayer(player, .01);
  assert.equal(player.crouched, false);
});

test('releasing crouch beneath the loft cannot grow through its floor', () => {
  const { simulation, player, input } = fixture({ x: 6, z: 1, y: 1.8, grounded: false, crouched: true });
  input(); simulation.movePlayer(player, .01);
  assert.equal(player.crouched, true);
  assert.ok(player.y + playerHeight(player) < WORLD.loftY - .24);
  player.y = 0; player.grounded = true;
  simulation.movePlayer(player, .01);
  assert.equal(player.crouched, false);
});

test('stale controls release crouch and restarting resets posture and inputs', () => {
  const { simulation, player, input } = fixture();
  input({ crouch: true }); simulation.movePlayer(player, .01);
  simulation.time += .61; simulation.movePlayer(player, .01);
  assert.equal(player.crouched, false);
  input({ crouch: true }); simulation.movePlayer(player, .01);
  assert.equal(player.crouched, true);
  assert.equal(simulation.start('a'), true);
  assert.equal(player.crouched, false);
  assert.equal(player.input.crouch, false);
});

test('the partition blocks reviving through plaster but its open doorway permits help', () => {
  // Use plaster away from the wall rack: E must exercise blocked revival,
  // rather than the legitimate purchase/equip interaction beside it.
  const { simulation, player } = fixture({ x: -.2, z: -1.4 });
  const teammate = simulation.addPlayer('b');
  simulation.phase = 'wave';
  Object.assign(teammate, { x: -.2, z: -2.7, downed: true, hp: 0, bleedOutAt: 25 });
  assert.equal(simulation.interact('a'), false);
  assert.equal(teammate.downed, true);
  assert.equal(player.points, 0);
  player.x = -4.4; teammate.x = -4.4;
  assert.equal(completeRevive(simulation, 'a'), true);
  assert.equal(teammate.downed, false);
  assert.equal(player.points, 25);
});

test('zombie melee cannot pass through the new partition at arm reach', () => {
  const { simulation, player } = fixture({ x: -2.8, z: -2.4 });
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: -2.8, y: 0, z: -1.6, kind: 'walker', scale: 1, attackAfter: 0, entered: true, speed: 1.15 });
  simulation.phase = 'wave';
  simulation.updateZombie(zombie, 1 / 30, [player]);
  assert.equal(player.hp, 100);
  assert.equal(zombie.attackAfter, 0);
});

test('extraction and defeat release posture before simulation movement freezes', () => {
  for (const ending of ['extraction', 'gameover']) {
    const { simulation, player, input } = fixture();
    simulation.phase = 'wave'; simulation.wave = MAX_WAVES;
    simulation.toSpawn = 0;
    input({ crouch: true }); simulation.movePlayer(player, .01);
    if (ending === 'extraction') assert.equal(simulation.beginExtraction(), true);
    else simulation.endGame();
    assert.equal(player.crouched, false);
    assert.equal(player.input.crouch, false);
    for (let index = 0; index < 400; index++) simulation.tick();
    assert.equal(player.crouched, false);
  }
});
