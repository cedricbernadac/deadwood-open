import { RoomSimulation } from '../../simulation.mjs';
import { describeSituation } from '../../companions/situation.mjs';
import { seededRandom } from '../../validation/balance-report.mjs';
// A fixed cabin state, rendered with no simulation tick at all: the companion
// texts on the default map must stay byte-identical (KIMI lot 3).
const sim = new RoomSimulation('CABINBASE', { random: seededRandom(3), raids: false });
const papa = sim.addPlayer('papa', 'Papa');
const jules = sim.addPlayer('jules', 'Jules');
const max = sim.addPlayer('max', 'Max', undefined, { companion: true });
sim.start('papa');
Object.assign(sim, { phase: 'wave', wave: 3, toSpawn: 4, spawnTimer: 1e9 });
sim.zombies.clear();
Object.assign(papa, { x: -3, y: 0, z: 2, grounded: true, vy: 0 });
Object.assign(jules, { x: 4, y: 0, z: -3, grounded: true, vy: 0 });
Object.assign(max, { x: 1, y: 0, z: 1, grounded: true, vy: 0, points: 350 });
const inside = sim.spawnZombie();
Object.assign(inside, { kind: 'walker', x: -2, y: 0, z: 3.8, hp: 40, maxHp: 40, speed: 0, attackAfter: Infinity, entered: true });
const atDoor = sim.spawnZombie();
Object.assign(atDoor, { kind: 'runner', x: -9.4, y: 0, z: .5, hp: 30, maxHp: 30, speed: 0, attackAfter: Infinity, entered: true });
const view = describeSituation(sim, 'max', { order: { kind: 'defend', doorId: 'west' }, orderSince: 0, recent: ['wave 3 started'] });
process.stdout.write(JSON.stringify({ text: view.text, actions: view.actions }) + '\n');
