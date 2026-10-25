import { advanceBallisticFlight } from './helpers/ballistic-flight.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { EXTERIOR, WEAPON_MOVEMENT } from '../public/rules.js';
import { completeRevive } from './helpers/revive.mjs';

function room() {
  const events = [];
  const simulation = new RoomSimulation('ABC123', { random: () => 0.5, onEvent: event => events.push(event) });
  simulation.addPlayer('a', 'Alice');
  return { simulation, events };
}

function advance(simulation, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 30); i++) simulation.tick(1 / 30);
}

function targetZombie(simulation, options = {}) {
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: 0, z: -3, y: 0, hp: 90, entered: true, entryTarget: null, ...options });
  return zombie;
}

test('rooms enforce capacity and transfer the host on departure', () => {
  const { simulation } = room();
  simulation.addPlayer('b'); simulation.addPlayer('c'); simulation.addPlayer('d');
  assert.throws(() => simulation.addPlayer('e'), /complète/);
  simulation.removePlayer('a');
  assert.equal(simulation.hostId, 'b');
  assert.equal(simulation.start('c'), false);
  assert.equal(simulation.start('b'), true);
});

test('host starts countdown, waves and automatic resupply', () => {
  const { simulation } = room();
  simulation.start('a');
  assert.equal(simulation.phase, 'countdown');
  advance(simulation, 5.1);
  assert.equal(simulation.phase, 'wave');
  assert.equal(simulation.wave, 1);
  simulation.toSpawn = 0; simulation.zombies.clear(); simulation.spawnWarnings.clear();
  simulation.players.get('a').inventory.pistol.ammo = 0;
  simulation.tick();
  assert.equal(simulation.phase, 'intermission');
  assert.equal(simulation.players.get('a').inventory.pistol.ammo, WEAPONS.pistol.magazine);
  advance(simulation, 12.1);
  assert.equal(simulation.wave, 2);
});

test('movement validates input, normalizes diagonals and rejects client health', () => {
  const { simulation } = room();
  const player = simulation.players.get('a');
  assert.equal(simulation.setInput('a', { forward: NaN, strafe: 0, yaw: 0, pitch: 0 }), false);
  simulation.setInput('a', { forward: 1, strafe: 1, yaw: 0, pitch: 0, hp: 999 });
  const origin = { x: player.x, z: player.z };
  advance(simulation, 0.2);
  assert.ok(Math.hypot(player.x - origin.x, player.z - origin.z) <= 0.7 * WEAPON_MOVEMENT.pistol + 0.001);
  assert.equal(player.hp, 100);
  player.x = EXTERIOR.bounds.maxX; player.z = 1;
  simulation.setInput('a', { forward: 0, strafe: 1, yaw: 0, pitch: 0 });
  advance(simulation, 0.2);
  assert.equal(player.x, EXTERIOR.bounds.maxX);
});

test('malformed and prototype weapon names never enter authoritative inventory', () => {
  const { simulation } = room();
  const player = simulation.addPlayer('b', 'Bob', 'constructor');
  assert.equal(player.weapon, 'pistol');
  assert.equal(simulation.chooseWeapon('a', '__proto__'), false);
  assert.equal(simulation.chooseWeapon('a', {}), false);
  assert.equal(simulation.players.get('a').weapon, 'pistol');
});

test('shooting consumes ammunition, applies server cooldown and awards kills', () => {
  const { simulation, events } = room();
  simulation.start('a');
  const player = simulation.players.get('a');
  Object.assign(player, { x: -4.4, z: 1.5, yaw: 0, pitch: 0 });
  const zombie = targetZombie(simulation, { x: -4.4, hp: 40 });
  // Aim through the remaining western doorway rather than the sealed wall.
  assert.equal(simulation.shoot('a'), true); advanceBallisticFlight(simulation, .1);
  assert.equal(player.inventory.pistol.ammo, WEAPONS.pistol.magazine - 1);
  assert.equal(simulation.shoot('a'), false);
  assert.equal(simulation.zombies.has(zombie.id), false);
  assert.equal(player.kills, 1);
  assert.ok(events.some(event => event.event === 'kill' && event.headshot));
});

