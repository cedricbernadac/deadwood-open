import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import { sampleBulletAtDistance } from '../public/ballistics.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { ARMORY, PICKUPS, BOSS_HP, MAGNUM_BOSS_DAMAGE, EXTERIOR } from '../public/rules.js';
import { SUPPLY_WAVES, LATE_SUPPLIES } from '../public/weapon-upgrades.js';
import { CHARACTER_BONUSES } from '../public/character-bonuses.js';

function room(wave = 6) {
  const events = [], sim = new RoomSimulation('SUPPLY', { random: () => .5, onEvent: event => events.push(event) });
  const a = sim.addPlayer('a', 'Alice'), b = sim.addPlayer('b', 'Bob');
  sim.phase = 'wave'; sim.wave = wave - 1; sim.beginWave();
  sim.toSpawn = 0; sim.spawnWarnings.clear(); sim.zombies.clear();
  return { sim, a, b, events };
}
function equip(player, weapons, active = weapons[0]) {
  player.inventory = Object.fromEntries(weapons.map(id => [id, { ammo: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve }]));
  player.weapon = active;
}
function at(player, target, offset = 0) { Object.assign(player, { x: target.x, y: target.y ?? 0, z: target.z + offset, yaw: 0, grounded: true, interactAfter: 0 }); }
function station(player) { at(player, LATE_SUPPLIES.position, 1); }
const stockTotal = stock => stock.ammo + stock.reserve;
const bonusPickups = sim => [...sim.pickups.values()].filter(item => item.kind === 'bonus');
const magnums = sim => [...sim.players.values()].filter(player => Object.hasOwn(player.inventory, 'magnum')).length
  + [...sim.pickups.values()].filter(item => item.kind === 'weapon' && item.weapon === 'magnum').length;

test('the outdoor crate stays put all night and renews one choice only on waves two through eighteen', () => {
  let fixed;
  for (let wave = 1; wave < 20; wave++) {
    const { sim, a } = room(wave);
    assert.ok(sim.supplyCrate, `physical crate remains on wave ${wave}`);
    assert.equal(sim.supplyCrate.active, SUPPLY_WAVES.includes(wave), `wave ${wave}`);
    const position = [sim.supplyCrate.x, sim.supplyCrate.y, sim.supplyCrate.z];
    fixed ??= position; assert.deepEqual(position, fixed);
    at(a, sim.supplyCrate);
    assert.equal(sim.claimSupply(a.id, 'vitamins', sim.supplyCrate.id), SUPPLY_WAVES.includes(wave));
    const id = sim.supplyCrate.id;
    sim.finishWave(); assert.equal(sim.phase, 'intermission'); assert.equal(sim.timeLeft, 12);
    for (let tick = 0; tick < 119; tick++) sim.tick(.1);
    assert.equal(sim.supplyCrate.id, id, 'crate remains throughout almost all of the pause');
    sim.tick(.1); sim.tick(.1); assert.equal(sim.wave, wave + 1);
    assert.ok(sim.supplyCrate); assert.notEqual(sim.supplyCrate.id, id, 'claim identity renews without moving the crate');
    assert.deepEqual([sim.supplyCrate.x, sim.supplyCrate.y, sim.supplyCrate.z], fixed);
    assert.equal(sim.supplyCrate.active, SUPPLY_WAVES.includes(wave + 1));
    assert.equal(sim.supplyCrate.claimed.size, 0);
  }
});

test('all personal bonuses can be chosen with any loadout and recovered at their real level after elimination', () => {
  for (const kind of Object.keys(CHARACTER_BONUSES)) {
    const { sim, a, b } = room(2);
    at(a, sim.supplyCrate); at(b, sim.supplyCrate);
    assert.equal(sim.claimSupply(a.id, kind, sim.supplyCrate.id), true, kind);
    assert.equal(sim.claimSupply(a.id, 'vitamins', sim.supplyCrate.id), false, 'one choice per survivor');
    assert.equal(sim.claimSupply(b.id, kind, sim.supplyCrate.id), true, 'teammate has an independent choice');
    a.bonus[kind] = 4; b.bonus = null;
    const pickups = sim.dropBonus(a);
    const pickup = pickups.find(item => item.bonus.kind === kind);
    assert.ok(pickup); at(b, pickup);
    assert.equal(sim.takeBonus(b.id, pickup.id), true, kind);
    assert.deepEqual(b.bonus, { [kind]: 4 });
  }
});

