import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody, LOFT_POST, LOFT_POST_EXTERIOR } from '../../companions/body.mjs';
import { describeSituation } from '../../companions/situation.mjs';
import { describeTeamPlan, normalizeTeamPlan, teamIntent } from '../../companions/team-plan.mjs';
import { routeLength } from '../../companions/routes.mjs';
import { coinSweep } from '../../companions/coins.mjs';
import { rainCost, wayOut } from '../../companions/outdoors.mjs';
import { crateOpportunity } from '../../companions/crate-opportunity.mjs';
import { GUIDE, TACTICAL_GUIDE } from '../../companion-brain/guide.mjs';
import { IS_FUNFAIR } from '../../public/level-config.js';
import { SPACE, spaceTreadY, spaceFlightAt } from '../../public/level-space.js';
import { seededRandom } from '../../validation/balance-report.mjs';
import { SUPPLY_BONUSES } from '../../public/weapon-upgrades.js';
import { rollCompanionProfile } from '../../companions/profiles.mjs';

assert.equal(IS_FUNFAIR, true, 'run with DEADWOOD_LEVEL=funfair');
const DT = 1 / 30, flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const verified = [];
const flights = Object.fromEntries(SPACE.flights.map(f => [f.id, f]));
const ROOM_NAMES = Object.freeze({
  caisse: 'ticket booth', jeux: 'games room', lots: 'prizes', confiserie: 'snack bar', arcade: 'bumper cars',
  refuge: 'refuge', tir: 'shooting gallery', miroirs: 'mirror maze', machines: 'machine room',
});

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
function share(sim, from, f) {
  let seen = 0, n = 0;
  for (let i = 0; i <= 20; i++) {
    const z = f.minZ + (f.maxZ - f.minZ) * i / 20; n++;
    if (sim.raiderLineClear({ x: from.x, y: from.y + 1.55, z: from.z }, { x: (f.minX + f.maxX) / 2, y: spaceTreadY(f, z) + 1.2, z })) seen++;
  }
  return seen / n;
}
const seesHead = (sim, from, f) => sim.raiderLineClear({ x: from.x, y: from.y + 1.55, z: from.z }, { ...f.upper, y: f.upper.y + 1.2 });
const check = (name, facts = {}) => verified.push({ check: name, pass: true, ...facts });

{
  const { sim, people } = room('FUNGEO');
  const main = flights['main-stair'], service = flights['service-stair'];
  assert.ok(share(sim, SPACE.refuge, main) < .2 && share(sim, SPACE.refuge, service) < .2, 'the refuge target stays blind to both flights');
  assert.deepEqual({ ...SPACE.refuge }, { x: -6, y: -3.4, z: -7 });
  for (const [post, own, other] of [[LOFT_POST, main, service], [LOFT_POST_EXTERIOR, service, main]]) {
    assert.equal(post.y, SPACE.minY);
    assert.ok(!spaceFlightAt(post.x, post.z, post.y, .25), 'post is off the flight band');
    assert.ok(sim.canOccupy(people.Max, post.x, post.z, post.y, .32), `free floor at ${JSON.stringify(post)}`);
    assert.ok(share(sim, post, own) >= .9, `${JSON.stringify(post)} sees the whole ${own.id}`);
    assert.ok(seesHead(sim, post, own), `${JSON.stringify(post)} sees the ${own.id} head`);
    assert.ok(share(sim, post, other) <= .1, `${JSON.stringify(post)} does not double-cover the ${other.id}`);
  }
  check('Cellar loft posts each see their own whole flight and head, not the other flight');
}

