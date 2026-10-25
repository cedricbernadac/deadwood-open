import assert from 'node:assert/strict';
// Lot 3 (supermarket companions): the cellar fallback posts see both stair
// flights, the interior watch peeks after 15 s unseen, door/threat labels
// respect floors, place names are player words, STAIRS counts per flight,
// the team intent says "cellar reserve post", and a too-long situation keeps
// the short STAIRS line. Real simulation, no server, no model API.
// Run with DEADWOOD_LEVEL=supermarket (the test file spawns it so).
import { RoomSimulation } from '../../simulation.mjs';
import { createCompanionBody, LOFT_POST, LOFT_POST_EXTERIOR } from '../../companions/body.mjs';
import { describeSituation, TEXT_LIMIT } from '../../companions/situation.mjs';
import { describeTeamPlan, normalizeTeamPlan, teamIntent } from '../../companions/team-plan.mjs';
import { rollCompanionProfile } from '../../companions/profiles.mjs';
import { SPACE, spaceTreadY, spaceFlightAt } from '../../public/level-space.js';
import { seededRandom } from '../../validation/balance-report.mjs';

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

// How much of a flight a spot sees (chest of a walker on the tread centre line).
function share(sim, from, f) {
  let seen = 0, n = 0;
  for (let i = 0; i <= 20; i++) {
    const z = f.minZ + (f.maxZ - f.minZ) * i / 20; n++;
    if (sim.raiderLineClear({ x: from.x, y: from.y + 1.55, z: from.z }, { x: (f.minX + f.maxX) / 2, y: spaceTreadY(f, z) + 1.2, z })) seen++;
  }
  return seen / n;
}

// ---- 1. The fallback posts see the flights -------------------------------
{
  const { sim } = room('GEO');
  const oldPost = share(sim, SPACE.refuge, flights['stock-stair']);
  assert.ok(oldPost < 0.2, `the legacy refuge post stays blind to the interior flight (${oldPost}) — SPACE.refuge untouched`);
  assert.ok(share(sim, LOFT_POST, flights['stock-stair']) >= 0.9, 'the companion fallback post sees the whole interior flight');
  assert.ok(share(sim, LOFT_POST_EXTERIOR, flights['garden-stair']) >= 0.9, 'the second post sees the whole exterior flight');
  assert.ok(share(sim, LOFT_POST_EXTERIOR, flights['stock-stair']) <= 0.1, 'the second post does not double-cover the interior flight');
  verified.push({ check: 'Post geometry: interior foot post and exterior watch each see their flight', pass: true });
}

// ---- 2. A walker coming down the interior stair is first shot far away ---
{
  const { sim, people, bodies, place, zombie, run } = room('POST1');
  place('Papa', 6.5, -3.4, -8.9); // cellar reserve: the walker comes down to him
  place('Max', LOFT_POST.x, LOFT_POST.y, LOFT_POST.z);
  bodies.Max.setOrder({ kind: 'loft' });
  run(2);
  assert.ok(flat(people.Max, LOFT_POST) < 0.45, 'holds the interior foot post');
  const head = { x: 4.2, z: -1.4 }, walker = zombie(head.x, spaceTreadY(flights['stock-stair'], head.z), head.z, { hp: 500, speed: 1.1 });
  let firstShotAt = null;
  run(12, () => !(walker.hp > 0) || walker.y <= -3.3, batch => {
    if (firstShotAt === null && batch.some(e => e.event === 'shot' && e.id === people.Max.id)) firstShotAt = flat(people.Max, walker);
  });
  assert.ok(firstShotAt !== null, 'the post fires at the walker coming down the interior stair');
  assert.ok(firstShotAt >= 6, `first shot at ${firstShotAt?.toFixed(1)} m (was ~2 m from the legacy refuge post)`);
  verified.push({ check: 'Walker descending the interior flight is first shot at >= 6 m', pass: true, firstShotAt: +firstShotAt.toFixed(1) });
}

