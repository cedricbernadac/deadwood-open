// Seeded melee poses for parity tests: one survivor among bodies of every
// family, at the doors, the table, the sofa, the stairs and the loft, with
// random planks and seals. Pure data; callers build their own rooms.
import { LOFT } from '../../public/rules.js';
import { playerEyeHeight } from '../../public/movement.js';

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ANCHORS = [
  { x: 0, z: -5.4 }, { x: 0, z: -6.7 }, { x: 0, z: 5.4 }, { x: 0, z: 6.7 },
  { x: -7.4, z: 0 }, { x: -8.7, z: 0 }, { x: 7.4, z: 0, loft: true }, { x: 8.7, z: 0 },
  { x: -1, z: -.4 }, { x: -4.6, z: 3 }, { x: -3, z: -3.5 }, { x: 3.8, z: .2 }, { x: 2.2, z: -3, loft: true },
  { x: 5.5, z: 3.4, loft: true }, { x: 1, z: 1 }, { x: -6.5, z: -4.8 }, { x: 11, z: 7 },
];
const KINDS = [
  { kind: 'walker' }, { kind: 'runner' }, { kind: 'crawler' }, { kind: 'armored' },
  { kind: 'brute', scale: 1.22 }, { kind: 'walker', boss: true, scale: 1.32 },
  { kind: 'raider', crouched: false }, { kind: 'raider', crouched: true },
];
export const MELEE_ATTACKS = Object.freeze(['katana', 'hammer', 'bat', 'fireaxe'].flatMap(weapon => ['light', 'heavy'].map(attack => ({ weapon, attack }))));

export function meleeScenarios(count = 1200, seed = 0x6d656c65) {
  const random = seededRandom(seed), between = (a, b) => a + (b - a) * random(), pick = list => list[Math.floor(random() * list.length)];
  return Array.from({ length: count }, (_, index) => {
    const anchor = pick(ANCHORS), loft = anchor.loft === true && random() < .5;
    const player = { x: anchor.x + between(-.8, .8), y: loft ? LOFT.y : 0, z: anchor.z + between(-.8, .8),
      yaw: between(-Math.PI, Math.PI), pitch: between(-.9, .9), crouched: random() < .25 };
    const facing = player.yaw, zombies = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, n) => {
      const angle = random() < .6 ? facing + between(-.8, .8) : between(-Math.PI, Math.PI), reach = between(.25, 2.7);
      const level = random() < .85 ? player.y : random() < .5 ? 0 : LOFT.y;
      return { id: `z${index}-${n}`, ...pick(KINDS), x: player.x - Math.sin(angle) * reach, y: level + (random() < .2 ? between(-.4, .4) : 0),
        z: player.z - Math.cos(angle) * reach, hp: between(20, 900) };
    });
    const doors = ['north', 'south', 'west', 'east'].map(id => ({ id, sealed: random() < .15,
      boards: Array.from({ length: 5 }, () => random() < .35 ? 0 : Math.round(between(1, 60))) }));
    return { ...pick(MELEE_ATTACKS), player, zombies, doors };
  });
}

// One practice room replays every scenario: the server's own target points
// for each body, then the authoritative blow resolved by updateMelee.
export function meleeRoom(RoomSimulation) {
  const events = [], sim = new RoomSimulation('MELEEP', { practice: true, random: () => .5, onEvent: event => events.push(event) });
  const player = sim.addPlayer('p');
  return { sim, player, events };
}

export function serverMelee({ sim, player, events }, scenario) {
  sim.zombies.clear(); sim.pickups.clear();
  for (const door of sim.doors) {
    const state = scenario.doors.find(item => item.id === door.id);
    door.boards = [...state.boards]; door.sealed = state.sealed; door.sealPending = false;
  }
  Object.assign(player, scenario.player, { weapon: scenario.weapon, alive: true, downed: false,
    inventory: { [scenario.weapon]: { ammo: 0, reserve: 0 } } });
  player.umbrella.open = false;
  for (const zombie of scenario.zombies) sim.zombies.set(zombie.id, { ...zombie, maxHp: zombie.hp, yaw: 0, speed: 0, attackAfter: Infinity, entered: true });
  const profile = sim.weaponProfile(player).attacks[scenario.attack], cosine = Math.cos(player.pitch);
  const origin = { x: player.x, y: player.y + playerEyeHeight(player), z: player.z };
  const direction = { x: -Math.sin(player.yaw) * cosine, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cosine };
  const points = scenario.zombies.map(zombie => sim.meleeTargetPoint(origin, direction, sim.zombies.get(zombie.id), profile));
  player.pendingMelee = { weapon: scenario.weapon, attack: scenario.attack, attackId: 1, impactAt: sim.time };
  events.length = 0; sim.updateMelee();
  const hit = events.find(event => event.event === 'melee-hit');
  return { points, hits: hit.hits, kills: hit.kills, impacts: hit.impacts };
}
