import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { ARMORY } from '../public/rules.js';

function room() {
  const events = [];
  const simulation = new RoomSimulation('RACK01', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  const teammate = simulation.addPlayer('b');
  simulation.start(player.id);
  Object.assign(simulation, { phase: 'wave', wave: Math.max(...ARMORY.map(rack => rack.unlockWave ?? 1)), toSpawn: 1, spawnTimer: 999 });
  Object.assign(teammate, { x: 0, y: 0, z: 2 });
  return { simulation, player, teammate, events };
}

function approach(player, weapon) {
  const rack = ARMORY.find(crate => crate.weapon === weapon);
  Object.assign(player, { x: rack.x + Math.sin(rack.facing) * 1.1,
    y: rack.y, z: rack.z + Math.cos(rack.facing) * 1.1, yaw: 0, pitch: 0 });
  return rack;
}

function ground(simulation) { return [...simulation.pickups.values()].filter(pickup => pickup.kind === 'weapon'); }
function totalStock(simulation, weapon) {
  return [...simulation.players.values()].reduce((sum, player) => sum + (player.inventory[weapon]?.ammo ?? 0) + (player.inventory[weapon]?.reserve ?? 0), 0)
    + ground(simulation).filter(pickup => pickup.weapon === weapon).reduce((sum, pickup) => sum + pickup.ammo + pickup.reserve, 0);
}

test('all ten wall racks leave the replaced active gun on real nearby support with its exact stock and stable slot', () => {
  for (const rack of ARMORY) {
    const { simulation, player, events } = room();
    const active = rack.weapon === 'rifle' ? 'minigun' : 'rifle';
    const other = rack.weapon === 'pistol' ? 'smg' : 'pistol';
    player.inventory = { [active]: { ammo: 7, reserve: 13 }, [other]: { ammo: 2, reserve: 3 } };
    player.issuedWeapons = new Set([active, other]); player.weapon = active; player.points = rack.price + 127;
    const before = totalStock(simulation, active), otherBefore = structuredClone(player.inventory[other]);
    approach(player, rack.weapon);
    assert.equal(simulation.buyWeapon(player.id, rack.id), true, rack.id);
    assert.equal(player.points, 127);
    assert.deepEqual(Object.keys(player.inventory), [rack.weapon, other]);
    assert.equal(player.weapon, rack.weapon);
    assert.deepEqual(player.inventory[other], otherBefore);
    assert.deepEqual(player.inventory[rack.weapon], { ammo: WEAPONS[rack.weapon].magazine, reserve: WEAPONS[rack.weapon].reserve });
    const [abandoned] = ground(simulation);
    assert.equal(ground(simulation).length, 1);
    assert.equal(abandoned.weapon, active);
    assert.equal(abandoned.ammo, 7); assert.equal(abandoned.reserve, 13);
    assert.equal(abandoned.y, rack.y); assert.equal(abandoned.expiresAt, Infinity);
    assert.equal(simulation.canCollectPickup(player, abandoned), true);
    assert.equal(simulation.interactionVisible(player, abandoned), true);
    assert.equal(totalStock(simulation, active), before, 'The purchase must conserve every previously owned round');
    assert.equal(simulation.snapshot().pickups.find(pickup => pickup.id === abandoned.id).expiresIn, null);
    assert.equal(events.filter(event => event.event === 'weapon-drop').at(-1).exchange, true);
    assert.equal(events.filter(event => event.event === 'purchase').at(-1).replacedWeapon, active);
    simulation.collectPickups();
    assert.equal(ground(simulation).length, 1, 'Walking on the old gun does not automatically swap it back');
  }
});

test('the buyer or a teammate can retrieve the gun dropped by a rack purchase once without duplicated ammunition', () => {
  for (const recipient of ['buyer', 'teammate']) {
    const { simulation, player, teammate } = room();
    player.inventory = { pistol: { ammo: 3, reserve: 4 }, rifle: { ammo: 2, reserve: 9 } };
    player.issuedWeapons.add('rifle'); player.weapon = 'rifle';
    const rack = approach(player, 'shotgun'); player.points = rack.price;
    const oldStock = totalStock(simulation, 'rifle');
    assert.equal(simulation.buyWeapon(player.id, rack.id), true);
    const abandoned = ground(simulation)[0], receiver = recipient === 'buyer' ? player : teammate;
    simulation.time += 1;
    Object.assign(receiver, { x: abandoned.x, y: abandoned.y, z: abandoned.z });
    assert.equal(simulation.takeGroundWeapon(receiver.id, abandoned.id), true);
    assert.deepEqual(receiver.inventory.rifle, { ammo: 2, reserve: 9 });
    assert.equal(receiver.weapon, 'rifle');
    assert.equal(totalStock(simulation, 'rifle'), oldStock);
    assert.equal(simulation.takeGroundWeapon(receiver.id, abandoned.id), false);
    assert.equal(simulation.takeGroundWeapon(recipient === 'buyer' ? teammate.id : player.id, abandoned.id), false);
    assert.equal(totalStock(simulation, 'rifle'), oldStock);
    assert.equal(receiver.issuedWeapons.has('rifle'), true);
    if (recipient === 'buyer') {
      assert.deepEqual(Object.keys(player.inventory), ['pistol', 'rifle']);
      const [shotgun] = ground(simulation);
      assert.equal(shotgun.weapon, 'shotgun');
      assert.deepEqual([shotgun.ammo, shotgun.reserve], [WEAPONS.shotgun.magazine, WEAPONS.shotgun.reserve]);
    }
  }
});

test('a rack exchange cancels a pending reload or Gatling rotation without transferring future rounds into the dropped stock', () => {
  for (const active of ['rifle', 'minigun']) {
    const { simulation, player, events } = room();
    player.inventory = { pistol: { ammo: 3, reserve: 4 }, [active]: { ammo: 2, reserve: 7 } };
    player.issuedWeapons.add(active); player.weapon = active;
    const rack = approach(player, 'shotgun'); player.points = rack.price;
    if (active === 'rifle') player.reloadUntil = simulation.time + .1;
    else assert.equal(simulation.setMinigunSpin(player.id, true), true);
    assert.equal(simulation.buyWeapon(player.id, rack.id), true);
    assert.equal(player.reloadUntil, 0);
    assert.equal(player.minigunSpinning, false); assert.equal(player.minigunSpinUntil, 0);
    if (active === 'minigun') assert.equal(events.some(event => event.event === 'minigun-spin' && event.spinning === false), true);
    const [abandoned] = ground(simulation);
    simulation.tick(.1);
    assert.deepEqual([abandoned.ammo, abandoned.reserve], [2, 7]);
    assert.deepEqual(player.inventory.shotgun, { ammo: WEAPONS.shotgun.magazine, reserve: WEAPONS.shotgun.reserve });
  }
});

test('a rack exchange without supporting space refuses before charging money or losing either gun', () => {
  const { simulation, player, events } = room();
  player.inventory = { pistol: { ammo: 3, reserve: 4 }, rifle: { ammo: 2, reserve: 7 } };
  player.issuedWeapons.add('rifle'); player.weapon = 'rifle';
  const rack = approach(player, 'shotgun'); player.points = rack.price + 9;
  player.reloadUntil = simulation.time + 10;
  const before = structuredClone({ inventory: player.inventory, points: player.points, weapon: player.weapon,
    issuedWeapons: [...player.issuedWeapons], reloadUntil: player.reloadUntil, nextPickupId: simulation.nextPickupId });
  // Test the transaction boundary independently of the current cabin furniture.
  simulation.groundWeaponPosition = () => null;
  assert.equal(simulation.buyWeapon(player.id, rack.id), false);
  assert.deepEqual({ inventory: player.inventory, points: player.points, weapon: player.weapon,
    issuedWeapons: [...player.issuedWeapons], reloadUntil: player.reloadUntil, nextPickupId: simulation.nextPickupId }, before);
  assert.equal(ground(simulation).length, 0);
  assert.equal(events.some(event => event.event === 'purchase'), false);
  assert.equal(events.at(-1).event, 'weapon-drop-denied'); assert.equal(events.at(-1).reason, 'space');
  assert.ok(player.interactAfter > simulation.time);
});

test('a free second slot adds the rack weapon and an already owned model only equips its existing stock', () => {
  const { simulation, player } = room();
  const rack = approach(player, 'rifle'); player.points = rack.price + 100;
  player.inventory.pistol = { ammo: 3, reserve: 4 };
  assert.equal(simulation.buyWeapon(player.id, rack.id), true);
  assert.deepEqual(Object.keys(player.inventory), ['pistol', 'rifle']);
  assert.equal(ground(simulation).length, 0);
  player.inventory.rifle = { ammo: 1, reserve: 2 };
  simulation.chooseWeapon(player.id, 'pistol'); simulation.time += 1;
  assert.equal(simulation.buyWeapon(player.id, rack.id), true);
  assert.equal(player.weapon, 'rifle'); assert.equal(player.points, 100);
  assert.deepEqual(player.inventory.rifle, { ammo: 1, reserve: 2 });
  assert.deepEqual(player.inventory.pistol, { ammo: 3, reserve: 4 });
  assert.equal(ground(simulation).length, 0);
});
