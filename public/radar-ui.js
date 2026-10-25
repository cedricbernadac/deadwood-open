import { LEVEL, IS_SUPERMARKET, HAS_SPACE } from './level-config.js';
import { SPACE } from './level-space.js';
import { EXTERIOR_WALLS, INTERIOR_WALLS, DOOR_OPENING, wallOpenings } from './layout.js';
import { LOFT, STAIRS, STAIR_WELL } from './rules.js';
import { enemyAppearance } from './enemies.js';
import { RADAR, radarBlipSeconds, reconLevel, radarInformation, radarPulseIndex } from './radar-rules.js';

const livePhases = new Set(['countdown', 'wave', 'intermission']);
const finitePosition = point => point && Number.isFinite(point.x) && Number.isFinite(point.z);
const cssColor = color => `#${color.toString(16).padStart(6, '0')}`;

// X points east and negative Z points north, matching the actual world.
// Enemies are never projected past the edge; off-screen allies use an edge chevron.
export function projectRadarPoint(point, radar, range = RADAR.range, clampToEdge = false) {
  if (!finitePosition(point) || !finitePosition(radar) || !(range > 0)) return null;
  const dx = point.x - radar.x, dz = point.z - radar.z, distance = Math.hypot(dx, dz);
  if (distance > range && !clampToEdge) return null;
  const divisor = Math.max(range, distance);
  return { x: dx / divisor, y: dz / divisor, distance, edge: distance > range };
}

export function radarFloorMarker(height, referenceHeight = 0) {
  const delta = (Number.isFinite(height) ? height : 0) - (Number.isFinite(referenceHeight) ? referenceHeight : 0);
  return delta > 1.2 ? 1 : delta < -1.2 ? -1 : 0;
}

// The field radar is personal: each survivor carries their own levelled bonus.
export function radarSupplyStatus(snapshot, self) {
  return (snapshot?.wave ?? 0) < RADAR.unlockWave && !snapshot?.practice ? 'locked' : 'available';
}

export function radarLevelOf(self) {
  return reconLevel(self);
}

export function buildRadarFrame(snapshot, myId, active = true) {
  const self = snapshot?.players?.find(player => player.id === myId);
  const level = radarLevelOf(self);
  if (!active || !level || !livePhases.has(snapshot.phase) || !finitePosition(self)) return null;
  const centre = { x: self.x, z: self.z };
  const referenceHeight = self.y ?? 0;
  const allies = [];
  for (const player of snapshot.players ?? []) {
    const point = projectRadarPoint(player, centre, RADAR.range, true);
    if (!point) continue;
    allies.push({ ...point, id: player.id, self: player.id === myId, color: player.id === myId ? '#ffffff' : '#7cbcff',
      heading: -(player.yaw ?? 0), floor: radarFloorMarker(player.y, referenceHeight),
      downed: player.downed === true, dead: player.alive === false });
  }
  const enemies = [], sectors = [0, 0, 0, 0], info = radarInformation(level);
  let detected = 0;
  for (const zombie of snapshot.zombies ?? []) {
    if (!(zombie.hp > 0)) continue;
    const point = projectRadarPoint(zombie, centre);
    if (!point) continue;
    detected++;
    sectors[Math.floor((Math.atan2(zombie.x - self.x, -(zombie.z - self.z)) + Math.PI / 4 + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 2))]++;
    if (!info.positions) continue;
    const family = enemyAppearance(zombie);
    enemies.push({ ...point, id: zombie.id, color: info.types ? cssColor(family.color) : '#ffb04a', ...(info.types ? { family: family.id } : {}),
      shape: !info.types ? 'ordinary' : zombie.kind === 'raider' ? 'raider' : zombie.boss ? 'boss' : zombie.kind === 'brute' ? 'brute' : zombie.kind === 'armored' ? 'armored' : zombie.kind === 'crawler' ? 'crawler' : 'ordinary',
      floor: info.floor ? radarFloorMarker(zombie.y, referenceHeight) : 0,
      ...(info.health ? { health: info.exactHealth ? zombie.hp / zombie.maxHp : Math.ceil(zombie.hp / zombie.maxHp * 4) / 4 } : {}),
      ...(info.exactHealth ? { hp: zombie.hp, maxHp: zombie.maxHp } : {}) });
  }
  const category = count => count === 0 ? 'none' : count <= 3 ? 'few' : count <= 8 ? 'group' : 'horde';
  return { level, presence: category(detected), sectors: info.sectors && !info.positions ? sectors.map(category) : [], wave: snapshot.wave, practice: snapshot.practice === true,
    x: centre.x, z: centre.z, range: RADAR.range, referenceHeight, allies, enemies, doors: snapshot.doors ?? [] };
}

