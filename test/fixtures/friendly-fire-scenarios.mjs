import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../../simulation.mjs';
import { OnlineRoomSimulation } from '../../online-simulation.mjs';
import { FRIENDLY_FIRE, FLAMETHROWER, ROCKET, GRENADES, REVIVE, AMBIANCES, playerHitbox, difficultyOf, friendlyFireAllowed } from '../../public/rules.js';
import { LEVEL } from '../../public/level-config.js';
import { blastDamageAtDistance, flameFalloff } from '../../public/area-damage.js';

// Friendly fire scenarios (rules.js FRIENDLY_FIRE), run on the cabin by
// test/friendly-fire.test.mjs and on the supermarket by the same test in a
// child process (DEADWOOD_LEVEL=supermarket). Every body stands in a lane
// found on the map itself: a straight, clear, walkable line on the ground
// floor, so the geometry of either map never decides the outcome.
export const IDS = Object.freeze({ a: '00000000000000a1', b: '00000000000000b2', c: '00000000000000c3' });
const TICK = 1 / 30;

// A 10 m lane: every point walkable at y = 0 and every sight line at chest
// and eye height clear of walls, furniture and planks, inside if possible.
export function findLane(sim, length = 10) {
  const probe = { id: IDS.a, crouched: false, grounded: true };
  const inside = LEVEL.insideBounds;
  for (const [x0, z0] of candidates(inside)) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const at = t => ({ x: x0 + dx * t, z: z0 + dz * t });
    let ok = true;
    for (let t = 0; t <= length && ok; t += .5) {
      const point = at(t);
      if (point.x < inside.minX + .6 || point.x > inside.maxX - .6 || point.z < inside.minZ + .6 || point.z > inside.maxZ - .6) ok = false;
      else if (!sim.canOccupy(probe, point.x, point.z, 0, .45)) ok = false;
    }
    if (!ok) continue;
    const end = at(length);
    for (const height of [.6, 1.1, 1.55]) if (!sim.raiderLineClear({ x: x0, y: height, z: z0 }, { x: end.x, y: height, z: end.z })) ok = false;
    if (ok) return { at, dx, dz, yaw: Math.atan2(-dx, -dz) };
  }
  throw new Error('no clear lane on this map');
}
function* candidates(bounds) {
  for (let z = Math.ceil(bounds.minZ); z <= Math.floor(bounds.maxZ); z++)
    for (let x = Math.ceil(bounds.minX); x <= Math.floor(bounds.maxX); x++) yield [x, z];
}

