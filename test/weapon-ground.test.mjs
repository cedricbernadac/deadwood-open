import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomSimulation, WEAPONS, WORLD } from '../simulation.mjs';
import { ARMORY, EXTERIOR, GROUND_WEAPONS, GROUND_WEAPON_BOUNDS, PICKUPS, MAX_WAVES } from '../public/rules.js';
import { STAIRS, stairTreadY } from '../public/stairs.js';
import { completeRevive } from './helpers/revive.mjs';
import { weaponEntries, activeWeaponId, weaponStock } from '../public/weapon-inventory.js';

function room() {
  const events = [];
  const simulation = new RoomSimulation('GROUND', { random: () => .5, onEvent: event => events.push(event) });
  const player = simulation.addPlayer('a');
  const teammate = simulation.addPlayer('b');
  simulation.start('a');
  Object.assign(simulation, { phase: 'wave', wave: 12, toSpawn: 1, spawnTimer: 999 });
  Object.assign(player, { x: 0, y: 0, z: 2, yaw: 0, pitch: 0 });
  Object.assign(teammate, { x: 1.7, y: 0, z: 2 });
  return { simulation, player, teammate, events };
}

function advance(simulation) { simulation.time += 1; }
function weaponsOnGround(simulation) { return [...simulation.pickups.values()].filter(pickup => pickup.kind === 'weapon'); }
function totalStock(simulation, weapon) {
  return [...simulation.players.values()].reduce((sum, player) => sum + weaponEntries(player).filter(entry => entry.weapon === weapon).reduce((n, entry) => n + entry.stock.ammo + entry.stock.reserve, 0), 0)
    + weaponsOnGround(simulation).filter(pickup => pickup.weapon === weapon).reduce((sum, pickup) => sum + pickup.ammo + pickup.reserve, 0);
}

test('dropping preserves exact stock, selects the remaining gun and cannot be collected automatically', () => {
  const { simulation, player, events } = room();
  Object.assign(player, { weapon: 'rifle', inventory: { pistol: { ammo: 8, reserve: 9 }, rifle: { ammo: 7, reserve: 31 } }, reloadUntil: simulation.time + 10 });
  assert.equal(simulation.dropWeapon(player.id), true);
  const [pickup] = weaponsOnGround(simulation);
  assert.equal(pickup.weapon, 'rifle');
  assert.equal(pickup.ammo, 7);
  assert.equal(pickup.reserve, 31);
  assert.equal(pickup.expiresAt, Infinity);
  assert.equal(pickup.y, 0);
  assert.equal(pickup.z, player.z - GROUND_WEAPONS.dropDistance);
  assert.equal(player.weapon, 'pistol');
  assert.equal(player.reloadUntil, 0);
  assert.equal(player.inventory.rifle, undefined);
  assert.equal(simulation.dropWeapon(player.id), false, 'Drop spam is rate limited');
  simulation.collectPickups();
  assert.equal(weaponsOnGround(simulation).length, 1, 'Only an explicit interaction transfers a gun');
  assert.deepEqual(events.at(-1), { type: 'event', event: 'weapon-drop', eventId: events.at(-1).eventId,
    time: simulation.time, id: player.id, pickupId: pickup.id, weapon: 'rifle', ammo: 7, reserve: 31 });
});

