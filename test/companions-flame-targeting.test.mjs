import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { createCompanionBody } from '../companions/body.mjs';
import { rollCompanionProfile } from '../companions/profiles.mjs';
import { seededRandom } from '../validation/balance-report.mjs';

const TICK = 1 / 30;
function scene({ position = { x: -4.5, z: 1.3 }, seed = 4 } = {}) {
  const events = [], sim = new RoomSimulation('FLAMEQA', { random: seededRandom(seed), onEvent: event => events.push(event) });
  const human = sim.addPlayer('human', 'Papa'), bot = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(human.id);
  Object.assign(sim, { phase: 'wave', wave: 8, toSpawn: 1, spawnTimer: 1e9 });
  Object.assign(human, { x: 6, z: 4, reviveShieldUntil: Infinity });
  Object.assign(bot, { ...position, y: 0, yaw: 0, reviveShieldUntil: Infinity, weapon: 'flamethrower',
    inventory: { flamethrower: { ammo: 80, reserve: 2000 } } });
  sim.zombies.clear();
  const profile = rollCompanionProfile('veteran', () => .5);
  const body = createCompanionBody(sim, bot.id, { random: seededRandom(seed + 1000), profile });
  const enemy = (x, z, extra = {}) => Object.assign(sim.spawnZombie(), { x, y: 0, z, speed: 0, entered: true, hp: 1e9, maxHp: 1e9, ...extra });
  const shots = () => events.filter(event => event.event === 'shot' && event.id === bot.id);
  const firstShot = (order = { kind: 'hold' }) => {
    body.setOrder(order);
    for (let tick = 0; tick < 90 && !shots().length; tick++) { body.tick(TICK); sim.tick(TICK); }
    assert.ok(shots().length, `real shot, body ${body.status}`);
    return shots()[0];
  };
  return { sim, bot, human, body, profile, enemy, shots, firstShot };
}

test('flames prefer four exposed clustered bodies over a slightly nearer isolated zombie', () => {
  const { sim, bot, body, profile, enemy, firstShot } = scene();
  const isolated = enemy(-6.9, -.5), pack = [enemy(-2.5, -1.4), enemy(-2.2, -1.1), enemy(-1.9, -1.3), enemy(-2.1, -.8)];
  const handling = structuredClone(profile.aim), start = { x: bot.x, z: bot.z }, shot = firstShot();
  assert.equal(shot.hits, 4, 'the real flame cone hits the pack on the first jet');
  assert.ok(pack.every(zombie => zombie.burnUntil > sim.time));
  assert.ok(!(isolated.burnUntil > sim.time));
  assert.deepEqual({ x: bot.x, z: bot.z }, start, 'coverage uses the current safe position');
  assert.deepEqual(profile.aim, handling, 'reaction, accuracy and archetype remain unchanged');
  assert.ok(shot.time >= profile.aim.reaction[0]);
  assert.equal(body.status, 'running');
});

test('a named flame target can be kept inside a shared cone by aiming between a wide visible pair', () => {
  const { sim, bot, enemy, firstShot } = scene();
  const angle = 15 * Math.PI / 180, radius = 3.5;
  const first = enemy(bot.x - Math.sin(angle) * radius, bot.z - Math.cos(angle) * radius);
  const second = enemy(bot.x + Math.sin(angle) * radius, bot.z - Math.cos(angle) * radius);
  const shot = firstShot({ kind: 'shoot', zombieId: first.id });
  assert.equal(shot.hits, 2, 'both bodies are in the actual 40° flame cone');
  assert.ok(first.burnUntil > sim.time && second.burnUntil > sim.time);
  assert.ok(Math.abs(shot.yaw) < angle / 2, 'the aim lies between the bodies rather than on one edge');
});

test('an isolated flame target still receives the familiar single-target aim and contact damage', () => {
  const { sim, enemy, firstShot } = scene();
  const target = enemy(-6.9, -.5), shot = firstShot();
  assert.equal(shot.hits, 1);
  assert.ok(target.burnUntil > sim.time);
  assert.ok(shot.yaw > .7, 'it points at the isolated target');
});

test('flame coverage never trades a zombie about to bite a teammate for a larger distant pack', () => {
  const { sim, human, enemy, firstShot } = scene();
  Object.assign(human, { x: -7.1, z: -2.3 });
  const threat = enemy(-7.3, -1.2), pack = [enemy(-2.5, -1.4), enemy(-2.2, -1.1), enemy(-1.9, -1.3), enemy(-2.1, -.8)];
  const shot = firstShot();
  assert.equal(shot.hits, 1);
  assert.ok(threat.burnUntil > sim.time, 'the endangered teammate is protected first');
  assert.ok(pack.every(zombie => !(zombie.burnUntil > sim.time)));
});

test('hidden zombies behind the cabin partition do not create an imaginary flame opportunity', () => {
  const { sim, enemy, firstShot } = scene({ position: { x: -1, z: 1.3 } });
  const target = enemy(-4, 1.3), hidden = [enemy(-.5, -3), enemy(0, -3), enemy(.5, -3)];
  const shot = firstShot();
  assert.equal(shot.hits, 1);
  assert.ok(target.burnUntil > sim.time);
  assert.ok(hidden.every(zombie => !(zombie.burnUntil > sim.time)), 'the real obstacle blocks the cone');
});