test('solid exterior walls occlude bullets, door openings allow them', () => {
  const { simulation } = room();
  simulation.start('a');
  const player = simulation.players.get('a');
  Object.assign(player, { x: 3, z: -4, yaw: 0, pitch: 0 });
  const zombie = targetZombie(simulation, { x: 3, z: -9, hp: 200 });
  simulation.shoot('a'); advanceBallisticFlight(simulation, .1);
  assert.equal(zombie.hp, 200);
  advance(simulation, WEAPONS.pistol.interval + 0.05);
  Object.assign(player, { x: 0, z: -4 });
  Object.assign(zombie, { x: 0, z: -9 });
  simulation.shoot('a'); advanceBallisticFlight(simulation, .1);
  assert.ok(zombie.hp < 200);
});

test('the one open window on each wall allows shots and the nailed-shut ones stop them', () => {
  // Pinwheel: north keeps x=-4.8, west z=+3.5, south x=+4.8, east z=-3.5.
  const open = [
    { player: { x: -4.3, z: -4, yaw: 0 }, zombie: { x: -4.3, z: -9 } },
    { player: { x: 4.3, z: 4, yaw: Math.PI }, zombie: { x: 4.3, z: 9 } },
    { player: { x: -6, z: 3, yaw: Math.PI / 2 }, zombie: { x: -11, z: 3 } },
    { player: { x: 6, z: -3, yaw: -Math.PI / 2 }, zombie: { x: 11, z: -3 } },
  ];
  // The west boarded case stays clear of the katana rack hanging in front of it.
  const boarded = [
    { player: { x: 4.3, z: -4, yaw: 0 }, zombie: { x: 4.3, z: -9 } },
    { player: { x: -4.3, z: 4, yaw: Math.PI }, zombie: { x: -4.3, z: 9 } },
    { player: { x: -6, z: -2.75, yaw: Math.PI / 2 }, zombie: { x: -11, z: -2.75 } },
    { player: { x: 6, z: 3, yaw: -Math.PI / 2 }, zombie: { x: 11, z: 3 } },
  ];
  for (const [cases, passes] of [[open, true], [boarded, false]]) {
    for (const fixture of cases) {
      const { simulation, events } = room();
      simulation.start('a');
      Object.assign(simulation.players.get('a'), { ...fixture.player, pitch: 0 });
      const zombie = targetZombie(simulation, { ...fixture.zombie, hp: 200 });
      simulation.shoot('a'); advanceBallisticFlight(simulation, .1);
      assert.equal(zombie.hp < 200, passes, `window at ${JSON.stringify(fixture.player)} must be ${passes ? 'open' : 'boarded'}`);
      if (!passes) assert.equal(events.filter(event => event.event === 'bullet-impact').at(-1).stop, 'solid');
    }
  }
});

test('reload transfers finite reserve and switching weapons cancels reload', () => {
  const { simulation } = room();
  const player = simulation.players.get('a');
  // The reload fixture owns its second weapon; normal players buy it at a crate.
  player.weapon = 'rifle';
  player.inventory.rifle = { ammo: WEAPONS.rifle.magazine, reserve: WEAPONS.rifle.reserve };
  player.inventory.shotgun = { ammo: WEAPONS.shotgun.magazine, reserve: WEAPONS.shotgun.reserve };
  player.inventory.rifle.ammo = 20; player.inventory.rifle.reserve = 6;
  assert.equal(simulation.reload('a'), true);
  advance(simulation, 1.7);
  assert.equal(player.inventory.rifle.ammo, 26);
  assert.equal(player.inventory.rifle.reserve, 0);
  player.inventory.rifle.reserve = 20;
  simulation.reload('a');
  simulation.chooseWeapon('a', 'shotgun');
  advance(simulation, 2);
  assert.equal(player.inventory.rifle.ammo, 26);
  assert.equal(player.inventory.shotgun.ammo, 8);
});