{
  const { sim, people, bodies, place, run } = room('FUNPOST2', { bots: ['Max', 'Léa'] });
  place('Papa', 0, 0, 0);
  place('Max', -10, -3.4, -2); place('Léa', 8, -3.4, 1);
  for (const name of ['Max', 'Léa']) {
    sim.companionOrders.set(people[name].id, { kind: 'loft' });
    bodies[name].setOrder({ kind: 'loft' });
  }
  assert.ok(run(20, () => flat(people.Max, LOFT_POST) < .45 && flat(people.Léa, LOFT_POST_EXTERIOR) < .45),
    `each bot takes its own post: ${JSON.stringify({ Max: [people.Max.x, people.Max.y, people.Max.z], Léa: [people.Léa.x, people.Léa.y, people.Léa.z] })}`);
  check('Two loft bots take the main and service stair-foot posts');
}
for (const state of ['downed', 'eliminated']) {
  const { sim, people, bodies, place, run } = room(`FUNFAIL-${state}`, { bots: ['Max', 'Léa'] });
  place('Papa', 0, 0, 0);
  place('Max', -10, -3.4, -2); place('Léa', LOFT_POST_EXTERIOR.x, LOFT_POST_EXTERIOR.y, LOFT_POST_EXTERIOR.z);
  for (const name of ['Max', 'Léa']) {
    sim.companionOrders.set(people[name].id, { kind: 'loft' });
    bodies[name].setOrder({ kind: 'loft' });
  }
  if (state === 'downed') sim.damagePlayer(people.Max, 1000, { id: 'test' });
  else Object.assign(people.Max, { hp: 0, alive: false, downed: true });
  const reached = run(20, () => flat(people.Léa, LOFT_POST) < .45);
  console.log(JSON.stringify({ funfairLoftFailover: state, reached, distanceToMain: +flat(people.Léa, LOFT_POST).toFixed(2) }));
  assert.ok(reached, `${state} first bot must release the main-stair watch`);
  check(`${state} first loft bot releases the main-stair watch`);
}

{
  const { people, bodies, place, zombie, run } = room('FUNPOST1');
  place('Papa', -6, -3.4, -7);
  place('Max', LOFT_POST.x, LOFT_POST.y, LOFT_POST.z);
  bodies.Max.setOrder({ kind: 'loft' });
  run(2);
  const main = flights['main-stair'], head = { x: (main.minX + main.maxX) / 2, z: main.maxZ - .4 };
  const walker = zombie(head.x, spaceTreadY(main, head.z), head.z, { hp: 500, speed: 1.1 });
  let firstShotAt = null;
  run(12, () => !(walker.hp > 0) || walker.y <= -3.3, batch => {
    if (firstShotAt === null && batch.some(e => e.event === 'shot' && e.id === people.Max.id)) firstShotAt = flat(people.Max, walker);
  });
  assert.ok(firstShotAt !== null, 'the post fires at the walker coming down the main stair');
  assert.ok(firstShotAt >= 5, `first shot at ${firstShotAt?.toFixed(1)} m`);
  check('Walker descending the main stair is first shot at >= 5 m', { firstShotAt: +firstShotAt.toFixed(1) });
}

{
  const { sim, people, place, zombie } = room('FUNLBL1');
  place('Papa', 0, 0, 0); place('Max', -2, -3.4, -10.6);
  const north = sim.doors.find(door => door.id === 'north');
  const under = zombie(north.x + 1, -3.4, north.z + 1.4);
  const view = describeSituation(sim, people.Max.id);
  const northLine = view.text.split('\n').find(l => l.startsWith('- north door,'));
  assert.ok(northLine, 'north door line');
  assert.match(northLine, /1 in the cellar under it/, northLine);
  assert.doesNotMatch(northLine, /already inside/, northLine);
  const enemyLine = view.text.split('\n').find(l => l.includes(under.id));
  assert.match(enemyLine, /INSIDE \(circulation, under the north door\)/, enemyLine);
  check('Cellar zombie under a door is under it, not already inside by it');
}
{
  const { sim, people, place, zombie } = room('FUNLBL2', { humans: ['Papa', 'Jules'] });
  place('Papa', -8, 0, 0); place('Jules', 6, 0, 2); place('Max', -9, -3.4, 0);
  const hunter = zombie(6, -3.4, 1);
  const view = describeSituation(sim, people.Max.id);
  const julesLine = view.text.split('\n').find(l => l.startsWith('- Jules'));
  assert.ok(julesLine, 'Jules line');
  assert.doesNotMatch(julesLine, /after them/, julesLine);
  const enemyLine = view.text.split('\n').find(l => l.includes(hunter.id));
  assert.match(enemyLine, /going for Jules/, enemyLine);
  check('Zombie a floor below a human is not after them');
}

