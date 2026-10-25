import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { ARMORY, BACKPACK as SHARED_BACKPACK, MAX_WEAPON_SLOTS, PLAYER_POSTURE, WEAPON_MOVEMENT } from '../public/rules.js';
import { BACKPACK, LATE_SUPPLIES } from '../public/weapon-upgrades.js';
import { completeRevive } from './helpers/revive.mjs';

function room(wave = 10, practice = false) {
  const events = [], sim = new RoomSimulation('PACK', { practice, random: () => .5, onEvent: event => events.push(event) });
  const a = sim.addPlayer('a'), b = sim.addPlayer('b');
  if (!practice) { sim.wave = wave - 1; sim.beginWave(); sim.toSpawn = 1; sim.spawnTimer = 999; }
  return { sim, a, b, events };
}
function station(player) { Object.assign(player, { x: LATE_SUPPLIES.position.x, y: 0, z: LATE_SUPPLIES.position.z + 1, interactAfter: 0 }); }
function purchasePack(sim, player) {
  station(player); player.points = Math.max(player.points, BACKPACK.price);
  assert.equal(sim.buySupply(player.id, 'backpack'), true);
}
function equip(player, ids, active = ids[0]) {
  player.inventory = Object.fromEntries(ids.map(id => [id, { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve }]));
  player.weapon = active;
}
function atRack(player, id) {
  const rack = ARMORY.find(item => item.weapon === id);
  Object.assign(player, { x: rack.x + Math.sin(rack.facing), y: rack.y, z: rack.z + Math.cos(rack.facing), interactAfter: 0 });
  return rack;
}
function heldAndGround(sim) {
  const all = [];
  for (const player of sim.players.values()) for (const [weapon, stock] of Object.entries(player.inventory)) all.push([weapon, stock.ammo, stock.reserve]);
  for (const pickup of sim.pickups.values()) if (pickup.kind === 'weapon') all.push([pickup.weapon, pickup.ammo, pickup.reserve]);
  return all.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2] - b[2]);
}

test('the shared permanent backpack rule is distinct from temporary bonuses and advanced service waves', () => {
  assert.strictEqual(SHARED_BACKPACK, BACKPACK); assert.strictEqual(LATE_SUPPLIES.items.backpack, BACKPACK);
  assert.deepEqual(BACKPACK, { price: 1500, unlockWave: 10, slots: 4, movementMultipliers: { 3: .9, 4: .85 } });
  assert.equal(Object.isFrozen(BACKPACK.movementMultipliers), true);
  assert.equal(Object.isFrozen(BACKPACK), true); assert.equal(MAX_WEAPON_SLOTS, 2); assert.equal(LATE_SUPPLIES.unlockWave, 15);
});

test('new players retain the original two slots and input cannot forge a backpack or movement multiplier', () => {
  const { sim, a } = room();
  assert.equal(a.backpack, false); assert.equal(sim.weaponSlots(a), 2);
  assert.equal(sim.setInput(a.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0, backpack: true, weaponSlots: 99, movementMultiplier: 9 }), true);
  const state = sim.snapshot();
  assert.equal(state.maxWeaponSlots, 2); assert.equal(state.players[0].backpack, false);
  assert.equal(state.players[0].weaponSlots, 2); assert.equal(state.players[0].movementMultiplier, WEAPON_MOVEMENT.pistol);
});

test('the station opens at wave five with the revive kit, the backpack at ten, its old services at fifteen', () => {
  for (const wave of [4, 5, 9, 10, 14, 15]) {
    const { sim, a } = room(wave); station(a); a.points = 99999; a.inventory.pistol = { ammo: 0, reserve: 0 };
    assert.equal(sim.supplyAction(a), wave >= 5 ? 'station' : null);
    assert.equal(sim.buySupply(a.id, 'revive'), wave >= 5, `revive kit, wave ${wave}`);
    assert.equal(sim.buySupply(a.id, 'backpack'), wave >= 10);
    for (const service of ['grenade', 'armor', 'ammo']) assert.equal(sim.buySupply(a.id, service), wave >= 15, `${service}, wave ${wave}`);
  }
});

