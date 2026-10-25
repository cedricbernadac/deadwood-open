import assert from 'node:assert/strict';
// Hospital companions on the legacy 'loft' order and their eyes: the two
// basement posts watch up the main and the service stair (SPACE.refuge sees
// neither), two bots take one post each, door and threat labels respect
// floors (the basement extends under all four doors), the texts name the
// stair-foot posts, never "loft", and (6) they give walked metres to the
// other floor, the rooms, the doors, the rain under the canopies and the
// coin piles' walk round the walls. Real simulation, no server, no model API.
// Run with DEADWOOD_LEVEL=hospital (test/hospital-level.test.mjs).
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody, LOFT_POST, LOFT_POST_EXTERIOR } from '../../companions/body.mjs';
import { describeSituation } from '../../companions/situation.mjs';
import { describeTeamPlan, normalizeTeamPlan, teamIntent } from '../../companions/team-plan.mjs';
import { routeLength } from '../../companions/routes.mjs';
import { coinSweep } from '../../companions/coins.mjs';
import { rainCost } from '../../companions/outdoors.mjs';
import { GUIDE, TACTICAL_GUIDE } from '../../companion-brain/guide.mjs';
import { IS_HOSPITAL } from '../../public/level-config.js';
import { SPACE, spaceTreadY, spaceFlightAt } from '../../public/level-space.js';
import { seededRandom } from '../../validation/balance-report.mjs';
import { SUPPLY_BONUSES } from '../../public/weapon-upgrades.js';
import { rollCompanionProfile } from '../../companions/profiles.mjs';

assert.equal(IS_HOSPITAL, true, 'run with DEADWOOD_LEVEL=hospital');
const DT = 1 / 30, flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const verified = [];
const flights = Object.fromEntries(SPACE.flights.map(f => [f.id, f]));

function room(code, { bots = ['Max'], humans = ['Papa'], seed = 7 } = {}) {
  const events = [], sim = new RoomSimulation(code, { random: seededRandom(seed), raids: false, onEvent: e => events.push(e) });
  const people = {};
  humans.forEach((name, i) => { people[name] = sim.addPlayer(`h${i}`, name); });
  bots.forEach((name, i) => {
    const p = sim.addPlayer(`ia${i}`, name, undefined, { companion: true });
    p.companionSlot = i; people[name] = p;
  });
  sim.companionOrders = new Map();
  sim.start('h0');
  Object.assign(sim, { phase: 'wave', wave: 6, toSpawn: 1, spawnTimer: 1e9 });
  sim.zombies.clear();
  const bodies = {};
  for (const name of bots) bodies[name] = createCompanionBody(sim, people[name].id, { random: seededRandom(88) });
  const place = (name, x, y, z) => Object.assign(people[name], { x, y, z, grounded: true, vy: 0 });
  const zombie = (x, y, z, extra = {}) => {
    const enemy = sim.spawnZombie();
    Object.assign(enemy, { kind: 'walker', x, y, z, entered: true, speed: 0, attackAfter: Infinity, ...extra });
    return enemy;
  };
  const run = (seconds, until = () => false, each = null) => {
    for (let tick = 0; tick < seconds * 30; tick++) {
      const before = events.length;
      for (const p of sim.players.values()) if (!p.companion) sim.setInput(p.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 });
      for (const name of bots) bodies[name].tick(DT);
      sim.spawnTimer = 1e9; sim.tick(DT);
      each?.(events.slice(before));
      if (until()) return true;
    }
    return false;
  };
  return { sim, people, bodies, events, place, zombie, run };
}

// How much of a flight a spot sees (chest of a walker on the tread centre
// line), as the supermarket fixture measures it; and the stair head.
function share(sim, from, f) {
  let seen = 0, n = 0;
  for (let i = 0; i <= 20; i++) {
    const z = f.minZ + (f.maxZ - f.minZ) * i / 20; n++;
    if (sim.raiderLineClear({ x: from.x, y: from.y + 1.55, z: from.z }, { x: (f.minX + f.maxX) / 2, y: spaceTreadY(f, z) + 1.2, z })) seen++;
  }
  return seen / n;
}
const seesHead = (sim, from, f) => sim.raiderLineClear({ x: from.x, y: from.y + 1.55, z: from.z }, { ...f.upper, y: f.upper.y + 1.2 });

