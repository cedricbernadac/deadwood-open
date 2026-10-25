import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RoomSimulation, WEAPONS, damageFalloff } from '../simulation.mjs';
import { Vector3, Ray, Box3 } from 'three';
import { penetrationMultiplier } from '../public/ballistics.js';
import { enemyHitbox } from '../public/enemies.js';
import { scenarioGeometry, scenarioRandom, scenarioReport, scenarioShot, scenarioTiming, scenarioActiveTiming } from '../public/weapon-scenarios.js';

const close = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} != ${b}`);
const body = (id, x, z, extra = {}) => ({ id, x, y: 0, z, kind: 'walker', scale: 1, ...extra });

test('sustained cycles include reload and renewed Gatling spin, without counting the last firing interval twice', () => {
  close(scenarioTiming(WEAPONS.rifle).cycleTime, 29 * .09 + 1.65);
  close(scenarioTiming(WEAPONS.shotgun).cycleTime, 7 * .85 + 2.4);
  const gatling = scenarioTiming(WEAPONS.minigun, { id: 'minigun' });
  close(gatling.cycleTime, 74 * .055 + 3.4 + 1);
  close(gatling.shotsPerSecond, 75 / 8.47);
  assert.equal(gatling.firstDamageAt, 1); assert.equal(gatling.preparationTime, 1);
  close(scenarioTiming({ magazine: 1, interval: .25, reloadTime: .1 }).cycleTime, .25);
  for (const mode of ['light', 'heavy']) {
    const timing = scenarioTiming(WEAPONS.katana, { mode });
    close(timing.cycleTime, WEAPONS.katana.attacks[mode].duration);
    close(timing.firstDamageAt, WEAPONS.katana.attacks[mode].windup);
    assert.equal(timing.ammoPerSecond, 0);
  }
});

test('packing is finite only beyond influence, physically non-overlapping, and distance zero touches player skin', () => {
  for (const seed of [17, 31, 71]) for (const distance of [0, 4, 12]) {
    const geometry = scenarioGeometry(distance, { seed, radius: distance + 4 });
    close(-geometry.targets[0].z - .32, distance + .25);
    close(geometry.firstBodyDistance, distance + .25);
    assert.ok(geometry.targets.some(target => target.x > 0) && geometry.targets.some(target => target.x < 0));
    assert.ok(geometry.targets.some(target => target.z > 0), 'surrounding field includes bodies behind the survivor');
    for (const [index, a] of geometry.targets.entries()) {
      const box = enemyHitbox(a);
      const horizontal = Math.hypot(Math.max(box.minX, 0, -box.maxX), Math.max(box.minZ, 0, -box.maxZ));
      assert.ok(horizontal >= distance + .25 - 1e-8, 'no body intrudes into player or the requested empty gap');
      for (const b of geometry.targets.slice(index + 1)) {
        assert.ok(Math.abs(a.x - b.x) >= .64 - 1e-8 || Math.abs(a.z - b.z) >= .64 - 1e-8, 'actual AABBs must not overlap');
      }
    }
  }
});

test('body rays respect penetration retention, real travelled falloff and finite range', () => {
  const targets = [body('a', 0, -3), body('b', 0, -10), body('c', 0, -30), body('d', 0, -40)];
  const result = scenarioShot(WEAPONS.rifle, { targets });
  const expected = [2.68, 9.68, 29.68].reduce((sum, d, i) => sum + WEAPONS.rifle.damage * damageFalloff(WEAPONS.rifle, d) * .65 ** i, 0);
  close(result.damage, expected); assert.equal(result.targetsHit, 3); assert.equal(result.intersections, 3);
  assert.deepEqual(result.targetIds, ['a', 'b', 'c']);
  assert.equal(scenarioShot(WEAPONS.pistol, { targets: [body('far', 0, -WEAPONS.pistol.range - 1)] }).damage, 0);
  const manyPellets = scenarioShot(WEAPONS.shotgun, { targets: [body('a', 0, -1), body('b', 0, -2)] });
  assert.equal(manyPellets.intersections, 18); assert.equal(manyPellets.targetsHit, 2);
});


// Independent geometric oracle for the chart's documented straight-ray
// approximation: Three.js intersects actual emitted projectile directions.
// Gameplay still advances curved projectiles; no production flag is disabled.
function straightShotOracle(weapon, projectiles, targets) {
  let damage=0, intersections=0;
  for(const p of projectiles) {
    const ray=new Ray(new Vector3(p.x,p.y,p.z),new Vector3(p.vx,p.vy,p.vz).normalize());
    const hits=targets.map(target=>{
      const box=enemyHitbox(target), hit=ray.intersectBox(new Box3(new Vector3(box.minX,box.minY,box.minZ),new Vector3(box.maxX,box.maxY,box.maxZ)),new Vector3());
      return hit?{target,at:hit.distanceTo(ray.origin)}:null;
    }).filter(hit=>hit&&hit.at<weapon.range).sort((a,b)=>a.at-b.at).slice(0,weapon.penetrationTargets);
    for(const [i,hit]of hits.entries()){intersections++;damage+=weapon.damage*damageFalloff(weapon,hit.at)*penetrationMultiplier(weapon,i,hit.at);}
  }
  return {damage,intersections};
}

test('straight-ray comparison matches independent emitted-ray geometry; blast and flame retain authoritative contact', () => {
  for (const id of ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'assault', 'rocket', 'flamethrower']) for (const seed of [17, 71]) {
    const events = [], sim = new RoomSimulation('DPS', { random: scenarioRandom(seed), onEvent: event => events.push(event) });
    const player = sim.addPlayer('a'); sim.phase = 'countdown'; sim.zombies.clear();
    Object.assign(player, { x: 100, y: 0, z: 100, crouched: true, yaw: 0, pitch: 0, weapon: id, shotAfter: 0,
      inventory: { [id]: { ammo: WEAPONS[id].magazine, reserve: 1000 } }, minigunSpinning: true, minigunSpinUntil: 0 });
    const targets = [body('a', 100, 99), body('b', 100.1, 98), body('c', 100.1, 97), body('d', 100.5, 96),
      body('side', 102.5, 99), body('back', 100.5, 101)];
    for (const target of targets) sim.zombies.set(target.id, { ...target, hp: 1e8, maxHp: 1e8, pushX: 0, pushZ: 0 });
    const expected = scenarioShot(WEAPONS[id], { targets, origin: { x: 100, y: .88, z: 100 }, random: scenarioRandom(seed) });
    assert.equal(sim.shoot('a'), true, id);
    const shot=events.find(event=>event.event==='shot');
    const oracle=weaponOracle();
    function weaponOracle(){
      if(WEAPONS[id].bulletPhysics){
        assert.ok([...sim.zombies.values()].every(target=>target.hp===1e8),'a ray comparison cannot apply early gameplay damage');
        return straightShotOracle(WEAPONS[id],shot.projectiles,targets);
      }
      return {damage:[...sim.zombies.values()].reduce((sum,target)=>sum+1e8-target.hp,0),intersections:shot.hits};
    }
    assert.ok(Math.abs(oracle.damage-expected.damage)<1e-5, id+' seed '+seed);
    assert.equal(oracle.intersections,expected.intersections,id);
  }
});

test("shotgun straight-ray comparison retains production's emitted disk spread at 12 metres", () => {
  const targets = [body('front', 100, 88, { scale: 3 }), body('rear', 100.5, 84, { scale: 3 })];
  for (const seed of [17, 31, 71]) {
    const events=[]; const sim = new RoomSimulation('DISK', { random: scenarioRandom(seed), onEvent:event=>events.push(event) }), player = sim.addPlayer('a');
    sim.phase = 'countdown'; sim.zombies.clear();
    Object.assign(player, { x: 100, y: 0, z: 100, crouched: true, yaw: 0, pitch: 0, weapon: 'shotgun',
      inventory: { shotgun: { ammo: 8, reserve: 24 } } });
    for (const target of targets) sim.zombies.set(target.id, { ...target, hp: 1e8, maxHp: 1e8 });
    const expected = scenarioShot(WEAPONS.shotgun, { targets, origin: { x: 100, y: .88, z: 100 }, random: scenarioRandom(seed) });
    sim.shoot('a');
    const shot=events.find(event=>event.event==='shot'),oracle=straightShotOracle(WEAPONS.shotgun,shot.projectiles,targets);
    close(expected.damage,oracle.damage,'independent straight-ray reference');
    assert.equal(expected.intersections,oracle.intersections);
    assert.ok([...sim.zombies.values()].every(target=>target.hp===1e8),'comparison ray calculation never resolves gameplay damage');
  }
});

test('shotgun uses smooth energy damage with no close-range multiplier at one or four metres', () => {
  const weapon = WEAPONS.shotgun;
  assert.equal(weapon.closeRangeBoost, undefined);
  for (const d of [0, 1 - 1e-5, 1, 1 + 1e-5, 4 - 1e-5, 4, 4 + 1e-5, 12])
    close(damageFalloff(weapon, d), Math.exp(-2 * weapon.bulletPhysics.drag * d));
  const report = scenarioReport({ shotgun: weapon }, { samples: 3, shotsPerSample: 24, seed: 71 });
  assert.equal(report.assumptions.maximumCrowdRadius, 90);
  assert.ok(report.rows[0].cells[0].rawDps > report.rows[0].cells[2].rawDps);
});

test('blade selection matches the authoritative impact, including heavy-only reach', () => {
  for (const mode of ['light', 'heavy']) {
    const sim = new RoomSimulation('BLADE'), player = sim.addPlayer('a'); sim.phase = 'countdown'; sim.zombies.clear();
    Object.assign(player, { x: 100, y: 0, z: 100, crouched: true, yaw: 0, pitch: 0, weapon: 'katana',
      inventory: { katana: { ammo: 0, reserve: 0 } } });
    const targets = [body('first', 100, 99), body('second', 100.5, 98.8), body('third', 99.5, 98.7), body('fourth', 100, 98.4)];
    for (const target of targets) sim.zombies.set(target.id, { ...target, hp: 10000, maxHp: 10000 });
    const expected = scenarioShot(WEAPONS.katana, { targets, origin: { x: 100, y: .88, z: 100 }, mode });
    assert.equal(sim.shoot('a', 0, mode), true); sim.time = WEAPONS.katana.attacks[mode].windup; sim.updateMelee();
    close([...sim.zombies.values()].reduce((sum, target) => sum + 10000 - target.hp, 0), expected.damage, mode);
    assert.equal(expected.targetsHit, 3);
  }
  const report = scenarioReport({ katana: WEAPONS.katana }, { distances: [1.75], samples: 1, shotsPerSample: 1 });
  assert.equal(report.rows[0].cells[0].rawDps, 0);
  assert.ok(report.rows[1].cells[0].rawDps > 0, 'heavy must keep its 2.1m reach even though the generic weapon range is 1.9m');
});

test('burn counts its periodic live union, never stacks, and can continue through a three-second reload', () => {
  const flame = scenarioTiming(WEAPONS.flamethrower);
  close(flame.cycleTime, 79 * .125 + 3); close(flame.burnCoverage, 1);
  const slower = scenarioTiming({ ...WEAPONS.flamethrower, reloadTime: 10 });
  close(slower.burnCoverage, (79 * .125 + 4) / (79 * .125 + 10));
  const report = scenarioReport({ flamethrower: WEAPONS.flamethrower }, { distances: [0], samples: 3, shotsPerSample: 2 });
  const cell = report.rows[0].cells[0];
  close(cell.burnDps, cell.effectiveBurnTargets * WEAPONS.flamethrower.burnDps);
  close(cell.contactDps, cell.effectiveBurnTargets * WEAPONS.flamethrower.damage * 80 / 12.875);
  close(cell.rawDps, cell.contactDps + cell.burnDps);
});

test('fire axe scenarios match real broad sweeps on two bodies without passing damage to a third', () => {
  for (const mode of ['light', 'heavy']) {
    const sim = new RoomSimulation('AXE-DPS'), player = sim.addPlayer('a'); sim.phase = 'countdown'; sim.zombies.clear();
    Object.assign(player, { x: 100, y: 0, z: 100, crouched: true, yaw: 0, pitch: 0, weapon: 'fireaxe',
      inventory: { fireaxe: { ammo: 0, reserve: 0 } } });
    const targets = [body('front', 100, 99.2), body('right', 101.35, 99.2), body('left', 98.65, 99.2)];
    for (const target of targets) sim.zombies.set(target.id, { ...target, hp: 10000, maxHp: 10000 });
    const expected = scenarioShot(WEAPONS.fireaxe, { targets, origin: { x: 100, y: .88, z: 100 }, mode });
    assert.equal(sim.shoot('a', 0, mode), true);
    sim.time = WEAPONS.fireaxe.attacks[mode].windup; sim.updateMelee();
    const actual = [...sim.zombies.values()].reduce((sum, target) => sum + 10000 - target.hp, 0);
    close(actual, expected.damage, mode);
    close(expected.damage, WEAPONS.fireaxe.attacks[mode].damage * 1.75, mode);
    assert.equal(expected.targetsHit, 2); assert.equal(expected.intersections, 2);
    assert.equal([...sim.zombies.values()].filter(target => target.hp === 10000).length, 1);
  }
});

test('Magnum damage stays finite and independent of target health', () => {
  const options = { distances: [4], samples: 2, shotsPerSample: 8 };
  const a = scenarioReport({ magnum: WEAPONS.magnum }, { ...options, targetHp: 80 }).rows[0].cells[0];
  const b = scenarioReport({ magnum: WEAPONS.magnum }, { ...options, targetHp: 1400 }).rows[0].cells[0];
  close(a.rawDps, b.rawDps); close(a.damagePerShot, b.damagePerShot);
  assert.ok(a.damagePerShot > 0 && a.damagePerShot <= WEAPONS.magnum.damage);
  assert.equal(a.magnumKillsPerSecond, undefined); assert.equal(b.magnumImpactsPerSecond, undefined);
});

test('report covers all weapons and both blade modes reproducibly; real spread and geometry alter delivered damage', () => {
  const options = { samples: 3, shotsPerSample: 24, seed: 71 };
  const a = scenarioReport(WEAPONS, options), b = scenarioReport(WEAPONS, options);
  assert.deepEqual(a, b); assert.equal(a.rows.length, Object.values(WEAPONS).reduce((count, weapon) => count + (weapon.melee ? 2 : 1), 0));
  assert.deepEqual(a.scenarios.map(s => s.distance), [0, 4, 12]);
  const pump = a.rows.find(row => row.id === 'shotgun').cells;
  assert.ok(pump[2].rawDps < pump[0].rawDps * .6, 'distant vertical spread and falloff reduce delivered damage');
  assert.ok(pump[2].targetsPerShot > pump[0].targetsPerShot, 'spread reaches more distinct bodies, rather than all nine pellets sharing one centre');
  const rocket = a.rows.find(row => row.id === 'rocket').cells;
  assert.ok(rocket[0].targetsPerShot > 20); assert.ok(rocket[0].rawDps > rocket[2].rawDps);
  const flame = a.rows.find(row => row.id === 'flamethrower').cells;
  assert.equal(flame[2].rawDps, 0);
  assert.equal(a.assumptions.damageClippedAtHp, false); assert.equal(a.assumptions.replenishedAmmo, true);
  assert.equal(a.assumptions.headshotMultiplier, 1);
});

test('invalid options and geometries fail explicitly', () => {
  for (const options of [{ samples: 0 }, { shotsPerSample: 0 }, { targetHp: NaN }, { targetHp: 0 }, { distances: [-1] }, { distances: [] }, { spacing: .7 }])
    assert.throws(() => scenarioReport(WEAPONS, options), TypeError);
  assert.throws(() => scenarioReport({}), TypeError);
  assert.throws(() => scenarioTiming(WEAPONS.katana, { mode: 'invalid' }), TypeError);
  assert.throws(() => scenarioGeometry(-1), TypeError);
});

test('proximity crowd generation remains bounded when a bullet has a very distant technical horizon', () => {
  const options={samples:1,shotsPerSample:1,distances:[0,4,12]};
  const a=scenarioReport({magnum:WEAPONS.magnum},options);
  const b=scenarioReport({magnum:{...WEAPONS.magnum,range:1e6}},options);
  assert.equal(a.assumptions.crowdRadius,90);assert.equal(b.assumptions.crowdRadius,90);
  assert.deepEqual(a,b,'increasing an already distant horizon cannot grow the 90 m crowd or change this bounded benchmark');
});

test('active cycles remove firearm reload/preparation and keep the full blade cadence as an explicit exception', () => {
  for (const id of ['pistol', 'rifle', 'shotgun', 'smg', 'minigun', 'magnum', 'assault', 'rocket', 'flamethrower']) {
    const timing = scenarioActiveTiming(WEAPONS[id]);
    close(timing.cycleTime, WEAPONS[id].interval, id);
    close(timing.shotsPerSecond, 1 / WEAPONS[id].interval, id);
    assert.equal(timing.shotsPerCycle, 1); assert.equal(timing.reloadTime, 0);
    assert.equal(timing.preparationTime, 0); assert.equal(timing.firstDamageAt, 0);
    assert.deepEqual(timing, scenarioActiveTiming({ ...WEAPONS[id], magazine: 1, reserve: 0, reloadTime: 1000 }), 'stock and reload cannot change active cadence');
  }
  close(scenarioActiveTiming(WEAPONS.rocket).shotsPerSecond, 1.25, 'one-round rocket still has a firing interval');
  const light = scenarioActiveTiming(WEAPONS.katana, { mode: 'light' });
  const heavy = scenarioActiveTiming(WEAPONS.katana, { mode: 'heavy' });
  close(light.cycleTime, .55); close(heavy.cycleTime, 1.5);
  close(light.firstDamageAt, .16); close(heavy.firstDamageAt, .7);
  close(light.preparationTime, .16); close(heavy.preparationTime, .7);
  assert.deepEqual(light, scenarioTiming(WEAPONS.katana, { mode: 'light' }));
  assert.deepEqual(heavy, scenarioTiming(WEAPONS.katana, { mode: 'heavy' }));
  assert.equal(light.ammoPerSecond, 0); assert.equal(heavy.ammoPerSecond, 0);
  assert.throws(() => scenarioActiveTiming(WEAPONS.katana, { mode: 'invalid' }), TypeError);
  assert.throws(() => scenarioActiveTiming({ interval: 0 }), TypeError);
});

test('active damage uses the same spatial samples and separates continuous contact from one shared burn', () => {
  const report = scenarioReport(WEAPONS, { samples: 3, shotsPerSample: 8 });
  for (const row of report.rows) for (const cell of row.cells) {
    const weapon = WEAPONS[row.id], interval = row.mode ? weapon.attacks[row.mode].duration : weapon.interval;
    close(cell.active.contactDps, cell.damagePerShot / interval, `${row.id} contact`);
    close(cell.active.burnDps, weapon.fuel ? cell.effectiveBurnTargets * weapon.burnDps : 0, `${row.id} burn`);
    close(cell.active.rawDps, cell.active.contactDps + cell.active.burnDps, row.id);
    assert.ok(cell.active.minDps <= cell.active.rawDps + 1e-8 && cell.active.maxDps >= cell.active.rawDps - 1e-8);
    if (!weapon.fuel) {
      const ratio = cell.active.shotsPerSecond / cell.shotsPerSecond;
      close(cell.active.rawDps, cell.rawDps * ratio, row.id);
      close(cell.active.minDps, cell.minDps * ratio, row.id);
      close(cell.active.maxDps, cell.maxDps * ratio, row.id);
      close(cell.active.standardError, cell.standardError * ratio, row.id);
    }
  }
  const flame = report.rows.find(row => row.id === 'flamethrower').cells[0];
  close(flame.active.contactDps, flame.effectiveBurnTargets * WEAPONS.flamethrower.contactDps);
  close(flame.active.burnDps, flame.effectiveBurnTargets * WEAPONS.flamethrower.burnDps);
  assert.ok(flame.active.rawDps < flame.rawDps * flame.active.shotsPerSecond / flame.shotsPerSecond, 'burn must not be multiplied by the contact-cadence ratio');
  const heavy = report.rows.find(row => row.mode === 'heavy').cells[0], light = report.rows.find(row => row.mode === 'light').cells[0];
  close(heavy.active.rawDps, heavy.rawDps); close(light.active.rawDps, light.rawDps);
});

test('authoritative movement and sprint remain available during blade preparation and impact uses the reached position', () => {
  for (const sprint of [false, true]) {
    function fixture(attacking) {
      const events = [], sim = new RoomSimulation('MOVING', { onEvent: event => events.push(event) }), player = sim.addPlayer('a');
      sim.phase = 'countdown'; sim.zombies.clear();
      Object.assign(player, { x: 12, y: 0, z: 8, crouched: false, yaw: 0, pitch: 0, weapon: 'katana',
        inventory: { katana: { ammo: 0, reserve: 0 } } });
      const target = { ...body('target', 12, 3.2), hp: 3000, maxHp: 3000 };
      sim.zombies.set(target.id, target);
      assert.equal(sim.meleeTargetPoint({ x: 12, y: 1.55, z: 8 }, { x: 0, y: 0, z: -1 }, target, WEAPONS.katana.attacks.heavy), null,
        'target cannot be hit from the starting position');
      if (attacking) assert.equal(sim.shoot('a', 0, 'heavy'), true);
      for (let step = 0; step < 42; step++) {
        sim.setInput('a', { forward: 1, strafe: 0, yaw: 0, pitch: 0, sprint });
        sim.time += 1 / 60; sim.movePlayer(player, 1 / 60); sim.updateMelee();
        if (step < 41) assert.equal(target.hp, 3000, 'windup must finish before damage');
      }
      return { sim, player, target, events };
    }
    const attack = fixture(true), control = fixture(false), speed = (sprint ? 5.4 : 3.5) * 1.05;
    close(attack.player.z, 8 - speed * .7); close(attack.player.z, control.player.z);
    assert.equal(attack.target.hp, 3000 - WEAPONS.katana.attacks.heavy.damage); assert.equal(control.target.hp, 3000);
    const impact = attack.events.find(event => event.event === 'melee-hit');
    close(impact.z, attack.player.z); assert.equal(impact.hits, 1);
  }
});

test('active flame recalculates burn coverage, and active Magnum preserves physical shot damage', () => {
  const slow = scenarioReport({ flamethrower: { ...WEAPONS.flamethrower, reloadTime: 10 } }, { distances: [0], samples: 2, shotsPerSample: 1 }).rows[0].cells[0];
  assert.ok(slow.burnDps < slow.effectiveBurnTargets * WEAPONS.flamethrower.burnDps);
  close(slow.active.burnDps, slow.effectiveBurnTargets * WEAPONS.flamethrower.burnDps);
  close(slow.active.rawDps, slow.effectiveBurnTargets * (WEAPONS.flamethrower.contactDps + WEAPONS.flamethrower.burnDps));
  const options = { distances: [0], samples: 2, shotsPerSample: 4 };
  const a = scenarioReport({ magnum: WEAPONS.magnum }, { ...options, targetHp: 80 }).rows[0].cells[0];
  const b = scenarioReport({ magnum: WEAPONS.magnum }, { ...options, targetHp: 1400 }).rows[0].cells[0];
  close(a.active.rawDps, a.damagePerShot / WEAPONS.magnum.interval);
  close(a.active.rawDps, b.active.rawDps); assert.equal(a.active.magnumKillsPerSecond, undefined);
});

test('historical weapon fixture preserves archived geometry and timing while distant penetration can only reduce damage', () => {
  const before = JSON.parse(readFileSync(new URL('../validation/weapon-scenarios-2026-10-10.json', import.meta.url), 'utf8')).report;
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/weapon-scenarios-baseline-2026-10-10.json', import.meta.url), 'utf8'));
  const current = scenarioReport(fixture.weapons);
  const { activeCycle, burnSpatialWeight, hpUse, infiniteField, crowdRadius, maximumCrowdRadius, convergence, ...assumptions } = current.assumptions;
  const { hpUse: oldHpUse, infiniteField: oldInfinite, convergence: oldConvergence, ...archived } = before.assumptions;
  assert.deepEqual(current.scenarios, before.scenarios); assert.deepEqual(assumptions, archived);
  assert.equal(infiniteField, false); assert.ok(crowdRadius <= maximumCrowdRadius); assert.equal(maximumCrowdRadius, 90);
  for (const [index, row] of current.rows.entries()) {
    const oldRow = before.rows[index]; assert.equal(row.id, oldRow.id); assert.equal(row.mode, oldRow.mode);
    for (const [cellIndex, cell] of row.cells.entries()) {
      const old = oldRow.cells[cellIndex];
      for (const field of ['targetsPerShot', 'intersectionsPerShot', 'cycleTime', 'shotsPerCycle', 'shotsPerSecond', 'firstDamageAt', 'reloadTime', 'preparationTime'])
        assert.equal(cell[field], old[field], `${row.id} preserves archived ${field}`);
      for (const field of ['rawDps', 'contactDps', 'burnDps', 'damagePerShot', 'minDps', 'maxDps']) {
        if (row.id === 'magnum') close(cell[field], old[field] * fixture.weapons.magnum.damage / before.assumptions.targetHp, 'archived Magnum now uses its finite base damage');
        else {
          assert.ok(cell[field] <= old[field] + 1e-9, `${row.id} cannot gain damage from the new distant penetration penalty`);
          assert.ok(cell[field] >= old[field] * .75 - 1e-9, `${row.id} cannot lose more than the agreed quarter`);
        }
      }
    }
  }
  assert.equal(typeof activeCycle, 'string');
});

test('historical blade and near-flame power still scale archived impacts before the new flame edge attenuation', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/weapon-scenarios-baseline-2026-10-10.json', import.meta.url), 'utf8'));
  const prior = scenarioReport(fixture.weapons);
  const current = scenarioReport({ ...fixture.weapons, katana: WEAPONS.katana,
    flamethrower: { ...WEAPONS.flamethrower, range: 5, fullDamageRange: undefined } });
  for (const row of current.rows) {
    const oldRow = prior.rows.find(old => old.id === row.id && old.mode === row.mode);
    const factor = row.id === 'katana' ? 2.4 : row.id === 'flamethrower' ? 5 : 1;
    for (const [index, cell] of row.cells.entries()) {
      const old = oldRow.cells[index];
      assert.equal(cell.targetsPerShot, old.targetsPerShot);
      assert.equal(cell.intersectionsPerShot, old.intersectionsPerShot);
      for (const field of ['rawDps', 'contactDps', 'burnDps', 'damagePerShot', 'minDps', 'maxDps', 'standardError']) close(cell[field], old[field] * factor, `${row.id}/${row.mode ?? 'single'} ${field}`);
      for (const field of ['rawDps', 'contactDps', 'burnDps', 'minDps', 'maxDps', 'standardError']) close(cell.active[field], old.active[field] * factor, `${row.id} active ${field}`);
      for (const field of ['cycleTime', 'shotsPerCycle', 'shotsPerSecond', 'firstDamageAt', 'reloadTime', 'preparationTime']) {
        assert.equal(cell[field], old[field]); assert.equal(cell.active[field], old.active[field]);
      }
      if (factor === 1) assert.deepEqual(cell, old, `unmodified ${row.id} preserves every measured field`);
    }
  }
});



test('flame scenario throughput weights edge contact and residual burning by the same independently integrated strength', () => {
  const options = { distances: [0, 4], samples: 2, shotsPerSample: 1 };
  const smooth = scenarioReport({ flamethrower: WEAPONS.flamethrower }, options).rows[0].cells;
  const flat = scenarioReport({ flamethrower: { ...WEAPONS.flamethrower, fullDamageRange: undefined } }, options).rows[0].cells;
  for (let index = 0; index < smooth.length; index++) {
    assert.equal(smooth[index].targetsPerShot, flat[index].targetsPerShot);
    assert.ok(smooth[index].effectiveBurnTargets > 0 && smooth[index].effectiveBurnTargets < smooth[index].targetsPerShot);
    close(smooth[index].active.contactDps / 50, smooth[index].effectiveBurnTargets);
    close(smooth[index].active.burnDps / 175, smooth[index].effectiveBurnTargets);
    assert.ok(smooth[index].rawDps < flat[index].rawDps);
  }
  for (const distance of [3, 5, 5.25, 5.5, 5.75, 6]) {
    const t = Math.max(0, Math.min(1, distance - 5));
    const expected = 1 - (6 * t ** 5 - 15 * t ** 4 + 10 * t ** 3);
    const shot = scenarioShot(WEAPONS.flamethrower, { targets: [body('edge', 0, -distance)] });
    close(shot.damage, 6.25 * expected); close(shot.burnWeight, expected);
  }
});