test('repair and revive require proximity and respect interaction cooldown', () => {
  const { simulation } = room();
  const player = simulation.players.get('a');
  const teammate = simulation.addPlayer('b');
  simulation.start('a');
  Object.assign(player, { x: 0, z: -5 });
  const door = simulation.doors[0]; door.hp = 30;
  assert.equal(simulation.interact('a'), true);
  assert.equal(door.hp, 55);
  assert.equal(simulation.interact('a'), false);
  advance(simulation, 0.6);
  Object.assign(teammate, { x: 0, z: -4, hp: 0, downed: true, alive: true, bleedOutAt: simulation.time + 25 });
  assert.equal(completeRevive(simulation, 'a'), true);
  assert.equal(teammate.downed, false);
  assert.equal(teammate.hp, 55);
});

test('all survivors down ends the round and host can restart', () => {
  const { simulation } = room();
  simulation.start('a'); advance(simulation, 5.1);
  const player = simulation.players.get('a');
  simulation.damagePlayer(player, 100, { id: 'fake' });
  simulation.tick();
  assert.equal(simulation.phase, 'gameover');
  assert.equal(simulation.start('a'), true);
  assert.equal(player.hp, 100);
  assert.equal(player.downed, false);
  assert.equal(simulation.wave, 0);
});

test('one survivor still standing at the end of a wave brings every downed and eliminated teammate back', () => {
  const { simulation } = room();
  simulation.addPlayer('b', 'Bruno'); simulation.addPlayer('c', 'Chloé');
  simulation.start('a'); advance(simulation, 5.1);
  assert.equal(simulation.phase, 'wave');
  const [standing, downed, eliminated] = ['a', 'b', 'c'].map(id => simulation.players.get(id));
  simulation.damagePlayer(downed, 100, { id: 'fake' });
  simulation.damagePlayer(eliminated, 100, { id: 'fake' });
  eliminated.bleedOutAt = simulation.time;
  simulation.tick();
  assert.equal(downed.downed, true);
  assert.equal(eliminated.alive, false);
  standing.hp = 40;
  // The standing survivor clears the last threat of the wave.
  simulation.zombies.clear(); simulation.toSpawn = 0; simulation.spawnWarnings.clear();
  simulation.tick();
  assert.equal(simulation.phase, 'intermission');
  for (const player of [standing, downed, eliminated]) {
    assert.equal(player.alive, true, player.name);
    assert.equal(player.downed, false, player.name);
    assert.equal(player.hp, 100, player.name);
  }
});

test('players climb the staircase and loft railing prevents walking into the void', () => {
  const { simulation } = room();
  const player = simulation.players.get('a');
  Object.assign(player, { x: 3.8, z: WORLD.stair.maxZ + .1, y: 0 });
  for (let i = 0; i < 65; i++) {
    simulation.setInput('a', { forward: 1, strafe: 0, yaw: 0, pitch: 0 });
    simulation.tick();
  }
  assert.equal(player.y, WORLD.loftY);
  player.x = WORLD.loft.minX + .3; player.z = -3;
  simulation.setInput('a', { forward: 0, strafe: -1, yaw: 0, pitch: 0 });
  advance(simulation, 0.2);
  assert.ok(player.x >= WORLD.loft.minX + .25);
});

test('staircase handrails prevent entering and leaving through the sides', () => {
  const { simulation } = room();
  const player = simulation.players.get('a');
  const lowerZ = WORLD.stair.maxZ - .2;
  Object.assign(player, { x: 2.9, z: lowerZ, y: 0 });
  assert.equal(simulation.candidateY(player, 3.1, lowerZ), null);
  Object.assign(player, { x: 3.1, z: -1.6, y: WORLD.loftY * (WORLD.stair.maxZ + 1.6) / (WORLD.stair.maxZ - WORLD.stair.minZ) });
  assert.equal(simulation.candidateY(player, 2.9, -1.6), null);
  Object.assign(player, { x: 3.8, z: -2, y: WORLD.loftY });
  assert.equal(simulation.candidateY(player, 3.8, -2.1), WORLD.loftY);
});