// ---- 0. The loft posts watch up both stairs; SPACE.refuge stays blind ------
{
  const { sim, people } = room('HGEO');
  const main = flights['main-stair'], service = flights['service-stair'];
  assert.ok(share(sim, SPACE.refuge, main) < 0.2 && share(sim, SPACE.refuge, service) < 0.2, 'the legacy refuge stays blind to both flights');
  assert.deepEqual({ ...SPACE.refuge }, { x: 0, y: -3.4, z: -6 }, 'SPACE.refuge unchanged');
  for (const [post, own, other] of [[LOFT_POST, main, service], [LOFT_POST_EXTERIOR, service, main]]) {
    assert.equal(post.y, SPACE.minY, 'a basement post');
    assert.ok(!spaceFlightAt(post.x, post.z, post.y, .25), 'off the flight band');
    assert.ok(sim.canOccupy(people.Max, post.x, post.z, post.y, .32), `free floor at ${JSON.stringify(post)}`);
    assert.ok(share(sim, post, own) >= 0.9, `${JSON.stringify(post)} sees the whole ${own.id}`);
    assert.ok(seesHead(sim, post, own), `${JSON.stringify(post)} sees the ${own.id} head`);
    assert.ok(share(sim, post, other) <= 0.1, `${JSON.stringify(post)} does not double-cover the ${other.id}`);
  }
  verified.push({ check: 'Post geometry: main and service stair foot posts each see their whole flight and its head', pass: true });
}

// ---- 0b. Two bots on 'loft' take one post each -----------------------------
{
  const { sim, people, bodies, place, run } = room('HPOST2', { bots: ['Max', 'Léa'] });
  place('Papa', 0, 0, 0);
  place('Max', -10, -3.4, -2); place('Léa', 8, -3.4, 1);
  for (const name of ['Max', 'Léa']) {
    sim.companionOrders.set(people[name].id, { kind: 'loft' });
    bodies[name].setOrder({ kind: 'loft' });
  }
  assert.ok(run(20, () => flat(people.Max, LOFT_POST) < 0.45 && flat(people.Léa, LOFT_POST_EXTERIOR) < 0.45),
    `each bot takes its own post: ${JSON.stringify({ Max: [people.Max.x, people.Max.y, people.Max.z], Léa: [people.Léa.x, people.Léa.y, people.Léa.z] })}`);
  verified.push({ check: 'First loft bot holds the main stair foot, the second the service stair foot', pass: true });
}

for (const state of ['downed', 'eliminated']) {
  const { sim, people, bodies, place, run } = room(`HFAIL-${state}`, { bots: ['Max', 'Léa'] });
  place('Papa', 0, 0, 0);
  place('Max', -10, -3.4, -2); place('Léa', LOFT_POST_EXTERIOR.x, LOFT_POST_EXTERIOR.y, LOFT_POST_EXTERIOR.z);
  for (const name of ['Max', 'Léa']) {
    sim.companionOrders.set(people[name].id, { kind: 'loft' });
    bodies[name].setOrder({ kind: 'loft' });
  }
  if (state === 'downed') sim.damagePlayer(people.Max, 1000, { id: 'test' });
  else Object.assign(people.Max, { hp: 0, alive: false, downed: true });
  const reached = run(20, () => flat(people.Léa, LOFT_POST) < .45);
  console.log(JSON.stringify({ hospitalLoftFailover: state, reached, distanceToMain: +flat(people.Léa, LOFT_POST).toFixed(2) }));
  assert.ok(reached, `${state} first bot must release the main-stair watch`);
  verified.push({ check: `${state} first loft bot releases the main-stair watch`, pass: true });
}

// ---- 0c. A walker coming down the main stair is first shot far away --------
{
  const { people, bodies, place, zombie, run } = room('HPOST1');
  place('Papa', -10, -3.4, -12); // basement: the walker comes down to him
  place('Max', LOFT_POST.x, LOFT_POST.y, LOFT_POST.z);
  bodies.Max.setOrder({ kind: 'loft' });
  run(2);
  assert.ok(flat(people.Max, LOFT_POST) < 0.45, 'holds the main stair foot post');
  const main = flights['main-stair'], head = { x: (main.minX + main.maxX) / 2, z: main.maxZ - .4 };
  const walker = zombie(head.x, spaceTreadY(main, head.z), head.z, { hp: 500, speed: 1.1 });
  let firstShotAt = null;
  run(12, () => !(walker.hp > 0) || walker.y <= -3.3, batch => {
    if (firstShotAt === null && batch.some(e => e.event === 'shot' && e.id === people.Max.id)) firstShotAt = flat(people.Max, walker);
  });
  assert.ok(firstShotAt !== null, 'the post fires at the walker coming down the main stair');
  assert.ok(firstShotAt >= 5, `first shot at ${firstShotAt?.toFixed(1)} m`);
  verified.push({ check: 'Walker descending the main stair is first shot at >= 5 m', pass: true, firstShotAt: +firstShotAt.toFixed(1) });
}

