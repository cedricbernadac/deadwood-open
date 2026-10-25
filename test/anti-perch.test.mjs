import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation } from '../simulation.mjs';
import { PARTITION_CAPS, partitionCapHeight, partitionCapSupport } from '../public/rules.js';

function setup(position) {
  const simulation = new RoomSimulation('PERCH1', { random: () => .5 });
  const player = simulation.addPlayer('a');
  Object.assign(player, { grounded: true, vy: 0, ...position });
  simulation.phase = 'intermission'; simulation.timeLeft = 100000;
  return { simulation, player };
}
function foe(simulation, position) {
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { y: 0, entered: true, speed: 1.4, ...position });
  return zombie;
}
function input(simulation, values = {}) {
  simulation.setInput('a', { forward: 0, strafe: 0, yaw: 0, pitch: 0, ...values });
}

test('the steep partition cap sheds a survivor, including towards the pistol rack and against sprint input', () => {
  for (const delta of [1 / 30, .1]) for (const forward of [0, 1]) {
    const { simulation, player } = setup({ x: -2, y: 3.05, z: -2 });
    for (let elapsed = 0; elapsed < 2; elapsed += delta) {
      input(simulation, { forward, sprint: true, jump: true });
      simulation.time += delta; simulation.movePlayer(player, delta);
      assert.ok(simulation.canOccupy(player, player.x, player.z, player.y, .25), `no trapped body at ${elapsed}`);
    }
    assert.equal(simulation.playerPartitionCap(player), undefined);
    assert.ok(player.y <= .8 + 1e-6, `no second perch on the pistol rack: ${player.y}`);
    assert.ok(player.z > PARTITION_CAPS[0].maxZ + .25);
    const before = player.x;
    input(simulation, { strafe: -1 }); simulation.movePlayer(player, delta);
    assert.ok(player.x < before, 'ordinary movement works after landing');
  }
});

test('jumping west from the loft onto the partition cannot establish a stable perch', () => {
  for (const delta of [1 / 30, .1]) {
    const { simulation, player } = setup({ x: 1.2, y: 3.4, z: -2 });
    for (let elapsed = 0; elapsed < 1; elapsed += delta) {
      input(simulation, { strafe: -1, jump: elapsed === 0 });
      simulation.time += delta; simulation.movePlayer(player, delta);
    }
    for (let elapsed = 0; elapsed < 3; elapsed += delta) {
      input(simulation); simulation.time += delta; simulation.movePlayer(player, delta);
    }
    assert.ok(player.y <= 1, `fell safely off the screen, height=${player.y}`);
    assert.ok(simulation.canOccupy(player, player.x, player.z, player.y, .25));
  }
});

test('partition cap contact follows its pitch and round body footprint', () => {
  const cap = PARTITION_CAPS[0];
  assert.equal(partitionCapHeight(cap, cap.minZ), cap.highY);
  assert.equal(partitionCapHeight(cap, cap.maxZ), cap.lowY);
  const { simulation, player } = setup({ x: -1, y: 3, z: -2 });
  const x = -1, z = -1.65, surface = partitionCapSupport(cap, x, z, .25);
  assert.ok(surface > cap.lowY && surface < cap.highY);
  assert.equal(simulation.canOccupy(player, x, z, surface, .25), true);
  assert.equal(simulation.canOccupy(player, x, z, surface - .02, .25), false);
  assert.equal(partitionCapSupport(cap, cap.maxX + .3, -2, .25), -Infinity);
});

test('the former pistol-rack shortcut from the loft now lands on the ground', () => {
  for (const delta of [1 / 30, .1]) {
    const { simulation, player } = setup({ x: .9, y: 3.4, z: -1.43 });
    for (let elapsed = 0; elapsed < 3; elapsed += delta) {
      input(simulation, { yaw: Math.PI / 2, forward: player.x > -2.3 ? 1 : 0, sprint: true, jump: elapsed === 0 });
      simulation.time += delta; simulation.movePlayer(player, delta);
    }
    assert.ok(player.x < -2.3 && player.y === 0, `no rack perch: ${player.x},${player.y}`);
    assert.ok(simulation.canOccupy(player, player.x, player.z, player.y, .25));
  }
});

test('zombies reach people on low cover and table without routing them upstairs', () => {
  const cases = [
    { player: { x: .9, y: 1.15, z: 3.6 }, starts: [[1.6, 3.6], [-1, 3.6]] },
    { player: { x: -.9, y: .8, z: -.4 }, starts: [[-4, 0], [-3, 1.5], [-3, -3]] },
  ];
  for (const delta of [1 / 30, .1]) for (const fixture of cases) for (const [x, z] of fixture.starts) {
    const { simulation, player } = setup(fixture.player);
    const zombie = foe(simulation, { x, z });
    assert.ok(simulation.canOccupy(zombie, x, z, 0, .29), 'legal start');
    for (let elapsed = 0; elapsed < 12 && player.hp === 100; elapsed += delta) {
      simulation.time += delta; simulation.updateZombie(zombie, delta, [player]);
      assert.ok(simulation.canOccupy(zombie, zombie.x, zombie.z, zombie.y, .29), 'never crosses the furniture');
    }
    assert.ok(player.hp < 100, `reachable cover ${JSON.stringify(fixture.player)} from ${x},${z}`);
    assert.equal(zombie.stairState, null);
  }
});

test('melee line of sight preserves full walls, barricades and crouched low-cover shelter', () => {
  for (const fixture of [
    { player: { x: -1, y: 0, z: -1.6 }, zombie: { x: -1, z: -2.4 } },
    { player: { x: .5, y: 0, z: 3.6, crouched: true }, zombie: { x: 1.3, z: 3.6 } },
    { player: { x: 0, y: 0, z: -5.6 }, zombie: { x: 0, z: -6.4 } },
  ]) {
    const { simulation, player } = setup(fixture.player);
    const zombie = foe(simulation, { ...fixture.zombie, speed: 0, barricadeDamage: 0 });
    for (let tick = 0; tick < 30; tick++) { simulation.time += 1 / 30; simulation.updateZombie(zombie, 1 / 30, [player]); }
    assert.equal(player.hp, 100, JSON.stringify(fixture));
  }
});
