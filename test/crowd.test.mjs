import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS } from '../simulation.mjs';

// Zombie bodies keep their space, attack barricades side by side, spill
// sideways around a jam and never walk through survivors (nor survivors
// through them).
const lcg = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const radius = zombie => .29 * (zombie.scale ?? 1);
const still = { forward: 0, strafe: 0, yaw: 0, pitch: 0 };

function closestPair(simulation) {
  const bodies = [...simulation.zombies.values()];
  let closest = Infinity;
  for (let a = 0; a < bodies.length; a++) {
    for (let b = a + 1; b < bodies.length; b++) {
      if (Math.abs(bodies[a].y - bodies[b].y) > 1.2) continue;
      closest = Math.min(closest, Math.hypot(bodies[a].x - bodies[b].x, bodies[a].z - bodies[b].z) - radius(bodies[a]) - radius(bodies[b]));
    }
  }
  return closest;
}

function waveRoom(random, players = ['a']) {
  const events = [];
  const simulation = new RoomSimulation('CROWD', { random, onEvent: event => events.push(event) });
  for (const id of players) simulation.addPlayer(id, id);
  simulation.start(players[0]);
  simulation.beginWave();
  simulation.zombies.clear();
  simulation.toSpawn = 0;
  return { simulation, events, player: simulation.players.get(players[0]) };
}

