// The server's wound data for the Frisson blood (art/frisson/BLOOD-SPRAY.md
// sections 4.1 and 5.1): where each bullet, pellet, raider bullet, blow and
// blast entered each body, with its power, written in Frisson rooms only.
// A Famille room's events are proved byte-identical to the code before this
// lot by one scripted session run on stripped copies of simulation.mjs and
// raiders.mjs: the 4.1 lines taken out by explicit [anchor, replacement]
// pairs, each present exactly once.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { RoomSimulation, WEAPONS, damageFalloff } from '../simulation.mjs';
import { OnlineRoomSimulation } from '../online-simulation.mjs';
import { seededRandom } from '../validation/balance-report.mjs';
import { advanceBallisticFlight, settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import { ballisticShotView } from './helpers/ballistic-wounds.mjs';
import { PHYSICAL_SPRAYS } from './helpers/blood-physical.mjs';
import { enemyHitbox, enemyDamageMultiplier } from '../public/enemies.js';
import { ROCKET, GRENADES } from '../public/rules.js';
import { blastDamageAtDistance } from '../public/area-damage.js';

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8').replace(/\r\n/g, '\n');
const WOUND_KEYS = ['wounds', 'power', 'feet'];

// The lines BLOOD-SPRAY.md 4.1 adds, each with what stood there before.
const SIMULATION_LINES = [
  [`    // Frisson rooms only (art/frisson/BLOOD-SPRAY.md section 4.1; Frisson léger
    // too, rules.js isFrissonLike): where each pellet entered each body, for
    // the pixel blood. Famille events stay as they are.
    const fallen = isFrissonLike(this.ambiance) ? [] : null;
`, ''],
  [`      const wounds = fallen ? [] : null;
`, ''],
  [`        // The hit's power before the enemy's health clips it (a magnum round
        // counts its nominal 200 at least), and the feet before any push.
        if (wounds && zombie.kind !== 'raider') {
          const power = weapon.oneShot && !zombie.boss ? Math.max(previousHp, weapon.damage) : previousHp - zombie.hp;
          wounds.push([zombie.id, milli(hitAt), milli(power), headshot ? 1 : 0, zombie.hp <= 0 ? 1 : 0, milli(zombie.x), milli(zombie.y), milli(zombie.z)]);
          if (zombie.hp <= 0) fallen.push(zombie);
        }
`, ''],
  [`      // A body felled earlier in this shot still stands where the pellet passes:
      // it bleeds there too (blood only: the dead take no damage, nothing scores).
      if (fallen) for (const body of fallen) {
        let seen = false;
        for (const wound of wounds) if (wound[0] === body.id) seen = true;
        if (seen) continue;
        const hitAt = rayBox(origin, direction, enemyHitbox(body), stop.distance);
        if (!(hitAt < stop.distance)) continue;
        const head = enemyHeadshot(body, origin.y + direction.y * hitAt - body.y);
        wounds.push([body.id, milli(hitAt), milli(weapon.damage * damageFalloff(weapon, hitAt) * (head ? headshotMultiplier : 1) * enemyDamageMultiplier(body, head)),
          head ? 1 : 0, 1, milli(body.x), milli(body.y), milli(body.z)]);
      }
      const entry = { yaw: milli(yaw), pitch: milli(pitch), distance: milli(stop.distance), stop: stop.kind };
      if (wounds?.length) { wounds.sort((a, b) => a[1] - b[1]); entry.wounds = wounds; }
      pellets.push(entry);
`, `      pellets.push({ yaw: milli(yaw), pitch: milli(pitch), distance: milli(stop.distance), stop: stop.kind });
`],
  [`        // Frisson rooms only (BLOOD-SPRAY.md 4.1): the blow's power and the feet before the push.
        if (isFrissonLike(this.ambiance)) { impact.power = milli(amount); impact.feet = [milli(zombie.x), milli(zombie.y), milli(zombie.z)]; }
`, ''],
  [`    // Frisson rooms only (BLOOD-SPRAY.md 4.1): each body the blast reached, at
    // its axis and middle before the push, with the blast's power.
    const wounds = isFrissonLike(this.ambiance) ? [] : null;
`, ''],
  [`      const power = ROCKET.damage * attenuation * enemyDamageMultiplier(zombie, false);
      const killed = this.damageSpecialZombie(zombie, power, player.id, radial, 'rocket', true, { point: target, rocket: true });
      if (killed) kills++;
      if (wounds && zombie.kind !== 'raider') wounds.push([zombie.id, milli(target.x), milli(target.y), milli(target.z), milli(power), killed ? 1 : 0]);
`, `      if (this.damageSpecialZombie(zombie, ROCKET.damage * attenuation * enemyDamageMultiplier(zombie, false), player.id, radial, 'rocket', true, { point: target, rocket: true })) kills++;
`],
  // Friendly fire's survivors (teammates) are not Frisson's: they stay.
  [`    if (stop !== 'range') {
      const blast = { id: player.id, weapon: 'rocket', ...impact, radius: ROCKET.radiusDamage, hits, kills };
      if (wounds?.length) blast.wounds = wounds;
      if (teammates.length) blast.teammates = teammates;
      this.event('explosion', blast);
    }
`, `    if (stop !== 'range') this.event('explosion', { id: player.id, weapon: 'rocket', ...impact, radius: ROCKET.radiusDamage, hits, kills, ...(teammates.length ? { teammates } : {}) });
`],
  [`    // Frisson rooms only (BLOOD-SPRAY.md 4.1), as the rocket's blast.
    const wounds = isFrissonLike(this.ambiance) ? [] : null;
`, ''],
  [`      if (wounds && zombie.kind !== 'raider') wounds.push([zombie.id, milli(target.x), milli(target.y), milli(target.z), milli(damage), zombie.hp <= 0 ? 1 : 0]);
`, ''],
  [`    const blast = { id: grenade.ownerId, grenadeId: grenade.id, x: grenade.x, y: grenade.y, z: grenade.z, hits, kills };
    if (wounds?.length) blast.wounds = wounds;
    if (teammates.length) blast.teammates = teammates;
    this.event('explosion', blast);
`, `    this.event('explosion', { id: grenade.ownerId, grenadeId: grenade.id, x: grenade.x, y: grenade.y, z: grenade.z, hits, kills, ...(teammates.length ? { teammates } : {}) });
`],
];
const RAIDER_LINES = [
  [`kind: solidDistance < gun.range ? 'solid' : 'range' }, wound = null;
`, `kind: solidDistance < gun.range ? 'solid' : 'range' };
`],
  [`            const zombie = first.zombie, power = pelletDamage(gun, first.hitAt) * enemyDamageMultiplier(zombie, false);
            // Frisson rooms only (art/frisson/BLOOD-SPRAY.md 4.1): the feet before the push.
            const feet = isFrissonLike(this.ambiance) ? [milli(zombie.x), milli(zombie.y), milli(zombie.z)] : null;
            const killed = this.damageSpecialZombie(zombie, power, null, direction, 'raider', true, false);
            if (feet) wound = [zombie.id, milli(first.hitAt), milli(power), 0, killed ? 1 : 0, ...feet];
`, `            this.damageSpecialZombie(first.zombie, pelletDamage(gun, first.hitAt) * enemyDamageMultiplier(first.zombie, false), null,
              direction, 'raider', true, false);
`],
  [`        const entry = { yaw: milli(yaw), pitch: milli(pitch), distance: milli(stop.distance), stop: stop.kind };
        if (wound) entry.wounds = [wound];
        pellets.push(entry);
`, `        pellets.push({ yaw: milli(yaw), pitch: milli(pitch), distance: milli(stop.distance), stop: stop.kind });
`],
];
function strip(source, pairs, label) {
  for (const [anchor, replacement] of pairs) {
    assert.equal(source.split(anchor).length - 1, 1, `${label}: ${anchor.trim().split('\n')[0]}`);
    source = source.replace(anchor, () => replacement);
  }
  return source;
}
// A module from its source: relative imports point at the real files (shared
// instances), except the ones given.
const dataModule = (source, overrides = {}) => `data:text/javascript;charset=utf-8,${encodeURIComponent(
  source.replace(/from '\.\/([^']+)'/g, (_, path) => `from ${JSON.stringify(overrides[path] ?? new URL(path, ROOT).href)}`))}`;
const strippedRaiders = dataModule(strip(read('raiders.mjs'), RAIDER_LINES, 'raiders.mjs'));
const Stripped = await import(dataModule(strip(read('simulation.mjs'), SIMULATION_LINES, 'simulation.mjs'), { 'raiders.mjs': strippedRaiders }));

// A random that counts its draws.
function counted(seed) {
  const next = seededRandom(seed), random = () => { random.draws++; return next(); };
  random.draws = 0;
  return random;
}
const walkerAt = (id, x, z, extra = {}) => ({ id, x, y: 0, z, hp: 400, maxHp: 400, kind: 'walker', scale: 1, boss: false, yaw: 0, pushX: 0, pushZ: 0, pushLeft: 0, ...extra });
const colossusAt = (id, x, z, extra = {}) => walkerAt(id, x, z, { kind: 'brute', scale: 1.22, hp: 1400, maxHp: 1400, ...extra });
function room(Simulation, ambiance, { seed = 4242, Class = Simulation.RoomSimulation, options = {} } = {}) {
  const events = [], random = counted(seed);
  const simulation = new Class('WOUND1', { random, onEvent: event => events.push(JSON.stringify(event)), ambiance, ...options });
  simulation.addPlayer('a', 'A'); simulation.addPlayer('b', 'B');
  simulation.start('a');
  simulation.wave = 13; simulation.beginWave(); simulation.spawnTimer = 999;
  for (const player of simulation.players.values()) player.hp = 1e6;
  simulation.zombies.clear();
  return { simulation, events, random, player: simulation.players.get('a') };
}
// The survivor at (-4.4, 0, 4), looking down -z (a clear line through the cabin).
function aim(simulation, id, weapon, { pitch = 0, yaw = 0, x = -4.4, z = 4 } = {}) {
  const player = simulation.players.get(id);
  player.weapon = weapon;
  player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine || 1, reserve: 0 };
  Object.assign(player, { x, y: 0, z, yaw, pitch, shotAfter: -Infinity, meleeAfter: -Infinity, reloadUntil: 0, pendingMelee: null, minigunSpinning: true, minigunSpinUntil: -1 });
  return player;
}
function raiderAt(simulation, x, z, { loadout = 'smg', drill = false } = {}) {
  const raider = simulation.createRaider(1, { id: null, doorId: 'north', x, z }, { index: 1, damageScale: 1 }, { point: { x, z }, loadout, drill });
  simulation.zombies.set(raider.id, raider);
  return raider;
}
const place = (simulation, ...enemies) => { for (const enemy of enemies) simulation.zombies.set(enemy.id, enemy); };
const blow = (simulation, id, weapon, attack) => {
  aim(simulation, id, weapon);
  assert.equal(simulation.shoot(id, 0, attack), true, `${weapon} ${attack}`);
  simulation.time = simulation.players.get(id).pendingMelee.impactAt;
  simulation.updateMelee();
};

