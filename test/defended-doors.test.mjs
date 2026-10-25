import { settleBallisticFlight } from './helpers/ballistic-flight.mjs';
import { ballisticDistance } from '../public/ballistics.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { defendedDoorIds, waveBalance } from '../public/rules.js';
import { enemyHitbox } from '../public/enemies.js';

function room(count = 1, options = {}) {
  const simulation = new RoomSimulation('DOORQA', { random: () => .5, ...options });
  for (let index = 0; index < count; index++) simulation.addPlayer(`p${index}`);
  simulation.start('p0');
  return simulation;
}
const active = simulation => simulation.doors.filter(door => !door.sealed && !door.sealPending).map(door => door.id).sort();

test('solo keeps opposed east/west doors, duo adds north, three and four keep all four', () => {
  for (const count of [1, 2, 3, 4]) {
    const simulation = room(count);
    assert.equal(active(simulation).length, 4, 'lobby/countdown retains the original doors');
    simulation.beginWave();
    assert.deepEqual(active(simulation), defendedDoorIds(count).sort());
    assert.equal(simulation.toSpawn, waveBalance(1, count).total, 'no loot/enemy count reduction');
    for (const door of simulation.snapshot().doors) {
      assert.equal(door.sealed, !defendedDoorIds(count).includes(door.id));
      assert.equal(door.sealPending, false);
    }
  }
});

test('joins and disconnects change the defended doors only at the next wave boundary', () => {
  const simulation = room(); simulation.beginWave();
  simulation.addPlayer('p1'); simulation.addPlayer('p2');
  assert.deepEqual(active(simulation), ['east', 'west']);
  simulation.finishWave();
  assert.deepEqual(active(simulation), ['east', 'west'], 'intermission does not seal or unseal');
  simulation.beginWave();
  assert.equal(active(simulation).length, 4);
  simulation.removePlayer('p2');
  assert.equal(active(simulation).length, 4);
  simulation.finishWave(); simulation.beginWave();
  assert.deepEqual(active(simulation), ['east', 'north', 'west']);
  simulation.removePlayer('p1');
  simulation.finishWave(); simulation.beginWave();
  assert.deepEqual(active(simulation), ['east', 'west']);
});

test('reinforced doors resist bullet, explosive and zombie board damage and block standing/crouched bodies', () => {
  const simulation = room(); simulation.beginWave();
  const sealed = simulation.doors.find(door => door.id === 'north');
  const player = simulation.players.get('p0');
  for (const details of [{ boardIndex: 2, id: player.id }, { id: player.id }, { zombieId: 'z1' }]) {
    assert.equal(simulation.damageDoor(sealed, 10000, details), 0);
    assert.equal(sealed.hp, sealed.maxHp);
    assert.equal(sealed.repairCredit, 0);
  }
  for (const height of [1, 1.7, 2.5]) assert.equal(simulation.doorPassable(sealed, 0, height), false);
  for (const crouched of [false, true]) {
    player.crouched = crouched;
    assert.equal(simulation.canOccupy(player, sealed.x, sealed.z, 0, .25), false);
  }
  const openable = simulation.doors.find(door => door.id === 'east');
  assert.equal(simulation.damageDoor(openable, 10000), openable.maxHp);
  assert.equal(simulation.doorPassable(openable), true);
});

test('a survivor on a newly condemned threshold can leave it before the seal becomes solid', () => {
  for (const downed of [false, true]) {
    const simulation = room(3), player = simulation.players.get('p0'); simulation.beginWave();
    simulation.doors.find(door => door.id === 'south').hp = 0;
    simulation.removePlayer('p2');
    Object.assign(player, { x: 0, y: 0, z: 6, downed });
    simulation.finishWave(); player.downed = downed; simulation.beginWave();
    let south = simulation.snapshot().doors.find(door => door.id === 'south');
    assert.equal(south.sealPending, true); assert.equal(south.sealed, false);
    assert.deepEqual(active(simulation), ['east', 'north', 'west']);
    assert.equal(simulation.canOccupy(player, 0, 6, 0, .25), true);
    // A downed survivor is carried/revived here by the fixture; the check must
    // protect their body too, rather than immediately sealing through them.
    player.z = 5;
    simulation.tick(1 / 30);
    south = simulation.snapshot().doors.find(door => door.id === 'south');
    assert.equal(south.sealed, true); assert.equal(south.sealPending, false);
    assert.equal(south.hp, south.maxHp);
    assert.equal(simulation.canOccupy(player, 0, 5, 0, .25), true);
  }
});

