import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, damageFalloff } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { characterStats } from '../public/character-bonuses.js';
import { innateDebt } from '../public/character-sheet.js';
import { predictMovement } from '../public/online/physics.js';
import { WEAPON_MOVEMENT, EXTERIOR, GRENADES, BARRICADE_BOARDS } from '../public/rules.js';
import { LATE_SUPPLIES } from '../public/weapon-upgrades.js';
import { enemyHitbox } from '../public/enemies.js';
import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';

// The character sheet in the authoritative room: every malus is the real
// gameplay value, and the debt follows the night, the crate and the drops.
const near = (actual, expected, why = '', epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${why} ${actual} vs ${expected}`);
const stats = values => ({ stats: values });
function room(sheet = null, { online = false, wave = 3 } = {}) {
  const events = [], Simulation = online ? OnlineRoomSimulation : RoomSimulation;
  const sim = new Simulation('SHEETS', { random: () => .5, raids: false, clock: () => 1000, onEvent: event => events.push(event) });
  const player = sim.addPlayer('host', 'Host', undefined, { sheet });
  sim.start('host');
  Object.assign(sim, { phase: 'wave', wave, toSpawn: 1, spawnTimer: 1e9, time: 1 });
  Object.assign(player, { x: -4.4, y: 0, z: 4, yaw: 0, pitch: 0 });
  sim.zombies.clear(); sim.spawnWarnings.clear();
  return { sim, player, events };
}
const zombie = (sim, extra = {}) => {
  const target = { id: `z${sim.zombies.size}`, kind: 'walker', x: -4.4, y: 0, z: 3, yaw: 0, hp: 100000, maxHp: 100000,
    scale: 1, speed: 2, entered: true, attackAfter: Infinity, ...extra };
  sim.zombies.set(target.id, target); return target;
};
const at = (player, target) => Object.assign(player, { x: target.x, y: target.y ?? 0, z: target.z, grounded: true, interactAfter: 0 });

test('strength −2 starts at 80 HP everywhere the game fills health, and each vitality claim repays a level', () => {
  const lobby = new RoomSimulation('HP', { random: () => .5 });
  const early = lobby.addPlayer('a', 'A', undefined, { sheet: stats({ strength: -2, agility: 2 }) });
  assert.equal(early.hp, 80); assert.equal(lobby.snapshot().players[0].maxHp, 80);
  const { sim, player } = room(stats({ strength: -2, agility: 2 }));
  assert.equal(player.hp, 80); assert.deepEqual(player.sheetDebt, { stone: 2, vitality: 2, rainproof: 2, toughskin: 2 });
  player.hp = 30;
  sim.pickups.set('health', { id: 'health', kind: 'health', x: player.x, y: 0, z: player.z, expiresAt: Infinity });
  sim.collectPickups(); assert.equal(player.hp, 80);
  player.hp = 10; sim.finishWave(); assert.equal(player.hp, 80);
  sim.wave = 2; sim.phase = 'intermission'; sim.beginSupplyWave(); at(player, sim.supplyCrate);
  const climb = [];
  for (const wave of [2, 3, 4]) {
    sim.wave = wave; sim.beginSupplyWave();
    assert.equal(sim.claimSupply(player.id, 'vitality', sim.supplyCrate.id), true);
    climb.push([characterStats(player).maxHp, player.hp, player.bonus?.vitality ?? 0, player.sheetDebt.vitality ?? 0]);
  }
  assert.deepEqual(climb, [[90, 90, 0, 1], [100, 100, 0, 0], [110, 110, 1, 0]], 'the debt goes first, then the usual +1 (strength is not a talent here)');
});

test('agility −2 slows real and predicted movement by 8 %, reloads 20 % slower and locks a switch for 350 ms', () => {
  for (const [value, factor] of [[-1, .96], [-2, .92]]) {
    const { sim, player } = room(stats({ agility: value, chemistry: -value }));
    const command = { forward: 1, strafe: 0, yaw: 0, pitch: 0, sprint: true };
    const predicted = predictMovement(player, command, 1 / 30, sim.snapshot()), before = player.z;
    sim.setInput(player.id, command); sim.time += 1 / 30; sim.movePlayer(player, 1 / 30);
    near(player.z, predicted.z, 'prediction matches');
    near(before - player.z, 5.4 * WEAPON_MOVEMENT.pistol * factor / 30, `speed ${value}`);
  }
  const { sim, player } = room(stats({ agility: -2, strength: 2 }));
  player.inventory.pistol = { ammo: 0, reserve: 20 };
  assert.equal(sim.reload(player.id), true);
  near(player.reloadUntil - sim.time, 1.25 * 1.2);
  player.reloadUntil = 0; player.shotAfter = 0;
  player.inventory.smg = { ammo: 10, reserve: 0 };
  assert.equal(sim.chooseWeapon(player.id, 'smg'), true);
  near(player.shotAfter - sim.time, .35);
  const one = room(stats({ agility: -1, strength: 1 }));
  one.player.inventory.smg = { ammo: 10, reserve: 0 };
  assert.equal(one.sim.chooseWeapon(one.player.id, 'smg'), true);
  near(one.player.shotAfter - one.sim.time, .3);
});

test('strength −2 takes 20 % more rain and 8 % more combat damage, armour first as usual', () => {
  const { sim, player } = room(stats({ strength: -2, ballistics: 2 }));
  sim.damagePlayer(player, 10, { id: 'z' }); near(player.hp, 80 - 10.8);
  player.armor = 50; sim.damagePlayer(player, 10, { source: 'raider', id: 'r', x: 0, z: 0 }); near(player.armor, 50 - 10.8);
  player.hp = 80; sim.damagePlayer(player, 10, { source: 'outside' }); near(player.hp, 68);
  player.hp = 80; sim.damagePlayer(player, 10, { source: 'fall' }); near(player.armor, 50 - 10.8 - 10, 'falls are never resisted nor worsened');
  player.hp = 80; player.armor = 0; Object.assign(player, { x: 20, z: 20 });
  sim.updateOutsideDamage(player, 1); near(player.hp, 80 - EXTERIOR.damagePerSecond * 1.2, 'rain ticks', .001);
});

test('a strength debt weakens every real melee swing, and a ballistics debt every bullet', () => {
  for (const [value, factor] of [[0, 1], [-1, .9], [-2, .8]]) for (const mode of ['light', 'heavy']) {
    const { sim, player, events } = room(value ? stats({ strength: value, tinkering: -value }) : null);
    player.inventory = { katana: { ammo: 0, reserve: 0 } }; player.weapon = player.weaponId = 'katana';
    const target = zombie(sim, { z: 2.9 });
    assert.equal(sim.shoot(player.id, 0, mode), true);
    sim.time = player.pendingMelee.impactAt + .001; sim.updateMelee();
    assert.equal(events.find(event => event.event === 'melee-hit').hits, 1);
    near(100000 - target.hp, WEAPONS.katana.attacks[mode].damage * factor, `katana ${mode} ${value}`);
  }
  for (const [value, factor] of [[0, 1], [-1, .92], [-2, .85]]) {
    const { sim, player } = room(value ? stats({ ballistics: value, agility: -value }) : null);
    player.inventory = { rifle: { ammo: WEAPONS.rifle.magazine, reserve: 0 } }; player.weapon = player.weaponId = 'rifle';
    const target = zombie(sim, { y: .4, z: 1, hp: 1000, maxHp: 1000 });
    assert.equal(sim.shoot(player.id), true);
    advanceBallisticFlight(sim, .08);
    near(1000 - target.hp, WEAPONS.rifle.damage * damageFalloff(WEAPONS.rifle, 2.68) * factor, `rifle ${value}`, .01);
  }
});

test('a tinkering debt shrinks magazines and reserves at join, each night, refills and purchases, and weakens repairs', () => {
  const lobby = new RoomSimulation('MAG', { random: () => .5 });
  assert.deepEqual(lobby.addPlayer('a', 'A', undefined, { sheet: { preset: 'lumberjack' } }).inventory, { pistol: { ammo: 11, reserve: 32 } });
  const { sim, player } = room(stats({ tinkering: -2, agility: 2 }));
  assert.deepEqual(player.inventory, { pistol: { ammo: 10, reserve: 29 } });
  const self = () => sim.snapshot().players[0];
  assert.deepEqual([self().magazine, self().reserveCapacity], [10, 29]);
  player.inventory.pistol = { ammo: 2, reserve: 3 }; sim.finishWave();
  assert.deepEqual(player.inventory.pistol, { ammo: 10, reserve: 29 });
  Object.assign(sim, { phase: 'intermission', wave: 4 }); player.points = 5000;
  const rack = sim.snapshot().armory.find(item => item.weapon === 'smg');
  at(player, rack); Object.assign(player, { y: rack.y ?? 0 });
  assert.equal(sim.buyWeapon(player.id, rack.id), true);
  assert.deepEqual(player.inventory.smg, { ammo: 32, reserve: 96 });
  // Repairs: 15 HP per action at −2, 20 at −1, the usual 25 otherwise.
  for (const [value, amount] of [[0, 25], [-1, 20], [-2, 15]]) {
    const scene = room(value ? stats({ tinkering: value, chemistry: -value }) : null);
    const door = scene.sim.doors.find(item => item.id === 'south');
    door.boards[0] = 0; door.boards[1] = 0;
    Object.assign(scene.player, { x: 0, y: 0, z: 4.6, interactAfter: 0 });
    const before = door.hp;
    assert.equal(scene.sim.repairDoor(scene.player.id, door.id), true);
    assert.equal(door.hp - before, amount, `repair ${value}`);
  }
  assert.ok(BARRICADE_BOARDS[0].maxHp >= 25);
});

test('a chemistry debt caps grenades at one and weakens only its own throws; regeneration stays the Grenadier bonus', () => {
  for (const [value, factor] of [[-1, .85], [-2, .7]]) {
    const { sim, player } = room(stats({ chemistry: value, ballistics: -value }));
    assert.equal(characterStats(player).maxGrenades, 1); assert.equal(sim.grenadierLeft(player), null);
    const pickup = { id: 'grenade', kind: 'grenade', x: player.x, y: player.y, z: player.z, expiresAt: Infinity };
    sim.pickups.set(pickup.id, pickup); sim.collectPickups(); assert.equal(player.grenades, 1);
    sim.pickups.set(pickup.id, pickup); sim.collectPickups(); assert.equal(player.grenades, 1, 'the second pickup stays for a teammate');
    assert.equal(sim.pickups.has(pickup.id), true);
    sim.wave = 15; sim.phase = 'intermission'; sim.beginSupplyWave();
    Object.assign(player, LATE_SUPPLIES.position, { points: 1000 });
    assert.equal(sim.buySupply(player.id, 'grenade'), false, 'the station respects the cap');
    sim.phase = 'wave'; sim.time += 30; sim.tick(.01); assert.equal(player.grenades, 1, 'nothing banked at the cap');
    const target = zombie(sim, { x: 10, z: -5, speed: 0 });
    Object.assign(player, { x: -4.4, y: 0, z: 4, throwAfter: 0 });
    assert.equal(sim.throwGrenade(player.id), true);
    const grenade = [...sim.grenades.values()].at(-1), box = enemyHitbox(target);
    Object.assign(grenade, { x: 10, y: (box.minY + box.maxY) / 2, z: -5 });
    near(grenade.damageMultiplier, factor);
    assert.equal(sim.explodeGrenade(grenade), true);
    near(100000 - target.hp, GRENADES.damage * factor, `grenade ${value}`);
    // The standard game never regenerates either (that is no malus): only a
    // Grenadier level above 0 does, so a picked-up level first pays the debt.
    assert.equal(player.grenades, 0);
    player.bonus = { grenadier: -value }; assert.equal(sim.grenadierLeft(player), null, 'a picked-up level that only offsets the debt');
    player.bonus = { grenadier: 1 - value }; assert.equal(sim.grenadierLeft(player), 20, 'effective N1 regenerates as usual');
  }
});

test('the chemistry smell hastens zombies all along their approach, halved for bosses, never raiders, and combines with frost', () => {
  const { sim, player } = room(stats({ chemistry: -2, strength: 2 }));
  Object.assign(player, { x: -4.5, y: 0, z: 1.5 });
  const walker = zombie(sim, { x: -4.5, z: -.5 }), boss = zombie(sim, { x: -4.4, z: -.4, boss: true }), raider = zombie(sim, { x: -4.6, z: -.6, kind: 'raider' });
  // A permanent cost, not only a last step: 5 m at −2 (in plain sight here).
  const coming = zombie(sim, { x: -4.5, z: 1.5 - 4.3 }), far = zombie(sim, { x: -4.5, z: 1.5 - 5.3 }), upstairs = zombie(sim, { x: -4.5, z: .5, y: 3.4 });
  assert.equal(sim.grenadeBlastVisible({ x: -4.5, y: .9, z: 1.5 }, { x: -4.5, y: .9, z: far.z }), true, 'only the distance keeps the far one out');
  sim.updateFrostAuras();
  near(walker.scentHaste, .15); near(boss.scentHaste, .075); near(coming.scentHaste, .15);
  assert.equal(raider.scentHaste ?? 0, 0); assert.equal(far.scentHaste ?? 0, 0); assert.equal(upstairs.scentHaste ?? 0, 0);
  for (const other of [boss, raider, coming, far, upstairs]) sim.zombies.delete(other.id); // bodies of their own
  let before = walker.z; sim.moveZombieTowards(walker, { x: walker.x, z: walker.z + 1 }, .1, false);
  near(walker.z - before, 2 * 1.15 * .1);
  // Frost from a teammate: (1 − strongest slow) × (1 + strongest haste).
  const mate = sim.addPlayer('mate', 'Mate'); Object.assign(mate, { x: -4.6, y: 0, z: 1.5, alive: true, waiting: false, bonus: { frostaura: 8 } });
  walker.z = -.5; sim.updateFrostAuras(); near(walker.frostSlow, .25); near(walker.scentHaste, .15);
  before = walker.z; sim.moveZombieTowards(walker, { x: walker.x, z: walker.z + 1 }, .1, false);
  near(walker.z - before, 2 * .75 * 1.15 * .1);
  player.downed = true; sim.updateFrostAuras(); assert.equal(walker.scentHaste, 0, 'a downed carrier stops smelling');
  const lighter = room(stats({ chemistry: -1, strength: 1 }));
  Object.assign(lighter.player, { x: -4.5, y: 0, z: 1.5 });
  const close = zombie(lighter.sim, { x: -4.5, z: -.5 }), wide = zombie(lighter.sim, { x: -4.5, z: 1.5 - 3.5 }), edge = zombie(lighter.sim, { x: -4.5, z: 1.5 - 4.3 });
  lighter.sim.updateFrostAuras(); near(close.scentHaste, .1); near(wide.scentHaste, .1);
  assert.equal(edge.scentHaste ?? 0, 0, '4 m at −1 (the −2 smell reaches this very spot)');
  const standard = room();
  Object.assign(standard.player, { x: -4.5, y: 0, z: 1.5 });
  const usual = zombie(standard.sim, { x: -4.5, z: -.5 }); standard.sim.updateFrostAuras();
  assert.equal(Object.hasOwn(usual, 'scentHaste'), false, 'the standard game never touches it');
});

test('a chemistry debt slows a manual revive to 6 s, then 7.5 s', () => {
  for (const [value, seconds] of [[0, 5], [-1, 6], [-2, 7.5]]) {
    const { sim, player, events } = room(value ? stats({ chemistry: value, agility: -value }) : null);
    Object.assign(player, { x: -4.5, z: 1.5 });
    const mate = sim.addPlayer('mate', 'Mate');
    Object.assign(mate, { x: player.x, y: 0, z: player.z - .7, alive: true, waiting: false, downed: true, hp: 0, bleedOutAt: sim.time + 30 });
    assert.equal(sim.interact(player.id), true);
    assert.equal(events.findLast(event => event.event === 'revive-start').duration, seconds);
    near(sim.reviveStatus(player).reviveLeft, seconds);
  }
});

test('a chemistry debt weakens every medkit to 75 %, then 50 % of the missing health; the standard medkit still fills up', () => {
  for (const [value, hp, healed] of [[0, 20, 80], [-1, 20, 60], [-2, 20, 40], [-1, 99.5, .5], [-2, 99, 1]]) {
    const { sim, player, events } = room(value ? stats({ chemistry: value, agility: -value }) : null);
    player.hp = hp;
    sim.pickups.set('health', { id: 'health', kind: 'health', x: player.x, y: 0, z: player.z, expiresAt: Infinity });
    sim.collectPickups();
    const pickup = events.findLast(event => event.event === 'pickup');
    assert.equal(player.hp, Math.min(100, hp + healed), `${value} from ${hp}`); assert.equal(pickup.healed, healed);
    assert.equal(sim.pickups.has('health'), false, 'the medkit is used up');
    // Only a medkit that leaves health missing says so (the standard event is unchanged).
    assert.equal(Object.hasOwn(pickup, 'partial'), player.hp < 100); if (player.hp < 100) assert.equal(pickup.partial, true);
  }
  const vitality = room(stats({ chemistry: -1, strength: 1 })).player;
  assert.equal(characterStats(vitality).medkitHealMultiplier, .75);
  assert.equal(characterStats({ bonus: { medic: 8 } }).medkitHealMultiplier, 1, 'the Secouriste ladder never touches medkits');
});

test('debts are always claimable, repaid one level per claim, and talents climb two levels', () => {
  const { sim, player, events } = room({ preset: 'pyro' }, { wave: 2 });
  player.inventory = { katana: { ammo: 0, reserve: 0 } }; player.weapon = player.weaponId = 'katana';
  sim.beginSupplyWave(); at(player, sim.supplyCrate);
  // Ballistics −1: bullet bonuses without a gun; strength −1: melee as usual.
  for (const kind of ['perforating', 'reinforced', 'stone', 'vitality']) assert.equal(sim.bonusEligible(player, kind), true, kind);
  const blade = room().player; blade.inventory = { katana: { ammo: 0, reserve: 0 } };
  assert.equal(room().sim.bonusEligible(blade, 'perforating'), false, 'without a debt the gun rule stays');
  assert.equal(sim.claimSupply(player.id, 'reinforced', sim.supplyCrate.id), true);
  assert.equal(player.bonus, null, 'a repayment adds no level and no empty bonus map');
  assert.equal(Object.hasOwn(player.sheetDebt, 'reinforced'), false);
  assert.deepEqual(events.findLast(event => event.event === 'supply-claimed'), { ...events.findLast(event => event.event === 'supply-claimed'),
    bonus: 'reinforced', level: 0, repaid: true, effective: 0 });
  sim.wave = 3; sim.beginSupplyWave();
  assert.equal(sim.claimSupply(player.id, 'grenadier', sim.supplyCrate.id), true);
  assert.deepEqual(player.bonus, { grenadier: 2 }, 'chemistry +2: two levels per claim');
  assert.equal(characterStats(player).maxGrenades, 2);
  sim.wave = 4; sim.beginSupplyWave(); sim.claimSupply(player.id, 'grenadier', sim.supplyCrate.id);
  assert.equal(player.bonus.grenadier, 4);
  assert.equal(events.findLast(event => event.event === 'supply-claimed').repaid, undefined);
  // A nurse's +1 doubles only below level 4.
  const nurse = room({ preset: 'nurse' }, { wave: 2 });
  nurse.sim.beginSupplyWave(); at(nurse.player, nurse.sim.supplyCrate);
  const levels = [];
  for (let wave = 2; wave <= 7; wave++) {
    nurse.sim.wave = wave; nurse.sim.beginSupplyWave();
    assert.equal(nurse.sim.claimSupply(nurse.player.id, 'reload', nurse.sim.supplyCrate.id), true); levels.push(nurse.player.bonus.reload);
  }
  assert.deepEqual(levels, [2, 4, 5, 6, 7, 8]);
  nurse.sim.wave = 8; nurse.sim.beginSupplyWave();
  assert.equal(nurse.sim.claimSupply(nurse.player.id, 'reload', nurse.sim.supplyCrate.id), false, 'level 8 is still the cap');
});

test('a new night, a restart, an elimination or leaving restore the innate debt; a pickup keeps it', () => {
  const { sim, player } = room({ preset: 'scout' }, { wave: 2 });
  const innate = { stone: 1, vitality: 1, rainproof: 1, toughskin: 1, perforating: 1, reinforced: 1 };
  assert.deepEqual(player.sheetDebt, innate);
  sim.beginSupplyWave(); at(player, sim.supplyCrate);
  sim.claimSupply(player.id, 'vitality', sim.supplyCrate.id);
  assert.equal(player.hp, 100); assert.equal(Object.hasOwn(player.sheetDebt, 'vitality'), false);
  // Elimination with nothing to drop still loses the repaid progress.
  sim.damagePlayer(player, 1000, { source: 'fall' }); assert.equal(player.downed, true);
  sim.time = player.bleedOutAt + .01; sim.tick(.01);
  assert.equal(player.alive, false); assert.deepEqual(player.sheetDebt, innate);
  assert.equal(characterStats(player).maxHp, 90);
  // With carried bonuses: they drop for the team and the debt comes back.
  const second = room({ preset: 'scout' }, { wave: 2 });
  second.sim.beginSupplyWave(); at(second.player, second.sim.supplyCrate);
  second.sim.claimSupply(second.player.id, 'vitality', second.sim.supplyCrate.id);
  second.player.bonus = { vitamins: 4 };
  second.sim.dropBonus(second.player);
  assert.equal(second.player.bonus, null); assert.deepEqual(second.player.sheetDebt, innate);
  const dropped = [...second.sim.pickups.values()].find(pickup => pickup.kind === 'bonus');
  assert.deepEqual(dropped.bonus, { kind: 'vitamins', level: 4 });
  // A teammate in debt picks up a dropped bonus: level L, debt kept, L − debt.
  const heavy = second.sim.addPlayer('heavy', 'Heavy', undefined, { sheet: stats({ strength: -2, agility: 2 }) });
  Object.assign(heavy, { alive: true, waiting: false, downed: false, hp: 80, interactAfter: 0 });
  const vitality = { id: 'drop', kind: 'bonus', x: -4.4, y: 0, z: 4, bonus: { kind: 'vitality', level: 3 }, expiresAt: Infinity };
  second.sim.pickups.set(vitality.id, vitality); at(heavy, vitality);
  assert.equal(second.sim.takeBonus(heavy.id, vitality.id), true);
  assert.deepEqual([heavy.bonus.vitality, heavy.sheetDebt.vitality, characterStats(heavy).maxHp], [3, 2, 110]);
  // Leaving drops everything and resets the debt (the player is gone after).
  const leaving = room({ preset: 'mechanic' }, { wave: 2 });
  leaving.sim.beginSupplyWave(); at(leaving.player, leaving.sim.supplyCrate);
  leaving.sim.claimSupply(leaving.player.id, 'reload', leaving.sim.supplyCrate.id);
  assert.equal(leaving.player.sheetDebt.reload, undefined);
  leaving.sim.addPlayer('other', 'Other'); leaving.sim.removePlayer(leaving.player.id);
  assert.deepEqual(leaving.player.sheetDebt, innateDebt({ stats: { tinkering: 2, strength: -1, agility: -1 } }));
  // A new night (and a restart from the results) restarts from the sheet.
  for (const phase of ['gameover', 'victory']) {
    const night = room({ preset: 'scout' }, { wave: 2 });
    night.sim.beginSupplyWave(); at(night.player, night.sim.supplyCrate);
    night.sim.claimSupply(night.player.id, 'vitality', night.sim.supplyCrate.id);
    night.player.bonus = { vitality: 5 }; night.player.hp = 12;
    night.sim.phase = phase;
    assert.equal(night.sim.start(night.player.id), true);
    assert.deepEqual(night.player.sheetDebt, innate); assert.equal(night.player.bonus, null);
    assert.equal(night.player.hp, 90); assert.deepEqual(night.player.inventory, { pistol: { ammo: 12, reserve: 36 } });
  }
});

test('the sheet can change in the lobby, the results or while waiting, never once in a running night', () => {
  const sim = new RoomSimulation('LOCKS', { random: () => .5 });
  const host = sim.addPlayer('host', 'Host');
  assert.equal(sim.setSheet('host', { preset: 'mechanic' }), true);
  assert.deepEqual([host.sheet.preset, host.hp, host.inventory.pistol.ammo, host.inventory.pistol.reserve], ['mechanic', 90, 12, 36]);
  assert.equal(sim.setSheet('host', stats({ tinkering: -2, strength: 2 })), true);
  assert.deepEqual([host.sheet.preset, host.hp, host.inventory.pistol.ammo, host.inventory.pistol.reserve], [null, 100, 10, 29]);
  assert.equal(sim.setSheet('host', { stats: { strength: 3 } }), true, 'an invalid sheet is the standard one');
  assert.equal(host.sheet.preset, 'standard'); assert.deepEqual(host.sheetDebt, {});
  sim.start('host');
  for (const phase of ['countdown', 'wave', 'intermission', 'extraction']) {
    sim.phase = phase;
    assert.equal(sim.setSheet('host', { preset: 'pyro' }), false, phase);
    assert.equal(host.sheet.preset, 'standard');
  }
  sim.phase = 'intermission';
  const late = sim.addPlayer('late', 'Late', undefined, { defer: true, sheet: { preset: 'hunter' } });
  assert.equal(late.waiting, true); assert.equal(late.sheet.preset, 'hunter');
  assert.equal(sim.setSheet('late', { preset: 'lumberjack' }), true, 'a waiting survivor may still change');
  assert.equal(late.hp, 100); assert.deepEqual(late.inventory.pistol, { ammo: 11, reserve: 32 });
  sim.setSheet('late', stats({ strength: -2, agility: 2 })); assert.equal(late.hp, 80);
  late.ready = true; sim.admitReadyPlayers(); assert.equal(late.waiting, false); assert.equal(late.hp, 80);
  assert.equal(sim.setSheet('late', { preset: 'nurse' }), false, 'admitted into the running night');
  for (const phase of ['gameover', 'victory']) {
    sim.phase = phase; host.hp = 33;
    assert.equal(sim.setSheet('host', stats({ strength: -1, agility: 1 })), true, phase);
    assert.equal(host.hp, 33, 'the results do not heal; the next night does');
    assert.deepEqual(host.sheetDebt, { stone: 1, vitality: 1, rainproof: 1, toughskin: 1 });
  }
  assert.equal(sim.setSheet('missing', { preset: 'pyro' }), false);
  // The weapon stand and the companions always play the standard sheet.
  const practice = new RoomSimulation('STAND', { practice: true });
  const tester = practice.addPlayer('p', 'P', undefined, { sheet: { preset: 'pyro' } });
  assert.equal(tester.sheet.preset, 'standard'); assert.equal(practice.setSheet('p', { preset: 'pyro' }), false);
  const bot = sim.addPlayer('bot', 'Bot', undefined, { companion: true, sheet: { preset: 'scout' } });
  assert.equal(bot.sheet.preset, 'standard'); assert.deepEqual(bot.sheetDebt, {});
  sim.phase = 'lobby'; assert.equal(sim.setSheet('bot', { preset: 'scout' }), false);
});

test('snapshots carry the character and only the debt still owed', () => {
  for (const online of [false, true]) {
    const { sim, player } = room({ preset: 'hunter', name: '  Robin\u0007 ' }, { online, wave: 2 });
    let self = sim.snapshot().players[0];
    assert.deepEqual(self.character, { preset: 'hunter', name: 'Robin', stats: { strength: 0, agility: -1, ballistics: 2, tinkering: 0, chemistry: -1 } });
    assert.deepEqual(self.sheetDebt, { vitamins: 1, reload: 1, switching: 1, grenadier: 1, frostaura: 1, medic: 1 });
    self.character.stats.ballistics = -2; self.sheetDebt.medic = 0;
    assert.equal(player.sheet.stats.ballistics, 2, 'a snapshot is a copy'); assert.equal(player.sheetDebt.medic, 1);
    const standard = room(null, { online });
    self = standard.sim.snapshot().players[0];
    assert.deepEqual(self.character, { preset: 'standard', name: '', stats: { strength: 0, agility: 0, ballistics: 0, tinkering: 0, chemistry: 0 } });
    assert.equal(self.sheetDebt, null);
  }
});