// ---- 1. A basement zombie under a door is under it, not by it -------------
{
  const { sim, people, place, zombie } = room('HLBL1');
  place('Papa', 0, 0, 0);
  place('Max', -2, -3.4, -10.6);
  const north = sim.doors.find(door => door.id === 'north');
  const under = zombie(north.x + 1, -3.4, north.z + 1.4); // basement, flat-near the north door, one floor below it
  const view = describeSituation(sim, people.Max.id);
  const northLine = view.text.split('\n').find(l => l.startsWith('- north door,'));
  assert.ok(northLine, 'north door line');
  assert.match(northLine, /1 in the basement under it/, northLine);
  assert.doesNotMatch(northLine, /already inside/, northLine);
  const enemyLine = view.text.split('\n').find(l => l.includes(under.id));
  assert.match(enemyLine, /INSIDE \(basement passage, under the north door\)/, enemyLine);
  verified.push({ check: 'Basement zombie under a door: "under the north door", not "already inside by it"', pass: true });
}

// ---- 2. A basement zombie hunting a human one floor up is not after them ---
{
  const { sim, people, place, zombie } = room('HLBL2', { humans: ['Papa', 'Jules'] });
  // Both corridors (ground and basement) since the rooms have walls: Max must
  // see the hunter to describe it.
  place('Papa', -8, 0, -6); place('Jules', 6, 0, 2);
  place('Max', -9, -3.4, 0); // far enough that the hunter's target rule picks Jules
  const hunter = zombie(6, -3.4, 1); // basement, 1 m flat under Jules, one floor below
  const view = describeSituation(sim, people.Max.id);
  const julesLine = view.text.split('\n').find(l => l.startsWith('- Jules'));
  assert.ok(julesLine, 'Jules line');
  assert.doesNotMatch(julesLine, /after them/, julesLine);
  const enemyLine = view.text.split('\n').find(l => l.includes(hunter.id));
  assert.match(enemyLine, /going for Jules/, enemyLine);
  verified.push({ check: 'Zombie a floor below a human is not "after them"', pass: true });
}

// ---- 3. The team intent says the loft post in player words ----------------
{
  const { sim, people, place } = room('HPLAN', { bots: ['Max', 'Léa'] });
  place('Papa', -3, 0, 0); place('Max', 0, -3.4, -6); place('Léa', -2, 0, 2);
  Object.assign(sim, { phase: 'intermission', timeLeft: 1e9 });
  const request = describeTeamPlan(sim);
  const postQuestion = request.questions.find(q => q.name === 'bot0_post');
  const described = Object.fromEntries(postQuestion.choices.map(c => [c.value, c.description]));
  assert.match(described.loft, /main and service stairs/, described.loft);
  const choices = Object.fromEntries(request.questions.map(q => [q.name, q.choices[0].value]));
  sim.companionTeamPlan = normalizeTeamPlan(sim, request, { choices: { ...choices, bot0_post: 'loft', bot1_post: 'west' } });
  assert.ok(sim.companionTeamPlan, 'a validated plan');
  const intent = teamIntent(sim, people.Max.id);
  assert.match(intent, /preferred post basement stair-foot post/, intent);
  assert.doesNotMatch(intent, /preferred post loft/, intent);
  const other = teamIntent(sim, people.Léa.id);
  assert.match(other, /Max: [^;]*, basement stair-foot post,/, other);
  assert.match(request.situation, /The loft choice means the basement posts watching up the main and service stairs/, 'team plan REFUGE line');
  verified.push({ check: 'Team intent names the basement stair-foot post, never "loft"', pass: true });
}

