import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { ARMORY, MELEE_WEAPONS, PICKUPS, WEAPON_MOVEMENT } from '../public/rules.js';

function room(practice = true) {
  const events = [], sim = new RoomSimulation('BATTST', { practice, random: () => .5, onEvent: event => events.push(event) });
  const a = sim.addPlayer('a'); sim.zombies.clear();
  if (!practice) { sim.phase = 'countdown'; sim.timeLeft = 999; }
  Object.assign(a, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon: 'bat',
    inventory: { bat: { ammo: 0, reserve: 0 }, pistol: { ammo: 7, reserve: 11 } } });
  return { sim, a, events };
}
function target(sim, id = 'first', options = {}) {
  const zombie = { id, x: 12, y: 0, z: 6.65, yaw: 0, hp: 3000, maxHp: 3000,
    kind: 'walker', scale: 1, speed: 0, attackAfter: Infinity, entered: true, ...options };
  sim.zombies.set(id, zombie); return zombie;
}
function advance(sim, seconds, hz = 30) {
  let remaining = seconds;
  while (remaining > 1e-8) {
    const step = Math.min(1 / hz, remaining);
    for (const player of sim.players.values()) player.lastInputAt = sim.time;
    sim.tick(step); remaining -= step;
  }
}

test('bat light and heavy impacts wait for the server wind-up and full recovery at 10 and 30 Hz', () => {
  for (const hz of [10, 30]) for (const [attack, damage, windup, duration] of [['light', 120, .12, .4], ['heavy', 200, .35, 1]]) {
    const { sim, a, events } = room(), zombie = target(sim);
    assert.equal(sim.shoot('a', 0, attack), true);
    const start = events.find(event => event.event === 'melee-start');
    assert.deepEqual([start.weapon, start.windup, start.duration], ['bat', windup, duration]);
    advance(sim, windup - .001, hz); assert.equal(zombie.hp, 3000);
    advance(sim, .002, hz); assert.equal(zombie.hp, 3000 - damage);
    assert.equal(sim.shoot('a', 1000, 'heavy'), false);
    advance(sim, duration - windup - .002, hz); assert.equal(sim.shoot('a'), false);
    advance(sim, .001, hz); assert.equal(sim.shoot('a'), true);
    assert.equal(events.filter(event => event.event === 'melee-hit').length, 1);
    assert.deepEqual(a.inventory.bat, { ammo: 0, reserve: 0 }); assert.equal(sim.reload('a'), false);
  }
});

test('a bat hits only the nearest body in a dense group with no damage or penetration behind it', () => {
  for (const attack of ['light', 'heavy']) {
    const { sim, events } = room(), first = target(sim), second = target(sim, 'second', { z: 6.45 }), side = target(sim, 'side', { x: 12.35 });
    assert.equal(sim.shoot('a', 0, attack), true); advance(sim, MELEE_WEAPONS.bat[attack].windup + .01);
    assert.equal(first.hp, 3000 - MELEE_WEAPONS.bat[attack].damage);
    assert.equal(second.hp, 3000); assert.equal(side.hp, 3000);
    const hit = events.find(event => event.event === 'melee-hit');
    assert.equal(hit.hits, 1); assert.deepEqual(hit.impacts.map(item => item.zombieId), ['first']);
    assert.ok(!events.some(event => event.event === 'shot'));
  }
});

test('bat damage keeps armor reduction and no headshot bonus, and kills the two first walker families', () => {
  for (const [kind, expected] of [['walker', 120], ['armored', 78]]) {
    const { sim } = room(), zombie = target(sim, 'body', { kind });
    assert.equal(sim.shoot('a'), true); advance(sim, .13); assert.equal(3000 - zombie.hp, expected);
  }
  for (const hp of [80, 115]) {
    const { sim, events } = room(false); target(sim, 'weak', { hp, maxHp: hp });
    sim.shoot('a'); advance(sim, .13);
    assert.equal(sim.zombies.size, 0); assert.equal(events.find(event => event.event === 'kill').headshot, false);
    assert.equal([...sim.pickups.values()].find(item => item.kind === 'points').amount, 18);
  }
});

test('the short bat reach is measured at the body surface and its narrow cone excludes side and rear targets', () => {
  for (const [attack, z, damage] of [['light', 6.08, 120], ['light', 6.079, 0], ['heavy', 5.88, 200], ['heavy', 5.879, 0]]) {
    const { sim } = room(), zombie = target(sim, 'edge', { z });
    sim.shoot('a', 0, attack); advance(sim, MELEE_WEAPONS.bat[attack].windup + .01);
    assert.equal(3000 - zombie.hp, damage, `${attack} target at z=${z}`);
  }
  for (const options of [{ x: 13.8, z: 7.5 }, { z: 9 }, { y: 3.4 }]) {
    const { sim } = room(), zombie = target(sim, 'miss', options);
    sim.shoot('a', 0, 'heavy'); advance(sim, .36); assert.equal(zombie.hp, 3000);
  }
});