test('zombies breach assigned barricades before entering the cabin', () => {
  const { simulation, events } = room();
  simulation.start('a'); advance(simulation, 5.1);
  simulation.zombies.clear(); simulation.toSpawn = 1;
  const zombie = targetZombie(simulation, { x: -8.68, z: 0, entered: false, doorId: 'west' });
  const door = simulation.doors.find(item => item.id === 'west');
  door.hp = 12;
  simulation.tick();
  assert.equal(door.hp, 0);
  assert.equal(zombie.entered, false);
  simulation.tick();
  assert.equal(zombie.entered, true);
  assert.ok(events.some(event => event.event === 'door' && event.doorId === 'west'));
});

test('zombies can reach survivors upstairs using the staircase', () => {
  const { simulation } = room();
  simulation.start('a');
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 100;
  const player = simulation.players.get('a');
  Object.assign(player, { x: 5.5, z: -3, y: WORLD.loftY });
  const zombie = targetZombie(simulation, { x: 3.8, z: 4.2, entered: true, speed: 2 });
  advance(simulation, 5);
  assert.equal(zombie.y, WORLD.loftY);
  assert.ok(zombie.z < -2);
  advance(simulation, 2);
  assert.ok(player.hp < 100);
});

test('zombies route around the staircase at ground level without climbing through its side', () => {
  const { simulation } = room();
  simulation.start('a');
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 100;
  const player = simulation.players.get('a');
  Object.assign(player, { x: 2.5, z: 0, y: 0 });
  const zombie = targetZombie(simulation, { x: 6, z: 0, y: 0, speed: 2 });
  for (let i = 0; i < 300; i++) {
    simulation.tick();
    assert.equal(zombie.y, 0, 'A ground-level pursuit must go around the staircase');
  }
  assert.ok(player.hp < 100);
});

test('zombies route around the stairwell on the loft without walking through the opening', () => {
  const { simulation } = room();
  simulation.start('a');
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 100;
  const player = simulation.players.get('a');
  Object.assign(player, { x: 2.5, z: 1.5, y: WORLD.loftY });
  const zombie = targetZombie(simulation, { x: 6, z: 1.5, y: WORLD.loftY, speed: 2 });
  for (let i = 0; i < 300; i++) {
    simulation.tick();
    assert.equal(zombie.y, WORLD.loftY, 'The stairwell cannot be crossed at loft height');
  }
  assert.ok(player.hp < 100);
});

test('zombies descend the staircase to reach survivors downstairs', () => {
  const { simulation } = room();
  simulation.start('a');
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 100;
  const player = simulation.players.get('a');
  Object.assign(player, { x: -2.8, z: 1.7, y: 0 });
  const zombie = targetZombie(simulation, { x: 6, z: -3, y: WORLD.loftY, speed: 2 });
  let usedStairs = false;
  for (let i = 0; i < 420; i++) {
    simulation.tick();
    if (zombie.y > 0 && zombie.y < WORLD.loftY) usedStairs = true;
  }
  assert.equal(usedStairs, true);
  assert.equal(zombie.y, 0);
  assert.ok(player.hp < 100);
});

test('zombies use the lower landing to reach a survivor in the middle of the stairs', () => {
  const { simulation } = room();
  simulation.start('a');
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 100;
  const player = simulation.players.get('a');
  Object.assign(player, { x: 3.8, z: (WORLD.stair.minZ + WORLD.stair.maxZ) / 2, y: WORLD.loftY / 2 });
  const zombie = targetZombie(simulation, { x: 5.5, z: 1, y: 0, speed: 2 });
  let usedLowerLanding = false;
  for (let i = 0; i < 240; i++) {
    simulation.tick();
    if (zombie.z > WORLD.stair.maxZ && zombie.y === 0) usedLowerLanding = true;
  }
  assert.equal(usedLowerLanding, true);
  assert.ok(zombie.y > 0);
  assert.ok(player.hp < 100);
});

test('zombies navigate around the sofa instead of becoming stuck at its front', () => {
  const { simulation } = room();
  simulation.start('a');
  simulation.phase = 'wave'; simulation.toSpawn = 0;
  const player = simulation.players.get('a');
  Object.assign(player, { x: -4.6, z: 4.5, y: 0 });
  targetZombie(simulation, { x: 0, z: -4.8, entered: true });
  advance(simulation, 20);
  assert.ok(player.hp < 100, 'A zombie must be able to walk around the sofa and reach the survivor');
});
