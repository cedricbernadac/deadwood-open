import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody, LOFT_POST } from '../../companions/body.mjs';
import { ARMORY, playerEyeHeight } from '../../public/rules.js';
import { IS_FUNFAIR } from '../../public/level-config.js';
import { SPACE, spaceFlightAt } from '../../public/level-space.js';
import { activeWeaponId } from '../../public/weapon-inventory.js';
import { seededRandom } from '../../validation/balance-report.mjs';

assert.equal(IS_FUNFAIR, true, 'run with DEADWOOD_LEVEL=funfair');
const DT = 1 / 30;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = value => Math.round(value * 100) / 100;
const P = point => `(${r2(point.x)},${r2(point.y ?? 0)},${r2(point.z)})`;
const target = id => ({ ...SPACE.rooms.find(item => item.id === id).target });
const blocks = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['doors', 'follow', 'head', 'heavy', 'loft']);
const failures = [], verified = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };

function room({ seed = 18, doors = 'intact', human = { x: 0, y: 0, z: .7 }, bot = { x: 1, y: 0, z: 0 } } = {}) {
  const events = [];
  const sim = new RoomSimulation('FUNORD', { random: seededRandom(seed), raids: false, onEvent: event => events.push(event) });
  const papa = sim.addPlayer('papa', 'Papa');
  const max = sim.addPlayer('bot', 'Max', undefined, { companion: true });
  sim.start(papa.id);
  Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  for (const door of sim.doors) {
    door.sealed = false; door.sealPending = false;
    if (doors === 'open') door.boards.fill(0);
  }
  Object.assign(papa, human, { grounded: true, vy: 0 });
  Object.assign(max, bot, { grounded: true, vy: 0, points: 50000, companionSlot: 0 });
  sim.companionOrders = new Map();
  const body = createCompanionBody(sim, max.id, { random: seededRandom(88) });
  const idle = () => sim.setInput(papa.id, { forward: 0, strafe: 0, yaw: papa.yaw ?? 0, pitch: 0 });
  const run = (seconds, { drive = idle, until = () => false, each = null } = {}) => {
    for (let tick = 0; tick < Math.round(seconds * 30); tick++) {
      drive();
      body.tick(DT);
      sim.spawnTimer = 1e9; sim.tick(DT);
      each?.();
      if (until()) return true;
    }
    return false;
  };
  return { sim, papa, bot: max, body, events, run };
}
function walker(sim, at, extra = {}) {
  const enemy = sim.spawnZombie();
  Object.assign(enemy, { kind: 'walker' }, at, { y: at.y ?? 0 }, extra);
  enemy.navigation = null; enemy.portalRoute = null;
  return enemy;
}
const shots = (events, bot) => events.filter(event => event.event === 'shot' && event.id === bot.id).length;

if (blocks.has('doors')) {
  const rows = [];
  for (const door of room().sim.doors) {
    const { sim, bot, body, events, run } = room({ doors: 'open' });
    const d = sim.doors.find(item => item.id === door.id);
    body.setOrder({ kind: 'defend', doorId: d.id });
    run(3);
    const status = body.status;
    run(1);
    const depth = -((bot.x - d.x) * d.outX + (bot.z - d.z) * d.outZ);
    const threshold = { x: d.x - d.outX * .3, y: 1.4, z: d.z - d.outZ * .3 };
    const sees = sim.raiderLineClear({ x: bot.x, y: 1.55, z: bot.z }, threshold);
    const post = { x: bot.x, y: bot.y, z: bot.z };
    const enemy = walker(sim, { x: d.x + d.outX * 9, z: d.z + d.outZ * 9 }, { entered: false, doorId: d.id });
    const hp = bot.hp, before = shots(events, bot);
    let firstShot = null, killedAt = null, time = 0;
    run(15, {
      each: () => {
        time += DT;
        if (firstShot === null && shots(events, bot) > before && enemy.hp > 0) firstShot = flat(bot, enemy);
      },
      until: () => (killedAt = !(enemy.hp > 0) || !sim.zombies.has(enemy.id) ? time : null) !== null,
    });
    const row = { door: d.id, status, post, depth, sees, killedAt, firstShot, lost: hp - bot.hp, finalStatus: body.status };
    rows.push(row);
    check(status === 'running', `defend:${d.id} is '${status}' after 3 s`);
    check(depth >= 2.5 && depth <= 4.5 && Math.abs(bot.y) < .1, `defend:${d.id} post ${P(post)} is ${r2(depth)} m inside (2.5-4.5 m wanted)`);
    check(sees, `defend:${d.id} post ${P(post)} has no eye line to the threshold`);
    check(killedAt !== null, `defend:${d.id}: the walker from 9 m out is not killed within 15 s (${shots(events, bot) - before} shots)`);
    check(row.lost === 0, `defend:${d.id}: ${r2(row.lost)} HP lost to one walker`);
    check(row.finalStatus === 'running', `defend:${d.id} is '${row.finalStatus}' after the walker (the guard holds)`);
  }
  verified.push(`defend ${rows.map(row => `${row.door} ${row.status} at ${P(row.post)} ${r2(row.depth)} m in, killed ${row.killedAt === null ? 'never' : `${r2(row.killedAt)} s`}, ${r2(row.lost)} HP lost`).join('; ')}`);
}