test('a new wave rejects old crate identities and cannot bank an unused earlier choice', () => {
  const { sim, a } = room(2); at(a, sim.supplyCrate);
  const old = sim.supplyCrate.id;
  sim.beginWave(); at(a, sim.supplyCrate);
  assert.equal(sim.claimSupply(a.id, 'vitality', old), false);
  assert.equal(sim.claimSupply(a.id, 'vitality', sim.supplyCrate.id), true);
  assert.equal(sim.claimSupply(a.id, 'reload', sim.supplyCrate.id), false);
});

test('each player chooses one compatible bonus from a crate, with real proximity and floor required', () => {
  const { sim, a, b } = room(); equip(a, ['katana', 'rifle']); equip(b, ['rifle', 'sniper']);
  const crate = sim.supplyCrate;
  assert.equal(sim.claimSupply('a', 'stone', crate.id), false, 'remote player cannot claim');
  at(a, crate); at(b, crate); b.y = 3.4;
  assert.equal(sim.claimSupply('b', 'extended', crate.id), false, 'wrong floor cannot claim'); b.y = 0;
  assert.equal(sim.claimSupply('b', 'stone', crate.id), false, 'no melee weapon, so the crate remains unclaimed');
  assert.equal(crate.claimed.has('b'), false);
  assert.equal(sim.claimSupply('a', 'stone', 'forged-crate'), false);
  assert.equal(sim.claimSupply('a', 'stone', crate.id), true);
  assert.equal(sim.claimSupply('a', 'extended', crate.id), false, 'cannot take a second choice');
  assert.equal(sim.claimSupply('b', 'extended', crate.id), true);
  assert.deepEqual(new Set(sim.snapshot().supplyCrate.claimed), new Set(['a', 'b']));
  assert.deepEqual(a.bonus, { stone: 1 }); assert.deepEqual(b.bonus, { extended: 1 });
  assert.equal(sim.weaponProfile(a, 'katana').attacks.heavy.retention, WEAPONS.katana.attacks.heavy.retention);
  assert.ok(Math.abs(sim.weaponProfile(a, 'katana').attacks.heavy.damage - WEAPONS.katana.attacks.heavy.damage * 1.1) < 1e-8);
});

test('malformed bonus and service payloads are rejected atomically without throwing', () => {
  const { sim, a } = room(16); equip(a, ['katana', 'rifle']); a.points = 99999;
  for (const malformed of [null, false, 1, {}, [], ['stone'], { toString: null, valueOf: null }, '__proto__', 'constructor']) {
    at(a, sim.supplyCrate);
    const before = structuredClone({ bonus: a.bonus, points: a.points, inventory: a.inventory });
    assert.doesNotThrow(() => assert.equal(sim.claimSupply('a', malformed, sim.supplyCrate.id), false));
    station(a);
    assert.doesNotThrow(() => assert.equal(sim.buySupply('a', malformed), false));
    assert.deepEqual({ bonus: a.bonus, points: a.points, inventory: a.inventory }, before);
  }
});

test('stacked choices never displace each other, and losing an extended magazine never duplicates ammunition', () => {
  const { sim, a, b } = room(); equip(a, ['rifle', 'katana']); equip(b, ['rifle']);
  at(a, sim.supplyCrate); assert.equal(sim.claimSupply('a', 'extended', sim.supplyCrate.id), true);
  sim.wave = 7; sim.beginWave(); sim.toSpawn = 1; sim.spawnTimer = 999;
  at(a, sim.supplyCrate); assert.equal(sim.claimSupply('a', 'stone', sim.supplyCrate.id), true);
  assert.deepEqual(a.bonus, { extended: 1, stone: 1 }, 'a second kind simply joins the carried set');
  assert.equal(bonusPickups(sim).length, 0, 'nothing falls when choices stack');
  a.inventory.rifle = { ammo: 36, reserve: 89 };
  const total = stockTotal(a.inventory.rifle);
  const dropped = sim.dropBonus(a);
  assert.equal(dropped.length, 2, 'each carried bonus falls as its own pickup');
  assert.deepEqual(a.bonus, null);
  assert.equal(a.inventory.rifle.ammo, 30); assert.ok(stockTotal(a.inventory.rifle) >= total, 'losing capacity keeps the rounds in reserve');
  assert.equal(sim.dropBonus(a), null); assert.equal(bonusPickups(sim).length, 2);
  const magazinePickup = dropped.find(pickup => pickup.bonus.kind === 'extended');
  at(b, magazinePickup); const before = stockTotal(b.inventory.rifle);
  assert.equal(sim.takeBonus('b', magazinePickup.id), true); assert.deepEqual(b.bonus, { extended: 1 });
  assert.equal(stockTotal(b.inventory.rifle), before, 'recovering capacity grants no bullets');
  sim.damagePlayer(b, 100);
  assert.deepEqual(b.bonus, { extended: 1 }, 'a downed survivor keeps the bonus');
  assert.equal(bonusPickups(sim).length, 1, 'only the earlier stone still lies there');
  b.bleedOutAt = sim.time + .05; sim.toSpawn = 1; sim.spawnTimer = 999; sim.tick(.1);
  assert.equal(b.alive, false); assert.equal(b.bonus, null); assert.equal(bonusPickups(sim).length, 2);
  sim.removePlayer('b'); assert.equal(bonusPickups(sim).length, 2, 'elimination followed by disconnect cannot duplicate the bonuses');
});

