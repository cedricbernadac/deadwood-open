// Raid balance with scripted defenders in the real authoritative simulation.
// Every survivor action goes through the real setInput/shoot/reload/interact,
// every raider through the real AI. Scripted defenders are not human play.
// Run from cabin-coop:
//   node validation/raid-balance-report.mjs [--quick] [--seeds N] [--workers N] [--before old.json] [--notes notes.json] [--out path] [--no-write]
// --only <regex> runs only the matching cells and prints them (tuning trials).
// Regenerate this report in place: --before validation/raid-balance-2026-10-11.json --notes validation/raid-balance-2026-10-11.json
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { RoomSimulation, WEAPONS, TICK_RATE } from '../simulation.mjs';
import { RAIDS, RAIDER_LOADOUTS, RAID_COMPOSITIONS, WINDOWS, LOFT, enemyPosture, playerEyeHeight, waveBalance } from '../public/rules.js';
import { RAIDER_AIM_TUNING } from '../public/raids.js';
import { seededRandom } from './balance-report.mjs';

const TICK = 1 / TICK_RATE;
const DATE = '2026-10-11';
const round = (value, digits = 2) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : value;
// Censored values (Infinity) stay in the order statistics; null and NaN do not.
const sorted = values => values.filter(value => typeof value === 'number' && !Number.isNaN(value)).sort((a, b) => a - b);
const quantile = (values, q) => { const list = sorted(values); return list.length ? list[Math.min(list.length - 1, Math.max(0, Math.ceil(list.length * q) - 1))] : null; };
const median = values => quantile(values, .5);
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const share = (values, test) => values.length ? values.filter(test).length / values.length : null;
const hash = text => [...text].reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
const gap2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const bearing = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

// Defender profiles (section 9). `aim` is the radius of a uniform angular disk
// added to the exact direction, on top of the weapon's own spread.
export const PROFILES = Object.freeze({
  competent: Object.freeze({ id: 'competent', label: 'bot compétent', reaction: .35, aim: .03, switch: .4, cover: true }),
  average: Object.freeze({ id: 'average', label: 'humain moyen', reaction: .65, aim: .06, switch: .7, cover: true }),
  strafing: Object.freeze({ id: 'strafing', label: 'humain moyen qui se décale', reaction: .65, aim: .06, switch: .7, cover: true, strafe: true }),
  naive: Object.freeze({ id: 'naive', label: 'naïf à découvert', reaction: .65, aim: .06, switch: .7, open: true }),
});
// Baseline survivor loadouts by raid; the first one is the reference cell.
export const LOADOUTS = Object.freeze({
  1: Object.freeze({ A: ['pistol', 'shotgun'], B: ['smg', 'shotgun'] }),
  2: Object.freeze({ A: ['smg', 'shotgun'], B: ['assault'] }),
  3: Object.freeze({ A: ['assault', 'rifle'], S: ['sniper', 'assault'], M: ['magnum', 'assault'] }),
});
const SHOTGUN_IN = 6.5, SHOTGUN_OUT = 8, PERCEPTION = .1, PEEK_HIDDEN = .4, FORGET = 1.5, SIGHT_LIMIT = 60;
const RUN_LIMIT = 420;
// The defenders' tracking term reuses the spec's raider formula and stays fixed,
// so tuning the raiders never changes how the scripted survivors aim.
const DEFENDER_TRACKING = Object.freeze({ gain: .12, floor: 6, max: .06 });

// ---------------------------------------------------------------- geometry
const doorOf = (sim, id) => sim.doors.find(door => door.id === id);
const activeDoors = sim => sim.doors.filter(door => !door.sealed && !door.sealPending);
function windowPost(door) {
  const window = WINDOWS.find(item => item.open && item.wall === door.id);
  return window.axis === 'x' ? { x: window.center, y: 0, z: window.fixed - door.outZ, tangent: [1, 0] }
    : { x: window.fixed - door.outX, y: 0, z: window.center, tangent: [0, 1] };
}
const doorPost = door => ({ x: door.x - door.outX * 3, y: 0, z: door.z - door.outZ * 3, tangent: door.outZ ? [1, 0] : [0, 1] });
const LOFT_POST = Object.freeze({ x: .95, y: LOFT.y, z: 3, tangent: [0, 1] });
const outdoorPost = (door, slot) => {
  const lateral = [0, 2, -2, 4][slot] ?? 0;
  return { x: door.x + door.outX * 4 + (door.outZ ? lateral : 0), y: 0, z: door.z + door.outZ * 4 + (door.outX ? lateral : 0), tangent: door.outZ ? [1, 0] : [0, 1], ring: true };
};
// Outdoors, survivors walk around the cabin on a ring through its corners
// (north, east, south and west edges), the shorter way round.
const RING = Object.freeze([{ x: -12, z: -10 }, { x: 12, z: -10 }, { x: 12, z: 10 }, { x: -12, z: 10 }]);
const ringEdge = point => point.z <= -9.5 ? 0 : point.x >= 11.5 ? 1 : point.z >= 9.5 ? 2 : 3;
function ringPath(from, to) {
  const start = ringEdge(from), goal = ringEdge(to), clockwise = (goal - start + 4) % 4, path = [];
  if (clockwise <= 2) for (let step = 1; step <= clockwise; step++) path.push(RING[(start + step) % 4]);
  else for (let step = 0; step < 4 - clockwise; step++) path.push(RING[(start - step + 4) % 4]);
  return path.concat([{ x: to.x, z: to.z }]);
}
function opposite(sim, side) {
  const doors = activeDoors(sim), pair = { west: 'east', east: 'west', north: 'south', south: 'north' }[side];
  return doors.find(door => door.id === pair) ?? doors.find(door => door.id !== side) ?? doorOf(sim, side);
}
// Side-relative posts: the attacked window, its door lane, the loft rail
// facing the west window, and the opposite door lane.
function postFor(sim, kind, side, slot) {
  const door = doorOf(sim, side);
  if (kind === 'window') return windowPost(door);
  if (kind === 'door') return doorPost(door);
  if (kind === 'loft') return LOFT_POST;
  if (kind === 'back') return doorPost(opposite(sim, side));
  return outdoorPost(door, slot);
}
function freeNear(sim, player, point) {
  const fits = (x, z) => { const probe = { ...player, x, z, y: point.y, crouched: false, grounded: true }; return sim.canOccupy(probe, x, z, point.y, .25); };
  if (fits(point.x, point.z)) return point;
  for (let radius = .1; radius <= 1.6; radius += .1) for (let step = 0; step < 16; step++) {
    const angle = step * Math.PI / 8, x = point.x + Math.cos(angle) * radius, z = point.z + Math.sin(angle) * radius;
    if (fits(x, z)) return { ...point, x, z };
  }
  return point;
}

// Ground-floor walking grid around and inside the cabin, built from the real
// body collisions (walls, furniture, and doorways only while passable).
const NAV = { step: .25, minX: -20, minZ: -18, cols: 161, rows: 145 };
const OUTDOOR = Uint8Array.from({ length: NAV.cols * NAV.rows }, (_, index) =>
  Math.abs(NAV.minX + (index % NAV.cols) * NAV.step) > 8 || Math.abs(NAV.minZ + Math.floor(index / NAV.cols) * NAV.step) > 6 ? 1 : 0);
const navCache = new Map();
function navGrid(sim, player) {
  const signature = sim.doors.map(door => door.sealed ? 's' : sim.doorPassable(door, 0, 1.75) ? 'o' : 'c').join('');
  if (navCache.has(signature)) return navCache.get(signature);
  const free = new Uint8Array(NAV.cols * NAV.rows);
  for (let row = 0; row < NAV.rows; row++) for (let col = 0; col < NAV.cols; col++) {
    const x = NAV.minX + col * NAV.step, z = NAV.minZ + row * NAV.step;
    free[row * NAV.cols + col] = sim.canOccupy({ ...player, x, y: 0, z, crouched: false, grounded: true }, x, z, 0, .28) ? 1 : 0;
  }
  navCache.set(signature, free);
  return free;
}
const cellOf = point => [Math.round((point.x - NAV.minX) / NAV.step), Math.round((point.z - NAV.minZ) / NAV.step)];
function nearestFree(free, [col, row]) {
  for (let radius = 0; radius < 8; radius++) for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
    const c = col + dc, r = row + dr;
    if (c >= 0 && r >= 0 && c < NAV.cols && r < NAV.rows && free[r * NAV.cols + c]) return [c, r];
  }
  return null;
}
// Paths stay indoors unless the errand itself leads outside (rain hurts).
function findPath(free, from, to, outdoors = false) {
  const start = nearestFree(free, cellOf(from)), goal = nearestFree(free, cellOf(to));
  if (!start || !goal) return null;
  const startIndex = start[1] * NAV.cols + start[0], goalIndex = goal[1] * NAV.cols + goal[0];
  const previous = new Int32Array(NAV.cols * NAV.rows).fill(-1), queue = [startIndex];
  previous[startIndex] = startIndex;
  for (let head = 0; head < queue.length && previous[goalIndex] < 0; head++) {
    const index = queue[head], col = index % NAV.cols, row = (index - col) / NAV.cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const c = col + dc, r = row + dr, next = r * NAV.cols + c;
      if (c < 0 || r < 0 || c >= NAV.cols || r >= NAV.rows || !free[next] || previous[next] >= 0 || OUTDOOR[next] && !outdoors && next !== goalIndex) continue;
      if (dc && dr && (!free[row * NAV.cols + c] || !free[r * NAV.cols + col])) continue;
      previous[next] = index; queue.push(next);
    }
  }
  if (previous[goalIndex] < 0) return null;
  const path = [];
  for (let index = goalIndex; index !== startIndex; index = previous[index]) path.push({ x: NAV.minX + (index % NAV.cols) * NAV.step, z: NAV.minZ + Math.floor(index / NAV.cols) * NAV.step });
  return path.reverse().concat([{ x: to.x, z: to.z }]);
}