test('purchasing a backpack charges exactly 1500 without granting weapons, rounds, health or a new bonus', () => {
  const { sim, a, b, events } = room(); station(a); a.points = 1500; a.hp = 61; a.armor = 27; a.grenades = 1;
  equip(a, ['pistol', 'rifle']); a.inventory.pistol = { ammo: 3, reserve: 4 }; a.inventory.rifle = { ammo: 7, reserve: 11 };
  a.bonus = { kind: 'radar', level: 2 };
  const before = structuredClone({ inventory: a.inventory, hp: a.hp, armor: a.armor, grenades: a.grenades, bonus: a.bonus });
  assert.equal(sim.buySupply(a.id, 'backpack'), true);
  assert.equal(a.points, 0); assert.equal(a.backpack, true); assert.equal(sim.weaponSlots(a), 4); assert.equal(b.backpack, false);
  assert.deepEqual({ inventory: a.inventory, hp: a.hp, armor: a.armor, grenades: a.grenades, bonus: a.bonus }, before);
  assert.deepEqual(a.supplyPurchases, ['backpack']);
  assert.equal(events.at(-1).event, 'supply-purchased'); assert.equal(events.at(-1).service, 'backpack'); assert.equal(events.at(-1).price, 1500);
});

test('a backpack requires funds, range, floor, line of sight, a conscious player and an active unpaused phase', () => {
  for (const scenario of ['early', 'funds', 'distant', 'floor', 'wall', 'downed', 'dead', 'lobby', 'gameover', 'extraction', 'paused']) {
    const { sim, a } = room(scenario === 'early' ? 9 : 10); station(a); a.points = scenario === 'funds' ? 1499 : 1500;
    if (scenario === 'distant') a.x += 4;
    if (scenario === 'floor') a.y = 3.4;
    if (scenario === 'wall') a.z = -6.7;
    if (scenario === 'downed') a.downed = true;
    if (scenario === 'dead') a.alive = false;
    if (['lobby', 'gameover', 'extraction'].includes(scenario)) sim.phase = scenario;
    if (scenario === 'paused') assert.equal(sim.setPause(a.id, true), true);
    const before = structuredClone({ points: a.points, inventory: a.inventory, purchases: a.supplyPurchases });
    assert.equal(sim.buySupply(a.id, 'backpack'), false, scenario);
    assert.equal(a.backpack, false); assert.equal(sim.weaponSlots(a), 2);
    assert.deepEqual({ points: a.points, inventory: a.inventory, purchases: a.supplyPurchases }, before, scenario);
  }
});

test('the backpack can never be repurchased even after a new wave clears the station allowance', () => {
  const { sim, a, events } = room(); purchasePack(sim, a); a.points = 1500;
  assert.equal(sim.buySupply(a.id, 'backpack'), false); assert.equal(events.at(-1).reason, 'owned');
  sim.beginWave(); assert.deepEqual(a.supplyPurchases, []);
  assert.equal(sim.buySupply(a.id, 'backpack'), false); assert.equal(a.points, 1500); assert.equal(a.backpack, true);
});