// The scripted night: every hitscan weapon at a walker, a colossus and a raider,
// a shotgun through two walkers and into a weak one, melee light and heavy, a
// rocket and a grenade into a group, flame and its burn, and a raider squad
// (a drill raider among them) shooting into zombies.
function session(Simulation, ambiance, options = {}) {
  const { simulation, events, random } = room(Simulation, ambiance, { options }), states = [];
  const settle = () => {
    settleBallisticFlight(simulation);
    states.push([...simulation.zombies.values()].map(zombie => [zombie.id, zombie.hp, zombie.x, zombie.y, zombie.z, zombie.pushX ?? 0, zombie.pushZ ?? 0, zombie.pushLeft ?? 0]));
    simulation.zombies.clear();
  };
  for (const weapon of ['pistol', 'smg', 'rifle', 'assault', 'minigun', 'shotgun', 'sniper', 'magnum']) {
    for (const make of [() => walkerAt('w', -4.4, 1), () => colossusAt('c', -4.4, 1), () => raiderAt(simulation, -4.4, 1)]) {
      place(simulation, make(), walkerAt('behind', -4.4, -1, { hp: 60, maxHp: 60 }));
      aim(simulation, 'a', weapon, { pitch: -.02 }); simulation.shoot('a');
      aim(simulation, 'a', weapon, { pitch: .06 }); simulation.shoot('a');
      settle();
    }
  }
  place(simulation, walkerAt('n1', -4.4, 1), walkerAt('n2', -4.4, 0));
  aim(simulation, 'a', 'shotgun', { pitch: -.05 }); simulation.shoot('a'); settle();
  place(simulation, walkerAt('weak', -4.4, 2.8, { hp: 80, maxHp: 80 }), walkerAt('past', -4.4, 1.5));
  aim(simulation, 'a', 'shotgun', { pitch: .1 }); simulation.shoot('a'); settle();
  place(simulation, walkerAt('boss', -4.4, 1, { kind: 'brute', boss: true, scale: 1.32, hp: 6000, maxHp: 6000 }));
  aim(simulation, 'a', 'magnum'); simulation.shoot('a'); settle();
  // Melee: a bat's light blow, a hammer's heavy one on two bodies, a raider too.
  place(simulation, walkerAt('m1', -4.4, 2.8));
  blow(simulation, 'a', 'bat', 'light'); settle();
  place(simulation, walkerAt('m2', -4.55, 2.7, { hp: 120, maxHp: 120 }), colossusAt('m3', -4.2, 2.6));
  blow(simulation, 'a', 'hammer', 'heavy'); settle();
  raiderAt(simulation, -4.4, 2.8);
  blow(simulation, 'a', 'fireaxe', 'light'); settle();
  // A rocket and a grenade into a group with a raider among them.
  place(simulation, walkerAt('g1', -4.4, -1, { hp: 80, maxHp: 80 }), walkerAt('g2', -3.8, -1.4), colossusAt('g3', -5.1, -1.5)); raiderAt(simulation, -4.4, -2);
  aim(simulation, 'a', 'rocket'); simulation.shoot('a'); settle();
  place(simulation, walkerAt('h1', -4.4, -1, { hp: 80, maxHp: 80 }), walkerAt('h2', -3.6, -1.4), colossusAt('h3', -5.4, -2)); raiderAt(simulation, -4.4, -2.2);
  const grenade = { id: 'g-test', ownerId: 'a', x: -4.4, y: .2, z: -1.6, vx: 0, vy: 0, vz: 0, fuseLeft: 0 };
  simulation.grenades.set(grenade.id, grenade); simulation.explodeGrenade(grenade); settle();
  // Flame: a contact kill, then a burn that kills.
  place(simulation, walkerAt('f1', -4.4, 2.5, { hp: 5, maxHp: 5 }), walkerAt('f2', -4.4, 1.8, { hp: 30, maxHp: 30 }));
  aim(simulation, 'a', 'flamethrower'); simulation.shoot('a');
  simulation.time += 4; simulation.updateBurns(4); settle();
  // A raider squad behind zombies, shooting at the survivors.
  const target = { x: -4.4, y: 1.4, z: 4 };
  const squad = [raiderAt(simulation, -4.4, -4.6), raiderAt(simulation, -3.9, -4.6, { loadout: 'shotgun' }), raiderAt(simulation, -4.9, -4.6, { drill: true })];
  place(simulation, walkerAt('s1', -4.4, -2), walkerAt('s2', -3.95, -2, { hp: 20, maxHp: 20 }), walkerAt('s3', -4.85, -2));
  for (const raider of squad) for (let round = 0; round < 3; round++)
    simulation.traceRaiderShot(raider, simulation.raiderMuzzle(raider, target), target, { sigma: .02 });
  settle();
  const players = [...simulation.players.values()].map(player => [player.id, player.score, player.kills, player.coins, player.killChain]);
  return { events, states, players, pickups: JSON.stringify([...simulation.pickups.values()]), draws: random.draws, next: random() };
}
const withoutWounds = value => {
  if (Array.isArray(value)) return value.map(withoutWounds);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !WOUND_KEYS.includes(key)).map(([key, item]) => [key, withoutWounds(item)]));
  return value;
};
const woundKeys = value => Array.isArray(value) ? value.flatMap(woundKeys)
  : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => [...(WOUND_KEYS.includes(key) ? [key] : []), ...woundKeys(item)]) : [];