export function createRadarThrottle(seconds = RADAR.refreshSeconds) {
  let previous = -Infinity, previousKey = null;
  return {
    ready(now, key, force = false) {
      if (!Number.isFinite(now)) return false;
      if (!force && key === previousKey && now >= previous && now - previous < seconds * 1000) return false;
      previous = now; previousKey = key; return true;
    },
    reset() { previous = -Infinity; previousKey = null; },
  };
}

// Static plan derived from the same wall/opening rules as the authoritative room.
export const RADAR_PLAN = Object.freeze({
  exterior: Object.freeze(EXTERIOR_WALLS.flatMap(wall => {
    const segments = [], openings = wallOpenings(wall.id);
    let start = -wall.length / 2;
    for (const opening of openings) {
      const end = opening.center - opening.width / 2;
      if (end > start) segments.push(Object.freeze(wall.axis === 'x' ? { x1: start, z1: wall.fixed, x2: end, z2: wall.fixed }
        : { x1: wall.fixed, z1: start, x2: wall.fixed, z2: end }));
      start = opening.center + opening.width / 2;
    }
    if (start < wall.length / 2) segments.push(Object.freeze(wall.axis === 'x' ? { x1: start, z1: wall.fixed, x2: wall.length / 2, z2: wall.fixed }
      : { x1: wall.fixed, z1: start, x2: wall.fixed, z2: wall.length / 2 }));
    return segments;
  })),
  interior: HAS_SPACE ? Object.freeze([...INTERIOR_WALLS,...SPACE.walls,...SPACE.rails]) : INTERIOR_WALLS,
  flights: HAS_SPACE ? SPACE.flights : Object.freeze([STAIRS]),
  loft: LOFT,
  stairs: STAIRS,
  well: STAIR_WELL,
});