test('re-taking a weapon bonus at later crates raises its level to eight, then the crate refuses it', () => {
  const { sim, a } = room(); equip(a, ['katana', 'rifle']); at(a, sim.supplyCrate);
  assert.equal(sim.claimSupply('a', 'extended', sim.supplyCrate.id), true);
  for (const wave of [6, 8, 10, 12, 14, 16, 18]) {
    sim.wave = wave - 1; sim.beginWave(); sim.toSpawn = 1; sim.spawnTimer = 999;
    at(a, sim.supplyCrate);
    assert.equal(sim.claimSupply('a', 'extended', sim.supplyCrate.id), true, `level up at wave ${wave}`);
  }
  assert.deepEqual(a.bonus, { extended: 8 });
  assert.equal(sim.weaponProfile(a, 'rifle').magazine, 54, '30 rounds grow to +80%');
  assert.equal(sim.weaponProfile(a, 'rifle').reserve, 162, 'the reserve grows with whole extended magazines');
  assert.equal(sim.bonusEligible(a, 'extended'), false, 'a maxed bonus closes the choice');
  const stone = room(4); equip(stone.a, ['katana']); at(stone.a, stone.sim.supplyCrate);
  assert.equal(stone.sim.claimSupply('a', 'stone', stone.sim.supplyCrate.id), true);
  stone.a.bonus.stone = 4;
  assert.ok(Math.abs(stone.sim.weaponProfile(stone.a, 'katana').attacks.light.damage - WEAPONS.katana.attacks.light.damage * 1.4) < 1e-8);
});

test('carried bonuses persist across waves and a new choice stacks beside the old one', () => {
  const { sim, a } = room(); equip(a, ['katana', 'rifle']); at(a, sim.supplyCrate);
  assert.equal(sim.claimSupply('a', 'stone', sim.supplyCrate.id), true);
  sim.finishWave(); assert.deepEqual(a.bonus, { stone: 1 });
  sim.wave = 7; sim.beginWave(); at(a, sim.supplyCrate);
  assert.equal(sim.claimSupply('a', 'extended', sim.supplyCrate.id), true);
  assert.deepEqual(a.bonus, { stone: 1, extended: 1 }); assert.deepEqual(bonusPickups(sim), []);
  assert.ok(Math.abs(sim.weaponProfile(a, 'katana').attacks.light.damage - WEAPONS.katana.attacks.light.damage * 1.1) < 1e-8, 'the stone keeps working beside the magazine');
  sim.finishWave();
  assert.deepEqual(a.inventory.rifle, { ammo: 33, reserve: 99 }, 'the refill restores full extended magazines and reserve');
});