test('a dense open-house wave keeps every zombie body apart and surrounds the survivor', () => {
  const simulation = new RoomSimulation('CROWD', { random: lcg(11) });
  const player = simulation.addPlayer('a', 'A');
  simulation.start('a');
  simulation.wave = 11; simulation.phase = 'intermission'; simulation.timeLeft = 0;
  simulation.tick(1 / 30);
  assert.equal(simulation.wave, 12);
  for (const door of simulation.doors) door.hp = 0;
  Object.assign(player, { x: -4.5, z: -2, hp: 1e9 });
  let closest = Infinity, ring = 0, cover = 0;
  for (let tick = 0; tick < 30 * 40; tick++) {
    simulation.setInput('a', still);
    simulation.tick(1 / 30);
    closest = Math.min(closest, closestPair(simulation));
    const near = [...simulation.zombies.values()].filter(zombie => Math.hypot(zombie.x - player.x, zombie.z - player.z) < .95);
    for (const zombie of near) assert.ok(Math.hypot(zombie.x - player.x, zombie.z - player.z) >= .25 + radius(zombie) - 1e-6, 'no zombie walks into the survivor');
    if (near.length > ring) {
      ring = near.length;
      const angles = near.map(zombie => Math.atan2(zombie.z - player.z, zombie.x - player.x)).sort((a, b) => a - b);
      const gaps = angles.map((angle, index) => ((angles[(index + 1) % angles.length] - angle) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2);
      cover = Math.PI * 2 - Math.max(...gaps);
    }
  }
  assert.ok(closest > -.02, `zombie bodies overlapped by ${(-closest).toFixed(3)} m`);
  assert.ok(ring >= 6, `only ${ring} zombies reached the survivor`);
  assert.ok(cover > Math.PI, `zombies stayed on one side (${Math.round(cover * 180 / Math.PI)} degrees)`);
});

test('zombies attack a barricade side by side and the overflow spills sideways to another entrance', () => {
  const { simulation, events, player } = waveRoom(() => .1);
  Object.assign(player, { x: 0, z: 2, hp: 1e9 });
  const north = simulation.doors.find(door => door.id === 'north');
  north.sealed = false; // Exercise the historical active north frontage, not solo reinforcement.
  for (const door of simulation.doors) door.boards = door.boards.map(() => 1e6);
  // Exercise the north frontage with a symmetric legal crowd, independently
  // of which intermediate woodland exit the wave currently selects.
  for (let index = 0; index < 12; index++) {
    const zombie = simulation.spawnZombie();
    Object.assign(zombie, { x: (index % 4 - 1.5) * .7, y: 0, z: -8.1 - Math.floor(index / 4) * .8 });
  }
  assert.ok(closestPair(simulation) >= -1e-9, 'a new zombie never appears inside another one');
  let side = 0, spread = 0, closest = Infinity;
  const detoured = new Set();
  for (let tick = 0; tick < 30 * 30; tick++) {
    simulation.setInput('a', still);
    simulation.tick(1 / 30);
    closest = Math.min(closest, closestPair(simulation));
    const front = [...simulation.zombies.values()].filter(zombie => zombie.portalRoute?.doorId === 'north' && simulation.barricadeFront(zombie, north, 1));
    if (front.length > side) { side = front.length; spread = Math.max(...front.map(zombie => zombie.x)) - Math.min(...front.map(zombie => zombie.x)); }
    for (const zombie of simulation.zombies.values()) if (zombie.portalRoute && zombie.portalRoute.doorId !== 'north') detoured.add(zombie.id);
  }
  const attackers = new Set(events.filter(event => event.event === 'door' && event.doorId === 'north').map(event => event.zombieId));
  assert.ok(side >= 4, `only ${side} zombies attacked the barricade side by side`);
  assert.ok(spread >= 1.5, `the front row only spans ${spread.toFixed(2)} m`);
  assert.ok(attackers.size >= 4, `only ${attackers.size} distinct zombies hit the north barricade`);
  assert.ok(detoured.size >= 1, 'a jammed zombie must try another entrance');
  assert.ok(closest > -.02, `zombie bodies overlapped by ${(-closest).toFixed(3)} m`);
});

test('survivors cannot walk through zombies, and zombies go around a survivor in their way', () => {
  const { simulation, player } = waveRoom(() => .5, ['a', 'b']);
  const blocker = simulation.players.get('b');
  Object.assign(player, { x: 0, y: 0, z: 2, yaw: 0, hp: 1e9 });
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: 0, y: 0, z: .5, speed: 0, attackAfter: Infinity, entered: true });
  simulation.toSpawn = 1; simulation.spawnTimer = 999;
  for (let tick = 0; tick < 45; tick++) { simulation.setInput('a', { ...still, forward: 1 }); simulation.setInput('b', still); simulation.tick(1 / 30); }
  assert.ok(Math.hypot(player.x - zombie.x, player.z - zombie.z) >= .25 + .29 - 1e-6, 'the survivor stops against the zombie');
  assert.ok(player.z < 1.2, 'the survivor did walk up to the zombie');
  // Sliding along a body still works: strafing past it is allowed.
  const before = player.x;
  for (let tick = 0; tick < 30; tick++) { simulation.setInput('a', { ...still, strafe: 1 }); simulation.tick(1 / 30); }
  assert.ok(player.x > before + .5);

  // A zombie chasing the far survivor never passes through the one in between.
  Object.assign(player, { x: -2.5, z: -.5, hp: 1e9 });
  Object.assign(blocker, { x: -2.5, y: 0, z: 2, hp: 1e9 });
  Object.assign(zombie, { x: -2.5, z: 4.2, speed: 1.6, attackAfter: 0 });
  player.alive = blocker.alive = true;
  let closest = Infinity;
  simulation.updateZombie = (original => function (body, delta) { return original.call(this, body, delta, [player]); })(simulation.updateZombie);
  for (let tick = 0; tick < 30 * 8; tick++) {
    simulation.setInput('a', still); simulation.setInput('b', still); simulation.tick(1 / 30);
    closest = Math.min(closest, Math.hypot(blocker.x - zombie.x, blocker.z - zombie.z));
  }
  assert.ok(closest >= .25 + .29 - 1e-6, `the zombie crossed a survivor (${closest.toFixed(3)} m)`);
  assert.ok(Math.hypot(player.x - zombie.x, player.z - zombie.z) < 1, 'the zombie went around and reached its target');
});

