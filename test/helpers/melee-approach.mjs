// Real server ticks for the melee audio's hit prediction: one survivor swings
// at a body walking or running at them (or past them), possibly stepping
// and turning during the windup. Returns the server's verdict and what the
// client knew at its decision: the snapshots it had received by then.
import { MELEE_WEAPONS } from '../../public/rules.js';
import { playerEyeHeight } from '../../public/movement.js';
import { seededRandom } from './melee-scenarios.mjs';

export const TIMED_ATTACKS = Object.freeze(['bat', 'hammer', 'fireaxe'].flatMap(weapon => ['light', 'heavy'].map(attack => ({ weapon, attack }))));
const round = value => Math.round(value * 1000) / 1000;

// The snapshot fields the prediction reads, rounded like RoomSimulation.snapshot().
function snapshotOf(sim) {
  return { time: round(sim.time),
    players: [...sim.players.values()].map(player => ({ id: player.id, x: round(player.x), y: round(player.y), z: round(player.z),
      yaw: round(player.yaw), pitch: round(player.pitch), eyeHeight: playerEyeHeight(player) })),
    zombies: [...sim.zombies.values()].map(zombie => ({ id: zombie.id, kind: zombie.kind, scale: zombie.scale ?? 1, boss: zombie.boss === true,
      x: round(zombie.x), y: round(zombie.y), z: round(zombie.z) })) };
}

export function approachScenarios(RoomSimulation, count, seed = 0x61707072, { turn = 1 } = {}) {
  const random = seededRandom(seed), between = (a, b) => a + (b - a) * random(), pick = list => list[Math.floor(random() * list.length)];
  return Array.from({ length: count }, () => {
    const events = [], sim = new RoomSimulation('REACHP', { practice: false, random: () => .5, onEvent: event => events.push(event) });
    const player = sim.addPlayer('a'), { weapon, attack } = pick(TIMED_ATTACKS), profile = MELEE_WEAPONS[weapon][attack];
    sim.zombies.clear(); sim.phase = 'wave'; sim.toSpawn = 0; sim.spawnTimer = Infinity;
    // Open ground east of the cabin: nothing between the survivor and the body.
    const yaw = between(-Math.PI, Math.PI), pitch = between(-.3, .2), step = pick([0, 0, 1, -1]), sprint = random() < .5;
    Object.assign(player, { x: 13, y: 0, z: 0, yaw, pitch, weapon, inventory: { [weapon]: { ammo: 0, reserve: 0 } } });
    const bearing = yaw + between(-1, 1) * (profile.coneAngle / 2 + .5), distance = between(2.4, 4.5);
    const kind = random() < .5 ? 'walker' : 'runner', speed = kind === 'walker' ? between(1.15, 1.8) : between(1.85, 2.45);
    // Most bodies come straight at the survivor; some walk past to a point beside them.
    const passing = random() < .3;
    sim.zombies.set('z1', { id: 'z1', kind, scale: 1, boss: false, x: player.x - Math.sin(bearing) * distance, y: 0, z: player.z - Math.cos(bearing) * distance,
      yaw: 0, hp: 1e6, maxHp: 1e6, speed, attackAfter: Infinity, entered: true, stairState: null, pushX: 0, pushZ: 0, pushLeft: 0,
      damage: 0, barricadeDamage: 0, attackInterval: 1, doorId: 'east' });
    const target = passing ? { x: player.x + Math.cos(yaw) * between(-2.5, 2.5), z: player.z - Math.sin(yaw) * between(-2.5, 2.5) } : null;
    const omega = random() < .5 ? between(-turn, turn) : 0, phase = Math.floor(random() * 2), snapshots = [], aims = [];
    const zombie = sim.zombies.get('z1');
    if (target) zombie.speed = 0;
    let ticks = 0, body = null;
    const tick = () => {
      player.input = { forward: step, strafe: 0, sprint, crouch: false }; player.lastInputAt = sim.time; player.hp = 100; player.yaw += omega / 30;
      const dx = target ? target.x - zombie.x : 0, dz = target ? target.z - zombie.z : 0, length = Math.hypot(dx, dz);
      if (length > 1e-6) { const move = Math.min(length, speed / 30); zombie.x += dx / length * move; zombie.z += dz / length * move; }
      // updateMelee runs before the bodies move: the blow meets them here.
      body = { x: zombie.x, y: zombie.y, z: zombie.z, kind: zombie.kind, scale: zombie.scale };
      sim.tick(1 / 30); ticks++; aims.push({ time: sim.time, yaw: player.yaw });
      if ((ticks + phase) % 2 === 0) snapshots.push(snapshotOf(sim));
    };
    const warm = Math.round(between(8, 45));
    for (let index = 0; index < warm; index++) tick();
    events.length = 0;
    const subTick = between(0, 1 / 30);
    if (!sim.shoot('a', subTick, attack)) throw new Error('swing refused');
    const start = events.find(event => event.event === 'melee-start');
    // The client predicts once: at the event (the light bat), or 50 to 140 ms
    // before its own contact; a network hiccup can hold back the last snapshot.
    const lead = random() < .25 ? profile.windup : between(.05, .14), jitter = between(0, .04);
    const decideAt = start.time + profile.windup - lead;
    let hit = null;
    for (let guard = 0; guard < 60 && !hit; guard++) { tick(); hit = events.find(event => event.event === 'melee-hit'); }
    const received = snapshots.filter(snapshot => snapshot.time <= decideAt - jitter + 1e-9);
    // The local aim when deciding: the survivor's yaw on the LAN at that time.
    const localYaw = aims.findLast(aim => aim.time <= decideAt + 1e-9).yaw;
    return { weapon, attack, profile, received, contact: start.time + profile.windup, hits: hit.hits, localYaw, pitch,
      omega, step, passing, hit, body, doors: sim.snapshot().doors };
  });
}