function reversals() {
  let direction = 0, extreme = null, count = 0;
  return {
    step(player) {
      if (!spaceFlightAt(player.x, player.z, player.y)) { direction = 0; extreme = player.y; return; }
      extreme ??= player.y;
      if (direction === 0) { if (player.y > extreme + .25) { direction = 1; extreme = player.y; } else if (player.y < extreme - .25) { direction = -1; extreme = player.y; } }
      else if (direction === 1) { if (player.y > extreme) extreme = player.y; else if (player.y < extreme - .25) { count++; direction = -1; extreme = player.y; } }
      else if (player.y < extreme) extreme = player.y; else if (player.y > extreme + .25) { count++; direction = 1; extreme = player.y; }
    },
    get count() { return count; },
  };
}

if (blocks.has('follow')) {
  const ends = {
    'main-stair': { up: { x: -15.1, y: 0, z: .6 }, down: { x: -16, y: -3.4, z: -9.2 } },
    'service-stair': { up: { x: 15.8, y: 0, z: 11 }, down: { x: 15.8, y: -3.4, z: .8 } },
  };
  const rows = [];
  for (const flight of SPACE.flights) for (const way of ['down', 'up']) {
    const start = way === 'down' ? ends[flight.id].up : ends[flight.id].down, finish = way === 'down' ? ends[flight.id].down : ends[flight.id].up;
    const path = way === 'down' ? [flight.upper, flight.lower, finish] : [flight.lower, flight.upper, finish];
    const behind = { x: start.x, y: start.y, z: start.z + Math.sign(start.z - path[0].z || 1) * 1.4 };
    const { sim, papa, bot, body, run } = room({ human: start, bot: behind });
    assert.equal(sim.canOccupy(papa, start.x, start.z, start.y, .25), true, `${way} ${flight.id} human start is free`);
    if (!sim.canOccupy(bot, behind.x, behind.z, behind.y, .32)) Object.assign(bot, { x: start.x + 1, z: start.z });
    body.setOrder({ kind: 'follow', playerId: papa.id });
    const counter = reversals();
    let leg = 0, time = 0, arrivedAt = null, after = null;
    run(35, {
      drive: () => {
        time += DT;
        if (time > 1 && leg < path.length) {
          const goal = path[leg], dx = goal.x - papa.x, dz = goal.z - papa.z;
          if (Math.hypot(dx, dz) < .3 && Math.abs(papa.y - goal.y) < .4) leg++;
          else sim.setInput(papa.id, { forward: 1, strafe: 0, yaw: Math.atan2(-dx, -dz), pitch: 0 });
          if (leg >= path.length) arrivedAt = time;
        } else sim.setInput(papa.id, { forward: 0, strafe: 0, yaw: papa.yaw ?? 0, pitch: 0 });
      },
      each: () => {
        counter.step(bot);
        if (arrivedAt !== null && after === null && time >= arrivedAt + 3) after = { gap: flat(bot, papa), rise: Math.abs(bot.y - papa.y), at: { x: bot.x, y: bot.y, z: bot.z } };
      },
    });
    const row = { case: `${way} ${flight.id}`, reversals: counter.count, arrivedAt, after, end: { gap: flat(bot, papa), rise: Math.abs(bot.y - papa.y) } };
    rows.push(row);
    assert.ok(arrivedAt !== null && Math.abs(papa.y - finish.y) < .1, `setup: Papa walked ${way} the ${flight.id} (${P(papa)})`);
    check(row.reversals <= 2, `follow ${row.case}: ${row.reversals} vertical reversals in 35 s (2 at most)`);
    check(after && after.rise < .5 && after.gap < 3.5, `follow ${row.case}: 3 s after Papa stopped, Max is ${after ? r2(after.gap) : '-'} m away with ${after ? r2(after.rise) : '-'} m height difference`);
    check(row.end.rise < .5 && row.end.gap < 3.5, `follow ${row.case}: after 35 s Max is ${r2(row.end.gap)} m away with ${r2(row.end.rise)} m height difference`);
  }
  verified.push(`follow ${rows.map(row => `${row.case} ${row.reversals} reversals, ${row.after ? `${r2(row.after.gap)} m` : '-'} from Papa 3 s after he stopped`).join('; ')}`);
}