test('all scheduled arrivals choose active entrances and stale routes leave condemned doors', () => {
  for (const count of [1, 2, 3, 4]) {
    const simulation = room(count); simulation.wave = 19; simulation.beginWave();
    const allowed = defendedDoorIds(count), total = simulation.toSpawn;
    for (let index = 0; index < total; index++) assert.ok(allowed.includes(simulation.createZombie().doorId));
  }
  const simulation = room(); simulation.beginWave();
  const player = simulation.players.get('p0'), zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: 0, z: -7, portalRoute: { doorId: 'north', stage: 'cross', fromOutside: true, toOutside: false } });
  simulation.moveZombieThroughDoor(zombie, player, 1 / 30);
  assert.ok(['east', 'west'].includes(zombie.portalRoute.doorId));
  assert.deepEqual(simulation.doorChoices(zombie, player, 1.7, true).map(item => item.door.id).sort(), ['east', 'west']);
});

test('practice and a new night restore the original unsealed doors before the first wave', () => {
  const simulation = room(); simulation.beginWave();
  simulation.phase = 'gameover'; simulation.start('p0');
  assert.equal(active(simulation).length, 4);
  const practice = room(1, { practice: true });
  assert.equal(practice.beginWave(), false);
  assert.equal(active(practice).length, 4);
});

test('the full steel plate stops aimed bullets across every former plank gap on all four walls', () => {
  for (const id of ['north', 'south', 'east', 'west']) {
    const events = [], simulation = room(1, { onEvent: event => events.push(event), random: () => .5 });
    simulation.beginWave();
    const door = simulation.doors.find(door => door.id === id), player = simulation.players.get('p0');
    door.sealed = true;
    Object.assign(player, { x: door.x - door.outX * 2, z: door.z - door.outZ * 2, yaw: Math.atan2(-door.outX, -door.outZ) });
    for (const height of [.1, .62, 1.1, 1.58, 2.06, 2.7]) {
      player.pitch = Math.atan2(height - 1.55, 2); player.shotAfter = 0;
      assert.equal(simulation.shoot(player.id), true);
      settleBallisticFlight(simulation);
      const pellet = events.findLast(event => event.event === 'bullet-impact');
      const projectile = events.findLast(event => event.event === 'shot').projectiles[0];
      assert.equal(pellet.stop, 'solid', `${id}, aiming at ${height}m`);
      assert.ok(Math.abs(ballisticDistance(projectile, pellet.age) * Math.cos(player.pitch) - 1.865) < .002);
      assert.equal(door.hp, door.maxHp);
    }
  }
});

test('steel stops firearms, rockets, fire and swept grenades where ordinary plank gaps remain permeable', () => {
  for (const weapon of ['pistol', 'sniper', 'rocket', 'flamethrower']) for (const sealed of [false, true]) {
    const events = [], simulation = room(1, { onEvent: event => events.push(event), random: () => .5 });
    simulation.beginWave();
    const door = simulation.doors.find(door => door.id === 'north'), player = simulation.players.get('p0');
    door.sealed = sealed;
    Object.assign(player, { x: 0, y: 0, z: -4.5, yaw: 0, pitch: 0, weapon, inventory: { [weapon]: { ammo: 10, reserve: 0 } } });
    const zombie = { id: 'behind', x: 0, y: 0, z: -6.8, hp: 10000, maxHp: 10000, kind: 'walker', scale: 1 };
    simulation.zombies.set(zombie.id, zombie);
    assert.equal(simulation.shoot(player.id), true);
    settleBallisticFlight(simulation);
    assert.equal(zombie.hp < 10000, !sealed, `${weapon}, sealed=${sealed}`);
    if (sealed) {
      const shot = events.findLast(event => event.event === 'shot');
      const impact = shot.ballistic ? events.findLast(event => event.event === 'bullet-impact') : shot.pellets[0];
      assert.equal(impact.stop, 'solid');
    }
    const origin = { x: 0, y: 1.58, z: -5.5 }, target = { x: 0, y: 1.58, z: -6.5 };
    assert.equal(simulation.grenadeBlastVisible(origin, target), !sealed);
    const swept = simulation.grenadeCollision(origin, { x: 0, y: 0, z: -1 });
    assert.equal(Boolean(swept), sealed, `grenade through former gap, sealed=${sealed}`);
    // Blast visibility samples the body centre. Put that centre on the same
    // former gap, so ordinary wood cannot mask the plate-vs-gap distinction.
    const hitbox = enemyHitbox(zombie); zombie.y += origin.y - (hitbox.minY + hitbox.maxY) / 2;
    const hp = zombie.hp, grenade = { id: 'blast', ownerId: player.id, ...origin };
    simulation.grenades.set(grenade.id, grenade); simulation.explodeGrenade(grenade);
    assert.equal(zombie.hp < hp, !sealed, `actual blast behind plate, sealed=${sealed}`);
  }
});