{
  const { sim, people, place } = room('FUNPLAN', { bots: ['Max', 'Léa'] });
  place('Papa', -3, 0, 0); place('Max', -6, -3.4, -7); place('Léa', -2, 0, 2);
  Object.assign(sim, { phase: 'intermission', timeLeft: 1e9 });
  const request = describeTeamPlan(sim);
  const postQuestion = request.questions.find(q => q.name === 'bot0_post');
  const described = Object.fromEntries(postQuestion.choices.map(c => [c.value, c.description]));
  assert.match(described.loft, /main and service stairs/, described.loft);
  for (const id of ['north', 'south', 'west', 'east']) assert.notEqual(described[id], id, `${id} door has player words`);
  assert.match(described.north, /ticket arch and canopy/, described.north);
  assert.match(described.west, /main stair head/, described.west);
  assert.match(described.east, /prize counter/, described.east);
  assert.match(described.south, /snack bar and bumper cars/, described.south);
  const choices = Object.fromEntries(request.questions.map(q => [q.name, q.choices[0].value]));
  sim.companionTeamPlan = normalizeTeamPlan(sim, request, { choices: { ...choices, bot0_post: 'loft', bot1_post: 'west' } });
  assert.ok(sim.companionTeamPlan, 'a validated plan');
  const intent = teamIntent(sim, people.Max.id);
  assert.match(intent, /preferred post cellar stair-foot post/, intent);
  assert.doesNotMatch(intent, /preferred post loft/, intent);
  assert.match(teamIntent(sim, people.Léa.id), /Max: [^;]*, cellar stair-foot post,/);
  assert.match(request.situation, /Grand Palais des Jeux, La Fête Foraine/);
  assert.match(request.situation, /The loft choice means the cellar posts watching up those stair/);
  check('Team plan names every funfair door and the cellar stair-foot posts');
}

{
  const { sim, people, place } = room('FUNTEXT', { bots: ['Max', 'Léa'] });
  place('Papa', 0, 0, 0);
  const at = (name, spot) => { Object.assign(people[name], spot); return describeSituation(sim, people[name].id); };
  const you = view => view.text.split('\n').find(l => l.startsWith('YOU:'));
  assert.match(you(at('Max', LOFT_POST)), /cellar post at the main stair foot/);
  assert.match(you(at('Max', LOFT_POST_EXTERIOR)), /cellar post at the service stair foot/);
  const loft = at('Max', { x: 0, y: 0, z: 0 }).actions.find(action => action.value === 'loft');
  assert.ok(loft, 'a loft action');
  assert.match(loft.description, /^Hold the cellar post at the main stair foot \(.+\), watching up that flight\.$/, loft.description);
  assert.doesNotMatch(loft.description, /service|refuge|loft/i, loft.description);
  sim.companionOrders.set(people.Max.id, { kind: 'loft' });
  const second = at('Léa', { x: 0, y: 0, z: 0 }).actions.find(action => action.value === 'loft').description;
  assert.match(second, /^Hold the second cellar post, at the service stair foot \(.+\), watching up it\.$/, second);
  let longest = 0;
  for (const armed of [true, false]) {
    if (!armed) for (const name of ['Max', 'Léa']) for (const stock of Object.values(people[name].inventory)) if (stock && typeof stock === 'object') { stock.ammo = 0; stock.reserve = 0; }
    for (const item of SPACE.rooms) for (const name of ['Max', 'Léa']) {
      const view = at(name, item.target);
      for (const action of view.actions) {
        assert.ok(action.description.length < 170, `${name} in ${item.id}: ${action.value} cut: ${action.description}`);
        longest = Math.max(longest, action.description.length);
      }
      const line = view.actions.find(action => action.value === 'loft').description;
      assert.ok(line.endsWith('watching up that flight.') || line.endsWith('watching up it.'), line);
    }
  }
  check('Loft action and YOU lines name the assigned cellar post, complete from every room', { longest });
}