test('a survivor already overlapping a zombie can always step away from it', () => {
  const { simulation, player } = waveRoom(() => .5);
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: 0, y: 0, z: 1, speed: 0, attackAfter: Infinity, entered: true });
  simulation.toSpawn = 1; simulation.spawnTimer = 999;
  Object.assign(player, { x: 0, y: 0, z: 1.1, yaw: Math.PI, hp: 1e9 });
  for (let tick = 0; tick < 20; tick++) { simulation.setInput('a', { ...still, yaw: Math.PI, forward: 1 }); simulation.tick(1 / 30); }
  assert.ok(player.z > 1.5);
});

test('knockback and separation never shove a zombie into another body', () => {
  const { simulation, player } = waveRoom(() => .5);
  player.weapon = 'shotgun';
  player.inventory.shotgun = { ammo: WEAPONS.shotgun.magazine, reserve: WEAPONS.shotgun.reserve };
  Object.assign(player, { x: 0, y: 0, z: 3, yaw: 0, pitch: 0 });
  const front = simulation.spawnZombie(), rear = simulation.spawnZombie();
  Object.assign(front, { x: 0, y: .4, z: 1, hp: 1e6, speed: 0, attackAfter: Infinity, entered: true });
  Object.assign(rear, { x: 0, y: .4, z: .4, hp: 1e6, speed: 0, attackAfter: Infinity, entered: true });
  simulation.toSpawn = 1; simulation.spawnTimer = 999;
  assert.equal(simulation.shoot('a'), true);
  settleBallisticFlight(simulation);
  assert.ok(Math.hypot(front.pushX, front.pushZ) > 0, 'the shot really pushes the front zombie');
  for (let tick = 0; tick < 15; tick++) { simulation.setInput('a', still); simulation.tick(1 / 30); }
  assert.ok(Math.hypot(front.x - rear.x, front.z - rear.z) >= .58 - 1e-6);

  // Two zombies left on the exact same spot part within a fraction of a second.
  // The old (-3, -2) position is now inside the rear-room partition.
  Object.assign(rear, { x: -3, z: -1.1 }); Object.assign(front, { x: -3, z: -1.1 });
  assert.equal(simulation.canOccupy(front, front.x, front.z, front.y, radius(front)), true, 'separation starts in clear floor space');
  for (let tick = 0; tick < 12; tick++) { simulation.setInput('a', still); simulation.tick(1 / 30); }
  assert.ok(Math.hypot(front.x - rear.x, front.z - rear.z) >= .58 - 1e-6);
});

test('zombies file up the staircase without overlapping and still reach a survivor on the loft', () => {
  const { simulation, events, player } = waveRoom(lcg(5));
  // Keep the staircase fixture on open loft floor, clear of the Magnum crate.
  Object.assign(player, { x: 6, y: 3.4, z: 0, hp: 1e9 });
  assert.equal(simulation.canOccupy(player, player.x, player.z, player.y, .25), true, 'the upstairs target must be reachable without entering a solid');
  for (let index = 0; index < 8; index++) {
    const zombie = simulation.spawnZombie();
    // Both rows clear the table, sofa and rear-room partitions.
    Object.assign(zombie, { x: -5 + (index % 4) * 1.2, y: 0, z: .7 + Math.floor(index / 4), speed: 1.4, entered: true });
    assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius(zombie)), true, `starting zombie ${index} must occupy clear floor space`);
  }
  simulation.toSpawn = 1; simulation.spawnTimer = 999;
  const attackers = new Set();
  let closest = Infinity;
  for (let tick = 0; tick < 30 * 40; tick++) {
    simulation.setInput('a', still);
    simulation.tick(1 / 30);
    closest = Math.min(closest, closestPair(simulation));
    for (const event of events.splice(0)) if (event.event === 'hit') attackers.add(event.zombieId);
  }
  assert.ok(attackers.size >= 3, `only ${attackers.size} zombies reached the loft survivor`);
  assert.ok(closest > -.02, `zombie bodies overlapped by ${(-closest).toFixed(3)} m`);
});