test('wall purchases fill four distinct slots and a fifth drops the exact active stock without reordering the other slots', () => {
  const { sim, a } = room(16); purchasePack(sim, a); a.points = 99999;
  for (const weapon of ['shotgun', 'smg', 'rifle']) {
    atRack(a, weapon); assert.equal(sim.buyWeapon(a.id, weapon), true);
  }
  assert.deepEqual(Object.keys(a.inventory), ['pistol', 'shotgun', 'smg', 'rifle']); assert.equal(sim.pickups.size, 0);
  a.inventory.rifle = { ammo: 7, reserve: 31 }; a.inventory.shotgun = { ammo: 2, reserve: 3 };
  const retained = structuredClone({ pistol: a.inventory.pistol, shotgun: a.inventory.shotgun, smg: a.inventory.smg });
  atRack(a, 'hammer'); assert.equal(sim.buyWeapon(a.id, 'hammer'), true);
  assert.deepEqual(Object.keys(a.inventory), ['pistol', 'shotgun', 'smg', 'hammer']); assert.equal(a.weapon, 'hammer');
  assert.deepEqual({ pistol: a.inventory.pistol, shotgun: a.inventory.shotgun, smg: a.inventory.smg }, retained);
  const ground = [...sim.pickups.values()].filter(item => item.kind === 'weapon');
  assert.equal(ground.length, 1); assert.equal(ground[0].weapon, 'rifle'); assert.equal(ground[0].ammo, 7); assert.equal(ground[0].reserve, 31);
});

test('ground exchanges use the individual capacity and preserve every transferred round through a fifth-weapon exchange', () => {
  const { sim, a, b } = room(16); purchasePack(sim, a);
  Object.assign(a, { x: 0, y: 0, z: 2, yaw: 0, pitch: 0 });
  const ids = ['shotgun', 'smg', 'rifle', 'sniper'];
  for (const [index, weapon] of ids.entries()) sim.pickups.set(weapon, { id: weapon, kind: 'weapon', x: 0, y: 0, z: 1.5,
    weapon, ammo: index + 1, reserve: index + 3, expiresAt: Infinity });
  const before = heldAndGround(sim);
  for (const weapon of ids) { a.interactAfter = 0; assert.equal(sim.takeGroundWeapon(a.id, weapon), true); }
  assert.deepEqual(Object.keys(a.inventory), ['pistol', 'shotgun', 'smg', 'sniper']);
  assert.deepEqual(a.inventory.sniper, { ammo: 4, reserve: 6 }); assert.equal(a.weapon, 'sniper');
  assert.deepEqual(heldAndGround(sim), before);
  const abandoned = [...sim.pickups.values()].find(item => item.weapon === 'rifle');
  assert.ok(abandoned); assert.equal(abandoned.ammo, 3); assert.equal(abandoned.reserve, 5);
  assert.equal(sim.weaponSlots(b), 2);
});

test('dropping all four weapons leaves an empty backpack owner without weight penalty and all exact stocks remain recoverable', () => {
  const { sim, a } = room(16); purchasePack(sim, a); equip(a, ['pistol', 'shotgun', 'smg', 'rifle']);
  Object.assign(a, { x: 0, y: 0, z: 2, yaw: 0, pitch: 0 });
  for (const [index, stock] of Object.values(a.inventory).entries()) { stock.ammo = index + 1; stock.reserve = index + 2; }
  const before = heldAndGround(sim);
  for (let index = 0; index < 4; index++) { a.interactAfter = 0; assert.equal(sim.dropWeapon(a.id), true); }
  assert.equal(a.weapon, null); assert.deepEqual(a.inventory, {}); assert.equal(a.backpack, true);
  assert.equal(sim.snapshot().players[0].movementMultiplier, 1); assert.deepEqual(heldAndGround(sim), before);
  assert.equal(sim.shoot(a.id), false); assert.equal(sim.reload(a.id), false);
  const pickup = [...sim.pickups.values()][0];
  Object.assign(a, { x: pickup.x, y: pickup.y, z: pickup.z, interactAfter: 0 });
  assert.equal(sim.takeGroundWeapon(a.id, pickup.id), true); assert.deepEqual(heldAndGround(sim), before);
});