// ---- 3. A second bot on 'loft' covers the exterior flight -----------------
{
  const { sim, people, bodies, place, zombie, run } = room('POST2', { bots: ['Max', 'Léa'] });
  place('Papa', 9, -3.4, 6); // cellar south: the walker comes down the exterior flight to him
  place('Max', LOFT_POST.x, LOFT_POST.y, LOFT_POST.z);
  place('Léa', 9, -3.4, -4);
  for (const name of ['Max', 'Léa']) {
    sim.companionOrders.set(people[name].id, { kind: 'loft' });
    bodies[name].setOrder({ kind: 'loft' });
  }
  assert.ok(run(10, () => flat(people.Max, LOFT_POST) < 0.45 && flat(people.Léa, LOFT_POST_EXTERIOR) < 0.45), 'each bot takes its own post');
  assert.ok(flat(people.Max, LOFT_POST) < 0.45, 'first bot: interior stair foot');
  assert.ok(flat(people.Léa, LOFT_POST_EXTERIOR) < 0.45, 'second bot: exterior watch');
  const head = { x: 11.2, z: 8.5 }, walker = zombie(head.x, spaceTreadY(flights['garden-stair'], head.z), head.z, { hp: 500, speed: 1.1 });
  let firstShotAt = null, byBot = null;
  run(12, () => walker.y <= -3.3, batch => {
    if (firstShotAt === null) for (const e of batch) if (e.event === 'shot') { byBot = e.id; firstShotAt = flat(people.Léa, walker); break; }
  });
  assert.equal(byBot, people.Léa.id, 'the exterior watch fires first at the walker on the exterior flight');
  assert.ok(firstShotAt >= 5, `first shot at ${firstShotAt?.toFixed(1)} m on the exterior flight`);
  verified.push({ check: 'Second loft bot covers the exterior flight', pass: true, firstShotAt: +firstShotAt.toFixed(1) });
}

// ---- 4. The interior watch peeks after 15 s unseen ------------------------
{
  const { sim, people, bodies, place, zombie, run } = room('PEEK');
  place('Papa', -10, 0, 3);
  place('Max', LOFT_POST.x, LOFT_POST.y, LOFT_POST.z);
  bodies.Max.setOrder({ kind: 'loft' });
  run(1);
  // Jammed at the ground floor by the interior stair head, hidden from the post.
  const jammed = zombie(7.2, 0, -0.6, { hp: 30 });
  const eye = { x: LOFT_POST.x, y: LOFT_POST.y + 1.55, z: LOFT_POST.z };
  assert.equal(sim.raiderLineClear(eye, { x: jammed.x, y: 1.2, z: jammed.z }), false, 'setup: the jammed zombie is not visible from the post');
  run(13);
  assert.ok(flat(people.Max, LOFT_POST) < 1.2, 'no peek while the last sighting is fresh');
  let climbed = false;
  const dead = run(35, () => !(jammed.hp > 0), () => { if (people.Max.y > -1.2) climbed = true; });
  assert.ok(climbed, 'after 15 s without a sighting the watch climbs to peek round the stair head');
  assert.ok(dead, 'the peek finds and kills the jammed zombie');
  verified.push({ check: 'Peek from the stair foot after 15 s unseen clears a jam at the head', pass: true });
}