const named = (events, name) => events.map(text => JSON.parse(text)).filter(event => event.event === name);
const SIMULATION = { RoomSimulation };

test('Famille, byte for byte: the scripted session sends the same events as the code before the wounds, and no wound key', () => {
  const famille = session(SIMULATION, 'family'), before = session(Stripped, 'family');
  assert.ok(famille.events.length >= 100, `a full session (${famille.events.length} events)`);
  for (const name of ['shot', 'kill', 'melee-hit', 'explosion', 'raider-shot']) assert.ok(named(famille.events, name).length > 0, name);
  assert.ok(named(famille.events, 'kill').some(event => event.weapon === 'flamethrower'), 'a fire kill');
  assert.equal(famille.events.length, before.events.length);
  famille.events.forEach((text, index) => assert.equal(text, before.events[index], `event ${index}`));
  assert.deepEqual(famille.events.flatMap(text => woundKeys(JSON.parse(text))), []);
  assert.deepEqual({ ...famille, events: null }, { ...before, events: null }, 'the same state and the same random draws');
});

test('Frisson adds data only: the same events once the wounds are taken out, the same state, the same random draws', () => {
  const frisson = session(SIMULATION, 'frisson'), famille = session(SIMULATION, 'family');
  const gameplay=frisson.events.filter(text=>!JSON.parse(text).visualOnly);
  assert.equal(gameplay.length, famille.events.length);
  // Wound-only events have their own network sequence numbers; gameplay payloads remain identical.
  gameplay.forEach((text,index)=>{const event=withoutWounds(JSON.parse(text)),expected=JSON.parse(famille.events[index]);delete event.eventId;delete expected.eventId;assert.deepEqual(event,expected,`event ${index}`);});
  assert.deepEqual({ ...frisson, events: null }, { ...famille, events: null });
  // And it does carry them: shots, raider bullets, blows and blasts.
  const keys = new Set(frisson.events.flatMap(text => woundKeys(JSON.parse(text))));
  assert.deepEqual([...keys].sort(), ['feet', 'power', 'wounds']);
  assert.ok(named(frisson.events,'bullet-impact').some(event=>Number.isFinite(event.power)),'arrival power');
  for (const name of ['raider-shot', 'explosion']) assert.ok(named(frisson.events, name).some(event => JSON.stringify(event).includes('"wounds"')), name);
});