test('the last gun may be dropped: unarmed movement, shooting, reloading, ticking and snapshots stay safe', () => {
  const { simulation, player } = room();
  assert.equal(simulation.dropWeapon(player.id), true);
  assert.equal(player.weapon, null);
  assert.deepEqual(player.inventory, {});
  assert.equal(simulation.reload(player.id), false);
  assert.equal(simulation.shoot(player.id), false);
  assert.equal(simulation.setMinigunSpin(player.id, true), false);
  const beforeX = player.x;
  simulation.setInput(player.id, { forward: 0, strafe: 1, yaw: 0, pitch: 0 });
  simulation.tick(.1);
  assert.ok(player.x > beforeX);
  const state = simulation.snapshot().players.find(value => value.id === player.id);
  assert.equal(state.weapon, null);
  assert.equal(state.ammo, 0);
  assert.equal(state.reserve, 0);
  assert.equal(state.magazine, 0);
  assert.deepEqual(state.weapons, []);
  player.reloadUntil = simulation.time + .01;
  simulation.tick(.1);
  assert.equal(player.reloadUntil, 0, 'An obsolete reload completion cannot restore a dropped weapon or crash');
  advance(simulation);
  const pickup = weaponsOnGround(simulation)[0];
  assert.equal(simulation.takeGroundWeapon(player.id, pickup.id), true);
  assert.equal(player.weapon, 'pistol');
  assert.deepEqual(player.inventory.pistol, { ammo: 12, reserve: 36 });
});

test('two survivors can transfer a depleted gun once without duplicating ammunition', () => {
  const { simulation, player, teammate } = room();
  player.inventory.rifle = { ammo: 2, reserve: 3 }; player.weapon = 'rifle';
  const before = totalStock(simulation, 'rifle');
  assert.equal(simulation.dropWeapon(player.id), true);
  const pickup = weaponsOnGround(simulation)[0];
  Object.assign(teammate, { x: pickup.x + .25, y: pickup.y, z: pickup.z });
  assert.equal(simulation.takeGroundWeapon(teammate.id, pickup.id), true);
  assert.equal(simulation.takeGroundWeapon(player.id, pickup.id), false);
  assert.equal(simulation.takeGroundWeapon(teammate.id, pickup.id), false);
  assert.deepEqual(teammate.inventory.rifle, { ammo: 2, reserve: 3 });
  assert.equal(totalStock(simulation, 'rifle'), before);
  assert.equal(teammate.issuedWeapons.has('rifle'), true);
  assert.equal(player.issuedWeapons.has('rifle'), true);
});

test('a full inventory exchanges its active slot atomically and leaves that exact gun on the ground', () => {
  const { simulation, player, teammate, events } = room();
  Object.assign(player, { weapon: 'rifle', inventory: { rifle: { ammo: 1, reserve: 4 }, pistol: { ammo: 3, reserve: 2 } } });
  Object.assign(teammate, { weapon: 'shotgun', inventory: { shotgun: { ammo: 5, reserve: 9 } } });
  Object.assign(teammate, { x: .2, z: 2 });
  const before = Object.fromEntries(['rifle', 'pistol', 'shotgun'].map(weapon => [weapon, totalStock(simulation, weapon)]));
  simulation.dropWeapon(teammate.id);
  const pickup = weaponsOnGround(simulation)[0];
  assert.equal(simulation.takeGroundWeapon(player.id, pickup.id), true);
  assert.deepEqual(Object.keys(player.inventory), ['shotgun', 'pistol']);
  assert.equal(player.weapon, 'shotgun');
  assert.deepEqual(player.inventory.shotgun, { ammo: 5, reserve: 9 });
  const [abandoned] = weaponsOnGround(simulation);
  assert.equal(abandoned.weapon, 'rifle');
  assert.equal(abandoned.ammo, 1);
  assert.equal(abandoned.reserve, 4);
  assert.equal(simulation.canCollectPickup(player, abandoned), true, 'The exchanged gun finds its own legal nearby placement');
  assert.ok(Math.hypot(abandoned.x - player.x, abandoned.z - player.z) <= PICKUPS.reach);
  for (const weapon of Object.keys(before)) assert.equal(totalStock(simulation, weapon), before[weapon], weapon);
  assert.equal(events.at(-1).replacedWeapon, 'rifle');
});