{
  const { sim, people, place } = room('FUNROOMS');
  place('Papa', 0, 0, 0);
  const named = spot => {
    Object.assign(people.Max, spot);
    return describeSituation(sim, people.Max.id).text.split('\n').find(l => l.startsWith('YOU:')).split(';')[0].replace(/^YOU: Max \(AI teammate\), /, '');
  };
  assert.deepEqual(SPACE.rooms.map(item => item.id).sort(), Object.keys(ROOM_NAMES).sort());
  for (const item of SPACE.rooms) {
    assert.equal(named(item.target), ROOM_NAMES[item.id], `${item.id} target`);
    for (const x of [item.bounds.minX + .4, item.bounds.maxX - .4]) for (const z of [item.bounds.minZ + .4, item.bounds.maxZ - .4]) {
      const spot = { x, y: item.target.y, z };
      if ((sim.doors.some(door => flat(door, spot) <= 3) && item.floor === 'ground') || spaceFlightAt(x, z, spot.y)) continue;
      if (flat(spot, LOFT_POST) <= 2.5 || flat(spot, LOFT_POST_EXTERIOR) <= 2) continue;
      assert.equal(named(spot), ROOM_NAMES[item.id], `${item.id} corner ${JSON.stringify(spot)}`);
    }
  }
  const between = [
    { point: { x: -10, y: 0, z: 0 }, name: 'circulation' }, { point: { x: 0, y: 0, z: -9 }, name: 'circulation' },
    { point: { x: 15.8, y: 0, z: 11 }, name: 'circulation' }, { point: { x: -10, y: -3.4, z: 0 }, name: 'circulation' },
    { point: { x: 15.8, y: -3.4, z: .8 }, name: 'circulation' }, { point: { x: -16, y: -3.4, z: -9.2 }, name: 'refuge' },
  ];
  for (const { point, name } of between) assert.equal(named(point), name, JSON.stringify(point));
  for (const door of sim.doors) {
    const point = { x: door.x - door.outX * 2, y: 0, z: door.z - door.outZ * 2 };
    assert.equal(named(point), `circulation, by the ${door.id} door`);
  }
  const allText = between.map(({ point }) => named(point)).join('\n') + '\n' + SPACE.rooms.map(item => named(item.target)).join('\n');
  assert.doesNotMatch(allText, /hospital|ward|pharmacy|chapel|supermarket|sales floor|cabin/i, allText);
  check('Place names cover every funfair room target/corner, circulation and all four doors', { rooms: SPACE.rooms.length, between: between.length });
}

const enemyLines = view => view.text.split('\n').filter(l => /^- z\d+ /.test(l));
const coins = (sim, x, y, z) => {
  const id = `pc${sim.nextPickupId++}`;
  sim.pickups.set(id, { id, kind: 'points', x, y, z, amount: 120, special: false, expiresAt: sim.time + 120 });
  return id;
};
const offered = (sim, player, id) => Boolean(coinSweep(sim, player)?.piles.some(item => item.pickup.id === id));