// ---- 4. The loft action and the place names name the stair-foot posts -----
{
  const { sim, people, place } = room('HTEXT');
  place('Papa', 0, 0, 0);
  const at = spot => { Object.assign(people.Max, spot); return describeSituation(sim, people.Max.id); };
  const you = view => view.text.split('\n').find(l => l.startsWith('YOU:'));
  assert.match(you(at(LOFT_POST)), /basement post at the main stair foot/);
  assert.match(you(at(LOFT_POST_EXTERIOR)), /basement post at the service stair foot/);
  const loft = at({ x: 0, y: 0, z: 0 }).actions.find(action => action.value === 'loft');
  assert.ok(loft, 'a loft action');
  // The post the body takes (loftRank), as on the supermarket: one post only.
  assert.match(loft.description, /^Hold the basement post at the main stair foot \(.+\), watching up that flight\.$/, loft.description);
  assert.doesNotMatch(loft.description, /service|refuge|loft/i, loft.description);
  // A complete line within the 170-character cap, unarmed from the far
  // corners too (review of 24 October: it lost its end in every case).
  for (const armed of [true, false]) {
    if (!armed) for (const stock of Object.values(people.Max.inventory)) if (stock && typeof stock === 'object') { stock.ammo = 0; stock.reserve = 0; }
    for (const spot of [{ x: 0, y: 0, z: 0 }, { x: -19, y: 0, z: -14 }, { x: 19, y: 0, z: 14 }, { x: 19, y: -3.4, z: -13 }]) {
      const line = at(spot).actions.find(action => action.value === 'loft').description;
      assert.ok(line.endsWith('watching up that flight.') && line.length < 170, line);
    }
  }
  verified.push({ check: 'Loft action and YOU line name the main and service stair-foot posts', pass: true });
}

// ---- 5. Place names follow the walled rooms, corridors and halls ----------
// The first draft named zones by coordinates: the service stair hall was the
// "chapel", the corridor spine the "waiting room" or the "emergency
// department", the main stair foot hall the "basement pharmacy store".
{
  const { sim, people, place } = room('HROOMS');
  place('Papa', 0, 0, 0);
  const named = spot => {
    Object.assign(people.Max, spot);
    return describeSituation(sim, people.Max.id).text.split('\n').find(l => l.startsWith('YOU:')).split(';')[0].replace(/^YOU: Max \(AI teammate\), /, '');
  };
  const rooms = { reception: 'reception and waiting room', ward: "ward and nurses' station", theatre: 'operating theatre',
    emergency: 'emergency department and triage bays', chapel: 'chapel', pharmacy: 'basement pharmacy store',
    archives: 'basement archives', linen: 'basement linen room', boiler: 'basement boiler room' };
  assert.deepEqual(SPACE.rooms.map(item => item.id).sort(), Object.keys(rooms).sort(), 'one name per real room');
  for (const item of SPACE.rooms) {
    assert.equal(named(item.target), rooms[item.id], `${item.id} target ${JSON.stringify(item.target)}`);
    // Every corner of the room, 0.4 m inside its walls, carries its name too.
    for (const x of [item.bounds.minX + .4, item.bounds.maxX - .4]) for (const z of [item.bounds.minZ + .4, item.bounds.maxZ - .4]) {
      const spot = { x, y: item.target.y, z };
      if (sim.doors.some(door => flat(door, spot) <= 3) && item.floor === 'ground' || spaceFlightAt(x, z, spot.y)) continue;
      if (flat(spot, LOFT_POST) <= 2.5 || flat(spot, LOFT_POST_EXTERIOR) <= 2) continue;
      assert.equal(named(spot), rooms[item.id], `${item.id} corner ${JSON.stringify(spot)}`);
    }
  }
  const between = [
    [{ x: -10, y: 0, z: 0 }, 'emergency department and triage bays'], [{ x: -10, y: 0, z: 3.5 }, 'emergency department and triage bays'],
    [{ x: 12, y: 0, z: -2 }, 'central hospital corridor'], [{ x: 0, y: 0, z: -9 }, 'entrance hall'],
    [{ x: 0, y: 0, z: 9 }, 'south hall'], [{ x: 15, y: 0, z: 13 }, 'service stair hall'],
    [{ x: -10, y: -3.4, z: 0 }, 'sheltered basement corridor'], [{ x: 0, y: -3.4, z: -5 }, 'sheltered hospital basement refuge'],
    [{ x: -16, y: -3.4, z: -8 }, 'basement hall at the main stair foot'], [{ x: -1.5, y: -3.4, z: -10.5 }, 'basement refuge passage'],
    [{ x: 0, y: -3.4, z: 8 }, 'basement south passage'], [{ x: 18, y: -3.4, z: 6 }, 'basement hall at the service stair foot'],
  ];
  for (const [spot, name] of between) assert.equal(named(spot), name, JSON.stringify(spot));
  verified.push({ check: 'Place names: every room target and corner, the corridor spine, the halls and the basement passages', pass: true, rooms: SPACE.rooms.length, between: between.length });
}

