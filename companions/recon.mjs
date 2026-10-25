import { HAS_SPACE, IS_HOSPITAL, IS_FUNFAIR } from '../public/level-config.js';
import { spaceFloorId } from '../public/level-space.js';
import { RADAR, reconLevel, radarInformation, radarPulseIndex, radarBlipSeconds } from '../public/radar-rules.js';

// Personal pulses retain only unlocked information until the next pulse.
// This auxiliary perception cache never changes simulation or enemy state.
const rooms = new WeakMap(), sectors = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// Player words for spaceFloorId's ids: the hospital's lower floor is its
// basement; both walled maps call their flights the stairs.
const HOSPITAL_FLOOR_WORDS = Object.freeze({ cellar: 'basement', stair: 'stairs' });
const FUNFAIR_FLOOR_WORDS = Object.freeze({ cellar: 'cellar', stair: 'stairs' });
const floorWord = enemy => { const id = spaceFloorId(enemy); return IS_HOSPITAL ? HOSPITAL_FLOOR_WORDS[id] ?? id : IS_FUNFAIR ? FUNFAIR_FLOOR_WORDS[id] ?? id : id; };
const sector = (self, enemy) => sectors[(Math.round(Math.atan2(enemy.x - self.x, -(enemy.z - self.z)) / (Math.PI / 4)) + 8) % 8];
export function describeRecon(sim, self) {
  const level = reconLevel(self);
  let cache = rooms.get(sim);
  if (!cache) rooms.set(sim, cache = new Map());
  if (!level) { cache.delete(self.id); return ''; }
  const pulse = radarPulseIndex(level, sim.time), info = radarInformation(level), horizon = `${sim.phase}:${sim.wave}`;
  let memory = cache.get(self.id);
  if (!memory || memory.level !== level || memory.pulse !== pulse || memory.horizon !== horizon) {
    const enemies = [...sim.zombies.values()].filter(enemy => enemy.hp > 0 && Math.hypot(enemy.x - self.x, enemy.z - self.z) <= RADAR.range);
    const contacts = info.positions ? enemies.map(enemy => ({ x: enemy.x, z: enemy.z,
      ...(info.types ? { kind: enemy.boss ? 'boss' : enemy.kind } : {}),
      ...(info.floor ? { floor: HAS_SPACE ? floorWord(enemy) : (enemy.y ?? 0) > 2.8 ? 'loft' : (enemy.y ?? 0) > .3 ? 'stairs' : 'ground' } : {}),
      ...(info.exactHealth ? { hp: enemy.hp, maxHp: enemy.maxHp ?? enemy.hp }
        : info.health ? { health: Math.min(100, Math.ceil(4 * enemy.hp / Math.max(1, enemy.maxHp ?? enemy.hp)) * 25) } : {}) })) : [];
    memory = { level, pulse, horizon, at: sim.time, presence: enemies.length > 0,
      sectors: info.sectors && !info.positions ? [...new Set(enemies.map(enemy => sector(self, enemy)))] : [], contacts };
    cache.set(self.id, memory);
  }
  const prefix = `RECON N${level}, ${RADAR.range}m, pulse every ${radarBlipSeconds(level)}s (${Math.max(0, Math.round(sim.time - memory.at))}s old): `;
  if (!memory.presence) return `${prefix}no nearby presence.`;
  if (!info.sectors) return `${prefix}nearby presence; location and identity unknown.`;
  if (!info.positions) return `${prefix}presence in sectors ${memory.sectors.join(', ')}; exact positions and identities unknown.`;
  return prefix + memory.contacts.slice(0, 8).map((enemy, index) => `contact ${index + 1}: ${Math.round(Math.hypot(enemy.x - self.x, enemy.z - self.z) * 10) / 10}m ${sector(self, enemy)}`
    + (enemy.kind ? ` ${enemy.kind}` : '') + (enemy.floor ? ` ${enemy.floor}` : '')
    + (enemy.hp !== undefined ? ` HP ${enemy.hp}/${enemy.maxHp}` : enemy.health !== undefined ? ` health about ${enemy.health}%` : '')).join('; ')
    + (memory.contacts.length > 8 ? '; more contacts' : '') + '. Positions are pulse memories, not live targets.';
}