{
  const { sim, people, place } = room('FUNDIST', { humans: ['Papa', 'Jules'], bots: ['Max', 'Léa'] });
  place('Papa', -8, 0, .7); place('Jules', -6, -3.4, -7); place('Max', 0, 0, -9); place('Léa', -10, -3.4, 0);
  sim.damagePlayer(people.Jules, 1000, { id: 'test' });
  const revive = name => describeSituation(sim, people[name].id).actions.find(a => a.value === `revive:${people.Jules.id}`).description;
  const said = Number(revive('Max').match(/; (\d+) m via the main stairs \(below you\)\.$/)?.[1]);
  assert.ok(said >= 20, revive('Max'));
  assert.match(revive('Léa'), /; 8\.1 m NE\.$/, revive('Léa'));
  const spots = [
    [0, 0, 0], [-12.9, 0, -10.6], [6, 0, -6], [13.5, 0, -9], [-14, 0, 10], [6, 0, 5.5], [15.8, 0, 11],
    [-6, -3.4, -7], [9.8, -3.4, -7], [-12, -3.4, 9], [6, -3.4, 6], [15.8, -3.4, .8],
  ].map(([x, y, z]) => ({ x, y, z }));
  const pair = room('FUNPAIRS');
  let pairs = 0, worst = 1;
  for (const a of spots) for (const b of spots) {
    if (Math.abs(a.y - b.y) < 1) continue;
    pair.place('Max', a.x, a.y, a.z); pair.place('Papa', b.x, b.y, b.z);
    const line = describeSituation(pair.sim, pair.people.Max.id).text.split('\n').find(l => l.startsWith('- Papa'));
    assert.ok(line, `${JSON.stringify(a)} -> ${JSON.stringify(b)} team line`);
    const metres = Number(line.match(/, (\d+(?:\.\d)?) m via the (?:main|service) stairs/)?.[1]), walk = routeLength(a, b);
    const ratio = Math.max(metres / walk, walk / metres);
    assert.ok(ratio <= 1.5, `${JSON.stringify(a)} -> ${JSON.stringify(b)}: ${line} (route ${walk.toFixed(1)} m)`);
    pairs++; worst = Math.max(worst, ratio);
  }
  assert.equal(pairs, 70, 'cross-floor pairs');
  const goal = room('FUNGOAL', { humans: ['Papa', 'Jules'] });
  goal.place('Max', -12, -3.4, 0); goal.place('Papa', -6, -3.4, 1); goal.place('Jules', 6, 0, 1);
  const under = goal.zombie(6, -3.4, 0), byPapa = goal.zombie(-4, -3.4, 0);
  const lines = enemyLines(describeSituation(goal.sim, goal.people.Max.id));
  assert.deepEqual(lines.map(l => l.split(' ')[1]), [byPapa.id, under.id], lines.join('\n'));
  const gap = Number(lines[1].match(/going for Jules \((\d+) m from them\)/)?.[1]);
  assert.ok(Math.max(gap / routeLength(under, goal.people.Jules), routeLength(under, goal.people.Jules) / gap) <= 1.5 && gap >= 15, lines[1]);
  check('Cross-floor distances are walked metres via named stairs for revives, 70 pairs and zombie threat order', { maxRevive: said, pairs, worstRatio: +worst.toFixed(2), underGap: gap });
}

