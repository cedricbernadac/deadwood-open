import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomSimulation, TICK_RATE } from '../simulation.mjs';
import { RAIDER_LOADOUTS } from '../public/raids.js';
import { seededRandom } from '../validation/balance-report.mjs';
import { raiderDuel } from '../validation/raid-balance-report.mjs';

// A small deterministic comparison, not a human playtest. Reproduce with:
// node test/raider-pressure.test.mjs --measure
const DT = 1 / TICK_RATE, SEEDS = Array.from({ length: 12 }, (_, index) => 731 + index * 104729);
const round = value => Math.round(value * 1000) / 1000;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const mean = values => values.reduce((total, value) => total + value, 0) / values.length;

function arena(seed, onEvent = () => {}) {
  const sim = new RoomSimulation('PRESS1', { random: seededRandom(seed), onEvent });
  const player = sim.addPlayer('a'); sim.start('a'); sim.wave = 13; sim.beginWave();
  sim.spawnTimer = 1e9; sim.zombies.clear(); sim.spawnWarnings.clear();
  Object.assign(player, { x: 20, y: 0, z: 10, hp: 1e6, armor: 0 });
  return { sim, player };
}
function place(sim, loadout, point = { x: 20, z: 0 }) {
  const raider = sim.createRaider(1, { doorId: 'east', ...point }, { index: 1, damageScale: 1 }, { point, loadout });
  sim.zombies.set(raider.id, raider);
  return raider;
}
function firing(loadout, seed) {
  let shots = 0, hits = 0, damage = 0;
  const { sim, player } = arena(seed, event => {
    if (event.event === 'raider-shot') shots++;
    if (event.event === 'hit' && event.source === 'raider') { hits++; damage += event.damage - event.absorbed; }
  });
  const raider = place(sim, loadout);
  Object.assign(raider.ai, { state: 'engage', engagedAt: sim.time, engageUntil: Infinity, holdUntil: Infinity });
  // Hold the firing post to isolate actual bursts, reactions and reloads.
  // The complete movement/entry scenario below uses the unchanged AI methods.
  sim.raiderEngageStep = body => { body.ai.holding = true; return false; };
  for (let tick = 0; tick < 20 * TICK_RATE; tick++) {
    sim.setInput(player.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 }); sim.tick(DT);
  }
  return { shots, hits, damage };
}
function accuracy(seed) {
  const { sim, player } = arena(seed);
  Object.assign(player, { z: 12 });
  const raider = place(sim, 'smg');
  Object.assign(raider.ai, { acquiredAt: sim.time - 40, settleAmplitude: 0, moving: null });
  const point = { x: player.x, y: 1.085, z: player.z }, origin = sim.raiderMuzzle(raider, point);
  let hits = 0;
  for (let shot = 0; shot < 300; shot++) hits += sim.traceRaiderShot(raider, origin, point,
    { sigma: sim.raiderAimError(raider, player, origin, point) }).hits;
  return hits / 300;
}
function entry(seed) {
  const { sim, player } = arena(seed);
  Object.assign(player, { x: 5, z: -3.5 });
  const raider = place(sim, 'smg', { x: 30, z: -5 }), start = sim.time;
  const times = {};
  for (let tick = 0; tick < 45 * TICK_RATE; tick++) {
    sim.setInput(player.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0 }); sim.tick(DT);
    times[raider.ai.state] ??= sim.time - start;
    if (raider.ai.state === 'assault') break;
  }
  return { engage: times.engage ?? Infinity, breach: times.breach ?? Infinity, inside: times.assault ?? Infinity };
}

export function measurePressure(seeds = SEEDS) {
  const fire = Object.fromEntries(Object.keys(RAIDER_LOADOUTS).map(loadout => {
    const samples = seeds.map(seed => firing(loadout, seed));
    return [loadout, { shots20s: round(mean(samples.map(sample => sample.shots))),
      damage20s: round(mean(samples.map(sample => sample.damage))) }];
  }));
  const entries = seeds.map(entry);
  const duels = Object.fromEntries(['still', 'walk', 'sprint'].map(motion => [motion,
    round(median(seeds.map(seed => raiderDuel({ loadout: 'smg', distance: 10, motion, seed }).seconds ?? Infinity)))]));
  return { seeds: seeds.length, fire, smgSettledHitRate12m: round(mean(seeds.map(accuracy))),
    smgDown100Hp10m: duels, entryMedianSeconds: Object.fromEntries(['engage', 'breach', 'inside'].map(key =>
      [key, round(median(entries.map(sample => sample[key])))])) };
}

if (process.argv.includes('--measure')) console.log(JSON.stringify(measurePressure(), null, 2));
else {
  test('raider pressure comparison exercises actual shots, reloads, spread and cabin entry', () => {
    // Three seeds keep the default suite short; --measure uses all twelve.
    const measured = measurePressure(SEEDS.slice(0, 3));
    assert.ok(measured.fire.smg.shots20s >= 72, `more sustained fire: ${measured.fire.smg.shots20s} shots/20s`);
    assert.ok(measured.smgSettledHitRate12m >= .64 && measured.smgSettledHitRate12m < .85,
      `stronger aim keeps misses: ${measured.smgSettledHitRate12m}`);
    assert.ok(measured.entryMedianSeconds.breach <= 11.5 && measured.entryMedianSeconds.inside <= 26,
      `shorter cover/entry: ${JSON.stringify(measured.entryMedianSeconds)}`);
    assert.ok(measured.smgDown100Hp10m.still >= 3 && measured.smgDown100Hp10m.still <= 5.5,
      `exposed target has time to react: ${measured.smgDown100Hp10m.still}s`);
    assert.ok(measured.smgDown100Hp10m.sprint > measured.smgDown100Hp10m.still * 1.5,
      `running remains useful: ${JSON.stringify(measured.smgDown100Hp10m)}`);
  });
}