// ---------------------------------------------------------------- defenders
function enemyPoint(enemy, share) {
  const height = (enemy.boss ? 1.91 : enemyPosture(enemy).height) * (enemy.scale ?? 1);
  return { x: enemy.x, y: enemy.y + height * share, z: enemy.z };
}
// Who the survivor can see from its eye, through the same solids and planks
// that stop bullets. Bodies never hide each other.
function look(sim, player) {
  const eye = { x: player.x, y: player.y + playerEyeHeight(player), z: player.z }, seen = [];
  for (const enemy of sim.zombies.values()) {
    if (!(enemy.hp > 0)) continue;
    const gap = gap2(player, enemy);
    if (gap > SIGHT_LIMIT) continue;
    for (const share of [.6, .9, .35]) if (sim.raiderLineClear(eye, enemyPoint(enemy, share))) { seen.push({ enemy, share, gap }); break; }
  }
  return seen.sort((a, b) => a.gap - b.gap || (a.enemy.id < b.enemy.id ? -1 : 1));
}

function createBot(ctx, id, profile, kind, slot, loadout) {
  return { id, profile, kind, slot, loadout, rng: seededRandom(ctx.seed * 31 + slot * 977 + 5),
    rounds: loadout.reduce((sum, name) => sum + WEAPONS[name].magazine + WEAPONS[name].reserve, 0),
    post: null, side: null, target: null, share: .6, seenAt: -Infinity, readyAt: Infinity, lostAt: -Infinity, visible: [], visibleTarget: false,
    lookAt: ctx.sim.time + slot * TICK, path: null, pathKey: null, pathIndex: 0, progressAt: 0, progressGap: Infinity, giveUpUntil: -Infinity,
    strafeDir: slot % 2 ? 1 : -1, strafeUntil: 0, hp: 0, lost: 0, lostRaider: 0, shots: 0, hits: 0, firstShotAt: null };
}

function retarget(sim, bot) {
  const now = sim.time;
  if (bot.target && !(sim.zombies.get(bot.target.id) === bot.target && bot.target.hp > 0)) { bot.target = null; bot.lostAt = now; }
  const current = bot.target && bot.visible.find(item => item.enemy === bot.target);
  if (current) {
    // A target regained after a short occlusion needs only half a reaction.
    if (now - bot.seenAt >= PEEK_HIDDEN) bot.readyAt = Math.max(bot.readyAt, now + bot.profile.reaction / 2);
    Object.assign(bot, { share: current.share, seenAt: now, visibleTarget: true });
    return;
  }
  bot.visibleTarget = false;
  if (bot.target && now - bot.seenAt < PEEK_HIDDEN) return;
  const next = bot.visible[0];
  if (!next) { if (bot.target && now - bot.seenAt >= FORGET) { bot.target = null; bot.lostAt = now; } return; }
  const switching = !!bot.target || now - bot.lostAt < 1;
  Object.assign(bot, { target: next.enemy, share: next.share, seenAt: now, visibleTarget: true,
    readyAt: now + (switching ? bot.profile.switch : bot.profile.reaction) });
}

function pickWeapon(sim, bot, player, gap) {
  const usable = name => { const inventory = player.inventory[name]; return !!inventory && inventory.ammo + inventory.reserve > 0; };
  const [primary, secondary] = bot.loadout;
  let wanted = primary;
  if (secondary === 'shotgun' && usable('shotgun') && (gap < SHOTGUN_IN || gap < SHOTGUN_OUT && player.weapon === 'shotgun')) wanted = 'shotgun';
  if (!usable(wanted)) wanted = bot.loadout.find(usable) ?? player.weapon;
  if (wanted !== player.weapon) sim.chooseWeapon(bot.id, wanted);
}

// Walking direction toward a goal on the ground floor, or null on arrival.
function steer(ctx, bot, player, goal) {
  const now = ctx.sim.time, gap = gap2(player, goal);
  if (gap < .3 || player.y > 1 || goal.y > 1 || now < bot.giveUpUntil) return null;
  const key = `${round(goal.x, 1)},${round(goal.z, 1)}`;
  const outside = point => Math.abs(point.x) > 8 || Math.abs(point.z) > 6;
  const route = () => goal.ring ? ringPath(player, goal) : findPath(navGrid(ctx.sim, player), player, goal, outside(goal) || outside(player));
  if (bot.pathKey !== key || !bot.path) Object.assign(bot, { path: route(), pathKey: key, pathIndex: 0, progressAt: now, progressGap: gap, failures: 0 });
  if (!bot.path) { bot.giveUpUntil = now + 2; bot.pathKey = null; return null; }
  if (gap < bot.progressGap - .2) Object.assign(bot, { progressAt: now, progressGap: gap });
  else if (now - bot.progressAt > 1.5) {
    bot.failures = (bot.failures ?? 0) + 1;
    if (bot.failures > 3) { bot.giveUpUntil = now + 3; bot.pathKey = null; return null; }
    Object.assign(bot, { path: route(), pathIndex: 0, progressAt: now, progressGap: gap });
    if (!bot.path) return null;
  }
  while (bot.pathIndex < bot.path.length - 1 && gap2(player, bot.path[bot.pathIndex]) < .35) bot.pathIndex++;
  const next = bot.path[bot.pathIndex], dx = next.x - player.x, dz = next.z - player.z, length = Math.hypot(dx, dz);
  return length > 1e-6 ? [dx / length, dz / length] : null;
}

function tracking(ctx, enemy, eye) {
  const motion = ctx.motion.get(enemy.id);
  if (!motion) return 0;
  const dx = enemy.x - eye.x, dz = enemy.z - eye.z, horizontal = Math.hypot(dx, dz);
  if (horizontal < 1e-6) return 0;
  const lateral = Math.abs(motion.vx * dz - motion.vz * dx) / horizontal;
  return Math.min(DEFENDER_TRACKING.max, DEFENDER_TRACKING.gain * lateral / Math.max(DEFENDER_TRACKING.floor, horizontal));
}

// Short of rounds with nothing in sight, or out of rounds at all, a survivor
// fetches the nearest ammo box within 12 m of the walls, through open
// doorways and the rain.
function ammoErrand(sim, bot, player) {
  if (player.y > 1) return null;
  const rounds = bot.loadout.reduce((sum, name) => sum + (player.inventory[name]?.ammo ?? 0) + (player.inventory[name]?.reserve ?? 0), 0);
  if (rounds > bot.rounds * .35 || rounds > 0 && (bot.target || sim.time - bot.lostAt < 1.5)) return null;
  const box = [...sim.pickups.values()].filter(pickup => pickup.kind === 'ammo' && pickup.y < 1 && Math.abs(pickup.x) < 19.5 && Math.abs(pickup.z) < 17.5)
    .sort((a, b) => gap2(player, a) - gap2(player, b))[0];
  return box ? { x: box.x, y: 0, z: box.z } : null;
}