test('late services charge real prices once per player and wave, and failed requests spend nothing', () => {
  const { sim, a, b } = room(15); station(a); station(b); a.points = 1650; b.points = 350;
  a.inventory.pistol = { ammo: 0, reserve: 0 };
  assert.equal(sim.buySupply('a', 'grenade'), true); assert.equal(a.grenades, 1); assert.equal(a.points, 1300);
  assert.equal(sim.buySupply('a', 'grenade'), false); assert.equal(a.points, 1300);
  assert.equal(sim.buySupply('a', 'armor'), true); assert.equal(a.armor, 100); assert.equal(a.points, 700);
  assert.equal(sim.buySupply('a', 'ammo'), true); assert.equal(a.points, 0);
  assert.deepEqual(a.inventory.pistol, { ammo: 0, reserve: 48 }, 'a full refill of everything carried (owner, 16 October)');
  assert.deepEqual(a.supplyPurchases, ['grenade', 'armor', 'ammo']);
  assert.equal(sim.buySupply('b', 'grenade'), true, 'teammate has an independent allowance');
  assert.equal(sim.buySupply('b', 'armor'), false); assert.equal(b.points, 0); assert.equal(b.armor, 0);
  sim.beginWave(); assert.deepEqual(a.supplyPurchases, []);
  a.points = 350; assert.equal(sim.buySupply('a', 'grenade'), true);
});

test('late ammunition is a full refill of every firearm carried, whatever it is', () => {
  for (const [weapon, magazine, reserve] of [['magnum', WEAPONS.magnum.magazine, WEAPONS.magnum.reserve], ['sniper', WEAPONS.sniper.magazine, WEAPONS.sniper.reserve], ['rocket', WEAPONS.rocket.magazine, WEAPONS.rocket.reserve]]) {
    const { sim, a } = room(15); station(a); equip(a, [weapon]); a.points = 700;
    a.inventory[weapon] = { ammo: 0, reserve: 0 };
    assert.equal(sim.buySupply('a', 'ammo'), true);
    assert.equal(stockTotal(a.inventory[weapon]), magazine + reserve, `the whole stock of the ${weapon}`);
    assert.equal(a.points, 0);
  }
  const { sim, a } = room(15); station(a); equip(a, ['sniper']); a.points = 700;
  a.inventory.sniper = { ammo: 5, reserve: 9 };
  assert.equal(sim.buySupply('a', 'ammo'), true); assert.equal(stockTotal(a.inventory.sniper), 15, 'topped up to full, one free place or many');
  const full = room(15); station(full.a); full.a.points = 700;
  assert.equal(full.sim.buySupply('a', 'ammo'), false); assert.equal(full.a.points, 700); assert.deepEqual(full.a.supplyPurchases, []);
  equip(full.a, ['hammer']); assert.equal(full.sim.buySupply('a', 'ammo'), false); assert.equal(full.a.points, 700, 'no firearm, nothing to refill');
});

test('the 75+75 Gatling fills whole once per wave, extended magazines included', () => {
  const { sim, a } = room(15); station(a); equip(a, ['minigun', 'pistol']); a.points = 1400;
  a.inventory.pistol = { ammo: 12, reserve: 0 };
  a.inventory.minigun = { ammo: 0, reserve: 0 };
  assert.equal(sim.buySupply('a', 'ammo'), true);
  assert.deepEqual(a.inventory.minigun, { ammo: 0, reserve: 150 }, 'the whole 75+75 stock');
  assert.deepEqual(a.inventory.pistol, { ammo: 12, reserve: 36 }, 'every gun carried, not just the one in hand');
  assert.equal(a.points, 700); assert.deepEqual(a.supplyPurchases, ['ammo']);
  assert.equal(sim.buySupply('a', 'ammo'), false);
  assert.deepEqual(a.inventory.minigun, { ammo: 0, reserve: 150 }); assert.equal(a.points, 700);

  for (const [bonus, magazine, reserve] of [[null, 75, 75], [{ extended: 2 }, 90, 90]]) {
    const partial = room(15); station(partial.a); equip(partial.a, ['minigun']);
    partial.a.bonus = bonus; partial.a.points = 1400;
    partial.a.inventory.minigun = { ammo: magazine, reserve: reserve - 1 };
    assert.equal(partial.sim.buySupply('a', 'ammo'), true);
    assert.deepEqual(partial.a.inventory.minigun, { ammo: magazine, reserve });
    assert.equal(partial.a.points, 700, 'the fixed service price even when one round alone fits');

    const full = room(15); station(full.a); equip(full.a, ['minigun']);
    full.a.bonus = bonus; full.a.points = 700;
    full.a.inventory.minigun = { ammo: magazine, reserve };
    assert.equal(full.sim.buySupply('a', 'ammo'), false);
    assert.deepEqual(full.a.inventory.minigun, { ammo: magazine, reserve });
    assert.equal(full.a.points, 700); assert.deepEqual(full.a.supplyPurchases, []);
  }
});