// ---- 6. What the brain reads (hospital lot 2) ------------------------------
// Each check fails on the texts of 24 October (6b07331): straight metres to
// the other floor, both loft posts in one cut line, floor ids for places,
// bare door ids, the cabin's single-file stairs, rain under the canopies and
// coin piles behind a wall.
const lot2 = (check, run) => { const facts = run(); verified.push({ check, pass: true, ...facts }); };
const enemyLines = view => view.text.split('\n').filter(l => /^- z\d+ /.test(l));
const coins = (sim, x, y, z) => {
  const id = `pc${sim.nextPickupId++}`;
  sim.pickups.set(id, { id, kind: 'points', x, y, z, amount: 120, special: false, expiresAt: sim.time + 120 });
  return id;
};
const offered = (sim, player, id) => Boolean(coinSweep(sim, player)?.piles.some(item => item.pickup.id === id));

// (a) Cross-floor distances are walked metres by the named staircase.
lot2('Distances to the other floor are walked metres via the stairs (revive line, 70 room pairs, zombie goals and threat order)', () => {
  const { sim, people, place, zombie } = room('HDIST', { humans: ['Papa', 'Jules'], bots: ['Max', 'Léa'] });
  place('Papa', -8, 0, .7); place('Jules', 0, -3.4, -7); place('Max', 0, 0, -10); place('Léa', -6, -3.4, 1.2);
  sim.damagePlayer(people.Jules, 1000, { id: 'test' });
  const revive = name => describeSituation(sim, people[name].id).actions.find(a => a.value === `revive:${people.Jules.id}`).description;
  // Max stands in the entrance hall 3 m over the refuge passage: 42 m on foot
  // (was '3.0 m S (below you)'); Léa, on Jules's floor, keeps her 10 m.
  const said = Number(revive('Max').match(/; (\d+) m via the main stairs \(below you\)\.$/)?.[1]);
  assert.ok(said >= 35, revive('Max'));
  assert.match(revive('Léa'), /; 10 m NE\.$/, revive('Léa'));
  // Every cross-floor pair of 12 named spots: what the TEAM line says is the
  // route's length (was a median 2.27x and up to 54x below it).
  const spots = [[0, 0, -10], [-12, 0, -8], [7, 0, -11], [16, 0, -10], [-12, 0, 10], [7, 0, 9], [-1, 0, 10],
    [0, -3.4, -7], [-8, -3.4, -8], [10, -3.4, -8], [-12, -3.4, 8], [7, -3.4, 9]].map(([x, y, z]) => ({ x, y, z }));
  const pair = room('HPAIRS');
  let pairs = 0, worst = 1;
  for (const a of spots) for (const b of spots) {
    if (Math.abs(a.y - b.y) < 1) continue;
    pair.place('Max', a.x, a.y, a.z); pair.place('Papa', b.x, b.y, b.z);
    const line = describeSituation(pair.sim, pair.people.Max.id).text.split('\n').find(l => l.startsWith('- Papa'));
    const metres = Number(line.match(/, (\d+(?:\.\d)?) m via the (?:main|service) stairs/)?.[1]), walk = routeLength(a, b);
    const ratio = Math.max(metres / walk, walk / metres);
    assert.ok(ratio <= 1.5, `${JSON.stringify(a)} -> ${JSON.stringify(b)}: ${line} (route ${walk.toFixed(1)} m)`);
    pairs++; worst = Math.max(worst, ratio);
  }
  assert.equal(pairs, 70, 'cross-floor pairs');
  // A zombie under Jules's feet in the basement is 30 m from him, not 1 m,
  // and a zombie 2 m from Papa on his own floor is the more urgent.
  const goal = room('HGOAL', { humans: ['Papa', 'Jules'] });
  goal.place('Max', -12, -3.4, 0); goal.place('Papa', -6, -3.4, 1); goal.place('Jules', 6, 0, 1);
  const under = goal.zombie(6, -3.4, 0), byPapa = goal.zombie(-4, -3.4, 0);
  const lines = enemyLines(describeSituation(goal.sim, goal.people.Max.id));
  assert.deepEqual(lines.map(l => l.split(' ')[1]), [byPapa.id, under.id], lines.join('\n'));
  const gap = Number(lines[1].match(/going for Jules \((\d+) m from them\)/)?.[1]);
  assert.ok(Math.max(gap / routeLength(under, goal.people.Jules), routeLength(under, goal.people.Jules) / gap) <= 1.5 && gap >= 20, lines[1]);
  return { maxRevive: said, pairs, worstRatio: +worst.toFixed(2), underGap: gap };
});