function arm(sim, bot, weapons, { backpack = false } = {}) {
  if (backpack) bot.backpack = true;
  const keep = { x: bot.x, y: bot.y, z: bot.z };
  for (const weapon of weapons) {
    const rack = ARMORY.find(item => item.weapon === weapon);
    Object.assign(bot, { x: rack.x + Math.sin(rack.facing ?? 0) * .95, y: rack.y, z: rack.z + Math.cos(rack.facing ?? 0) * .95, interactAfter: 0 });
    assert.ok(sim.buyWeapon(bot.id, rack.id), `setup: ${weapon} bought`);
  }
  Object.assign(bot, keep, { interactAfter: 0, grounded: true, vy: 0 });
  if (weapons.length) sim.chooseWeapon(bot.id, weapons.at(-1));
  assert.ok(!weapons.length || activeWeaponId(bot) === weapons.at(-1), `setup: ${weapons.at(-1)} in hand`);
  bot.points = 50000;
}
const reviveCase = (label, down, from, weapons, { corner = null } = {}) => {
  const { sim, papa, bot, body, run } = room({ human: down, bot: from });
  arm(sim, bot, weapons, { backpack: weapons.length > 1 });
  sim.damagePlayer(papa, 1000, { id: 'probe' });
  assert.equal(papa.downed, true, 'setup: Papa is down');
  body.setOrder({ kind: 'revive', playerId: papa.id });
  let time = 0, near = 0;
  run(45, { until: () => !papa.downed || body.status !== 'running', each: () => { time += DT; if (corner && Math.abs(bot.y) < .3 && flat(bot, corner) < 1) near += DT; } });
  return { label, ok: papa.alive && !papa.downed, status: body.status, time, gap: flat(bot, papa), near, bleed: papa.bleedOutAt - sim.time };
};

if (blocks.has('head')) {
  const corner = { x: -13.66, y: 0, z: -1.1 };
  const row = reviveCase('revive Papa in the ticket booth from the refuge', target('caisse'), target('refuge'), ['flamethrower'], { corner });
  check(row.ok, `flamethrower: ${row.label} ${row.status} at ${r2(row.time)} s, ${r2(row.gap)} m short`);
  check(row.near <= 1, `flamethrower: ${row.label}: ${r2(row.near)} s within 1 m of the main stair head corner (1 s at most)`);
  verified.push(`flamethrower: ${row.label} ${row.ok ? `revived after ${r2(row.time)} s` : row.status}, ${r2(row.near)} s at the head corner`);
}