test('a second copy is collected into its own slot without combining or topping up stocks', () => {
  const { simulation, player, teammate } = room();
  player.inventory.pistol = { ammo: 1, reserve: 0 };
  Object.assign(teammate, { x: .2, z: 2 });
  assert.equal(simulation.dropWeapon(teammate.id), true);
  const pickup = weaponsOnGround(simulation)[0], total = totalStock(simulation,'pistol');
  assert.equal(simulation.interact(player.id), true);
  const entries=weaponEntries(player);
  assert.equal(entries.length,2);
  assert.deepEqual(entries.map(e=>e.weapon),['pistol','pistol']);
  assert.deepEqual(entries.map(e=>e.stock),[{ammo:1,reserve:0},{ammo:12,reserve:36}]);
  assert.notEqual(entries[0].id,entries[1].id);
  assert.notEqual(entries[0].stock,entries[1].stock);
  assert.equal(activeWeaponId(player),entries[1].id);
  assert.equal(simulation.pickups.has(pickup.id),false);
  assert.equal(totalStock(simulation,'pistol'),total);
});

test('a ground gun persists without refill through server time and wave resupply, and clears at terminal/reset phases', () => {
  for (const terminal of ['gameover', 'restart', 'extraction']) {
    const { simulation, player } = room();
    player.inventory.pistol = { ammo: 1, reserve: 2 };
    simulation.dropWeapon(player.id);
    const pickup = weaponsOnGround(simulation)[0];
    simulation.time += PICKUPS.lifetime * 2;
    simulation.collectPickups();
    simulation.finishWave();
    assert.equal(simulation.pickups.get(pickup.id), pickup);
    assert.equal(pickup.ammo, 1);
    assert.equal(pickup.reserve, 2);
    assert.deepEqual(player.inventory, {}, 'Resupply never creates a gun for an unarmed survivor');
    const snapshot = simulation.snapshot().pickups.find(value => value.id === pickup.id);
    assert.equal(snapshot.expiresIn, null);
    assert.equal(snapshot.ammo, 1);
    assert.equal(snapshot.reserve, 2);
    if (terminal === 'gameover') simulation.endGame();
    if (terminal === 'restart') { simulation.endGame(); simulation.start(player.id); }
    if (terminal === 'extraction') {
      simulation.phase = 'wave'; simulation.wave = MAX_WAVES; simulation.toSpawn = 0; simulation.zombies.clear();
      assert.equal(simulation.beginExtraction(), true);
    }
    assert.equal(weaponsOnGround(simulation).length, 0, terminal);
  }
});

test('dropping a spinning minigun cancels the motor and all pending reload transfer', () => {
  const { simulation, player, events } = room();
  Object.assign(player, { weapon: 'minigun', inventory: { minigun: { ammo: 2, reserve: 7 } }, minigunSpinning: true, minigunSpinUntil: simulation.time + 1, reloadUntil: simulation.time + .1 });
  assert.equal(simulation.dropWeapon(player.id), true);
  assert.equal(player.minigunSpinning, false);
  assert.equal(player.minigunSpinUntil, 0);
  assert.equal(player.reloadUntil, 0);
  simulation.tick(.1);
  assert.equal(weaponsOnGround(simulation)[0].ammo, 2);
  assert.equal(weaponsOnGround(simulation)[0].reserve, 7);
  assert.equal(events.some(event => event.event === 'minigun-spin' && event.spinning === false), true);
});

test('frozen phases, lobby, downed and dead states reject deposits and pickup transfers', () => {
  for (const phase of ['lobby', 'extraction', 'victory', 'gameover']) {
    const { simulation, player, teammate } = room();
    Object.assign(teammate, { x: .2, z: 2 });
    simulation.dropWeapon(teammate.id);
    const pickup = weaponsOnGround(simulation)[0];
    simulation.phase = phase;
    assert.equal(simulation.dropWeapon(player.id), false, phase);
    assert.equal(simulation.takeGroundWeapon(player.id, pickup.id), false, phase);
    assert.equal(simulation.nearbyGroundWeapon(player), null, phase);
    assert.equal(simulation.interact(player.id), false, phase);
  }
  for (const state of [{ downed: true }, { alive: false }]) {
    const { simulation, player, teammate } = room();
    Object.assign(teammate, { x: .2, z: 2 });
    simulation.dropWeapon(teammate.id);
    const pickup = weaponsOnGround(simulation)[0];
    Object.assign(player, state);
    assert.equal(simulation.dropWeapon(player.id), false);
    assert.equal(simulation.takeGroundWeapon(player.id, pickup.id), false);
  }
});