{
  const cases = [
    { max: [6, 0, 5.5], zombies: [[9, 0, 12]], expect: [/INSIDE \(bumper cars\)/] },
    { max: [-2, -3.4, -10.6], zombies: [[0, -3.4, -11.6]], expect: [/INSIDE \(circulation, under the north door\)/] },
    { max: [12.7, -3.4, 0], zombies: [[13.4, -1.53, 7.5]], expect: [/INSIDE \(on the service stairs\)/, /^STAIRS: main: 0, service: 1 visible zombies on the flights;/m] },
    { max: [6, 0, -6], zombies: [[8, 0, -12]], expect: [/INSIDE \(games room\)/] },
  ];
  for (const item of cases) {
    const { sim, people, place, zombie } = room('FUNNAMES');
    place('Papa', -8, 0, .7); place('Max', ...item.max);
    people.Max.bonus = { ...(people.Max.bonus ?? {}), radar: 8 };
    for (const at of item.zombies) zombie(...at);
    const view = describeSituation(sim, people.Max.id), all = [view.text, ...view.actions.map(a => a.description)].join('\n');
    for (const pattern of item.expect) assert.match(all, pattern, all);
    assert.doesNotMatch(all, /hospital|ward|pharmacy|chapel|INSIDE \((?:ground|stairs)/i, all);
    assert.match(view.text, /^RECON N8.* walker (?:cellar|ground|stairs) /m, view.text);
  }
  check('Enemy and recon texts name funfair rooms, cellar and each flight', { cases: cases.length });
}

{
  let longest = 0;
  for (const level of [0, 3, 8]) {
    const budget = new RoomSimulation('FUNBUDGET', { random: () => .5 });
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
    if (level < 8) for (const player of budget.players.values()) {
      const way = wayOut(budget, budget.supplyCrate), eligible = Object.keys(SUPPLY_BONUSES).filter(kind => budget.bonusEligible(player, kind));
      const opportunity = crateOpportunity(budget, player);
      assert.ok(opportunity, JSON.stringify({ level, player: player.id, wave: budget.wave, phase: budget.phase, crateWave: budget.supplyCrate.wave,
        hp: player.hp, alive: player.alive, waiting: player.waiting, downed: player.downed, claimed: [...budget.supplyCrate.claimed], way, eligible,
        rain: way ? rainCost(budget, player, way.distance, way) : null }));
    }
    const first = describeTeamPlan(budget), choices = Object.fromEntries(first.questions.map(q => [q.name, q.choices[0].value]));
    const firstCrate = JSON.parse(first.situation.split('\n').find(l => l.startsWith('CRATE ')).slice(6));
    if (level < 8) assert.ok(budget.doors.some(door => door.id === firstCrate.via), `initial plan crate route: ${JSON.stringify(firstCrate)}`);
    budget.companionTeamPlan = normalizeTeamPlan(budget, first, { choices: { ...choices, bot0_bonus: 'vitamins', bot0_post: 'west' } });
    const plan = describeTeamPlan(budget);
    if (level < 8) for (const player of budget.players.values()) assert.ok(crateOpportunity(budget, player), `crate opportunity after planning for ${player.id}`);
    assert.ok(plan.situation.length < 16000, `bonus level ${level}: ${plan.situation.length} characters`);
    assert.match(plan.situation, /PREVIOUS INTENTIONS .*\]$/, `bonus level ${level}: ...${plan.situation.slice(-160)}`);
    const crate = JSON.parse(plan.situation.split('\n').find(l => l.startsWith('CRATE ')).slice(6));
    assert.equal(crate.active, true);
    if (level < 8) {
      assert.ok(budget.doors.some(door => door.id === crate.via), `level ${level} crate names a real funfair door: ${JSON.stringify(crate)}`);
      assert.equal(crate.ready?.length, 4, JSON.stringify(crate));
    } else {
      assert.equal(crate.via, undefined, 'maxed bonuses leave no crate claimant');
      assert.equal(crate.ready, undefined, 'maxed bonuses leave no ready list');
    }
    longest = Math.max(longest, plan.situation.length);
  }
  check('Loaded four-survivor team plans keep previous intentions and real crate routes under 16000 characters', { longestPlanSituation: longest });
}