// (b) The loft action names the post the body takes, whole, from every room.
lot2('Loft action names only the post loftRank gives, under 170 characters from every room target', () => {
  const { sim, people, place } = room('HLOFT2', { bots: ['Max', 'Léa'] });
  place('Papa', -8, 0, .7); place('Max', 0, 0, .7); place('Léa', 2, 0, .7);
  const actions = name => describeSituation(sim, people[name].id).actions;
  const loftOf = name => actions(name).find(a => a.value === 'loft').description;
  assert.match(loftOf('Max'), /main stair foot/, loftOf('Max'));
  assert.doesNotMatch(loftOf('Max'), /service stair foot/, loftOf('Max'));
  sim.companionOrders.set(people.Max.id, { kind: 'loft' });
  assert.match(loftOf('Léa'), /^Hold the second basement post, at the service stair foot \(.+\), watching up it\.$/, loftOf('Léa'));
  assert.doesNotMatch(loftOf('Léa'), /main stair foot/, loftOf('Léa'));
  let longest = 0;
  for (const armed of [true, false]) {
    if (!armed) for (const name of ['Max', 'Léa']) for (const stock of Object.values(people[name].inventory)) if (stock && typeof stock === 'object') { stock.ammo = 0; stock.reserve = 0; }
    for (const item of SPACE.rooms) for (const name of ['Max', 'Léa']) {
      place(name, item.target.x, item.target.y, item.target.z);
      for (const action of actions(name)) {
        assert.ok(action.description.length < 170, `${name} in the ${item.id}: ${action.value} cut: ${action.description}`);
        longest = Math.max(longest, action.description.length);
      }
    }
  }
  return { longest };
});

// (c) Enemy places in player words: rooms, the basement, each flight.
lot2('Enemy places name the hospital room, the basement and each flight; no hospital text says cellar', () => {
  const cases = [
    { max: [6, 0, 7], zombies: [[9, 0, 12]], expect: [/INSIDE \(chapel\)/] },
    { max: [0, -3.4, -6], zombies: [[0, -3.4, -12.6], [.5, -3.4, -1]], expect: [/INSIDE \(basement[^)]*, under the north door\)/] },
    { max: [13, -3.4, 0], zombies: [[14.7, -1.53, 7.5]], expect: [/INSIDE \(on the service stairs\)/, /^STAIRS: main: 0, service: 1 visible zombies on the flights;/m] },
    { max: [4, 0, -8], zombies: [[8, 0, -12]], expect: [/INSIDE \(ward\)/] },
  ];
  for (const item of cases) {
    const { sim, people, place, zombie } = room('HNAMES');
    place('Papa', -8, 0, .7); place('Max', ...item.max);
    people.Max.bonus = { ...(people.Max.bonus ?? {}), radar: 8 }; // recon names the floor
    for (const at of item.zombies) zombie(...at);
    const view = describeSituation(sim, people.Max.id), all = [view.text, ...view.actions.map(a => a.description)].join('\n');
    for (const pattern of item.expect) assert.match(all, pattern, all);
    assert.doesNotMatch(all, /cellar|INSIDE \((?:ground|stairs)/, all);
    assert.match(view.text, /^RECON N8.* walker (?:basement|ground|stairs) /m, view.text);
  }
  return { cases: cases.length };
});