test('late services reject early waves, distance, walls and incapacitated actors', () => {
  for (const scenario of ['early', 'distant', 'wrong-floor', 'downed', 'dead', 'frozen', 'wall']) {
    const { sim, a } = room(scenario === 'early' ? 14 : 15); station(a); a.points = 9999;
    if (scenario === 'distant') a.x += 10;
    if (scenario === 'wrong-floor') a.y = 3.4;
    if (scenario === 'downed') a.downed = true;
    if (scenario === 'dead') a.alive = false;
    if (scenario === 'frozen') sim.phase = 'gameover';
    if (scenario === 'wall') a.z = -6.7;
    assert.equal(sim.buySupply('a', 'grenade'), false, scenario); assert.equal(a.points, 9999); assert.equal(a.grenades, 0);
  }
});

test('repairing the nearby north barricade keeps priority over opening the new supply station', () => {
  const { sim, a, events } = room(15), north = sim.doors.find(door => door.id === 'north');
  north.hp = 100; Object.assign(a, { x: -1.6, y: 0, z: -4.9, interactAfter: 0 });
  assert.equal(sim.supplyAction(a), null);
  assert.equal(sim.interact('a'), true); assert.ok(north.hp > 100);
  assert.equal(events.some(event => event.event === 'supply-menu'), false);
  assert.equal(events.some(event => event.event === 'repair' && event.id === 'a'), true);
});

test('the unique Magnum survives ground exchanges and disconnects with its exact remaining stock', () => {
  const { sim, a, b } = room(14), rack = ARMORY.find(item => item.weapon === 'magnum');
  for (const player of [a, b]) { Object.assign(player, { x: rack.x - 1.1, y: rack.y, z: rack.z }); player.points = rack.price; }
  assert.equal(sim.buyWeapon('a', 'magnum'), true); assert.equal(magnums(sim), 1); assert.equal(sim.magnumAvailable(), false);
  assert.equal(sim.buyWeapon('b', 'magnum'), false); assert.equal(b.points, rack.price);
  a.inventory.magnum = { ammo: 4, reserve: 1 }; sim.time += 1;
  assert.equal(sim.dropWeapon('a'), true); assert.equal(magnums(sim), 1); assert.equal(sim.magnumAvailable(), false);
  sim.time += 1; assert.equal(sim.buyWeapon('b', 'magnum'), false);
  const ground = [...sim.pickups.values()].find(item => item.weapon === 'magnum'); at(b, ground);
  assert.equal(sim.takeGroundWeapon('b', ground.id), true); assert.equal(magnums(sim), 1);
  assert.deepEqual(b.inventory.magnum, { ammo: 4, reserve: 1 });
  sim.removePlayer('b'); sim.removePlayer('b'); assert.equal(magnums(sim), 1);
  const saved = [...sim.pickups.values()].find(item => item.weapon === 'magnum');
  assert.equal(saved.ammo, 4); assert.equal(saved.reserve, 1); assert.equal(saved.expiresAt, Infinity);
  assert.equal(sim.snapshot().magnumAvailable, false);
});

test('finite Magnum energy defeats the 6000-HP boss, with its normal head multiplier', () => {
  for (const head of [false, true]) {
    const { sim, a } = room(20); equip(a, ['magnum']);
    Object.assign(a, { x: 16, y: head ? .7 : 0, z: 16, yaw: 0, pitch: 0 });
    const boss = { id: 'boss', x: 16, y: 0, z: 13, kind: 'brute', boss: true, scale: 1.32, hp: BOSS_HP, maxHp: BOSS_HP, pushX: 0, pushZ: 0 };
    sim.zombies.set(boss.id, boss);
    const damage = sampleBulletAtDistance(WEAPONS.magnum, 3 - .32 * 1.32).damage * (head ? 2.2 : 1);
    const shots = Math.ceil(BOSS_HP / damage);
    for (let shot = 1; shot <= shots; shot++) {
      sim.time = a.shotAfter; boss.x = 16; boss.z = 13;
      assert.equal(sim.shoot('a'), true);
      advanceBallisticFlight(sim, .05);
      assert.ok(Math.abs(boss.hp - (BOSS_HP - shot * damage)) < .01);
      assert.equal(sim.zombies.has(boss.id), shot < shots);
    }
    assert.equal(a.inventory.magnum.ammo, 6 - shots); assert.equal(a.kills, 1);
  }
});

