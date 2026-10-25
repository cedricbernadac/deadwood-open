import { LEVEL } from './public/level-config.js';
// Manual save and load of a night (owner, 18 October). A paused night is
// written out as plain JSON; loading rebuilds it onto a fresh room, PAUSED,
// with every human record as a reserved seat that its player takes back.
// Mixed into RoomSimulation by installSaveGame (like supplyMethods); only
// hoisted declarations are used at install time (simulation.mjs imports
// this module while it is itself being evaluated).
import { randomBytes } from 'node:crypto';
import { LEVEL_ID } from './public/level-id.js';
import { MAX_WAVES, DIFFICULTY_LEVELS, FRIENDLY_FIRE_LEVELS, AMBIANCES, ARMOR, PICKUPS, BARRICADE_BOARDS, GRENADES, isFrissonLike, waveBalance } from './public/rules.js';
import { SUPPLY_BONUSES, MAX_BONUS_LEVEL, BACKPACK, LATE_SUPPLIES, upgradedWeapon } from './public/weapon-upgrades.js';
import { weaponType } from './public/weapon-inventory.js';
import { FUEL_CACHES, SUPPLY_CACHES, SPAWN_ENTRIES, FAR_SPAWN_ENTRIES, UMBRELLA, EXPEDITION } from './public/expedition.js';
import { RAID_ENTRIES, RAIDER_LOADOUTS, RAIDS, raidTotal } from './public/raids.js';
import { BALLISTICS } from './public/ballistics.js';
import { COMPANION_PROFILE_CHOICES, COMPANION_ARCHETYPES } from './public/companion-profiles.js';
import { normalizeSheet, innateDebt, debtOf, SHEET_LIMITS, STANDARD_SHEET } from './public/character-sheet.js';
import { characterStats } from './public/character-bonuses.js';
import { INVALID, SaveError, encodeValue, scanRaw, isPlain, num, int, str, bool, nullable, arrayOf, mapOf, setOf, record, dictOf, templateFields, renameId } from './save-codec.mjs';

export { SaveError } from './save-codec.mjs';
export const SAVE_FORMAT = 'deadwood-save', SAVE_VERSION = 1;
// Bodies on the field: never more than the wave lets live at once for four
// survivors, plus the largest raid and a small margin. The online server
// ticks every room in one loop, so a crafted horde would slow them all.
export const bodyLimit = wave => waveBalance(wave, 4).maxActive + raidTotal(RAIDS.base.length, 4) + 8;
export const SAVE_LIMITS = Object.freeze({ bytes: 512 * 1024, players: 4, zombies: bodyLimit(MAX_WAVES), pickups: 600, bullets: BALLISTICS.maxActive,
  grenades: 50, spawnWarnings: 100, raidWarnings: 30, reviveCredits: 256 });
export const SAVE_PHASES = Object.freeze(['countdown', 'wave', 'intermission']);
// Peer ids (16 hex), companion ids and seat ids: never a word a game rule
// uses, so renaming one string everywhere cannot touch anything else.
export const PLAYER_ID = /^(?:[0-9a-f]{16}|ia-[A-Z0-9]{6}-\d{1,9}|seat-[0-9a-f]{12})$/;
const HAZARD_PHASES = ['countdown', 'wave', 'intermission'];
const DOOR_IDS = ['north', 'south', 'west', 'east'];
// Never written to a file: functions, room identity, the pause (a load is
// always paused by its loader), display-only impact numbers (who watches
// them, what still waits for them), AI planning, caches and the seats
// themselves (saved as player records). Physical bullets (ballisticsEnabled)
// are the room's own too: a file can never switch them off, which would send
// an online room's shots down the hitscan fallback (OnlineRoomSimulation
// rewinds zombies there, never teammates).
const TRANSIENT = new Set(['code', 'practice', 'random', 'onEvent', 'paused', 'pauseById', 'impactObservers', 'impactPending', 'burnDamagePending',
  'burnDamageNextAt', 'eventNumber', 'companionsAvailable', 'companionTeamPlan', 'companionOrders', 'raiderSolidCache', 'drillSides',
  'reservedSeats', 'restoredOrder', 'seatHolders', 'restoredAt', 'ballisticsEnabled']);
// Saved with an encoding of their own.
const CUSTOM = new Set(['players', 'doors', 'bullets', 'companionSelections']);
// Transient values reset by an import; the others belong to the room.
const RESET_ON_IMPORT = new Set(['paused', 'pauseById', 'impactPending', 'burnDamagePending', 'burnDamageNextAt', 'raiderSolidCache', 'drillSides',
  'reservedSeats', 'restoredOrder', 'seatHolders', 'restoredAt']);
const PLAYER_TRANSIENT = new Set(['input', '_weaponHand']);
const neutralInput = () => ({ forward: 0, strafe: 0, sprint: false, crouch: false });
const sanitizeName = value => String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Survivant';
const sameName = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr');
const seatId = () => `seat-${randomBytes(6).toString('hex')}`;

let Base = null, WEAPON_TABLE = null, PUSH = null, TICK = 1 / 30, schemas = null, templateCache = null;
// Template numbers no rule below gives a range (the coverage test lists them).
const unranged = new Set();

export function installSaveGame(Simulation, { WEAPONS, push, tickRate = 30 }) {
  Base = Simulation; WEAPON_TABLE = WEAPONS; PUSH = push; TICK = 1 / tickRate;
  Object.assign(Simulation.prototype, { transientSaveFields, saveDenial, exportSave, importSave, applySave, bindSeat, claimSeat,
    bindJoiningPlayer, matchSeat, releaseSeats, freeSeatList, seatSnapshot, adoptCompanion, announceRestore, orderPlayers, parkSeat,
    seatsAwaited, settleRestore });
}

function transientSaveFields() { return TRANSIENT; }

// Why this survivor cannot save now (null: allowed). Any admitted human may.
function saveDenial(id = null) {
  if (this.practice) return 'practice';
  if (id !== null) {
    const player = this.players.get(id);
    if (!player || player.companion === true || player.waiting) return 'not-admitted';
  }
  if (!SAVE_PHASES.includes(this.phase)) return 'phase';
  if (!this.paused) return 'not-paused';
  return null;
}

function encodePlayer(player) {
  const copy = {};
  for (const key of Object.keys(player)) if (!PLAYER_TRANSIENT.has(key)) copy[key] = player[key];
  return encodeValue(copy);
}