test('bat preparation allows walking while the impact uses the current pose, direction and cover', () => {
  const { sim, a } = room(); const zombie = target(sim, 'approach', { z: 5.6 });
  sim.setInput('a', { forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  assert.equal(sim.shoot('a', 0, 'heavy'), true); advance(sim, .351);
  assert.ok(a.z < 7); assert.equal(zombie.hp, 2800); assert.equal(WEAPON_MOVEMENT.bat, 1.08);
  for (const blocked of ['turn', 'wall']) {
    const fixture = room();
    if (blocked === 'wall') { Object.assign(fixture.a, { x: -1, z: -1.3 }); target(fixture.sim, 'behind', { x: -1, z: -2.7 }); }
    else target(fixture.sim);
    fixture.sim.shoot('a', 0, 'heavy');
    if (blocked === 'turn') fixture.sim.setInput('a', { forward: 0, strafe: 0, yaw: Math.PI, pitch: 0 });
    advance(fixture.sim, .36); assert.ok([...fixture.sim.zombies.values()].every(item => item.hp === 3000));
  }
});

test('the early bat purchase preserves two slots and drops the exact replaced gun for a teammate', () => {
  const { sim, a } = room(false), rack = ARMORY.find(item => item.weapon === 'bat');
  Object.assign(a, { x: rack.x + 1.1, y: rack.y, z: rack.z, weapon: 'rifle', points: 250,
    inventory: { rifle: { ammo: 3, reserve: 17 }, pistol: { ammo: 7, reserve: 11 } } });
  assert.equal(rack.unlockWave, 3); assert.equal(rack.price, 250);
  sim.wave = 2; assert.equal(sim.buyWeapon('a', 'bat'), false); assert.equal(a.points, 250);
  sim.wave = 3; sim.time += 1; assert.equal(sim.buyWeapon('a', 'bat'), true);
  assert.equal(a.points, 0); assert.deepEqual(Object.keys(a.inventory).sort(), ['bat', 'pistol']);
  assert.deepEqual(a.inventory.pistol, { ammo: 7, reserve: 11 }); assert.deepEqual(a.inventory.bat, { ammo: 0, reserve: 0 });
  const gun = [...sim.pickups.values()].find(item => item.weapon === 'rifle');
  assert.ok(gun); assert.deepEqual([gun.ammo, gun.reserve], [3, 17]);
  const b = sim.addPlayer('b'); Object.assign(b, { x: gun.x, y: gun.y, z: gun.z });
  assert.equal(sim.takeGroundWeapon('b', gun.id), true); assert.deepEqual(b.inventory.rifle, { ammo: 3, reserve: 17 });
  sim.time += 1; assert.equal(sim.dropWeapon('a'), true);
  const bat = [...sim.pickups.values()].find(item => item.weapon === 'bat');
  assert.ok(bat); Object.assign(b, { x: bat.x, y: bat.y, z: bat.z }); sim.time += 1;
  assert.equal(sim.takeGroundWeapon('b', bat.id), true); assert.deepEqual(b.inventory.bat, { ammo: 0, reserve: 0 });
});

test('a bat never consumes shared ammunition while a whetstone grants ten percent without extra victims', () => {
  const { sim, a } = room(false); a.inventory = { bat: { ammo: 0, reserve: 0 } };
  const box = { id: 'box', kind: 'ammo', x: a.x, y: 0, z: a.z, amount: 1, special: true, charge: PICKUPS.ammoCharge, expiresAt: Infinity };
  sim.pickups.set(box.id, box); sim.collectPickups(); assert.equal(box.charge, PICKUPS.ammoCharge); assert.equal(sim.pickups.has(box.id), true);
  a.bonus = 'stone'; const first = target(sim), second = target(sim, 'second', { z: 6.45 });
  sim.shoot('a', 0, 'heavy'); advance(sim, .36);
  assert.ok(Math.abs(first.hp - 2780) < 1e-8); assert.equal(second.hp, 3000);
  assert.equal(sim.weaponProfile(a).attacks.heavy.maxTargets, 1); assert.equal(WEAPONS.bat.attacks.heavy.damage, 200);
  a.bonus = 'perforating'; assert.equal(sim.weaponProfile(a).penetrationTargets, 1);
  sim.finishWave(); assert.deepEqual(a.inventory.bat, { ammo: 0, reserve: 0 });
});

test('the moved katana rack has a legal purchase approach and leaves the southern loft aisle clear', () => {
  for (const hz of [10, 30]) {
    const { sim, a } = room(false), rack = ARMORY.find(item => item.weapon === 'katana');
    Object.assign(a, { x: rack.x, y: WORLD.loftY, z: rack.z - 1.1, grounded: true, points: rack.price,
      weapon: 'pistol', inventory: { pistol: { ammo: 12, reserve: 36 } } });
    sim.wave = 8; assert.equal(sim.buyWeapon('a', 'katana'), false); sim.time += 1; sim.wave = 9;
    assert.equal(sim.canOccupy(a, a.x, a.z, a.y, .25), true); assert.equal(sim.buyWeapon('a', 'katana'), true);
    Object.assign(a, { x: 3, z: 4.7 }); sim.setInput('a', { forward: 0, strafe: 1, yaw: 0, pitch: 0 });
    advance(sim, 1, hz); assert.ok(a.x > 6.4); assert.equal(a.y, WORLD.loftY);
    assert.equal(sim.canOccupy(a, a.x, a.z, a.y, .25), true);
  }
});