if (blocks.has('heavy')) {
  const heavy = ['shotgun', 'smg', 'minigun'], rows = [];
  for (const [down, from] of [['caisse', 'machines'], ['lots', 'miroirs'], ['arcade', 'tir']]) {
    const row = reviveCase(`revive Papa in the ${down} from the ${from}`, target(down), target(from), heavy);
    rows.push(`${row.label}: ${row.ok ? `revived after ${r2(row.time)} s` : `${row.status} at ${r2(row.time)} s ${r2(row.gap)} m short`}`);
    check(row.ok, `minigun: ${row.label} ${row.status} at ${r2(row.time)} s, ${r2(row.gap)} m short, ${r2(row.bleed)} s of bleed-out left`);
  }
  {
    const box = target('lots'), from = target('machines');
    const { sim, bot, body, run } = room({ bot: from });
    arm(sim, bot, heavy, { backpack: true });
    for (const stock of Object.values(bot.inventory)) stock.reserve = 0;
    const id = `pa${sim.nextPickupId++}`;
    sim.pickups.set(id, { id, kind: 'ammo', x: box.x, y: box.y, z: box.z, amount: 1, special: false, expiresAt: Infinity });
    body.setOrder({ kind: 'collect', pickupId: id });
    let time = 0;
    run(40, { until: () => body.status !== 'running', each: () => { time += DT; } });
    rows.push(`collect ammo in the lots from the machines: ${body.status} after ${r2(time)} s`);
    check(body.status === 'done' && !sim.pickups.has(id), `minigun: collect in the lots from the machines ${body.status} at ${r2(time)} s, ${r2(flat(bot, box))} m short`);
  }
  {
    const rack = ARMORY.find(item => item.id === 'sniper');
    const { sim, bot, body, run } = room({ bot: target('caisse') });
    arm(sim, bot, heavy, { backpack: true });
    body.setOrder({ kind: 'buy', rackId: rack.id });
    let time = 0;
    run(45, { until: () => body.status !== 'running', each: () => { time += DT; } });
    rows.push(`buy the sniper from the ticket booth: ${body.status} after ${r2(time)} s`);
    check(body.status === 'done' && Object.hasOwn(bot.inventory, 'sniper'), `minigun: buy the sniper from the ticket booth ${body.status} at ${r2(time)} s, ${r2(flat(bot, rack))} m short`);
  }
  verified.push(`minigun+shotgun+SMG+backpack: ${rows.join('; ')}`);
}

if (blocks.has('loft')) {
  const own = SPACE.flights.reduce((best, item) => !best || flat(item.lower, LOFT_POST) < flat(best.lower, LOFT_POST) ? item : best, null);
  const other = SPACE.flights.find(item => item !== own);
  assert.equal(own.id, 'main-stair', 'setup: LOFT_POST watches the main stair');
  const rows = [];
  for (const [name, start] of [['foot', other.lower], ['head', other.upper]]) {
    const { sim, papa, bot, body, events, run } = room({ human: { x: 0, y: 0, z: 12 }, bot: { ...LOFT_POST } });
    Object.assign(papa, { hp: 1e6, maxHp: 1e6, waiting: true });
    body.setOrder({ kind: 'loft' });
    run(2);
    const enemy = walker(sim, start, { entered: true, speed: 1.32, hp: 120, maxHp: 120 });
    const hp = bot.hp;
    let firstSeen = null, firstShot = null, killedAt = null, time = 0;
    run(40, {
      each: () => {
        time += DT;
        const gap = Math.hypot(enemy.x - bot.x, (enemy.y ?? 0) - bot.y, enemy.z - bot.z);
        if (firstSeen === null && enemy.hp > 0 && sim.raiderLineClear({ x: bot.x, y: bot.y + playerEyeHeight(bot), z: bot.z }, { x: enemy.x, y: (enemy.y ?? 0) + 1.2, z: enemy.z })) firstSeen = gap;
        if (firstShot === null && shots(events, bot) && enemy.hp > 0) firstShot = gap;
      },
      until: () => (killedAt = !(enemy.hp > 0) || !sim.zombies.has(enemy.id) ? time : null) !== null,
    });
    rows.push({ name, firstSeen, firstShot, killedAt, lost: hp - bot.hp });
    check(firstSeen !== null && firstSeen >= 6, `loft ${P(LOFT_POST)}: walker from the ${other.id} ${name} seen at ${firstSeen === null ? 'never' : `${r2(firstSeen)} m`}`);
    check(firstShot !== null && firstShot >= 5, `loft ${P(LOFT_POST)}: walker from the ${other.id} ${name} first shot at ${firstShot === null ? 'never' : `${r2(firstShot)} m`}`);
    check(killedAt !== null && hp - bot.hp === 0, `loft ${P(LOFT_POST)}: walker from the ${other.id} ${name} ${killedAt === null ? 'not killed within 40 s' : `killed after ${r2(killedAt)} s`}, ${r2(hp - bot.hp)} HP lost`);
  }
  verified.push(`loft post ${P(LOFT_POST)}: ${rows.map(row => `walker from ${other.id} ${row.name} seen ${row.firstSeen === null ? 'never' : r2(row.firstSeen)}, shot ${row.firstShot === null ? 'never' : r2(row.firstShot)}`).join('; ')}`);
}

for (const line of verified) console.log(line);
assert.deepEqual(failures, [], `funfair companion orders:\n  ${failures.join('\n  ')}`);
console.log(`funfair companion orders verified: ${[...blocks].join(', ')}; real simulation and bodies, no brain/API/server`);
