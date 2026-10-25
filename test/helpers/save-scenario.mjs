// Deterministic nights for the save tests: a forkable random stream and a
// tiny autopilot that aims at the nearest enemy and fires, so real kills,
// loot, bullets in flight, raids and downs happen without a browser.
import { RoomSimulation, TICK_RATE } from '../../simulation.mjs';
import { characterStats } from '../../public/character-bonuses.js';
import { ARMOR, PICKUPS } from '../../public/rules.js';

// mulberry32 with visible state: clone() continues the same sequence.
export function forkableRandom(seed = 1) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  random.clone = () => forkableRandom(state);
  return random;
}

// Peer-like identifiers, as the servers make them (16 hex characters).
export const HOST_ID = '00000000000000a1', GUEST_ID = '00000000000000b2', THIRD_ID = '00000000000000c3', FOURTH_ID = '00000000000000d4';
export const CODE = 'SAVE01';

// Players are [id, name] or [id, name, sheet] (an optional character sheet).
export function makeRoom({ seed = 7, players = [[HOST_ID, 'Jules'], [GUEST_ID, 'Léa']], ambiance = 'family', events = null, Simulation = RoomSimulation, options = {} } = {}) {
  const random = forkableRandom(seed);
  const simulation = new Simulation(CODE, { random, ambiance, onEvent: events ? event => events.push(event) : () => {}, ...options });
  for (const [id, name, sheet] of players) simulation.addPlayer(id, name, undefined, sheet ? { sheet } : {});
  return { simulation, random };
}

// Aim at the nearest living enemy's chest; fire, reload when dry.
export function autopilot(simulation, ids = [...simulation.players.keys()]) {
  for (const id of ids) {
    const player = simulation.players.get(id);
    if (!player || player.waiting || !player.alive || player.downed || player.companion) continue;
    let target = null, best = Infinity;
    for (const zombie of simulation.zombies.values()) {
      if (!(zombie.hp > 0)) continue;
      const gap = Math.hypot(zombie.x - player.x, zombie.z - player.z);
      if (gap < best) { best = gap; target = zombie; }
    }
    const yaw = target ? Math.atan2(-(target.x - player.x), -(target.z - player.z)) : player.yaw;
    const pitch = target ? Math.atan2((target.y ?? 0) + 1.1 - (player.y + 1.55), Math.max(.1, best)) : 0;
    simulation.setInput(id, { forward: 0, strafe: 0, yaw, pitch, sprint: false, crouch: false, jump: false });
    if (!target || best > 40) continue;
    const stock = player.inventory?.[player.weaponId];
    if (stock && stock.ammo <= 0) simulation.reload(id);
    else simulation.shoot(id, 0);
  }
}

export function run(simulation, ticks, { pilot = true } = {}) {
  for (let tick = 0; tick < ticks; tick++) {
    if (pilot) autopilot(simulation);
    simulation.tick(1 / TICK_RATE);
  }
}

// Fast-forward to a wave without fighting the earlier ones.
export function startAtWave(simulation, wave) {
  simulation.start([...simulation.players.keys()][0]);
  simulation.wave = wave - 1;
  simulation.phase = 'countdown';
  simulation.timeLeft = 0.01;
  simulation.tick(1 / TICK_RATE);
}

// Sturdy survivors with a shotgun and a flamethrower, so a wave lasts.
// Grenades and loaded rounds within what the character sheet allows.
export function arm(simulation, { hp = 4000 } = {}) {
  for (const player of simulation.players.values()) {
    if (player.companion) continue;
    const loaded = weapon => simulation.weaponProfile(player, weapon).magazine;
    Object.assign(player, { hp, grenades: Math.min(2, characterStats(player).maxGrenades), points: 900, weapon: 'shotgun', weaponId: 'shotgun',
      inventory: { shotgun: { ammo: Math.min(8, loaded('shotgun')), reserve: 900 }, flamethrower: { ammo: Math.min(80, loaded('flamethrower')), reserve: 900 } } });
  }
}