test('Frisson léger carries the very wounds of Frisson: the scripted session sends the same events, byte for byte, on both servers', () => {
  // Its blood is halved by the pack (ctx.variant.blood), never by the server.
  const frisson = session(SIMULATION, 'frisson'), leger = session(SIMULATION, 'frisson-leger');
  assert.equal(leger.events.length, frisson.events.length);
  leger.events.forEach((text, index) => assert.equal(text, frisson.events[index], `event ${index}`));
  assert.deepEqual({ ...leger, events: null }, { ...frisson, events: null });
  assert.deepEqual([...new Set(leger.events.flatMap(text => woundKeys(JSON.parse(text))))].sort(), ['feet', 'power', 'wounds']);
  const online = { RoomSimulation: OnlineRoomSimulation }, clock = () => 1000;
  const onlineLeger = session(online, 'frisson-leger', { clock }), onlineFrisson = session(online, 'frisson', { clock });
  assert.ok(onlineLeger.events.some(text => text.includes('"wounds"')));
  assert.deepEqual(onlineLeger.events, onlineFrisson.events);
});

// The brief's own measuring setup (BLOOD-SPRAY.md 2.7): a Lehmer random, the
// survivor at (-4.4, 0, 4) in the countdown, the target down -z.
function measured(weapon, target, distance, pitch, ambiance = 'frisson') {
  const events = [];
  let state = 7; const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const simulation = new RoomSimulation('BLOOD', { random, onEvent: event => events.push(event), ambiance });
  const player = simulation.addPlayer('a', 'A', weapon); simulation.start('a');
  player.weapon = weapon; player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
  Object.assign(player, { x: -4.4, y: 0, z: 4, yaw: 0, pitch, minigunSpinning: true, minigunSpinUntil: -1 });
  const enemy = { id: 'T', x: -4.4, y: 0, z: 4 - distance, kind: 'walker', scale: 1, pushX: 0, pushZ: 0, pushLeft: 0, ...target };
  simulation.zombies.set('T', enemy);
  const before = { x: enemy.x, y: enemy.y, z: enemy.z, hp: enemy.hp };
  assert.equal(simulation.shoot('a'), true);
  settleBallisticFlight(simulation);
  const shot = ballisticShotView(events);
  return { simulation, events, shot, before, enemy, player, wounds: shot.pellets.flatMap(pellet => pellet.wounds ?? []) };
}

