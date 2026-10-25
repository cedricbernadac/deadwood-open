import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { OnlineSession } from '../public/online/session.js';
import { CHARACTER_BONUSES, characterStats, characterBonusDescription } from '../public/character-bonuses.js';
import { GRENADES } from '../public/rules.js';
import { LATE_SUPPLIES } from '../public/weapon-upgrades.js';
import { enemyHitbox, enemyDamageMultiplier } from '../public/enemies.js';
import { blastDamageAtDistance } from '../public/area-damage.js';

const INTERVALS = [20, 20, 17, 17, 14, 14, 12, 10];
const CAPACITIES = [2, 2, 3, 3, 3, 4, 4, 5];
const DAMAGE_BONUSES = [0, 10, 10, 20, 20, 30, 40, 50];

function room({ online = false, practice = false, level = 1 } = {}) {
  const events = [], Simulation = online ? OnlineRoomSimulation : RoomSimulation;
  const sim = new Simulation('GRENADIER', { practice, raids: false, random: () => .5, clock: () => 1000,
    onEvent: event => events.push(event) });
  const player = sim.addPlayer('host', 'Host');
  if (!practice) sim.start(player.id);
  Object.assign(sim, { phase: 'wave', wave: 2, toSpawn: 1, spawnTimer: 1e9 });
  grant(sim, player, level);
  return { sim, player, events };
}
function grant(sim, player, level) {
  const before = characterStats(player);
  player.bonus = level ? { ...(player.bonus ?? {}), grenadier: level } : null;
  sim.syncCharacterBonuses(player, before);
}
function advance(sim, seconds) {
  for (let left = seconds; left > 1e-10; left -= .1) sim.tick(Math.min(.1, left));
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} versus ${expected}`); }
function state(sim, player) { return sim.snapshot().players.find(candidate => candidate.id === player.id); }
function blastTarget(sim, overrides = {}) {
  const zombie = sim.spawnZombie();
  Object.assign(zombie, { x: 10, y: 0, z: -5, hp: 10000, maxHp: 10000, kind: 'walker', scale: 1,
    boss: false, entered: true, speed: 0, attackAfter: Infinity, ...overrides });
  return zombie;
}
function throwAtTargets(sim, player, target) {
  player.grenades = Math.max(1, player.grenades);
  assert.equal(sim.throwGrenade(player.id), true);
  const grenade = [...sim.grenades.values()].at(-1), box = enemyHitbox(target);
  Object.assign(grenade, { x: 10, y: (box.minY + box.maxY) / 2, z: -5 });
  return grenade;
}

test('Grenadier exposes all eight intervals, registers for every loadout, and describes both languages', () => {
  assert.deepEqual(CHARACTER_BONUSES.grenadier.effects.grenadeIntervalSeconds, INTERVALS);
  assert.deepEqual(CHARACTER_BONUSES.grenadier.effects.maxGrenades, CAPACITIES);
  assert.deepEqual(CHARACTER_BONUSES.grenadier.effects.grenadeDamageBonusPercent, DAMAGE_BONUSES);
  assert.equal(characterStats(null).grenadeIntervalSeconds, 0);
  assert.equal(characterStats(null).maxGrenades, GRENADES.maxCarry);
  for (let level = 1; level <= 8; level++) {
    const { sim, player } = room({ level });
    const interval = INTERVALS[level - 1];
    assert.equal(characterStats(player).grenadeIntervalSeconds, interval);
    assert.equal(state(sim, player).maxGrenades, CAPACITIES[level - 1]);
    assert.equal(characterStats(player).grenadeDamageMultiplier, 1 + DAMAGE_BONUSES[level - 1] / 100);
    if (level > 1) assert.ok(INTERVALS[level - 1] < INTERVALS[level - 2]
      || CAPACITIES[level - 1] > CAPACITIES[level - 2] || DAMAGE_BONUSES[level - 1] > DAMAGE_BONUSES[level - 2], 'every level improves at least one effect');
    assert.equal(sim.bonusFitsWeapons(player, 'grenadier'), true);
    assert.ok(characterBonusDescription('grenadier', level, 'fr').includes(`${interval} s`));
    assert.ok(characterBonusDescription('grenadier', level, 'en').includes(`${interval} s`));
    assert.ok(characterBonusDescription('grenadier', level, 'fr').includes(`+${DAMAGE_BONUSES[level - 1]} %`));
    assert.equal(state(sim, player).grenadierLeft, interval);
    advance(sim, interval - .00001);
    assert.equal(player.grenades, 0, `N${level} cannot grant early`);
    sim.tick(.00001);
    assert.equal(player.grenades, 1, `N${level} grants after its complete interval`);
    near(sim.grenadierLeft(player), interval);
  }
  assert.equal(characterStats({ grenadier: 999 }).grenadeIntervalSeconds, 10);
  assert.equal(characterStats({ grenadier: NaN }).grenadeIntervalSeconds, 0);
});

test('full grenade stock discards progress and a throw starts a complete new interval without a hidden bank', () => {
  const { sim, player, events } = room({ level: 8 });
  advance(sim, 50);
  assert.equal(player.grenades, 5);
  assert.equal(state(sim, player).grenadierLeft, null);
  advance(sim, 40);
  assert.equal(player.grenades, 5);
  assert.equal(events.filter(event => event.event === 'grenade-regenerated').length, 5);
  assert.equal(sim.throwGrenade(player.id), true);
  near(sim.grenadierLeft(player), 10);
  advance(sim, 9.99999); assert.equal(player.grenades, 4);
  sim.tick(.00001); assert.equal(player.grenades, 5);
  assert.equal(state(sim, player).grenadierLeft, null);
});

test('filling the stock from a pickup then immediately throwing still discards previous regeneration progress', () => {
  const { sim, player } = room({ level: 8 });
  player.grenades = 4;
  advance(sim, 9.9);
  const pickup = { id: 'grenade-pickup', kind: 'grenade', x: player.x, y: player.y, z: player.z,
    expiresAt: sim.time + 10 };
  sim.pickups.set(pickup.id, pickup);
  sim.collectPickups();
  assert.equal(player.grenades, 5); assert.equal(sim.pickups.has(pickup.id), false);
  assert.equal(sim.throwGrenade(player.id), true);
  near(sim.grenadierLeft(player), 10);
  advance(sim, 9.99999); assert.equal(player.grenades, 4);
  sim.tick(.00001); assert.equal(player.grenades, 5);
});

test('even a damage-only Grenadier upgrade restarts its interval while unrelated bonus changes retain progress', () => {
  const { sim, player } = room({ level: 1 });
  advance(sim, 19);
  grant(sim, player, 2);
  assert.equal(state(sim, player).grenadierLeft, 20);
  advance(sim, 2);
  const before = characterStats(player);
  player.bonus.vitamins = 1;
  sim.syncCharacterBonuses(player, before);
  near(sim.grenadierLeft(player), 18);
  advance(sim, 17.99999); assert.equal(player.grenades, 0);
  sim.tick(.00001); assert.equal(player.grenades, 1);
});

test('real supply claims, upgrades, death drops and recovery restart Grenadier without creating an immediate grenade', () => {
  const { sim, player } = room({ level: 0 });
  const recipient = sim.addPlayer('recipient', 'Recipient', undefined, { companion: true });
  sim.beginSupplyWave();
  Object.assign(player, { x: sim.supplyCrate.x, y: 0, z: sim.supplyCrate.z });
  assert.equal(sim.claimSupply(player.id, 'grenadier', sim.supplyCrate.id), true);
  assert.equal(player.grenades, 0); near(sim.grenadierLeft(player), 20);
  Object.assign(player, { x: -2.8, z: 1.7 }); advance(sim, 19);
  sim.wave = 3; sim.beginSupplyWave();
  Object.assign(player, { x: sim.supplyCrate.x, z: sim.supplyCrate.z });
  assert.equal(sim.claimSupply(player.id, 'grenadier', sim.supplyCrate.id), true);
  near(sim.grenadierLeft(player), 20);
  Object.assign(player, { x: -2.8, z: 1.7 }); advance(sim, 19);
  const drops = sim.dropBonus(player);
  assert.equal(drops.length, 1); assert.equal(drops[0].bonus.level, 2);
  assert.equal(sim.grenadierLeft(player), null);
  Object.assign(recipient, { x: drops[0].x, y: drops[0].y, z: drops[0].z });
  assert.equal(sim.takeBonus(recipient.id, drops[0].id), true);
  assert.equal(recipient.bonus.grenadier, 2); assert.equal(recipient.grenades, 0);
  near(sim.grenadierLeft(recipient), 20);
  Object.assign(recipient, { x: -1.7, y: 0, z: 1.7 });
  advance(sim, 19.99999);
  assert.equal(player.grenades, 0); assert.equal(recipient.grenades, 0);
  sim.tick(.00001); assert.equal(recipient.grenades, 1); assert.equal(player.grenades, 0);
});

test('pause freezes the exact countdown and neither stock nor events change until resumed', () => {
  const { sim, player, events } = room({ level: 8 });
  advance(sim, 9.25);
  assert.equal(sim.setPause(player.id, true), true);
  const before = structuredClone(player), snapshot = state(sim, player), count = events.length;
  advance(sim, 60);
  assert.deepEqual(player, before); assert.deepEqual(state(sim, player), snapshot);
  assert.equal(events.length, count);
  assert.equal(sim.setPause(player.id, false), true);
  advance(sim, .74999); assert.equal(player.grenades, 0);
  sim.tick(.00001); assert.equal(player.grenades, 1);
});

test('downed time never accumulates and even a same-tick revival starts a complete interval', () => {
  const { sim, player } = room({ level: 8 });
  sim.addPlayer('helper', 'Helper');
  advance(sim, 9.9);
  sim.damagePlayer(player, 1000, { source: 'fall' });
  assert.equal(player.downed, true); assert.equal(sim.grenadierLeft(player), null);
  sim.revivePlayer(player, 55);
  near(sim.grenadierLeft(player), 10);
  advance(sim, 9.99999); assert.equal(player.grenades, 0);
  sim.tick(.00001); assert.equal(player.grenades, 1);
  sim.time = Math.max(sim.time, player.reviveShieldUntil);
  sim.damagePlayer(player, 1000, { source: 'fall' });
  advance(sim, 5);
  assert.equal(player.grenades, 1); assert.equal(state(sim, player).grenadierLeft, null);
  sim.revivePlayer(player, 55);
  near(sim.grenadierLeft(player), 10);
});

test('only countdown, intermission and wave time grants grenades, excluding waiting and practice', () => {
  for (const phase of ['countdown', 'intermission', 'wave']) {
    const { sim, player } = room({ level: 8 });
    sim.phase = phase; sim.timeLeft = 100;
    advance(sim, 10); assert.equal(player.grenades, 1, phase);
  }
  for (const phase of ['lobby', 'gameover', 'victory', 'extraction']) {
    const { sim, player } = room({ level: 8 });
    advance(sim, 9.9);
    sim.phase = phase; sim.timeLeft = 100;
    advance(sim, 20);
    assert.equal(player.grenades, 0, phase); assert.equal(state(sim, player).grenadierLeft, null, phase);
  }
  const { sim, player } = room({ level: 8 });
  player.waiting = true; advance(sim, 20);
  assert.equal(player.grenades, 0); assert.equal(sim.grenadierLeft(player), null);
  player.ready = true; sim.phase = 'intermission'; sim.timeLeft = 100;
  sim.admitReadyPlayers();
  near(sim.grenadierLeft(player), 10);
  advance(sim, 9.99999); assert.equal(player.grenades, 0);
  sim.tick(.00001); assert.equal(player.grenades, 1);
  const stand = room({ practice: true, level: 8 });
  advance(stand.sim, 20);
  assert.equal(stand.player.grenades, 0); assert.equal(stand.sim.grenadierLeft(stand.player), null);
});

test('humans and bots regenerate independently under the same rules and a new night clears both timers and bonus', () => {
  const { sim, player, events } = room({ level: 8 });
  const companion = sim.addPlayer('bot', 'Grenadier bot', undefined, { companion: true });
  grant(sim, companion, 7);
  advance(sim, 10);
  assert.equal(player.grenades, 1); assert.equal(companion.grenades, 0);
  advance(sim, 2);
  assert.equal(player.grenades, 1); assert.equal(companion.grenades, 1);
  advance(sim, 8);
  assert.equal(player.grenades, 2); assert.equal(companion.grenades, 1);
  assert.deepEqual(events.filter(event => event.event === 'grenade-regenerated').map(event => event.id), ['host', 'bot', 'host']);
  sim.endGame(); assert.equal(sim.start(player.id), true);
  for (const survivor of [player, companion]) {
    assert.equal(survivor.grenades, 0); assert.equal(survivor.bonus, null);
    assert.equal(survivor.grenadierUntil, null); assert.equal(sim.grenadierLeft(survivor), null);
  }
  advance(sim, 4); assert.equal(player.grenades, 0); assert.equal(companion.grenades, 0);
});

test('online disconnection discards progress and snapshots retain authoritative grenade count and remaining time', () => {
  const { sim, player } = room({ online: true, level: 8 });
  advance(sim, 9.9);
  sim.setConnected(player.id, false); advance(sim, 20);
  assert.equal(player.grenades, 0); assert.equal(state(sim, player).grenadierLeft, null);
  sim.setConnected(player.id, true);
  near(sim.grenadierLeft(player), 10);
  advance(sim, 9.99999); assert.equal(player.grenades, 0);
  sim.tick(.00001); assert.equal(player.grenades, 1);
  const snapshot = JSON.parse(JSON.stringify(sim.snapshot(1000)));
  const session = new OnlineSession({ playerId: player.id, now: () => 1000 });
  assert.equal(session.ingestSnapshot(snapshot), true);
  assert.equal(snapshot.players[0].grenades, 1); assert.equal(snapshot.players[0].grenadierLeft, 10);
  assert.equal(snapshot.players[0].maxGrenades, 5);
  advance(sim, 9.9);
  sim.setConnected(player.id, false); sim.setConnected(player.id, true);
  near(sim.grenadierLeft(player), 10);
  advance(sim, 9.99999); assert.equal(player.grenades, 1);
  sim.tick(.00001); assert.equal(player.grenades, 2);
});

test('capacity upgrades create room without grenades and losing Grenadier clamps stock to the baseline without a bank', () => {
  const { sim, player } = room({ level: 2 });
  player.grenades = 2;
  advance(sim, 20); assert.equal(sim.grenadierLeft(player), null);
  grant(sim, player, 3);
  assert.equal(player.grenades, 2); assert.equal(state(sim, player).maxGrenades, 3);
  near(sim.grenadierLeft(player), 17);
  advance(sim, 16.99999); assert.equal(player.grenades, 2);
  sim.tick(.00001); assert.equal(player.grenades, 3);
  grant(sim, player, 8);
  assert.equal(player.grenades, 3); assert.equal(state(sim, player).maxGrenades, 5);
  advance(sim, 20); assert.equal(player.grenades, 5);
  const drops = sim.dropBonus(player);
  assert.equal(drops[0].bonus.level, 8);
  assert.equal(player.grenades, 2); assert.equal(state(sim, player).maxGrenades, 2);
  assert.equal(sim.grenadierLeft(player), null);
  advance(sim, 10); assert.equal(player.grenades, 2);
});

test('grenade pickups and station purchases follow the variable capacity, including practice pickups', () => {
  for (const practice of [false, true]) for (let level = 1; level <= 8; level++) {
    const { sim, player } = room({ level, practice }), capacity = characterStats(player).maxGrenades;
    player.grenades = capacity - 1;
    const pickup = { id: 'grenade-capacity', kind: 'grenade', x: player.x, y: player.y, z: player.z,
      expiresAt: sim.time + 10 };
    sim.pickups.set(pickup.id, pickup); sim.collectPickups();
    assert.equal(player.grenades, capacity); assert.equal(sim.pickups.has(pickup.id), false);
    sim.pickups.set(pickup.id, pickup); sim.collectPickups();
    assert.equal(player.grenades, capacity); assert.equal(sim.pickups.has(pickup.id), true);
  }
  const { sim, player } = room({ level: 3 });
  sim.wave = 15; sim.beginSupplyWave();
  Object.assign(player, LATE_SUPPLIES.position, { grenades: 2, points: 1000 });
  assert.equal(sim.buySupply(player.id, 'grenade'), true);
  assert.equal(player.grenades, 3); assert.equal(player.points, 650);
  sim.wave = 16; sim.beginSupplyWave();
  assert.equal(sim.buySupply(player.id, 'grenade'), false);
  assert.equal(player.grenades, 3); assert.equal(player.points, 650);
});

test('elimination and leaving drop the actual level, cap the old stock and give the recipient no saved countdown', () => {
  for (const cause of ['elimination', 'leaving']) {
    const { sim, player } = room({ level: 8 });
    const teammate = sim.addPlayer('teammate', 'Teammate');
    player.grenades = 4;
    advance(sim, 9.9);
    if (cause === 'elimination') {
      sim.damagePlayer(player, 1000, { source: 'fall' });
      advance(sim, 26);
      assert.equal(player.alive, false);
    } else sim.removePlayer(player.id);
    assert.equal(player.bonus, null); assert.equal(player.grenades, 2);
    const pickup = [...sim.pickups.values()].find(pickup => pickup.kind === 'bonus');
    assert.deepEqual(pickup.bonus, { kind: 'grenadier', level: 8 });
    Object.assign(teammate, { x: pickup.x, y: pickup.y, z: pickup.z });
    assert.equal(sim.takeBonus(teammate.id, pickup.id), true);
    near(sim.grenadierLeft(teammate), 10);
    assert.equal(teammate.grenades, 0); assert.equal(state(sim, teammate).maxGrenades, 5);
    advance(sim, 9.99999); assert.equal(teammate.grenades, 0);
    sim.tick(.00001); assert.equal(teammate.grenades, 1);
  }
});

test('each Grenadier level boosts only its own thrown grenade damage, identically online and for bots', () => {
  for (const online of [false, true]) for (let level = 0; level <= 8; level++) {
    const { sim, player } = room({ online, level });
    if (!online) player.companion = true;
    player.bonus = { ...player.bonus, reinforced: 8 };
    const zombie = blastTarget(sim), grenade = throwAtTargets(sim, player, zombie);
    const multiplier = 1 + (DAMAGE_BONUSES[level - 1] ?? 0) / 100;
    assert.equal(grenade.damageMultiplier, multiplier);
    assert.equal(sim.explodeGrenade(grenade), true);
    near(10000 - zombie.hp, GRENADES.damage * multiplier);
    assert.equal(sim.explodeGrenade(grenade), false, 'one throw can apply its explosion only once');
  }
});

test('boosted blasts keep the original radius and smooth distance curve, enemy armor and survivor immunity', () => {
  const { sim, player } = room({ level: 8 });
  const targets = [0, 2, 2.5, 3, 3.5, 3.99, 4, 4.01].map(range => ({ range, zombie: blastTarget(sim, { x: 10 + range }) }));
  const armored = blastTarget(sim, { kind: 'armored', z: -4.5 });
  const grenade = throwAtTargets(sim, player, targets[0].zombie), beforeHp = player.hp;
  assert.equal(sim.explodeGrenade(grenade), true);
  for (const { range, zombie } of targets) near(10000 - zombie.hp, blastDamageAtDistance(GRENADES, range) * 1.5);
  near(10000 - targets[0].zombie.hp, 675);
  near(10000 - targets[3].zombie.hp, 337.5);
  near(10000 - armored.hp, 675 * enemyDamageMultiplier(armored, false));
  assert.equal(player.hp, beforeHp);
});

test('grenade power is captured at launch and survives a later bonus loss, upgrade or departure', () => {
  for (const change of ['loss', 'upgrade', 'leaving']) {
    const { sim, player } = room({ level: change === 'upgrade' ? 2 : 8 });
    sim.addPlayer('teammate', 'Teammate');
    const zombie = blastTarget(sim), grenade = throwAtTargets(sim, player, zombie);
    const captured = grenade.damageMultiplier;
    if (change === 'loss') grant(sim, player, 0);
    if (change === 'upgrade') grant(sim, player, 8);
    if (change === 'leaving') sim.removePlayer(player.id);
    sim.explodeGrenade(grenade);
    near(10000 - zombie.hp, 450 * captured);
  }
});

test('a projectile without a captured player bonus and a real rocket retain their original explosion damage', () => {
  const { sim, player } = room({ level: 8 });
  const zombie = blastTarget(sim), box = enemyHitbox(zombie);
  const grenade = { id: 'unboosted-grenade', ownerId: 'enemy', x: 10, y: (box.minY + box.maxY) / 2, z: -5 };
  sim.grenades.set(grenade.id, grenade);
  sim.explodeGrenade(grenade);
  near(10000 - zombie.hp, 450);
  for (const level of [0, 8]) {
    const scene = room({ level }), enemy = blastTarget(scene.sim, { z: -4 });
    Object.assign(scene.player, { x: 10, z: -1, yaw: 0, pitch: 0, weapon: 'rocket', weaponId: 'rocket',
      inventory: { rocket: { ammo: 1, reserve: 2 } } });
    assert.equal(scene.sim.shoot(scene.player.id), true);
    near(10000 - enemy.hp, 700);
  }
  assert.equal(characterStats(player).grenadeDamageMultiplier, 1.5);
});