// (d) The plan's door posts say what each door is, and the plan situation
// stays whole: its 16000-character cut has under 100 characters to spare in a
// loaded four-survivor hospital game, so the DOORS line keeps bare ids (door
// words there cut PREVIOUS INTENTIONS, which the cabin's budget tests forbid).
lot2('Team plan door posts describe the hospital doors; a loaded four-survivor plan keeps its previous intentions', () => {
  const { sim } = room('HPOSTS');
  for (const door of sim.doors) { door.sealed = false; door.sealPending = false; }
  Object.assign(sim, { phase: 'intermission', timeLeft: 1e9 });
  const request = describeTeamPlan(sim);
  const described = Object.fromEntries(request.questions.find(q => q.name === 'bot0_post').choices.map(c => [c.value, c.description]));
  for (const id of ['north', 'west', 'east', 'south']) assert.notEqual(described[id], id, `${id}: ${described[id]}`);
  assert.match(described.north, /^main entrance, entrance hall/, described.north);
  assert.match(described.west, /^ambulance door.*the crate is outside it$/, described.west);
  // The third pass opens the ambulance door straight into the emergency
  // department (its bounds now reach the old corridor's west end): the post
  // words name the room a bot reads 4.5 m inside that doorway.
  assert.match(described.west, /emergency department/, described.west);
  {
    const west = sim.doors.find(door => door.id === 'west'), bot = [...sim.players.values()].find(player => player.companion);
    Object.assign(bot, { x: west.x - west.outX * 4.5, y: 0, z: west.z - west.outZ * 4.5, grounded: true });
    const you = describeSituation(sim, bot.id).text.split('\n').find(line => line.startsWith('YOU:'));
    assert.match(you, /emergency department and triage bays/, you);
  }
  const doors = JSON.parse(request.situation.split('\n').find(l => l.startsWith('DOORS ')).slice(6));
  assert.deepEqual(doors.map(door => door.id).sort(), ['east', 'north', 'south', 'west']);
  // The cabin's loaded budget set-up (companions-crate-priority and
  // companions-profile-context) on the hospital: 1 human and 3 bots with
  // 24-character names (the join cap), four guns each, backpacks, profiles,
  // every door open, the wave-2 crate active, at three bonus levels.
  let longest = 0;
  for (const level of [0, 3, 8]) {
    const budget = new RoomSimulation('HBUDGET', { random: () => .5 });
    const humanId = budget.addPlayer('h0', 'Jules le grand survivant').id;
    ['Max le vétéran des grands bois', 'Léa la protectrice du camp', 'Sam le prudent du hameau'].forEach((name, index) => budget.addPlayer(`ia${index}`, name, undefined, { companion: true }));
    budget.start(humanId);
    Object.assign(budget, { phase: 'intermission', wave: 2, timeLeft: 1000, toSpawn: 1, spawnTimer: 1e9 });
    budget.zombies.clear(); budget.spawnWarnings.clear(); budget.beginSupplyWave();
    for (const door of budget.doors) { door.sealed = false; door.sealPending = false; }
    budget.doors.find(door => door.id === 'west').boards = [0, 0, 60, 60, 60];
    for (const [index, player] of [...budget.players.values()].entries()) {
      assert.equal(player.name.length, 24, player.name);
      Object.assign(player, { alive: true, waiting: false, hp: 100, x: -3 + index, y: 0, z: 1, backpack: true,
        bonus: Object.fromEntries(Object.keys(SUPPLY_BONUSES).map(kind => [kind, level])),
        inventory: Object.fromEntries(['pistol', 'smg', 'shotgun', 'assault'].map(id => [id, { ammo: 10, reserve: 24 }])) });
      if (player.companion) player.companionProfile = rollCompanionProfile(['veteran', 'protector', 'timid'][index - 1], () => .75);
    }
    const first = describeTeamPlan(budget), choices = Object.fromEntries(first.questions.map(q => [q.name, q.choices[0].value]));
    budget.companionTeamPlan = normalizeTeamPlan(budget, first, { choices: { ...choices, bot0_bonus: 'vitamins', bot0_post: 'west' } });
    const plan = describeTeamPlan(budget);
    assert.ok(plan.situation.length < 16000, `bonus level ${level}: ${plan.situation.length} characters`);
    assert.match(plan.situation, /PREVIOUS INTENTIONS .*\]$/, `bonus level ${level}: ...${plan.situation.slice(-160)}`);
    // The crate route is in the text (at level 8 every bonus is maxed: no claim).
    const crate = JSON.parse(plan.situation.split('\n').find(l => l.startsWith('CRATE ')).slice(6));
    assert.equal(crate.active, true);
    if (level < 8) assert.deepEqual([crate.via, crate.ready?.length], ['west', 4], JSON.stringify(crate));
    longest = Math.max(longest, plan.situation.length);
  }
  return { doors: doors.length, longestPlanSituation: longest };
});

// (e) Rain under the entrance and ambulance-bay canopies is dry.
lot2('Trip rain leaves out the canopy metres: crate ~5 s through the west door, doorstep coins under the canopy', () => {
  const { sim, people, place } = room('HRAIN');
  sim.wave = 4; sim.beginSupplyWave();
  for (const door of sim.doors) { door.sealed = false; door.sealPending = false; door.boards.fill(0); }
  place('Papa', -8, 0, .7); place('Max', -17, 0, 0);
  const claim = describeSituation(sim, people.Max.id).actions.find(a => a.value.startsWith('claim:'))?.description;
  assert.match(claim ?? '', /: out west, ~5s rain;/, claim); // was ~6s
  const door = id => sim.doors.find(item => item.id === id);
  people.Max.umbrella.remaining = 0;
  const north = rainCost(sim, people.Max, 1.5, { door: door('north') }), south = rainCost(sim, people.Max, 1.5, { door: door('south') });
  assert.deepEqual([north.seconds, north.burn], [0, 0], JSON.stringify(north));
  assert.ok(south.seconds > 0 && south.burn > 0, `no canopy over the south door: ${JSON.stringify(south)}`);
  place('Max', 0, 0, -12.5);
  assert.ok(offered(sim, people.Max, coins(sim, 0, 0, -16.5)), 'a pile 1.5 m out of the north door, empty umbrella');
  place('Max', 0, 0, 12.5);
  assert.ok(!offered(sim, people.Max, coins(sim, 0, 0, 16.5)), 'a pile 1.5 m out of the south door stays refused with an empty umbrella');
  // An ammo box under the entrance canopy, the pistol's spare ammo gone: a
  // dry trip, said so (was 'about 2 s in the rain, under your umbrella').
  place('Max', 0, 0, -12.5);
  for (const stock of Object.values(people.Max.inventory)) if (stock && typeof stock === 'object') stock.reserve = 0;
  const box = `pa${sim.nextPickupId++}`;
  sim.pickups.set(box, { id: box, kind: 'ammo', x: 0, y: 0, z: -16.5, special: false, expiresAt: sim.time + 60 });
  const collect = describeSituation(sim, people.Max.id).actions.find(a => a.value === `collect:${box}`)?.description;
  assert.match(collect ?? '', /past the broken north door \(low on ammo\): dry under the door canopy\.$/, collect);
  return { claim: claim.match(/~\d+s rain/)[0] };
});