test('the owner\'s case: a point-blank shotgun into a 1,400-HP colossus\'s head gives 9 calibrated wounds, 7 in the head, from the feet before the push', () => {
  const { shot, wounds, before, enemy } = measured('shotgun', { kind: 'brute', scale: 1.22, hp: 1400, maxHp: 1400 }, 1.2, .35);
  assert.equal(wounds.length, 9);
  assert.equal(wounds.filter(wound => wound[3] === 1).length, 7);
  const sum = wounds.reduce((total, wound) => total + wound[2], 0);
  assert.ok(Math.abs(sum - PHYSICAL_SPRAYS.colossusHead.D) <= .01, `Σ power ${sum}`);
  assert.equal(shot.id, 'a');
  assert.ok(Math.abs(sum - (before.hp - enemy.hp)) <= .01, 'the HP drop');
  for (const pellet of shot.pellets) {
    const list = pellet.wounds ?? [];
    for (const wound of list) {
      assert.equal(wound.length, 8);
      assert.ok(wound[1] <= pellet.distance, 'hitAt within the pellet');
      assert.deepEqual(wound.slice(5), [before.x, before.y, before.z], 'the feet before the push');
      assert.equal(wound[0], 'T'); assert.equal(wound[4], 0);
    }
    assert.deepEqual(list.map(wound => wound[1]), list.map(wound => wound[1]).sort((a, b) => a - b), 'sorted by hitAt');
  }
  assert.ok(Math.hypot(enemy.pushX, enemy.pushZ) > 0, 'the colossus was pushed, after the wounds were taken');
  // About 400 bytes of wounds per shell (BLOOD-SPRAY.md 2.7).
  assert.equal(shot.pellets.length,9);
  assert.ok(shot.pellets.every(pellet=>pellet.contacts.filter(event=>Number.isFinite(event.power)).length===1),'one bounded wound event per entering pellet');
});

test('pass-through: smg, rifle, assault, minigun and sniper rounds that go on past a lone walker still carry its wound; pistol and magnum stop in it', () => {
  for (const weapon of ['smg', 'rifle', 'assault', 'minigun', 'sniper', 'pistol', 'magnum']) {
    const { shot, wounds } = measured(weapon, { hp: 5000, maxHp: 5000 }, 3, -.03);
    assert.equal(wounds.length, 1, weapon);
    assert.equal(wounds[0][0], 'T', weapon);
    const hit=shot.pellets[0].contacts.find(event=>event.stop==='zombie');
    assert.equal(hit.terminal,['pistol','magnum'].includes(weapon),`${weapon}: impact continuation`);
    if(!hit.terminal)assert.ok(hit.continuation&&hit.continuation.maxAge>hit.age,'a penetrating round keeps a valid physical segment');
    assert.ok(wounds[0][1] < 3 && wounds[0][1] > 2.5, `${weapon} enters at the front of the hitbox`);
  }
});