{
  const { sim, people, place } = room('FUNRAIN');
  sim.wave = 4; sim.beginSupplyWave();
  for (const door of sim.doors) { door.sealed = false; door.sealPending = false; door.boards.fill(0); }
  place('Papa', -8, 0, .7); place('Max', 0, 0, -11.5);
  people.Max.umbrella.remaining = 0;
  const door = id => sim.doors.find(item => item.id === id);
  const north = rainCost(sim, people.Max, 1.5, { door: door('north') }), south = rainCost(sim, people.Max, 1.5, { door: door('south') });
  assert.deepEqual([north.seconds, north.burn], [0, 0], JSON.stringify(north));
  assert.ok(south.seconds > 0 && south.burn > 0, `no canopy over the south door: ${JSON.stringify(south)}`);
  for (const id of ['east', 'west']) assert.ok(rainCost(sim, people.Max, 1.5, { door: door(id) }).seconds > 0, `${id} has no entrance canopy`);
  place('Max', 0, 0, -12.5);
  assert.ok(offered(sim, people.Max, coins(sim, 0, 0, -14.5)), 'a pile under the entrance canopy is offered with an empty umbrella');
  place('Max', 0, 0, 12.5);
  assert.ok(!offered(sim, people.Max, coins(sim, 0, 0, 14.5)), 'a pile outside the south door stays refused with an empty umbrella');
  place('Max', 0, 0, -12.5);
  for (const stock of Object.values(people.Max.inventory)) if (stock && typeof stock === 'object') stock.reserve = 0;
  const box = `pa${sim.nextPickupId++}`;
  sim.pickups.set(box, { id: box, kind: 'ammo', x: 0, y: 0, z: -14.5, special: false, expiresAt: sim.time + 60 });
  const collect = describeSituation(sim, people.Max.id).actions.find(a => a.value === `collect:${box}`)?.description;
  assert.match(collect ?? '', /past the broken north door \(low on ammo\): dry under the door canopy\.$/, collect);
  check('Companion rain texts and costs include the north canopy but not exposed doors');
}

{
  const { sim, people, place } = room('FUNCOINS');
  const pile = (sweep, id) => sweep?.piles.find(item => item.pickup.id === id);
  place('Papa', -8, 0, .7); place('Max', 6, 0, -6);
  const behind = coins(sim, 14, 0, -2.8);
  assert.ok(!offered(sim, people.Max, behind), 'a pile through the lots wall is not offered');
  const seen = coins(sim, 6, 0, -10);
  assert.ok(offered(sim, people.Max, seen), 'a pile in sight in the games room is offered');
  sim.pickups.delete(seen);
  place('Max', 9.55, 0, 0);
  const games = { x: 6, y: 0, z: -5 };
  assert.equal(sim.raiderLineClear({ ...people.Max, y: .5 }, { ...games, y: .5 }), false, 'the games-room partition stands between');
  const doorway = coins(sim, games.x, games.y, games.z), through = pile(coinSweep(sim, people.Max), doorway);
  assert.ok(through, 'the games-room pile one doorway away is offered');
  assert.ok(through.distance > flat(people.Max, games) + .3 && through.distance <= 10, `priced on the walk round: ${through.distance.toFixed(2)} m`);
  sim.pickups.delete(doorway);
  place('Max', -7, 0, -6.8);
  const pastCounter = { x: -7, y: 0, z: -4.4 };
  assert.equal(sim.raiderLineClear({ ...people.Max, y: .5 }, { ...pastCounter, y: .5 }), false, 'the ticket counter stands between');
  const beyond = coins(sim, pastCounter.x, pastCounter.y, pastCounter.z), past = pile(coinSweep(sim, people.Max), beyond);
  assert.ok(past && Math.abs(past.distance - 2.4) < .05, `the pile past the counter: ${past?.distance}`);
  check('Coin piles use walked routes around funfair partitions, doorways and furniture', { doorwayPile: +through.distance.toFixed(2), counterPile: +past.distance.toFixed(2) });
}

assert.doesNotMatch(GUIDE, /single file/);
assert.match(GUIDE, /Grand Palais des Jeux has walled rooms/);
assert.match(GUIDE, /It has no outside door: main and service stairs are the only routes/);
assert.match(GUIDE, /entrance, carousel and stall canopies are dry/);
assert.doesNotMatch(GUIDE, /L'Hôpital|pharmacy|operating theatre/);
assert.match(TACTICAL_GUIDE, /Palais\/salle des machines: two stairs/);
assert.match(TACTICAL_GUIDE, /loft means a cellar stair-foot post/);
check('Funfair guide and tactical guide describe both stairs, rooms, cellar and dry canopies without hospital text');

console.log(JSON.stringify({ checks: verified.length, verified }, null, 1));
console.log('funfair companion texts verified');
