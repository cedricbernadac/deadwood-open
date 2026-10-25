import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { RoomSimulation, WEAPONS, MINIGUN_WINDUP } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { createOnlineServer } from '../online-server.mjs';
import { onlineConfig } from '../online-config.mjs';
import { characterStats } from '../public/character-bonuses.js';
import { activeWeaponId } from '../public/weapon-inventory.js';
import { predictMovement } from '../public/online/physics.js';
import { OnlineSession } from '../public/online/session.js';
import { WEAPON_MOVEMENT, REVIVE, EXTERIOR } from '../public/rules.js';
import { enemyProfile } from '../public/enemies.js';
import { PLAYER_POSTURE } from '../public/movement.js';

function room({ bonus = null, online = false, companions = false } = {}) {
  const events = [], Simulation = online ? OnlineRoomSimulation : RoomSimulation;
  const sim = new Simulation('BONUSES', { random: () => .5, clock: () => 1000, onEvent: event => events.push(event) });
  const player = sim.addPlayer('host', 'Host');
  sim.start('host');
  Object.assign(sim, { phase: 'wave', wave: 3, toSpawn: 1, spawnTimer: 1e9, time: 1 });
  Object.assign(player, { x: -4.5, y: 0, z: 1.5, yaw: 0, pitch: 0, bonus,
    ...(companions ? { companion: true, collectTargetId: null } : {}) });
  sim.zombies.clear(); sim.spawnWarnings.clear();
  return { sim, player, events };
}
function guns(player, ids = ['pistol', 'assault']) {
  player.inventory = Object.fromEntries(ids.map(id => [id, { ammo: 3, reserve: 40 }]));
  player.weaponId = ids[0]; player.weapon = ids[0].split('#')[0];
  player.weaponStates = {}; player.shotAfter = 0; player.reloadUntil = 0;
}
const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} vs ${expected}`);
const target = (sim, extra = {}) => {
  const zombie = { id: `test-${sim.zombies.size}`, kind: 'walker', x: -4.5, y: 0, z: -.5, hp: 100000, maxHp: 100000,
    scale: 1, speed: 2, entered: true, attackAfter: Infinity, ...extra };
  sim.zombies.set(zombie.id, zombie); return zombie;
};
function dual(options = {}) {
  const scene = room({ bonus: { switching: 8, ...options.bonus }, online: options.online });
  guns(scene.player, options.ids);
  assert.equal(scene.sim.setDualWield(scene.player.id, true, Object.keys(scene.player.inventory)[1]), true);
  scene.sim.time += .03;
  return scene;
}

test('vitamins multiply actual walk, sprint and crouch speed with identical online prediction', () => {
  for (const level of [0, 1, 4, 8]) for (const stance of [{}, { sprint: true }, { crouch: true }]) {
    const { sim, player } = room({ bonus: { vitamins: level } });
    const command = { forward: 1, strafe: 0, yaw: 0, pitch: 0, ...stance };
    const snapshot = sim.snapshot(), predicted = predictMovement(player, command, 1 / 30, snapshot);
    const before = player.z;
    sim.setInput(player.id, command); sim.time += 1 / 30; sim.movePlayer(player, 1 / 30);
    near(player.x, predicted.x); near(player.y, predicted.y); near(player.z, predicted.z);
    const speed = stance.crouch ? 3.5 * PLAYER_POSTURE.crouchSpeed : stance.sprint ? 5.4 : 3.5;
    near(before - player.z, speed * WEAPON_MOVEMENT.pistol * (1 + level * .03) / 30);
  }
});

test('dual mobility uses the slower held weapon and backpack weight without granting extra slots', () => {
  const { sim, player } = dual({ ids: ['pistol', 'minigun'], bonus: { vitamins: 8 } });
  player.backpack = true; player.inventory.assault = { ammo: 5, reserve: 0 };
  const multiplier = .72 * .9 * 1.24;
  near(sim.playerMovementMultiplier(player), multiplier);
  const input = { forward: 1, strafe: 0, yaw: 0, pitch: 0, sprint: true };
  const predicted = predictMovement(player, input, 1 / 30, sim.snapshot());
  sim.setInput(player.id, input); sim.time += 1 / 30; sim.movePlayer(player, 1 / 30);
  near(player.z, predicted.z);
  assert.equal(sim.weaponSlots(player), 4); assert.equal(Object.keys(player.inventory).length, 3);
  assert.equal(sim.setDualWield(player.id, false), true);
  near(sim.playerMovementMultiplier(player), 1.08 * .9 * 1.24);
});

test('reload bonuses shorten real completion and changing the bonus rescales remaining time once', () => {
  const { sim, player } = room({ bonus: { reload: 4 } });
  player.inventory.pistol = { ammo: 0, reserve: 12 };
  assert.equal(sim.reload(player.id), true);
  near(player.reloadUntil - sim.time, 1.25 * .75);
  sim.time += .2;
  const previous = characterStats(player), remaining = player.reloadUntil - sim.time;
  player.bonus.reload = 8; sim.syncCharacterBonuses(player, previous);
  near(player.reloadUntil - sim.time, remaining * .5 / .75);
  sim.time = player.reloadUntil - 1e-5; sim.completeWeaponReloads(player);
  assert.equal(player.inventory.pistol.ammo, 0);
  sim.time += 2e-5; sim.completeWeaponReloads(player);
  assert.deepEqual(player.inventory.pistol, { ammo: 12, reserve: 0 });
});

test('switching levels change fire lock but preserve an already owed firing cooldown', () => {
  for (const [level, duration] of [[0, .25], [1, .2], [4, .095], [8, .02]]) {
    const { sim, player } = room({ bonus: { switching: level } }); guns(player);
    assert.equal(sim.chooseWeapon(player.id, 'assault'), true);
    near(player.shotAfter - sim.time, duration);
    player.shotAfter = sim.time + .8;
    assert.equal(sim.chooseWeapon(player.id, 'pistol'), true);
    near(player.shotAfter - sim.time, .8);
  }
});

test('the 20 ms quick-hands lock cannot be bypassed by the gun cadence tolerance', () => {
  const { sim, player } = room({ bonus: { switching: 8 } }); guns(player);
  assert.equal(sim.chooseWeapon(player.id, 'assault'), true);
  assert.equal(sim.shoot(player.id), false);
  sim.time += .019; assert.equal(sim.shoot(player.id), false);
  sim.time += .001; assert.equal(sim.shoot(player.id), true);
});

test('vitality adds only new capacity, health pickups and intermissions fill that capacity, death never heals', () => {
  const { sim, player } = room(); player.hp = 50;
  const base = characterStats(player); player.bonus = { vitality: 3 };
  sim.syncCharacterBonuses(player, base);
  assert.equal(player.hp, 80); assert.equal(sim.snapshot().players[0].maxHp, 130);
  sim.pickups.set('health', { id: 'health', kind: 'health', x: player.x, y: 0, z: player.z, expiresAt: Infinity });
  sim.collectPickups(); assert.equal(player.hp, 130); assert.equal(sim.pickups.has('health'), false);
  player.hp = 20; sim.finishWave(); assert.equal(player.hp, 130);
  player.downed = true; player.hp = 0;
  const before = characterStats(player); player.bonus.vitality = 8; sim.syncCharacterBonuses(player, before);
  assert.equal(player.hp, 0); assert.equal(player.downed, true);
  sim.revivePlayer(player, REVIVE.teammateHp); assert.equal(player.hp, REVIVE.teammateHp);
  player.hp = 180; const grown = characterStats(player); player.bonus = null; sim.syncCharacterBonuses(player, grown);
  assert.equal(player.hp, 100);
  sim.phase = 'gameover'; sim.start(player.id);
  assert.equal(player.hp, 100); assert.equal(player.bonus, null); assert.equal(player.dualWield, false);
});

test('rainproof and tough skin protect their own sources before armor, never fall damage', () => {
  const { sim, player } = room({ bonus: { rainproof: 8, toughskin: 8 } });
  player.armor = 100;
  sim.damagePlayer(player, 100, { id: 'z' }); assert.equal(player.armor, 24); assert.equal(player.hp, 100);
  player.armor = 100; sim.damagePlayer(player, 100, { source: 'raider', id: 'r', x: 0, z: 0 }); assert.equal(player.armor, 24);
  sim.damagePlayer(player, 50, { source: 'outside' }); assert.equal(player.hp, 90); assert.equal(player.armor, 24);
  sim.damagePlayer(player, 30, { source: 'fall' }); assert.equal(player.hp, 84); assert.equal(player.armor, 0);
  player.hp = 100; player.armor = 0; Object.assign(player, { x: 20, y: 0, z: 20 });
  sim.updateOutsideDamage(player, 1);
  near(player.hp, 100 - EXTERIOR.damagePerSecond * .2, .001);
});

test('the first aider changes a manual channel, not kit duration or revived HP', () => {
  const { sim, player, events } = room({ bonus: { medic: 8 } });
  const mate = sim.addPlayer('mate', 'Mate');
  Object.assign(mate, { x: player.x, y: 0, z: player.z - .7, downed: true, hp: 0, bleedOutAt: sim.time + 30 });
  assert.equal(sim.interact(player.id), true);
  assert.equal(events.findLast(event => event.event === 'revive-start').duration, 2);
  for (let index = 0; index < 59; index++) {
    sim.time += 1 / 30; sim.interact(player.id); sim.updateRevives(1 / 30);
  }
  assert.equal(mate.downed, true); near(sim.reviveStatus(player).reviveLeft, 1 / 30);
  sim.time += 1 / 30; sim.interact(player.id); sim.updateRevives(1 / 30);
  assert.equal(mate.downed, false); assert.equal(mate.hp, REVIVE.teammateHp);
  player.reviveKit = true; player.downed = true; player.hp = 0;
  assert.equal(sim.useReviveKit(player.id), true); near(player.selfReviveAt - sim.time, REVIVE.kitDuration);
});

test('frost is continuous, strongest only, halved for bosses, excludes raiders and stops for a downed carrier', () => {
  const { sim, player } = room({ bonus: { frostaura: 8 } });
  const mate = sim.addPlayer('mate'); Object.assign(mate, { x: -4.6, y: 0, z: 1.5, bonus: { frostaura: 1 } });
  const normal = target(sim), boss = target(sim, { id: 'boss', boss: true }), raider = target(sim, { id: 'raider', kind: 'raider' });
  sim.updateFrostAuras();
  near(normal.frostSlow, .25); near(boss.frostSlow, .125); assert.equal(raider.frostSlow, 0);
  assert.equal(sim.snapshot().zombies.find(enemy => enemy.id === normal.id).frostSlow, .25);
  player.downed = true; sim.updateFrostAuras(); near(normal.frostSlow, 0);
  mate.bonus.frostaura = 8; sim.updateFrostAuras(); near(normal.frostSlow, .25);
  mate.alive = false; sim.updateFrostAuras(); assert.equal(normal.frostSlow, 0);
  player.downed = false; normal.z = player.z - 4.01; sim.updateFrostAuras(); assert.equal(normal.frostSlow, 0);
});

test('frost respects actual partitions, barricades and floors and changes movement without slowing bites', () => {
  const { sim, player } = room({ bonus: { frostaura: 8 } });
  const zombie = target(sim, { x: 0, y: 0, z: -3 }); Object.assign(player, { x: 0, y: 0, z: -1 });
  sim.updateFrostAuras(); assert.equal(zombie.frostSlow, 0, 'solid central partition');
  Object.assign(player, { x: -7.2, z: 0 }); Object.assign(zombie, { x: -8.8, z: 0 });
  sim.updateFrostAuras(); assert.equal(zombie.frostSlow, 0, 'intact west barricade');
  sim.doors.find(door => door.id === 'west').boards.fill(0);
  sim.updateFrostAuras(); near(zombie.frostSlow, .25);
  Object.assign(player, { x: 4, y: 3.4, z: 2 }); Object.assign(zombie, { x: 4, y: 0, z: 2 });
  sim.updateFrostAuras(); assert.equal(zombie.frostSlow, 0, 'floor separates carriers and enemies');
  Object.assign(player, { x: -4.5, y: 0, z: 1.5 }); Object.assign(zombie, { x: -4.5, y: 0, z: -.5 });
  sim.updateFrostAuras();
  const before = zombie.z; sim.moveZombieTowards(zombie, { x: zombie.x, z: zombie.z + 1 }, .1, false);
  near(zombie.z - before, 2 * .75 * .1);
  zombie.z = player.z - .7; zombie.attackAfter = 0;
  sim.updateZombie(zombie, .1, [player]); near(zombie.attackAfter - sim.time, enemyProfile(zombie).attackInterval);
});

test('dual wield validates level, distinct carried instances and ranged weapons without manufacturing anything', () => {
  const { sim, player } = room({ bonus: { switching: 7 } }); guns(player);
  const before = JSON.stringify(player.inventory);
  assert.equal(sim.setDualWield(player.id, true, 'assault'), false);
  player.bonus.switching = 8;
  for (const id of [undefined, null, 'forged', 'pistol']) assert.equal(sim.setDualWield(player.id, true, id), false);
  player.inventory.bat = { ammo: 0, reserve: 0 };
  assert.equal(sim.setDualWield(player.id, true, 'bat'), false); delete player.inventory.bat;
  assert.equal(JSON.stringify(player.inventory), before);
  assert.equal(sim.setDualWield(player.id, true, 'assault'), true);
  assert.equal(sim.weaponSlots(player), 2); assert.equal(JSON.stringify(player.inventory), before);
  assert.equal(sim.setDualWield(player.id, true, 'assault'), true, 'idempotent command does not reset the pair');
});

test('two identical copies consume their own ammo and keep independent firing slots, with actual impact identity', () => {
  const { sim, player, events } = dual({ ids: ['pistol', 'pistol#2'] });
  target(sim, { z: -1.5, speed: 0 });
  assert.equal(sim.shoot(player.id, 0, undefined, 'primary'), true);
  assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), true);
  assert.equal(sim.shoot(player.id, 0, undefined, 'primary'), false);
  assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), false);
  assert.equal(player.inventory.pistol.ammo, 2); assert.equal(player.inventory['pistol#2'].ammo, 2);
  assert.equal(activeWeaponId(player), 'pistol');
  assert.deepEqual(events.filter(event => event.event === 'shot').map(event => [event.hand, event.weaponId]), [['primary', 'pistol'], ['secondary', 'pistol#2']]);
  sim.time += .1; sim.updateBullets(.1);
  const impacts = events.filter(event => event.event === 'bullet-impact' && event.stop === 'zombie');
  assert.deepEqual(new Set(impacts.map(event => event.hand)), new Set(['primary', 'secondary']));
  assert.deepEqual(new Set(impacts.map(event => event.weaponId)), new Set(['pistol', 'pistol#2']));
});

test('different guns fire at their own rates and neither hand borrows the other cooldown', () => {
  const { sim, player, events } = dual({ ids: ['pistol', 'assault'] });
  for (const stock of Object.values(player.inventory)) { stock.ammo = 100; stock.reserve = 0; }
  const began = sim.time;
  for (let step = 0; step <= 100; step++) {
    sim.time = began + step / 100;
    sim.shoot(player.id, 0, undefined, 'primary'); sim.shoot(player.id, 0, undefined, 'secondary');
  }
  const primary = events.filter(event => event.event === 'shot' && event.hand === 'primary');
  const secondary = events.filter(event => event.event === 'shot' && event.hand === 'secondary');
  assert.ok(secondary.length >= primary.length + 3, 'the faster assault rifle owns its independent slots');
  assert.ok(primary.length <= 1 + Math.ceil(1 / WEAPONS.pistol.interval));
  assert.ok(secondary.length <= 1 + Math.ceil(1 / WEAPONS.assault.interval));
  assert.equal(player.inventory.pistol.ammo, 100 - primary.length);
  assert.equal(player.inventory.assault.ammo, 100 - secondary.length);
});

test('reload both runs in parallel with separate durations; a ready hand fires while its partner reloads', () => {
  const { sim, player } = dual({ bonus: { reload: 8 } });
  player.inventory.pistol = { ammo: 0, reserve: 12 }; player.inventory.assault = { ammo: 0, reserve: 24 };
  assert.equal(sim.reload(player.id), true);
  const state = sim.snapshot().players[0];
  near(state.hands.primary.reloadDuration, .625); near(state.hands.secondary.reloadDuration, .8);
  assert.equal(state.hands.primary.reloading, true); assert.equal(state.hands.secondary.reloading, true);
  sim.time += .625; sim.completeWeaponReloads(player);
  assert.equal(player.inventory.pistol.ammo, 12); assert.equal(player.inventory.assault.ammo, 0);
  assert.equal(sim.shoot(player.id), true); assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), false);
  sim.time += .175 + 1e-6; sim.completeWeaponReloads(player);
  assert.deepEqual(player.inventory.assault, { ammo: 24, reserve: 0 });
  assert.equal(player.inventory.pistol.ammo, 11);
});

test('a full primary magazine does not prevent a secondary reload or overwrite primary handling', () => {
  const { sim, player } = dual();
  player.inventory.pistol = { ammo: 12, reserve: 36 }; player.inventory.assault = { ammo: 0, reserve: 24 };
  const primary = sim.weaponHandState(player, 'primary');
  assert.equal(sim.reload(player.id), true);
  assert.deepEqual(sim.weaponHandState(player, 'primary'), primary);
  assert.equal(sim.weaponHandState(player, 'secondary').reloadUntil, sim.time + 1.6);
  assert.equal(sim.reload(player.id, 'forged'), false); assert.equal(sim.shoot(player.id, 0, undefined, 'forged'), false);
});

test('a secondary minigun spins independently; umbrella, pause and downing apply to both hands', () => {
  const { sim, player } = dual({ ids: ['pistol', 'minigun'] });
  assert.equal(sim.setMinigunSpin(player.id, true, 'secondary'), true);
  assert.equal(player.minigunSpinning, false);
  assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), false);
  sim.time += MINIGUN_WINDUP;
  assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), true);
  assert.equal(sim.setUmbrella(player.id, true), false, 'secondary recovery also gates the umbrella');
  sim.time += WEAPONS.minigun.interval + .001;
  assert.equal(sim.setUmbrella(player.id, true), true);
  assert.equal(sim.weaponHandState(player, 'secondary').minigunSpinning, false);
  assert.equal(sim.shoot(player.id), false); assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), false);
  sim.setUmbrella(player.id, false);
  assert.equal(sim.setMinigunSpin(player.id, true, 'secondary'), true);
  sim.setPause(player.id, true);
  assert.equal(sim.weaponHandState(player, 'secondary').minigunSpinning, false);
  assert.equal(sim.shoot(player.id), false); assert.equal(sim.reload(player.id), false);
  sim.setPause(player.id, false);
  player.inventory.pistol.ammo = 0; player.inventory.minigun.ammo = 0;
  sim.reload(player.id); sim.damagePlayer(player, 1000, { id: 'zombie' });
  assert.equal(player.downed, true); assert.equal(sim.weaponHandState(player, 'secondary').reloadUntil, 0);
  assert.equal(sim.shoot(player.id), false); assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), false);
});

test('losing quick hands, losing an instance, dropping or robbery invalidates the pair without duplicating stock', () => {
  for (const action of ['bonus', 'bonus-drop', 'secondary', 'drop', 'rob']) {
    const { sim, player } = dual();
    if (action === 'bonus') { const previous = characterStats(player); player.bonus = null; sim.syncCharacterBonuses(player, previous); }
    if (action === 'bonus-drop') sim.dropBonus(player);
    if (action === 'secondary') { delete player.inventory.assault; sim.normalizeDualWield(player); }
    if (action === 'drop') assert.equal(sim.dropWeapon(player.id), true);
    if (action === 'rob') sim.robPlayer(player);
    assert.equal(player.dualWield, false, action); assert.equal(player.secondaryWeaponId, null, action);
    assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), false, action);
    assert.equal(player.inventory.assault?.ammo ?? 0, action === 'secondary' ? 0 : 3, action);
  }
});

test('refused commands during a dual pause leave the entire player state unchanged', () => {
  const { sim, player } = dual({ ids: ['pistol', 'minigun'] });
  sim.setMinigunSpin(player.id, true, 'secondary');
  sim.setPause(player.id, true);
  const before = structuredClone(player);
  for (const action of [() => sim.shoot(player.id), () => sim.shoot(player.id, 0, undefined, 'secondary'),
    () => sim.reload(player.id), () => sim.reload(player.id, 'secondary'), () => sim.setMinigunSpin(player.id, true, 'secondary'),
    () => sim.setDualWield(player.id, false)]) assert.equal(action(), false);
  assert.deepEqual(player, before);
  assert.equal(Object.hasOwn(player, '_weaponHand'), false);
});

test('a fatal bite removes its carriers frost effect before the final snapshot freezes', () => {
  const { sim, player } = room({ bonus: { frostaura: 8 } }), zombie = target(sim);
  sim.updateFrostAuras(); assert.equal(zombie.frostSlow, .25);
  sim.damagePlayer(player, 1000, zombie);
  assert.equal(zombie.frostSlow, 0);
  sim.endGame(); assert.equal(sim.snapshot().zombies[0].frostSlow, 0);
});

test('switching out of dual mode cannot erase a fired gun cooldown or finish an abandoned reload', () => {
  const { sim, player } = dual();
  assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), true);
  const owed = sim.weaponHandState(player, 'secondary').shotAfter;
  sim.setDualWield(player.id, false);
  sim.setDualWield(player.id, true, 'assault');
  near(sim.weaponHandState(player, 'secondary').shotAfter, owed);
  assert.equal(sim.shoot(player.id, 0, undefined, 'secondary'), false);
  sim.time += 1; player.inventory.assault.ammo = 0;
  sim.reload(player.id, 'secondary'); sim.setDualWield(player.id, false);
  sim.time += 10; sim.completeWeaponReloads(player);
  assert.equal(player.inventory.assault.ammo, 0);
});

test('online shot commands and prediction retain secondary identity with unique shot IDs', () => {
  const { sim, player, events } = dual({ online: true });
  assert.equal(sim.shootOnline(player.id, 0, { shotId: 1, hand: 'secondary', yaw: 0, pitch: 0 }), true);
  assert.equal(sim.shootOnline(player.id, 0, { shotId: 2, hand: 'primary', yaw: 0, pitch: 0 }), true);
  assert.deepEqual(events.filter(event => event.event === 'shot').map(event => [event.shotId, event.hand, event.weaponId]),
    [[1, 'secondary', 'assault'], [2, 'primary', 'pistol']]);
  const snapshot = sim.snapshot(1000), session = new OnlineSession({ playerId: player.id, now: () => 1000 });
  assert.equal(session.ingestSnapshot(snapshot), true);
  assert.equal(session.createShot({ hand: 'secondary' }).hand, 'secondary');
  assert.equal(session.createShot({ hand: 'forged' }), null);
  assert.equal(snapshot.players[0].hands.secondary.ammo, 2);
  assert.equal(snapshot.players[0].hands.primary.ammo, 2);
});

test('real online WebSocket routing enforces the pair and forwards secondary fire/reload without losing primary identity', { timeout: 10000 }, async t => {
  let now = 1000;
  const server = createOnlineServer({ port: 0, host: '127.0.0.1', autoTick: false, clock: () => now, config: onlineConfig({}) });
  const address = await server.listen();
  t.after(() => server.close());
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`), messages = [], waiters = new Set();
  socket.on('message', data => { const message = JSON.parse(data); messages.push(message); for (const waiter of [...waiters]) if (waiter.accept(message)) waiter.finish(message); });
  socket.on('error', () => {});
  const wait = (accept, start = messages.length) => {
    const existing = messages.slice(start).find(accept); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('Character bonus socket response timeout')); }, 3000);
      const waiter = { accept, finish(message) { clearTimeout(timer); waiters.delete(waiter); resolve(message); } }; waiters.add(waiter);
    });
  };
  const send = message => { const start = messages.length; socket.send(JSON.stringify(message)); return start; };
  await once(socket, 'open');
  let start = send({ type: 'join', protocol: 1, build: server.build, name: 'Dual tester' });
  const welcome = await wait(message => message.type === 'welcome', start);
  const simulation = server.rooms.get(welcome.room).simulation, player = simulation.players.get(welcome.id);
  simulation.start(player.id); Object.assign(simulation, { phase: 'wave', toSpawn: 1, spawnTimer: 1e9 });
  player.bonus = { switching: 8 }; guns(player);
  start = send({ type: 'dual-wield', enabled: true, secondaryWeaponId: 'assault' });
  await wait(message => message.event === 'dual-wield' && message.enabled, start);
  simulation.time += .03; now += 30;
  start = send({ type: 'shoot', shotId: 1, hand: 'secondary', yaw: 0, pitch: 0 });
  const shot = await wait(message => message.event === 'shot', start);
  assert.equal(shot.hand, 'secondary'); assert.equal(shot.weaponId, 'assault'); assert.equal(shot.shotId, 1);
  assert.equal(player.inventory.pistol.ammo, 3); assert.equal(player.inventory.assault.ammo, 2);
  start = send({ type: 'reload', hand: 'secondary' });
  const reload = await wait(message => message.event === 'reload', start);
  assert.equal(reload.hand, 'secondary'); assert.equal(player.reloadUntil, 0);
  const snapshot = simulation.snapshot(); assert.equal(snapshot.players[0].weaponId, 'pistol'); assert.equal(snapshot.players[0].hands.secondary.reloading, true);
  guns(player, ['minigun', 'pistol']);
  send({ type: 'minigun-spin', spinning: true, hand: { ready: true, until: -999 } });
  start = send({ type: 'ping', time: now });
  await wait(message => message.type === 'pong', start);
  assert.equal(player.minigunSpinning, false, 'network hand objects are refused even though legacy internal metadata is ignored');
  start = send({ type: 'minigun-spin', spinning: true, hand: 'primary', ready: true, until: -999 });
  await wait(message => message.event === 'minigun-spin' && message.spinning, start);
  near(player.minigunSpinUntil - simulation.time, MINIGUN_WINDUP);
  const previous = characterStats(player);
  player.bonus.grenadier = 8;
  simulation.syncCharacterBonuses(player, previous);
  assert.equal(simulation.snapshot().players[0].maxGrenades, 5);
  assert.equal(simulation.snapshot().players[0].grenadierLeft, 10);
  start = messages.length;
  for (let tick = 0; tick < 300; tick++) simulation.tick(1 / 30);
  const regenerated = await wait(message => message.event === 'grenade-regenerated', start);
  assert.equal(regenerated.id, player.id);
  assert.equal(regenerated.grenades, 1); assert.equal(regenerated.maxGrenades, 5);
  socket.close(); await once(socket, 'close');
});