test('posthumous wounds: a shotgun that fells a wounded 80-HP walker with one pellet still bleeds through its body with the other pellets, and nothing else changes', () => {
  const frisson = measured('shotgun', { hp: 40, maxHp: 80 }, 1.2, .1), famille = measured('shotgun', { hp: 40, maxHp: 80 }, 1.2, .1, 'family');
  const { wounds, simulation } = frisson, head = simulation.currentWaveBalance().headshotMultiplier;
  const killing = wounds.filter(wound => wound[4] === 1 && wound[2] > 40);
  assert.equal(named(frisson.events.map(event => JSON.stringify(event)), 'kill').length, 1);
  assert.ok(killing.length >= 1, 'the killing pellet counts its whole power, not the 40 HP left');
  assert.ok(wounds.length >= 7 && wounds.every(wound => wound[0] === 'T' && wound[4] === 1), `${wounds.length} wounds, all on the fallen walker, all killed`);
  const weapon = WEAPONS.shotgun;
  for (const wound of wounds.slice(1)) {
    const nominal = weapon.damage * damageFalloff(weapon, wound[1]) * (wound[3] ? head : 1) * enemyDamageMultiplier(frisson.enemy, wound[3] === 1);
    assert.ok(Math.abs(wound[2] - nominal) < .05, `posthumous power ${wound[2]} against ${nominal}`);
  }
  // The same kills, score and coins as Famille: blood only.
  assert.deepEqual([frisson.player.kills, frisson.player.score, frisson.player.coins], [famille.player.kills, famille.player.score, famille.player.coins]);
  const gameplay=events=>events.filter(event=>!event.visualOnly).map(event=>{const clean=withoutWounds(event);delete clean.eventId;return clean;});
  assert.deepEqual(gameplay(frisson.events),gameplay(famille.events));
});

test('a pellet through a body the shell just felled and into a living one behind it: its wounds in the order the pellet met them', () => {
  const events = [];
  let state = 7; const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const simulation = new RoomSimulation('BLOOD', { random, onEvent: event => events.push(event), ambiance: 'frisson' });
  const player = simulation.addPlayer('a', 'A', 'shotgun'); simulation.start('a');
  player.weapon = 'shotgun'; player.inventory.shotgun = { ammo: WEAPONS.shotgun.magazine, reserve: 0 };
  Object.assign(player, { x: -4.4, y: 0, z: 4, yaw: 0, pitch: .1, minigunSpinning: true, minigunSpinUntil: -1 });
  simulation.zombies.set('A', walkerAt('A', -4.4, 2.8, { hp: 40, maxHp: 80 }));
  simulation.zombies.set('B', walkerAt('B', -4.4, 1.8, { hp: 5000, maxHp: 5000 }));
  assert.equal(simulation.shoot('a'), true);
  settleBallisticFlight(simulation);
  const shot=ballisticShotView(events);
  let both = 0;
  for (const pellet of shot.pellets) {
    const list = pellet.wounds ?? [];
    assert.deepEqual(list.map(wound => wound[1]), list.map(wound => wound[1]).sort((a, b) => a - b), 'sorted by hitAt');
    if (list.some(wound => wound[0] === 'A') && list.some(wound => wound[0] === 'B')) {
      both++;
      assert.deepEqual(list.map(wound => wound[0]), ['A', 'B'], 'the fallen body in front, then the living one');
      assert.deepEqual(list.map(wound => wound[4]), [1, 0]);
    }
  }
  assert.ok(both >= 3, `${both} pellets through both bodies, the fallen one posthumous`);
});

test('Magnum wounds carry finite deposited energy, with ordinary head and boss rules and no clipping to remaining HP', () => {
  for (const target of [{ hp: 80, maxHp: 80 }, { kind: 'brute', scale: 1.22, hp: 1400, maxHp: 1400 }, { kind: 'brute', boss: true, scale: 1.32, hp: 6000, maxHp: 6000 }]) {
    const { simulation, events, wounds, enemy, player } = measured('magnum', target, 4, 0);
    assert.equal(wounds.length, 1); const wound = wounds[0];
    const expected = WEAPONS.magnum.damage * damageFalloff(WEAPONS.magnum, wound[1])
      * (wound[3] ? simulation.currentWaveBalance().headshotMultiplier : 1) * enemyDamageMultiplier(enemy, wound[3] === 1);
    assert.ok(Math.abs(wound[2] - expected) < .05, `${JSON.stringify(target)}: ${wound[2]} vs ${expected}`);
    assert.equal(wound[4], target.boss ? 0 : 1);
    const kills = events.filter(event => event.event === 'kill');
    assert.equal(kills.length, target.boss ? 0 : 1);
    if (kills.length) { assert.equal(kills[0].id, player.id); assert.equal(kills[0].zombieId, 'T'); }
    assert.equal(simulation.zombies.has('T'), target.boss === true);
    assert.ok(Number.isFinite(wound[2]) && wound[2] > 0);
  }
});