test('ground guns obey floor, wall, furniture, barricade and ordinary reach checks', () => {
  for (const scenario of ['floor', 'wall', 'boards', 'furniture', 'distant']) {
    const { simulation, player } = room();
    const pickup = { id: 'ground-fixture', kind: 'weapon', weapon: 'rifle', ammo: 1, reserve: 2, x: 0, y: 0, z: 2, expiresAt: Infinity };
    if (scenario === 'floor') pickup.y = WORLD.loftY;
    if (scenario === 'wall') { Object.assign(player, { x: 2, z: -5.5 }); Object.assign(pickup, { x: 2, z: -6.5 }); }
    if (scenario === 'boards') { Object.assign(player, { x: 0, z: -5.5 }); Object.assign(pickup, { x: 0, z: -6.5 }); }
    if (scenario === 'furniture') { Object.assign(player, { x: -6.5, z: 2.8 }); Object.assign(pickup, { x: -5.5, z: 2.8 }); }
    if (scenario === 'distant') pickup.x = PICKUPS.reach + .01;
    simulation.pickups.set(pickup.id, pickup);
    assert.equal(simulation.nearbyGroundWeapon(player), null, scenario);
    assert.equal(simulation.takeGroundWeapon(player.id, pickup.id), false, scenario);
    assert.equal(simulation.pickups.has(pickup.id), true, scenario);
  }
});

test('dropping finds a real ground, loft or tread surface without crossing walls or boards', () => {
  for (const [position, expectedY] of [
    [{ x: 0, y: 0, z: 2 }, 0],
    [{ x: 5.4, y: 3.4, z: 0 }, 3.4],
    [{ x: 3.8, y: stairTreadY(.5), z: .5 }, null],
    [{ x: 3.8, y: 0, z: -1.1 }, 0],
    [{ x: 2, y: 0, z: -5.55 }, 0],
    [{ x: 0, y: 0, z: -5.55 }, 0],
    [{ x: EXTERIOR.bounds.minX + .25, y: 0, z: 3, yaw: Math.PI / 2 }, 0],
  ]) {
    const { simulation, player } = room();
    Object.assign(player, position);
    assert.equal(simulation.dropWeapon(player.id), true, JSON.stringify(position));
    const [pickup] = weaponsOnGround(simulation);
    assert.equal(pickup.y, expectedY ?? stairTreadY(pickup.z), JSON.stringify(position));
    assert.equal(simulation.canCollectPickup(player, pickup), true, 'The dropped item is reachable from its donor');
    assert.ok(Math.hypot(player.x - pickup.x, player.z - pickup.z) <= GROUND_WEAPONS.dropDistance + 1e-8);
    if (position.z === -5.55) assert.ok(pickup.z > -6 + .135, 'Blocked doorway/wall makes the gun stay on the near side');
  }
});

test('a mid-air deposit lands on the actual floor rather than floating at the previous feet height', () => {
  const { simulation, player } = room();
  Object.assign(player, { y: .8, grounded: false, vy: -2 });
  assert.equal(simulation.dropWeapon(player.id), true);
  assert.equal(weaponsOnGround(simulation)[0].y, 0);
});