// One survivor's decisions for this tick, through the public commands only.
function act(ctx, bot) {
  const { sim } = ctx, player = sim.players.get(bot.id), now = sim.time, profile = bot.profile;
  if (!player.alive || player.downed) return;
  if (now + 1e-9 >= bot.lookAt) { bot.lookAt = now + PERCEPTION; bot.visible = look(sim, player); retarget(sim, bot); }
  if (bot.target && !(sim.zombies.get(bot.target.id) === bot.target && bot.target.hp > 0)) retarget(sim, bot);
  // Follow the announced side once nothing holds the survivor's attention.
  if (bot.side !== ctx.side && !bot.target && now - bot.lostAt >= 1 && bot.kind !== 'loft') {
    bot.side = ctx.side; bot.post = freeNear(sim, player, postFor(sim, bot.kind, bot.side, bot.slot));
  }
  const downed = [...sim.players.values()].filter(other => other.id !== bot.id && other.alive && other.downed && player.y < 1 && Math.abs(other.y - player.y) < 1)
    .sort((a, b) => gap2(player, a) - gap2(player, b))[0];
  if (downed && gap2(player, downed) < 2) sim.interact(bot.id);
  const errand = !downed && ammoErrand(sim, bot, player);
  const goal = downed && !profile.open ? { x: downed.x, y: 0, z: downed.z } : errand || bot.post;
  let move = goal ? steer(ctx, bot, player, goal) : null;
  const atPost = !downed && bot.post && Math.abs((player.x - bot.post.x) * bot.post.tangent[1] - (player.z - bot.post.z) * bot.post.tangent[0]) < .45
    && Math.abs((player.x - bot.post.x) * bot.post.tangent[0] + (player.z - bot.post.z) * bot.post.tangent[1]) < 1.6 && Math.abs(player.y - bot.post.y) < .5;
  if (profile.strafe && atPost) {
    const [tx, tz] = bot.post.tangent, along = (player.x - bot.post.x) * tx + (player.z - bot.post.z) * tz;
    const across = (player.x - bot.post.x) * tz - (player.z - bot.post.z) * tx;
    if (now >= bot.strafeUntil || along * bot.strafeDir > 1.2) { bot.strafeDir = -bot.strafeDir; bot.strafeUntil = now + .6 + .8 * bot.rng(); }
    const correction = Math.max(-1, Math.min(1, -across * 2));
    const mx = tx * bot.strafeDir + tz * correction, mz = tz * bot.strafeDir - tx * correction, length = Math.hypot(mx, mz);
    move = [mx / length, mz / length];
  }
  const target = bot.target, ready = !!target && bot.visibleTarget && now + 1e-9 >= bot.readyAt;
  let yaw = player.yaw, pitch = player.pitch, firing = false;
  const eye = { x: player.x, y: player.y + playerEyeHeight(player), z: player.z };
  if (target) {
    const point = enemyPoint(target, bot.share);
    pickWeapon(sim, bot, player, gap2(player, target));
    yaw = bearing(eye, point); pitch = Math.atan2(point.y - eye.y, gap2(eye, point));
    const inventory = player.inventory[player.weapon];
    if (ready && player.reloadUntil <= now && inventory?.ammo > 0 && player.shotAfter - now <= TICK + 1e-9) {
      const radius = (profile.aim + tracking(ctx, target, eye)) * Math.sqrt(bot.rng()), angle = 2 * Math.PI * bot.rng();
      yaw += radius * Math.cos(angle); pitch += radius * Math.sin(angle); firing = true;
    } else if (inventory && inventory.ammo <= 0) sim.reload(bot.id);
  } else {
    if (move) yaw = Math.atan2(-move[0], -move[1]);
    const inventory = player.inventory[player.weapon], weapon = WEAPONS[player.weapon];
    if (inventory && inventory.reserve > 0 && inventory.ammo < weapon.magazine / 2) sim.reload(bot.id);
  }
  // Cover users duck behind the sill or the planks to reload.
  const crouch = !!profile.cover && atPost && player.reloadUntil > now;
  const forward = move ? -(move[0] * Math.sin(yaw) + move[1] * Math.cos(yaw)) : 0, strafe = move ? move[0] * Math.cos(yaw) - move[1] * Math.sin(yaw) : 0;
  sim.setInput(bot.id, { forward, strafe, yaw, pitch, crouch, sprint: false });
  if (firing && sim.shoot(bot.id, Math.max(0, player.shotAfter - now))) { bot.shots++; bot.firstShotAt ??= now; }
}

function trackMotion(ctx) {
  const blend = 1 - Math.exp(-TICK / .3);
  for (const enemy of ctx.sim.zombies.values()) {
    const motion = ctx.motion.get(enemy.id);
    if (!motion) { ctx.motion.set(enemy.id, { x: enemy.x, z: enemy.z, vx: 0, vz: 0 }); continue; }
    motion.vx += ((enemy.x - motion.x) / TICK - motion.vx) * blend; motion.vz += ((enemy.z - motion.z) / TICK - motion.vz) * blend;
    motion.x = enemy.x; motion.z = enemy.z;
  }
}

// ---------------------------------------------------------------- raid runs
const LAYOUT = ['window', 'door', 'loft', 'back'];
export function raidRun({ raid, players, profile: profileId, hp, loadout: loadoutKey = 'A', zombies = false, control = false, seed }) {
  const profile = PROFILES[profileId], loadout = LOADOUTS[raid][loadoutKey];
  const ctx = { seed, side: null, motion: new Map(), shots: 0, farShots: 0, farByState: {}, downs: 0, raiderDowns: 0, clearedAt: null, engage: new Map() };
  // The control replays the same horde with raids disabled, isolating what the raid adds.
  const sim = ctx.sim = new RoomSimulation('RAIDBAL', { random: seededRandom(seed), raids: !control, onEvent: event => record(ctx, event) });
  for (let index = 0; index < players; index++) sim.addPlayer(`s${index + 1}`);
  sim.start('s1');
  sim.wave = RAIDS.waves[raid - 1] - 1; sim.beginWave();
  const balance = waveBalance(sim.wave, players);
  // Late ordinals: any leftover horde is the end of a real wave (no far spawns, brutes already met).
  Object.assign(sim, { toSpawn: 0, brutesToSpawn: 0, bruteSpawnAt: [], waveSpawned: Math.max(0, balance.total - 20) });
  sim.zombies.clear(); sim.spawnWarnings.clear();
  // Rain is neutralised only for survivors standing outdoors on purpose, so
  // their loss measures the raiders and not the weather.
  if (profile.open) sim.updateOutsideDamage = () => {};
  // `zombies: true` leaves the threshold count alive at the trigger; 'earlier' (comparison) adds
  // the first spec's count, 3 + 2 per survivor, right after the trigger.
  const alive = zombies === true ? RAIDS.triggerBase + RAIDS.triggerPerPlayer * players : 0;
  for (let index = 0; index < alive; index++) sim.spawnZombie();
  ctx.bots = [...sim.players.values()].map((player, slot) => {
    player.inventory = Object.fromEntries(loadout.map(name => [name, { ammo: WEAPONS[name].magazine, reserve: WEAPONS[name].reserve }]));
    Object.assign(player, { weapon: loadout[0], hp, armor: 0 });
    return createBot(ctx, player.id, profile, profile.open ? 'outdoor' : LAYOUT[slot], slot, loadout);
  });
  ctx.byId = new Map(ctx.bots.map(bot => [bot.id, bot]));
  sim.tick(TICK);
  if (control) ctx.side = activeDoors(sim)[seed % activeDoors(sim).length].id;
  else if (!sim.raid?.triggered) throw new Error(`raid ${raid} did not trigger`);
  if (zombies === 'earlier') for (let index = 0; index < 3 + 2 * players; index++) sim.spawnZombie();
  const start = control ? sim.time : sim.raid.triggeredAt, settled = () => control ? sim.phase !== 'wave' : sim.phase !== 'wave' || sim.raid.cleared;
  // Survivors already hold their posts on the side the banner announces.
  for (const bot of ctx.bots) {
    const player = sim.players.get(bot.id);
    bot.side = ctx.side; bot.post = freeNear(sim, player, postFor(sim, bot.kind, ctx.side, bot.slot));
    Object.assign(player, { x: bot.post.x, y: bot.post.y, z: bot.post.z, vy: 0, grounded: true, crouched: false, yaw: bearing(bot.post, doorOf(sim, ctx.side)) });
    bot.hp = player.hp;
  }
  while (!settled() && sim.time - start < RUN_LIMIT) {
    for (const bot of ctx.bots) act(ctx, bot);
    sim.tick(TICK);
    trackMotion(ctx);
    for (const raider of sim.zombies.values()) {
      if (raider.kind !== 'raider' || ctx.engage.has(raider.id) || raider.ai.state === 'advance') continue;
      ctx.engage.set(raider.id, { delay: round(sim.time - raider.ai.spawnedAt, 3), wounded: raider.hp < raider.maxHp });
    }
  }
  const living = [...sim.players.values()].filter(player => player.alive && !player.downed).length;
  const outOfAmmo = ctx.bots.some(bot => Object.values(sim.players.get(bot.id).inventory).every(item => item.ammo + item.reserve <= 0));
  return {
    raid, players, profile: profileId, hp, loadout: loadoutKey, zombies, control, seed,
    wipe: sim.phase === 'gameover' || !living, cleared: control ? sim.phase === 'intermission' : !!sim.raid.cleared, timeout: !settled(),
    duration: control ? sim.phase === 'intermission' ? round(sim.time - start, 2) : null : ctx.clearedAt === null ? null : round(ctx.clearedAt - start, 2),
    total: sim.raid?.total ?? 0, killed: sim.raid?.killed ?? 0, retreated: sim.raid?.retreated ?? 0,
    downs: ctx.downs, raiderDowns: ctx.raiderDowns, lost: ctx.bots.map(bot => round(bot.lost, 1)), lostRaider: ctx.bots.map(bot => round(bot.lostRaider, 1)),
    shots: ctx.shots, farShots: ctx.farShots, farByState: ctx.farByState, engage: [...ctx.engage.values()], defenderShots: ctx.bots.reduce((sum, bot) => sum + bot.shots, 0),
    defenderHits: ctx.bots.reduce((sum, bot) => sum + bot.hits, 0), outOfAmmo,
  };
}