test('raiders: no wound on a raider, through or stopped; a raider bullet that stops in a walker carries one wound in Frisson and none in Famille; a drill raider\'s none', () => {
  for (const ambiance of ['frisson', 'family']) {
    const { simulation, events } = room(SIMULATION, ambiance);
    // A sniper round through a raider into a walker: the walker's wound only.
    raiderAt(simulation, -4.4, 1); place(simulation, walkerAt('w', -4.4, -1));
    aim(simulation, 'a', 'sniper', { pitch: -.03 }); simulation.shoot('a'); settleBallisticFlight(simulation);
    // A pistol round stopped in a raider: nothing.
    simulation.zombies.clear(); raiderAt(simulation, -4.4, 1);
    aim(simulation, 'a', 'pistol', { pitch: -.03 }); simulation.shoot('a'); settleBallisticFlight(simulation);
    const allEvents=events.map(text=>JSON.parse(text));
    const shots=named(events,'shot').map(event=>ballisticShotView(allEvents,event).pellets.flatMap(pellet=>pellet.wounds??[]));
    assert.deepEqual(shots.map(list => list.map(wound => wound[0])), ambiance === 'frisson' ? [['w'], []] : [[], []], ambiance);
    // Raider bullets into a walker: the smg's, then a drill raider's.
    simulation.zombies.clear();
    const target = { x: -4.4, y: 1.2, z: 4 }, walker = walkerAt('v', -4.4, -2), feet = [walker.x, walker.y, walker.z];
    const gunner = raiderAt(simulation, -4.4, -4.6), drill = raiderAt(simulation, -4.4, -4.6, { drill: true });
    place(simulation, walker);
    simulation.zombies.delete(drill.id);
    simulation.traceRaiderShot(gunner, simulation.raiderMuzzle(gunner, target), target);
    simulation.zombies.delete(gunner.id); simulation.zombies.set(drill.id, drill);
    simulation.traceRaiderShot(drill, simulation.raiderMuzzle(drill, target), target);
    const [hostile, drilled] = named(events, 'raider-shot');
    const stopped = hostile.pellets.filter(pellet => pellet.stop === 'zombie');
    assert.ok(stopped.length >= 1, 'a bullet stopped in the walker');
    for (const pellet of hostile.pellets) {
      if (ambiance === 'family' || pellet.stop !== 'zombie') { assert.equal('wounds' in pellet, false); continue; }
      assert.equal(pellet.wounds.length, 1);
      const [id, hitAt, power, head, killed, ...at] = pellet.wounds[0];
      assert.equal(id, 'v'); assert.equal(head, 0); assert.equal(killed, 0);
      assert.ok(Math.abs(hitAt - pellet.distance) < 1e-9, 'it enters where it stops');
      assert.ok(power > 0); assert.deepEqual(at, feet, 'the feet before the push');
    }
    assert.ok(drilled.pellets.every(pellet => !('wounds' in pellet)), `${ambiance}: a drill raider deals nothing`);
  }
});

test('melee: each blow carries its power (before the health clips it) and the feet in Frisson only, a raider\'s too; damage stays the dealt amount', () => {
  for (const ambiance of ['frisson', 'family']) {
    const { simulation, events } = room(SIMULATION, ambiance);
    const weak = walkerAt('m2', -4.55, 2.7, { hp: 120, maxHp: 120 }), big = colossusAt('m3', -4.2, 2.6);
    place(simulation, weak, big);
    const feet = new Map([weak, big].map(enemy => [enemy.id, [enemy.x, enemy.y, enemy.z]]));
    blow(simulation, 'a', 'hammer', 'heavy');
    simulation.zombies.clear();
    const raider = raiderAt(simulation, -4.4, 2.8);
    blow(simulation, 'a', 'bat', 'light');
    const [heavy, light] = named(events, 'melee-hit');
    assert.equal(heavy.impacts.length, 2);
    for (const impact of [...heavy.impacts, ...light.impacts]) {
      if (ambiance === 'family') { assert.deepEqual(woundKeys(impact), []); continue; }
      assert.deepEqual(Object.keys(impact), ['zombieId', 'x', 'y', 'z', 'damage', 'dirX', 'dirZ', 'power', 'feet', 'killed']);
      assert.deepEqual(impact.feet, impact.zombieId === raider.id ? [-4.4, 0, 2.8] : feet.get(impact.zombieId));
      assert.ok(impact.power >= impact.damage);
    }
    if (ambiance === 'frisson') {
      const first = heavy.impacts.find(impact => impact.zombieId === 'm2');
      assert.equal(first.damage, 120, 'dealt, clipped by its 120 HP'); assert.ok(first.power > 120, 'the power is not');
      assert.equal(first.killed, true);
    }
  }
});

