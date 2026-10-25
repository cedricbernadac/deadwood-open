import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { BALLISTICS, sampleBulletAtDistance } from '../public/ballistics.js';
import { BARRICADE_BOARDS } from '../public/rules.js';
import { STAIRS, STAIR_STRINGERS } from '../public/stairs.js';
import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';

const near = (actual, expected, tolerance = 1e-4) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function fixture({ weapon = 'assault', practice = false, online = false } = {}) {
  const events = [], clock = { now: 1000 };
  const Type = online ? OnlineRoomSimulation : RoomSimulation;
  const simulation = new Type('CABFLT', { practice, ambiance: 'frisson', raids: false, random: () => .5, clock: () => clock.now,
    onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a'); simulation.start('a');
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 10000; simulation.zombies.clear();
  Object.assign(player, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon, weaponId: weapon,
    inventory: { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve } } });
  if (weapon === 'minigun') { player.minigunSpinning = true; player.minigunSpinUntil = 0; }
  return { simulation, player, events, clock };
}
function target(simulation, player, distance, id = 'target', overrides = {}) {
  const zombie = { id, x: player.x, y: .4, z: player.z - distance - .32, hp: 10000, maxHp: 10000,
    kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, ...overrides };
  simulation.zombies.set(id, zombie); return zombie;
}
function advance(simulation, duration, step = 1 / 30) {
  let remaining = duration;
  while (remaining > 1e-10) { const dt = Math.min(step, remaining); simulation.time += dt; simulation.updateBullets(dt); remaining -= dt; }
}