function record(ctx, event) {
  const sim = ctx.sim;
  if (event.event === 'raid' || event.event === 'raid-squad') ctx.side = event.side;
  else if (event.event === 'raider-shot') {
    const raider = sim.zombies.get(event.raiderId), target = raider && sim.players.get(raider.ai.targetId);
    const point = target ?? (raider && raider.ai.lastSeenX !== null ? { x: raider.ai.lastSeenX, z: raider.ai.lastSeenZ } : null);
    ctx.shots++;
    if (point && Math.hypot(event.x - point.x, event.z - point.z) > 15) { ctx.farShots++; ctx.farByState[raider.ai.state] = (ctx.farByState[raider.ai.state] ?? 0) + 1; }
  } else if (event.event === 'hit') {
    const bot = ctx.byId?.get(event.id), player = sim.players.get(event.id);
    if (!bot || !player) return;
    const lost = Math.max(0, bot.hp - player.hp);
    bot.hp = player.hp; bot.lost += lost;
    if (event.source === 'raider') bot.lostRaider += lost;
  } else if (event.event === 'revive') { const bot = ctx.byId?.get(event.targetId); if (bot) bot.hp = sim.players.get(event.targetId).hp; }
  else if (event.event === 'down') { ctx.downs++; if (event.source === 'raider') ctx.raiderDowns++; }
  else if (event.event === 'raid-cleared') ctx.clearedAt = event.time;
  else if (event.event === 'shot') { const bot = ctx.byId?.get(event.id); if (bot) bot.hits += event.hits; }
}

// ---------------------------------------------------------------- micro-benchmarks
function quietRoom(seed, onEvent) {
  const sim = new RoomSimulation('RAIDMB', { random: seededRandom(seed), onEvent });
  const player = sim.addPlayer('s1'); sim.start('s1');
  sim.wave = 13; sim.beginWave(); sim.spawnTimer = 1e9;
  sim.zombies.clear(); sim.spawnWarnings.clear();
  return { sim, player };
}
function placeRaider(sim, { x, z, loadout, raid = 1, damageScale = 1 }) {
  const raider = sim.createRaider(1, { id: null, doorId: 'east', x, z }, { index: raid, damageScale }, { point: { x, z }, loadout });
  sim.zombies.set(raider.id, raider);
  Object.assign(raider.ai, { state: 'engage', engagedAt: sim.time, engageUntil: Infinity, holdUntil: Infinity });
  return raider;
}
const MOTIONS = Object.freeze({ still: null, walk: { sprint: false, turn: [.8, 1.6], reach: 3 }, sprint: { sprint: true, turn: [1.5, 2.5], reach: 5 } });
// One raider holding its spot against one survivor in the open: the time its
// hits take to remove `hp` (armour 0, damageScale as given).
export function raiderDuel({ loadout, distance, motion = 'still', seed, raid = 1, damageScale = 1, hp = 100, limit = 60 }) {
  let dealt = 0, downAt = null, hits = 0;
  const { sim, player } = quietRoom(seed, event => {
    if (event.event !== 'hit' || event.source !== 'raider' || downAt !== null) return;
    dealt += event.damage - event.absorbed; hits++;
    if (dealt >= hp - 1e-9) downAt = event.time;
  });
  sim.raiderEngageStep = raider => { raider.ai.holding = true; return false; };
  const raider = placeRaider(sim, { x: 20, z: -8, loadout, raid, damageScale });
  player.inventory = { smg: { ammo: 40, reserve: 0 } };
  Object.assign(player, { weapon: 'smg', x: 20, y: 0, z: -8 + distance, hp: 1e6 });
  const style = MOTIONS[motion], rng = seededRandom(seed * 7 + 3), start = sim.time;
  let direction = 1, turnAt = 0;
  while (downAt === null && sim.time - start < limit) {
    let strafe = 0;
    if (style) {
      if (sim.time >= turnAt || (player.x - 20) * direction > style.reach) { direction = -direction; turnAt = sim.time + style.turn[0] + (style.turn[1] - style.turn[0]) * rng(); }
      strafe = direction;
    }
    sim.setInput('s1', { forward: 0, strafe, yaw: bearing(player, raider), pitch: 0, sprint: !!style?.sprint });
    sim.tick(TICK);
  }
  return { seconds: downAt === null ? null : round(downAt - start, 3), hits };
}

// The crouched survivor under the west-b sill; raiders hold several outside
// spots and must never hit.
export function sillCheck({ loadout, seed, seconds = 12 }) {
  const spots = [[-17, 0], [-17, 3], [-17, 6.5], [-12, 3.5], [-25, 3.5], [-14, -2]];
  let hits = 0, shots = 0;
  for (const [x, z] of spots) {
    const { sim, player } = quietRoom(seed + x * 13 + z, event => { if (event.event === 'hit' && event.source === 'raider') hits++; if (event.event === 'raider-shot') shots++; });
    sim.raiderEngageStep = raider => { raider.ai.holding = true; return false; };
    placeRaider(sim, { x, z, loadout });
    const post = windowPost(doorOf(sim, 'west'));
    Object.assign(player, { x: post.x, y: 0, z: post.z, hp: 1e6, crouched: true });
    for (let step = 0; step < seconds * TICK_RATE; step++) { sim.setInput('s1', { forward: 0, strafe: 0, yaw: -Math.PI / 2, pitch: 0, crouch: true }); sim.tick(TICK); }
  }
  return { hits, shots };
}

// A defender profile against one frozen raider standing 10 m away in the open.
export function playerKill({ profile: profileId, raid, loadout: loadoutKey, seed, distance = 10, limit = 30 }) {
  const ctx = { seed, side: 'east', motion: new Map(), engage: new Map() };
  let killAt = null;
  const { sim, player } = quietRoom(seed, event => { if (event.event === 'kill' && event.raider) killAt = event.time; record(ctx, event); });
  ctx.sim = sim;
  sim.updateRaider = () => false;
  const raider = placeRaider(sim, { x: 20, z: -8, loadout: 'smg', raid });
  const loadout = LOADOUTS[raid][loadoutKey];
  player.inventory = Object.fromEntries(loadout.map(name => [name, { ammo: WEAPONS[name].magazine, reserve: WEAPONS[name].reserve }]));
  Object.assign(player, { weapon: loadout[0], x: 20, y: 0, z: -8 + distance, hp: 1e6 });
  const bot = createBot(ctx, 's1', PROFILES[profileId], 'outdoor', 0, loadout);
  bot.post = { x: player.x, y: 0, z: player.z, tangent: [1, 0] }; bot.side = 'east';
  ctx.bots = [bot]; ctx.byId = new Map([['s1', bot]]);
  const start = sim.time;
  while (killAt === null && sim.time - start < limit) { act(ctx, bot); sim.tick(TICK); trackMotion(ctx); }
  return { seconds: killAt === null ? null : round(killAt - start, 3), fromFirstShot: killAt === null || bot.firstShotAt === null ? null : round(killAt - bot.firstShotAt, 3),
    shots: bot.shots, hits: bot.hits, hp: raider.maxHp };
}

// ---------------------------------------------------------------- load
export function loadScenario({ ticks = 600 } = {}) {
  const sim = new RoomSimulation('RAIDLOAD', { random: seededRandom(0x5eed) });
  for (let index = 0; index < 4; index++) sim.addPlayer(`s${index + 1}`);
  sim.start('s1'); sim.wave = 14; sim.beginWave();
  const balance = waveBalance(15, 4), posts = ['window', 'door', 'loft', 'back'];
  [...sim.players.values()].forEach((player, slot) => {
    const post = freeNear(sim, player, postFor(sim, posts[slot], 'west', slot));
    Object.assign(player, { x: post.x, y: post.y, z: post.z, hp: 1e9, vy: 0, grounded: true });
  });
  Object.assign(sim, { toSpawn: 0, brutesToSpawn: 0, bruteSpawnAt: [] });
  sim.zombies.clear(); sim.spawnWarnings.clear();
  for (let index = 0; index < balance.maxActive; index++) Object.assign(sim.spawnZombie(), { hp: 1e9, maxHp: 1e9 });
  // Force the trigger with the whole horde alive (the 35 s fallback worst case).
  const horde = [...sim.zombies.entries()];
  sim.zombies.clear();
  if (!sim.triggerRaid(sim.livingPlayers())) throw new Error('load trigger failed');
  for (const [id, zombie] of horde) sim.zombies.set(id, zombie);
  const raiders = () => [...sim.zombies.values()].filter(zombie => zombie.kind === 'raider');
  const cap = sim.raid.squad + Math.floor(sim.raid.squad / 2);
  for (let step = 0; step < 30 * 30 && raiders().length < cap; step++) {
    if (!sim.raidWarnings.size && raiders().length < cap) sim.raid.lastSquadAt = sim.time - RAIDS.nextSquadAfter[3];
    sim.tick(TICK);
    for (const raider of raiders()) if (raider.maxHp < 1e9) Object.assign(raider, { hp: 1e9, maxHp: 1e9 }, { ai: Object.assign(raider.ai, { lastHp: 1e9 }) });
  }
  const times = [], bytes = [];
  for (let step = 0; step < ticks; step++) {
    const begin = performance.now(); sim.tick(TICK); times.push(performance.now() - begin);
    if (step % 30 === 0) bytes.push(Buffer.byteLength(JSON.stringify(sim.snapshot())));
  }
  return { players: 4, wave: 15, ticks, zombies: [...sim.zombies.values()].filter(zombie => zombie.kind !== 'raider').length, raiders: raiders().length, raiderCap: cap,
    tickMs: { median: round(median(times), 3), p95: round(quantile(times, .95), 3), max: round(Math.max(...times), 3) }, snapshotBytes: { median: median(bytes), max: Math.max(...bytes) } };
}

// ---------------------------------------------------------------- jobs
function runJob(job) {
  if (job.kind === 'raid') return raidRun(job);
  if (job.kind === 'duel') return raiderDuel(job);
  if (job.kind === 'sill') return sillCheck(job);
  if (job.kind === 'kill') return playerKill(job);
  throw new Error(job.kind);
}
if (!isMainThread) parentPort.on('message', job => parentPort.postMessage({ index: job.index, result: runJob(job) }));

