import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { ARMORY, FIRE_INTERVALS, PICKUPS, WEAPON_MOVEMENT, armoryRackBounds } from '../public/rules.js';
import { DOOR_OPENING, WINDOWS } from '../public/layout.js';

function room(practice = true) {
  const events = [], sim = new RoomSimulation('AXETST', { practice, random: () => .5, onEvent: event => events.push(event) });
  const a = sim.addPlayer('a'); sim.zombies.clear();
  if (!practice) { sim.phase = 'countdown'; sim.timeLeft = 999; }
  Object.assign(a, { x: 12, y: 0, z: 8, yaw: 0, pitch: 0, weapon: 'fireaxe',
    inventory: { fireaxe: { ammo: 0, reserve: 0 }, pistol: { ammo: 7, reserve: 11 } } });
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

test('fire axe attacks wait for their authoritative wind-up and recover between bat and hammer', () => {
  const weapon = WEAPONS.fireaxe;
  assert.equal(weapon.melee, true); assert.equal(weapon.interval, FIRE_INTERVALS.fireaxe);
  for (const hz of [10, 30]) for (const attack of ['light', 'heavy']) {
    const { sim, a, events } = room(), zombie = target(sim), profile = weapon.attacks[attack];
    assert.ok(profile.duration > WEAPONS.bat.attacks[attack].duration);
    assert.ok(profile.duration < WEAPONS.hammer.attacks[attack].duration);
    assert.equal(sim.shoot('a', 0, attack), true);
    const start = events.find(event => event.event === 'melee-start');
    assert.deepEqual([start.weapon, start.attack, start.windup, start.duration], ['fireaxe', attack, profile.windup, profile.duration]);
    advance(sim, profile.windup - .001, hz); assert.equal(zombie.hp, 3000);
    advance(sim, .002, hz); assert.equal(zombie.hp, 3000 - profile.damage);
    assert.equal(sim.shoot('a', 0, attack), false);
    advance(sim, profile.duration - profile.windup - .002, hz); assert.equal(sim.shoot('a', 0, attack), false);
    advance(sim, .001, hz); assert.equal(sim.shoot('a', 0, attack), true);
    assert.deepEqual(a.inventory.fireaxe, { ammo: 0, reserve: 0 }); assert.equal(sim.reload('a'), false);
    assert.equal(events.filter(event => event.event === 'melee-hit').length, 1);
  }
});

test('a broad fire axe sweep damages two nearest bodies, retains 75 percent on the second and leaves the third intact', () => {
  for (const attack of ['light', 'heavy']) {
    const { sim, events } = room(), first = target(sim), second = target(sim, 'second', { z: 6.45 }), third = target(sim, 'third', { z: 6.25 });
    const profile = WEAPONS.fireaxe.attacks[attack];
    assert.equal(sim.shoot('a', 0, attack), true); advance(sim, profile.windup + .001);
    assert.equal(3000 - first.hp, profile.damage); assert.equal(3000 - second.hp, profile.damage * .75); assert.equal(third.hp, 3000);
    const hit = events.find(event => event.event === 'melee-hit');
    assert.equal(hit.hits, 2); assert.deepEqual(hit.impacts.map(impact => impact.zombieId), ['first', 'second']);
    assert.ok(!events.some(event => event.event === 'shot'));
  }
  // A 60-degree target is exposed to the axe's full 100-degree sweep because
  // the near corner of its body is inside the cone; the bat still misses it.
  for (const [weapon, expected] of [['fireaxe', 160], ['bat', 0]]) {
    const { sim, a } = room(); a.weapon = weapon; a.inventory = { [weapon]: { ammo: 0, reserve: 0 } };
    const zombie = target(sim, 'wide', { x: 13.3, z: 7.25 });
    sim.shoot('a'); advance(sim, WEAPONS[weapon].attacks.light.windup + .001);
    assert.equal(3000 - zombie.hp, expected);
  }
});

test('fire axe reach uses the real near body surface while the rear and another floor remain safe', () => {
  for (const [attack, z, expected] of [['light', 5.88, 160], ['light', 5.879, 0], ['heavy', 5.68, 320], ['heavy', 5.679, 0]]) {
    const { sim } = room(), zombie = target(sim, 'edge', { z });
    sim.shoot('a', 0, attack); advance(sim, WEAPONS.fireaxe.attacks[attack].windup + .001);
    assert.equal(3000 - zombie.hp, expected, `${attack}, z=${z}`);
  }
  for (const options of [{ z: 9.5 }, { x: 14.5, z: 7.8 }, { y: 3.4 }]) {
    const { sim } = room(), zombie = target(sim, 'miss', options);
    sim.shoot('a', 0, 'heavy'); advance(sim, .551); assert.equal(zombie.hp, 3000);
  }
});

test('fire axe damage obeys armor without headshot multipliers and grants ordinary melee kill loot', () => {
  for (const [kind, expected] of [['walker', 160], ['armored', 104]]) {
    const { sim, a } = room(); a.pitch = .2;
    const zombie = target(sim, 'body', { kind });
    sim.shoot('a'); advance(sim, .401); assert.equal(3000 - zombie.hp, expected);
  }
  const { sim, events } = room(false); target(sim, 'weak', { hp: 80, maxHp: 80 });
  sim.shoot('a'); advance(sim, .401);
  assert.equal(sim.zombies.size, 0); assert.equal(events.find(event => event.event === 'kill').headshot, false);
  // Coins slide to a nearby survivor: the drop may already be collected.
  const coin = [...sim.pickups.values()].find(item => item.kind === 'points');
  assert.equal(coin?.amount ?? events.find(event => event.event === 'pickup' && event.kind === 'points')?.amount, 18);
});

test('fire axe preparation permits walking and re-evaluates direction and cover at impact', () => {
  const { sim, a } = room(), zombie = target(sim, 'approach', { z: 4.5 });
  sim.setInput('a', { forward: 1, strafe: 0, yaw: 0, pitch: 0 });
  assert.equal(sim.shoot('a', 0, 'heavy'), true); advance(sim, .551);
  assert.ok(a.z < 6.4); assert.equal(zombie.hp, 2680); assert.equal(WEAPON_MOVEMENT.fireaxe, 1);
  for (const blocked of ['turn', 'wall', 'plate']) {
    const fixture = room();
    if (blocked === 'wall') { Object.assign(fixture.a, { x: -1, z: -1.3 }); target(fixture.sim, 'behind', { x: -1, z: -2.7 }); }
    else if (blocked === 'plate') {
      Object.assign(fixture.a, { x: 0, z: -5.2 }); target(fixture.sim, 'behind', { x: 0, z: -6.5 });
      const door = fixture.sim.doors.find(item => item.id === 'north'); door.sealed = true;
    }
    else target(fixture.sim);
    fixture.sim.shoot('a', 0, 'heavy');
    if (blocked === 'turn') fixture.sim.setInput('a', { forward: 0, strafe: 0, yaw: Math.PI, pitch: 0 });
    advance(fixture.sim, .551); assert.ok([...fixture.sim.zombies.values()].every(item => item.hp === 3000), blocked);
  }
});

test('switching, dropping, being downed or pausing cancels a prepared fire axe hit without resetting recovery', () => {
  for (const action of ['switch', 'drop', 'down', 'pause']) {
    const { sim, a, events } = room(), zombie = target(sim);
    sim.shoot('a', 0, 'heavy'); const ready = a.meleeAfter;
    if (action === 'switch') sim.chooseWeapon('a', 'pistol');
    if (action === 'drop') assert.equal(sim.dropWeapon('a'), true);
    if (action === 'down') a.downed = true;
    if (action === 'pause') assert.equal(sim.setPause('a', true), true);
    advance(sim, 1);
    assert.equal(zombie.hp, 3000); assert.equal(a.pendingMelee, null); assert.equal(a.meleeAfter, ready);
    assert.ok(events.some(event => event.event === 'melee-cancel'));
  }
});

test('fire axe ammunition is always zero and existing generic whetstone and perforating rules remain bounded', () => {
  const { sim, a } = room(false); a.inventory = { fireaxe: { ammo: 0, reserve: 0 } };
  const box = { id: 'box', kind: 'ammo', x: a.x, y: 0, z: a.z, amount: 1, special: true, charge: PICKUPS.ammoCharge, expiresAt: Infinity };
  sim.pickups.set(box.id, box); sim.collectPickups(); assert.equal(box.charge, PICKUPS.ammoCharge); assert.equal(sim.pickups.has(box.id), true);
  a.bonus = 'stone'; const first = target(sim), second = target(sim, 'second', { z: 6.45 }), third = target(sim, 'third', { z: 6.25 });
  sim.shoot('a', 0, 'heavy'); advance(sim, .551);
  assert.ok(Math.abs(3000 - first.hp - 352) < 1e-8); assert.ok(Math.abs(3000 - second.hp - 264) < 1e-8); assert.equal(third.hp, 3000);
  assert.equal(WEAPONS.fireaxe.attacks.heavy.damage, 320); assert.equal(sim.weaponProfile(a).attacks.heavy.maxTargets, 2);
  a.bonus = 'perforating'; assert.equal(sim.weaponProfile(a).penetrationTargets, 2);
  sim.finishWave(); assert.deepEqual(a.inventory.fireaxe, { ammo: 0, reserve: 0 });
});

test('the fire axe rack hangs on the solid boarded north window with a legal approach and no blocked doorway or open window', () => {
  const { sim, a } = room(false), rack = ARMORY.find(item => item.weapon === 'fireaxe'), bounds = armoryRackBounds(rack);
  assert.deepEqual([rack.price, rack.unlockWave], [600, 5]);
  assert.equal(rack.z, -5.79); assert.equal(rack.y, 0);
  const overlap = (min, max, centre, width) => min < centre + width / 2 && max > centre - width / 2;
  assert.equal(overlap(bounds.minX, bounds.maxX, DOOR_OPENING.center, DOOR_OPENING.width), false);
  for (const window of WINDOWS.filter(item => item.wall === 'north' && item.open))
    assert.equal(overlap(bounds.minX, bounds.maxX, window.center, window.width), false);
  const boardedWindow = WINDOWS.find(item => item.wall === 'north' && !item.open);
  assert.ok(bounds.minX > boardedWindow.center - boardedWindow.width / 2);
  assert.ok(bounds.maxX < boardedWindow.center + boardedWindow.width / 2);
  assert.ok(sim.solidBoxes().some(box => box.minX <= rack.x && box.maxX >= rack.x && box.minZ <= -6 && box.maxZ >= -6
    && box.minY < 1.55 && box.maxY > 1.55), 'the boarded window remains a real solid wall');
  for (const other of ARMORY.filter(item => item.weapon !== 'fireaxe' && item.y === rack.y)) {
    const otherBounds = armoryRackBounds(other);
    assert.ok(bounds.maxX <= otherBounds.minX || bounds.minX >= otherBounds.maxX || bounds.maxZ <= otherBounds.minZ || bounds.minZ >= otherBounds.maxZ);
  }
  Object.assign(a, { x: rack.x, y: 0, z: rack.z + 1.1, weapon: 'pistol', inventory: { pistol: { ammo: 7, reserve: 11 } }, points: 600 });
  assert.equal(sim.canOccupy(a, a.x, a.z, a.y, .25), true);
  sim.wave = 4; assert.equal(sim.buyWeapon('a', 'fireaxe'), false); assert.equal(a.points, 600);
  sim.time += 1; sim.wave = 5; assert.equal(sim.buyWeapon('a', 'fireaxe'), true);
  assert.equal(a.points, 0); assert.equal(a.weapon, 'fireaxe'); assert.deepEqual(a.inventory.fireaxe, { ammo: 0, reserve: 0 });
  assert.equal(WORLD.armory.includes(rack), true);
});

test('buying a fire axe drops the replaced gun with its exact ammunition and teammates can trade the axe', () => {
  const { sim, a } = room(false), rack = ARMORY.find(item => item.weapon === 'fireaxe');
  Object.assign(a, { x: rack.x, y: rack.y, z: rack.z + 1.1, weapon: 'rifle', points: rack.price,
    inventory: { rifle: { ammo: 3, reserve: 17 }, pistol: { ammo: 7, reserve: 11 } } });
  sim.wave = 5; assert.equal(sim.buyWeapon('a', 'fireaxe'), true);
  assert.deepEqual(Object.keys(a.inventory), ['fireaxe', 'pistol']); assert.deepEqual(a.inventory.pistol, { ammo: 7, reserve: 11 });
  const gun = [...sim.pickups.values()].find(item => item.weapon === 'rifle');
  assert.ok(gun); assert.deepEqual([gun.ammo, gun.reserve], [3, 17]);
  const b = sim.addPlayer('b'); Object.assign(b, { x: gun.x, y: gun.y, z: gun.z });
  assert.equal(sim.takeGroundWeapon('b', gun.id), true); assert.deepEqual(b.inventory.rifle, { ammo: 3, reserve: 17 });
  sim.time += 1; assert.equal(sim.dropWeapon('a'), true);
  const axe = [...sim.pickups.values()].find(item => item.weapon === 'fireaxe'); assert.ok(axe);
  Object.assign(b, { x: axe.x, y: axe.y, z: axe.z }); sim.time += 1;
  assert.equal(sim.takeGroundWeapon('b', axe.id), true); assert.deepEqual(b.inventory.fireaxe, { ammo: 0, reserve: 0 });
  assert.equal(sim.takeGroundWeapon('a', axe.id), false); assert.equal(sim.players.get('a').weapon, 'pistol');
});

test('the fire axe rack cannot become a standing or crouching perch under the unbroken loft slab', () => {
  const { sim, a } = room(), axe = ARMORY.find(item => item.weapon === 'fireaxe'), rack = armoryRackBounds(axe);
  const top = rack.baseY + rack.height;
  for (const crouched of [false, true]) for (const x of [rack.minX - .24, rack.minX, axe.x, rack.maxX, rack.maxX + .24])
    for (const z of [rack.minZ - .24, rack.minZ, (rack.minZ + rack.maxZ) / 2, rack.maxZ, rack.maxZ + .24]) {
      Object.assign(a, { x, y: top, z, crouched });
      assert.equal(sim.canOccupy(a, x, z, top, .25), false, `${crouched ? 'crouched' : 'standing'} at ${x},${z}`);
    }
});