test('every firearm in cabin and practice spends ammunition now and applies body damage only on arrival', () => {
  for (const practice of [false, true]) for (const weapon of ['pistol', 'smg', 'shotgun', 'rifle', 'assault', 'minigun', 'sniper', 'magnum']) {
    const { simulation, player, events } = fixture({ weapon, practice }), zombie = target(simulation, player, 10);
    assert.equal(simulation.snapshot().ballisticsEnabled, true);
    assert.equal(simulation.shoot(player.id), true);
    assert.equal(player.inventory[weapon].ammo, WEAPONS[weapon].magazine - 1);
    assert.equal(zombie.hp, 10000); assert.equal(player.score, 0);
    assert.equal(events.at(-1).ballistic, true); assert.equal(events.at(-1).projectiles.length, WEAPONS[weapon].pellets);
    advance(simulation, .01); assert.equal(zombie.hp, 10000, `${weapon}: no early impact`);
    advance(simulation, .15);
    near(10000 - zombie.hp, sampleBulletAtDistance(WEAPONS[weapon], 10).damage * WEAPONS[weapon].pellets);
    assert.equal(events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie').length, WEAPONS[weapon].pellets);
  }
});

test('a projectile tests the target at arrival rather than capturing its old aim intersection', () => {
  for (const entering of [false, true]) {
    const { simulation, player } = fixture(), zombie = target(simulation, player, 30);
    if (entering) zombie.x += 3;
    simulation.shoot(player.id); advance(simulation, .04);
    zombie.x += entering ? -3 : 3; advance(simulation, .2);
    assert.equal(zombie.hp < 10000, entering);
  }
});

test('duplicate inventory copies and captured bonuses stay independent while a round is in flight', () => {
  const { simulation, player, events } = fixture(), zombie = target(simulation, player, 20);
  player.inventory = { assault: { ammo: 5, reserve: 9 }, 'assault#2': { weapon: 'assault', ammo: 3, reserve: 11 } };
  player.weaponId = 'assault#2'; player.bonus = { reinforced: 4 };
  assert.equal(simulation.shoot(player.id), true);
  assert.equal(player.inventory.assault.ammo, 5); assert.equal(player.inventory['assault#2'].ammo, 2);
  assert.equal(events.at(-1).weaponId, 'assault#2');
  simulation.chooseWeapon(player.id, 'assault'); player.bonus = null;
  advance(simulation, .2);
  near(10000 - zombie.hp, sampleBulletAtDistance(WEAPONS.assault, 20).damage * 1.3);
  assert.equal(events.find(event => event.event === 'bullet-impact' && event.stop === 'zombie').weaponId, 'assault#2');
});

test('penetrating bullets lose energy once per body and preserve their captured target cap', () => {
  const { simulation, player, events } = fixture({ weapon: 'rifle' });
  const bodies = [4, 8, 12, 16].map((distance, i) => target(simulation, player, distance, `body${i}`));
  simulation.shoot(player.id); advance(simulation, .4);
  for (let i = 0; i < 3; i++) {
    const hit = events.find(event => event.event === 'bullet-impact' && event.zombieId === `body${i}`);
    assert.ok(hit); near(10000 - bodies[i].hp, hit.power);
    const travelled = hit.continuation?.distanceOffset ?? sampleBulletAtDistance(WEAPONS.rifle, 12).distance;
    if (i < 2) near(hit.power, sampleBulletAtDistance(WEAPONS.rifle, travelled).damage * .65 ** i);
    assert.equal(hit.terminal, i === 2);
  }
  assert.equal(bodies[3].hp, 10000);
});

test('a board takes damage on arrival, stops even the breaking round, and exposes its actual opening afterward', () => {
  const { simulation, player, events } = fixture();
  const door = simulation.doors.find(door => door.id === 'north'), board = BARRICADE_BOARDS[2];
  door.sealed = false; door.boards[2] = 1;
  Object.assign(player, { x: 0, z: -4, pitch: Math.atan2(board.y - 1.55, 2) });
  const zombie = target(simulation, player, 3, 'behind');
  simulation.shoot(player.id); assert.equal(door.boards[2], 1); assert.equal(zombie.hp, 10000);
  advance(simulation, .1); assert.equal(door.boards[2], 0); assert.equal(zombie.hp, 10000);
  const hit = events.find(event => event.event === 'bullet-impact' && event.stop === 'board');
  assert.equal(hit.doorId, 'north'); assert.equal(hit.boardIndex, 2); assert.equal(hit.terminal, true);
  assert.equal(door.repairCredit, 0, 'self damage cannot farm repair credit');
  simulation.time = player.shotAfter; simulation.shoot(player.id); advance(simulation, .1);
  assert.ok(zombie.hp < 10000);
});

test('cabin floors, loft slabs, partitions, stair treads, stringers and roof intercept swept flight', () => {
  const cases = [
    { name: 'floor', pose: { x: 12, y: 0, z: 8, pitch: -1.1 }, check: hit => near(hit.y, 0, 1e-7) },
    { name: 'loft', pose: { x: 6, y: 0, z: 3, pitch: Math.PI / 2 }, check: hit => near(hit.y, WORLD.loftY - WORLD.loft.thickness, 1e-7) },
    { name: 'partition', pose: { x: -1, y: 0, z: -1, pitch: 0 }, check: hit => assert.ok(hit.z > -2) },
    { name: 'tread', pose: { x: (STAIRS.minX + STAIRS.maxX) / 2, y: 0, z: -1, pitch: 1.48 }, check: hit => assert.ok(hit.y < 2.8) },
    { name: 'stringer', pose: { x: STAIR_STRINGERS[0].x, y: 0, z: -1, pitch: 1.48 }, check: hit => assert.ok(hit.y < 2.8) },
    { name: 'roof', pose: { x: 6, y: WORLD.loftY, z: 0, pitch: 1.48 }, check: hit => assert.ok(hit.y > 6 && hit.y < 6.9) },
  ];
  for (const step of [1 / 30, .1]) for (const { name, pose, check } of cases) {
    const { simulation, player, events } = fixture(); Object.assign(player, pose);
    simulation.shoot(player.id); advance(simulation, .3, step);
    const hit = events.find(event => event.event === 'bullet-impact');
    assert.ok(hit, name); assert.equal(hit.stop, 'solid', name); check(hit); assert.equal(simulation.bullets.size, 0);
  }
});

test('a later physical impact keeps online shot identity and uses present targets without hitscan rewind', () => {
  const { simulation, player, events, clock } = fixture({ online: true }), zombie = target(simulation, player, 10);
  simulation.recordHistory(clock.now); zombie.x += 3; clock.now += 200;
  assert.equal(simulation.shootOnline(player.id, 0, { shotId: 7, yaw: 0, pitch: 0, viewTime: clock.now - 200 }, { rttMs: 200 }), true);
  advance(simulation, .15); assert.equal(zombie.hp, 10000);
  zombie.x -= 3; simulation.time = Math.max(simulation.time, player.shotAfter); clock.now += 200;
  assert.equal(simulation.shootOnline(player.id, 0, { shotId: 8, yaw: 0, pitch: 0, viewTime: clock.now - 200 }), true);
  assert.equal(zombie.hp, 10000); advance(simulation, .1);
  const hit = events.find(event => event.event === 'bullet-impact' && event.stop === 'zombie');
  assert.equal(hit.shotId, 8); near(hit.power, 42);
});

test('pause, terminal phases and restart clear or freeze real flight without delayed damage', () => {
  const { simulation, player } = fixture(), zombie = target(simulation, player, 30);
  simulation.shoot(player.id); simulation.paused = true; const before = simulation.time;
  simulation.tick(.1); assert.equal(simulation.time, before); assert.equal(zombie.hp, 10000); assert.equal(simulation.bullets.size, 1);
  simulation.paused = false; simulation.endGame(); assert.equal(simulation.bullets.size, 0);
  simulation.tick(.1); assert.equal(zombie.hp, 10000);
  simulation.start(player.id); assert.equal(simulation.bullets.size, 0);
});

test('capacity refuses a complete shotgun discharge before consuming the selected stock or cadence', () => {
  const { simulation, player, events } = fixture({ weapon: 'shotgun' });
  for (let index = 0; index < BALLISTICS.maxActive - 8; index++) simulation.bullets.set(`held${index}`, {});
  const before = player.shotAfter;
  assert.equal(simulation.shoot(player.id), false); assert.equal(player.inventory.shotgun.ammo, 8); assert.equal(player.shotAfter, before);
  assert.equal(events.at(-1).event, 'bullet-denied'); assert.equal(events.at(-1).reason, 'capacity');
});

test('the Magnum has finite damage and remains exempt from reinforced and perforating bonuses', () => {
  const { simulation, player } = fixture({ weapon: 'magnum' }), zombie = target(simulation, player, 10);
  player.bonus = { reinforced: 8, perforating: 8 };
  assert.equal(simulation.bonusFitsWeapons(player, 'reinforced'), false);
  assert.equal(simulation.bonusFitsWeapons(player, 'perforating'), false);
  const profile = simulation.weaponProfile(player);
  assert.equal(profile.damage, WEAPONS.magnum.damage); assert.equal(profile.penetrationTargets, 1);
  simulation.shoot(player.id); advance(simulation, .1);
  assert.ok(zombie.hp > 8000); near(10000 - zombie.hp, sampleBulletAtDistance(WEAPONS.magnum, 10).damage);
});

test('one shotgun shell preserves its fallen-body wounds without extra damage, kills or later-shot corpses', () => {
  const { simulation, player, events } = fixture({ weapon: 'shotgun' });
  const body = target(simulation, player, 3, 'fallen', { hp: 1 });
  simulation.shoot(player.id);
  const shot = events.find(event => event.event === 'shot');
  const first = settleBallisticFlight(simulation);
  const wounds = first.impacts.filter(event => event.zombieId === body.id);
  assert.equal(wounds.length, WEAPONS.shotgun.pellets);
  assert.equal(wounds.filter(event => !event.visualOnly).length, 1);
  assert.equal(wounds.filter(event => event.visualOnly && event.damage === 0 && event.power > 0 && !event.terminal).length, 8);
  assert.equal(wounds.reduce((sum, event) => sum + event.damage, 0), 1);
  assert.ok(wounds.every(event => event.shotGroupId === shot.shotGroupId && event.feet.length === 3));
  assert.equal(first.events.filter(event => event.event === 'kill').length, 1);
  assert.equal(player.kills, 1);
  const score = player.score;
  simulation.time = Math.max(simulation.time, player.shotAfter); simulation.shoot(player.id);
  assert.equal(settleBallisticFlight(simulation).impacts.filter(event => event.zombieId === body.id).length, 0);
  assert.equal(player.score, score); assert.equal(player.kills, 1);
});

test('physical contacts expose blood metadata only for infected in Frisson ambiances', () => {
  for (const ambiance of ['family', 'frisson', 'frisson-leger']) for (const kind of ['walker', 'raider']) {
    const { simulation, player } = fixture(); simulation.ambiance = ambiance;
    target(simulation, player, 3, 'body', { kind }); simulation.shoot(player.id);
    const hit = settleBallisticFlight(simulation).impacts.find(event => event.zombieId === 'body');
    assert.ok(hit, `${ambiance}/${kind}`);
    const blood = ambiance !== 'family' && kind !== 'raider';
    assert.equal(Object.hasOwn(hit, 'power'), blood); assert.equal(Object.hasOwn(hit, 'feet'), blood);
  }
});
