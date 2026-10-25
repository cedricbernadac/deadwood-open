import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { GRENADES, ROCKET, KILL_CHAIN, ECONOMY } from '../public/rules.js';
import { enemyHitbox } from '../public/enemies.js';
import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';

// The score rework (owner, 18 October): « les dommages et les points font un
// peu double emploi ». A survivor's score is the health their hits really
// removed (after resistance, never past what the enemy had left), from every
// damage path; kill chains, raid bonuses, repairs and revives add to it.
function room({ practice = false, companion = false } = {}) {
  const events = [], sim = new RoomSimulation('SCORE', { random: () => .5, raids: false, practice, onEvent: event => events.push(event) });
  const a = sim.addPlayer('a', 'Alice', undefined, companion ? { companion: true } : {});
  const b = sim.addPlayer('b', 'Bob');
  if (!practice) { sim.start(companion ? 'b' : 'a'); Object.assign(sim, { phase: 'wave', wave: 13, toSpawn: 1, spawnTimer: 1e9 }); }
  sim.zombies.clear();
  for (const [index, player] of [a, b].entries()) Object.assign(player, { x: 12 + index * .8, y: 0, z: 8, yaw: 0, pitch: 0, hp: 1e6 });
  return { sim, a, b, events };
}
function arm(player, weapon) {
  Object.assign(player, { weapon, weaponId: weapon, shotAfter: 0, meleeAfter: 0,
    inventory: { [weapon]: { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve } } });
}
function target(sim, id = 'victim', extra = {}) {
  const zombie = { id, x: 12, y: 0, z: 6, yaw: 0, hp: 10000, maxHp: 10000, kind: 'walker', scale: 1,
    speed: 0, attackAfter: Infinity, entered: true, ...extra };
  sim.zombies.set(id, zombie); return zombie;
}
const exact = player => player.score + player.scoreCarry;
const advance = (sim, seconds, update) => { for (let left = seconds; left > 1e-9;) { const delta = Math.min(1 / 30, left); sim.time += delta; update(delta); left -= delta; } };
function blast(sim, owner, zombie, damageMultiplier = 1) {
  const box = enemyHitbox(zombie), grenade = { id: `g${sim.nextGrenadeId++}`, ownerId: owner.id, x: zombie.x, y: (box.minY + box.maxY) / 2, z: zombie.z, damageMultiplier };
  sim.grenades.set(grenade.id, grenade); return sim.explodeGrenade(grenade);
}

test('every damage path scores exactly the health it removed, in whole points with the fractions carried', () => {
  const paths = {
    bullet: (sim, a) => { arm(a, 'pistol'); sim.shoot('a'); advanceBallisticFlight(sim, .2); },
    pellets: (sim, a) => { arm(a, 'shotgun'); sim.shoot('a'); advanceBallisticFlight(sim, .2); },
    'melee light': (sim, a) => { arm(a, 'katana'); Object.assign(sim.zombies.get('victim'), { z: 6.7 }); sim.shoot('a', 0, 'light'); sim.time = a.pendingMelee.impactAt + .001; sim.updateMelee(); },
    'melee heavy': (sim, a) => { arm(a, 'hammer'); Object.assign(sim.zombies.get('victim'), { z: 6.7 }); sim.shoot('a', 0, 'heavy'); sim.time = a.pendingMelee.impactAt + .001; sim.updateMelee(); },
    'flame contact and burn ticks': (sim, a) => { arm(a, 'flamethrower'); sim.shoot('a'); advance(sim, 4.5, delta => sim.updateBurns(delta)); },
    grenade: (sim, a) => blast(sim, a, sim.zombies.get('victim')),
    'Grenadier grenade': (sim, a) => blast(sim, a, sim.zombies.get('victim'), 1.5),
    rocket: (sim, a) => { arm(a, 'rocket'); sim.shoot('a'); },
  };
  const removed = {};
  for (const [label, run] of Object.entries(paths)) {
    for (const kind of ['walker', 'armored']) {
      const { sim, a } = room(), zombie = target(sim, 'victim', { kind });
      run(sim, a);
      const dealt = 10000 - zombie.hp;
      assert.ok(dealt > 0, `${label} ${kind}: a real hit`);
      assert.ok(Math.abs(exact(a) - dealt) < 1e-6, `${label} ${kind}: ${exact(a)} for ${dealt} HP, nothing lost`);
      assert.ok(Number.isInteger(a.score) && a.scoreCarry >= 0 && a.scoreCarry < 1);
      assert.ok(Number.isInteger(sim.snapshot().players[0].score), 'snapshots carry whole points');
      if (kind === 'walker') removed[label] = dealt;
    }
  }
  assert.equal(removed.grenade, GRENADES.damage);
  assert.ok(Math.abs(removed['Grenadier grenade'] - GRENADES.damage * 1.5) < 1e-9, 'the Grenadier multiplier scores too');
  assert.equal(removed.rocket, ROCKET.damage);
});