test('a downed Magnum carrier can disconnect or bleed out on the ground, loft, in the air or beyond bounds without losing or duplicating stock', () => {
  const poses = [
    { name: 'ground', x: 16, y: 0, z: 16, grounded: true },
    { name: 'loft', x: 6, y: 3.4, z: -4, grounded: true },
    { name: 'airborne', x: 17, y: 7, z: 17, grounded: false },
    { name: 'outside bounds', x: 200, y: 0, z: 200, grounded: true },
    { name: 'above ceiling', x: 4, y: 40, z: 0, grounded: false },
  ];
  for (const cause of ['disconnect', 'bleedout']) for (const pose of poses) {
    const { sim, a, b } = room(14); equip(a, ['magnum', 'rifle']);
    Object.assign(a, pose); a.inventory.magnum = { ammo: 3, reserve: 2 }; a.bonus = { extended: 1 };
    assert.doesNotThrow(() => sim.damagePlayer(a, 100), `${cause}/${pose.name}: down event`);
    assert.equal(a.downed, true); assert.deepEqual(a.bonus, { extended: 1 }); assert.equal(bonusPickups(sim).length, 0, 'down keeps the bonus');
    if (cause === 'disconnect') assert.doesNotThrow(() => sim.removePlayer('a'), pose.name);
    else {
      a.bleedOutAt = sim.time + .05; sim.toSpawn = 1; sim.spawnTimer = 999;
      assert.doesNotThrow(() => sim.tick(.1), pose.name); assert.equal(a.alive, false);
    }
    assert.equal(a.bonus, null); assert.equal(bonusPickups(sim).length, 1, `${cause}/${pose.name}: the levelled bonus falls once`);
    assert.equal(magnums(sim), 1, 'Magnum remains with the rescueable carrier until elimination/disconnect');
    const saved = [...sim.pickups.values()].find(item => item.kind === 'weapon' && item.weapon === 'magnum');
    assert.ok(saved, `${cause}/${pose.name}: the Magnum is recoverable`);
    assert.equal(saved.ammo, 3); assert.equal(saved.reserve, 2); assert.equal(saved.expiresAt, Infinity);
    assert.ok([saved.x, saved.y, saved.z].every(Number.isFinite));
    assert.ok(saved.x > EXTERIOR.bounds.minX && saved.x < EXTERIOR.bounds.maxX
      && saved.z > EXTERIOR.bounds.minZ && saved.z < EXTERIOR.bounds.maxZ);
    at(b, saved); b.interactAfter = 0;
    assert.equal(sim.canCollectPickup(b, saved), true); assert.equal(sim.interactionVisible(b, saved), true);
    assert.equal(sim.takeGroundWeapon('b', saved.id), true); assert.deepEqual(b.inventory.magnum, { ammo: 3, reserve: 2 });
    sim.removePlayer('a'); assert.equal(magnums(sim), 1); assert.equal(bonusPickups(sim).length, 1);
  }
});

test('partial Gatling 6/12 boxes retain exact integer charge for the second survivor', () => {
  for (const special of [false, true]) {
    const { sim, a, b } = room(15); equip(a, ['minigun']); equip(b, ['minigun']);
    Object.assign(a, { x: 16, y: 0, z: 16 }); Object.assign(b, { x: 20, y: 0, z: 16 });
    a.inventory.minigun = { ammo: 75, reserve: 73 }; b.inventory.minigun = { ammo: 0, reserve: 0 };
    const box = { id: 'box', kind: 'ammo', x: 16, y: 0, z: 16, special, charge: PICKUPS.ammoCharge, expiresAt: 100 };
    sim.pickups.set(box.id, box); sim.collectPickups();
    const quantity = special ? 12 : 6, expectedCharge = PICKUPS.ammoCharge - 2 * PICKUPS.ammoCharge / quantity;
    assert.equal(a.inventory.minigun.reserve, 75); assert.equal(box.charge, expectedCharge); assert.ok(Number.isInteger(box.charge));
    a.x = 20; b.x = 16; sim.collectPickups();
    assert.equal(b.inventory.minigun.reserve, quantity - 2); assert.equal(sim.pickups.has(box.id), false);
  }
});