test('reviving takes precedence over a weapon, while a nearby ground gun takes precedence over a crate', () => {
  const { simulation, player, teammate } = room();
  const crate = ARMORY.find(item => item.weapon === 'rifle');
  simulation.wave = crate.unlockWave;
  Object.assign(teammate, { x: .2, z: 2, downed: true, hp: 0 });
  const pickup = { id: 'near-gun', kind: 'weapon', weapon: 'rifle', ammo: 3, reserve: 7, x: .2, y: 0, z: 1.7, expiresAt: Infinity };
  simulation.pickups.set(pickup.id, pickup);
  assert.equal(completeRevive(simulation, player.id), true);
  assert.equal(teammate.downed, false);
  assert.equal(simulation.pickups.has(pickup.id), true);
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.5, z: crate.z + Math.cos(crate.facing) * 1.5, points: 10000 });
  Object.assign(teammate, { x: 0, z: 2 });
  Object.assign(pickup, { x: player.x, z: player.z - .2 });
  advance(simulation);
  assert.equal(simulation.interact(player.id), true);
  assert.deepEqual(player.inventory.rifle, { ammo: 3, reserve: 7 });
  assert.equal(player.points, 10000, 'A gun transfer does not buy the adjacent crate');
});

test('receiving and depositing a gun cannot unlock a fresh same-wave purchase or restore its rounds', () => {
  const { simulation, player, teammate } = room();
  const crate = ARMORY.find(item => item.weapon === 'rifle');
  simulation.wave = crate.unlockWave;
  Object.assign(teammate, { x: .2, z: 2, weapon: 'rifle', inventory: { rifle: { ammo: 0, reserve: 1 } } });
  simulation.dropWeapon(teammate.id);
  const first = weaponsOnGround(simulation)[0];
  assert.equal(simulation.takeGroundWeapon(player.id, first.id), true);
  advance(simulation);
  assert.equal(simulation.dropWeapon(player.id), true);
  advance(simulation);
  Object.assign(player, { x: crate.x + Math.sin(crate.facing) * 1.5, z: crate.z + Math.cos(crate.facing) * 1.5, points: 10000 });
  assert.equal(simulation.buyWeapon(player.id, crate.id), false);
  assert.equal(player.points, 10000);
  const remaining = weaponsOnGround(simulation)[0];
  assert.equal(remaining.ammo, 0);
  assert.equal(remaining.reserve, 1);
  assert.equal(totalStock(simulation, 'rifle'), 1);
  assert.equal(simulation.chooseWeapon(player.id, 'rifle'), false);
});

test('all valid physical stair steps can retain a deposited gun near its donor', () => {
  for (let step = 1; step < STAIRS.steps - 1; step++) {
    const { simulation, player } = room();
    const z = STAIRS.maxZ - (step + .5) * (STAIRS.maxZ - STAIRS.minZ) / STAIRS.steps;
    Object.assign(player, { x: 3.8, y: stairTreadY(z), z });
    assert.equal(simulation.dropWeapon(player.id), true, `step ${step}`);
    const [pickup] = weaponsOnGround(simulation);
    assert.equal(pickup.y, stairTreadY(pickup.z), `step ${step}`);
    assert.equal(simulation.canCollectPickup(player, pickup), true, `step ${step}`);
  }
});

test('a gun can be deposited beside tread lips across the full width and every view direction', () => {
  let examined = 0;
  for (const x of [3, 3.05, 3.8, 4.55, 4.6]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (let z = -1.8; z < 2.45; z += .08) {
      const { simulation, player } = room();
      Object.assign(player, { x, y: stairTreadY(z), z, yaw });
      if (!simulation.canOccupy(player, x, z, player.y, .25)) continue;
      assert.equal(simulation.dropWeapon(player.id), true, `x ${x}, z ${z}, yaw ${yaw}`);
      const [pickup] = weaponsOnGround(simulation);
      assert.equal(simulation.canCollectPickup(player, pickup), true);
      assert.ok(Math.hypot(player.x - pickup.x, player.z - pickup.z) <= GROUND_WEAPONS.dropDistance + .2);
      examined++;
    }
  }
  assert.ok(examined > 1000);
});