// A paused wave-5 night with raiders, a downed survivor, every pickup kind
// the tests need, a grenade and shotgun pellets still in flight. `prepare`
// runs last, just before the pause.
export function busyNight({ seed = 11, Simulation = RoomSimulation, events = null, players = undefined, downed = GUEST_ID, prepare = null } = {}) {
  const { simulation, random } = makeRoom({ seed, Simulation, events, ...(players ? { players } : {}) });
  startAtWave(simulation, 5);
  arm(simulation);
  for (let tick = 0; tick < 30 * 200 && ![...simulation.zombies.values()].some(zombie => zombie.kind === 'raider'); tick++) run(simulation, 1);
  run(simulation, 20);
  const host = simulation.players.get(HOST_ID), guest = downed ? simulation.players.get(downed) : null;
  // A bonus on the ground, a gift of coins, a weapon set down, a grenade.
  host.bonus = { stone: 2 };
  simulation.dropBonus(host);
  host.bonus = { reinforced: 3, vitality: 1 };
  simulation.dropCoins(HOST_ID);
  host.interactAfter = 0;
  simulation.chooseWeapon(HOST_ID, 'flamethrower');
  host.switchUntil = 0; host.shotAfter = 0; host.interactAfter = 0;
  simulation.dropWeapon(HOST_ID);
  simulation.throwGrenade(HOST_ID);
  if (guest?.alive && !guest.downed) simulation.damagePlayer(guest, 1e6, { id: 'z0' });
  host.shotAfter = 0; host.switchUntil = 0;
  autopilot(simulation, [HOST_ID]);
  prepare?.(simulation);
  simulation.setPause(HOST_ID, true);
  return { simulation, random };
}

// The busy night with a revive bonus still to pay (owner, 18 October): Léa
// is down, Jules lifts her with a kit just before the pause, so his credit
// on her is open in the file and fills as she fights on.
export function creditNight({ seed = 17, Simulation = RoomSimulation, events = null } = {}) {
  return busyNight({ seed, Simulation, events, prepare(simulation) {
    const host = simulation.players.get(HOST_ID), guest = simulation.players.get(GUEST_ID);
    Object.assign(guest, { alive: true, downed: true, hp: 0, bleedOutAt: simulation.time + 20 });
    Object.assign(host, { x: guest.x + .5, y: guest.y, z: guest.z, reviveKit: true, interactAfter: 0 });
    if (!simulation.useReviveKit(HOST_ID)) throw new Error('the kit could not reach Léa');
    guest.hp = 4000; guest.shotAfter = 0; guest.switchUntil = 0;
    // A tough walker two metres in front of her, to fight on after the load.
    const walker = simulation.spawnZombie();
    Object.assign(walker, { kind: 'walker', x: guest.x, y: guest.y, z: guest.z - 2, hp: 20000, maxHp: 20000, entered: true, navigation: null, stairState: null });
  } });
}

// Character sheets (public/character-sheet.js) for the save tests.
export const SHEETS = Object.freeze({
  lumberjack: { preset: 'lumberjack' }, // strength +2, tinkering −1, chemistry −1
  chemist: { name: 'Chimiste', stats: { ballistics: 2, chemistry: -2 } }, // the widest smell, half medkits
  scout: { preset: 'scout' }, // agility +2, strength −1, ballistics −1 (weaker bullets)
});
export const SHEET_PLAYERS = Object.freeze([[HOST_ID, 'Jules', SHEETS.lumberjack], [GUEST_ID, 'Léa', SHEETS.chemist], [THIRD_ID, 'Inès', SHEETS.scout]]);

// The busy night played by three survivors with character sheets: Jules
// (Lumberjack) repaid his magazine debt earlier and carries a teammate's
// medic level over his medic debt; Léa (Chemistry −2) stands hurt on a
// medkit with a zombie inside her smell; Inès (Scout) shoots weaker bullets.
// Everyone's pellets are in flight when the host pauses.
export function sheetNight({ seed = 13, Simulation = RoomSimulation, events = null } = {}) {
  return busyNight({ seed, Simulation, events, players: SHEET_PLAYERS, downed: null, prepare(simulation) {
    const host = simulation.players.get(HOST_ID), lea = simulation.players.get(GUEST_ID);
    const before = characterStats(host);
    host.bonus = { ...host.bonus, medic: 1 };
    delete host.sheetDebt.extended;
    simulation.syncCharacterBonuses(host, before); simulation.normalizeInventory(host);
    // Léa: on her feet even if the wave downed her, hurt, armoured, on a medkit.
    Object.assign(lea, { alive: true, downed: false, bleedOutAt: 0, hp: 30, armor: ARMOR.max });
    const medkit = `p${simulation.nextPickupId++}`;
    simulation.pickups.set(medkit, { id: medkit, kind: 'health', x: lea.x, y: lea.y, z: lea.z, amount: 0, special: false, expiresAt: simulation.time + PICKUPS.lifetime });
    // A tough walker two metres in front of her, inside both smells.
    const walker = [...simulation.zombies.values()].find(zombie => zombie.hp > 0 && zombie.kind !== 'raider' && !zombie.boss);
    if (walker) Object.assign(walker, { x: lea.x, y: lea.y, z: lea.z - 2, hp: 20000, maxHp: 20000, navigation: null, stairState: null });
    for (const player of simulation.players.values()) { player.shotAfter = 0; player.switchUntil = 0; }
    autopilot(simulation, [GUEST_ID, THIRD_ID]);
  } });
}