test('no overkill: a 700-damage rocket on a 40-HP zombie scores 40; a kill adds nothing fixed, head or not', () => {
  const { sim, a, events } = room(); arm(a, 'rocket');
  target(sim, 'small', { hp: 40, maxHp: 40 });
  sim.shoot('a');
  assert.equal(a.score, 40); assert.equal(a.kills, 1);
  assert.equal(events.find(event => event.event === 'kill').score, 0, 'the kill event adds only its chain bonus');
  for (const y of [.4, 0]) {
    const { sim: other, a: shooter, events: seen } = room(); arm(shooter, 'pistol');
    target(other, 'z', { hp: 20, maxHp: 20, y, z: 7 });
    other.shoot('a'); advanceBallisticFlight(other, .2);
    assert.equal(seen.find(event => event.event === 'kill').headshot, y === 0);
    assert.equal(shooter.score, 20, `head shot ${y === 0}: no bonus, its 20 HP`);
  }
});

test('two survivors hitting one enemy in the same tick never both get its last health', () => {
  const { sim, a, b } = room(); arm(a, 'pistol'); arm(b, 'pistol');
  Object.assign(b, { x: 12 });
  const zombie = target(sim, 'shared', { hp: 30, maxHp: 30, y: .4 });
  sim.shoot('a'); sim.shoot('b'); advanceBallisticFlight(sim, .2);
  assert.ok(zombie.hp <= 0);
  assert.ok(Math.abs(exact(a) + exact(b) - 30) < 1e-9, 'thirty HP, scored once between them');
  assert.ok(a.score > 0 && b.score + b.scoreCarry > 0, 'each scores what their own bullet removed');
  const second = room(), victim = target(second.sim, 'pair', { hp: 100, maxHp: 100 });
  blast(second.sim, second.a, victim); blast(second.sim, second.b, victim);
  assert.equal(second.a.score, 100); assert.equal(second.b.score, 0, 'the second blast finds it already dead');
});

test('no score for a dead enemy or a target removed from play; the practice stand keeps its running score', () => {
  const { sim, a } = room(), zombie = target(sim, 'gone', { hp: 50 });
  assert.equal(sim.damageSpecialZombie(zombie, 50, 'a', { x: 0, z: 1 }, 'pistol'), true);
  assert.equal(a.score, 50);
  assert.equal(sim.damageSpecialZombie(zombie, 50, 'a', { x: 0, z: 1 }, 'pistol'), false, 'already dead');
  assert.equal(sim.damageSpecialZombie({ id: 'ghost', hp: 100 }, 50, 'a', { x: 0, z: 1 }, 'pistol'), false, 'not in play');
  assert.equal(a.score, 50);
  // Spec rule 1: practice rooms keep their score behaviour. The stand always
  // scored its hits and kills (never coins); it now scores their damage.
  const practice = room({ practice: true });
  const stand = target(practice.sim, 'stand', { hp: 80, maxHp: 80 }), points = practice.a.points;
  practice.sim.damageSpecialZombie(stand, 100, 'a', { x: 0, z: 1 }, 'pistol');
  assert.equal(practice.a.score, 80, 'the stand scores the 80 HP its target had');
  assert.equal(practice.a.points, points, 'and pays no coins, as before');
});

