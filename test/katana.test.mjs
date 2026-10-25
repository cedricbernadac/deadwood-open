import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { MELEE, ARMORY, FIRE_INTERVALS, WEAPON_MOVEMENT, PICKUPS } from '../public/rules.js';

const TARGET_HP = 3000;

function fixture(practice = true) {
  const events = [], simulation = new RoomSimulation('KATANA', { practice, random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.zombies.clear();
  if (!practice) { simulation.phase = 'countdown'; simulation.timeLeft = 999; }
  Object.assign(player, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon: 'katana',
    inventory: { katana: { ammo: 0, reserve: 0 }, pistol: { ammo: 12, reserve: 36 } } });
  return { simulation, player, events };
}
function target(simulation, id = 'target', options = {}) {
  const zombie = { id, x: 12, y: 0, z: 6.5, yaw: 0, hp: TARGET_HP, maxHp: TARGET_HP, kind: 'walker', scale: 1,
    speed: 0, attackAfter: Infinity, entered: true, ...options };
  simulation.zombies.set(id, zombie); return zombie;
}
function advance(simulation, seconds, hz = 30) {
  let remaining = seconds;
  while (remaining > 1e-8) {
    const step = Math.min(remaining, 1 / hz);
    // Held controls keep arriving from the real client throughout a wind-up.
    for (const player of simulation.players.values()) player.lastInputAt = simulation.time;
    simulation.tick(step); remaining -= step;
  }
}
function hit(simulation, attack = 'light', hz = 30) {
  assert.equal(simulation.shoot('a', 0, attack), true);
  advance(simulation, MELEE[attack].windup + .01, hz);
}

test('katana gains twenty percent on its previous light/heavy damage with unchanged attack timings, range, cleave and stock', () => {
  const { simulation, player } = fixture();
  assert.equal(WEAPONS.katana.melee, true); assert.equal(WEAPONS.katana.magazine, 0); assert.equal(WEAPONS.katana.reserve, 0);
  assert.equal(WEAPONS.katana.reloadTime, 0); assert.equal(FIRE_INTERVALS.katana, .55); assert.equal(WEAPON_MOVEMENT.katana, 1.05);
  assert.deepEqual([MELEE.light.damage, MELEE.heavy.damage], [180 * 1.2, 420 * 1.2], 'apply the approved twenty percent once to the previous live profile');
  assert.deepEqual(MELEE.light, { damage: 216, range: 1.9, coneAngle: 80 * Math.PI / 180, windup: .16, duration: .55, interval: .55, maxTargets: 3, retention: .75 });
  assert.deepEqual(MELEE.heavy, { damage: 504, range: 2.1, coneAngle: 65 * Math.PI / 180, windup: .7, duration: 1.5, interval: 1.5, maxTargets: 3, retention: .75 });
  assert.deepEqual(WEAPONS.katana.attacks, { light: MELEE.light, heavy: MELEE.heavy });
  assert.equal(PICKUPS.ammo.katana, 0); assert.equal(PICKUPS.specialAmmo.katana, 0);
  assert.equal(simulation.reload('a'), false); assert.equal(player.reloadUntil, 0);
  const rack = ARMORY.find(rack => rack.weapon === 'katana');
  assert.deepEqual([rack.x, rack.y, rack.z], [5.6, 3.4, 5.82]);
  assert.equal(rack.price, 1200); assert.equal(rack.unlockWave, 9);
});

test('both swings wait for their wind-up at 30 and 10 Hz, then emit one impact without shot or ammo consumption', () => {
  for (const hz of [30, 10]) for (const attack of ['light', 'heavy']) {
    const { simulation, player, events } = fixture(); const zombie = target(simulation);
    assert.equal(simulation.shoot('a', 0, attack), true);
    const start = events.find(event => event.event === 'melee-start'), state = simulation.snapshot().players[0];
    assert.ok(Number.isSafeInteger(start.attackId) && start.attackId > 0);
    assert.equal(state.meleeAttack, attack); assert.equal(state.meleeAttackId, start.attackId);
    assert.equal(state.meleeWindupLeft, MELEE[attack].windup); assert.equal(state.meleeReadyLeft, MELEE[attack].duration);
    advance(simulation, MELEE[attack].windup - .001, hz); assert.equal(zombie.hp, TARGET_HP);
    advance(simulation, .002, hz); assert.equal(zombie.hp, TARGET_HP - MELEE[attack].damage);
    advance(simulation, .05, hz);
    assert.equal(events.filter(event => event.event === 'melee-hit').length, 1);
    assert.equal(events.some(event => event.event === 'shot' || event.event === 'reload'), false);
    assert.deepEqual(player.inventory.katana, { ammo: 0, reserve: 0 });
    const impact = events.find(event => event.event === 'melee-hit');
    assert.equal(impact.attackId, start.attackId); assert.equal(impact.impacts[0].damage, MELEE[attack].damage);
    assert.equal(impact.hits, 1); assert.equal(impact.kills, 0);
    assert.equal(simulation.snapshot().players[0].meleeAttack, null);
  }
});

test('invalid attack payloads and forged timing cannot accelerate katana or grant heavy firearm shots', () => {
  const { simulation, player, events } = fixture(); target(simulation);
  for (const attack of [null, {}, 1, 'constructor', 'LIGHT']) assert.equal(simulation.shoot('a', 0, attack), false);
  assert.equal(simulation.shoot('a', { damage: 999999, windup: 0 }), true, 'default is the regular light attack');
  for (let request = 0; request < 1000; request++) assert.equal(simulation.shoot('a', 999, 'heavy'), false);
  assert.equal(events.filter(event => event.event === 'melee-start').length, 1);
  advance(simulation, .549); assert.equal(simulation.shoot('a'), false);
  advance(simulation, .001); assert.equal(simulation.shoot('a'), true);
  simulation.cancelMelee('a'); simulation.chooseWeapon('a', 'pistol'); simulation.time = player.shotAfter;
  assert.equal(simulation.shoot('a', 0, 'heavy'), false); assert.equal(player.inventory.pistol.ammo, 12);
  assert.equal(simulation.shoot('a'), true); assert.equal(player.inventory.pistol.ammo, 11);
});

test('a swing chooses only the three closest visible bodies and attenuates each successive hit, including armor', () => {
  const { simulation, events } = fixture();
  const first = target(simulation, 'first', { kind: 'armored' });
  const second = target(simulation, 'second', { x: 12.5 }), third = target(simulation, 'third', { x: 11.5 });
  const fourth = target(simulation, 'fourth', { x: 12.8 });
  hit(simulation, 'heavy');
  assert.equal(first.hp, TARGET_HP - 504 * .65);
  assert.equal(second.hp, TARGET_HP - 504 * .75); assert.equal(third.hp, TARGET_HP - 504 * .75 ** 2); assert.equal(fourth.hp, TARGET_HP);
  const impacts = events.find(event => event.event === 'melee-hit').impacts;
  assert.deepEqual(impacts.map(impact => impact.zombieId), ['first', 'second', 'third']);
  assert.ok(first.pushZ < 0 && impacts[1].dirX > 0 && impacts[2].dirX < 0, 'actual damage pushes away, while crowded bodies still block displacement');
});

test('katana respects reach at the body surface, its cone and the survivor pitch without a headshot bonus', () => {
  for (const [z, attack, expected] of [[5.78, 'light', 216], [5.779, 'light', 0], [5.68, 'light', 0], [5.68, 'heavy', 504]]) {
    const { simulation } = fixture(); const zombie = target(simulation, 'reach', { z });
    hit(simulation, attack); assert.equal(TARGET_HP - zombie.hp, expected, `${attack} at z=${z}`);
  }
  for (const options of [{ x: 14, z: 7.3 }, { z: 9 }, { y: 3.4 }]) {
    const { simulation } = fixture(); const zombie = target(simulation, 'miss', options);
    hit(simulation); assert.equal(zombie.hp, TARGET_HP);
  }
  const { simulation, player } = fixture(); const zombie = target(simulation); player.pitch = 1.48;
  hit(simulation); assert.equal(zombie.hp, TARGET_HP, 'looking upward cannot cut a ground target');
  simulation.time = player.shotAfter; player.pitch = 0;
  hit(simulation); assert.equal(zombie.hp, TARGET_HP - 216, 'eye-level aim has no hidden head multiplier');
});

test('katana cannot cut through the central wall, boards, a loft floor or the stair underside', () => {
  for (const scene of ['wall', 'board', 'floor', 'stairs']) {
    const { simulation, player } = fixture(); let zombie;
    if (scene === 'wall') { Object.assign(player, { x: -1, z: -1.25 }); zombie = target(simulation, 'hidden', { x: -1, z: -2.75 }); }
    if (scene === 'board') { Object.assign(player, { x: 0, z: -5.1, crouched: true, pitch: 0 }); player.input.crouch = true; zombie = target(simulation, 'hidden', { x: 0, z: -6.7 }); }
    if (scene === 'floor') { Object.assign(player, { x: 6, z: 3, y: 1.9, pitch: 1.48 }); zombie = target(simulation, 'hidden', { x: 6, y: WORLD.loftY, z: 3 }); }
    if (scene === 'stairs') {
      Object.assign(player, { x: 3.8, z: -.9, y: 0, pitch: 1.2 });
      zombie = target(simulation, 'hidden', { x: 3.8, z: -.9, y: 2.7625 });
    }
    const boardHealth = simulation.doors.map(door => [...door.boards]);
    hit(simulation, 'heavy'); assert.equal(zombie.hp, TARGET_HP, scene);
    assert.deepEqual(simulation.doors.map(door => [...door.boards]), boardHealth, `${scene}: no arbitrary plank or area damage`);
  }
});

test('the impact uses current authoritative aim, survivor position and target position', () => {
  for (const move of ['turn', 'survivor', 'target']) {
    const { simulation, player } = fixture(); const zombie = target(simulation);
    assert.equal(simulation.shoot('a', 0, 'heavy'), true);
    if (move === 'turn') simulation.setInput('a', { forward: 0, strafe: 0, yaw: Math.PI, pitch: 0 });
    if (move === 'survivor') player.x += 4;
    if (move === 'target') zombie.x += 4;
    advance(simulation, .71); assert.equal(zombie.hp, TARGET_HP, move);
  }
});

test('cancel preserves recovery and weapon changes, drops, refill, resets, downing and departures cancel queued damage', () => {
  for (const cancel of ['request', 'switch', 'drop', 'refill', 'targets', 'equip', 'down', 'leave', 'gameover', 'restart']) {
    const { simulation, player, events } = fixture(!['down', 'gameover', 'restart'].includes(cancel)); const zombie = target(simulation);
    assert.equal(simulation.shoot('a', 0, 'heavy'), true); const recovery = player.shotAfter;
    if (cancel === 'request') simulation.cancelMelee('a');
    if (cancel === 'switch') simulation.chooseWeapon('a', 'pistol');
    if (cancel === 'drop') assert.equal(simulation.dropWeapon('a'), true);
    if (cancel === 'refill') assert.equal(simulation.practiceAction('a', { action: 'refill' }), true);
    if (cancel === 'targets') assert.equal(simulation.practiceAction('a', { action: 'targets' }), true);
    if (cancel === 'equip') assert.equal(simulation.practiceAction('a', { action: 'weapon', weapon: 'rocket' }), true);
    if (cancel === 'down') simulation.damagePlayer(player, 1000);
    if (cancel === 'leave') simulation.removePlayer('a');
    if (cancel === 'gameover') simulation.endGame();
    if (cancel === 'restart') { simulation.phase = 'gameover'; assert.equal(simulation.start('a'), true); }
    assert.equal(player.pendingMelee, null, cancel);
    if (cancel !== 'restart') assert.equal(player.shotAfter, recovery, cancel);
    advance(simulation, .8); assert.equal(zombie.hp, TARGET_HP, cancel);
    assert.equal(events.some(event => event.event === 'melee-hit'), false, cancel);
  }
});

test('resetting shared practice targets cancels every survivor pending attack without clearing their recovery', () => {
  const { simulation, player } = fixture(); const teammate = simulation.addPlayer('b');
  Object.assign(teammate, { weapon: 'katana', inventory: { katana: { ammo: 0, reserve: 0 } } });
  simulation.shoot('a', 0, 'heavy'); simulation.shoot('b', 0, 'light');
  assert.equal(simulation.practiceAction('b', { action: 'targets' }), true);
  assert.equal(player.pendingMelee, null); assert.equal(teammate.pendingMelee, null);
  assert.equal(player.shotAfter, 1.5); assert.equal(teammate.shotAfter, .55);
  advance(simulation, 1); assert.ok([...simulation.zombies.values()].every(zombie => zombie.hp === zombie.maxHp));
});

test('normal katana kills create one ordinary cash drop and no headshot reward, while practice kills create no loot', () => {
  for (const practice of [false, true]) {
    const { simulation, player, events } = fixture(practice); target(simulation, 'weak', { hp: 80, maxHp: 80 });
    hit(simulation); simulation.updateMelee();
    assert.equal(player.kills, 1); assert.equal(events.filter(event => event.event === 'kill').length, 1);
    assert.equal(events.find(event => event.event === 'kill').headshot, false);
    const cash = [...simulation.pickups.values()].filter(pickup => pickup.kind === 'points');
    assert.equal(cash.length, practice ? 0 : 1); if (!practice) assert.equal(cash[0].amount, 18);
  }
});

test('katana purchases are gated and dropped swords keep zero stocks for a teammate', () => {
  const { simulation, player } = fixture(false), rack = ARMORY.find(rack => rack.weapon === 'katana');
  player.inventory = { pistol: { ammo: 12, reserve: 36 } }; player.weapon = 'pistol';
  Object.assign(player, { x: rack.x + Math.sin(rack.facing) * 1.2, z: rack.z + Math.cos(rack.facing) * 1.2, y: rack.y, points: rack.price });
  simulation.wave = rack.unlockWave - 1; assert.equal(simulation.buyWeapon('a', rack.id), false); assert.equal(player.points, rack.price);
  simulation.time += 1; simulation.wave = rack.unlockWave; assert.equal(simulation.buyWeapon('a', rack.id), true);
  assert.equal(player.points, 0); assert.deepEqual(player.inventory.katana, { ammo: 0, reserve: 0 });
  simulation.time += 1; assert.equal(simulation.dropWeapon('a'), true);
  const sword = [...simulation.pickups.values()].find(pickup => pickup.weapon === 'katana');
  assert.ok(sword); assert.deepEqual([sword.ammo, sword.reserve], [0, 0]);
  const teammate = simulation.addPlayer('b'); Object.assign(teammate, { x: player.x, y: player.y, z: player.z });
  assert.equal(simulation.takeGroundWeapon('b', sword.id), true); assert.deepEqual(teammate.inventory.katana, { ammo: 0, reserve: 0 });
  assert.equal(simulation.pickups.has(sword.id), false);
});

test('ammo boxes stay untouched by a katana and between-wave/practice refill never invents sword ammunition', () => {
  const { simulation, player } = fixture(false); player.inventory = { katana: { ammo: 0, reserve: 0 } };
  const pickup = { id: 'ammo', kind: 'ammo', x: player.x, y: 0, z: player.z, amount: 1, special: true, charge: PICKUPS.ammoCharge, expiresAt: Infinity };
  simulation.pickups.set(pickup.id, pickup); simulation.collectPickups();
  assert.equal(simulation.pickups.has(pickup.id), true); assert.equal(pickup.charge, PICKUPS.ammoCharge);
  simulation.finishWave(); assert.deepEqual(player.inventory.katana, { ammo: 0, reserve: 0 });
  const stand = fixture(); stand.simulation.practiceAction('a', { action: 'refill' });
  assert.deepEqual(stand.player.inventory.katana, { ammo: 0, reserve: 0 });
});

test('E selects the nearest wall rack where bat and rifle purchase reach overlap', () => {
  for (const weapon of ['bat', 'rifle']) {
    const { simulation, player, events } = fixture(false), rack = ARMORY.find(item => item.weapon === weapon);
    player.weapon = 'pistol'; player.inventory = { pistol: { ammo: 12, reserve: 36 } };
    Object.assign(player, { x: -7.2, y: 0, z: rack.z, points: rack.price }); simulation.wave = rack.unlockWave ?? 1;
    assert.equal(simulation.canOccupy(player, player.x, player.z, 0, .25), true);
    assert.equal(simulation.interact('a'), true, weapon);
    assert.equal(player.weapon, weapon); assert.equal(player.points, 0);
    assert.equal(events.findLast(event => event.event === 'purchase').crateId, rack.id);
    assert.deepEqual(Object.keys(player.inventory), ['pistol', weapon]);
  }
});