test('a tempting intermediate flame direction is rejected when its central jet crosses the partition', () => {
  const { sim, enemy, firstShot } = scene({ position: { x: -5.5, z: .3 } });
  const behindEnd = enemy(-3.8, -2.7), inFront = enemy(-2.8, -1.5);
  const shot = firstShot({ kind: 'shoot', zombieId: behindEnd.id });
  assert.equal(shot.hits, 1, 'a blocked midpoint is not selected to claim two targets');
  assert.ok(behindEnd.burnUntil > sim.time);
  assert.ok(!(inFront.burnUntil > sim.time));
  const cosine = Math.cos(shot.pitch), direction = { x: -Math.sin(shot.yaw) * cosine, y: Math.sin(shot.pitch), z: -Math.cos(shot.yaw) * cosine };
  const at = { x: shot.x + direction.x * 3, y: shot.y + direction.y * 3, z: shot.z + direction.z * 3 };
  assert.ok(sim.raiderLineClear(shot, at), 'the fired central jet passes the open end of the partition');
});

test('ten visible bodies use a bounded obstacle search and refresh for moved or removed bodies', () => {
  const { sim, bot, body, enemy } = scene();
  for (let index = 0; index < 10; index++) {
    const angle = (index - 4.5) * .045;
    enemy(bot.x + Math.sin(angle) * 3.3, bot.z - Math.cos(angle) * 3.3);
  }
  const visible = sim.grenadeBlastVisible.bind(sim);
  let checks = 0;
  sim.grenadeBlastVisible = (...args) => { checks++; return visible(...args); };
  body.setOrder({ kind: 'hold' }); body.tick(TICK);
  assert.ok(checks > 0 && checks < 150, `${checks} actual obstacle checks for a dense ten-body group`);
  sim.tick(TICK); checks = 0; body.tick(TICK);
  assert.equal(checks, 0, 'a stationary aim reuses coverage between glances during reaction');
  bot.x -= .25; checks = 0; body.tick(TICK);
  assert.ok(checks > 0 && checks < 150, 'a changed eye immediately rechecks real obstacles');
  const target = [...sim.zombies.values()][0];
  target.x -= .25; checks = 0; body.tick(TICK);
  assert.ok(checks > 0 && checks < 150, 'a changed target refreshes coverage before the next glance');
  sim.zombies.delete(target.id); checks = 0; body.tick(TICK);
  assert.ok(checks > 0 && checks < 150, 'a disappeared target cannot remain in the cached crowd score');
});

test('a moving visible pair keeps its shared flame aim while the bot stays in place', () => {
  const { sim, bot, body, enemy, firstShot, shots } = scene({ seed: 14 });
  const angle = 15 * Math.PI / 180, radius = 3.5;
  const left = enemy(bot.x - Math.sin(angle) * radius, bot.z - Math.cos(angle) * radius);
  const right = enemy(bot.x + Math.sin(angle) * radius, bot.z - Math.cos(angle) * radius);
  assert.equal(firstShot({ kind: 'shoot', zombieId: left.id }).hits, 2);
  const initial = { x: bot.x, z: bot.z };
  for (let tick = 0; tick < 4; tick++) {
    left.x -= .1; right.x -= .1;
    body.tick(TICK); sim.tick(TICK);
  }
  const movedAt = sim.time, followed = () => shots().find(shot => shot.time >= movedAt - 1e-8);
  for (let tick = 0; tick < 12 && !followed(); tick++) { body.tick(TICK); sim.tick(TICK); }
  assert.ok(followed());
  assert.equal(followed().hits, 2, 'the next real jet after the shift follows the group');
  assert.ok(followed().yaw > shots()[0].yaw + .03, 'the aim tracks the sideways movement');
  assert.deepEqual({ x: bot.x, z: bot.z }, initial);
});

test('piercing preference counts an observed second body but never a body outside the sight sample', () => {
  for (const hiddenBySample of [true, false]) {
    const { sim, bot, enemy, firstShot } = scene();
    Object.assign(bot, { weapon: 'smg', inventory: { smg: { ammo: 40, reserve: 2000 } } });
    enemy(-6.7, -1.2); // slightly nearer isolated target, away from our door planks
    enemy(-4.5, -2.3); enemy(-4.5, -5.7); // two clear bodies on one firing line
    // The glance checks the nearest ten. These nearer bodies are hidden by
    // the real partition, so the distant aligned body has not been observed.
    if (hiddenBySample) for (let index = 0; index < 8; index++) enemy(-.6 + index * .08, -2.6);
    const shot = firstShot();
    assert.equal(shot.weapon, 'smg');
    if (hiddenBySample) assert.ok(shot.yaw > .5, 'an unobserved extra body cannot pull aim away from the nearer target');
    else assert.ok(Math.abs(shot.yaw) < .1, 'the genuinely observed line keeps its useful piercing preference');
  }
});