// Every own field minus the transient list, so fields added later are saved
// without touching this file. Bullets lose their object links (owner, shot
// group, profile): they are relinked by id on import.
function exportSave({ build = null, requesterId = null, now = new Date() } = {}) {
  const reason = this.saveDenial(requesterId);
  if (reason) throw new SaveError(reason);
  const transient = this.transientSaveFields();
  const save = { format: SAVE_FORMAT, version: SAVE_VERSION, mapId: LEVEL_ID, ...(LEVEL.spaceId ? {spaceId:LEVEL.spaceId} : {}), build: typeof build === 'string' ? build : null, savedAt: now.toISOString() };
  for (const key of Object.keys(this)) {
    if (transient.has(key) || CUSTOM.has(key)) continue;
    const value = encodeValue(this[key]);
    if (value !== undefined) save[key] = value;
  }
  // Records that carry something first: the room's survivors, companions and
  // parked seats, then seats nobody took back. Newcomers never admitted yet
  // carry nothing and only fill what is left; four records at most, and a
  // survivor's record is never the one left out.
  const newcomer = player => player.waiting === true && player.companion !== true && !this.seatHolders?.has(player.id);
  const records = [...[...this.players.values()].filter(player => !newcomer(player)), ...(this.reservedSeats?.values() ?? [])];
  if (records.length > SAVE_LIMITS.players) throw new SaveError('crowded');
  save.players = [...records, ...[...this.players.values()].filter(newcomer)].slice(0, SAVE_LIMITS.players).map(encodePlayer);
  save.doors = this.doors.map(door => ({ id: door.id, boards: [...door.boards], repairCredit: door.repairCredit, sealed: door.sealed, sealPending: door.sealPending }));
  const groups = new Map();
  save.bullets = { $map: [...this.bullets].map(([id, bullet]) => {
    const { owner, profile, shotGroup, ...rest } = bullet;
    if (shotGroup && !groups.has(shotGroup.id)) groups.set(shotGroup.id, shotGroup);
    return [id, encodeValue({ ...rest, shotGroupId: shotGroup?.id ?? null })];
  }) };
  save.shotGroups = [...groups.values()].map(group => encodeValue({ id: group.id, blood: group.blood === true, fallen: group.fallen ?? new Map() }));
  if (Array.isArray(this.companionSelections)) save.companionSelections = [...this.companionSelections];
  if (JSON.stringify(save).length > SAVE_LIMITS.bytes) throw new SaveError('too-large');
  return save;
}

// Fresh defaults from the real constructors, built once.
function templates() {
  if (templateCache) return templateCache;
  const fresh = new Base('TEMPLT', { random: () => .5 });
  const sim = new Base('TEMPLT', { random: () => .5 }), id = '0000000000000000';
  sim.addPlayer(id, 'Template');
  const player = structuredClone(sim.players.get(id));
  sim.start(id); sim.phase = 'countdown'; sim.beginWave();
  const zombie = structuredClone(sim.createZombie()), generator = structuredClone(sim.generator);
  sim.wave = 4; sim.beginWave();
  const raid = structuredClone(sim.raid), raider = structuredClone(sim.createRaider(1, RAID_ENTRIES[0], sim.raid));
  templateCache = { fresh, player, zombie, generator, raid, raider };
  return templateCache;
}

function positionNumber(key) {
  const bounds = EXPEDITION.bounds;
  // The expedition reaches 140 m (fuel caches at 125 m): a margin past the
  // playable edge, never a teleport back into the cabin.
  if (key === 'x') return num({ min: bounds.minX - 20, max: bounds.maxX + 20 });
  if (key === 'z') return num({ min: bounds.minZ - 20, max: bounds.maxZ + 20 });
  if (key === 'y') return num({ min: (LEVEL.minY ?? 0) - 2, max: 40 });
  if (key === 'hp' || key === 'maxHp') return num({ min: 0, max: 1e6 });
  return null;
}
const positive = (max = 1e6) => raw => typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.min(max, raw) : INVALID;
const angle = raw => { const value = num({ min: -1e4, max: 1e4 })(raw); return value === INVALID ? INVALID : Math.atan2(Math.sin(value), Math.cos(value)); };
const any = (...schemas) => raw => { for (const schema of schemas) { const value = schema(raw); if (value !== INVALID) return value; } return INVALID; };
// Absolute sim times (the clock itself stops at 1e8): beyond is "never".
const TIME = Object.freeze({ min: -1e9, max: 1e9 });
const TIMED = /(?:At|Until|After|Since)$/;

// Every number a template carries gets a range: what the game itself ever
// makes, with a margin. A crafted push or timer on the generic ±1e12 cost
// a tick unbounded work. Times are named …At/Until/After/Since; anything
// else unnamed is reported (unrangedSaveNumbers) and kept within ±1e4.
function templateNumbers() {
  const pushMax = PUSH.speed * Math.max(1, ...Object.values(WEAPON_TABLE).map(weapon => weapon.pushMultiplier ?? 1));
  const x = positionNumber('x'), z = positionNumber('z');
  const ranges = { pushX: num({ min: -pushMax, max: pushMax }), pushZ: num({ min: -pushMax, max: pushMax }), pushLeft: num({ min: 0, max: PUSH.duration }),
    partitionSlideLeft: num({ min: 0, max: 1 }), spawnOffset: num({ min: -20, max: 20 }), damage: num({ min: 0, max: 1000 }),
    barricadeDamage: num({ min: 0, max: 1000 }), attackInterval: num({ min: .05, max: 60 }), bodyDamage: num({ min: 0, max: 10 }),
    damageScale: num({ min: 0, max: 4 }), bonus: num({ min: 0, max: 1e5 }), ordinal: int(0, 1000), squadOrdinal: int(0, 100), squadId: int(0, 1000),
    burstLeft: int(0, 100), settleAmplitude: num({ min: 0, max: 1 }), strafeLeft: num({ min: 0, max: 400 }), lastHp: num({ min: -1e6, max: 1e6 }),
    stagingX: x, homeX: x, movedX: x, stagingZ: z, homeZ: z, movedZ: z };
  return (key, path, value) => {
    const infinite = !Number.isFinite(value);
    const known = positionNumber(key) ?? (Object.hasOwn(ranges, key) ? ranges[key] : null) ?? (TIMED.test(key) ? num({ ...TIME, infinite }) : null);
    if (known) return known;
    unranged.add(path);
    return num({ min: -1e4, max: 1e4, infinite });
  };
}

export function unrangedSaveNumbers() {
  schemas ??= buildSchemas();
  return [...unranged];
}