// ---- 5. Door and threat labels respect floors -----------------------------
{
  // A cellar zombie under the east door, seen from the cellar.
  const { sim, people, place, zombie } = room('LBL1', { humans: ['Papa', 'Jules'] });
  place('Papa', -10, 0, 3); place('Jules', 0, 0, 5);
  place('Max', 7.9, -3.4, -0.8);
  const under = zombie(12.3, -3.4, 0.5); // cellar, flat-near the east door, one floor below it
  const view = describeSituation(sim, people.Max.id);
  const eastLine = view.text.split('\n').find(l => l.startsWith('- east door,'));
  assert.ok(eastLine, 'east door line');
  assert.match(eastLine, /1 in the cellar under it/, eastLine);
  assert.doesNotMatch(eastLine, /already inside/, eastLine);
  const enemyLine = view.text.split('\n').find(l => l.includes(under.id));
  assert.match(enemyLine, /INSIDE \(cellar, under the east door\)/, enemyLine);
  verified.push({ check: 'Cellar zombie under a door: "under the east door", not "already inside by it"', pass: true });
}
{
  // A cellar zombie hunting a human one floor up is not "after them".
  const { sim, people, place, zombie } = room('LBL2', { humans: ['Papa', 'Jules'] });
  place('Papa', -10, 0, 3); place('Jules', 8.5, 0, -8.5);
  place('Max', 8.5, -3.4, 4);
  const hunter = zombie(8.5, -3.4, -7.5); // cellar, 1 m flat under Jules, one floor below
  const view = describeSituation(sim, people.Max.id);
  const julesLine = view.text.split('\n').find(l => l.startsWith('- Jules'));
  assert.ok(julesLine, 'Jules line');
  assert.doesNotMatch(julesLine, /after them/, julesLine);
  const enemyLine = view.text.split('\n').find(l => l.includes(hunter.id));
  assert.match(enemyLine, /going for Jules/, enemyLine);
  verified.push({ check: 'Zombie a floor below a human is not "1 zombie after them (nearest 0.x m)"', pass: true });
}

// ---- 6. Player words for places -------------------------------------------
{
  const { sim, people, place } = room('PLACE');
  place('Papa', -3, 0, 0);
  const you = at => { Object.assign(people.Max, at); return describeSituation(sim, people.Max.id).text.split('\n').find(l => l.startsWith('YOU:')); };
  assert.match(you({ x: -7, y: 0, z: 9 }), /sales floor, by the checkouts/);
  assert.match(you({ x: -8, y: 0, z: -5 }), /sales floor, in the aisles/);
  assert.match(you({ x: 0.5, y: 0, z: -9 }), /sales floor, by the north door/);
  assert.match(you({ x: 12.5, y: 0, z: 0.5 }), /terrace, by the east door/);
  assert.match(you({ x: 11.2, y: 0, z: 10.4 }), /terrace, top of the exterior stairs \(acid rain\)/);
  assert.match(you({ x: 11.2, y: spaceTreadY(flights['garden-stair'], 5), z: 5 }), /on the exterior stairs \(acid rain\)/);
  assert.match(you({ x: 4.2, y: spaceTreadY(flights['stock-stair'], -4), z: -4 }), /on the interior stairs/);
  assert.match(you({ x: 12, y: -3.4, z: 0 }), /cellar, east wall/);
  assert.match(you({ x: 4.6, y: -3.4, z: -9.5 }), /cellar reserve post/);
  assert.doesNotMatch(you({ x: -12, y: 0, z: 0 }), /ground,/, 'no engine floor id on the sales floor');
  verified.push({ check: 'Place names use player words (sales floor / terrace / exterior stairs / cellar)', pass: true });
}

// ---- 7. STAIRS counts per flight ------------------------------------------
{
  const { sim, people, place, zombie } = room('STAIRS');
  place('Papa', -10, 0, 3);
  place('Max', LOFT_POST.x, LOFT_POST.y, LOFT_POST.z);
  zombie(4.2, spaceTreadY(flights['stock-stair'], -3), -3);
  zombie(4.2, spaceTreadY(flights['stock-stair'], -5), -5);
  const garden = zombie(11.2, spaceTreadY(flights['garden-stair'], 5), 5);
  const fromPost = describeSituation(sim, people.Max.id).text;
  assert.match(fromPost, /STAIRS: interior: 2, exterior: 0/, fromPost.split('\n').find(l => l.startsWith('STAIRS')) ?? 'no STAIRS line');
  Object.assign(people.Max, { x: LOFT_POST_EXTERIOR.x, y: LOFT_POST_EXTERIOR.y, z: LOFT_POST_EXTERIOR.z });
  const fromWatch = describeSituation(sim, people.Max.id).text;
  assert.match(fromWatch, /STAIRS: interior: 0, exterior: 1/, fromWatch.split('\n').find(l => l.startsWith('STAIRS')) ?? 'no STAIRS line');
  assert.ok(garden.hp > 0);
  verified.push({ check: 'STAIRS counts the interior and exterior flights apart', pass: true });
}

