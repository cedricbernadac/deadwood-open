import { LEVEL, IS_SUPERMARKET, IS_HOSPITAL, IS_FUNFAIR, HAS_SPACE } from '../public/level-config.js';
import { SPACE, spaceFloor, spaceFloorId, spaceFlightAt } from '../public/level-space.js';
// The companion's "eyes" (companions/DESIGN.md): a compact English summary of
// the room for the brain, the legal actions, and the body order of each one.
// Geometry is computed here and handed over as meaning (who, where, going for
// whom), never as raw coordinates. Pure: reads the simulation, changes nothing
// but its line-of-sight cache, and uses no randomness.
import { WORLD } from '../simulation.mjs';
import { ARMORY, REVIVE, LOFT, STAIRS, MAX_WAVES, PICKUPS, GRENADES, ARMOR, UMBRELLA, PLAYER_POSTURE, enemyPosture, playerEyeHeight } from '../public/rules.js';
import { LATE_SUPPLIES, SUPPLY_BONUSES } from '../public/weapon-upgrades.js';
import { GENERATOR } from '../public/expedition.js';
import { RADAR, radarBlipSeconds } from '../public/radar-rules.js';
import { weaponType, weaponEntries, activeWeaponId, weaponStock } from '../public/weapon-inventory.js';
import { OUTDOORS, wayOut, rainCost, doorwayOpen, doorwayPassage, shutOut, sheltered, wetApproach } from './outdoors.mjs';
import { calm, coinSweep } from './coins.mjs';
import { routeInfo, routeLength } from './routes.mjs';
import { LOFT_POST, LOFT_POST_EXTERIOR, loftRank, grenadePack, packEndangers, grenadeAim, throwEndangers } from './body.mjs';
import { replaced, worthBuying } from './arsenal.mjs';
import { assignmentFor, teamIntent, crateRunner } from './team-plan.mjs';
import { companionProfilePrompt } from './profiles.mjs';
import { CHARACTER_BONUSES, characterStats } from '../public/character-bonuses.js';
import { claimStep } from '../public/character-sheet.js';
import { nextCharacterBonus, characterSummary } from './bonus-strategy.mjs';
import { describeRecon } from './recon.mjs';
import { crateOpportunity, crateAccessAtDoor, nextCrateWave, NEXT_CRATE_LEAD } from './crate-opportunity.mjs';
import { carriedCombatOpportunities, piercingOpportunity, flameOpportunity } from './combat-opportunities.mjs';

export const TEXT_LIMIT = 2800;
export const MAX_ACTIONS = 24;
export const TACTICAL_ACTIONS = 16;
export const ORDER_KINDS = Object.freeze(['hold', 'shoot', 'defend', 'repair', 'revive', 'kit', 'self-kit', 'wait', 'follow', 'collect', 'coins', 'buy', 'weapon', 'dual', 'reload', 'loft', 'grenade', 'claim', 'supply', 'umbrella']);
const PARAMS = Object.freeze({ shoot: 'zombieId', defend: 'doorId', repair: 'doorId', revive: 'playerId', kit: 'playerId', follow: 'playerId', collect: 'pickupId', buy: 'rackId', weapon: 'weapon', dual: 'weapon', grenade: 'zombieId', claim: 'bonus', supply: 'service' });
// A grenade at a pack (owner, 13 October): three or more within 2 m of one
// another, 3.5 to 11 m away. The brain decides; the body only aims the throw.
const PACK = Object.freeze({ size: 3, radius: 2, min: 3.5, max: 11, offered: 2, flights: 4 });
// Grenade flights a room spends on offers per tick, shared by every
// companion described on that tick (several may be on the same 33 ms tick).
const ROOM_FLIGHTS = 4;
const flightsSpent = new WeakMap();
function takeFlight(sim) {
  const spent = flightsSpent.get(sim);
  if (!spent || spent.time !== sim.time) { flightsSpent.set(sim, { time: sim.time, used: 1 }); return true; }
  if (spent.used >= ROOM_FLIGHTS) return false;
  spent.used++;
  return true;
}
// STEP: how far a shoot order may step for a clear line (DESIGN). DOORWAY and
// INSET place a reviver inside an open doorway, clear of the passage edges.
// BITE: a zombie this close is about to bite (no purchase kept then).
const MAX_TARGETS = 6, TARGET_RANGE = 30, STEP = 6, AT_DOOR = 2.5, HOLD_RANGE = 20, NEARBY = 6, DOORWAY = .7, INSET = .6, BITE = 3;
const MAX_COLLECTS = 3, MAX_BUYS = 4, MAX_ENEMY_LINES = 8, MAX_PICKUP_LINES = 4, MAX_RECENT = 5;
const SHOP_PHASES = ['countdown', 'intermission'], HAZARD_PHASES = ['countdown', 'wave', 'intermission'];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SIDES = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };
const LABELS = Object.freeze({ pistol: 'pistol', rifle: 'machine gun', shotgun: 'shotgun', smg: 'SMG', minigun: 'gatling', magnum: 'golden magnum',
  assault: 'assault rifle', rocket: 'rocket launcher', flamethrower: 'flamethrower', katana: 'katana', hammer: 'spiked hammer',
  sniper: 'bolt-action rifle', bat: 'bat', fireaxe: 'fire axe' });
const STAIR_TOP = Object.freeze({ x: (STAIRS.minX + STAIRS.maxX) / 2, z: STAIRS.minZ - .5 });