function buildSchemas() {
  const { fresh, player, zombie, generator, raid, raider } = templates();
  const numberFor = templateNumbers();
  const fromTemplate = (label, template, overrides = {}, required = []) => record(templateFields(template, overrides, numberFor, `${label}.`), { required });
  const weapons = Object.keys(WEAPON_TABLE);
  const weaponName = str({ values: weapons });
  const bulletWeapon = str({ values: weapons.filter(id => WEAPON_TABLE[id].bulletPhysics) });
  const weaponId = raw => typeof raw === 'string' && /^[a-z]+(?:#\d{1,6})?$/.test(raw) && weapons.includes(raw.split('#', 1)[0]) ? raw : INVALID;
  const id = str({ pattern: PLAYER_ID }), ref = str({ max: 64 });
  const zombieId = str({ pattern: /^z\d{1,9}$/ }), raiderId = str({ pattern: /^r\d{1,9}$/ }), enemyId = any(zombieId, raiderId);
  const pickupId = str({ pattern: /^p\d{1,9}$/ });
  const time = num(TIME), maybeTime = nullable(num(TIME)), timeOrInfinite = num({ ...TIME, infinite: true });
  const point = record({ x: positionNumber('x'), z: positionNumber('z') }, { required: ['x', 'z'] });
  const door = str({ values: DOOR_IDS });
  const entries = [...SPAWN_ENTRIES, ...FAR_SPAWN_ENTRIES, ...RAID_ENTRIES].map(entry => entry.id);
  const level = int(1, MAX_BONUS_LEVEL);
  const bonus = raw => {
    if (raw === null) return null;
    const value = dictOf(str({ values: Object.keys(SUPPLY_BONUSES) }), level, { max: 32 })(raw);
    return value === INVALID ? INVALID : Object.keys(value).length ? value : null;
  };
  const handClocks = record({ shotAfter: time, switchUntil: time, reloadUntil: time, reloadDuration: num({ min: 0, max: 60 }),
    minigunSpinning: bool(), minigunSpinUntil: time });
  const stock = record({ ammo: int(0, 10000), reserve: int(0, 100000) }, { required: ['ammo', 'reserve'] });
  // Unknown weapons are dropped; a fifth slot never fits a backpack.
  const inventory = raw => {
    const value = dictOf(weaponId, stock, { max: 16 })(raw);
    return value === INVALID ? INVALID : Object.fromEntries(Object.entries(value).slice(0, BACKPACK.slots));
  };
  const profile = record({ selection: str({ values: COMPANION_PROFILE_CHOICES }), archetype: str({ values: COMPANION_ARCHETYPES.map(entry => entry.id) }),
    variation: record({ accuracy: num({ min: .92, max: 1.08 }), reaction: num({ min: .92, max: 1.08 }), pause: num({ min: .92, max: 1.08 }) },
      { required: ['accuracy', 'reaction', 'pause'] }) }, { required: ['selection', 'archetype', 'variation'] });
  const playerSchema = fromTemplate('player', player, {
    id, name: raw => typeof raw === 'string' && raw.length <= 64 ? sanitizeName(raw) : INVALID,
    input: null, _weaponHand: null,
    yaw: angle, pitch: num({ min: -1.48, max: 1.48 }), hp: num({ min: 0, max: 10000 }), armor: num({ min: 0, max: ARMOR.max }),
    vy: num({ min: -100, max: 100 }), outsideDamageAccumulator: num({ min: 0, max: 10 }),
    weapon: nullable(weaponName), weaponId: nullable(weaponId), startingWeapon: weaponName, inventory,
    issuedWeapons: setOf(weaponName, { max: 32 }), fallStartY: nullable(num({ min: (LEVEL.minY ?? 0) - 2, max: 40 })), secondaryWeaponId: nullable(weaponId),
    weaponStates: dictOf(weaponId, handClocks, { max: 16 }),
    pendingMelee: nullable(record({ weapon: weaponName, weaponId: nullable(weaponId), attack: str({ values: ['light', 'heavy'] }), attackId: int(0, 1e9), impactAt: time },
      { required: ['weapon', 'attack', 'attackId', 'impactAt'] })),
    bonus, supplyPurchases: arrayOf(str({ values: Object.keys(LATE_SUPPLIES.items) }), { max: 16 }),
    // The optional character sheet (public/character-sheet.js): rebuilt by
    // normalizeSheet (anything invalid is the standard sheet). The debt still
    // owed is bounded by that sheet's innate debt in settleSheet.
    sheet: raw => isPlain(raw) ? normalizeSheet(raw) : INVALID,
    sheetDebt: dictOf(str({ values: Object.keys(SUPPLY_BONUSES) }), int(0, -SHEET_LIMITS.min), { max: 32 }),
    umbrella: record({ open: bool(), remaining: num({ min: 0, max: UMBRELLA.max }) }, { required: ['open', 'remaining'] }),
    score: num({ min: 0, max: 1e10 }), points: num({ min: 0, max: 1e10 }), kills: int(0, 1e9), grenades: int(0, 20), killChain: int(0, 1e6),
    // The fraction of a point still carried to the next hit.
    scoreCarry: num({ min: 0, max: 1 }),
    grenadierInterval: num({ min: 0, max: 600 }), grenadierUntil: maybeTime,
    // Fields that appear during play.
    companion: bool(), companionSlot: int(0, 2), companionProfile: profile, collectTargetId: nullable(pickupId),
    reviving: nullable(record({ targetId: ref, startedAt: time, lastAt: time, duration: num({ min: 0, max: 60 }) }, { required: ['targetId', 'startedAt', 'lastAt'] })),
    selfReviveAt: time, chainHeld: num({ min: 0, max: 600 }), chainHoldUntil: time, chainId: int(0, 1e9), coinDropAfter: time,
    motionX: num({ min: -50, max: 50 }), motionZ: num({ min: -50, max: 50 }), nextWeaponInstanceId: int(0, 1e6), switchUntil: time,
    reloadDuration: num({ min: 0, max: 60 }), waveScoreStart: num({ min: 0, max: 1e10 }), waveKillsStart: int(0, 1e9),
  }, ['id', 'name']);
  const enemyDynamic = {
    stairState: nullable(str({ values: ['ascending', 'descending'] })), doorId: door, spawnEntryId: nullable(str({ values: entries })),
    attackAfter: timeOrInfinite, scale: num({ min: .5, max: 2 }), speed: num({ min: 0, max: 20 }), yaw: angle,
    navigation: nullable(record({ level:positionNumber('y'), target: point, path: arrayOf(point, { max: 64 }), direct: bool() }, { required: ['target', 'path'] })),
    portalRoute: nullable(record({ doorId: door, fromOutside: bool(), toOutside: bool(), stage: str({ values: ['approach', 'cross'] }) },
      { required: ['doorId', 'fromOutside', 'toOutside', 'stage'] })),
    crowdedAt: timeOrInfinite, crowdedSince: maybeTime, sideStep: num({ min: -1, max: 1 }), sideStepAt: timeOrInfinite, routeCheckAt: time,
    frostSlow: num({ min: 0, max: 1 }), scentHaste: num({ min: 0, max: 1 }), burnUntil: time, burnStartedAt: time, burnOwnerId: ref, burnDamageAt: time,
    burnExposures: arrayOf(record({ strength: num({ min: 0, max: 1 }), until: time, ownerId: ref }, { required: ['strength', 'until'] }), { max: 64 }),
  };
  // A living body needs health left; a shot group's fallen copies are dead.
  const zombieFor = hp => fromTemplate('zombie', zombie, { ...enemyDynamic, id: zombieId,
    kind: str({ values: ['walker', 'runner', 'crawler', 'armored', 'brute'] }), hp, maxHp: positive() },
  ['id', 'kind', 'x', 'y', 'z', 'hp', 'maxHp']);
  const [spotX, spotY, spotZ] = ['x', 'y', 'z'].map(axis => nullable(positionNumber(axis)));
  const aiSchema = fromTemplate('raider.ai', raider.ai, {
    state: str({ values: ['advance', 'engage', 'breach', 'assault', 'retreat'] }), targetId: nullable(ref), aimingAt: nullable(ref),
    sight: nullable(record({ id: ref, share: num({ min: 0, max: 1 }), visible: bool(), crouchSees: bool() }, { required: ['id', 'share', 'visible', 'crouchSees'] })),
    lastSeenX: spotX, lastSeenY: spotY, lastSeenZ: spotZ, moving: nullable(str({ values: ['run', 'strafe'] })),
    engagedAt: maybeTime, breachStartedAt: maybeTime, retreatStartedAt: maybeTime, strafeX: spotX, strafeZ: spotZ,
    strafeSign: num({ min: -1, max: 1 }),
  }, ['state']);
  const raiderFor = hp => fromTemplate('raider', raider, { ...enemyDynamic, id: raiderId, kind: str({ values: ['raider'] }),
    faction: str({ values: ['raider'] }), source: str({ values: ['raider'] }), loadout: str({ values: Object.keys(RAIDER_LOADOUTS) }),
    raidIndex: int(1, 3), ammo: int(0, 1000), damageScale: num({ min: 0, max: 4 }), pitch: num({ min: -1.6, max: 1.6 }), ai: aiSchema,
    hp, maxHp: positive() }, ['id', 'kind', 'x', 'y', 'z', 'hp', 'maxHp', 'loadout', 'ai']);
  const zombieSchema = zombieFor(positive()), raiderSchema = raiderFor(positive());
  const deadZombie = zombieFor(num({ min: -1e6, max: 1e6 })), deadRaider = raiderFor(num({ min: -1e6, max: 1e6 }));
  const enemy = raw => isPlain(raw) && raw.kind === 'raider' ? raiderSchema(raw) : zombieSchema(raw);
  const fallen = raw => isPlain(raw) && raw.kind === 'raider' ? deadRaider(raw) : deadZombie(raw);
  // Pickups set down on a support carry its pose (weapons, dropped bonuses).
  const pickupBase = { id: pickupId, x: positionNumber('x'), y: positionNumber('y'), z: positionNumber('z'), amount: num({ min: 0, max: 1e6 }),
    special: bool(), expiresAt: timeOrInfinite, yaw: num({ min: -10, max: 10 }), pitch: num({ min: -10, max: 10 }), modelLift: num({ min: 0, max: 5 }) };
  const pickupRequired = ['id', 'kind', 'x', 'y', 'z', 'expiresAt'];
  const pickupKinds = {
    points: record({ ...pickupBase, kind: str(), droppedBy: ref, giftAt: time }, { required: pickupRequired }),
    ammo: record({ ...pickupBase, kind: str(), charge: int(0, PICKUPS.ammoCharge) }, { required: pickupRequired }),
    weapon: record({ ...pickupBase, kind: str(), weapon: weaponName, ammo: int(0, 10000), reserve: int(0, 100000) },
      { required: [...pickupRequired, 'weapon', 'ammo', 'reserve'] }),
    bonus: record({ ...pickupBase, kind: str(), bonus: record({ kind: str({ values: Object.keys(SUPPLY_BONUSES) }), level }, { required: ['kind', 'level'] }) },
      { required: [...pickupRequired, 'bonus'] }),
  };
  for (const kind of ['health', 'armor', 'revive', 'grenade']) pickupKinds[kind] = record({ ...pickupBase, kind: str() }, { required: pickupRequired });
  const pickup = raw => isPlain(raw) && Object.hasOwn(pickupKinds, raw.kind) ? pickupKinds[raw.kind](raw) : INVALID;
  const raidSchema = fromTemplate('raid', raid, { index: int(1, 3), wave: int(1, MAX_WAVES), players: int(1, 4), total: int(0, 100), squad: int(1, 4),
    spawned: int(0, 100), killed: int(0, 100), retreated: int(0, 100), squads: int(0, 100), sideStart: int(0, 3), sideStep: num({ min: -1, max: 1 }),
    triggeredAt: maybeTime, zombiesDoneAt: maybeTime, holdSince: maybeTime, lastSquadAt: maybeTime, retreatAt: maybeTime },
  ['index', 'wave', 'players', 'total', 'squad']);
  const life = BALLISTICS.maxLife;
  const bullet = record({ id: str({ pattern: /^b\d{1,9}$/ }), x: num({ min: -1000, max: 1000 }), y: num({ min: -1000, max: 1000 }), z: num({ min: -1000, max: 1000 }),
    vx: num({ min: -5000, max: 5000 }), vy: num({ min: -5000, max: 5000 }), vz: num({ min: -5000, max: 5000 }), gravity: num({ min: 0, max: 100 }),
    drag: num({ min: 0, max: 100 }), segmentStartAge: num({ min: 0, max: life }), distanceOffset: num({ min: 0, max: 1e5 }), maxAge: num({ min: 0, max: life }),
    ownerId: ref, weapon: bulletWeapon, weaponId: nullable(weaponId), hand: str({ values: ['primary', 'secondary'] }), shotId: int(0, 0x7fffffff),
    headshotMultiplier: num({ min: 0, max: 10 }), startAt: time, age: num({ min: 0, max: life }), hitIds: setOf(enemyId, { max: 32 }), hitCount: int(0, 32),
    hitPlayerIds: setOf(ref, { max: 8 }), shotGroupId: nullable(str({ max: 64 })) },
  { required: ['id', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'gravity', 'drag', 'segmentStartAge', 'distanceOffset', 'maxAge', 'ownerId', 'weapon', 'startAt', 'age'] });
  const grenade = record({ id: str({ pattern: /^g\d{1,9}$/ }), ownerId: ref, x: num({ min: -500, max: 500 }), y: num({ min: -50, max: 500 }), z: num({ min: -500, max: 500 }),
    // A throw leaves at 8 m/s and falls for 1.8 s at most: the fuse's own length, never longer.
    vx: num({ min: -60, max: 60 }), vy: num({ min: -60, max: 60 }), vz: num({ min: -60, max: 60 }), fuseLeft: num({ min: 0, max: GRENADES.fuse }),
    damageMultiplier: num({ min: 0, max: 10 }) }, { required: ['id', 'ownerId', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'fuseLeft'] });
  const spawnWarning = record({ id: zombieId, zombie: zombieSchema, x: positionNumber('x'), z: positionNumber('z'), readyAt: time }, { required: ['id', 'zombie', 'x', 'z', 'readyAt'] });
  const raidWarning = record({ id: raiderId, raider: raiderSchema, x: positionNumber('x'), z: positionNumber('z'),
    alternate: nullable(record({ x: positionNumber('x'), z: positionNumber('z'), entryId: nullable(str({ values: entries })) }, { required: ['x', 'z'] })),
    announceAt: time, readyAt: time }, { required: ['id', 'raider', 'x', 'z', 'announceAt', 'readyAt'] });
  const sim = fromTemplate('simulation', fresh, {
    ...Object.fromEntries([...TRANSIENT, ...CUSTOM].map(key => [key, null])),
    difficulty: str({ values: DIFFICULTY_LEVELS }), friendlyFire: str({ values: FRIENDLY_FIRE_LEVELS }), ambiance: str({ values: AMBIANCES }), phase: str({ values: SAVE_PHASES }),
    wave: int(0, MAX_WAVES), time: num({ min: 0, max: 1e8 }), timeLeft: num({ min: 0, max: 600 }), toSpawn: int(0, 1e5), spawnTimer: num({ min: -600, max: 600 }),
    zombies: mapOf(enemyId, enemy, { max: SAVE_LIMITS.zombies, capCode: 'too-large' }),
    pickups: mapOf(pickupId, pickup, { max: SAVE_LIMITS.pickups, capCode: 'too-large' }),
    grenades: mapOf(str({ pattern: /^g\d{1,9}$/ }), grenade, { max: SAVE_LIMITS.grenades, capCode: 'too-large' }),
    spawnWarnings: mapOf(zombieId, spawnWarning, { max: SAVE_LIMITS.spawnWarnings, capCode: 'too-large' }),
    raidWarnings: mapOf(raiderId, raidWarning, { max: SAVE_LIMITS.raidWarnings, capCode: 'too-large' }),
    raid: nullable(raidSchema), raidLootIds: setOf(pickupId, { max: SAVE_LIMITS.pickups }),
    // Revive bonuses still to pay at the end of the wave: a missing list (an
    // older file) is no credit at all.
    reviveCredits: arrayOf(record({ reviverId: ref, revivedId: ref, revivedName: str({ max: 64 }), copied: int(0, 1e10), open: bool() },
      { required: ['reviverId', 'revivedId', 'copied', 'open'] }), { max: SAVE_LIMITS.reviveCredits }),
    supplyCrate: nullable(record({ wave: int(0, MAX_WAVES), active: bool(), claimed: setOf(ref, { max: 8 }) }, { required: ['wave', 'active', 'claimed'] })),
    generator: fromTemplate('generator', generator, { missionWave: nullable(int(0, MAX_WAVES)), completed: int(0, 10), elapsed: num({ min: 0, max: 1e7 }) }),
    fuel: nullable(record({ x: positionNumber('x'), y: positionNumber('y'), z: positionNumber('z'), carrierId: nullable(ref), cacheIndex: int(0, FUEL_CACHES.length - 1) },
      { required: ['x', 'y', 'z', 'carrierId', 'cacheIndex'] })),
    wavePlayerCount: nullable(num({ min: .5, max: 4 })), waveGrenadeThresholds: arrayOf(int(0, 1e5), { max: 64 }), bruteSpawnAt: arrayOf(int(0, 1e5), { max: 8 }),
    hostId: nullable(id), farSpawnCount: int(0, 1e5), farSpawnQuota: int(0, 1e5), nextWaveCalled: bool(),
    ...Object.fromEntries(['nextPickupId', 'nextBulletId', 'nextGrenadeId', 'nextRaiderId', 'nextZombieId', 'nextMeleeId'].map(key => [key, int(1, 1e9)])),
    ...Object.fromEntries(['lootKills', 'ammoDrops', 'waveKills', 'waveInitialTotal', 'waveGrenadeDrops', 'brutesToSpawn', 'waveSpawned'].map(key => [key, int(0, 1e7)])),
  }, ['phase', 'wave', 'time']);
  const doors = arrayOf(record({ id: door, boards: arrayOf(num({ min: 0, max: 1e6 }), { max: BARRICADE_BOARDS.length }), repairCredit: num({ min: 0, max: 1e6 }),
    sealed: bool(), sealPending: bool() }, { required: ['id', 'boards'] }), { max: DOOR_IDS.length });
  const shotGroups = arrayOf(record({ id: str({ max: 64 }), blood: bool(), fallen: mapOf(enemyId, fallen, { max: 64 }) }, { required: ['id'] }), { max: SAVE_LIMITS.bullets });
  return { sim, playerSchema, doors, bullets: mapOf(str({ pattern: /^b\d{1,9}$/ }), bullet, { max: SAVE_LIMITS.bullets, capCode: 'too-large' }), shotGroups,
    selections: arrayOf(str({ values: COMPANION_PROFILE_CHOICES }), { max: 3 }) };
}

const merge = (template, decoded) => Object.assign(structuredClone(template), decoded);
const highest = (ids, prefix) => Math.max(0, ...[...ids].map(value => Number(String(value).slice(prefix.length))).filter(Number.isFinite));

// Untrusted file -> plain decoded state with fresh seat ids. Pure: throws a
// SaveError with a short reason code, never touches a room.
export function decodeSave(raw) {
  if (!isPlain(raw) || raw.format !== SAVE_FORMAT) throw new SaveError('format');
  if (raw.version !== SAVE_VERSION) throw new SaveError('version');
  // Saves before level 2 belong to the cabin. Never transplant their geometry
  // and positions into another level, or silently accept an unknown map id.
  if ((Object.hasOwn(raw, 'mapId') ? raw.mapId : 'cabin') !== LEVEL_ID) throw new SaveError('map');
  if (LEVEL.spaceId && raw.spaceId !== LEVEL.spaceId) throw new SaveError('map');
  scanRaw(raw);
  schemas ??= buildSchemas();
  const { player: playerTemplate, zombie: zombieTemplate, raider: raiderTemplate, raid: raidTemplate, generator: generatorTemplate } = templates();
  if (!SAVE_PHASES.includes(raw.phase)) throw new SaveError('phase');
  const fields = schemas.sim(raw);
  if (fields === INVALID) throw new SaveError('invalid');
  if (fields.phase !== 'countdown' && fields.wave < 1) throw new SaveError('phase');
  // Records keep their template's defaults for anything missing or malformed.
  const enemy = value => {
    const body = merge(value.kind === 'raider' ? raiderTemplate : zombieTemplate, value);
    if (value.kind === 'raider') body.ai = { ...structuredClone(raiderTemplate.ai), ...value.ai };
    return body;
  };
  if (fields.zombies) for (const [key, value] of fields.zombies) fields.zombies.set(key, enemy(value));
  if (fields.spawnWarnings) for (const [key, warning] of fields.spawnWarnings) {
    if (warning.zombie.id !== key) fields.spawnWarnings.delete(key); else warning.zombie = enemy(warning.zombie);
  }
  if (fields.raidWarnings) for (const [key, warning] of fields.raidWarnings) {
    if (warning.raider.id !== key) fields.raidWarnings.delete(key);
    else { warning.raider = enemy(warning.raider); warning.alternate ??= null; }
  }
  const bodies = (fields.zombies?.size ?? 0) + (fields.spawnWarnings?.size ?? 0) + (fields.raidWarnings?.size ?? 0);
  if (bodies > bodyLimit(fields.wave)) throw new SaveError('too-large');
  if (fields.raid) fields.raid = merge(raidTemplate, fields.raid);
  if (fields.generator) fields.generator = merge(generatorTemplate, fields.generator);
  if (fields.supplyCrate) fields.supplyCrate = { id: `supply-${fields.supplyCrate.wave}`, ...SUPPLY_CACHES[0], ...fields.supplyCrate };
  if (fields.fuel) fields.fuel = { ...FUEL_CACHES[fields.fuel.cacheIndex], ...fields.fuel };
  // Malformed seats are refused outright: a night without its survivors is no save.
  if (!Array.isArray(raw.players) || !raw.players.length || raw.players.length > SAVE_LIMITS.players) throw new SaveError('seats');
  const players = [], seen = new Set();
  raw.players.forEach((value, order) => {
    const decoded = schemas.playerSchema(value);
    if (decoded === INVALID || seen.has(decoded.id)) return;
    seen.add(decoded.id);
    const player = merge(playerTemplate, decoded);
    player.input = neutralInput();
    settleSheet(player, Object.hasOwn(decoded, 'sheetDebt') ? decoded.sheetDebt : null);
    normalizeInventory(player);
    players.push({ record: player, order });
  });
  // Someone paused it: a night where every human still waits is no night.
  if (!players.some(entry => entry.record.companion !== true && !entry.record.waiting)) throw new SaveError('seats');
  // A player id equal to an entity id would rename that entity too.
  const entityIds = new Set([...(fields.zombies?.keys() ?? []), ...(fields.pickups?.keys() ?? []), ...(fields.grenades?.keys() ?? []), ...DOOR_IDS]);
  if (players.some(entry => entityIds.has(entry.record.id))) throw new SaveError('seats');
  const doors = schemas.doors(raw.doors);
  const bullets = raw.bullets === undefined ? new Map() : schemas.bullets(raw.bullets);
  const shotGroups = raw.shotGroups === undefined ? [] : schemas.shotGroups(raw.shotGroups);
  const selections = raw.companionSelections === undefined ? INVALID : schemas.selections(raw.companionSelections);
  const decoded = { fields, players, doors: doors === INVALID ? [] : doors, bullets: bullets === INVALID ? new Map() : bullets,
    shotGroups: shotGroups === INVALID ? [] : shotGroups, selections: selections !== INVALID && selections.length === 3 ? selections : null,
    hostSeat: fields.hostId ?? null };
  for (const group of decoded.shotGroups) for (const [key, body] of group.fallen) group.fallen.set(key, enemy(body));
  for (const bullet of decoded.bullets.values()) settleBullet(bullet, fields.time);
  // Fresh seat ids: the file's ids are someone else's peers.
  for (const { record: player } of players) {
    const next = seatId();
    renameId(decoded, player.id, next);
    player.id = next;
  }
  decoded.hostSeat = decoded.fields.hostId ?? null;
  delete decoded.fields.hostId;
  // Next ids stay above every id already in use: a new body never replaces one.
  const counters = [['nextZombieId', 'z', [...(fields.zombies?.keys() ?? []), ...(fields.spawnWarnings?.keys() ?? [])].filter(key => key.startsWith('z'))],
    ['nextRaiderId', 'r', [...(fields.zombies?.keys() ?? []), ...(fields.raidWarnings?.keys() ?? [])].filter(key => key.startsWith('r'))],
    ['nextPickupId', 'p', fields.pickups?.keys() ?? []], ['nextBulletId', 'b', decoded.bullets.keys()], ['nextGrenadeId', 'g', fields.grenades?.keys() ?? []]];
  for (const [key, prefix, ids] of counters) fields[key] = Math.max(fields[key] ?? 1, highest(ids, prefix) + 1);
  return decoded;
}

// A bullet flies on from where the pause stopped it: a tick catches up only
// what was pending then (each sub-step sweeps the world and every body),
// never seconds of flight. Its physics are its weapon's, not the file's.
function settleBullet(bullet, time) {
  const physics = WEAPON_TABLE[bullet.weapon].bulletPhysics;
  bullet.age = Math.min(bullet.age, bullet.maxAge);
  bullet.segmentStartAge = Math.min(bullet.segmentStartAge, bullet.age);
  bullet.startAt = Math.min(time + TICK, Math.max(time - bullet.age - TICK, bullet.startAt));
  bullet.drag = physics.drag; bullet.gravity = BALLISTICS.gravity;
  // A fresh shot leaves at the muzzle speed to the last bit, never faster.
  const speed = Math.hypot(bullet.vx, bullet.vy, bullet.vz);
  if (speed > physics.muzzleSpeed * (1 + 1e-9)) for (const axis of ['vx', 'vy', 'vz']) bullet[axis] *= physics.muzzleSpeed / speed;
  bullet.distanceOffset = Math.min(bullet.distanceOffset, BALLISTICS.ranges[bullet.weapon] ?? Infinity);
}

// A seat keeps its saved character. A companion plays the standard sheet;
// a survivor never owes more than the sheet's innate debt, nor a family the
// sheet does not owe (a missing debt is the innate one, never a free
// repayment), and carries no more grenades than that sheet lets them.
function settleSheet(player, saved) {
  if (player.companion === true) player.sheet = normalizeSheet(null);
  const innate = innateDebt(player.sheet);
  player.sheetDebt = {};
  for (const [kind, owed] of Object.entries(innate)) {
    const left = Math.min(owed, saved ? debtOf(saved, kind) : owed);
    if (left > 0) player.sheetDebt[kind] = left;
  }
  player.grenades = Math.min(player.grenades, characterStats(player).maxGrenades);
}

// Owned weapons only, a selected weapon among them, clocks for carried ones.
function normalizeInventory(player) {
  const ids = Object.keys(player.inventory ?? {});
  if (!player.inventory) player.inventory = {};
  if (!ids.includes(player.weaponId)) player.weaponId = ids[0] ?? null;
  player.weapon = player.weaponId === null ? null : weaponType(player.weaponId, player.inventory[player.weaponId]);
  if (!ids.includes(player.secondaryWeaponId) || player.secondaryWeaponId === player.weaponId) { player.secondaryWeaponId = null; player.dualWield = false; }
  for (const key of Object.keys(player.weaponStates ?? {})) if (!ids.includes(key)) delete player.weaponStates[key];
  if (player.pendingMelee && player.pendingMelee.weaponId != null && !ids.includes(player.pendingMelee.weaponId)) player.pendingMelee = null;
}

// Build the decoded night onto this room, made fresh first. Returns the
// companion records for the director (LAN) to adopt.
function applySave(decoded, loaderId, humans = []) {
  const fresh = new Base(this.code, { random: () => .5, ambiance: this.ambiance, raids: this.raidsEnabled });
  // The director's profile choices stay the room's (its own field, LAN only).
  const preserved = new Set([...this.transientSaveFields(), 'companionSelections'].filter(key => !RESET_ON_IMPORT.has(key)));
  const lobby = new Map([...this.players].filter(([, player]) => player.companion !== true));
  for (const key of Object.keys(this)) if (!preserved.has(key)) delete this[key];
  for (const key of Object.keys(fresh)) if (!preserved.has(key)) this[key] = fresh[key];
  for (const [key, value] of Object.entries(decoded.fields)) if (key !== 'ambiance') this[key] = value;
  for (const saved of decoded.doors) {
    const door = this.doors.find(item => item.id === saved.id);
    if (!door || saved.boards.length !== BARRICADE_BOARDS.length) continue;
    door.boards = saved.boards.map((hp, index) => Math.min(BARRICADE_BOARDS[index].maxHp, Math.max(0, hp)));
    door.repairCredit = Math.min(door.maxHp, Math.max(0, saved.repairCredit ?? 0));
    door.sealed = saved.sealed === true; door.sealPending = saved.sealPending === true && !door.sealed;
  }
  this.players = new Map(); this.reservedSeats = new Map(); this.restoredOrder = new Map(); this.seatHolders = new Set();
  const companions = [];
  for (const { record: player, order } of decoded.players) {
    this.restoredOrder.set(player.id, order);
    if (player.companion === true) companions.push({ record: player, order, slot: player.companionSlot ?? null, profile: player.companionProfile ?? null });
    else this.reservedSeats.set(player.id, player);
  }
  if (decoded.selections && Array.isArray(this.companionSelections)) this.companionSelections = [...decoded.selections];
  // Bullets find their shooter's record and shot group again; the profile is
  // the shooter's weapon as it is now (bonuses rarely change within a second),
  // a character sheet's debt included.
  const records = new Map(decoded.players.map(({ record: player }) => [player.id, player]));
  const groups = new Map(decoded.shotGroups.map(group => [group.id, { id: group.id, fallen: group.fallen, blood: group.blood === true && isFrissonLike(this.ambiance) }]));
  const profiles = new Map();
  this.bullets = new Map();
  for (const [key, saved] of decoded.bullets) {
    const owner = records.get(saved.ownerId) ?? null, { shotGroupId, ...bullet } = saved, groupId = shotGroupId ?? `shot-${key}`;
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, fallen: new Map(), blood: false });
    const group = groups.get(groupId);
    const profileKey = `${group.id}\0${bullet.weapon}`;
    if (!profiles.has(profileKey)) profiles.set(profileKey, structuredClone(upgradedWeapon(WEAPON_TABLE[bullet.weapon], bullet.weapon, owner?.bonus ?? null, owner?.sheetDebt ?? null)));
    this.bullets.set(key, { ...bullet, owner, shotGroup: group, profile: profiles.get(profileKey), hitIds: bullet.hitIds ?? new Set(), hitCount: bullet.hitCount ?? 0,
      hand: bullet.hand ?? 'primary', headshotMultiplier: bullet.headshotMultiplier ?? 1 });
  }
  this.hostId = loaderId; this.paused = true; this.pauseById = loaderId;
  // Seats come back exactly as saved only until the loaded night runs on.
  this.restoredAt = { time: this.time, wave: this.wave };
  // The loader first: a seat with its own name (admitted before waiting),
  // else the saved host, else the first. Never another survivor's record
  // while the loader's own is in the file.
  const loaderName = lobby.get(loaderId)?.name ?? humans[0]?.name, seats = [...this.reservedSeats];
  const standing = seats.filter(([, player]) => !player.waiting);
  const named = standing.find(([, player]) => sameName(player.name, loaderName)) ?? seats.find(([, player]) => sameName(player.name, loaderName));
  const pick = named ?? standing.find(([id]) => id === decoded.hostSeat) ?? standing[0] ?? seats[0];
  if (pick) this.bindSeat(pick[0], loaderId, named ? {} : { name: loaderName });
  // A loader whose record still waited for its admission joins now: only an
  // admitted host can resume the paused night.
  const bound = this.players.get(loaderId);
  if (bound?.waiting && !this.admitPlayer(bound)) this.admitPlayer(bound, { crowded: true });
  // Survivors already in the lobby: their seat, else the admission queue.
  for (const { id, name } of humans) {
    if (id === loaderId) continue;
    const seat = this.matchSeat(name), previous = lobby.get(id);
    if (seat) { this.bindSeat(seat, id); continue; }
    if (!previous) continue;
    Object.assign(previous, { waiting: true, alive: false, ready: false, downed: false, input: neutralInput() });
    this.players.set(id, previous);
    this.event('join-waiting', { id });
  }
  this.orderPlayers();
  // A file from before new props or furniture existed can hold a body or an
  // item inside one: move each to the nearest free spot on multi-floor maps.
  this.evictRestoredFromProps();
  return companions;
}

