import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { ARMORY, waveBalance } from '../../public/rules.js';
import { SPACE } from '../../public/level-space.js';
import { decodeSave } from '../../save-game.mjs';

const ID = '0123456789abcdef';
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const stand = rack => ({ x: rack.x + Math.sin(rack.facing ?? 0) * .95, y: rack.y, z: rack.z + Math.cos(rack.facing ?? 0) * .95 });

function setup(code) {
  const events = [];
  const sim = new RoomSimulation(code, { random: () => .5, raids: false, onEvent: event => events.push(event) });
  const player = sim.addPlayer(ID, 'Jules');
  sim.start(ID);
  Object.assign(sim, { phase: 'wave', wave: 16, toSpawn: 1, spawnTimer: 1e9 });
  for (const door of sim.doors) {
    door.boards.fill(0);
    door.sealed = false;
    door.sealPending = false;
  }
  return { sim, player, events };
}

{
  const { sim, player, events } = setup('HOSBUY');
  player.points = 10000;
  player.backpack = true;
  for (const id of ['bat', 'assault']) {
    const rack = ARMORY.find(item => item.id === id);
    assert.ok(rack, id);
    Object.assign(player, stand(rack), { grounded: true, vy: 0, interactAfter: 0 });
    assert.equal(sim.canOccupy(player, player.x, player.z, player.y, .25), true, `${id} purchase stand is free`);
    const before = player.points;
    assert.equal(sim.interact(ID), true, `${id} bought through the ordinary interaction path`);
    assert.ok(Object.hasOwn(player.inventory, rack.weapon), `${id} weapon entered the inventory`);
    assert.equal(player.points, before - rack.price, `${id} charged its real price`);
    assert.ok(events.some(event => event.event === 'purchase' && event.id === ID && event.crateId === id));
  }
}

{
  const { sim, player, events } = setup('HOSDOOR');
  const door = sim.doors.find(item => item.id === 'south');
  Object.assign(player, { x: door.x, y: 0, z: door.z - 1.4, grounded: true, vy: 0, interactAfter: 0 });
  door.boards.fill(0);
  const before = door.hp;
  assert.equal(sim.repairDoor(ID, door.id), true, 'south door repairs from inside');
  assert.ok(door.hp > before && door.boards.some(hp => hp > 0), 'repair restored real boards');
  assert.ok(events.some(event => event.event === 'repair' && event.doorId === door.id));
  Object.assign(player, { y: SPACE.minY, interactAfter: 0 });
  assert.equal(sim.repairDoor(ID, door.id), false, 'basement cannot repair through the ground slab');
}

{
  const { sim, player, events } = setup('HOSWAVE');
  sim.wave = 0;
  assert.equal(sim.beginWave(), true);
  assert.equal(sim.wave, 1);
  const total = sim.toSpawn;
  assert.equal(total, waveBalance(1, 1).total);
  Object.assign(player, { x: 0, y: 0, z: 0, hp: 10000, grounded: true, vy: 0 });
  const initialHp = player.hp;
  let contacted = false;
  let ticks = 0;
  for (; ticks < 30 * 180 && sim.phase === 'wave'; ticks++) {
    sim.tick(.1);
    contacted ||= player.hp < initialHp;
    if (!contacted) continue;
    for (const zombie of [...sim.zombies.values()]) {
      sim.damageSpecialZombie(zombie, zombie.hp + 1, ID, { x: 0, z: 1 }, 'rocket');
    }
  }
  assert.ok(contacted, 'a scheduled hospital zombie reached and hurt the survivor');
  assert.ok(player.alive && !player.downed && player.hp > 0, 'survivor survived the wave');
  assert.equal(events.filter(event => event.event === 'kill' && event.id === ID).length, total, 'every scheduled zombie went through authoritative death/loot handling');
  assert.equal(sim.phase, 'intermission', `wave did not finish: ${JSON.stringify({ ticks, phase: sim.phase, toSpawn: sim.toSpawn, warnings: sim.spawnWarnings.size, zombies: sim.zombies.size })}`);
  assert.equal(sim.wave, 1);
  for (let tick = 0; tick < 121; tick++) sim.tick(.1);
  assert.equal(sim.wave, 2, 'intermission progressed to wave two');
  assert.equal(sim.phase, 'wave');
  assert.equal(sim.waveInitialTotal, waveBalance(2, 1).total);
}

{
  const { sim, player } = setup('HOSSAVE');
  sim.wave = 2;
  Object.assign(player, { ...SPACE.refuge, fallStartY: SPACE.minY, grounded: true, vy: 0 });
  sim.paused = true;
  sim.pauseById = ID;
  const file = JSON.parse(JSON.stringify(sim.exportSave()));
  assert.equal(file.mapId, 'hospital');
  assert.equal(file.spaceId, 'hospital-depth');
  const decoded = decodeSave(file);
  assert.equal(decoded.players[0].record.y, SPACE.minY);
  assert.equal(decoded.players[0].record.fallStartY, SPACE.minY);
  assert.throws(() => decodeSave({ ...file, spaceId: 'supermarket-depth' }), error => error.code === 'map');

  const lobby = new RoomSimulation('HOSSAVE2', { random: () => .5, raids: false });
  lobby.addPlayer(ID, 'Jules');
  const result = lobby.importSave(file, ID);
  assert.equal(result.ok, true, `hospital save import refused: ${result.reason}`);
  const restored = lobby.players.get(ID);
  assert.equal(lobby.wave, 2);
  assert.equal(lobby.paused, true);
  assert.ok(restored);
  assert.deepEqual({ x: restored.x, y: restored.y, z: restored.z }, SPACE.refuge);
  assert.equal(restored.fallStartY, SPACE.minY);
  const roundTrip = JSON.parse(JSON.stringify(lobby.exportSave()));
  assert.equal(roundTrip.mapId, 'hospital');
  assert.equal(roundTrip.spaceId, 'hospital-depth');
  assert.equal(roundTrip.players[0].y, SPACE.minY);
}

console.log('hospital gameplay verified: two real rack purchases, inside-only door repair, scheduled wave survival and progression, mapId/spaceId save round trip');