function plan({ seeds, quick }) {
  const jobs = [], cells = [];
  const seedsFor = (key, count = seeds) => Array.from({ length: count }, (_, index) => (hash(key) + index * 7919) >>> 0);
  // The down and wipe targets are rare-event rates: their reference cells get
  // four times (solo) or twice (groups) the seeds.
  const raidCell = cell => {
    const key = `raid:${cell.raid}:${cell.players}:${cell.profile}:${cell.hp}:${cell.loadout}:${cell.zombies === 'earlier' ? 'earlier' : cell.zombies ? 1 : 0}${cell.control ? ':control' : ''}`;
    const count = cell.group === 'main' && cell.profile === 'average' ? seeds * (cell.players === 1 ? 4 : 2) : seeds;
    cells.push({ ...cell, key, group: cell.group });
    for (const seed of seedsFor(key, count)) jobs.push({ kind: 'raid', key, ...cell, seed });
  };
  const counts = [1, 2, 3, 4];
  for (const raid of [1, 2, 3]) for (const players of counts) {
    for (const profile of Object.keys(PROFILES)) raidCell({ group: 'main', raid, players, profile, hp: 70, loadout: 'A' });
    for (const hp of [100, 40]) raidCell({ group: 'strata', raid, players, profile: 'average', hp, loadout: 'A' });
    raidCell({ group: 'zombies', raid, players, profile: 'average', hp: 70, loadout: 'A', zombies: true });
    raidCell({ group: 'control', raid, players, profile: 'average', hp: 70, loadout: 'A', zombies: true, control: true });
    raidCell({ group: 'zombiesEarlier', raid, players, profile: 'average', hp: 70, loadout: 'A', zombies: 'earlier' });
    for (const loadout of Object.keys(LOADOUTS[raid]).filter(key => key !== 'A')) raidCell({ group: 'loadouts', raid, players, profile: 'average', hp: 70, loadout });
  }
  const microSeeds = quick ? 12 : 40;
  const microSeedsFor = key => Array.from({ length: microSeeds }, (_, index) => (hash(key) + index * 104729) >>> 0);
  for (const loadout of Object.keys(RAIDER_LOADOUTS)) for (const distance of [5, 10, 20]) for (const motion of Object.keys(MOTIONS)) {
    const key = `duel:${loadout}:${distance}:${motion}`;
    cells.push({ key, group: 'duel', loadout, distance, motion });
    for (const seed of microSeedsFor(key)) jobs.push({ kind: 'duel', key, loadout, distance, motion, seed });
  }
  for (const loadout of Object.keys(RAIDER_LOADOUTS)) {
    const key = `sill:${loadout}`;
    cells.push({ key, group: 'sill', loadout });
    for (const seed of microSeedsFor(key).slice(0, quick ? 2 : 6)) jobs.push({ kind: 'sill', key, loadout, seed });
  }
  for (const raid of [1, 2, 3]) for (const loadout of Object.keys(LOADOUTS[raid])) for (const profile of ['competent', 'average']) {
    const key = `kill:${raid}:${loadout}:${profile}`;
    cells.push({ key, group: 'kill', raid, loadout, profile });
    for (const seed of microSeedsFor(key)) jobs.push({ kind: 'kill', key, raid, loadout, profile, seed });
  }
  return { jobs: jobs.map((job, index) => ({ ...job, index })), cells };
}

async function runPool(jobs, workers) {
  const results = new Array(jobs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: workers }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url));
    const feed = () => next < jobs.length ? worker.postMessage(jobs[next++]) : worker.terminate().then(resolve);
    worker.on('message', ({ index, result }) => { results[index] = result; done++; if (done % 500 === 0) process.stderr.write(`${done}/${jobs.length}\n`); feed(); });
    worker.on('error', reject);
    feed();
  })));
  return results;
}

// ---------------------------------------------------------------- analysis
function summarizeRaid(runs) {
  const lost = runs.flatMap(run => run.lost), lostRaider = runs.flatMap(run => run.lostRaider), engage = runs.flatMap(run => run.engage);
  const durations = runs.map(run => run.duration).filter(Number.isFinite);
  return {
    runs: runs.length, wipes: round(share(runs, run => run.wipe), 4), downRuns: round(share(runs, run => run.downs > 0), 4),
    downsPerRun: round(mean(runs.map(run => run.downs)), 3), raiderDownShare: round(runs.reduce((sum, run) => sum + run.raiderDowns, 0) / Math.max(1, runs.reduce((sum, run) => sum + run.downs, 0)), 3), cleared: round(share(runs, run => run.cleared), 4), timeouts: runs.filter(run => run.timeout).length,
    killedShare: round(mean(runs.filter(run => run.total).map(run => run.killed / run.total)), 3), retreatRuns: round(share(runs, run => run.retreated > 0), 4),
    durationP50: round(median(durations), 1), durationP95: round(quantile(durations, .95), 1),
    lostMedian: round(median(lost), 1), lostP90: round(quantile(lost, .9), 1), lostRaiderMedian: round(median(lostRaider), 1),
    lostMean: round(mean(lost), 1), untouched: round(share(lost, value => value < .5), 3),
    lostBySlot: LAYOUT.map((_, slot) => round(median(runs.filter(run => run.lost.length > slot).map(run => run.lost[slot])), 1)).slice(0, Math.max(...runs.map(run => run.lost.length))),
    shots: runs.reduce((sum, run) => sum + run.shots, 0), farShare: round(runs.reduce((sum, run) => sum + run.farShots, 0) / Math.max(1, runs.reduce((sum, run) => sum + run.shots, 0)), 4),
    engageMedian: round(median(engage.map(item => item.delay)), 2), engageP10: round(quantile(engage.map(item => item.delay), .1), 2), engageP90: round(quantile(engage.map(item => item.delay), .9), 2),
    engageInWindow: round(share(engage, item => item.delay >= 4 && item.delay <= 7), 3), engageWounded: round(share(engage, item => item.wounded), 3),
    engageUnwoundedMedian: round(median(engage.filter(item => !item.wounded).map(item => item.delay)), 2),
    farByState: runs.reduce((total, run) => { for (const [state, count] of Object.entries(run.farByState)) total[state] = (total[state] ?? 0) + count; return total; }, {}),
    defenderAccuracy: round(runs.reduce((sum, run) => sum + run.defenderHits, 0) / Math.max(1, runs.reduce((sum, run) => sum + run.defenderShots, 0)), 3),
    outOfAmmo: runs.filter(run => run.outOfAmmo).length,
  };
}
function summarize(cells, jobs, results) {
  const byKey = new Map(cells.map(cell => [cell.key, []]));
  jobs.forEach((job, index) => byKey.get(job.key).push(results[index]));
  return cells.map(cell => {
    const runs = byKey.get(cell.key);
    if (cell.group === 'duel') {
      const seconds = runs.map(run => run.seconds ?? Infinity);
      return { ...cell, runs: runs.length, median: round(median(seconds), 2), p25: round(quantile(seconds, .25), 2), p75: round(quantile(seconds, .75), 2), censored: runs.filter(run => run.seconds === null).length };
    }
    if (cell.group === 'sill') return { ...cell, runs: runs.length, hits: runs.reduce((sum, run) => sum + run.hits, 0), shots: runs.reduce((sum, run) => sum + run.shots, 0) };
    if (cell.group === 'kill') {
      return { ...cell, runs: runs.length, median: round(median(runs.map(run => run.seconds ?? Infinity)), 2), fromFirstShot: round(median(runs.map(run => run.fromFirstShot ?? Infinity)), 2),
        accuracy: round(runs.reduce((sum, run) => sum + run.hits, 0) / Math.max(1, runs.reduce((sum, run) => sum + run.shots, 0)), 3), raiderHp: runs[0]?.hp };
    }
    return { ...cell, ...summarizeRaid(runs), _runs: runs };
  });
}

const pick = (summary, filter) => summary.filter(cell => Object.entries(filter).every(([key, value]) => cell[key] === value));
function pooled(summary, filter) { return summarizeRaid(pick(summary, filter).flatMap(cell => cell._runs)); }

