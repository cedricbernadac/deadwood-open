import assert from 'node:assert/strict';
import { RoomSimulation } from '../../simulation.mjs';
import { IS_HOSPITAL } from '../../public/level-config.js';
import { SPACE, spaceFlightAt } from '../../public/level-space.js';
import { movementMethods, createPhysicsContext, clonePredictedPlayer, stepPredictedPlayer } from '../../public/online/physics.js';

const DT = 1 / 30;
const ID = '0123456789abcdef';
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
assert.equal(IS_HOSPITAL, true);
assert.deepEqual(SPACE.flights.map(flight => flight.id), ['main-stair', 'service-stair']);

const room = new RoomSimulation('HOSMOVE', { random: () => .5, raids: false });
const player = room.addPlayer(ID, 'Jules');
room.start(ID);
room.phase = 'wave';
room.wave = 1;
room.toSpawn = 1;
room.spawnTimer = 1e9;
for (const door of room.doors) {
  door.boards.fill(0);
  door.sealed = false;
  door.sealPending = false;
}
for (const [name, method] of Object.entries(movementMethods)) {
  assert.equal(method.toString(), RoomSimulation.prototype[name].toString(), name);
}

let traversals = 0;
for (const flight of SPACE.flights) for (const down of [false, true]) for (const delta of [DT, .1]) {
  Object.assign(player, down ? flight.upper : flight.lower, {
    vy: 0, grounded: true, crouched: false, fallStartY: null, jumpRequested: false, jumpHeld: false,
    input: { forward: 0, strafe: 0, sprint: false, crouch: false },
  });
  const target = down ? flight.lower : flight.upper;
  const context = createPhysicsContext({ time: room.time, phase: room.phase, players: [player], zombies: [], doors: room.doors });
  const predicted = clonePredictedPlayer(player);
  const label = `${flight.id} ${down ? 'down' : 'up'} at ${Math.round(1 / delta)} Hz`;
  let arrived = false;
  let flightSamples = 0;
  for (let tick = 0; tick < 600; tick++) {
    const command = { forward: 1, strafe: 0, yaw: down ? 0 : Math.PI, pitch: 0, sprint: false, crouch: false };
    room.setInput(ID, command);
    room.time += delta;
    room.movePlayer(player, delta);
    context.time = room.time;
    stepPredictedPlayer(predicted, command, delta, context);
    for (const key of ['x', 'y', 'z', 'vy']) {
      assert.ok(Math.abs(player[key] - predicted[key]) < 1e-10,
        `${label} prediction ${key}: ${JSON.stringify({ tick, authoritative: player[key], predicted: predicted[key] })}`);
    }
    assert.equal(room.canOccupy(player, player.x, player.z, player.y, .25), true,
      `${label} illegal body: ${JSON.stringify({ tick, x: player.x, y: player.y, z: player.z })}`);
    if (spaceFlightAt(player.x, player.z, player.y)?.id === flight.id) flightSamples++;
    if (flat(player, target) < .22 && Math.abs(player.y - target.y) < .1) {
      arrived = true;
      break;
    }
  }
  assert.ok(flightSamples > 5, `${label} actually used the stair flight (${flightSamples} samples)`);
  assert.ok(arrived, `${label} did not arrive: ${JSON.stringify({ x: player.x, y: player.y, z: player.z, target })}`);
  traversals++;
}

console.log(`hospital player stairs verified: ${traversals} authoritative/predicted traversals, both flights, both directions, 30 and 10 Hz`);