// Once the companions are adopted (or not): the fuel is the team's mission,
// a carrier who is back keeps it, an absent survivor or companion sets it
// down where their record stands (the far cache only if that spot cannot hold it).
function settleRestore(companions = []) {
  const carrierId = this.fuel?.carrierId;
  if (!carrierId || this.players.has(carrierId)) return;
  const carrier = this.reservedSeats?.get(carrierId) ?? companions.find(companion => companion.record.id === carrierId)?.record;
  if (!carrier || !this.dropFuel(carrier)) Object.assign(this.fuel, FUEL_CACHES[this.fuel.cacheIndex], { carrierId: null });
}

// A standing survivor's free seat while nobody in the room can fight: the
// loaded night waits for them rather than ending at the first tick.
function seatsAwaited() {
  if (!this.reservedSeats?.size || this.time !== this.restoredAt?.time || this.fightingPlayers().length) return false;
  return [...this.reservedSeats.values()].some(seat => !seat.waiting && seat.alive && (!seat.downed || seat.reviveKit === true));
}

// Before the loaded night runs on, a seat comes back exactly as saved.
// Afterwards its absolute timers (bleed-out, reloads…) are stale and it
// missed the breaks' heals: through the normal admission queue, with every
// belonging kept.
function parkSeat(player) {
  Object.assign(player, { waiting: true, ready: false, alive: false, downed: false, bleedOutAt: 0, reviving: null, selfReviveAt: 0,
    pendingMelee: null, minigunSpinning: false, minigunSpinUntil: 0, input: neutralInput(), jumpHeld: false, jumpRequested: false });
  if (player.umbrella) player.umbrella.open = false;
  // A new wave renewed everyone else's late-supply purchases.
  if (this.wave !== this.restoredAt?.wave) player.supplyPurchases = [];
  this.event('join-waiting', { id: player.id });
}