function targets(summary, load) {
  const duel = (loadout, distance, motion) => pick(summary, { group: 'duel', loadout, distance, motion })[0]?.median;
  const still = duel('smg', 10, 'still'), walk = duel('smg', 10, 'walk'), sprint = duel('smg', 10, 'sprint');
  const sill = pick(summary, { group: 'sill' }).reduce((sum, cell) => sum + cell.hits, 0);
  const soloDowns = [1, 2, 3].map(raid => pick(summary, { group: 'main', raid, players: 1, profile: 'average' })[0].wipes);
  const groups = raid => summarizeRaid(pick(summary, { group: 'main', raid, profile: 'average' }).filter(cell => cell.players > 1).flatMap(cell => cell._runs));
  const groupWipes = [1, 2, 3].map(raid => groups(raid).wipes), raid3Down = groups(3).downRuns;
  const lost = Object.fromEntries(Object.keys(PROFILES).map(profile => [profile, pooled(summary, { group: 'main', profile }).lostMedian]));
  const everything = pooled(summary, { group: 'main' });
  const competent = pooled(summary, { group: 'main', profile: 'competent' });
  const check = (id, label, value, pass, goal, detail = '') => ({ id, label, value, goal, pass: !!pass, detail });
  return [
    check('smg-ttd', 'Pillard PM (raid 1) contre survivant debout à 10 m, 100 PV : médiane du temps de mise à terre', still, still >= 6 && still <= 10, '6–10 s'),
    check('walk-ratio', 'Décalage en marchant / immobile', round(walk / still, 2), walk / still <= 2.5, '≤ 2,5×'),
    check('sprint-ratio', 'Course latérale / immobile', round(sprint / still, 2), sprint / still >= 2 && sprint / still <= 3, '2–3×'),
    check('sill', 'Accroupi sous l’appui de fenêtre : touches reçues', sill, sill === 0, '0'),
    ...[1, 2, 3].map((raid, index) => check(`solo-${raid}`, `Solo humain moyen à 70 PV, raid ${raid} : parties perdues (à terre)`, soloDowns[index], soloDowns[index] <= [.02, .05, .1][index], `≤ ${[2, 5, 10][index]} %`)),
    ...[1, 2, 3].map((raid, index) => check(`wipe-${raid}`, `2–4 joueurs humains moyens, raid ${raid} : équipe entière à terre`, groupWipes[index], groupWipes[index] <= [.01, .02, .04][index], `≤ ${[1, 2, 4][index]} %`)),
    check('raid3-down', '2–4 joueurs, raid 3 : parties avec au moins un survivant à terre', raid3Down, raid3Down >= .25, '≥ 25 %'),
    check('lost-average', 'PV perdus par survivant (médiane), humain moyen', lost.average, lost.average >= 20 && lost.average <= 60, '20–60'),
    check('lost-competent', 'PV perdus, bot compétent / humain moyen', round(lost.competent / lost.average, 2), lost.competent <= lost.average / 2, '≤ 0,5×'),
    check('lost-naive', 'PV perdus, naïf à découvert / humain moyen', round(lost.naive / lost.average, 2), lost.naive >= lost.average * 2, '≥ 2×'),
    check('far-shots', 'Tirs de pillards à plus de 15 m', everything.farShare, everything.farShare < .2, '< 20 %',
      `par état : ${Object.entries(everything.farByState).sort((a, b) => b[1] - a[1]).map(([state, count]) => `${state} ${count}`).join(', ')} (sur ${everything.shots} tirs)`),
    check('engage', 'Apparition → engagement, pillards non blessés avant (médiane)', everything.engageUnwoundedMedian, everything.engageUnwoundedMedian >= 4 && everything.engageUnwoundedMedian <= 7, '4–7 s',
      `tous les pillards : médiane ${num(everything.engageMedian)} s, ${pct(everything.engageWounded)} engagent après une blessure, ${pct(everything.engageInWindow)} entre 4 et 7 s`),
    check('duration', 'Durée du raid p95, défenseurs compétents', competent.durationP95, competent.durationP95 < .6 * RAIDS.capAfterLastSquad, `< ${.6 * RAIDS.capAfterLastSquad} s`),
    check('load', 'Charge : p95 du tick', load?.tickMs.p95, load && load.tickMs.p95 < 4, '< 4 ms'),
  ];
}

const constants = () => ({
  loadouts: Object.fromEntries(Object.entries(RAIDER_LOADOUTS).map(([key, gun]) => [key, { damage: gun.damage, spread: gun.spread, burst: [...gun.burst], pause: [...gun.pause], engageRange: gun.engageRange }])),
  raids: { hp: [...RAIDS.hp], damageScale: [...RAIDS.damageScale], squadSize: [...RAIDS.squadSize], nextSquadAfter: [...RAIDS.nextSquadAfter], soloStagger: RAIDS.soloStagger, bodyDamage: [...RAIDS.bodyDamage] },
  aim: JSON.parse(JSON.stringify(RAIDER_AIM_TUNING)),
  compositions: RAID_COMPOSITIONS.map(list => [...list]),
});

// ---------------------------------------------------------------- report
const pct = value => value === null || value === undefined ? '—' : `${round(value * 100, 1).toString().replace('.', ',')} %`;
const num = (value, digits = 1) => value === null || value === undefined ? '—' : value === Infinity ? '> limite' : round(value, digits).toString().replace('.', ',');
const inSeconds = value => value === null || value === undefined ? '—' : `${num(value)} s`;
const GUN_NAMES = Object.freeze({ pistol: 'pistolet', smg: 'PM', shotgun: 'fusil à pompe', assault: 'fusil d’assaut', rifle: 'mitrailleuse', sniper: 'fusil à verrou', magnum: 'magnum' });
const guns = list => list.map(name => GUN_NAMES[name] ?? name).join(' + ');
function markdown(output) {
  const { summary, checks, load, before, settings } = output;
  const cells = (group, filter = {}) => pick(summary, { group, ...filter });
  const raidRows = group => cells(group).map(cell =>
    `| ${cell.raid} | ${cell.players} | ${PROFILES[cell.profile].label} | ${cell.hp} | ${guns(LOADOUTS[cell.raid][cell.loadout])} | ${cell.runs} | ${pct(cell.downRuns)} | ${pct(cell.wipes)} | ${num(cell.lostMedian)} | ${num(cell.lostP90)} | ${num(cell.durationP50)} / ${num(cell.durationP95)} s | ${pct(cell.killedShare)} | ${pct(cell.farShare)} | ${inSeconds(cell.engageUnwoundedMedian)} |`).join('\n');
  const header = '| Raid | Joueurs | Profil | PV | Armes | Parties | ≥ 1 à terre | Fin de partie | PV perdus (méd.) | PV perdus (p90) | Durée p50 / p95 | Pillards abattus | Tirs > 15 m | Engagement* |\n|---:|---:|---|---:|---|---:|---:|---:|---:|---:|---|---:|---:|---:|';
  const duels = cells('duel'), duel = (loadout, distance, motion = 'still') => duels.find(cell => cell.loadout === loadout && cell.distance === distance && cell.motion === motion)?.median;
  const duelRow = loadout => `| ${GUN_NAMES[loadout]} | ${['still', 'walk', 'sprint'].flatMap(motion => [5, 10, 20].map(distance => num(duel(loadout, distance, motion)))).join(' | ')} |`;
  const kills = cells('kill');
  const ratioRows = [1, 2, 3].flatMap(raid => {
    const ttd = mean([...new Set(RAID_COMPOSITIONS[raid - 1])].map(gun => duel(gun, 10)).filter(Number.isFinite));
    return Object.keys(LOADOUTS[raid]).map(loadout => {
      const [competent, average] = ['competent', 'average'].map(profile => kills.find(cell => cell.raid === raid && cell.loadout === loadout && cell.profile === profile));
      return `| ${raid} | ${guns(LOADOUTS[raid][loadout])} | ${num(ttd)} s | ${num(competent?.median, 2)} s (${pct(competent?.accuracy)}) | ${num(average?.median, 2)} s (${pct(average?.accuracy)}) | ${num(ttd / competent?.median)}× | ${num(ttd / average?.median)}× |`;
    });
  }).join('\n');
  const show = (id, value) => typeof value === 'number' && value <= 1 && /solo|wipe|raid3|far/.test(id) ? pct(value) : num(value, 2);
  const checkRows = checks.map(item => {
    const old = before?.checks?.find(entry => entry.id === item.id);
    return `| ${item.label} | ${item.goal} | ${old ? `${show(item.id, old.value)} ${old.pass ? '✔' : '✘'}` : '—'} | ${show(item.id, item.value)} | ${item.pass ? '✔ atteinte' : '✘ non atteinte'} | ${item.detail ?? ''} |`;
  }).join('\n');
  const changed = [];
  const constantRows = (() => {
    const now = output.constants, old = before?.constants, rows = [];
    const line = (label, a, b) => {
      const same = JSON.stringify(a) === JSON.stringify(b);
      if (!same && a !== undefined) changed.push(label);
      rows.push(`| ${label} | ${a === undefined ? '—' : JSON.stringify(a).replaceAll(',', ', ')} | ${JSON.stringify(b).replaceAll(',', ', ')}${same || a === undefined ? '' : ' ◀'} |`);
    };
    for (const [key, gun] of Object.entries(now.loadouts)) for (const [field, value] of Object.entries(gun)) line(`${key}.${field}`, old?.loadouts?.[key]?.[field], value);
    for (const [field, value] of Object.entries(now.raids)) line(`RAIDS.${field}`, old?.raids?.[field], value);
    for (const [field, value] of Object.entries(now.aim ?? {})) line(`RAIDER_AIM_TUNING.${field}`, old?.aim?.[field], value);
    return rows.join('\n');
  })();
  const sill = cells('sill');
  const at = (group, raid, players, field) => cells(group, { raid, players })[0]?.[field];
  const zombieRows = [1, 2, 3].flatMap(raid => [1, 2, 3, 4].map(players => `| ${raid} | ${players} | ${RAIDS.triggerBase + RAIDS.triggerPerPlayer * players} | ${pct(at('zombies', raid, players, 'downRuns'))} | ${pct(at('zombies', raid, players, 'wipes'))} | ${pct(at('zombies', raid, players, 'raiderDownShare'))} | ${pct(at('control', raid, players, 'downRuns'))} / ${pct(at('control', raid, players, 'wipes'))} | ${3 + 2 * players} | ${pct(at('zombiesEarlier', raid, players, 'downRuns'))} / ${pct(at('zombiesEarlier', raid, players, 'wipes'))} |`)).join('\n');
  const slotRows = [1, 2, 3].flatMap(raid => [2, 3, 4].map(players => {
    const cell = cells('main', { raid, players, profile: 'average' })[0];
    return `| ${raid} | ${players} | ${cell.lostBySlot.map(value => num(value)).join(' | ')}${' | —'.repeat(4 - cell.lostBySlot.length)} | ${pct(cell.untouched)} |`;
  })).join('\n');
  const main = pooled(summary, { group: 'main' }), averageAll = pooled(summary, { group: 'main', profile: 'average' });
  const soloRaid = (group, raid, profile = 'average') => cells(group, { raid, players: 1, profile })[0];
  const solo3 = soloRaid('main', 3), soloZombies3 = soloRaid('zombies', 3), soloControl3 = soloRaid('control', 3), soloEarlier3 = soloRaid('zombiesEarlier', 3);
  const naiveSolo3 = soloRaid('main', 3, 'naive'), strafeSolo3 = soloRaid('main', 3, 'strafing');
  const lostByRaid = [1, 2, 3].map(raid => num(pooled(summary, { group: 'main', raid, profile: 'average' }).lostMedian)).join(' / ');
  const soloLost = num(summarizeRaid(cells('main', { players: 1, profile: 'average' }).flatMap(cell => cell._runs)).lostMedian);
  const failed = checks.filter(item => !item.pass);
  return `# Équilibrage des pillards — ${DATE}

> **Avertissement.** Les défenseurs de ce rapport sont des **scripts**, pas des joueurs. Ils voient, visent et tirent selon des règles fixes
> (temps de réaction, erreur de visée, changement de cible) dans la **vraie** simulation autoritaire. Ce n’est ni une partie clavier/souris,
> ni une écoute, ni un rendu navigateur. Les chiffres servent à comparer des réglages entre eux, pas à prédire ce que ressentira un humain.

Généré par \`node validation/raid-balance-report.mjs${settings.quick ? ' --quick' : ''}\` : ${settings.seeds} graines par case (×4 en solo et ×2 en groupe pour les cases de référence « humain moyen »), ${settings.microSeeds} pour les micro-mesures, ${settings.jobs} simulations, ${num(settings.seconds, 0)} s sur ${settings.workers} fils, Node ${process.version}. \`--quick\` fait un passage réduit.

## Synthèse

- **Réglages retenus** : ${changed.length ? changed.map(label => `\`${label}\``).join(', ') : 'aucun changement'} (détail plus bas). Les dégâts, dispersions, rafales et pauses des armes restent ceux de la spec.
- **Cibles** : ${checks.length - failed.length}/${checks.length} atteintes. Non atteintes : ${failed.map(item => `« ${item.label} »`).join(' ; ') || 'aucune'}. Les raisons sont expliquées plus bas.
- **Zombies encore vivants au déclenchement** : le raid part quand il reste au plus ${RAIDS.triggerBase} + ${RAIDS.triggerPerPlayer} × joueurs zombies (un par survivant). Avec ces derniers zombies, un humain moyen seul à 70 PV finit la partie au raid 3 dans ${pct(soloZombies3?.wipes)} des cas, contre ${pct(soloControl3?.wipes)} face aux mêmes zombies sans raid et ${pct(solo3?.wipes)} sans zombies. Avec le seuil de la première spec (3 + 2 × joueurs), ce serait ${pct(soloEarlier3?.wipes)}.
- **Tirs lointains** : ${pct(main.farShare)} des tirs partent de plus de 15 m. Un pillard ne tire plus en courant au-delà de ${RAIDER_AIM_TUNING.advanceFireRange} m et, blessé loin de sa cible, il fonce vers la cabane au lieu de répliquer depuis l’entrée ; le reste vient surtout des tirs d’engagement et de couverture au point d’attente.
- **Danger visible** : en groupe, le survivant du couloir de porte tombe souvent (relevé ensuite) ; en solo, la fenêtre et l’accroupissement pour recharger protègent bien. Rester debout dehors (naïf) multiplie les fins de partie solo au raid 3 par ${num(naiveSolo3?.wipes / Math.max(.001, solo3?.wipes))} (${pct(naiveSolo3?.wipes)} contre ${pct(solo3?.wipes)}).