// (f) Coin piles are priced on the walk round the partitions: one 2.6 m away
// through a wall but a 20 m walk is not offered as 'within 3 m'; one through
// a doorway is offered at its walk round; one behind furniture still is.
lot2('Coin piles are priced on the walk round the partitions: not through a wall, yes through a doorway or past furniture', () => {
  const { sim, people, place } = room('HCOINS');
  const pile = (sweep, id) => sweep?.piles.find(item => item.pickup.id === id);
  place('Papa', -18, 0, 13.5); place('Max', 9.6, 0, -10.5); // the ward, by its east partition
  const behind = coins(sim, 12.2, 0, -10.5); // the operating theatre, 2.6 m away through the wall
  assert.ok(!offered(sim, people.Max, behind), 'the theatre pile');
  assert.equal(describeSituation(sim, people.Max.id).actions.find(a => a.value === 'coins'), undefined, 'no coins action for it');
  const seen = coins(sim, 7.6, 0, -10.5);
  assert.ok(offered(sim, people.Max, seen), 'a pile in sight in the ward');
  sim.pickups.delete(seen);
  // From the corridor, a ward pile past the ward's south partition: 5.2 m
  // straight, 5.7 m by its doorway at x 9.55 (a knee-height line rule
  // dropped it; main's bodies collected such piles).
  place('Max', 9.55, 0, -.5);
  const ward = { x: 7, y: 0, z: -5 }, round = 2.3 + Math.hypot(2.55, 2.2);
  assert.equal(sim.raiderLineClear({ ...people.Max, y: .5 }, { ...ward, y: .5 }), false, 'the ward partition stands between');
  const doorway = coins(sim, ward.x, ward.y, ward.z), through = pile(coinSweep(sim, people.Max), doorway);
  assert.ok(through, 'the ward pile one doorway away is offered');
  assert.ok(through.distance > flat(people.Max, ward) + .3 && through.distance <= round + 1.5, `priced on the walk round: ${through.distance.toFixed(2)} m`);
  assert.match(describeSituation(sim, people.Max.id).actions.find(a => a.value === 'coins')?.description ?? '', /^Pick up 1 coin pile \(120 coins\) within [67] m;/);
  sim.pickups.delete(doorway);
  // In the ward, a pile 3 m away past a bed: no knee-height line, no wall
  // between (main's bodies walked round the bed and took it in about 2 s).
  place('Max', 7, 0, -11.2);
  const bed = { x: 7, y: 0, z: -8.2 };
  assert.equal(sim.raiderLineClear({ ...people.Max, y: .5 }, { ...bed, y: .5 }), false, 'furniture stands between (moved? pick another spot)');
  const beyond = coins(sim, bed.x, bed.y, bed.z), past = pile(coinSweep(sim, people.Max), beyond);
  assert.ok(past && Math.abs(past.distance - 3) < .05, `the pile past the bed: ${past?.distance}`);
  return { doorwayPile: +through.distance.toFixed(2), bedPile: +past.distance.toFixed(2) };
});

// (g) The guide on the hospital: wide stairs, the basement's only ways in.
lot2('Hospital guide drops single file and says the basement has no outside door', () => {
  assert.doesNotMatch(GUIDE, /single file/);
  for (const guide of [GUIDE, TACTICAL_GUIDE]) assert.match(guide, /The basement has no outside door: zombies reach it only by the main stair/);
  return {};
});

console.log(JSON.stringify({ checks: verified.length, verified }, null, 1));
console.log('hospital companion texts verified');