function bindSeat(seat, playerId, { name = null } = {}) {
  const player = this.reservedSeats?.get(seat), current = this.players.get(playerId);
  if (!player || typeof playerId !== 'string' || current?.companion === true || this.seatHolders?.has(playerId)) return false;
  this.reservedSeats.delete(seat);
  // The joiner's own record carried nothing yet: the seat replaces it.
  if (current) this.players.delete(playerId);
  player.id = playerId;
  if (name) player.name = sanitizeName(name);
  this.players.set(playerId, player);
  renameId(this, seat, playerId);
  this.seatHolders.add(playerId);
  if (!this.paused || this.time !== this.restoredAt?.time) this.parkSeat(player);
  this.orderPlayers();
  this.event('seat-bound', { id: playerId, name: player.name });
  return true;
}

function matchSeat(name) {
  for (const [seat, player] of this.reservedSeats ?? []) if (sameName(player.name, name)) return seat;
  return null;
}

// A joiner without a matching name takes a free seat explicitly.
function claimSeat(id, seat) {
  const player = this.players.get(id);
  if (!player || player.companion === true || !player.waiting || this.seatHolders?.has(id) || !HAZARD_PHASES.includes(this.phase)
    || typeof seat !== 'string' || !this.reservedSeats?.has(seat)) return false;
  return this.bindSeat(seat, id, { name: player.name });
}