function paintRadar(context, size, frame) {
  const half = size / 2, radius = half - 18;
  const px = x => half + (x - frame.x) / frame.range * radius;
  const py = z => half + (z - frame.z) / frame.range * radius;
  context.clearRect(0, 0, size, size);
  context.fillStyle = '#071814'; context.beginPath(); context.arc(half, half, radius, 0, Math.PI * 2); context.fill();
  context.save(); context.beginPath(); context.arc(half, half, radius, 0, Math.PI * 2); context.clip();
  context.strokeStyle = '#244d3c'; context.lineWidth = 1;
  for (const fraction of [.4, .8, 1]) { context.beginPath(); context.arc(half, half, radius * fraction, 0, Math.PI * 2); context.stroke(); }
  context.beginPath(); context.moveTo(half - radius, half); context.lineTo(half + radius, half); context.moveTo(half, half - radius); context.lineTo(half, half + radius); context.stroke();
  // Ground walls are solid. The dashed mezzanine edge conveys the second level.
  const basement = HAS_SPACE && frame.referenceHeight < -1.7;
  const ground = basement ? SPACE.floors.find(f=>f.id==='cellar') : LEVEL.buildingBounds;
  context.fillStyle = basement ? '#182b32' : '#183128';
  context.fillRect(px(ground.minX),py(ground.minZ),(ground.maxX-ground.minX)/frame.range*radius,(ground.maxZ-ground.minZ)/frame.range*radius);
  if(IS_SUPERMARKET&&!basement){const terrace=SPACE.floors.find(f=>f.id==='terrace');context.fillStyle='#24342b';context.fillRect(px(terrace.minX),py(terrace.minZ),(terrace.maxX-terrace.minX)/frame.range*radius,(terrace.maxZ-terrace.minZ)/frame.range*radius);}
  context.strokeStyle = '#90a68e'; context.lineWidth = 2;
  for (const segment of basement ? [] : RADAR_PLAN.exterior) {
    context.beginPath(); context.moveTo(px(segment.x1), py(segment.z1)); context.lineTo(px(segment.x2), py(segment.z2)); context.stroke();
  }
  for (const wall of RADAR_PLAN.interior) {
    if(HAS_SPACE && (frame.referenceHeight >= (wall.baseY??0)+wall.height || frame.referenceHeight+1.75 <= (wall.baseY??0))) continue;
    context.fillStyle = wall.kind === 'low-cover' ? '#75876e' : '#a3b69b';
    context.fillRect(px(wall.minX), py(wall.minZ), Math.max(1.5, (wall.maxX-wall.minX) / frame.range * radius), Math.max(1.5, (wall.maxZ-wall.minZ) / frame.range * radius));
  }
  context.strokeStyle = '#6b8d86'; context.lineWidth = 1; context.setLineDash([3, 3]);
  if(!HAS_SPACE) context.strokeRect(px(LOFT.minX), py(LOFT.minZ), (LOFT.maxX - LOFT.minX) / frame.range * radius, (LOFT.maxZ - LOFT.minZ) / frame.range * radius);
  context.setLineDash([]);
  context.strokeStyle = '#819a8c';
  for(const flight of RADAR_PLAN.flights) {
    context.strokeRect(px(flight.minX),py(flight.minZ),(flight.maxX-flight.minX)/frame.range*radius,(flight.maxZ-flight.minZ)/frame.range*radius);
    for (let index=1;index<4;index++) {
      const z=flight.minZ+(flight.maxZ-flight.minZ)*index/4;
      context.beginPath();context.moveTo(px(flight.minX),py(z));context.lineTo(px(flight.maxX),py(z));context.stroke();
    }
  }
  for (const door of frame.doors) {
    if (!finitePosition(door)) continue;
    const alongX = door.id === 'north' || door.id === 'south';
    const breached = Array.isArray(door.boards) ? door.boards.slice(0,4).every(hp=>hp<=0) : door.hp<=0;
    // A disabled entrance is continuous cabin wall, with the same plan style.
    context.strokeStyle = door.sealed ? '#90a68e' : breached ? '#d36f50' : '#caaa6c'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(px(door.x - (alongX ? DOOR_OPENING.width / 2 : 0)), py(door.z - (alongX ? 0 : DOOR_OPENING.width / 2)));
    context.lineTo(px(door.x + (alongX ? DOOR_OPENING.width / 2 : 0)), py(door.z + (alongX ? 0 : DOOR_OPENING.width / 2))); context.stroke();
  }
  const floorMark = (point, x, y) => {
    if (!point.floor) return;
    context.fillStyle = '#eef5df'; context.font = 'bold 10px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(point.floor > 0 ? '↑' : '↓', x + 7, y - 5);
  };
  if (frame.level < 3) {
    const severity = { none: 0, few: 1, group: 2, horde: 3 };
    const values = frame.level === 1 ? [frame.presence] : frame.sectors;
    values.forEach((value, index) => {
      const strength = severity[value]; if (!strength) return;
      const angle = frame.level === 1 ? 0 : index * Math.PI / 2 - Math.PI / 2;
      context.fillStyle = `rgba(255,176,74,${.08 + strength * .06})`; context.beginPath(); context.moveTo(half, half);
      context.arc(half, half, radius * .92, angle - (frame.level === 1 ? Math.PI : Math.PI / 4), angle + (frame.level === 1 ? Math.PI : Math.PI / 4)); context.closePath(); context.fill();
    });
  }
  for (const point of frame.enemies) {
    const x = half + point.x * radius, y = half + point.y * radius, r = point.shape === 'boss' ? 5.5 : point.shape === 'brute' ? 4.5 : 3;
    if (point.shape === 'raider') {
      // Raiders are a fixed faction cross, never a family dot: dark outline, then red.
      const cross = () => { context.beginPath(); context.moveTo(x-4, y-4); context.lineTo(x+4, y+4); context.moveTo(x+4, y-4); context.lineTo(x-4, y+4); context.stroke(); };
      context.lineCap = 'round'; context.strokeStyle = '#07100d'; context.lineWidth = 4.2; cross();
      context.strokeStyle = point.color; context.lineWidth = 2.4; cross(); context.lineCap = 'butt';
      floorMark(point,x,y); continue;
    }
    context.fillStyle = point.color; context.strokeStyle = '#f4e9d2'; context.lineWidth = .7; context.beginPath();
    if (point.shape === 'boss' || point.shape === 'brute') {
      context.moveTo(x, y-r); context.lineTo(x+r, y); context.lineTo(x, y+r); context.lineTo(x-r, y); context.closePath();
    } else if (point.shape === 'armored') context.rect(x-r, y-r, r*2, r*2);
    else if (point.shape === 'crawler') { context.moveTo(x-r, y+r); context.lineTo(x+r, y+r); context.lineTo(x, y-r); context.closePath(); }
    else context.arc(x, y, r, 0, Math.PI*2);
    context.fill(); context.stroke();
    if (point.shape === 'boss') { context.beginPath(); context.arc(x,y,r+2,0,Math.PI*2); context.stroke(); }
    floorMark(point,x,y);
    if (point.health !== undefined) {
      context.fillStyle = '#263a30'; context.fillRect(x - 7, y + 6, 14, 2);
      context.fillStyle = '#b5e69b'; context.fillRect(x - 7, y + 6, 14 * point.health, 2);
      if (point.hp !== undefined) { context.fillStyle = '#e4eed9'; context.font = '8px Arial'; context.fillText(`${Math.ceil(point.hp)}/${point.maxHp}`, x, y + 17); }
    }
  }
  for (const point of frame.allies) {
    const markerRadius = point.edge ? radius-5 : radius;
    const x = half + point.x * markerRadius, y = half + point.y * markerRadius;
    context.save(); context.translate(x,y); context.rotate(point.edge ? Math.atan2(point.y,point.x)+Math.PI/2 : point.heading);
    context.fillStyle = point.color; context.strokeStyle = '#07100d'; context.lineWidth = 1.3;
    context.beginPath(); context.moveTo(0,-6); context.lineTo(4.5,4); context.lineTo(0,2); context.lineTo(-4.5,4); context.closePath();
    if (!point.dead) context.fill(); context.stroke(); context.restore();
    if (point.dead || point.downed) { context.strokeStyle = '#ffffff'; context.lineWidth = 1.5; context.beginPath(); context.moveTo(x-3,y); context.lineTo(x+3,y); context.moveTo(x,y-3); context.lineTo(x,y+3); context.stroke(); }
    floorMark(point,x,y);
  }
  // The white centre arrow is the radar's owner; no device marker anymore.
  context.restore();
  context.strokeStyle = '#7bba94'; context.lineWidth = 1.2; context.beginPath(); context.arc(half,half,radius,0,Math.PI*2); context.stroke();
  context.fillStyle = '#d2e6c8'; context.font = 'bold 11px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('N',half,8);
}