## Méthode

- **Simulation réelle.** Chaque partie est une \`RoomSimulation\` à 30 Hz. Les survivants n’agissent que par les commandes publiques (\`setInput\`, \`shoot\`, \`reload\`, \`chooseWeapon\`, \`interact\`). Les pillards utilisent l’IA réelle (\`updateRaider\`), sans aucun remplacement de méthode.
- **Déclenchement.** La vague de raid (5, 10 ou 15) commence, la horde est retirée (ou réduite au seuil dans les cas « zombies vivants », avec les derniers zombies réels de la vague), et le raid se déclenche au tick suivant par la règle normale.
- **Perception des défenseurs.** Toutes les 0,1 s, depuis l’œil, à travers les mêmes solides et planches que les balles (\`raiderLineClear\`). Cible : la plus proche visible, zombie ou pillard, conservée tant qu’elle reste visible (0,4 s d’occultation tolérée, demi-réaction au retour).
- **Profils.** ${Object.values(PROFILES).map(profile => `${profile.label} : réaction ${num(profile.reaction, 2)} s, erreur ${num(profile.aim, 2)} rad, changement de cible ${num(profile.switch, 1)} s`).join(' ; ')}. L’erreur est un disque angulaire uniforme ajouté à la dispersion réelle de l’arme, plus un terme de suivi de même forme que celui des pillards dans la spec (0,12 × vitesse latérale lissée / max(6, distance), au plus 0,06), fixe pour que le réglage des pillards ne change jamais la visée des survivants.
- **Postes** (relatifs au côté annoncé par la bannière) : 1 joueur à la fenêtre ouverte du côté attaqué (1 m à l’intérieur) ; 2 joueurs + couloir de la porte (3 m à l’intérieur) ; 3 joueurs + balustrade de la mezzanine face à la fenêtre ouest ; 4 joueurs + couloir de la porte opposée. Les profils « compétent », « moyen » et « qui se décale » s’accroupissent pour recharger ; le dernier marche en plus le long du mur (±1,2 m, inversion toutes les 0,6–1,4 s). Le profil « naïf » reste debout dehors, 4 m devant la porte attaquée, et fait le tour de la cabane quand une escouade arrive d’un autre côté (pluie neutralisée pour lui seul, afin de ne mesurer que les pillards).
- **Déplacements.** Les survivants marchent sur une grille construite avec les vraies collisions : vers le côté d’une nouvelle escouade quand plus rien ne les occupe, vers un coéquipier à terre pour le relever, et vers la boîte de munitions la plus proche (à moins de 12 m des murs, par une porte dégagée, sous la pluie) quand il leur reste moins de 35 % de leurs cartouches et que rien n’est en vue, ou plus aucune cartouche. Pas de relève entre étages.
- **Armes.** Raid 1 : pistolet + pompe (A), PM + pompe (B). Raid 2 : PM + pompe (A), fusil d’assaut (B). Raid 3 : fusil d’assaut + mitrailleuse (A), fusil à verrou + assaut (S), magnum + assaut (M). Chargeur et réserve complets au départ. Le fusil à pompe sert sous 6,5 m.
- **Mesures.** « PV perdus » = PV réellement retirés pendant le raid, toutes sources, par survivant (un survivant relevé peut dépasser ses PV de départ). « Fin de partie » = toute l’équipe à terre ; en solo, une mise à terre est une fin de partie. Durée = déclenchement → \`raid-cleared\`. *Engagement : médiane du délai apparition → engagement des pillards non blessés avant d’engager.
- **Non modélisé.** Réparations, soins, grenades, achats, communication, peur, fatigue, erreurs humaines de déplacement ; les PV de départ sont une strate fixe, pas le reste réel de la vague.

## Réglages (avant → après)

« ◀ » marque une valeur changée. Bornes : armes à ±40 % des valeurs de la spec ; \`RAIDER_AIM_TUNING\` regroupe la part réglable de l’erreur de visée, déplacée de \`raiders.mjs\` vers \`public/raids.js\` sans changement de comportement.

| Constante | Avant | Après |
|---|---|---|
${constantRows}

## Cibles

| Cible | Objectif | Avant | Après | Statut | Détail |
|---|---|---|---|---|---|
${checkRows}

### Pourquoi certaines cibles restent hors d’atteinte

- **PV perdus médians 20–60 (humain moyen).** La médiane groupée vaut ${num(averageAll.lostMedian)} PV, par raid ${lostByRaid}, et ${soloLost} en solo. En groupe, les postes mezzanine et porte opposée ne sont presque jamais visés (${pct(averageAll.untouched)} des survivants ne perdent aucun PV), ce qui tire la médiane vers le bas. À 10 m, un survivant scripté abat un pillard immobile en ${num(Math.min(...kills.map(cell => cell.median)))} à ${num(Math.max(...kills.map(cell => cell.median)))} s, alors qu’un pillard met ${num(Math.min(...duels.filter(cell => cell.distance === 10 && cell.motion === 'still').map(cell => cell.median)))} à ${num(Math.max(...duels.filter(cell => cell.distance === 10 && cell.motion === 'still').map(cell => cell.median)))} s à mettre à terre un survivant exposé. Monter la létalité pour atteindre 20 ferait d’abord exploser les fins de partie solo au raid 3 (voir « Borne des +40 % » ci-dessous).
- **Naïf ≥ 2× l’humain moyen en PV perdus.** Dehors, le naïf voit les pillards dès l’entrée et les abat pendant leur approche (ils courent, donc visent mal) : sa médiane de PV perdus reste proche de celle de la fenêtre. En revanche ses **fins de partie** solo sont bien plus fréquentes (voir la synthèse) : le risque d’être à découvert se lit mieux dans les mises à terre que dans la médiane.
- **Tirs à plus de 15 m < 20 %.** La règle de la spec « blessé en avançant → engage » fige le pillard là où il est touché, souvent près de l’entrée (22 m de la façade), et les pillards tirent aussi en courant depuis l’entrée. Aucune constante autorisée ne limite cela ; la portée (\`range\`) n’est pas dans le périmètre. L’expérience « pillard blessé qui avance » est dans le tableau ci-dessous.
${output.notes?.length ? `\n### Raisons des réglages et expériences de travail\n\n${output.notes.map(note => `- ${note}`).join('\n')}\n` : ''}
## Micro-mesures : un pillard contre un survivant exposé