// A joiner named like a free seat takes it at once.
function bindJoiningPlayer(id) {
  const player = this.players.get(id);
  if (!player?.waiting || player.companion === true || !HAZARD_PHASES.includes(this.phase) || this.seatHolders?.has(id)) return false;
  const seat = this.matchSeat(player.name);
  return seat ? this.bindSeat(seat, id) : false;
}

// Seats last for the night: game over, victory or a new night free them.
function releaseSeats() {
  this.reservedSeats?.clear(); this.restoredOrder?.clear(); this.seatHolders?.clear();
}

// Each free seat with its saved character, so a joiner knows who they take back.
const seatCharacter = ({ preset, name, stats } = STANDARD_SHEET) => ({ preset, name, stats: { ...stats } });
function freeSeatList() { return [...(this.reservedSeats ?? [])].map(([seat, player]) => ({ seat, name: player.name, character: seatCharacter(player.sheet) })); }

// Survivors who took a seat back play its character until the night ends
// (setSheet refuses them): the clients lock their select and say why.
function seatSnapshot() {
  const holders = [...(this.seatHolders ?? [])].filter(id => this.players.has(id));
  return { ...(this.reservedSeats?.size && HAZARD_PHASES.includes(this.phase) ? { freeSeats: this.freeSeatList() } : {}),
    ...(holders.length ? { seatHolders: holders } : {}) };
}

