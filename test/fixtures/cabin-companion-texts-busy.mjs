import { RoomSimulation } from '../../simulation.mjs';
import { describeSituation } from '../../companions/situation.mjs';
import { rollCompanionProfile } from '../../companions/profiles.mjs';
import { seededRandom } from '../../validation/balance-report.mjs';
// A busy cabin state whose text runs over the 2,800-character budget (review
// of 24 October): the wave 4 supply crate, a veteran's profile, six walkers
// and five ammo boxes. The cabin trims the latest line of the worst rank
// first; the supermarket's longest-first rule would drop the crate line and
// keep PICKUPS instead. Rendered with no simulation tick at all.
const sim = new RoomSimulation('CABINBASE', { random: seededRandom(3), raids: false });
const papa = sim.addPlayer('papa', 'Papa');
const jules = sim.addPlayer('jules', 'Jules');
const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
sim.addPlayer('sam', 'Sam', undefined, { companion: true });
sim.start('papa');
Object.assign(sim, { phase: 'wave', wave: 3, toSpawn: 4, spawnTimer: 1e9 });
sim.zombies.clear();
Object.assign(papa, { x: -3, y: 0, z: 2, grounded: true, vy: 0 });
Object.assign(jules, { x: 4, y: 0, z: -3, grounded: true, vy: 0 });
Object.assign(max, { x: 1, y: 0, z: 1, grounded: true, vy: 0, points: 350 });
Object.assign(sim.spawnZombie(), { kind: 'walker', x: -2, y: 0, z: 3.8, hp: 40, maxHp: 40, speed: 0, attackAfter: Infinity, entered: true });
Object.assign(sim.spawnZombie(), { kind: 'runner', x: -9.4, y: 0, z: .5, hp: 30, maxHp: 30, speed: 0, attackAfter: Infinity, entered: true });
sim.wave = 4;
sim.beginSupplyWave();
max.companionProfile = rollCompanionProfile('veteran', seededRandom(100));
for (const [x, z] of [[-6, -4], [-4, -5], [0, -4], [3, -4], [5, 1], [6, 3]]) Object.assign(sim.spawnZombie(), { kind: 'walker', x, y: 0, z, hp: 40, maxHp: 40, speed: 0, attackAfter: Infinity, entered: true });
for (let index = 0; index < 5; index++) sim.pickups.set(`ammo-${index}`, { id: `ammo-${index}`, kind: 'ammo', x: -2 + index, y: 0, z: 1, amount: 1, special: false, expiresAt: sim.time + 60, charge: 780 });
const view = describeSituation(sim, 'max', { order: { kind: 'defend', doorId: 'west' }, orderSince: 0, recent: ['wave 3 started'] });
process.stdout.write(JSON.stringify({ text: view.text }) + '\n');