Temps médian (s) pour retirer 100 PV à un survivant debout en terrain découvert. Le pillard tient sa position (maintien de l’engagement), \`damageScale\` vaut 1 et le survivant n’a pas de gilet. « Marche » : décalage latéral à 3,5 m/s, inversion toutes les 0,8–1,6 s ; « course » : 5,4 m/s, inversion toutes les 1,5–2,5 s. ${settings.microSeeds} graines par case ; « > limite » = au-delà de 60 s (le fusil à pompe ne tire pas à 20 m, sa portée est de 15 m).

| Arme du pillard | Immobile 5 m | 10 m | 20 m | En marchant 5 m | 10 m | 20 m | En courant 5 m | 10 m | 20 m |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${Object.keys(RAIDER_LOADOUTS).map(duelRow).join('\n')}

Survivant accroupi sous l’appui de la fenêtre ouest-b, pillards tenant six positions extérieures pendant 12 s : ${sill.map(cell => `${GUN_NAMES[cell.loadout]} ${cell.hits} touche${cell.hits > 1 ? 's' : ''} sur ${cell.shots} tirs`).join(', ')}.

### Temps pour abattre un pillard (survivant scripté, pillard immobile à 10 m)

Médiane depuis l’apparition (réaction comprise), précision entre parenthèses. Ratio = temps moyen d’un pillard du raid pour mettre à terre un survivant debout à 10 m, divisé par le temps du survivant pour abattre un pillard.

| Raid | Armes | Pillard → survivant | Compétent | Moyen | Ratio compétent | Ratio moyen |
|---:|---|---:|---:|---:|---:|---:|
${ratioRows}

## Raids (70 PV, armes de référence)

${header}
${raidRows('main')}

### PV perdus par poste (humain moyen, médiane)

| Raid | Joueurs | Fenêtre | Couloir de porte | Mezzanine | Porte opposée | Survivants sans perte |
|---:|---:|---:|---:|---:|---:|---:|
${slotRows}

## Zombies encore vivants au déclenchement (humain moyen, 70 PV)

Les derniers zombies réels de la vague sont créés au déclenchement. « Témoin » : les mêmes zombies, raids désactivés. « Ancien seuil » : le raid part alors qu’il reste encore 3 + 2 × joueurs zombies, comme dans la première version de la spec.

| Raid | Joueurs | Zombies (seuil actuel) | ≥ 1 à terre | Fin de partie | Mises à terre dues aux pillards | Témoin sans raid (≥ 1 à terre / fin) | Zombies (ancien seuil) | Ancien seuil (≥ 1 à terre / fin) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${zombieRows}

${header}
${raidRows('zombies')}

## Strates de PV de départ (humain moyen)

${header}
${raidRows('strata')}

## Autres armes (humain moyen, 70 PV)

${header}
${raidRows('loadouts')}

## Charge serveur

4 joueurs, vague 15, ${load.zombies} zombies actifs (\`maxActive\`, cas du repli à 35 s), ${load.raiders} pillards (plafond ${load.raiderCap}), ${load.ticks} ticks mesurés : médiane ${num(load.tickMs.median, 3)} ms, p95 ${num(load.tickMs.p95, 3)} ms, max ${num(load.tickMs.max, 3)} ms (budget 33,3 ms). Instantané JSON médian ${load.snapshotBytes.median} octets. Mesure locale sur cette machine pendant que d’autres processus tournaient ; ce n’est pas un test réseau.

## Limites

- Défenseurs scriptés : réaction et visée constantes, aucune panique ni fatigue, aucun bruit de souris. Un humain réel peut faire mieux (se cacher en attendant, viser la tête, se replier) ou bien pire (sortir, ne pas recharger à couvert, oublier un côté).
- Le profil « qui se décale » perd souvent la vue en passant derrière le montant de la fenêtre, alors que les pillards réacquièrent vite (règle du coup d’œil) : au raid 3 en solo il tombe dans ${pct(strafeSolo3?.wipes)} des parties. Cela mesure ce script, pas l’intérêt de bouger pour un humain.
- La pluie est neutralisée pour le seul profil naïf. Aucun soin ni aucune réparation pendant le raid ; seules les boîtes de munitions proches sont ramassées.
- Les survivants à l’étage ne sont jamais relevés et ne descendent jamais.
- Les vagues ne sont pas jouées en entier : chaque raid commence avec les PV de la strate, sans les dégâts réels de la vague qui précède.
`;
}

async function main() {
  const args = process.argv.slice(2), option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
  const quick = args.includes('--quick'), seeds = Number(option('seeds', quick ? 8 : 40));
  const workers = Math.max(1, Number(option('workers', Math.min(12, Math.max(1, availableParallelism() - 4)))));
  const planned = plan({ seeds, quick }), only = option('only', null) && new RegExp(option('only'));
  // --only <regex> runs a subset of cells for tuning trials and only prints it.
  const cells = only ? planned.cells.filter(cell => only.test(cell.key)) : planned.cells;
  const jobs = only ? planned.jobs.filter(job => only.test(job.key)).map((job, index) => ({ ...job, index })) : planned.jobs;
  const begin = performance.now();
  const results = await runPool(jobs, workers);
  const seconds = (performance.now() - begin) / 1000;
  if (only) {
    const summary = summarize(cells, jobs, results);
    for (const { _runs, ...cell } of summary) {
      console.log(cell.key.padEnd(34), cell.group === 'duel' || cell.group === 'kill' ? `median ${cell.median}` : cell.group === 'sill' ? `hits ${cell.hits}`
        : `n ${cell.runs} down ${pct(cell.downRuns)} wipe ${pct(cell.wipes)} raiderDowns ${pct(cell.raiderDownShare)} lost ${cell.lostMedian}/${cell.lostMean} dur ${cell.durationP50}/${cell.durationP95} ammo ${cell.outOfAmmo} far ${pct(cell.farShare)} engage ${cell.engageMedian}/${cell.engageUnwoundedMedian}`);
    }
    for (const profile of Object.keys(PROFILES)) {
      const main = pick(summary, { group: 'main', profile });
      if (main.length) console.log(`pooled main ${profile}: lost median ${pooled(summary, { group: 'main', profile }).lostMedian}`);
    }
    return console.log(`${round(seconds, 1)} s`);
  }
  loadScenario({ ticks: 120 });
  const load = loadScenario({ ticks: 600 });
  const summary = summarize(cells, jobs, results);
  const checks = targets(summary, load);
  // --before and --notes also accept a previous report, whose embedded `before` and `notes` are reused.
  const loaded = name => option(name, null) ? JSON.parse(readFileSync(option(name), 'utf8')) : null;
  const previous = loaded('before'), noted = loaded('notes');
  const before = previous?.before ?? previous, notes = Array.isArray(noted) ? noted : noted?.notes ?? [];
  const output = { kind: 'scripted defenders in the real RoomSimulation; not human play', date: DATE, node: process.version,
    settings: { quick, seeds, microSeeds: quick ? 12 : 40, workers, jobs: jobs.length, seconds: round(seconds, 1) },
    constants: constants(), profiles: PROFILES, loadouts: LOADOUTS, checks, notes, load,
    before: before ? { constants: before.constants, checks: before.checks } : null,
    summary: summary.map(({ _runs, ...cell }) => cell) };
  // --out writes elsewhere (for example a scratch copy of a trial run).
  const base = option('out', null) ?? new URL(`./raid-balance-${DATE}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  if (!args.includes('--no-write')) {
    writeFileSync(`${base}.json`, `${JSON.stringify(output, null, 2)}\n`);
    writeFileSync(`${base}.md`, markdown({ ...output, summary }));
  }
  console.log(checks.map(({ id, value, pass }) => `${pass ? 'ok ' : 'NO '} ${id} ${value}`).join('\n'));
  console.log(`${round(seconds, 1)} s, ${jobs.length} jobs, load ${JSON.stringify(load.tickMs)}`);
}
if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