// "kind:param" for an order object, or null.
export function orderValue(order) {
  if (!order || !ORDER_KINDS.includes(order.kind)) return null;
  const param = PARAMS[order.kind];
  return param ? `${order.kind}:${order[param]}` : order.kind;
}
// The body order for an action value (`keep` is not an order: null).
export function orderFromValue(value) {
  if (typeof value !== 'string') return null;
  const at = value.indexOf(':'), kind = at < 0 ? value : value.slice(0, at), arg = at < 0 ? null : value.slice(at + 1);
  if (!ORDER_KINDS.includes(kind) || Boolean(PARAMS[kind]) !== (arg !== null) || arg === '') return null;
  return PARAMS[kind] ? { kind, [PARAMS[kind]]: arg } : { kind };
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Door and threat labels are only meaningful on one level (the supermarket
// cellar extends under the north, south and east doors, the hospital basement
// under all four): a zombie a floor away is not "by the door" nor "after" a
// teammate it cannot reach without the stairs.
const sameLevel = (a, b) => Math.abs((a.y ?? 0) - (b.y ?? 0)) < 1.7;
// How far a zombie is from its target: on the hospital and funfair, one a
// floor away walks round by a staircase (a zombie in the basement corridor
// 3 m under a survivor is 33 m from them by the service stair), elsewhere the
// flat gap.
const gapTo = (zombie, target) => (IS_HOSPITAL || IS_FUNFAIR) && !sameLevel(zombie, target) ? routeLength(zombie, target) : flat(zombie, target);
const outside = p => Math.abs(p.x) > WORLD.width / 2 || Math.abs(p.z) > WORLD.depth / 2;
const cabinGap = p => Math.hypot(Math.max(0, Math.abs(p.x) - WORLD.width / 2), Math.max(0, Math.abs(p.z) - WORLD.depth / 2));
const onStairs = p => p.x >= STAIRS.minX && p.x <= STAIRS.maxX && p.z >= STAIRS.minZ && p.z <= STAIRS.maxZ;
const metres = d => d < 10 ? `${(Math.round(d * 10) / 10).toFixed(1)} m` : `${Math.round(d)} m`;
const seconds = t => `${Math.max(0, Math.ceil(t - 1e-6))} s`; // time left
const tenths = t => `${(Math.max(0, Math.ceil(t * 10 - 1e-6)) / 10).toFixed(1)} s`;
const elapsed = t => `${Math.max(0, Math.round(t))} s`;
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const percent = (part, whole) => Math.round(100 * Math.max(0, part) / Math.max(1, whole));
const label = weapon => LABELS[weaponType(weapon)] ?? String(weapon);
const clean = (value, max = 90) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const nameOf = player => clean(player?.name, 24) || 'someone';
const grouped = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); // 1,450
const human = player => player?.companion !== true;
const compass = (from, to) => COMPASS[(Math.round(Math.atan2(to.x - from.x, -(to.z - from.z)) / (Math.PI / 4)) % 8 + 8) % 8];
const boardsLeft = door => door.boards.filter(hp => hp > 0).length;
const activeDoor = door => door && !door.sealed && !door.sealPending;
const planFor = (sim, self) => self?.companion === true ? assignmentFor(sim, self.id) : null;

function floorOf(p) {
  if (outside(p)) return 'outside';
  if (HAS_SPACE) return spaceFlightAt(p.x, p.z, p.y ?? 0) ? 'stairs' : spaceFloorId(p);
  const y = p.y ?? 0;
  if (y >= LOFT.y - .6) return 'loft';
  return y > .3 && onStairs(p) ? 'stairs' : 'ground';
}
// Hospital place names follow the walled rooms (SPACE.rooms, per floor);
// between them lie the corridor spine and the halls that join it
// (public/level-space-hospital.js): north rooms end where the corridor
// starts, south rooms start where it ends.
const HOSPITAL_ROOM_NAMES = Object.freeze({
  reception: 'reception and waiting room', ward: "ward and nurses' station", theatre: 'operating theatre',
  emergency: 'emergency department and triage bays', chapel: 'chapel',
  pharmacy: 'basement pharmacy store', archives: 'basement archives', linen: 'basement linen room', boiler: 'basement boiler room',
});
const HOSPITAL_FLOORS = IS_HOSPITAL ? Object.fromEntries(['ground', 'cellar'].map(floor => {
  const rooms = SPACE.rooms.filter(room => room.floor === floor);
  return [floor, { rooms, byId: Object.fromEntries(rooms.map(room => [room.id, room.bounds])),
    north: Math.max(...rooms.filter(room => room.bounds.maxZ < 0).map(room => room.bounds.maxZ)),
    south: Math.min(...rooms.filter(room => room.bounds.minZ > 0).map(room => room.bounds.minZ)) }];
})) : null;
const within = (p, r) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
const hospitalStairs = p => `on the ${spaceFlightAt(p.x, p.z, p.y ?? 0)?.id === 'service-stair' ? 'service' : 'main'} stairs`;
// Enemy lines repeat a place per zombie: there a room is one or two words
// (the long names would push busy situations past TEXT_LIMIT).
const HOSPITAL_ROOM_SHORT = Object.freeze({
  reception: 'reception', ward: 'ward', theatre: 'theatre', emergency: 'emergency', chapel: 'chapel',
  pharmacy: 'basement pharmacy', archives: 'basement archives', linen: 'basement linen', boiler: 'basement boiler room',
});
function hospitalRoom(p, short = false) {
  const cellar = (p.y ?? 0) < -1.7, { rooms, byId, north, south } = HOSPITAL_FLOORS[cellar ? 'cellar' : 'ground'];
  const room = rooms.find(item => within(p, item.bounds));
  if (room) return (short ? HOSPITAL_ROOM_SHORT : HOSPITAL_ROOM_NAMES)[room.id] ?? room.label.en.toLowerCase();
  const corridor = p.z > north && p.z < south;
  if (cellar) {
    if (flat(p, SPACE.refuge) < 3.2) return short ? 'basement refuge' : 'sheltered hospital basement refuge';
    if (corridor) return short ? 'basement corridor' : 'sheltered basement corridor';
    if (p.z <= north) return p.x < byId.pharmacy.minX ? (short ? 'main stair foot' : 'basement hall at the main stair foot') : (short ? 'basement passage' : 'basement refuge passage');
    return p.x > byId.boiler.maxX ? (short ? 'service stair foot' : 'basement hall at the service stair foot') : (short ? 'basement south passage' : 'basement south passage');
  }
  if (corridor) return short ? 'corridor' : 'central hospital corridor';
  if (p.z <= north) return 'entrance hall';
  return p.x > byId.chapel.maxX ? 'service stair hall' : 'south hall';
}
const FUNFAIR_ROOM_NAMES = Object.freeze({
  caisse: 'ticket booth', jeux: 'games room', lots: 'prizes', confiserie: 'snack bar', arcade: 'bumper cars',
  refuge: 'refuge', tir: 'shooting gallery', miroirs: 'mirror maze', machines: 'machine room',
});
function funfairRoom(p) {
  const floor = (p.y ?? 0) < -1.7 ? 'cellar' : 'ground';
  const room = SPACE.rooms.find(item => item.floor === floor && within(p, item.bounds));
  return room ? FUNFAIR_ROOM_NAMES[room.id] ?? room.label.en.toLowerCase() : 'circulation';
}
// Where something is, as a teammate would say it. On the supermarket the
// player words are sales floor / terrace / cellar, not the engine's floor ids.
function place(sim, p) {
  const floor = floorOf(p);
  if (floor === 'outside') {
    const door = nearestDoor(sim.doors, p);
    return flat(p, door) <= 4 ? `outside the ${door.id} door` : `outside, ${metres(cabinGap(p))} out to the ${SIDES[compass({ x: 0, z: 0 }, p)]}`;
  }
  if (floor === 'stairs') return IS_HOSPITAL || IS_FUNFAIR ? hospitalStairs(p) : IS_SUPERMARKET ? `on the ${spaceFlightAt(p.x, p.z, p.y ?? 0)?.id === 'garden-stair' ? 'exterior stairs (acid rain)' : 'interior stairs'}` : 'on the stairs';
  if (IS_SUPERMARKET && floor === 'cellar') {
    if (flat(p, LOFT_POST) <= 2.5 || flat(p, LOFT_POST_EXTERIOR) <= 2) return 'cellar reserve post';
    return `cellar, ${p.x > 10.5 ? 'east wall' : p.x < 1.5 ? 'west wall' : p.z < -7.5 ? 'north wall' : p.z > 7.5 ? 'south wall' : 'middle'}`;
  }
  if (IS_SUPERMARKET && floor === 'terrace') {
    if (flat(p, SPACE.flights[1].upper) <= 3) return 'terrace, top of the exterior stairs (acid rain)';
    const door = nearestDoor(sim.doors, p);
    return flat(p, door) <= 4 ? `terrace, by the ${door.id} door` : 'delivery terrace (acid rain)';
  }
  if (IS_SUPERMARKET) {
    const door = sim.doors.find(item => flat(p, item) <= 3);
    if (door) return `sales floor, by the ${door.id} door`;
    if (p.z > 7 && p.x < -3) return 'sales floor, by the checkouts';
    if (p.x > -11 && Math.abs(p.z) < 7.6) return 'sales floor, in the aisles';
    const row = p.z < -LEVEL.depth / 6 ? 'north' : p.z > LEVEL.depth / 6 ? 'south' : '', column = p.x < -LEVEL.width / 6 ? 'west' : p.x > LEVEL.width / 6 ? 'east' : '';
    return `sales floor, ${row && column ? `${row}-${column}` : row || column || 'centre'}`;
  }
  if (IS_HOSPITAL && floor === 'cellar') {
    if (flat(p, LOFT_POST) <= 2.5) return 'basement post at the main stair foot';
    if (flat(p, LOFT_POST_EXTERIOR) <= 2) return 'basement post at the service stair foot';
    return hospitalRoom(p);
  }
  if (IS_FUNFAIR && floor === 'cellar') {
    if (flat(p, LOFT_POST) <= 2.5) return 'cellar post at the main stair foot';
    if (flat(p, LOFT_POST_EXTERIOR) <= 2) return 'cellar post at the service stair foot';
    return funfairRoom(p);
  }
  if (floor === 'loft') return flat(p, STAIR_TOP) <= 2 ? 'loft, top of the stairs' : `loft, ${p.z < -2 ? 'north' : p.z > 2.5 ? 'south' : 'middle'}`;
  const door = sim.doors.find(item => flat(p, item) <= 3);
  if (door) return IS_FUNFAIR ? `circulation, by the ${door.id} door` : `ground, by the ${door.id} door`;
  if (IS_HOSPITAL && floor === 'ground') return hospitalRoom(p);
  if (IS_FUNFAIR && floor === 'ground') return funfairRoom(p);
  const row = p.z < -LEVEL.depth / 6 ? 'north' : p.z > LEVEL.depth / 6 ? 'south' : '', column = p.x < -2.67 ? 'west' : p.x > 2.67 ? 'east' : '';
  return `ground, ${row && column ? `${row}-${column}` : row || column || 'centre'}`;
}
// Distance and 8-point bearing from the companion (north is -z). On the
// supermarket, a target on another floor or across the garden partition is
// priced in walked metres along the route, naming the staircase and the rain
// on the way ("21 m via the interior stairs (below you)"); on the hospital and
// funfair, a target on the other floor too; the cabin has no SPACE. rainNote
// false: the caller says itself what the rain means for this target.
function relative(self, p, rainNote = true) {
  const d = flat(self, p), dy = (p.y ?? 0) - self.y;
  const vertical = dy > 1.5 ? ' (above you)' : dy < -1.5 ? ' (below you)' : '';
  if (HAS_SPACE && (d >= .5 || IS_HOSPITAL || IS_FUNFAIR)) {
    const route = routeInfo(self, p);
    if (route.crosses || route.flight && floorOf(self) !== floorOf(p)) {
      const via = route.flight ? `via the ${route.flight} stairs` : 'via the terrace passage';
      return `${metres(route.metres)} ${via}${rainNote && route.rain > 0 ? ', through the terrace rain' : ''}${vertical}`;
    }
  }
  return `${d < .5 ? 'right here' : `${metres(d)} ${compass(self, p)}`}${vertical}`;
}
function nearestDoor(doors, p, filter = () => true) {
  let best = null;
  for (const door of doors) if (filter(door) && (!best || flat(p, door) < flat(p, best))) best = door;
  return best;
}
// The exact target rule of RoomSimulation.updateZombie.
function zombieTarget(zombie, living) {
  const exterior = outside(zombie);
  const closeOutside = living.filter(player => outside(player) && flat(zombie, player) <= 5);
  const inside = living.filter(player => !outside(player));
  const candidates = exterior && closeOutside.length ? closeOutside : inside.length ? inside : living;
  let target = null, best = Infinity;
  for (const player of candidates) {
    const score = flat(zombie, player) + Math.abs(zombie.y - player.y) * 3;
    if (score < best) { target = player; best = score; }
  }
  return target;
}
function visible(sim, eye, zombie) {
  const height = enemyPosture(zombie).height * (zombie.scale ?? 1);
  return [.55, .85].some(share => sim.raiderLineClear(eye, { x: zombie.x, y: (zombie.y ?? 0) + height * share, z: zombie.z }));
}
// How far the weapon in hand hits (blades and the flamethrower: a few metres).
const weaponReach = profile => profile ? Math.min(TARGET_RANGE, profile.range ?? TARGET_RANGE) : 0;

// Where to stand inside the cabin to revive a teammate downed just outside a
// doorway, with the simulation's own reach and line (boards and walls block
// it), or null when they are inside or out of reach from inside.
export function doorstepSpot(sim, player) {
  if (!player || !outside(player) || Math.abs(player.y ?? 0) >= REVIVE.heightReach) return null;
  for (const door of sim.doors.filter(item => !item.sealed).sort((a, b) => flat(player, a) - flat(player, b) || byId(a, b))) {
    const along = Math.max(-DOORWAY, Math.min(DOORWAY, door.outZ ? player.x - door.x : player.z - door.z));
    const spot = { x: door.x - door.outX * INSET + (door.outZ ? along : 0), y: 0, z: door.z - door.outZ * INSET + (door.outX ? along : 0) };
    if (flat(spot, player) < REVIVE.startReach - .2 && sim.interactionVisible(spot, player)) return { ...spot, doorId: door.id };
  }
  return null;
}
function enemyName(zombie) {
  if (zombie.kind === 'raider') return `RAIDER (${label(zombie.loadout)})`;
  if (zombie.boss) return 'BOSS';
  return zombie.kind === 'brute' ? 'BRUTE' : zombie.kind === 'armored' ? 'armored walker' : zombie.kind;
}
function stockText(sim, player, weapon, held = false) {
  const profile = sim.weaponProfile(player, weapon), stock = weaponStock(player, weapon);
  if (!profile || !stock) return label(weapon);
  if (profile.melee) return `${label(weapon)} (melee)`;
  const total = stock.ammo + stock.reserve;
  const warning = total <= 0 ? ' EMPTY' : held && total <= profile.magazine / 2 ? ' LOW AMMO' : '';
  return `${label(weapon)} ${stock.ammo}/${profile.magazine} +${stock.reserve}${held ? ' spare' : ''}${warning}`;
}

// Everything both the text and the actions need, computed once.
function survey(sim, self) {
  const team = [...sim.players.values()].filter(player => player.id !== self.id && !player.waiting)
    .sort((a, b) => Number(human(b)) - Number(human(a)));
  const living = sim.livingPlayers();
  const eye = { x: self.x, y: self.y + playerEyeHeight(self), z: self.z };
  const open = door => sim.doorPassable(door, 0, 1.82);
  const weak = door => activeDoor(door) && (open(door) || boardsLeft(door) <= 2);
  const reach = weaponReach(sim.weaponProfile(self));
  const enemies = [...sim.zombies.values()].filter(zombie => zombie.hp > 0).map(zombie => {
    const raider = zombie.kind === 'raider', inside = !outside(zombie), d = flat(self, zombie);
    const target = raider ? sim.players.get(zombie.ai?.targetId) ?? null : zombieTarget(zombie, living);
    const aiming = raider && zombie.ai?.aimingAt ? sim.players.get(zombie.ai.aimingAt) ?? null : null;
    const retreating = raider && zombie.ai?.state === 'retreat';
    const route = sim.doors.find(door => door.id === zombie.portalRoute?.doorId);
    const door = inside ? nearestDoor(sim.doors, zombie) : activeDoor(route) ? route : nearestDoor(sim.doors, zombie, activeDoor) ?? nearestDoor(sim.doors, zombie);
    const seen = d <= TARGET_RANGE && visible(sim, eye, zombie);
    // A short reach (blade, flames) hits only what a few steps inside bring
    // within reach: never the yard beyond the walls.
    const inReach = reach >= TARGET_RANGE || reach > 0 && d <= reach + STEP && (inside || cabinGap(zombie) <= reach);
    const forHuman = Boolean((aiming ?? target) && human(aiming ?? target));
    // Threat order: inside and after a human (or a raider aiming at one),
    // then anything inside, then at a weak door, raiders, the rest by distance.
    const tier = retreating ? 5 : inside && forHuman || aiming && forHuman ? 0 : inside ? 1
      : weak(door) && flat(zombie, door) <= 3 ? 2 : raider ? 3 : 4;
    const key = tier === 0 ? gapTo(zombie, aiming ?? target) : d;
    return { zombie, raider, inside, d, target, aiming, retreating, door, seen, inReach, tier, key };
  }).sort((a, b) => a.tier - b.tier || a.key - b.key || a.d - b.d || byId(a.zombie, b.zombie));
  const threats = player => {
    const after = enemies.filter(enemy => enemy.seen && !enemy.raider && enemy.target === player && flat(enemy.zombie, player) <= 6
      && (!HAS_SPACE || sameLevel(enemy.zombie, player)));
    const aimed = enemies.filter(enemy => enemy.seen && enemy.aiming === player).length;
    return { count: after.length, nearest: after.length ? Math.min(...after.map(enemy => flat(enemy.zombie, player))) : null, aimed };
  };
  return { team, living, enemies, threats, open, weak, humans: [...sim.players.values()].filter(player => human(player) && !player.waiting),
    combat: carriedCombatOpportunities(sim, self, enemies), observed: enemies.filter(enemy => enemy.seen).map(enemy => enemy.zombie) };
}

function threatText(info, pronoun) {
  const parts = [];
  if (info.count) parts.push(`${info.count} zombie${info.count > 1 ? 's' : ''} after ${pronoun} (nearest ${metres(info.nearest)})`);
  if (info.aimed) parts.push(`${info.aimed} raider${info.aimed > 1 ? 's' : ''} aiming at ${pronoun}`);
  return parts.join(', ');
}
function combatFit(facts) {
  if (!facts) return '';
  const best = facts.best;
  if (facts.profile.fuel) return `${facts.profile.range}m flame cone: ${best?.count ?? 0} visible exposed bodies on shown aims${best?.burning ? ` (${best.burning} already burning)` : ''}`;
  return `pierces ${facts.profile.penetrationTargets}; shown line up to ${best?.count ?? 0} bodies${best?.id ? ` toward ${clean(best.id, 12)}` : ''}`;
}
function combatLine(view) {
  if (!view.combat.length) return null;
  return `COMBAT FIT (current visible targets; movement/aim can change it): ${view.combat.map(facts =>
    `${label(facts.weapon)} ${facts.stock.ammo}+${facts.stock.reserve}${facts.usable ? '' : ' EMPTY'}: ${combatFit(facts)}`).join('; ')}.`;
}

// Distinct packs of zombies a grenade would catch, biggest first.
function packs(sim, self, view) {
  if (!(self.grenades > 0) || sim.phase !== 'wave') return [];
  const friendly = sim.friendlyFireOn?.() === true;
  const found = [];
  for (const enemy of view.enemies) {
    if (!enemy.seen || enemy.raider || enemy.d < PACK.min || enemy.d > PACK.max) continue;
    const pack = view.enemies.filter(other => other.seen && !other.raider && flat(other.zombie, enemy.zombie) <= PACK.radius
      && Math.abs((other.zombie.y ?? 0) - (enemy.zombie.y ?? 0)) < 1);
    if (pack.length < PACK.size) continue;
    // Friendly fire: never offer a blast landing on the team (within its
    // radius and a margin, on any floor), the thrower included: the body's
    // own rule, round the pack in sight and round the pack it will aim at.
    if (friendly) {
      const center = { x: pack.reduce((sum, other) => sum + other.zombie.x, 0) / pack.length, y: enemy.zombie.y ?? 0,
        z: pack.reduce((sum, other) => sum + other.zombie.z, 0) / pack.length };
      if (packEndangers(sim, self, center) || packEndangers(sim, self, grenadePack(sim, enemy.zombie).center)) continue;
    }
    found.push({ enemy, size: pack.length });
  }
  found.sort((a, b) => b.size - a.size || a.enemy.d - b.enemy.d || byId(a.enemy.zombie, b.enemy.zombie));
  // Friendly fire: nor a throw the body would refuse at its trigger, the one
  // it would make from here, flown as the room flies it. A flight costs
  // about a millisecond, and a crowd piled outside a door, whose throws all
  // fall back off the planks, would be flown once per zombie: at most
  // PACK.flights per call and ROOM_FLIGHTS per room tick across every
  // companion described on it, the packs a low line from the thrower reaches
  // first (a rolled grenade meets what that line meets: the low wall, a
  // plank), the biggest first within each.
  let candidates = found, flights = 0;
  if (friendly) {
    const low = point => ({ x: point.x, y: (point.y ?? 0) + .3, z: point.z });
    const open = found.map(item => {
      const { center } = grenadePack(sim, item.enemy.zombie);
      return { ...item, center, open: sim.grenadeBlastVisible(low(self), low(center)) };
    });
    candidates = [...open.filter(item => item.open), ...open.filter(item => !item.open)];
  }
  const chosen = [];
  for (const item of candidates) {
    if (chosen.some(pick => flat(pick.enemy.zombie, item.enemy.zombie) < PACK.radius + .5)) continue;
    if (friendly) {
      if (flights++ >= PACK.flights || !takeFlight(sim)) break;
      if (throwEndangers(sim, self, grenadeAim(self, item.center))) continue;
    }
    chosen.push(friendly ? { enemy: item.enemy, size: item.size } : item);
    if (chosen.length === PACK.offered) break;
  }
  return chosen;
}
// Zombies on the flight: they climb in single file. On the supermarket the
// two flights are counted apart: they lead to opposite ends of the cellar;
// on the hospital and funfair too (main and service stairs).
function stairsLine(view) {
  if (IS_SUPERMARKET) {
    const on = id => view.enemies.filter(enemy => enemy.seen && !enemy.raider
      && spaceFlightAt(enemy.zombie.x, enemy.zombie.z, enemy.zombie.y ?? 0)?.id === id).length;
    const interior = on('stock-stair'), exterior = on('garden-stair');
    return interior + exterior ? `STAIRS: interior: ${interior}, exterior: ${exterior} visible zombies on the flights; two routes connect the cellar. Concrete floors block firing between levels.` : null;
  }
  if (IS_HOSPITAL || IS_FUNFAIR) {
    const on = id => view.enemies.filter(enemy => enemy.seen && !enemy.raider
      && spaceFlightAt(enemy.zombie.x, enemy.zombie.z, enemy.zombie.y ?? 0)?.id === id).length;
    const main = on('main-stair'), service = on('service-stair');
    return main + service ? `STAIRS: main: ${main}, service: ${service} visible zombies on the flights; two routes connect the ground floor and ${IS_HOSPITAL ? 'sheltered hospital basement' : 'sheltered cellar salle des machines'}. Concrete floors block firing between levels.` : null;
  }
  const climbing = view.enemies.filter(enemy => enemy.seen && !enemy.raider && enemy.zombie.x >= STAIRS.minX && enemy.zombie.x <= STAIRS.maxX
    && enemy.zombie.z >= STAIRS.minZ && enemy.zombie.z <= STAIRS.maxZ && (enemy.zombie.y ?? 0) > .2).length;
  return climbing ? `STAIRS: ${climbing} zombie${climbing > 1 ? 's' : ''} climbing in single file (from the loft: a line for piercing guns and grenades).` : null;
}

// Where a zombie inside is: the floor id, or on the hospital/funfair the room,
// hall or flight a teammate would name.
const insideWords = zombie => !(IS_HOSPITAL || IS_FUNFAIR) ? floorOf(zombie) : floorOf(zombie) === 'stairs' ? hospitalStairs(zombie) : IS_HOSPITAL ? hospitalRoom(zombie, true) : funfairRoom(zombie);
function enemyWhere(enemy) {
  const { zombie, inside, door } = enemy;
  if (inside) {
    const near = door && flat(zombie, door) <= 3;
    // A zombie a floor away from that door is under/above it, not "by" it.
    const note = !near ? '' : HAS_SPACE && !sameLevel(zombie, door)
      ? `, ${(zombie.y ?? 0) < (door.y ?? 0) ? 'under' : 'above'} the ${door.id} door` : `, by the ${door.id} door`;
    return `INSIDE (${insideWords(zombie)}${note})`;
  }
  if (!door) return 'outside';
  const gap = flat(zombie, door);
  return gap <= AT_DOOR ? `outside at the ${door.id} door` : `outside, ${metres(gap)} from the ${door.id} door`;
}
function enemyGoal(enemy, self) {
  const { zombie, raider, target, aiming, retreating } = enemy;
  const who = player => player === self ? 'YOU' : nameOf(player);
  if (raider) return retreating ? 'retreating' : aiming ? `aiming at ${who(aiming)}` : target ? `hunting ${who(target)}` : 'looking for a target';
  if (!target) return 'no target';
  const gap = gapTo(zombie, target);
  if (target === self) return gap <= 2 && enemy.seen ? 'next to YOU' : 'going for YOU';
  return gap <= 2 && Math.abs(zombie.y - target.y) < 1.5 ? `next to ${who(target)}` : `going for ${who(target)} (${metres(gap)} from them)`;
}
function pickupLabel(pickup) {
  switch (pickup.kind) {
    case 'ammo': return pickup.special ? 'big ammo box' : 'ammo box';
    case 'health': return 'medkit';
    case 'armor': return 'armor vest';
    case 'revive': return 'revive kit';
    case 'points': return `${pickup.amount} coins`;
    case 'weapon': return `${label(pickup.weapon)} on the floor`;
    case 'bonus': return `${clean(pickup.bonus?.kind, 20)} bonus N${pickup.bonus?.level ?? 1}`;
    default: return pickup.kind === 'bonus' ? 'bonus' : clean(pickup.kind, 20);
  }
}
const reachable = pickup => !outside(pickup) && (HAS_SPACE ? Math.abs(spaceFloor(pickup.x, pickup.z, (pickup.y ?? 0) + .35) - (pickup.y ?? 0)) < .35 : (Math.abs(pickup.y) < .35 || Math.abs(pickup.y - LOFT.y) < .35 || onStairs(pickup) && pickup.y > 0));
const hurtHuman = player => human(player) && player.alive && !player.waiting && (player.downed || player.hp < characterStats(player).maxHp);

// A gun this box refills is down to a third of its spare ammo or less.
function lowOnAmmo(sim, player, pickup) {
  const refill = pickup.special ? PICKUPS.specialAmmo : PICKUPS.ammo;
  return weaponEntries(player).some(({ id, weapon, stock }) => {
    const profile = sim.weaponProfile(player, id);
    return profile && !profile.melee && profile.reserve > 0 && (refill[weapon] ?? 0) > 0 && stock.reserve <= profile.reserve / 3;
  });
}
// The human near this ammo box, medkit or revive kit (or near the companion)
// who needs it.
function needyHuman(sim, self, pickup, view) {
  const near = player => flat(player, pickup) <= NEARBY || flat(player, self) <= NEARBY;
  const needs = pickup.kind === 'ammo' ? player => player.alive && lowOnAmmo(sim, player, pickup)
    : pickup.kind === 'health' ? hurtHuman
    : pickup.kind === 'revive' ? player => player.alive && !player.waiting && player.reviveKit !== true
    : pickup.kind === 'bonus' ? player => player.alive && !player.waiting && sim.bonusEligibleForPickup?.(player, pickup.bonus)
    : () => false;
  return view.humans.find(player => needs(player) && near(player)) ?? null;
}
// Why the companion would take this pickup, wherever it lies, or null. Never
// weapons, bonuses, vests or grenades: those are the family's (coins have
// their own order, 'coins'). Ammo, medkits and revive kits go to a human
// nearby who needs them first (owner, 16 October: the kit rule relaxed from
// "every human already has one" to the same as ammo and medkits).
function need(sim, self, pickup, view) {
  if ((pickup.expiresAt ?? Infinity) - sim.time < 3) return null;
  if ([...sim.players.values()].some(player => player !== self && player.companion === true && player.collectTargetId === pickup.id)) return null;
  if (pickup.kind === 'ammo') return lowOnAmmo(sim, self, pickup) && !needyHuman(sim, self, pickup, view) ? 'your spare ammo is low and no human nearby needs it' : null;
  if (pickup.kind === 'health') return self.hp <= .7 * characterStats(self).maxHp && !needyHuman(sim, self, pickup, view) ? 'you are hurt and no human nearby needs it' : null;
  if (pickup.kind === 'revive') return self.reviveKit !== true && !needyHuman(sim, self, pickup, view) ? 'you have no kit and no human nearby needs it' : null;
  if (pickup.kind === 'bonus') return sim.bonusEligibleForPickup?.(self, pickup.bonus) && !needyHuman(sim, self, pickup, view)
    ? 'recover a dropped bonus you do not carry; no human nearby needs it' : null;
  return null;
}
// A trip outside for an ammo box or a medkit (companions/outdoors.mjs): an
// open doorway within reach, time to get there before it fades, and rain the
// umbrella and the companion's health can take. → the way and its cost, or
// why not ({ why }).
function outing(sim, self, pickup) {
  if (!['ammo', 'health', 'bonus'].includes(pickup.kind)) return { why: 'never yours outside' };
  const way = wayOut(sim, pickup);
  if (!way) return { why: 'no way out to it for you' };
  const rain = rainCost(sim, self, way.distance, way);
  if (!rain.affordable) return { why: 'too long in the rain for you' };
  if ((pickup.expiresAt ?? Infinity) - sim.time < 3 + (flat(self, way.door) + way.distance) / OUTDOORS.pace) return { why: 'it fades before you get there' };
  return { ...way, ...rain };
}
function collectReason(sim, self, pickup, view) {
  return (outside(pickup) ? !outing(sim, self, pickup).why : reachable(pickup)) ? need(sim, self, pickup, view) : null;
}
// Said honestly: the door, how far past it, the seconds in the rain and what
// the umbrella leaves to burn, and the enemies by it (they go for anyone within 5 m).
// A trip that stays under a hospital door canopy (rainCost: 0 s) is dry.
function outingText(sim, self, pickup, view) {
  const trip = outing(sim, self, pickup), near = view.enemies.filter(enemy => enemy.seen && !enemy.inside && flat(enemy.zombie, pickup) <= 5).length;
  const cover = trip.burn ? `umbrella ${trip.umbrella} s left, ~${trip.burn} HP of rain` : 'under your umbrella';
  return `Pick up the ${pickupLabel(pickup)} outside, ${metres(trip.distance)} past the broken ${trip.door.id} door${trip.crouch ? ' (crouch through the lower opening)' : ''} (${pickup.kind === 'ammo' ? 'low on ammo' : pickup.kind === 'bonus' ? 'recover a useful bonus' : 'hurt'}): `
    + `${trip.seconds ? `about ${trip.seconds} s in the rain, ${cover}` : 'dry under the door canopy'}${near ? `; ${near} ${near > 1 ? 'enemies' : 'enemy'} near it` : ''}.`;
}
// The coins near it (companions/coins.mjs): how much, how far, and its own
// coins next to the richest human's, so the brain sees who needs them.
function coinsText(sweep, self, view) {
  const { piles, amount, farthest } = sweep, outdoor = piles.filter(item => item.door);
  const doors = [...new Set(outdoor.map(item => item.door.id))];
  const richest = view.humans.reduce((best, player) => !best || player.points > best.points ? player : best, null);
  return `Pick up ${piles.length} coin pile${piles.length > 1 ? 's' : ''} (${grouped(amount)} coins) within ${Math.max(1, Math.ceil(farthest))} m`
    + `${outdoor.length ? `, ${outdoor.length} just outside the ${doors.join(' and ')} door${doors.length > 1 ? 's' : ''}` : ''}`
    + `; you have ${grouped(self.points)} coins${richest ? `, ${nameOf(richest)} has ${grouped(richest.points)}` : ''}.`;
}
// Between waves, or a calm moment of a wave (nothing within 8 m, nobody
// down): a rack unlocks at the start of its wave (the shotgun at wave 2), so
// waiting for the next break wastes it.
const shopOpen = (sim, self) => SHOP_PHASES.includes(sim.phase) || sim.phase === 'wave' && calm(sim, self);

// ---- The supply crate and the station (supply.mjs, weapon-upgrades.js).
// Every crate bonus said with what a level does — the ladder, not just a
// name — so the model decides with the whole picture (owner, 16 October:
// characteristics every time, what the others carry, the wave).
const BONUS_TEXT = Object.freeze({
  stone: 'reinforced weapons: +10% melee damage per level (up to +80%); +1 extra target per swing at level 4, +2 at level 8; melee only, same reach, arc and damage retention',
  perforating: 'armor-piercing rounds: one extra zombie pierced at level 3, a second at 6, a third at 8 (not for blades, flames, rockets or the bolt-action)',
  extended: 'extended magazine: +10% magazine and reserve per level',
  reinforced: 'reinforced rounds: +15% base damage every two levels (+15% at 2, +30% at 4, +45% at 6, +60% at 8; bullet weapons, shotgun and bolt-action included, never blades, flames, rockets or the golden magnum)',
  radar: `field radar: a zombie blip on your map every ${radarBlipSeconds(1)} s (${RADAR.range} m), faster every level, continuous at 8`,
});
const BONUS_SHORT = Object.freeze({
  stone: 'reinforced weapons: +10% melee damage a level; +1 extra target per swing at level 4, +2 at level 8',
  perforating: 'an extra zombie pierced at level 3, another at 6, a third at 8',
  extended: '+10% magazine and reserve a level',
  reinforced: '+15% damage every two levels, up to +60%',
  radar: 'zombie blips on your map, faster every level',
});
// What a survivor carries, compactly: "extended 3, radar 1" or "none".
const carried = player => Object.entries(player?.bonus ?? {}).filter(([kind]) => Object.hasOwn(SUPPLY_BONUSES, kind))
  .map(([kind, level]) => `${kind} ${level}`).join(', ') || 'none';
// A claim trip out to the crate: the same way out and rain checks as an
// outing for a pickup, minus the fading (a crate stands its wave and break).
function crateTrip(sim, self, crate) {
  const way = wayOut(sim, crate);
  if (!way) return { why: 'no open doorway leads out to it' };
  const rain = rainCost(sim, self, way.distance, way);
  if (!rain.affordable) return { why: 'too long in the rain for you' };
  return { ...way, ...rain };
}
// The crate, whole: where it stands, who has claimed, the bonuses its guns
// make it eligible for with their ladders and levels, what the family
// carries, the enemies by it, and the trip out.
function crateLine(sim, self, view) {
  const crate = sim.supplyCrate;
  if (!crate) return null;
  const next = nextCrateWave(sim, self) ? `; next claim as wave ${sim.wave + 1} starts` : '';
  if (crate.active === false) return `SUPPLY CRATE: fixed outside, inactive; one independent claim per wave 2-18 when active${next}.`;
  const mine = crate.claimed.has(self.id);
  const claimers = [...crate.claimed].map(id => nameOf(sim.players.get(id))).filter(Boolean);
  const near = view.enemies.filter(enemy => enemy.seen && !enemy.inside && !enemy.raider && flat(enemy.zombie, crate) <= 5).length;
  const family = view.humans.filter(player => carried(player) !== 'none').map(player => `${nameOf(player)} ${carried(player)}`).join(', ');
  const plan = planFor(sim, self), runner = plan && crateRunner(sim);
  const goods = Object.keys(SUPPLY_BONUSES).filter(kind => sim.bonusEligible(self, kind)).map(kind => {
    // The shared claim step (character-sheet.js); companions play the standard sheet.
    const { from: level, to: next } = claimStep(self, kind);
    if (plan) return `${kind} ${level} -> ${next}${kind === plan.bonus ? ' (planned)' : ''}`;
    return `${kind} (${Object.hasOwn(CHARACTER_BONUSES, kind) ? nextCharacterBonus(self, kind) : BONUS_TEXT[kind]}${level ? `; yours ${level} -> ${next}` : '; new for you'})`;
  }).join('; ');
  const trip = mine ? null : crateTrip(sim, self, crate);
  return `SUPPLY CRATE (free, one bonus per survivor — claiming takes nothing from anyone; renewed as each wave 2-18 starts, claimable through the break after): ${relative(self, crate)}`
    + (mine ? `; you have claimed yours${next}` : `; you have NOT claimed yours; eligible: ${goods || 'none fit your weapons'}`)
    + (claimers.length ? `; claimed by ${claimers.join(', ')}` : '')
    + (family ? `; the family carries ${family}` : '')
    + (runner ? runner === self.id ? '; your planned turn to collect, others cover' : `; ${nameOf(sim.players.get(runner))} has the planned turn; cover or wait, override if needed` : '')
    + (near ? `; ${near} ${near > 1 ? 'enemies' : 'enemy'} within 5 m of it` : '')
    + (!mine ? (trip && !trip.why
      ? `. A claim is a trip: out through the ${trip.door.id} door${trip.crouch ? ' (crouch through the lower opening)' : ''}, about ${trip.seconds} s in the rain${trip.burn ? `, ~${trip.burn} HP past the umbrella` : ' under the umbrella'}`
      : `. No way to it right now: ${trip.why}`) : '')
    + '.';
}
// The station (LATE_SUPPLIES): one of each service per wave, offered with
// the racks while the shop is open, each only while it still makes sense.
function stationNeeded(sim, self, service) {
  if (service === 'revive') return self.reviveKit !== true;
  if (service === 'grenade') return self.grenades < (characterStats(self).maxGrenades ?? GRENADES.maxCarry);
  if (service === 'armor') return (self.armor ?? 0) < ARMOR.max;
  if (service === 'backpack') return self.backpack !== true;
  // The ammo service is a full refill of every gun carried: worth it as soon
  // as any of them runs below its total (owner, 16 October).
  if (service === 'ammo') return Object.entries(self.inventory ?? {}).some(([weaponId, stock]) => {
    const profile = sim.weaponProfile(self, weaponId);
    return profile && !profile.melee && stock.ammo + stock.reserve < profile.magazine + profile.reserve;
  });
  return false;
}
function stationBuys(sim, self) {
  const bought = self.supplyPurchases ?? [];
  return Object.entries(LATE_SUPPLIES.items)
    .filter(([service, item]) => sim.wave >= (item.unlockWave ?? LATE_SUPPLIES.unlockWave) && self.points >= item.price
      && !bought.includes(service) && stationNeeded(sim, self, service))
    .sort((a, b) => a[1].price - b[1].price || a[0].localeCompare(b[0]));
}
function stationLine(sim, self) {
  const first = Math.min(...Object.values(LATE_SUPPLIES.items).map(item => item.unlockWave ?? LATE_SUPPLIES.unlockWave));
  if (sim.wave < first) return null;
  const bought = self.supplyPurchases ?? [];
  const goods = Object.entries(LATE_SUPPLIES.items).map(([service, item]) => sim.wave < (item.unlockWave ?? LATE_SUPPLIES.unlockWave) ? `${service}: wave ${item.unlockWave ?? LATE_SUPPLIES.unlockWave}`
    : bought.includes(service) ? `${service}: bought this wave` : `${service} ${item.price}`).join(', ');
  return `SUPPLY STATION, ${place(sim, LATE_SUPPLIES.position)} (one of each per wave): ${goods}; you have ${grouped(self.points)} coins.`;
}
// Unlocked, affordable, not owned nor given up this wave: the planned goal
// first when present, then the most expensive. Worth buying
// (companions/arsenal.mjs, asked again by the body at the
// rack): never a blade while it has a gun with ammo (melee puts it in the
// crowd), and with every slot full only what is worth more than the weapon it
// replaces, the one it can best spare (the price; a blade keeps it, an empty
// gun is worth nothing), not the one in hand: with more coins it would buy
// cheaper guns over better ones (review of 13 October: shotgun, bat, shotgun,
// fire axe, bat).
function purchasable(sim, self) {
  const plan = planFor(sim, self);
  return ARMORY.filter(rack => rack.weapon !== 'magnum' && sim.wave >= (rack.unlockWave ?? 0) && self.points >= rack.price
    && !weaponEntries(self).some(item => item.weapon === rack.weapon) && !self.issuedWeapons?.has?.(rack.weapon) && worthBuying(sim, self, rack.weapon))
    .sort((a, b) => Number(b.weapon === plan?.goalWeapon) - Number(a.weapon === plan?.goalWeapon) || b.price - a.price || byId(a, b));
}
// About to bite (inside, or anywhere once it is outside): no purchase kept then.
const biting = (sim, self) => [...sim.zombies.values()].some(zombie => zombie.hp > 0 && flat(zombie, self) < BITE
  && Math.abs((zombie.y ?? 0) - self.y) < 2 && (outside(self) || !outside(zombie)));
const buyable = (sim, self) => shopOpen(sim, self) ? purchasable(sim, self) : [];
// Inside, or on a doorstep within reach from inside the doorway.
const downedMate = (sim, self, player) => Boolean(player && player !== self && player.alive && player.downed && !player.waiting
  && (!outside(player) || doorstepSpot(sim, player)));
const followable = player => Boolean(player && human(player) && player.alive && !player.downed && !player.waiting && !outside(player));
const canReload = (sim, self) => {
  const ids = [activeWeaponId(self), ...(self.dualWield ? [sim.weaponHandState?.(self, 'secondary')?.weaponId] : [])].filter(Boolean);
  return ids.some(id => { const profile = sim.weaponProfile(self, id), stock = weaponStock(self, id);
    return Boolean(profile && stock && !profile.melee && stock.ammo < profile.magazine && stock.reserve > 0); });
};
// A shoot order may wait for its ordinary automatic reload, but cannot
// accomplish anything once the held weapon has neither rounds nor reserve.
// Melee never consumes ammunition; usable alternatives remain explicit choices.
const canShoot = (sim, self) => {
  const profile = sim.weaponProfile(self), stock = weaponStock(self);
  const secondaryId = self.dualWield && sim.weaponHandState?.(self, 'secondary')?.weaponId;
  const secondary = secondaryId && weaponStock(self, secondaryId);
  return Boolean(profile && (profile.melee || stock && stock.ammo + stock.reserve > 0 || secondary && secondary.ammo + secondary.reserve > 0));
};
const dualChoices = (sim, self) => typeof sim.setDualWield === 'function' && characterStats(self).dualWield && !sim.weaponProfile(self)?.melee
  ? weaponEntries(self).filter(({ id, weapon, stock }) => id !== activeWeaponId(self) && weapon !== 'magnum' && !sim.weaponProfile(self, id)?.melee && stock.ammo + stock.reserve > 0) : [];

// Is the current order still something the companion may do?
// Never while down or out: those get exactly self-kit and wait.
function orderLegal(sim, self, order) {
  if (!order || !self.alive || self.waiting || self.downed) return false;
  if (!HAZARD_PHASES.includes(sim.phase)) return order.kind === 'hold';
  const door = sim.doors.find(item => item.id === order.doorId), player = sim.players.get(order.playerId);
  switch (order.kind) {
    case 'hold': case 'loft': return true;
    case 'shoot': return canShoot(sim, self) && sim.zombies.get(order.zombieId)?.hp > 0;
    case 'defend': return activeDoor(door);
    case 'repair': return activeDoor(door) && door.hp < door.maxHp;
    case 'revive': return downedMate(sim, self, player);
    case 'kit': return downedMate(sim, self, player) && self.reviveKit === true;
    case 'follow': return followable(player);
    case 'collect': return sim.pickups.has(order.pickupId);
    case 'coins': return Boolean(coinSweep(sim, self));
    // A purchase started in a calm moment may be finished (keep) when a zombie
    // comes within 8 m (dropping it a few steps from the rack wasted it), never
    // with one about to bite: the buying body walks on and never backs off.
    case 'buy': return purchasable(sim, self).some(rack => rack.id === order.rackId) && (shopOpen(sim, self) || !biting(sim, self));
    case 'weapon': return Object.hasOwn(self.inventory, order.weapon ?? '') && weaponType(order.weapon) !== 'magnum';
    case 'dual': return order.weapon === 'off' ? self.dualWield === true : dualChoices(sim, self).some(item => item.id === order.weapon);
    case 'reload': return self.reloadUntil > sim.time || canReload(sim, self);
    case 'grenade': return self.grenades > 0 && sim.zombies.get(order.zombieId)?.hp > 0;
    // Or pre-staged: waiting inside for the next wave's crate (nextCrateWave).
    case 'claim': return Boolean(sim.supplyCrate && (sim.supplyCrate.active !== false && !sim.supplyCrate.claimed.has(self.id) || nextCrateWave(sim, self)) && sim.bonusEligible(self, order.bonus));
    case 'supply': return stationBuys(sim, self).some(([service]) => service === order.service) && (shopOpen(sim, self) || !biting(sim, self));
    case 'umbrella': return calm(sim, self) && (self.umbrella?.remaining ?? UMBRELLA.max) < UMBRELLA.max - 1e-8;
    default: return false;
  }
}
function describeOrder(sim, self, order) {
  const player = sim.players.get(order.playerId), zombie = sim.zombies.get(order.zombieId), pickup = sim.pickups.get(order.pickupId);
  switch (order.kind) {
    case 'hold': return 'hold your position';
    case 'loft': return IS_HOSPITAL ? 'hold a basement post at the main or service stair foot' : IS_FUNFAIR ? 'hold a cellar post at the main or service stair foot' : IS_SUPERMARKET ? 'hold the sheltered cellar reserve post' : 'hold the loft';
    case 'shoot': return `shoot ${clean(order.zombieId, 12)}${zombie ? ` (${enemyName(zombie)})` : ' (gone)'}`;
    case 'defend': return `defend the ${clean(order.doorId, 8)} door`;
    case 'repair': return `repair the ${clean(order.doorId, 8)} door`;
    case 'revive': return `revive ${nameOf(player)}`;
    case 'kit': return `use your kit on ${nameOf(player)}`;
    case 'self-kit': return 'use your kit on yourself';
    case 'wait': return 'wait for help';
    case 'follow': return `follow ${nameOf(player)}`;
    case 'collect': return `pick up ${pickup ? `the ${pickupLabel(pickup)}${outside(pickup) ? ' outside' : ''}` : 'an item (gone)'}`;
    case 'coins': return 'pick up the coins near you';
    case 'buy': return `buy the ${label(ARMORY.find(rack => rack.id === order.rackId)?.weapon ?? order.rackId)}`;
    case 'weapon': return `switch to the ${label(order.weapon)}`;
    case 'dual': return order.weapon === 'off' ? 'return to a single weapon' : `dual wield with ${label(weaponType(order.weapon, weaponStock(self, order.weapon)))}`;
    case 'reload': return 'reload';
    case 'grenade': return `throw a grenade at the pack round ${clean(order.zombieId, 12)}${zombie ? '' : ' (gone)'}`;
    case 'claim': return `claim ${clean(order.bonus, 12)} from the ${nextCrateWave(sim, self) ? 'next ' : ''}supply crate`;
    case 'supply': return `buy the ${clean(order.service, 12)} at the supply station`;
    case 'umbrella': return 'refill your umbrella at the generator';
    default: return clean(order.kind, 12);
  }
}

function legalActions(sim, self, view, current, orderSince) {
  const actions = [];
  const add = (value, description) => { if (!actions.some(action => action.value === value)) actions.push({ value, description: clean(description, 170) }); };
  if (!self.alive || self.waiting) { add('wait', 'You are out until the next wave: nothing to do.'); return actions; }
  if (self.downed) {
    if (self.reviveKit === true) add('self-kit', `Use your revive kit on yourself: up in ${REVIVE.kitDuration} s with ${REVIVE.kitHp} HP.`);
    add('wait', `Stay down and wait for a teammate (${seconds(self.bleedOutAt - sim.time)} before elimination).`);
    return actions;
  }
  if (orderLegal(sim, self, current)) add('keep', `Keep your current order: ${describeOrder(sim, self, current)} (${elapsed(sim.time - orderSince)} so far).`);
  if (!HAZARD_PHASES.includes(sim.phase)) { add('hold', 'Stay where you are.'); return actions; }
  const armed = canShoot(sim, self), verb = sim.weaponProfile(self)?.melee ? 'Attack' : 'Shoot';
  const downed = view.team.filter(player => downedMate(sim, self, player));
  const from = player => { const spot = doorstepSpot(sim, player); return spot ? `, from inside the ${spot.doorId} door` : ''; };
  for (const player of downed) {
    const status = sim.reviveStatus(player), helper = status.revivedBy && sim.players.get(status.revivedBy);
    add(`revive:${player.id}`, `Revive ${nameOf(player)} by hand: ${characterStats(self).reviveSeconds} s beside them (${seconds(player.bleedOutAt - sim.time)} before elimination); ${relative(self, player)}${from(player)}${helper ? `; ${helper === player ? 'their own kit is lifting them' : `${nameOf(helper)} is already on it`}` : ''}.`);
  }
  if (self.reviveKit === true) for (const player of downed) {
    add(`kit:${player.id}`, `Use your revive kit on ${nameOf(player)}: up at once with ${REVIVE.kitHp} HP (a new kit costs ${LATE_SUPPLIES.items.revive.price}); ${relative(self, player)}${from(player)}.`);
  }
  const heldProfile = sim.weaponProfile(self), pierce = heldProfile?.penetrationTargets ?? 1;
  const heldFacts = view.combat.find(facts => facts.id === activeWeaponId(self));
  for (const enemy of view.enemies.filter(item => armed && item.seen && item.inReach).slice(0, MAX_TARGETS)) {
    const geometry = heldFacts?.targets.get(enemy.zombie.id) ?? (heldProfile?.fuel
      ? flameOpportunity(sim, self, enemy.zombie, view.observed, heldProfile) : piercingOpportunity(sim, self, enemy.zombie, view.observed, heldProfile));
    const lined = geometry.behind ?? 0;
    const area = heldProfile?.fuel ? geometry.count
      ? `; ${geometry.count} visible exposed bodies in flame cone${geometry.burning ? `, ${geometry.burning} already burning` : ''}`
      : '; outside flame reach now; approach only if safe' : '';
    add(`shoot:${enemy.zombie.id}`, `${verb} ${enemy.zombie.id} ${enemyName(enemy.zombie)}, ${enemyWhere(enemy)}, ${enemyGoal(enemy, self)}; ${relative(self, enemy.zombie)}${lined ? `; ${lined} more lined up behind it (your gun pierces ${pierce})` : ''}${area}.`);
  }
  const grenadeStats = characterStats(self), grenadeDamage = Math.round(GRENADES.damage * (grenadeStats.grenadeDamageMultiplier ?? 1));
  const blast = sim.friendlyFireOn?.() === true
    ? `the blast hurts survivors within ${GRENADES.radiusDamage} m too, you included`
    : 'never hurts the team or the boards';
  for (const { enemy, size } of packs(sim, self, view)) {
    add(`grenade:${enemy.zombie.id}`, `Throw a grenade at the pack of ${size} round ${enemy.zombie.id}, ${enemyWhere(enemy)}; ${relative(self, enemy.zombie)}; you carry ${self.grenades}/${grenadeStats.maxGrenades ?? GRENADES.maxCarry}, ${grenadeDamage} damage within ${GRENADES.innerRadius} m, ${blast}.`);
  }
  const sweep = coinSweep(sim, self);
  for (const door of sim.doors.filter(item => activeDoor(item) && item.hp < item.maxHp)) {
    const at = view.enemies.filter(enemy => enemy.seen && !enemy.inside && enemy.door === door && flat(enemy.zombie, door) <= AT_DOOR).length;
    // Coins just outside it that the coins action would sweep now: first.
    const coins = (sweep?.piles ?? []).filter(item => item.door === door).reduce((sum, item) => sum + item.pickup.amount, 0);
    // Teammates outside whose way back in it is: the body waits for them.
    const relying = shutOut(sim, door, self.id).map(nameOf);
    const access = crateAccessAtDoor(sim, door), pending = access?.claimants.filter(player => player.companion === true) ?? [];
    const crateFirst = pending.length ? `Crate exit for ${pending.slice(0, 2).map(player => clean(nameOf(player), 12)).join('/')} ${pending.length > 2 ? `+${pending.length - 2} ` : ''}: safe claims before resealing; danger overrides. ` : '';
    // The east door is mended from the open-air terrace: the whole job is in
    // the rain, walk both ways and every repair action (one per 0.56 s), and
    // is not offered when it would leave the companion under the HP floor.
    const rain = wetApproach(door) ? rainCost(sim, self, 0, { door }, Math.ceil((door.maxHp - door.hp) / characterStats(self).repairHp) * .56) : null;
    if (rain && !rain.affordable) continue;
    add(`repair:${door.id}`, crateFirst + `Rebuild the ${door.id} door boards (${boardsLeft(door)}/5 left${at ? `, ${at} ${at > 1 ? 'enemies' : 'enemy'} at it` : ''}${coins && !relying.length ? `; ${coins} coins lie just outside it: pick them up first (coins)` : ''}); ${relative(self, door)}`
      + `${rain ? `; in the terrace rain (~${rain.seconds} s, ${rain.burn ? `~${rain.burn} HP` : `umbrella ${rain.umbrella} s left`})` : ''}`
      + `${relying.length ? `; ${relying.join(' and ')} ${relying.length > 1 ? 'are' : 'is'} out beyond it: you wait till they are back in` : ''}.`);
  }
  // Humans outside are covered from the door they are nearest, never followed.
  const out = view.humans.filter(player => player.alive && !player.downed && outside(player));
  for (const door of sim.doors.filter(activeDoor)) {
    const beyond = out.filter(player => nearestDoor(sim.doors, player, activeDoor) === door).map(nameOf);
    const from = wetApproach(door) ? 'the roofed terrace passage (the doorway is in the acid rain)' : armed ? 'inside' : 'safe cover inside';
    add(`defend:${door.id}`, `${armed ? 'Guard' : 'No ammunition: watch'} the ${door.id} door from ${from} (${doorState(view, door)}); ${relative(self, door)}${beyond.length ? `; ${beyond.join(' and ')} ${beyond.length > 1 ? 'are' : 'is'} outside beyond it` : ''}.`);
  }
  for (const player of view.team.filter(followable)) {
    const threat = threatText(view.threats(player), 'them');
    // In the supermarket's rain: on the exterior flight the body follows them
    // into it (no roofed spot sees that flight); on the open terrace it covers
    // them from the roofed passage while it sees them. Said before the
    // distance, which then leaves the rain out, so a long line loses the
    // distance first.
    const wet = !outside(player) && !sheltered(player) && (spaceFlightAt(player.x, player.z, player.y ?? 0)
      ? 'on the exterior stairs (acid rain): you follow them into the rain' : 'on the rainy terrace: covered from the roofed passage while in sight');
    add(`follow:${player.id}`, `${armed ? 'Stay' : 'No ammunition: stay'} 2-4 m from ${nameOf(player)} ${armed ? 'and protect them' : 'in safe cover'}; HP ${Math.round(player.hp)}${threat ? `, ${threat}` : ''}; ${wet ? `${wet}; ` : ''}${relative(self, player, !wet)}.`);
  }
  const soaked = !outside(self) && !sheltered(self);
  add('hold', soaked ? `${armed ? '' : 'No ammunition: '}You stand in acid rain (${place(sim, self)}): hold under the roof by the terrace passage${armed ? ` and shoot threats within ${HOLD_RANGE} m` : ''}.`
    : armed ? `Stay where you are (${place(sim, self)}) and shoot threats within ${HOLD_RANGE} m.`
    : `No ammunition: stay where you are (${place(sim, self)}) in safe cover.`);
  // The supermarket, hospital and funfair name the post the body would take
  // (loftRank); every variant fits under 170 characters, unarmed and from the
  // rain included (routed metres from the ground floor used to cut the line).
  add('loft', IS_HOSPITAL ? `${armed ? '' : 'No ammo: take cover. '}${loftRank(sim, self.id) === 0 ? `Hold the basement post at the main stair foot (${relative(self, LOFT_POST)}), watching up that flight.`
      : `Hold the second basement post, at the service stair foot (${relative(self, LOFT_POST_EXTERIOR)}), watching up it.`}`
    : IS_FUNFAIR ? `${armed ? '' : 'No ammo: take cover. '}${loftRank(sim, self.id) === 0 ? `Hold the cellar post at the main stair foot (${relative(self, LOFT_POST)}), watching up that flight.`
      : `Hold the second cellar post, at the service stair foot (${relative(self, LOFT_POST_EXTERIOR)}), watching up it.`}`
      : IS_SUPERMARKET ? `${armed ? '' : 'No ammo: take cover. '}${loftRank(sim, self.id) === 0 ? `Hold the cellar post at the interior stair foot (${relative(self, LOFT_POST)}); second exit: exterior stairs.`
        : `Hold the second cellar post, watching the exterior stairs (${relative(self, LOFT_POST_EXTERIOR)}).`}`
        : `${armed ? '' : 'No ammunition: seek safe cover. '}${floorOf(self) === 'loft' ? 'Hold the loft post at the top of the stairs.' : 'Go up to the loft and hold the top of the stairs.'}`);
  if (canReload(sim, self) && !(self.reloadUntil > sim.time) && !(self.dualWield && sim.weaponHandState?.(self, 'secondary')?.reloadUntil > sim.time))
    add('reload', self.dualWield ? 'Reload both held weapons in parallel, each from its own reserve and with its own reload duration.' : `Reload your ${stockText(sim, self, activeWeaponId(self))} now.`);
  for (const { id, weapon, stock } of weaponEntries(self)) {
    const profile = sim.weaponProfile(self, id);
    if (id === activeWeaponId(self) || weapon === 'magnum' || !profile || !profile.melee && stock.ammo + stock.reserve <= 0) continue;
    const reload = self.reloadUntil > sim.time ? `; cancels this reload (${tenths(self.reloadUntil - sim.time)} left), which must restart from zero on return` : '';
    const fit = combatFit(view.combat.find(facts => facts.id === id));
    add(`weapon:${id}`, `Switch to your ${stockText(sim, self, id)}${reload}${fit ? `; ${fit}` : ''}.`);
  }
  if (self.dualWield) add('dual:off', 'Return to one weapon; restore normal scoped aiming and the primary weapon mobility.');
  for (const { id } of dualChoices(sim, self)) if (!self.dualWield || id !== self.secondaryWeaponId)
    add(`dual:${id}`, `Dual wield with your ${stockText(sim, self, id)}: independent fire/ammo/reload, hip fire only, slower held weapon sets mobility.`);
  const pickups = [...sim.pickups.values()].map(pickup => ({ pickup, reason: collectReason(sim, self, pickup, view) }))
    .filter(item => item.reason).sort((a, b) => flat(self, a.pickup) - flat(self, b.pickup) || byId(a.pickup, b.pickup));
  for (const { pickup, reason } of pickups.slice(0, MAX_COLLECTS)) {
    add(`collect:${pickup.id}`, outside(pickup) ? outingText(sim, self, pickup, view) : `Pick up the ${pickupLabel(pickup)} ${relative(self, pickup)} (${reason}).`);
  }
  if (sweep) add('coins', coinsText(sweep, self, view));
  // The generator refills the umbrella to full, free: worth the walk in a
  // calm moment once it runs low (a worn umbrella is said in the YOU line).
  const umbrellaLeft = self.umbrella?.remaining ?? UMBRELLA.max;
  if (umbrellaLeft < 50 && calm(sim, self))
    add('umbrella', `Refill your umbrella at the generator (${Math.floor(umbrellaLeft)} s of rain left, back to ${UMBRELLA.max} s); ${relative(self, GENERATOR)}.`);
  // The crate: free and per player (owner, 16 October: whenever a crate
  // stands unclaimed, going for it is nearly always worth the short trip).
  // Spent (claimed, or inactive) in the break's last seconds before a crate
  // wave: wait inside at the exit for the next one rather than walk out to
  // this one and back (owner, 18 October).
  const crate = sim.supplyCrate;
  const plan = planFor(sim, self);
  const open = crate && crate.active !== false && !crate.claimed.has(self.id);
  const staged = !open && sim.timeLeft <= NEXT_CRATE_LEAD ? nextCrateWave(sim, self) : 0;
  if (open || staged) {
    const trip = crateTrip(sim, self, crate);
    if (!trip.why) for (const kind of Object.keys(SUPPLY_BONUSES).filter(kind => sim.bonusEligible(self, kind))
      .sort((a, b) => Number(b === plan?.bonus) - Number(a === plan?.bonus))) {
      const { from: level, to: next } = claimStep(self, kind), effect = Object.hasOwn(CHARACTER_BONUSES, kind) ? nextCharacterBonus(self, kind) : BONUS_SHORT[kind];
      const rain = `~${trip.seconds}s rain${trip.burn ? ` ~${trip.burn}HP` : ''}`;
      // The effect last: the description's 170-character cut only trims it.
      add(`claim:${kind}`, `${kind === plan?.bonus ? 'Planned bonus. ' : ''}${staged
        ? `Next crate (wave ${staged} starts in ~${Math.ceil(sim.timeLeft)}s): wait inside at the ${trip.door.id} exit, then claim ${kind} as soon as it opens, ${trip.crouch ? 'crouch, ' : ''}${rain}; free, per player; ${level}->${next}: ${effect}.`
        : `Claim ${kind} (${effect}; ${level}->${next}): ${trip.crouch ? 'crouch ' : ''}out ${trip.door.id}, ${rain}; free, per player.`}`);
    }
  }
  const spare = replaced(sim, self);
  for (const rack of buyable(sim, self).slice(0, MAX_BUYS)) {
    add(`buy:${rack.id}`, `${rack.weapon === plan?.goalWeapon ? 'Planned weapon. ' : ''}Buy the ${label(rack.weapon)} for ${rack.price} of your ${self.points} coins at its rack ${relative(self, rack)}${spare ? `; it replaces your ${label(spare)}` : ''}.`);
  }
  const stock = { revive: 'a revive kit', grenade: `a grenade (you carry ${self.grenades}/${characterStats(self).maxGrenades ?? GRENADES.maxCarry})`, armor: `an armor vest (yours ${Math.round(self.armor ?? 0)} HP)`,
    ammo: 'a full ammo refill of every gun you carry', backpack: 'the backpack (carry 4 guns, a little slower)' };
  if (shopOpen(sim, self)) for (const [service, item] of stationBuys(sim, self)) {
    add(`supply:${service}`, `Buy ${stock[service] ?? service} at the station for ${item.price} of your ${self.points} coins, ${place(sim, LATE_SUPPLIES.position)}.`);
  }
  return plan ? tacticalActions(sim, self, actions, plan) : actions.slice(0, MAX_ACTIONS);
}

// Reserve space across choices before taking the best few in each category.
// A busy doorway must not push a rescue, usable spare gun, crate or planned
// purchase beyond the old final slice. Extra urgent choices can exceed the
// normal 16-action target, up to the existing protocol ceiling of 24.
function tacticalActions(sim, self, actions, plan) {
  const mandatory = new Set();
  const keep = value => { if (actions.some(action => action.value === value)) mandatory.add(value); };
  for (const { value } of actions) if (['keep', 'hold', 'loft', 'reload'].includes(value)
    || /^(revive|kit|weapon):/.test(value) || value === 'dual:off') keep(value);
  const first = prefix => actions.find(action => action.value.startsWith(prefix))?.value;
  keep(first('shoot:'));
  keep(`buy:${ARMORY.find(rack => rack.weapon === plan.goalWeapon)?.id}`);
  if (![...mandatory].some(value => value.startsWith('buy:'))) keep(first('buy:'));
  keep(`claim:${plan.bonus}`);
  if (![...mandatory].some(value => value.startsWith('claim:'))) keep(first('claim:'));
  const profile = sim.weaponProfile(self), stock = weaponStock(self);
  const noAmmo = Boolean(profile && !profile.melee && stock && stock.ammo + stock.reserve <= 0);
  if (noAmmo) keep('supply:ammo');
  for (const { value } of actions) if (value.startsWith('collect:')) {
    const pickup = sim.pickups.get(value.slice(8));
    if ((pickup?.kind === 'ammo' && noAmmo) || (pickup?.kind === 'health' && self.hp <= 40)) keep(value);
  }
  const rank = ({ value }, index) => {
    if (mandatory.has(value)) return -100;
    if (value === `defend:${plan.post}` || value === 'loft' && plan.post === 'loft') return -20;
    if (value.startsWith('shoot:')) return index / 100;
    if (value.startsWith('grenade:')) return 1;
    if (value === 'supply:revive' && plan.role === 'medic') return 2;
    if (value.startsWith('claim:')) return 3;
    if (value.startsWith('collect:')) return 4;
    if (value.startsWith('dual:')) return 4.5;
    if (value.startsWith('buy:')) return 5;
    if (value.startsWith('follow:') && plan.post === 'team') return 6;
    if (value.startsWith('defend:')) return 7;
    if (value.startsWith('repair:')) return 8;
    if (value === 'umbrella') return 8.5;
    if (value === 'coins') return 9;
    return 10;
  };
  const limit = Math.min(MAX_ACTIONS, Math.max(TACTICAL_ACTIONS, mandatory.size));
  const chosen = new Set(actions.map((action, index) => ({ action, index, rank: rank(action, index) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).slice(0, limit).map(item => item.action.value));
  // Preserve the usual presentation order, especially `keep` first.
  return actions.filter(action => chosen.has(action.value));
}

function doorState(view, door) {
  const left = boardsLeft(door);
  return view.open(door) ? left ? `${left}/5 boards, zombies can walk through` : 'no boards left, wide open' : `${left}/5 boards`;
}
function doorLine(sim, self, view, door) {
  const near = view.enemies.filter(enemy => enemy.seen && enemy.door === door);
  const at = near.filter(enemy => !enemy.inside && !enemy.raider && flat(enemy.zombie, door) <= AT_DOOR).length;
  const coming = near.filter(enemy => !enemy.inside && !enemy.raider && flat(enemy.zombie, door) > AT_DOOR).length;
  // "Inside by it" means on the door's own level; the supermarket cellar
  // extends under the north, south and east doors, the hospital basement
  // under all four, and a zombie there is under the door.
  const byIt = enemy => enemy.inside && flat(enemy.zombie, door) <= 3 && (!HAS_SPACE || sameLevel(enemy.zombie, door));
  const inside = near.filter(byIt).length;
  const under = HAS_SPACE ? near.filter(enemy => enemy.inside && !byIt(enemy) && flat(enemy.zombie, door) <= 3 && (enemy.zombie.y ?? 0) < (door.y ?? 0)).length : 0;
  const raiders = near.filter(enemy => enemy.raider && !enemy.inside && !enemy.retreating).length;
  const crowd = [at && `${at} zombie${at > 1 ? 's' : ''} at it`, coming && `${coming} ${at ? 'more ' : ''}coming`, inside && `${inside} already inside by it`,
    under && `${under} in the ${IS_HOSPITAL ? 'basement' : 'cellar'} under it`, raiders && `${raiders} raider${raiders > 1 ? 's' : ''} out this side`].filter(Boolean).join(', ') || 'quiet';
  return `- ${door.id} door, ${relative(self, door)}: ${doorState(view, door)} (${percent(door.hp, door.maxHp)}%)${door.sealPending ? ', being sealed' : ''}; ${crowd}`
    + `${doorwayPassage(sim, door)?.crouch ? '; crouch through the lower opening' : doorwayOpen(sim, door) ? '; you can step outside through it' : ''}.`;
}
function teamLine(sim, self, view, player) {
  const who = `${nameOf(player)} (${human(player) ? 'human' : 'AI'})`;
  if (!player.alive) return `- ${who}: eliminated, back next wave.`;
  const where = `${place(sim, player)}, ${relative(self, player)}`;
  if (player.downed) {
    const status = sim.reviveStatus(player), helper = status.revivedBy && sim.players.get(status.revivedBy);
    const help = helper === player ? `own kit lifts them in ${seconds(status.reviveLeft)}` : helper ? `${helper === self ? 'YOU are' : `${nameOf(helper)} is`} reviving them (${seconds(status.reviveLeft)} left)`
      : 'nobody is reviving them';
    const spot = outside(player) && doorstepSpot(sim, player);
    const reach = !outside(player) ? '' : spot ? `; on the doorstep: revive them from inside the ${spot.doorId} door` : '; outside: you cannot go there';
    return `- ${who}: DOWN, ${where}; ${seconds(player.bleedOutAt - sim.time)} before elimination; ${help}${player.reviveKit ? '; has a kit' : ''}${reach}.`;
  }
  const reviving = player.reviving && sim.players.get(player.reviving.targetId);
  const threat = threatText(view.threats(player), 'them');
  return `- ${who}: ${where}; HP ${Math.round(player.hp)}${characterStats(player).maxHp !== 100 ? `/${characterStats(player).maxHp}` : ''}${player.armor ? ` +${Math.round(player.armor)} armor` : ''}${player.hp <= 40 ? ' (badly hurt)' : ''}; `
    + `${player.weapon ? stockText(sim, player, activeWeaponId(player), true) : 'unarmed'}; ${player.reviveKit ? 'has a kit' : 'no kit'}; bonuses ${carried(player)}`
    + `${reviving ? `; reviving ${nameOf(reviving)}` : ''}${threat ? `; ${threat}` : ''}${sim.phase === 'intermission' && player.nextWaveVote ? '; ready for the next wave' : ''}.`;
}
function selfLine(sim, self, view) {
  const who = `${nameOf(self)} (AI teammate)`;
  if (!self.alive || self.waiting) return `YOU: ${who}, out of the fight until the next wave.`;
  const kit = `revive kit: ${self.reviveKit ? 'yes' : 'no'}`;
  if (self.downed) {
    const status = sim.reviveStatus(self), helper = status.revivedBy && sim.players.get(status.revivedBy);
    const help = helper === self ? `Your kit lifts you in ${seconds(status.reviveLeft)}.` : helper ? `${nameOf(helper)} is reviving you (${seconds(status.reviveLeft)} left).` : 'Nobody is reviving you yet.';
    return `YOU ARE DOWN: ${who}, ${place(sim, self)}; ${seconds(self.bleedOutAt - sim.time)} before elimination; zombies ignore you. ${help} Revive kit: ${self.reviveKit ? 'yes' : 'no'}.`;
  }
  const others = weaponEntries(self).filter(item => item.id !== activeWeaponId(self)).map(item => stockText(sim, self, item.id));
  const threat = threatText(view.threats(self), 'you');
  // The umbrella (100 s of rain; no shooting while open): said outside, or once used.
  const left = Math.floor(self.umbrella?.remaining ?? UMBRELLA.max);
  const umbrella = outside(self) || sim.rainExposed?.(self) ? `; umbrella ${self.umbrella?.open ? 'open' : 'folded'}, ${left} s left` : left < UMBRELLA.max ? `; umbrella ${left} s left` : '';
  // Every doorway boarded up behind it: the body shoots a plank out to get
  // back in, with a gun that has ammo (blades, flames and rockets cannot).
  const profile = sim.weaponProfile(self), held = weaponStock(self);
  const empty = profile && !profile.melee && held && held.ammo === 0 && held.reserve === 0;
  const secondary = self.dualWield && weaponStock(self, sim.weaponHandState?.(self, 'secondary')?.weaponId);
  const ammo = empty ? secondary && secondary.ammo + secondary.reserve > 0
    ? '; PRIMARY EMPTY: secondary remains usable; collect primary ammunition or use the secondary while safe'
    : '; NO AMMO: this weapon cannot fire or reload; if offered and safe, collect ammo, switch to a usable weapon or buy one; otherwise seek cover' : '';
  const gun = profile && !profile.melee && !profile.fuel && !profile.explosive && held && held.ammo + held.reserve > 0;
  const shut = !outside(self) || sim.doors.some(door => sim.doorPassable(door, 0, PLAYER_POSTURE.standingHeight)) ? ''
    : `; SHUT OUTSIDE (every doorway boarded up): ${gun ? 'you shoot a plank out of the nearest to get back in' : 'you wait by the nearest (a gun with ammo would shoot a plank out)'}`;
  return `YOU: ${who}, ${place(sim, self)}; HP ${Math.round(self.hp)}${characterStats(self).maxHp !== 100 ? `/${characterStats(self).maxHp}` : ''}${self.armor ? ` +${Math.round(self.armor)} armor` : ''}; `
    + `holding ${self.weapon ? stockText(sim, self, activeWeaponId(self), true) : 'nothing'}${self.reloadUntil > sim.time ? ` (reloading: ${tenths(self.reloadUntil - sim.time)} left)` : ''}${ammo}`
    + `${others.length ? `; also ${others.join(', ')}` : ''}${self.dualWield ? `; DUAL secondary ${stockText(sim, self, self.secondaryWeaponId)}` : ''}; coins ${self.points}; ${kit}; bonuses ${carried(self)}${umbrella}${shut}${threat ? `; ${threat}` : ''}.`;
}
function phaseLine(sim, view) {
  const difficulty = String(sim.difficulty ?? 'normal').replace('-', ' ');
  if (sim.phase === 'countdown') return `The night begins in ${seconds(sim.timeLeft)}: wave ${sim.wave + 1}/${MAX_WAVES}, ${difficulty} difficulty.`;
  if (sim.phase === 'intermission') {
    const voters = view.humans, ready = voters.filter(player => player.nextWaveVote).length;
    return `Break after wave ${sim.wave}/${MAX_WAVES} (${difficulty}): wave ${sim.wave + 1} starts in ${seconds(sim.timeLeft)}`
      + `${sim.nextRaidWave() ? ', a RAID wave (armed raiders)' : ''}; ${ready}/${voters.length} humans ready.`;
  }
  if (sim.phase === 'wave') {
    const onField = sim.zombieCount(), inside = view.enemies.filter(enemy => enemy.seen && enemy.inside).length;
    return `Wave ${sim.wave}/${MAX_WAVES} (${difficulty}) under way: ${sim.toSpawn + sim.spawnWarnings.size + onField} zombies left `
      + `(${sim.toSpawn + sim.spawnWarnings.size} still to come, ${onField} on the field); ${inside} enemies seen INSIDE the ${IS_HOSPITAL ? 'hospital' : IS_FUNFAIR ? 'Palais' : IS_SUPERMARKET ? 'supermarket' : 'cabin'}.`;
  }
  return `Phase: ${clean(sim.phase, 16)}.`;
}
function raidLine(sim) {
  const raid = sim.raid;
  if (sim.phase !== 'wave' || !raid || raid.cleared || raid.over) return null;
  if (raid.retreatAt != null) return 'The raiders are retreating.';
  if (!raid.triggered) return `Raid wave: ${raid.total} armed raiders attack once the zombies are nearly done.`;
  const { alive, pending } = sim.raidCounts();
  const sides = [...new Set(sim.raidWarningSnapshot().map(warning => SIDES[compass({ x: 0, z: 0 }, warning)]))];
  return `RAID: ${alive + pending} raiders left (${alive} here, ${pending} arriving${sides.length ? ` from the ${sides.join(' and ')}` : ''}). They shoot from range: walls stop bullets, boards only partly.`;
}
function spawnLine(sim) {
  if (!sim.spawnWarnings.size) return null;
  const counts = new Map();
  for (const warning of sim.spawnWarnings.values()) {
    const door = nearestDoor(sim.doors, warning, activeDoor) ?? nearestDoor(sim.doors, warning);
    counts.set(door.id, (counts.get(door.id) ?? 0) + 1);
  }
  return `Appearing within 2 s: ${[...counts].map(([door, count]) => `${count} by the ${door} door`).join(', ')}.`;
}
function pickupLine(sim, self, view) {
  const all = [...sim.pickups.values()].filter(pickup => (pickup.expiresAt ?? Infinity) > sim.time);
  const coins = all.filter(pickup => pickup.kind === 'points' && !outside(pickup));
  const items = all.filter(pickup => pickup.kind !== 'points' && (!outside(pickup) || flat(self, pickup) <= 10 || collectReason(sim, self, pickup, view)))
    .sort((a, b) => flat(self, a) - flat(self, b) || byId(a, b));
  const parts = items.slice(0, MAX_PICKUP_LINES).map(pickup => {
    const reason = collectReason(sim, self, pickup, view), needy = !reason && needyHuman(sim, self, pickup, view);
    const note = reason ? 'you may take it' : ['weapon', 'bonus', 'armor', 'grenade'].includes(pickup.kind) ? 'for the humans'
      : needy ? `leave it for ${nameOf(needy)}` : outside(pickup) && need(sim, self, pickup, view) ? outing(sim, self, pickup).why
      : pickup.kind === 'ammo' ? 'not needed' : 'leave it';
    return `${pickupLabel(pickup)} ${relative(self, pickup)}${outside(pickup) ? ' outside' : ''} (${note})`;
  });
  if (items.length > MAX_PICKUP_LINES) parts.push(`${items.length - MAX_PICKUP_LINES} more`);
  if (coins.length) parts.push(`${coins.length} coin pile${coins.length > 1 ? 's' : ''} inside (${grouped(coins.reduce((sum, pickup) => sum + pickup.amount, 0))} coins)`);
  return parts.length ? `PICKUPS: ${parts.join('; ')}.` : null;
}
function shopLine(sim, self) {
  if (!shopOpen(sim, self)) return null;
  const racks = buyable(sim, self);
  const next = ARMORY.filter(rack => rack.weapon !== 'magnum' && sim.wave < rack.unlockWave).sort((a, b) => a.unlockWave - b.unlockWave)[0];
  return `SHOP (${SHOP_PHASES.includes(sim.phase) ? 'between waves' : 'calm moment, nothing within 8 m'}): with ${self.points} coins you can buy ${racks.length ? racks.slice(0, 6).map(rack => `${label(rack.weapon)} ${rack.price}`).join(', ') : 'nothing new'}`
    + `${next ? `; next unlock: ${label(next.weapon)} at wave ${next.unlockWave} (${next.price})` : ''}.`;
}
// A few recent happenings: strings from the director, or simulation events.
function recentText(sim, recent) {
  const name = id => nameOf(sim.players.get(id));
  const format = event => {
    if (typeof event === 'string') return clean(event);
    if (!event || typeof event !== 'object') return '';
    const age = Number.isFinite(event.time) ? Math.round(sim.time - event.time) : null;
    const ago = age === null ? '' : age < 1 ? ' (just now)' : ` (${age} s ago)`;
    switch (event.event) {
      case 'down': return `${name(event.id)} went down${event.raiderId ? ' (shot by a raider)' : ''}${ago}`;
      case 'revive': return event.targetId === event.id ? `${name(event.id)} got up with a kit${ago}` : `${name(event.id)} revived ${name(event.targetId)}${ago}`;
      case 'eliminated': return `${name(event.id)} was eliminated${ago}`;
      case 'robbed': return `raiders robbed ${name(event.id)}${ago}`;
      case 'brute': return `${event.boss ? 'the BOSS' : 'a brute'} appeared${ago}`;
      case 'raid': return `raiders coming from the ${clean(event.side, 8)}${ago}`;
      case 'raid-squad': return `more raiders from the ${clean(event.side, 8)}${ago}`;
      case 'purchase': return `${name(event.id)} bought the ${label(event.weapon)}${ago}`;
      case 'wave': return `wave ${Number(event.wave) || '?'} started${ago}`;
      default: return '';
    }
  };
  return (Array.isArray(recent) ? recent : []).map(format).filter(Boolean).filter((line, index, all) => line !== all[index - 1]).slice(-MAX_RECENT);
}

// Keep the essential lines; drop the least important ones (the longest of the
// highest rank first, so the 1,226-char crate line goes before the short
// STAIRS, STATION and PICKUPS lines of its rank) until the text fits, then
// add what fits of the news.
// A footer ("and N more") is rewritten from the items its group still shows.
function fit(lines, news, limit) {
  const render = () => lines.map(line => line.footer
    ? line.footer(lines.filter(other => other.group === line.group && other.item).map(other => other.item)) : line.text).filter(Boolean).join('\n');
  while (render().length > limit) {
    let worst = -1;
    lines.forEach((line, index) => {
      if (line.header || line.footer || line.rank <= 0) return;
      // Supermarket: the longest of the worst rank goes first; the cabin keeps
      // its historical order (the latest of the worst rank).
      if (worst < 0 || line.rank > lines[worst].rank || line.rank === lines[worst].rank && (!IS_SUPERMARKET || line.text.length >= lines[worst].text.length)) worst = index;
    });
    if (worst < 0) break;
    const [removed] = lines.splice(worst, 1);
    if (removed.group && !lines.some(line => line.group === removed.group && !line.header && !line.footer)) lines = lines.filter(line => line.group !== removed.group);
  }
  let text = render();
  const kept = [];
  for (const item of [...news].reverse()) {
    const candidate = `RECENT: ${[item, ...kept].join('; ')}.`;
    if (text.length + 1 + candidate.length > limit) break;
    kept.unshift(item);
  }
  if (kept.length) text += `\nRECENT: ${kept.join('; ')}.`;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// The room's friendly-fire rule, one line next to the phase line, only when
// it is on (off: no line at all — the text stays what it always was). The
// constant guides never mention it: a cached prefix must fit every room.
function friendlyFireLine(sim) {
  if (sim.friendlyFireOn?.() !== true) return null;
  const level = sim.friendlyFire === 'reduced' ? 'reduced: a quarter of the damage' : 'full: full damage';
  return `FRIENDLY FIRE ON (${level}): your bullets (they pierce bodies), pellets, flames, blades and blasts hurt teammates, and your own grenade or rocket hurts you within ${GRENADES.radiusDamage} m; never fire, swing or throw with a teammate in the line, the cone or the blast (your hands hold the trigger anyway).`;
}

function writeText(sim, self, view, current, orderSince, recent, limit) {
  const lines = [], add = (text, rank = 0, group = null, header = false, extra = {}) => { if (text) lines.push({ text, rank, group, header, ...extra }); };
  add(phaseLine(sim, view));
  add(friendlyFireLine(sim));
  add(raidLine(sim), 1);
  add(spawnLine(sim), 3);
  add(selfLine(sim, self, view));
  const personality = self.companion === true && companionProfilePrompt(self.companionProfile);
  if (personality) add(`YOUR PROFILE: ${personality}`);
  add(characterSummary(self, sim), 1);
  add(describeRecon(sim, self), 1);
  const opportunity = crateOpportunity(sim, self);
  if (opportunity) add(`CRATE WINDOW: your free bonus is unclaimed; ${opportunity.way.door.id} exit${opportunity.way.crouch ? ' requires crouching' : ''}, ~${opportunity.rain.seconds}s rain. Take a safe trip before resealing this route; let queued teammates follow. Rescue and danger override.`, 1);
  add(combatLine(view), 2);
  if (planFor(sim, self)) add(teamIntent(sim, self.id));
  const pickup = current?.kind === 'collect' ? sim.pickups.get(current.pickupId) : null;
  const recovering = pickup?.kind === 'ammo' && orderLegal(sim, self, current) && collectReason(sim, self, pickup, view);
  const progress = recovering ? `; ammo box ${metres(flat(self, pickup))} away; continue this recovery while the route remains safe; override for immediate danger or rescue` : '';
  add(`ORDER: ${current ? `${describeOrder(sim, self, current)}, for ${elapsed(sim.time - orderSince)}` : 'none yet'}${progress}.`, recovering ? 0 : 1);
  if (view.team.length) {
    add('TEAM:', 0, 'team', true);
    for (const player of view.team) add(teamLine(sim, self, view, player), 0, 'team');
  }
  const active = sim.doors.filter(door => !door.sealed), sealed = sim.doors.filter(door => door.sealed);
  if (active.length) {
    add('DOORS (five boards each keep zombies out):', 1, 'doors', true);
    for (const door of active) add(doorLine(sim, self, view, door), 1, 'doors');
  }
  if (sealed.length) add(`Sealed (nothing comes through): ${sealed.map(door => door.id).join(', ')}.`, 2);
  const enemies = view.enemies.filter(enemy => enemy.seen);
  if (enemies.length) {
    const inSight = enemies.length, raiders = enemies.filter(enemy => enemy.raider).length, zombies = enemies.length - raiders;
    const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const beyond = self.weapon ? `beyond the reach of your ${label(self.weapon)}` : 'out of your reach (no weapon)';
    add(`ENEMIES, most urgent first (${count(zombies, 'zombie')}${raiders ? ` and ${count(raiders, 'raider')}` : ''}, ${inSight} in your line of sight):`, 1, 'enemies', true);
    enemies.slice(0, MAX_ENEMY_LINES).forEach((enemy, index) => {
      const { zombie } = enemy;
      add(`- ${zombie.id} ${enemyName(zombie)}, ${relative(self, zombie)}, ${enemyWhere(enemy)}, ${enemyGoal(enemy, self)}, ${percent(zombie.hp, zombie.maxHp || zombie.hp)}% hp`
        + `${zombie.burnUntil > sim.time ? ', burning' : ''}${!enemy.seen ? ', not in sight' : enemy.inReach ? '' : `, ${beyond}`}`, index < 4 ? 1 : index < 6 ? 2 : 3, 'enemies', false, { item: enemy });
    });
    add('more', 0, 'enemies', false, { footer: shown => {
      const rest = enemies.filter(enemy => !shown.includes(enemy));
      return rest.length ? `- and ${rest.length} more in sight (not listed).` : '';
    } });
  } else if (sim.phase === 'wave') add('No enemy in sight right now.', 1);
  add(shopLine(sim, self), 2);
  add(crateLine(sim, self, view), 2);
  add(stationLine(sim, self), 2);
  add(stairsLine(view), 2);
  add(pickupLine(sim, self, view), 2);
  return fit(lines, recentText(sim, recent), limit);
}

// describeSituation(sim, companionId, { order, orderSince, recent }):
// `order` is the current body order (or null), `orderSince` the sim.time it
// was given, `recent` a few event strings or simulation events. `limit` (a
// smaller text budget) exists for tests of the trimming.
// → { text, actions: [{ value, description }], orders: { [value]: order | null } }
export function describeSituation(sim, companionId, { order = null, orderSince = 0, recent = [], limit = TEXT_LIMIT } = {}) {
  const self = sim?.players?.get(companionId);
  if (!self) return { text: 'You are not in this room.', actions: [], orders: {} };
  const current = typeof order === 'string' ? orderFromValue(order) : order && ORDER_KINDS.includes(order.kind) ? order : null;
  const since = Number.isFinite(orderSince) ? orderSince : sim.time;
  const budget = Number.isFinite(limit) && limit > 0 ? Math.min(limit, TEXT_LIMIT) : TEXT_LIMIT;
  const view = survey(sim, self);
  const actions = legalActions(sim, self, view, current, since);
  const orders = Object.fromEntries(actions.map(({ value }) => [value, value === 'keep' ? null : orderFromValue(value)]));
  return { text: writeText(sim, self, view, current, since, recent, budget), actions, orders };
}
