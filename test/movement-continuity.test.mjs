import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';

function fixture(position) {
  const simulation = new RoomSimulation('SMOOTH', { practice: true });
  const player = simulation.addPlayer('a');
  simulation.zombies.clear();
  Object.assign(player, position, { grounded: true, vy: 0 });
  const step = (input = {}, delta = 1 / 30) => {
    simulation.setInput(player.id, { forward: 0, strafe: 0, yaw: 0, pitch: .17, ...input });
    simulation.tick(delta);
  };
  return { simulation, player, step };
}

test('a diagonal entrance into either stairwell edge cannot snap down two treads in one tick', () => {
  for (const side of [-1, 1]) {
    const { simulation, player, step } = fixture({ x: side < 0 ? 2.4 : 5.2, y: 3.4, z: -2 });
    const yaw = side * 3 * Math.PI / 4;
    for (let tick = 0; tick < 4; tick++) step({ forward: 1, sprint: true, yaw });
    assert.equal(player.y, 3.4, 'the ordinary approach is still on the mezzanine');
    const before = { x: player.x, y: player.y, z: player.z };
    step({ forward: 1, sprint: true, yaw });
    // Before the fix: 3.4 -> 3.1875 on X -> 2.975 on Z, grounded throughout.
    assert.ok(player.y > 3.16, `one step plus physical falling, not a 42.5 cm snap: ${player.y}`);
    assert.equal(player.grounded, false, 'the farther tread is reached by falling');
    assert.ok(player.vy < 0);
    assert.equal(player.fallStartY, before.y, 'retain the actual takeoff height');
    assert.ok(Math.hypot(player.x - before.x, player.z - before.z) <= .18 + 1e-8);
    assert.ok(simulation.canOccupy(player, player.x, player.z, player.y, .25));
    assert.ok(Math.abs(player.yaw - yaw) < 1e-8);
    assert.equal(player.pitch, .17);
    for (let tick = 0; tick < 30; tick++) {
      step({ yaw });
      assert.ok(simulation.canOccupy(player, player.x, player.z, player.y, .25));
    }
    assert.equal(player.y, 2.975);
    assert.equal(player.grounded, true);
    assert.equal(player.hp, 100);
  }
});

test('longer diagnostic ticks retain equivalent traversal with one shared time-scaled allowance', () => {
  for (const delta of [1 / 30, .1]) {
    const { simulation, player, step } = fixture({ x: 3.8, y: 0, z: 2.9 });
    for (let tick = 0; tick < Math.ceil(3 / delta) && player.z > -2.4; tick++) {
      const beforeY = player.y;
      step({ forward: 1, sprint: true }, delta);
      assert.ok(player.y - beforeY <= .24 * Math.max(1, delta * 30) + 1e-8, `one shared rise allowance: ${player.y - beforeY}`);
      assert.ok(simulation.canOccupy(player, player.x, player.z, player.y, .25));
    }
    assert.equal(player.y, 3.4);
    assert.ok(player.z < -2.25, 'limiting the rise must still reach the landing');
    for (let tick = 0; tick < Math.ceil(3 / delta) && player.z < 2.9; tick++) {
      step({ forward: -1, sprint: true }, delta);
      assert.ok(simulation.canOccupy(player, player.x, player.z, player.y, .25));
    }
    assert.equal(player.y, 0);
    assert.equal(player.grounded, true);
    assert.equal(player.hp, 100);
  }
});