// A quiet wave (nothing spawns, nothing ends) with three survivors: a shoots,
// b and c stand where a scenario puts them. Nothing is ticked as a whole:
// each scenario advances only the system it checks (bullets, blows, blasts).
export function room({ level = 'full', weapon = 'pistol', difficulty = 'normal', Simulation = RoomSimulation, practice = false } = {}) {
  const events = [], sim = new Simulation('FRIEND', { random: () => .5, raids: false, practice, onEvent: event => events.push(event) });
  const a = sim.addPlayer(IDS.a, 'Ana'), b = sim.addPlayer(IDS.b, 'Bao'), c = sim.addPlayer(IDS.c, 'Cyd');
  if (difficulty !== 'normal') assert.equal(sim.setDifficulty(IDS.a, difficulty), true);
  if (level !== 'off') assert.equal(sim.setFriendlyFire(IDS.a, level), true);
  sim.start(IDS.a);
  Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 });
  const lane = findLane(sim);
  const put = (player, t, extra = {}) => Object.assign(player, { ...lane.at(t), y: 0, vy: 0, grounded: true, crouched: false, yaw: lane.yaw, pitch: 0, ...extra });
  put(a, 0); put(b, 30, { x: 999, z: 999 }); put(c, 30, { x: 999, z: 999 }); // out of the way unless placed
  arm(a, weapon);
  return { sim, events, a, b, c, lane, put };
}
export function arm(player, weapon) {
  Object.assign(player, { weapon, weaponId: weapon, inventory: { [weapon]: { ammo: WEAPONS[weapon].magazine || 1, reserve: WEAPONS[weapon].reserve } },
    shotAfter: 0, switchUntil: 0, reloadUntil: 0, meleeAfter: 0, pendingMelee: null });
}
export function zombieAt(sim, lane, t, extra = {}) {
  const id = `z${900 + sim.zombies.size}`, zombie = { id, ...lane.at(t), y: 0, yaw: 0, hp: 1e6, maxHp: 1e6, kind: 'walker', scale: 1,
    speed: 0, attackAfter: Infinity, entered: true, ...extra };
  sim.zombies.set(id, zombie); return zombie;
}
// Physical bullets fly on the simulation clock.
export function flyBullets(sim, seconds = .6) {
  for (let left = seconds; left > 1e-9 && sim.bullets.size; left -= TICK) { sim.time += TICK; sim.updateBullets(TICK); }
}
export const friendlyHits = (events, id) => events.filter(event => event.event === 'hit' && event.source === 'friendly' && (id === undefined || event.id === id));
const hpLoss = player => 100 - player.hp;
const near = (actual, expected, tolerance = .002, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} != ${expected}`);

export const SCENARIOS = {
  'the host alone chooses friendly fire before the night; it is off by default and in every snapshot'() {
    const events = [], sim = new RoomSimulation('FFSET1', { onEvent: event => events.push(event) });
    sim.addPlayer(IDS.a, 'Ana'); sim.addPlayer(IDS.b, 'Bao');
    assert.equal(sim.friendlyFire, 'off'); assert.equal(sim.snapshot().friendlyFire, 'off');
    assert.equal(sim.setFriendlyFire(IDS.b, 'full'), false, 'not the host');
    for (const invalid of ['on', '', null, undefined, 1, 'FULL', '__proto__']) assert.equal(sim.setFriendlyFire(IDS.a, invalid), false, String(invalid));
    assert.equal(sim.setFriendlyFire(IDS.a, 'reduced'), true);
    assert.equal(sim.snapshot().friendlyFire, 'reduced');
    assert.deepEqual(events.filter(event => event.event === 'friendly-fire').map(({ id, level }) => ({ id, level })), [{ id: IDS.a, level: 'reduced' }]);
    assert.equal(sim.setFriendlyFire(IDS.a, 'reduced'), true, 'the same level again is accepted');
    assert.equal(events.filter(event => event.event === 'friendly-fire').length, 1, 'and announced once');
    sim.start(IDS.a);
    assert.equal(sim.setFriendlyFire(IDS.a, 'off'), false, 'never once the night has begun');
    sim.phase = 'gameover';
    assert.equal(sim.setFriendlyFire(IDS.a, 'full'), true, 'again on the results screen');
    const practice = new RoomSimulation('FFSET2', { practice: true }); practice.addPlayer(IDS.a, 'Ana');
    assert.equal(practice.setFriendlyFire(IDS.a, 'full'), false, 'never in the practice range');
    assert.deepEqual(FRIENDLY_FIRE, { off: 0, reduced: .25, full: 1 });
  },

  'every ambiance may choose it, Famille included, through one seam'() {
    for (const ambiance of AMBIANCES) {
      assert.equal(friendlyFireAllowed(ambiance), true, ambiance);
      const sim = new RoomSimulation('FFAMB1', { ambiance }); sim.addPlayer(IDS.a, 'Ana');
      assert.equal(sim.setFriendlyFire(IDS.a, 'full'), true, ambiance);
    }
    assert.equal(friendlyFireAllowed('neon'), false);
  },

  'off: a bullet passes a teammate untouched, as before'() {
    const { sim, events, a, b, lane, put } = room({ level: 'off' });
    put(b, 2.5); const zombie = zombieAt(sim, lane, 5);
    assert.equal(sim.shoot(IDS.a, 0), true); flyBullets(sim);
    assert.equal(b.hp, 100); assert.equal(friendlyHits(events).length, 0);
    assert.ok(zombie.hp < 1e6, 'the zombie behind takes the round');
    assert.ok(!events.some(event => event.event === 'bullet-impact' && event.stop === 'player'));
  },

  'full: a pistol round wounds the teammate in its way, says who fired, and stops in them'() {
    const { sim, events, b, lane, put } = room({ level: 'full' });
    put(b, 2.5); const zombie = zombieAt(sim, lane, 5);
    sim.shoot(IDS.a, 0); flyBullets(sim);
    const [hit] = friendlyHits(events, IDS.b);
    assert.ok(hit, 'a friendly hit');
    assert.equal(hit.shooterId, IDS.a); assert.equal(hit.weapon, 'pistol');
    assert.ok(hit.damage > 20 && hit.damage <= WEAPONS.pistol.damage + 1e-9, `pistol damage ${hit.damage}`);
    near(hpLoss(b), hit.damage, .002, 'health');
    near(hit.fromX, lane.at(0).x, .001); near(hit.fromZ, lane.at(0).z, .001);
    const impact = events.find(event => event.event === 'bullet-impact' && event.stop === 'player');
    assert.equal(impact.playerId, IDS.b); assert.equal(impact.terminal, true, 'the pistol pierces one body');
    assert.equal(zombie.hp, 1e6, 'the zombie behind is spared');
  },

  'reduced: the same round does a quarter of the damage'() {
    const runs = ['full', 'reduced'].map(level => {
      const { sim, events, b, lane, put } = room({ level });
      put(b, 2.5); zombieAt(sim, lane, 5); sim.shoot(IDS.a, 0); flyBullets(sim);
      return friendlyHits(events, IDS.b)[0].damage;
    });
    near(runs[1], runs[0] * FRIENDLY_FIRE.reduced, .002, 'quarter');
  },

  'a piercing round carries on through a zombie into a teammate behind it'() {
    const { sim, events, b, lane, put } = room({ level: 'full', weapon: 'smg' });
    const zombie = zombieAt(sim, lane, 2.5); put(b, 5);
    sim.shoot(IDS.a, 0); flyBullets(sim);
    assert.ok(zombie.hp < 1e6);
    assert.ok(friendlyHits(events, IDS.b).length === 1 && b.hp < 100, 'the teammate behind is hit');
  },

  'downed, waiting and just-revived survivors are never hurt; a downed one does not stop the round'() {
    const { sim, events, b, c, lane, put } = room({ level: 'full' });
    put(b, 2, { hp: 0, downed: true, bleedOutAt: sim.time + REVIVE.bleedOut });
    const zombie = zombieAt(sim, lane, 5);
    sim.shoot(IDS.a, 0); flyBullets(sim);
    assert.equal(friendlyHits(events).length, 0); assert.ok(zombie.hp < 1e6, 'the round passes over the downed teammate');
    Object.assign(b, { x: 999, z: 999 }); put(c, 2, { waiting: true, alive: false });
    sim.time += 1; arm(sim.players.get(IDS.a), 'pistol'); sim.shoot(IDS.a, 0); flyBullets(sim);
    assert.equal(c.hp, 100); assert.equal(friendlyHits(events).length, 0);
    put(c, 2, { waiting: false, alive: true, reviveShieldUntil: sim.time + 5 });
    sim.time += 1; arm(sim.players.get(IDS.a), 'pistol'); sim.shoot(IDS.a, 0); flyBullets(sim);
    assert.equal(c.hp, 100, 'the revive shield holds against teammates too');
  },

  'the usual survivor rules follow: difficulty, vest first'() {
    const plain = room({ level: 'full' }); plain.put(plain.b, 2.5); plain.sim.shoot(IDS.a, 0); flyBullets(plain.sim);
    const base = friendlyHits(plain.events, IDS.b)[0].damage;
    const hard = room({ level: 'full', difficulty: 'hard' }); hard.put(hard.b, 2.5); hard.sim.shoot(IDS.a, 0); flyBullets(hard.sim);
    near(friendlyHits(hard.events, IDS.b)[0].damage, base * difficultyOf('hard').damageTaken, .003, 'hard');
    const vest = room({ level: 'full' }); vest.put(vest.b, 2.5, { armor: 50 }); vest.sim.shoot(IDS.a, 0); flyBullets(vest.sim);
    const hit = friendlyHits(vest.events, IDS.b)[0];
    near(hit.absorbed, hit.damage, .001, 'the vest takes it'); assert.equal(vest.b.hp, 100);
  },

  'a teammate downed by friendly fire goes down as usual, keeps their coins and says who'() {
    const { sim, events, b, put } = room({ level: 'full', weapon: 'sniper' });
    put(b, 3, { points: 900 });
    sim.shoot(IDS.a, 0); flyBullets(sim);
    assert.equal(b.downed, true); assert.equal(b.points, 900, 'no robbery');
    const down = events.find(event => event.event === 'down' && event.id === IDS.b);
    assert.equal(down.source, 'friendly'); assert.equal(down.shooterId, IDS.a); assert.equal(down.seconds, REVIVE.bleedOut);
    assert.ok(b.bleedOutAt > sim.time, 'the usual bleed-out clock runs');
  },

  'a blade hurts a teammate inside the swing, not when friendly fire is off'() {
    for (const level of ['off', 'reduced', 'full']) {
      const { sim, events, a, b, put } = room({ level, weapon: 'katana' });
      put(b, 1.2);
      assert.equal(sim.shoot(IDS.a, 0, 'light'), true);
      sim.time = a.pendingMelee.impactAt + 1e-6; sim.updateMelee();
      const swing = events.find(event => event.event === 'melee-hit');
      if (level === 'off') { assert.equal(b.hp, 100); assert.equal(swing.hits, 0); assert.equal(swing.teammates, undefined); continue; }
      // The blow as dealt (health itself stops at 0: a full katana downs).
      const expected = WEAPONS.katana.attacks.light.damage * FRIENDLY_FIRE[level];
      near(friendlyHits(events, IDS.b)[0].damage, expected, .002, level);
      near(hpLoss(b), Math.min(100, expected), .002, level);
      assert.deepEqual(swing.teammates.map(entry => entry.playerId), [IDS.b]); assert.equal(swing.hits, 1);
      assert.equal(friendlyHits(events, IDS.b)[0].weapon, 'katana');
    }
  },

  'a blade cleaving a zombie then a teammate keeps its retention'() {
    const { sim, events, a, b, lane, put } = room({ level: 'full', weapon: 'katana' });
    zombieAt(sim, lane, .9); put(b, 1.5);
    sim.shoot(IDS.a, 0, 'light'); sim.time = a.pendingMelee.impactAt + 1e-6; sim.updateMelee();
    const light = WEAPONS.katana.attacks.light;
    near(friendlyHits(events, IDS.b)[0].damage, light.damage * light.retention, .002, 'second body');
  },

  'a grenade hurts every survivor in its blast, its thrower too, and nobody when off'() {
    for (const level of ['off', 'full']) {
      const { sim, events, a, b, lane, put } = room({ level });
      put(b, 3.5);
      const centre = { ...lane.at(1.5), y: .9 };
      const grenade = { id: 'g1', ownerId: IDS.a, ...centre, vx: 0, vy: 0, vz: 0, fuseLeft: 0, damageMultiplier: 1 };
      sim.grenades.set('g1', grenade); sim.explodeGrenade(grenade);
      const blast = events.find(event => event.event === 'explosion');
      if (level === 'off') { assert.equal(a.hp + b.hp, 200); assert.equal(blast.teammates, undefined); continue; }
      for (const [player, id] of [[a, IDS.a], [b, IDS.b]]) {
        const box = playerHitbox(player), range = Math.hypot(player.x - centre.x, (box.minY + box.maxY) / 2 - centre.y, player.z - centre.z);
        const [hit] = friendlyHits(events, id);
        near(hit.damage, blastDamageAtDistance(GRENADES, range), .002, id);
        assert.equal(hit.shooterId, IDS.a); assert.equal(hit.weapon, 'grenade');
      }
      assert.deepEqual(blast.teammates.map(entry => entry.playerId).sort(), [IDS.a, IDS.b].sort());
    }
  },

  'a rocket stops on a teammate in its way and its blast hurts; the shooter far enough is spared'() {
    const { sim, events, a, b, lane, put } = room({ level: 'reduced', weapon: 'rocket' });
    put(b, 6); zombieAt(sim, lane, 9);
    sim.shoot(IDS.a, 0);
    const shot = events.find(event => event.event === 'shot' && event.weapon === 'rocket');
    assert.equal(shot.pellets[0].stop, 'player');
    assert.ok(b.hp < 100 && b.hp >= 100 - ROCKET.damage * FRIENDLY_FIRE.reduced - 1e-6, `blast ${100 - b.hp}`);
    assert.equal(a.hp, 100, 'six metres away: out of the 4 m blast');
    assert.equal(events.find(event => event.event === 'explosion').teammates[0].playerId, IDS.b);
  },

  'a rocket fired at a zombie at arm\'s length hurts its own shooter'() {
    for (const level of ['off', 'reduced']) {
      const { sim, a, lane } = room({ level, weapon: 'rocket' });
      zombieAt(sim, lane, 1.5);
      sim.shoot(IDS.a, 0);
      if (level === 'off') assert.equal(a.hp, 100); else assert.ok(a.hp < 100, 'self-inflicted');
    }
  },

  'flames burn a teammate in the cone while they stand in it, and nothing lingers'() {
    for (const level of ['off', 'full']) {
      const { sim, events, a, b, put } = room({ level, weapon: 'flamethrower' });
      put(b, 3);
      sim.shoot(IDS.a, 0);
      if (level === 'off') { assert.equal(b.hp, 100); continue; }
      const strength = flameFalloff(FLAMETHROWER, 3);
      const expected = (FLAMETHROWER.contactDps + FLAMETHROWER.burnDps) * strength * WEAPONS.flamethrower.interval;
      assert.ok(Math.abs(hpLoss(b) - expected) < .5, `flame ${hpLoss(b)} vs ${expected}`);
      assert.equal(friendlyHits(events, IDS.b)[0].weapon, 'flamethrower');
      assert.equal(a.hp, 100, 'never the one holding the nozzle');
      const after = b.hp; sim.time += 2; sim.updateBurns(2); assert.equal(b.hp, after, 'no burn left on a survivor');
    }
  },

  'hitscan fallback: a teammate in a pellet\'s way is hurt too'() {
    const { sim, events, b, lane, put } = room({ level: 'full' });
    sim.ballisticsEnabled = false; put(b, 2.5); const zombie = zombieAt(sim, lane, 5);
    sim.shoot(IDS.a, 0);
    assert.ok(b.hp < 100); assert.equal(zombie.hp, 1e6);
    assert.equal(events.find(event => event.event === 'shot').pellets[0].stop, 'player');
  },

  'the online authority applies the same friendly fire'() {
    const { sim, events, b, put } = room({ level: 'full', Simulation: OnlineRoomSimulation });
    put(b, 2.5);
    assert.equal(sim.shootOnline(IDS.a, 0, { yaw: sim.players.get(IDS.a).yaw, pitch: 0 }), true);
    flyBullets(sim);
    assert.ok(friendlyHits(events, IDS.b).length === 1 && b.hp < 100);
  },

  'saves keep the level, an older file without it loads as off, and a round in flight remembers whom it hit'() {
    const { sim, b, put, lane } = room({ level: 'reduced', weapon: 'smg' });
    put(b, 1); zombieAt(sim, lane, 8);
    sim.shoot(IDS.a, 0);
    for (let step = 0; step < 4 && ![...sim.bullets.values()].some(bullet => bullet.hitPlayerIds?.size); step++) { sim.time += TICK; sim.updateBullets(TICK); }
    assert.ok([...sim.bullets.values()].some(bullet => bullet.hitPlayerIds?.has(IDS.b)), 'a round went on through the teammate');
    sim.paused = true; sim.pauseById = IDS.a;
    const save = JSON.parse(JSON.stringify(sim.exportSave({ requesterId: IDS.a })));
    assert.equal(save.friendlyFire, 'reduced');
    const load = file => {
      const fresh = new RoomSimulation('FFLOAD', { random: () => .5 }); fresh.addPlayer(IDS.a, 'Ana');
      const result = fresh.importSave(file, IDS.a); assert.equal(result.ok, true, result.reason); return fresh;
    };
    const restored = load(save);
    assert.equal(restored.friendlyFire, 'reduced'); assert.equal(restored.snapshot().friendlyFire, 'reduced');
    // Restored records take seat ids: the round's memory follows its seat.
    const seats = [...restored.reservedSeats?.keys() ?? [], ...restored.players.keys()];
    const remembered = [...restored.bullets.values()].flatMap(bullet => [...bullet.hitPlayerIds ?? []]);
    assert.equal(remembered.length, 1); assert.ok(seats.includes(remembered[0]), remembered[0]);
    const { friendlyFire, ...older } = save;
    assert.equal(load(older).friendlyFire, 'off');
    assert.equal(load({ ...save, friendlyFire: 'always' }).friendlyFire, 'off', 'a crafted level is refused');
  },
};

export function runAll() {
  const names = Object.keys(SCENARIOS);
  for (const name of names) SCENARIOS[name]();
  return names;
}