function posedPoint(pose, localX, localY, localZ) {
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
  const y = cp * localY - sp * localZ, z = sp * localY + cp * localZ;
  return { x: pose.x + c * localX + s * z, y: pose.y + pose.modelLift + y, z: pose.z - s * localX + c * z };
}

test('the complete gun envelope stays inside the walls near every cabin corner for all six weapons', () => {
  for (const weapon of Object.keys(GROUND_WEAPON_BOUNDS)) {
    const profile = GROUND_WEAPON_BOUNDS[weapon];
    for (const x of [-7.34, 7.34]) for (const z of [-5.59, 5.59]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const { simulation, player, teammate } = room();
      teammate.inventory = {}; teammate.weapon = null;
      Object.assign(player, { x, y: 0, z, yaw, weapon, inventory: { [weapon]: { ammo: 1, reserve: 2 } } });
      assert.equal(simulation.canOccupy(player, x, z, 0, .25), true);
      assert.equal(simulation.dropWeapon(player.id), true, `${weapon}, ${x},${z},yaw ${yaw}`);
      const pose = weaponsOnGround(simulation)[0];
      for (const localX of [-profile.halfWidth, profile.halfWidth]) for (const localY of [profile.floorOffset, profile.floorOffset + profile.height]) for (const localZ of [-profile.halfLength, profile.halfLength]) {
        const point = posedPoint(pose, localX, localY, localZ);
        assert.ok(point.x >= -7.865 - 1e-6 && point.x <= 7.865 + 1e-6, 'No rendered barrel or grip enters the east/west wall');
        assert.ok(point.z >= -5.865 - 1e-6 && point.z <= 5.865 + 1e-6, 'No rendered barrel or grip enters the north/south wall');
        assert.ok(point.y >= 0);
      }
      assert.equal(totalStock(simulation, weapon), 3);
    }
  }
});

test('all six full-size guns rest above the real stair risers with an authoritative inclined pose', () => {
  for (const weapon of Object.keys(GROUND_WEAPON_BOUNDS)) for (const x of [3, 3.8, 4.6]) for (const z of [-1.6, -.9, 0, .8, 1.6, 2.2]) {
    const { simulation, player, teammate } = room();
    teammate.inventory = {}; teammate.weapon = null;
    Object.assign(player, { x, y: stairTreadY(z), z, weapon, inventory: { [weapon]: { ammo: 1, reserve: 2 } } });
    const profile = GROUND_WEAPON_BOUNDS[weapon];
    assert.equal(simulation.dropWeapon(player.id), true, `${weapon}, ${x},${z}`);
    const pose = weaponsOnGround(simulation)[0];
    assert.equal(simulation.canCollectPickup(player, pose), true);
    if (pose.pitch === 0) continue; // The top/bottom landing may be the nearer legal support.
    assert.ok(Math.abs(pose.pitch - Math.atan2(STAIRS.topY, STAIRS.maxZ - STAIRS.minZ)) < 1e-9);
    for (const localX of [-profile.halfWidth, profile.halfWidth]) for (let sample = 0; sample <= 40; sample++) {
      const localZ = -profile.halfLength + sample / 40 * profile.halfLength * 2;
      const point = posedPoint(pose, localX, profile.floorOffset, localZ);
      if (point.x >= STAIRS.minX && point.x <= STAIRS.maxX && point.z >= STAIRS.minZ && point.z <= STAIRS.maxZ) {
        assert.ok(point.y >= stairTreadY(point.z) - 1e-5, `${weapon}: the inclined underside clears the actual intermediate risers`);
      }
      assert.ok(point.y >= -1e-6);
    }
    const visiblePose = simulation.snapshot().pickups.find(pickup => pickup.id === pose.id);
    assert.equal(visiblePose.yaw, pose.yaw);
    assert.equal(visiblePose.pitch, pose.pitch);
    assert.equal(visiblePose.modelLift, pose.modelLift);
    assert.equal(totalStock(simulation, weapon), 3);
  }
});