test('the stand grants a permanent backpack, fills its spare slots, and replaces only the active fifth slot', () => {
  const { sim, a, b } = room(10, true); const before = structuredClone(a.inventory);
  assert.equal(sim.practiceAction(a.id, { action: 'backpack' }), true); assert.equal(a.backpack, true);
  assert.deepEqual(a.inventory, before); assert.equal(a.points, 0); assert.equal(b.backpack, false);
  sim.time += 1; assert.equal(sim.practiceAction(a.id, { action: 'backpack' }), false);
  for (const weapon of ['sniper', 'hammer', 'katana']) {
    sim.time += 1; assert.equal(sim.practiceAction(a.id, { action: 'weapon', weapon }), true);
  }
  assert.deepEqual(Object.keys(a.inventory), ['assault', 'rocket', 'sniper', 'katana']);
  assert.deepEqual(a.inventory.assault, before.assault); assert.deepEqual(a.inventory.rocket, before.rocket);
  assert.equal(sim.pickups.size, 0); assert.equal(a.backpack, true);
  sim.time += 1; assert.equal(sim.practiceAction(a.id, { action: 'targets' }), true); assert.equal(a.backpack, true);
  assert.equal(sim.setPause(a.id, true), true); assert.equal(sim.practiceAction(b.id, { action: 'backpack' }), false); assert.equal(b.backpack, false);
});

for (const posture of ['walk', 'sprint', 'crouch']) {
  test(`actual ${posture} motion with every held weapon uses no penalty at two, ten percent at three and fifteen at four`, () => {
    for (const weapon of Object.keys(WEAPON_MOVEMENT)) {
      const displacements = [];
      for (const count of [1, 2, 3, 4]) {
        const { sim, a } = room(10, true); a.backpack = true;
        equip(a, [weapon, ...Object.keys(WEAPON_MOVEMENT).filter(id => id !== weapon)].slice(0, count));
        Object.assign(a, { x: 25, y: 0, z: 25, yaw: 0, pitch: 0, grounded: true, crouched: false });
        for (let tick = 0; tick < 30; tick++) {
          sim.setInput(a.id, { forward: 1, strafe: 0, yaw: 0, pitch: 0, sprint: posture === 'sprint', crouch: posture === 'crouch' });
          sim.tick(1 / 30);
        }
        displacements.push(25 - a.z);
        const factor = BACKPACK.movementMultipliers[count] ?? 1, state = sim.snapshot().players[0];
        assert.equal(state.movementMultiplier, WEAPON_MOVEMENT[weapon] * factor);
        assert.equal(state.backpackMovementMultiplier, factor);
      }
      assert.ok(displacements[0] > 1);
      for (const [index, factor] of [1, 1, .9, .85].entries()) assert.ok(Math.abs(displacements[index] / displacements[0] - factor) < 1e-10, `${weapon}, ${index + 1} weapons`);
    }
  });

  test(`real pickups and drops immediately recalculate ${posture} weight over two, three, four, three and two weapons`, () => {
    const { sim, a } = room(10, true); a.backpack = true; equip(a, ['pistol', 'rifle']);
    Object.assign(a, { x: 25, y: 0, z: 25, grounded: true });
    const observed = [];
    const move = count => {
      const before = a.z, base = posture === 'sprint' ? 5.4 : posture === 'crouch' ? 3.5 * PLAYER_POSTURE.crouchSpeed : 3.5;
      sim.setInput(a.id, { forward: 1, strafe: 0, yaw: 0, pitch: 0, sprint: posture === 'sprint', crouch: posture === 'crouch' });
      sim.movePlayer(a, .1);
      const factor = (before - a.z) / (.1 * base * WEAPON_MOVEMENT[a.weapon]);
      observed.push(factor);
      assert.equal(Object.keys(a.inventory).length, count);
      assert.equal(sim.snapshot().players[0].backpackMovementMultiplier, BACKPACK.movementMultipliers[count] ?? 1);
    };
    move(2);
    for (const [index, weapon] of ['smg', 'shotgun'].entries()) {
      const pickup = { id: weapon, kind: 'weapon', x: a.x + .2, y: 0, z: a.z, weapon, ammo: 2, reserve: 3, expiresAt: Infinity };
      sim.pickups.set(pickup.id, pickup); sim.time += 1;
      assert.equal(sim.takeGroundWeapon(a.id, pickup.id), true); move(index + 3);
    }
    for (const count of [3, 2]) { sim.time += 1; assert.equal(sim.dropWeapon(a.id), true); move(count); }
    for (const [index, factor] of [1, .9, .85, .9, 1].entries()) assert.ok(Math.abs(observed[index] - factor) < 1e-10, `${index}: ${observed[index]}`);
  });
}

