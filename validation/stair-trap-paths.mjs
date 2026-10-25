import { RoomSimulation, WEAPONS } from '../simulation.mjs';
import { WEAPON_MOVEMENT } from '../public/rules.js';
import { STAIRS } from '../public/stairs.js';

export const stairCases = Object.freeze([
  { id: 'west-jump', label: 'Ancien piège · bord ouest', side: -1, kind: 'jump' },
  { id: 'east-jump', label: 'Ancien piège · bord est', side: 1, kind: 'jump' },
  { id: 'west-descent', label: 'Descente latérale ouest', side: -1, kind: 'descent' },
  { id: 'east-descent', label: 'Descente latérale est', side: 1, kind: 'descent' },
]);

// The legacy comparison changes only the former airborne step-height
// tolerance. Positions still come entirely from ordinary setInput/tick calls.
export function runStairPath(id, { hz = 30, weapon = 'pistol', crouch = false, startZ = .8, legacy = false } = {}) {
  const definition = stairCases.find(item => item.id === id);
  if (!definition || ![10, 30].includes(hz)) throw new Error('Trajet ou fréquence inconnus.');
  const simulation = new RoomSimulation('STAIR1', { random: () => .5 });
  const player = simulation.addPlayer('preview', 'Contrôle escalier');
  simulation.start(player.id); simulation.phase = 'wave'; simulation.toSpawn = 1; simulation.spawnTimer = 999;
  if (weapon !== 'pistol') {
    player.inventory[weapon] = { ammo: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].reserve };
    simulation.chooseWeapon(player.id, weapon);
  }
  if (legacy) {
    const occupy = simulation.canOccupy;
    simulation.canOccupy = function (entity, ...args) {
      return occupy.call(this, entity.grounded === false ? { ...entity, grounded: true } : entity, ...args);
    };
  }
  const delta = 1 / hz, samples = [], commands = [];
  const observe = phase => samples.push({ x: player.x, y: player.y, z: player.z, vy: player.vy,
    yaw: player.yaw, crouched: player.crouched, grounded: player.grounded, hp: player.hp,
    valid: simulation.canOccupy(player, player.x, player.z, player.y, .25),
    phase, tick: samples.length, elapsed: simulation.time });
  const step = (input, phase) => {
    simulation.setInput(player.id, { forward: 0, strafe: 0, yaw: 0, pitch: 0, ...input });
    simulation.tick(delta); commands.push({ ...input }); observe(phase);
  };
  const moveAxis = (axis, target, phase) => {
    const ticks = Math.round(Math.abs(target - player[axis]) / (3.5 * WEAPON_MOVEMENT[weapon] * delta));
    const sign = Math.sign(target - player[axis]);
    for (let i = 0; i < ticks; i++) step(axis === 'x' ? { strafe: sign } : { forward: -sign }, phase);
  };
  observe('Départ réel dans le séjour');
  moveAxis('z', 5.05, 'Contourner le muret par le séjour');
  let contact, escapeStart;
  if (definition.kind === 'jump') {
    moveAxis('x', definition.side < 0 ? 2.85 : 4.75, 'Approcher le bord depuis le séjour');
    moveAxis('z', 3.3, 'Rejoindre le pied de l’escalier');
    contact = samples.length - 1;
    for (let i = 0; i < Math.ceil(1.1 * hz); i++) step({ forward: 1, jump: i === 0 }, 'Saut ordinaire le long du bord');
    step({ crouch: true }, 'Essayer de se baisser');
    step({}, 'Relâcher l’accroupissement');
    escapeStart = samples.length - 1;
    for (let i = 0; i < Math.ceil(1.2 * hz); i++) step({ strafe: definition.side }, 'Se dégager latéralement');
  } else {
    moveAxis('x', 3.8, 'Rejoindre le bas des marches');
    moveAxis('z', 3.3, 'Rejoindre le pied de l’escalier');
    for (let i = 0; i < hz * 6 && player.z > startZ; i++) step({ forward: 1 }, 'Monter par les vraies marches');
    contact = samples.length - 1;
    // High side exits can legitimately meet the loft slab. Continuing toward
    // the lower steps must always free the standing body without teleporting.
    for (let i = 0; i < Math.ceil(.3 * hz); i++) step({ strafe: definition.side, crouch }, 'Descendre par le côté');
    for (let i = 0; i < hz * 3 && player.z < 1.4; i++) step({ strafe: definition.side, forward: -1, crouch }, 'Revenir vers les marches basses');
    escapeStart = samples.length - 1;
    for (let i = 0; i < hz * 2; i++) step({ strafe: definition.side, crouch }, 'Dégagement au rez-de-chaussée');
  }
  const escapeEnd = samples.length - 1;
  for (let i = 0; i < hz; i++) step({}, 'Debout après la sortie');
  return { id, label: definition.label, kind: definition.kind, side: definition.side, hz, weapon, crouch, startZ, legacy,
    samples, commands, start: samples[0], contact, escapeStart, escapeEnd, end: samples.at(-1),
    escapeDistance: Math.hypot(samples[escapeEnd].x - samples[escapeStart].x, samples[escapeEnd].z - samples[escapeStart].z),
    invalidSamples: samples.filter(sample => !sample.valid).length };
}