test('an unavailable supporting space reports why without losing stock or partially exchanging weapons', () => {
  for (const action of ['drop', 'exchange']) {
    const { simulation, player, events } = room();
    Object.assign(player, { weapon: 'rifle', reloadUntil: simulation.time + 10,
      inventory: { rifle: { ammo: 2, reserve: 7 }, pistol: { ammo: 4, reserve: 8 } } });
    const pickup = { id: 'space-fixture', kind: 'weapon', weapon: 'shotgun', ammo: 3, reserve: 9,
      x: player.x, y: player.y, z: player.z - .3, expiresAt: Infinity };
    simulation.pickups.set(pickup.id, pickup);
    const inventory = structuredClone(player.inventory), reloading = player.reloadUntil;
    // Inject the explicit "no legal support" solver result to verify the
    // transaction boundary independently of any particular cabin arrangement.
    simulation.groundWeaponPosition = () => null;
    assert.equal(action === 'drop' ? simulation.dropWeapon(player.id) : simulation.takeGroundWeapon(player.id, pickup.id), false);
    assert.deepEqual(player.inventory, inventory);
    assert.equal(player.weapon, 'rifle');
    assert.equal(player.reloadUntil, reloading);
    assert.equal(simulation.pickups.get(pickup.id), pickup);
    assert.equal(weaponsOnGround(simulation).length, 1);
    assert.equal(events.at(-1).event, action === 'drop' ? 'weapon-drop-denied' : 'weapon-pickup-denied');
    assert.equal(events.at(-1).reason, 'space');
    assert.ok(player.interactAfter > simulation.time);
  }
});


test('V can drop both purchased guns and each can be recovered despite the issued history',()=>{
  const {simulation,player}=room();
  player.inventory={smg:{ammo:7,reserve:23},rifle:{ammo:4,reserve:11}};player.weapon='smg';player.issuedWeapons=new Set(['smg','rifle']);
  assert.equal(simulation.dropWeapon(player.id),true);advance(simulation);
  assert.equal(simulation.dropWeapon(player.id),true);advance(simulation);
  assert.equal(player.weapon,null);assert.deepEqual(player.inventory,{});
  const pickups=weaponsOnGround(simulation);
  for(const pickup of pickups){assert.equal(simulation.takeGroundWeapon(player.id,pickup.id),true);advance(simulation);}
  assert.deepEqual(player.inventory,{smg:{ammo:7,reserve:23},rifle:{ammo:4,reserve:11}});
  assert.equal(weaponsOnGround(simulation).length,0);
});

function duplicateSMG(){
  const f=room(),{simulation,player,teammate}=f;
  player.inventory={smg:{ammo:5,reserve:9}};player.weapon='smg';
  teammate.inventory={smg:{ammo:3,reserve:11}};teammate.weapon='smg';Object.assign(teammate,{x:.2,z:2});
  assert.equal(simulation.dropWeapon(teammate.id),true);
  assert.equal(simulation.takeGroundWeapon(player.id,weaponsOnGround(simulation)[0].id),true);
  return {...f,second:activeWeaponId(player)};
}

