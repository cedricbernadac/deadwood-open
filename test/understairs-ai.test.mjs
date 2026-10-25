import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation } from '../simulation.mjs';
import { enemyProfile } from '../public/enemies.js';
import { stairCeiling, stairTreadY } from '../public/stairs.js';

function fixture(kind = 'walker', side = -1, targetZ = -.6) {
  const simulation = new RoomSimulation('UNDERAI', { random: () => .5 });
  const player = simulation.addPlayer('a'); simulation.start('a');
  simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 1000;
  Object.assign(player, { x: 3.8, y: 0, z: targetZ, hp: 10000, crouched: targetZ > 0 });
  const zombie = simulation.spawnZombie();
  Object.assign(zombie, { x: side < 0 ? 2.3 : 5.5, y: 0, z: targetZ, speed: 2,
    kind: kind === 'boss' ? 'brute' : kind, boss: kind === 'boss',
    scale: kind === 'boss' ? 1.32 : kind === 'brute' ? 1.22 : 1,
    entered: true, entryTarget: null, attackAfter: 0, damage: 11 });
  return { simulation, player, zombie };
}

function assertGroundBody(simulation, zombie) {
  const radius = .29 * zombie.scale, height = enemyProfile(zombie).height * zombie.scale;
  assert.equal(zombie.y, 0, 'An overhead stair cannot attract ground-floor feet');
  assert.equal(simulation.canOccupy(zombie,zombie.x,zombie.z,0,radius), true);
  assert.ok(height <= stairCeiling(zombie.x,zombie.z,0,radius) + 1e-6, 'The whole profile clears treads and stringers');
}

test('the collision API rejects low stair intersections but permits bodies supported on real treads', () => {
  const { simulation, player, zombie } = fixture();
  for (const crouched of [false,true]) {
    player.crouched = crouched;
    assert.equal(simulation.canOccupy(player,3.8,1.3,0,.25), false);
  }
  for (const [kind,scale,z,expected] of [['walker',1,-.6,true],['walker',1,.45,false],['crawler',1,.45,true],['brute',1.22,-.6,false]]) {
    Object.assign(zombie,{kind,scale});
    assert.equal(simulation.canOccupy(zombie,3.8,z,0,.29*scale),expected);
  }
  Object.assign(zombie,{kind:'walker',scale:1});
  assert.equal(simulation.canOccupy(zombie,3.8,1.3,stairTreadY(1.3),.29),true);
});

test('walkers and crawlers traverse high underpasses from either side while their feet stay downstairs', () => {
  for (const [kind,z] of [['walker',-.6],['crawler',-.6],['crawler',.45]]) for (const side of [-1,1]) {
    const { simulation, player, zombie } = fixture(kind,side,z);
    player.alive = false;
    const destination = { x: side < 0 ? 5.5 : 2.3, z };
    for (let tick=0;tick<150 && Math.hypot(zombie.x-destination.x,zombie.z-z)>=.08;tick++) {
      simulation.time += 1/30;
      simulation.moveZombieTowards(zombie,destination,1/30);
      assertGroundBody(simulation,zombie);
    }
    assert.ok(Math.hypot(zombie.x-destination.x,zombie.z-z)<.08, `${kind}, side ${side}`);
  }
});

test('real walkers and crawlers attack survivors beneath the stairs from both sides', () => {
  for (const kind of ['walker','crawler']) for (const side of [-1,1]) for (const z of [-.6,.45]) {
    const { simulation, player, zombie } = fixture(kind,side,z);
    for (let tick=0;tick<240 && player.hp===10000;tick++) {
      simulation.time += 1/30;
      simulation.updateZombie(zombie,1/30,[player]);
      assertGroundBody(simulation,zombie);
    }
    assert.ok(player.hp<10000, `${kind}, side ${side}, target z${z}`);
    assert.equal(player.y,0);
    if (kind==='walker' && z>0) assert.ok(zombie.z<0, 'A tall walker approaches the crouched survivor from the high side');
  }
});

test('brutes and the final boss approach to melee reach without squeezing below an insufficient ceiling', () => {
  for (const kind of ['brute','boss']) for (const side of [-1,1]) {
    const { simulation, player, zombie } = fixture(kind,side);
    for (let tick=0;tick<360 && player.hp===10000;tick++) {
      simulation.time += 1/30;
      simulation.updateZombie(zombie,1/30,[player]);
      assertGroundBody(simulation,zombie);
    }
    assert.ok(player.hp<10000, `${kind}, side ${side}`);
    // A bigger body reaches as far beyond itself as a walker does (meleeReach).
    assert.ok(Math.hypot(zombie.x-player.x,zombie.z-player.z)<.92+Math.max(0,.29*(zombie.scale??1)-.29));
    assert.ok(zombie.z<-.6, 'Tall bodies remain in the higher part of the underpass');
  }
});