// Saved order for restored survivors; newcomers after them.
function orderPlayers() {
  if (!this.restoredOrder?.size) return;
  const rank = id => this.restoredOrder.get(id) ?? SAVE_LIMITS.players;
  const entries = [...this.players].map((entry, index) => [entry, index]).sort(([[a], first], [[b], second]) => rank(a) - rank(b) || first - second);
  this.players.clear();
  for (const [[id, player]] of entries) this.players.set(id, player);
}

// The director (LAN) gives a restored companion its new id and body.
function adoptCompanion(companion, id, { name, slot, profile }) {
  if (this.players.size >= 4 || this.players.has(id) || typeof id !== 'string') return false;
  const previous = companion.record.id;
  Object.assign(companion.record, { id, name, companion: true, companionSlot: slot, companionProfile: profile, ready: true });
  this.players.set(id, companion.record);
  renameId(this, previous, id);
  this.orderPlayers();
  return true;
}

function announceRestore({ companions = null } = {}) {
  this.event('game-restored', { wave: this.wave, phase: this.phase, hostId: this.hostId, ...(companions ? { companions } : {}) });
}

// Validate, dry-run on a scratch room, then build onto this lobby. A refused
// file leaves the lobby exactly as it was. `adopt` (the LAN director) takes
// the companions back before the restore settles what they carried; it
// answers 'restored' or a note, else they are left behind ('unsupported').
function importSave(save, loaderId, { beforeApply = null, adopt = null } = {}) {
  if (this.practice) return { ok: false, reason: 'practice' };
  if (this.phase !== 'lobby') return { ok: false, reason: 'phase' };
  const loader = this.players.get(loaderId);
  if (!loader || loader.companion === true || loaderId !== this.hostId) return { ok: false, reason: 'host' };
  let decoded;
  try {
    let size = Infinity;
    try { size = JSON.stringify(save)?.length ?? Infinity; } catch {}
    if (!(size <= SAVE_LIMITS.bytes)) throw new SaveError('too-large');
    decoded = decodeSave(save);
    dryRun(decoded, this.ambiance);
  } catch (error) {
    return { ok: false, reason: error instanceof SaveError ? error.code : 'invalid' };
  }
  const humans = [...this.players.values()].filter(player => player.companion !== true).map(({ id, name }) => ({ id, name }));
  beforeApply?.();
  const companions = this.applySave(decoded, loaderId, humans);
  const adopted = companions.length ? adopt?.(companions) ?? 'unsupported' : null;
  this.settleRestore(companions);
  return { ok: true, wave: this.wave, phase: this.phase, companions, adopted };
}

// Every seat taken, every companion present, a few ticks: a file the
// validation let through must still not be able to break the room's tick.
function dryRun(decoded, ambiance) {
  const scratch = new Base('DRYRUN', { random: () => .37, ambiance });
  try {
    const host = decoded.players.find(entry => entry.record.companion !== true).record;
    const copy = structuredClone(decoded), loaderId = 'dry-run-loader';
    scratch.addPlayer(loaderId, host.name);
    const companions = scratch.applySave(copy, loaderId, [{ id: loaderId, name: host.name }]);
    for (const seat of [...scratch.reservedSeats.keys()]) scratch.bindSeat(seat, seat);
    for (const companion of companions) if (scratch.players.size < 4) scratch.players.set(companion.record.id, companion.record);
    scratch.settleRestore(companions);
    scratch.snapshot();
    scratch.paused = false;
    for (let tick = 0; tick < 3; tick++) scratch.tick(1 / 30);
    scratch.snapshot();
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw new SaveError('invalid', error?.message ?? 'Dry run failed.');
  }
}