// A burn kept alive by another flamethrower (review, 18 October): each
// stretch of it scores for the shooter whose flame drives it then, while the
// kill, its chain and its loot stay with whoever lit it.
test('two flamethrowers on one body: the burn scores for whoever keeps it burning, the kill stays with its igniter', () => {
  const { sim, a, b, events } = room(); arm(a, 'flamethrower'); arm(b, 'flamethrower');
  Object.assign(b, { x: 12.3 });
  const zombie = target(sim, 'torch', { x: 12.15, z: 6.5, hp: 1e6, maxHp: 1e6 });
  const step = 1 / 30;
  assert.equal(sim.shoot('a'), true, 'one puff from Alice');
  for (let elapsed = 0; elapsed < 6; elapsed += step) {
    sim.time += step;
    if (sim.time + 1e-9 >= b.shotAfter) sim.shoot('b');
    sim.updateBurns(step);
  }
  const removed = 1e6 - zombie.hp;
  assert.ok(Math.abs(exact(a) + exact(b) - removed) < 1e-6, 'every HP scored once between them');
  assert.ok(exact(a) < 20, `Alice scores her puff and the burn until Bob's flame took over (${exact(a)})`);
  assert.ok(exact(b) > .98 * removed, `Bob's six seconds of fire are his (${exact(b)} of ${removed})`);
  assert.equal(zombie.burnOwnerId, 'a', 'the burn is still the one Alice lit');
  assert.ok(zombie.burnExposures.every(exposure => exposure.ownerId === 'b'));
  // Lit by Alice, kept burning by Bob, it dies of the burn: Bob scores that
  // burn, Alice gets the kill (its chain and loot) as before.
  const second = room(); arm(second.a, 'flamethrower'); arm(second.b, 'flamethrower');
  Object.assign(second.b, { x: 12.3 });
  const victim = target(second.sim, 'cinder', { x: 12.15, z: 6.5, hp: 400, maxHp: 400 });
  second.sim.shoot('a'); second.sim.time += .1; second.sim.updateBurns(.1);
  second.sim.shoot('b');
  const contactKill = second.events.filter(event => event.event === 'kill').length;
  assert.equal(contactKill, 0, 'not dead yet');
  const before = exact(second.b);
  second.sim.time += 3; second.sim.updateBurns(3);
  assert.equal(second.sim.zombies.has(victim.id), false, 'the burn killed it');
  const [kill] = second.events.filter(event => event.event === 'kill');
  assert.equal(kill.id, 'a'); assert.equal(second.a.kills, 1); assert.equal(second.b.kills, 0);
  assert.ok(exact(second.b) - before > 300, 'Bob scored the burn that finished it');
  assert.ok(Math.abs(exact(second.a) + exact(second.b) - 400) < 1e-6, 'its 400 HP, scored once');
  // An exposure without a shooter (a save from before this rule) is the igniter's.
  const old = room(), legacy = target(old.sim, 'legacy', { hp: 1e4, maxHp: 1e4 });
  Object.assign(legacy, { burnOwnerId: 'b', burnStartedAt: old.sim.time, burnDamageAt: old.sim.time, burnUntil: old.sim.time + 4, burnExposures: [{ strength: 1, until: old.sim.time + 4 }] });
  old.sim.time += 1; old.sim.updateBurns(1);
  assert.ok(exact(old.b) > 0 && exact(old.a) === 0);
  // A burn nobody owns (a crafted file) still burns, and scores nobody.
  const orphan = target(old.sim, 'orphan', { hp: 1e4, maxHp: 1e4, burnStartedAt: old.sim.time, burnDamageAt: old.sim.time, burnUntil: old.sim.time + 4 });
  old.sim.zombies.delete(legacy.id);
  const scores = [exact(old.a), exact(old.b)];
  old.sim.time += 1; assert.doesNotThrow(() => old.sim.updateBurns(1));
  assert.ok(orphan.hp < 1e4); assert.deepEqual([exact(old.a), exact(old.b)], scores);
});

test('blasts never hurt survivors: no friendly or self damage, so no score from it', () => {
  const { sim, a, b } = room();
  const before = [a.hp, b.hp];
  const grenade = { id: 'g1', ownerId: 'a', x: a.x, y: .3, z: a.z, damageMultiplier: 1 };
  sim.grenades.set(grenade.id, grenade); sim.explodeGrenade(grenade);
  assert.deepEqual([a.hp, b.hp], before);
  assert.equal(a.score + b.score, 0);
});

test('kill chains keep their bonus on top of the damage', () => {
  const { sim, a, events } = room(); arm(a, 'pistol');
  for (const id of ['first', 'second', 'third']) {
    target(sim, id, { hp: 10, maxHp: 10, y: .4, z: 7 });
    sim.time = Math.max(sim.time, a.shotAfter); sim.shoot('a'); advanceBallisticFlight(sim, .2);
  }
  assert.deepEqual(events.filter(event => event.event === 'kill').map(event => [event.chain, event.chainBonus, event.score]), [[1, 0, 0], [2, 25, 25], [3, 50, 50]]);
  assert.equal(a.score, 30 + 25 + 50);
  assert.equal(KILL_CHAIN.bonusPerKill, 25); assert.equal(KILL_CHAIN.maxBonus, 100);
});

test('a companion scores its useful damage like anyone; coins stay coins', () => {
  const { sim, a } = room({ companion: true }); arm(a, 'pistol');
  target(sim, 'z', { hp: 20, maxHp: 20, y: .4, z: 7 });
  sim.shoot('a'); advanceBallisticFlight(sim, .2);
  assert.equal(a.companion, true); assert.equal(a.score, 20);
  assert.equal(a.points, ECONOMY.kill, 'a companion is paid its kill cash directly, unchanged');
});

test('raid clear bonus, repairs and the score carry stay whole points', () => {
  const { sim, a } = room();
  sim.addScore(a, .5); sim.addScore(a, .25); assert.deepEqual([a.score, a.scoreCarry], [0, .75]);
  sim.addScore(a, .5); assert.deepEqual([a.score, a.scoreCarry], [1, .25]);
  for (let index = 0; index < 10; index++) sim.addScore(a, .1);
  assert.equal(a.score, 2, 'ten tenths make a point; the float error never loses it'); assert.ok(a.scoreCarry < .26);
  sim.awardPoints(a, 50); assert.deepEqual([a.score, a.points], [52, 50], 'a raid bonus: score and coins, as before');
  assert.equal(sim.addScore(a, -5), 0); assert.equal(sim.addScore(a, NaN), 0); assert.equal(sim.addScore(a, Infinity), 0); assert.equal(a.score, 52);
  assert.equal(sim.start('a'), false, 'a night in progress cannot be restarted');
  sim.endGame(); sim.start('a');
  assert.deepEqual([a.score, a.scoreCarry], [0, 0], 'a new night starts from zero');
});