test('backpack capacity persists through down, revive and resupply; a fresh night resets it and its extra inventory', () => {
  const { sim, a, b } = room(16); purchasePack(sim, a); equip(a, ['pistol', 'shotgun', 'smg', 'rifle']);
  Object.assign(a, { x: 0, y: 0, z: 2 }); Object.assign(b, { x: 1, y: 0, z: 2, interactAfter: 0 });
  a.bonus = { kind: 'perforating', level: 3 }; a.inventory.rifle = { ammo: 2, reserve: 3 }; const before = structuredClone(a.inventory);
  sim.damagePlayer(a, 100); assert.equal(a.downed, true); assert.equal(a.backpack, true); assert.deepEqual(a.bonus, { kind: 'perforating', level: 3 }, 'down keeps the bonus');
  assert.equal(completeRevive(sim, b.id), true); assert.equal(a.downed, false); assert.equal(a.backpack, true); assert.deepEqual(a.inventory, before);
  sim.finishWave(); assert.equal(a.backpack, true); assert.equal(sim.weaponSlots(a), 4);
  assert.deepEqual(Object.keys(a.inventory), Object.keys(before));
  for (const [weapon, stock] of Object.entries(a.inventory)) assert.deepEqual(stock, { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve });
  sim.endGame(); assert.equal(sim.start(a.id), true);
  assert.equal(a.backpack, false); assert.equal(sim.weaponSlots(a), 2); assert.deepEqual(Object.keys(a.inventory), ['pistol']);
  assert.equal(sim.backpackMovementMultiplier(a), 1);
});

test('weight follows real inventory rather than a flag, and unique Magnum elimination immediately removes one load', () => {
  const { sim, a } = room(16); equip(a, ['pistol', 'rifle', 'smg']); a.backpack = false;
  assert.equal(sim.backpackMovementMultiplier(a), .9, 'a forged false flag could not make three real weapons weightless');
  a.backpack = true; equip(a, ['pistol', 'rifle', 'smg', 'magnum'], 'magnum');
  Object.assign(a, { x: 0, y: 0, z: 2 });
  assert.equal(sim.backpackMovementMultiplier(a), .85);
  sim.damagePlayer(a, 100); assert.equal(Object.keys(a.inventory).length, 4);
  a.bleedOutAt = sim.time + .01; sim.tick(.1);
  assert.equal(a.alive, false); assert.equal(Object.keys(a.inventory).length, 3);
  const state = sim.snapshot().players[0];
  assert.equal(state.backpackMovementMultiplier, .9); assert.equal(state.movementMultiplier, WEAPON_MOVEMENT.pistol * .9);
  assert.equal([...sim.pickups.values()].filter(item => item.weapon === 'magnum').length, 1);
});

test('the backpack affects horizontal speed only and does not change the jump impulse or health', () => {
  const trajectories = [];
  for (const packed of [false, true]) {
    const { sim, a } = room(10, true); a.backpack = packed;
    if (packed) equip(a, ['assault', 'rocket', 'sniper', 'hammer']);
    Object.assign(a, { x: 25, y: 0, z: 25, grounded: true });
    sim.setInput(a.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0, jump: true });
    const frames = [];
    for (let tick = 0; tick < 10; tick++) { sim.tick(1 / 30); frames.push([a.y, a.vy, a.hp, a.grounded]); }
    trajectories.push(frames);
  }
  assert.ok(trajectories[0][0][0] > 0); assert.deepEqual(trajectories[1], trajectories[0]);
});