test('blasts: a rocket and a grenade give each body they reach a wound at its axis and middle with the blast\'s power and whether it fell; none for raiders, none in Famille', () => {
  for (const ambiance of ['frisson', 'family']) {
    const { simulation, events } = room(SIMULATION, ambiance);
    const group = [walkerAt('g1', -4.4, -1, { hp: 80, maxHp: 80 }), walkerAt('g2', -3.8, -1.4), colossusAt('g3', -5.1, -1.5)];
    place(simulation, ...group); raiderAt(simulation, -4.4, -2);
    const before = new Map(group.map(enemy => [enemy.id, { ...enemy }]));
    aim(simulation, 'a', 'rocket'); simulation.shoot('a');
    const rocket = named(events, 'explosion')[0], kills = new Set(named(events, 'kill').map(event => event.zombieId));
    simulation.zombies.clear();
    const second = [walkerAt('h1', -4.4, -1, { hp: 80, maxHp: 80 }), walkerAt('h2', -3.6, -1.4)];
    place(simulation, ...second);
    for (const enemy of second) before.set(enemy.id, { ...enemy });
    const grenade = { id: 'g-test', ownerId: 'a', x: -4.4, y: .2, z: -1.6, vx: 0, vy: 0, vz: 0, fuseLeft: 0 };
    simulation.grenades.set(grenade.id, grenade); simulation.explodeGrenade(grenade);
    const thrown = named(events, 'explosion')[1];
    for (const kill of named(events, 'kill')) kills.add(kill.zombieId);
    if (ambiance === 'family') { assert.equal('wounds' in rocket, false); assert.equal('wounds' in thrown, false); continue; }
    for (const [blast, centre, damage, inner, radius] of [[rocket, rocket, ROCKET.damage, ROCKET.innerRadius, ROCKET.radiusDamage], [thrown, grenade, GRENADES.damage, GRENADES.innerRadius, GRENADES.radiusDamage]]) {
      assert.ok(blast.wounds.length >= 2, `${blast.weapon ?? 'grenade'}: ${blast.wounds.length} wounds`);
      assert.equal(blast.wounds.length, blast.hits - (blast === rocket ? 1 : 0), 'every body reached but the raider');
      for (const [id, x, y, z, power, killed] of blast.wounds) {
        const enemy = before.get(id), box = enemyHitbox(enemy), middle = (box.minY + box.maxY) / 2;
        assert.ok(enemy, `no raider: ${id}`);
        assert.deepEqual([x, z], [enemy.x, enemy.z]); assert.ok(Math.abs(y - middle) < 1e-3);
        const range = Math.hypot(enemy.x - centre.x, middle - centre.y, enemy.z - centre.z);
        const attenuation = blastDamageAtDistance({ damage, innerRadius: inner, radiusDamage: radius }, range) / damage;
        assert.ok(Math.abs(power - damage * attenuation * enemyDamageMultiplier(enemy, false)) < 1e-3, `${id} power`);
        assert.equal(killed, kills.has(id) ? 1 : 0, `${id} killed`);
      }
    }
  }
});

test('online physical arrivals use present bodies and match LAN wounds without rewinding moving targets', () => {
  let now = 1000;
  const online = room({ RoomSimulation: OnlineRoomSimulation }, 'frisson', { options: { clock: () => now } });
  const runner = walkerAt('run', -4.4, 1, { kind: 'runner', hp: 5000, maxHp: 5000 }), colossus = colossusAt('col', -4.0, -.5, { hp: 5000, maxHp: 5000 });
  place(online.simulation, runner, colossus);
  online.simulation.recordHistory(1000);
  Object.assign(runner, { x: -4.15, z: .4 }); Object.assign(colossus, { x: -4.5, z: -1.1 });
  now = 1100; online.simulation.recordHistory(1100);
  aim(online.simulation, 'a', 'shotgun', { pitch: .05 });
  assert.equal(online.simulation.shootOnline('a', 0, { viewTime: 1050 }, { rttMs: 100 }), true);
  // Finite flight uses current bodies at arrival, matching the LAN room.
  const lan = room(SIMULATION, 'frisson');
  place(lan.simulation, { ...runner }, { ...colossus });
  aim(lan.simulation, 'a', 'shotgun', { pitch: .05 }); lan.simulation.shoot('a');
  advanceBallisticFlight(online.simulation,.2); advanceBallisticFlight(lan.simulation,.2);
  const wounds=list=>ballisticShotView(list.map(text=>JSON.parse(text))).pellets.map(pellet=>pellet.wounds??[]);
  const rewound = wounds(online.events);
  assert.deepEqual(rewound, wounds(lan.events));
  const all = rewound.flat();
  assert.ok(all.some(wound => wound[0] === 'run') && all.some(wound => wound[0] === 'col'), 'both bodies hit');
  for (const wound of all) assert.deepEqual(wound.slice(5), wound[0] === 'run' ? [-4.15, 0, .4] : [-4.5, 0, -1.1], 'current feet at arrival');
  // Back in the present after the shot, pushed from there.
  assert.ok(Math.abs(runner.x + 4.15) < .5 && Math.abs(runner.z - .4) < .5);
});