test('an east-door crowd clears both jambs and attacks distant ground and loft survivors without crossing bodies', () => {
  for (const upstairs of [false, true]) {
    const { simulation, events, player } = waveRoom(() => .5);
    Object.assign(player, upstairs ? { x: 6, y: 3.4, z: 0, hp: 1e9 } : { x: -5, y: 0, z: 1, hp: 1e9 });
    simulation.doors.find(door => door.id === 'east').hp = 0;
    const starts = [
      { x: 8.44, z: -1.1, cross: true }, { x: 8.44, z: 1.1, cross: true },
      { x: 8.75, z: -.35 }, { x: 8.75, z: .35 },
      ...Array.from({ length: 8 }, (_, index) => ({ x: 9.45 + Math.floor(index / 4) * .7, z: -1.11 + (index % 4) * .74 })),
    ];
    for (const start of starts) {
      const zombie = simulation.spawnZombie();
      Object.assign(zombie, { x: start.x, y: 0, z: start.z, entered: false, doorId: 'east', kind: 'walker', scale: 1, speed: 1.5,
        portalRoute: start.cross ? { doorId: 'east', fromOutside: true, toOutside: false, stage: 'cross' } : null });
      assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius(zombie)), true);
    }
    simulation.toSpawn = 1; simulation.spawnTimer = 999;
    const entered = new Set(), attackers = new Set();
    let closest = Infinity;
    for (let tick = 0; tick < 30 * 40; tick++) {
      simulation.tick(1 / 30);
      closest = Math.min(closest, closestPair(simulation));
      for (const zombie of simulation.zombies.values()) if (zombie.x < 7.5 && Math.abs(zombie.z) < 5.5) entered.add(zombie.id);
      for (const event of events.splice(0)) if (event.event === 'hit' && event.zombieId) attackers.add(event.zombieId);
    }
    assert.equal(entered.size, starts.length, `all east-door bodies eventually enter for a ${upstairs ? 'loft' : 'ground'} target`);
    assert.ok(attackers.size >= 3, `${attackers.size} bodies reached the ${upstairs ? 'loft' : 'ground'} survivor`);
    assert.ok(closest > -.02, `jamb recovery overlapped bodies by ${(-closest).toFixed(3)} m`);
    for (const door of simulation.doors.filter(door => door.id !== 'east')) assert.equal(door.hp, door.maxHp);
  }
});

test('a boss crossing the east jamb retains its full collision width at the maximum tick duration', () => {
  const { simulation, player } = waveRoom(() => .5);
  Object.assign(player, { x: 5.5, z: 0, y: 0, hp: 1e9 });
  simulation.doors.find(door => door.id === 'east').hp = 0;
  const boss = simulation.spawnZombie(), blocker = simulation.spawnZombie();
  Object.assign(boss, { x: 8.815912878218066, z: .7280698257629153, y: 0, kind: 'brute', boss: true, scale: 1.32, speed: .8,
    portalRoute: { doorId: 'east', fromOutside: true, toOutside: false, stage: 'cross' } });
  Object.assign(blocker, { x: 8.165213254077926, z: .3391612876854657, y: 0, kind: 'walker', scale: 1, speed: 0 });
  for (const zombie of [boss, blocker]) assert.equal(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, radius(zombie)), true, 'the regression starts in valid physical space');
  assert.ok(closestPair(simulation) >= 0);
  for (let tick = 0; tick < 40; tick++) {
    simulation.time += .1;
    simulation.moveZombieThroughDoor(boss, player, .1);
    assert.equal(simulation.canOccupy(boss, boss.x, boss.z, boss.y, radius(boss)), true, 'the entire boss stays clear of the door jamb');
    assert.ok(closestPair(simulation) >= -1e-6, 'the boss cannot cross the stationary body at the threshold');
  }
});