export function createRadarUI({ root, canvas, title, battery, legend, translate, pixelRatio = 1 }) {
  const context = canvas.getContext('2d'), size = 224, ratio = Math.max(1,Math.min(1.5,pixelRatio));
  canvas.width = Math.round(size*ratio); canvas.height = Math.round(size*ratio);
  context?.setTransform(ratio,0,0,ratio,0,0);
  const throttle = createRadarThrottle(); let visible = false, textKey = '', lastBlip = -Infinity, cachedFrame = null, pulseKey = '';
  const hide = () => {
    root.hidden = true; root.classList.remove('radar-paused');
    if (visible) context?.clearRect(0,0,size,size);
    visible = false; textKey = ''; throttle.reset();
  };
  return {
    update(snapshot, myId, { active = true, paused = false, now = performance.now(), force = false, language = '' } = {}) {
      // Hide immediately on leave, expiry or restart; otherwise derive dots at 5 Hz.
      const level = reconLevel(snapshot?.players?.find(player => player.id === myId));
      const keyNow = `${snapshot?.room}|${snapshot?.phase}|${snapshot?.wave}|${level}|${radarPulseIndex(level, snapshot?.time ?? now / 1000)}`;
      if (keyNow !== pulseKey) { pulseKey = keyNow; cachedFrame = active ? buildRadarFrame(snapshot,myId,active) : null; }
      const frame = active ? cachedFrame : null;
      if (!frame) { lastBlip = -Infinity; hide(); return false; }
      // The map blips on a fixed rhythm; level 8's one-second pulse reads as continuous.
      const interval = radarBlipSeconds(frame.level) * 1000, shown = now - lastBlip;
      if (shown >= interval) lastBlip = now;
      if (now - lastBlip >= RADAR.blipVisibleSeconds * 1000) {
        root.hidden = true; if (visible) context?.clearRect(0,0,size,size); visible = false;
        return false;
      }
      const key = `${frame.level}|${language}|${frame.level < 3 ? frame.presence : ''}`;
      root.hidden = false; root.classList.toggle('radar-paused',paused); visible = true;
      if (!throttle.ready(now,key,force)) return false;
      if (key !== textKey) {
        title.textContent = translate('radar.title',{range:RADAR.range});
        battery.textContent = frame.level >= RADAR.blipSeconds.length ? translate('radar.pulseAlways',{level:frame.level})
          : translate('radar.pulse',{level:frame.level,seconds:radarBlipSeconds(frame.level)});
        legend.textContent = frame.level < 3 ? translate(`recon.presence.${frame.presence}`) : translate('radar.legend');
        canvas.setAttribute('aria-label',translate('radar.mapDescription',{range:RADAR.range})); textKey = key;
      }
      if (context) paintRadar(context,size,frame);
      return true;
    },
    reset: hide,
  };
}