// ---- 8. The team intent says "cellar reserve post" -------------------------
{
  const { sim, people, place } = room('PLAN', { bots: ['Max', 'Léa'] });
  place('Papa', -3, 0, 0); place('Max', 4.6, -3.4, -9.5); place('Léa', -2, 0, 2);
  Object.assign(sim, { phase: 'intermission', timeLeft: 1e9 });
  const request = describeTeamPlan(sim);
  const postQuestion = request.questions.find(q => q.name === 'bot0_post');
  const described = Object.fromEntries(postQuestion.choices.map(c => [c.value, c.description]));
  assert.equal(described.loft, 'sheltered cellar reserve post by the interior stairs; exterior stair remains a second exit');
  assert.equal(described.north, 'the north door, sales floor side');
  // The checkout row stands 6 m and more west of the south door; the body's
  // post settles east of it (review, 24 October).
  assert.equal(described.south, 'the south door, sales floor side');
  assert.equal(described.west, 'the west door, sales floor side');
  assert.match(described.east, /roofed terrace passage/, 'the east post is guarded from the roofed passage');
  const choices = Object.fromEntries(request.questions.map(q => [q.name, q.choices[0].value]));
  sim.companionTeamPlan = normalizeTeamPlan(sim, request, { choices: { ...choices, bot0_post: 'loft', bot1_post: 'west' } });
  assert.ok(sim.companionTeamPlan, 'a validated plan');
  const intent = teamIntent(sim, people.Max.id);
  assert.match(intent, /preferred post cellar reserve post/, intent);
  assert.doesNotMatch(intent, /preferred post loft/);
  verified.push({ check: 'Plan posts in player words; "cellar reserve post" in the team intent', pass: true });
}

// ---- 9. A too-long situation keeps the short STAIRS line -------------------
{
  const { sim, people, place, zombie } = room('BUDGET', { bots: ['Max', 'Léa', 'Sam'], humans: ['Papa'], seed: 6 });
  sim.wave = 4; sim.beginWave(); sim.spawnTimer = 1e9; sim.toSpawn = 40; // an active supply crate stands
  for (const z of [...sim.zombies.values()]) sim.zombies.delete(z.id);
  people.Max.companionProfile = rollCompanionProfile('veteran', seededRandom(100));
  place('Papa', 8, -3.4, 6); place('Léa', 2, -3.4, 6); place('Sam', 0, 0, 2);
  place('Max', LOFT_POST.x, LOFT_POST.y, LOFT_POST.z);
  for (const z of [-3, -4.5, -6, -7]) zombie(4.2, spaceTreadY(flights['stock-stair'], z), z);
  for (const [x, z] of [[8, 2], [9.5, 4], [7, 6], [10.5, 0.5]]) zombie(x, -3.4, z);
  sim.pickups.set('ammo-1', { id: 'ammo-1', kind: 'ammo', x: 6, y: -3.4, z: -2, amount: 1, special: false, expiresAt: sim.time + 60, charge: 780 });
  sim.pickups.set('coins-1', { id: 'coins-1', kind: 'points', x: 5.5, y: -3.4, z: -4, amount: 120, expiresAt: sim.time + 60 });
  const view = describeSituation(sim, people.Max.id);
  assert.ok(view.text.length <= TEXT_LIMIT, `within budget (${view.text.length})`);
  assert.match(view.text, /STAIRS: interior: 4, exterior: 0/, 'the short STAIRS line survives the budget');
  assert.ok(!view.text.includes('SUPPLY CRATE'), 'the 1,226-char crate line is dropped first instead');
  verified.push({ check: 'Over-budget situation drops the longest line of the worst rank first', pass: true, chars: view.text.length });
}

console.log(JSON.stringify({ checks: verified.length, verified }, null, 1));
console.log('supermarket companion texts verified');