test('two identical guns shoot and reload only their selected stock, including switching mid-reload',()=>{
  const {simulation,player,second}=duplicateSMG();
  advance(simulation);assert.equal(simulation.shoot(player.id),true);
  assert.deepEqual(player.inventory.smg,{ammo:5,reserve:9});
  assert.deepEqual(player.inventory[second],{ammo:2,reserve:11});
  assert.equal(simulation.reload(player.id),true);
  assert.equal(simulation.chooseWeapon(player.id,'smg'),true);
  assert.equal(player.reloadUntil,0,'switching copies cancels the old reload');
  simulation.tick(.1);assert.deepEqual(player.inventory[second],{ammo:2,reserve:11});
  assert.equal(simulation.reload(player.id),true);simulation.time=player.reloadUntil;simulation.tick(.01);
  assert.deepEqual(player.inventory.smg,{ammo:14,reserve:0});
  assert.deepEqual(player.inventory[second],{ammo:2,reserve:11});
  const state=simulation.snapshot().players.find(p=>p.id===player.id);
  assert.equal(state.weaponId,'smg');assert.equal(state.ammo,14);
  assert.equal(state.weapons.filter(w=>w.equipped).length,1);
});

test('dropping and recovering both identical copies preserves every round',()=>{
  const {simulation,player}=duplicateSMG(),total=totalStock(simulation,'smg');
  advance(simulation);assert.equal(simulation.dropWeapon(player.id),true);
  advance(simulation);assert.equal(simulation.dropWeapon(player.id),true);
  advance(simulation);assert.equal(weaponEntries(player).length,0);
  for(const pickup of weaponsOnGround(simulation)){assert.equal(simulation.takeGroundWeapon(player.id,pickup.id),true);advance(simulation);}
  assert.equal(weaponEntries(player).length,2);
  assert.equal(totalStock(simulation,'smg'),total);
  assert.deepEqual(weaponEntries(player).map(e=>e.stock).sort((a,b)=>a.ammo-b.ammo),[{ammo:3,reserve:11},{ammo:5,reserve:9}]);
});

test('a full same-type exchange replaces only the selected copy and preserves slot order and ammunition',()=>{
  const {simulation,player,second}=duplicateSMG();
  const point=simulation.groundWeaponPosition(player,'smg');
  simulation.pickups.set('third-copy',{id:'third-copy',kind:'weapon',weapon:'smg',...point,ammo:1,reserve:2,expiresAt:Infinity});
  const total=totalStock(simulation,'smg');advance(simulation);
  assert.equal(simulation.takeGroundWeapon(player.id,'third-copy'),true);
  const entries=weaponEntries(player);
  assert.equal(entries.length,2);assert.equal(entries[0].id,'smg');
  assert.notEqual(entries[1].id,second);assert.equal(activeWeaponId(player),entries[1].id);
  assert.deepEqual(entries.map(e=>e.stock),[{ammo:5,reserve:9},{ammo:1,reserve:2}]);
  assert.deepEqual(weaponsOnGround(simulation).map(p=>[p.ammo,p.reserve]),[[3,11]]);
  assert.equal(totalStock(simulation,'smg'),total);
  const before=JSON.stringify(player.inventory);
  assert.equal(simulation.chooseWeapon(player.id,'smg#999'),false);
  assert.equal(JSON.stringify(player.inventory),before);
});

test('wave resupply and extended bonuses preserve copy ids and refill both independently',()=>{
  const {simulation,player,second}=duplicateSMG();player.bonus={extended:2,reinforced:2};
  simulation.finishWave();
  assert.deepEqual(Object.keys(player.inventory),['smg',second]);assert.equal(activeWeaponId(player),second);
  for(const stock of Object.values(player.inventory))assert.deepEqual(stock,{ammo:48,reserve:144});
  assert.equal(simulation.bonusFitsWeapons(player,'reinforced'),true);
  assert.equal(simulation.bonusFitsWeapons(player,'extended'),true);
  assert.notEqual(player.inventory.smg,player.inventory[second]);
});

test('a raider steals the selected duplicate, leaving the other stock and its valid type',()=>{
  const {simulation,player,second}=duplicateSMG();
  simulation.robPlayer(player);
  assert.equal(player.inventory[second],undefined);
  assert.deepEqual(player.inventory.smg,{ammo:5,reserve:9});
  assert.equal(player.weapon,'smg');assert.equal(activeWeaponId(player),'smg');
});
