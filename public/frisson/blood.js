// Frisson part: blood (art/frisson/DESIGN.md; the sprays: art/frisson/BLOOD-SPRAY.md).
// Pixelated blood, never realistic and never gore: every wound on a zombie
// throws chunky dark-red cube pixels from its own entry point, as much as the
// hit's damage (blood-spray.js holds the recipe); landed drops leave floor
// pixels and some stick on the walls. A small pixel-art stain where a zombie
// falls, and a few pixel splats at the screen edges when the local survivor
// is hurt. Raiders are living people, robbed or knocked out: they never bleed.
// One InstancedMesh per kind, built at install and sized by the quality
// preset; hits and frames only rewrite fixed typed arrays and instances.
//
// Nothing is allocated per hit or per frame (test frisson-blood-spray, the GC
// test). V8 boxes a double handed to or returned from a function it does not
// inline, or kept in a closure variable, so the hot path keeps its numbers in
// typed arrays (the register file F) and passes only small integers.
import * as THREE_MODULE from '/vendor/three.module.js';
import { HAS_SPACE } from '../level-config.js';
import { SPACE } from '../level-space.js';
const MINIMUM_GROUND = HAS_SPACE ? SPACE.minY : 0;
import { restingSurface, blockedAt, freeTravel, squareRests, CONTACT, FLOOR_IO, restingSurfaceIO, squareRestsIO, arcContactIO,
  openWindowAtIO, SOLID_COUNT } from './blood-floor.js';
import { SPRAY, SPRAY_MODES, BLOOD_INTENSITY, variantKnob, variantShare, sprayPlan } from './blood-spray.js';

// Dark reds only, dried to fresh: no bright cartoon red.
export const BLOOD_PALETTE = Object.freeze([0x4a0606, 0x5e0909, 0x750d0d, 0x8c1212]);
// Lambert pixels follow the lamps, the flashlight, the shadows and the fog
// like the set does; this faint glow keeps them dark red, not black, under
// the darker Frisson lights. Tone mapping stays on: nothing glows. Stains and
// floor pixels keep it; flying droplets take a little more, so a cube's
// shadowed faces stay dark red off the torch (BLOOD-SPRAY.md 2.4).
export const BLOOD_EMISSIVE = 0x1a0303;
export const BLOOD_DROPLET_EMISSIVE = 0x2a0505;
export const BLOOD = Object.freeze({
  grid: .025, gravity: 9,
  // A landed droplet shrinks away in steps; beyond `far` (deep in the fog) nothing is thrown.
  shrink: .6, shrinkSteps: 3, far: 35, stainFar: 40, delayMax: 3,
  stain: Object.freeze({ pixels: 32, life: Object.freeze([20, 40]), dissolve: 4, grow: .45, lift: .004 }),
});
// Pools, the droplets one frame may throw, and the tables of the sprays
// (BLOOD-SPRAY.md 3.1). Droplets, perFrame and spots grow with the knob. The
// low and medium droplet pools hold what four minigunners into a horde keep
// in the air at once (the bench, 5.2): 256 and 384 recycled 40 % and .3 % of
// the throws in flight (review round 2), 384 and 448 hold them.
export const BLOOD_BUDGETS = Object.freeze({
  low: Object.freeze({ droplets: 384, perFrame: 80, spots: 256, stains: 8, splats: 6, pending: 256, sprays: 64, zombies: 64 }),
  medium: Object.freeze({ droplets: 448, perFrame: 112, spots: 448, stains: 14, splats: 8, pending: 256, sprays: 64, zombies: 64 }),
  high: Object.freeze({ droplets: 512, perFrame: 128, spots: 640, stains: 20, splats: 10, pending: 256, sprays: 64, zombies: 64 }),
});
// A stain: `core` 5 cm blocks in one connected blob, then `specks` of 2.5 cm
// flicked further along the fall, centred `along` metres past the feet
// (under the fallen torso). Bosses are a bit larger.
export const STAIN_SHAPES = Object.freeze({
  crawler: Object.freeze({ core: Object.freeze([5, 7]), specks: Object.freeze([3, 4]), along: .35 }),
  walker: Object.freeze({ core: Object.freeze([10, 14]), specks: Object.freeze([4, 6]), along: .75 }),
  brute: Object.freeze({ core: Object.freeze([14, 18]), specks: Object.freeze([5, 7]), along: .9 }),
  boss: Object.freeze({ core: Object.freeze([17, 22]), specks: Object.freeze([7, 10]), along: 1 }),
});
// Screen splats: a canvas 160 pixels wide stretched over the view with
// nearest-neighbour scaling, under the HUD; pre-painted sprites fade in steps.
// Only wounds bleed: no splat for the rain outside, a fall or a raider's blow
// (raiders rob and knock out).
export const SPLATS = Object.freeze({ width: 160, sprite: 24, life: Object.freeze([1.3, 2.1]), lowHealth: .35, lowLife: 1.6,
  minDamage: 6, spacing: .18, alpha: .85, steps: 6, zIndex: 3, bloodless: Object.freeze(['outside', 'fall', 'raider']) });
// Layers of a spray, in throw order after the puffs (BLOOD-SPRAY.md 2.3).
export const BLOOD_LAYERS = Object.freeze(['puff', 'back', 'exit', 'fountain', 'kill']);
// Floor and wall pixels: 0 the floor, then the wall faces +x, -x, +z, -z.
export const SPOT_FACES = Object.freeze(['floor', '+x', '-x', '+z', '-z']);
const FINISHED = Object.freeze(['victory', 'gameover']);
// The rotation of each spot face (SPOT_FACES), column-major 3×3.
const FACE_BASIS = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0, 0, 0, 1,
  1, 0, 0, 0, 0, 1, 0, -1, 0, 1, 0, 0, 0, 0, -1, 0, 1, 0]);

const CSS = BLOOD_PALETTE.map(hex => `#${hex.toString(16).padStart(6, '0')}`);
const HOOKS = Object.freeze(['impact', 'death', 'frame', 'hurt']);
const finite = Number.isFinite;
const pick = (random, range) => range[0] + Math.floor(random() * (range[1] - range[0] + 1));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
// Within a tread of the stain's floor: no pixel hangs over an edge.
const sameFloor = (x, z, floor) => Math.abs(restingSurface(x, z, floor + .25) - floor) <= .22;

const PUFF = 0, BACK = 1, EXIT = 2, FOUNTAIN = 3, KILL = 4;
// The spot budget a layer draws on: back, exit, or kill (the fountain's too).
const SPOT_OF = Object.freeze([-1, 0, 1, 2, 2]);
const BULLET = 0, MELEE = 1, BLAST = 2, LEGACY = 3;
const STUCK = 1, PUFFED = 2;
const DEG = Math.PI / 180, TAU = Math.PI * 2;
const TAN_FOV = Math.tan(SPRAY.fov / 2 * DEG);
const CONE_INNER = SPRAY.cone.inner * DEG, CONE_SPAN = (SPRAY.cone.outer - SPRAY.cone.inner) * DEG;
// The shooter's own near puffs and back spray: 30°-65° off -u, sideways.
const NEAR_INNER = SPRAY.cone.nearInner * DEG, NEAR_SPAN = (SPRAY.cone.outer - SPRAY.cone.nearInner) * DEG, NEAR_FAN = SPRAY.cone.nearFan * DEG;
const INSET = SPRAY.inset, TORCH = SPRAY.torch, SCREEN = SPRAY.eye.screen;
const PITCH_SIN = Math.sin(-SPRAY.exit.pitchMin * DEG), PITCH_COS = Math.cos(-SPRAY.exit.pitchMin * DEG);
const FORWARD_YAW = SPRAY.kill.forwardYaw * DEG, KILL_CLEAR = SPRAY.kill.clear * DEG, EXIT_CORE = SPRAY.exit.core * DEG;
// Cumulative colour weights of each layer (palette indices 0-3).
const COLOUR_STEPS = new Float64Array(BLOOD_LAYERS.length * 4);
BLOOD_LAYERS.forEach((layer, index) => { let sum = 0; SPRAY.colours[layer].forEach((weight, colour) => { sum += weight; COLOUR_STEPS[index * 4 + colour] = sum; }); });

export function bloodBudget(quality) {
  return BLOOD_BUDGETS[typeof quality === 'string' ? quality : quality?.id] ?? BLOOD_BUDGETS.medium;
}

// The pack's own random when the context gives none: Math.random refills its
// cache by allocating, so the game's blood draws from a xorshift here.
function ownRandom() {
  const state = new Uint32Array(1);
  state[0] = (Math.random() * 4294967296) >>> 0 || 0x9e3779b9;
  return () => { let s = state[0]; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; state[0] = s; return state[0] / 4294967296; };
}

export async function install(ctx = {}) {
  const THREE = ctx.THREE ?? THREE_MODULE, random = typeof ctx.random === 'function' ? ctx.random : ownRandom();
  const budget = bloodBudget(ctx.quality), hooks = ctx.hooks ?? {}, parent = ctx.scene ?? ctx.world?.root ?? null;
  const preset = Object.keys(BLOOD_BUDGETS).find(key => BLOOD_BUDGETS[key] === budget);
  // The knob, clamped once: pools and caps grow with it, never shrink. Its
  // variant's share (Frisson léger: half) comes on top (blood-spray.js
  // variantKnob), and also halves the stains and the screen splats (SHARE),
  // which the knob does not reach. Frisson's share is 1: nothing changes.
  const SHARE = variantShare(ctx.variant), B = variantKnob(ctx.bloodIntensity ?? BLOOD_INTENSITY, ctx.variant), grow = Math.max(1, B), rootB = Math.sqrt(B);
  const DROPS = Math.round(budget.droplets * grow), CAP = Math.round(budget.perFrame * grow), SPOTS = Math.round(budget.spots * grow);
  const TARGET = DROPS * SPRAY.governor.share;
  const PUFF_NEAR = Math.round(SPRAY.puffs.near * rootB), PUFF_FAR = Math.max(1, Math.round(SPRAY.puffs.far * rootB));
  const PUFF_MAX = Math.round(SPRAY.puffs.max * rootB);
  const camera = ctx.camera ?? null, hasCamera = !!camera?.position;
  // The camera's view (A13 by size on screen): its forward axis, when it can tell it.
  const looks = hasCamera && typeof camera.getWorldDirection === 'function', forward = looks ? new THREE.Vector3() : null;
  const PUFF_PRESSED = Math.max(1, Math.round(SPRAY.puffs.pressed * rootB));
  const onDroplet = typeof ctx.onDroplet === 'function' ? ctx.onDroplet : null, onSpray = typeof ctx.onSpray === 'function' ? ctx.onSpray : null;

  const group = new THREE.Group(); group.name = 'frissonBlood';
  // The knob and the share this install draws with, for the end-to-end check
  // in a real page (validation/frisson-e2e.mjs): Frisson 1 and 1, Frisson
  // léger .5 and .5.
  group.userData.knob = B; group.userData.share = SHARE;
  const matrix = new THREE.Matrix4(), hidden = new THREE.Matrix4().makeScale(0, 0, 0), color = new THREE.Color();
  const pool = (name, geometry, material, count) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let index = 0; index < count; index++) { mesh.setMatrixAt(index, hidden); mesh.setColorAt(index, color.setHex(BLOOD_PALETTE[0])); }
    group.add(mesh);
    return mesh;
  };
  const droplets = pool('frissonBloodDroplets', new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: BLOOD_DROPLET_EMISSIVE }), DROPS);
  const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);
  // Lifted a few millimetres and pulled forward in depth: no fight with the
  // floor. Drawn after the set without writing depth, so stains overlapping
  // on one spot layer in a fixed order instead of fighting each other.
  const stainMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: BLOOD_EMISSIVE,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  const stains = pool('frissonBloodStains', flat, stainMaterial, budget.stains * BLOOD.stain.pixels);
  stains.renderOrder = 1;
  // Floor and wall pixels share the stains' material (one more draw, no new
  // program) but not their geometry: two instanced meshes on one geometry
  // make three re-point the vertex arrays at every draw (the perf review).
  const spotFlat = flat.clone();
  const spots = pool('frissonBloodSpots', spotFlat, stainMaterial, SPOTS);
  spots.renderOrder = 1;
  // The palette in the renderer's working colour space, written straight
  // into the instance colours (no Color call per droplet).
  const LINEAR = new Float32Array(BLOOD_PALETTE.length * 3);
  BLOOD_PALETTE.forEach((hex, index) => { color.setHex(hex); LINEAR[index * 3] = color.r; LINEAR[index * 3 + 1] = color.g; LINEAR[index * 3 + 2] = color.b; });
  const dropMatrix = droplets.instanceMatrix.array, dropColour = droplets.instanceColor.array;
  const spotMatrix = spots.instanceMatrix.array, spotColourArray = spots.instanceColor.array;

  // The register file: every number that crosses a call or outlives one.
  const F = new Float64Array(80);
  const NOW = 0, FRAME_TIME = 1, GOV = 2, PUFFS_RECENT = 3, WANTED_RECENT = 4, GOV_CARRY = 5, CAM_X = 6, CAM_Y = 7, CAM_Z = 8, FOV_K = 9,
    CLOSEST = 10, T_X = 11, T_Y = 12, T_Z = 13, T_VX = 14, T_VY = 15, T_VZ = 16, T_START = 17,
    S_TIME = 18, S_FLOOR = 19, S_VX = 20, S_VY = 21, S_VZ = 22, S_Y = 23, W_X = 24, W_Y = 25, W_Z = 26,
    A_X = 27, A_Y = 28, A_Z = 29, D_X = 30, D_Y = 31, D_Z = 32, D_RATIO = 33, THETA = 34, VMAX = 35,
    P_X = 36, P_Y = 37, P_Z = 38, P_APPEAR = 39, P_END = 40, ARC_MIN = 41, SPOT_CHANGE = 42, SHOT = 43, SEQ = 44,
    Q_X = 45, Q_Y = 46, Q_Z = 47, Q_UX = 48, Q_UY = 49, Q_UZ = 50, Q_DUE = 51,
    U_X = 52, U_Y = 53, U_Z = 54, C_X = 55, C_Y = 56, C_Z = 57, E_X = 58, E_Y = 59, E_Z = 60, H_X = 61, H_Z = 62, SPRAY_I = 63,
    WANTED_BEFORE = 64, FWD_X = 65, FWD_Y = 66, FWD_Z = 67, TAN_D = 68, SCREEN_ONE = 69, SCREEN_TWO = 70, SCREEN_REACH = 71, ARC_DEPTH = 72,
    SKIN = 73, SKIN_Y = 74, SKIN_TALL = 75;
  const G2 = new Float64Array(4);
  const SPRAY_DEFF = 0, SPRAY_SCALE = 1, SPRAY_SHARE = 2;
  F[GOV] = 1; F[CLOSEST] = Infinity; F[SPOT_CHANGE] = Infinity; F[FRAME_TIME] = Number.NaN; F[FOV_K] = 1;
  F[FWD_Z] = -1; F[SCREEN_ONE] = F[SCREEN_TWO] = F[SCREEN_REACH] = 0; F[ARC_DEPTH] = Infinity;
  let snapshot = null, survivor = null, phase = null, removed = false;
  let thrownFrame = 0, thrownTotal = 0, dropped = 0, recycledInAir = 0, currentSpray = 0, stuckFace = 0, flushedFull = 0, pendingFull = 0;
  const delayOf = value => finite(value) ? clamp(value, 0, BLOOD.delayMax) : 0;

  // Raiders are people: no blood. A kill or a hit names its enemy; a bare
  // hit point goes to the nearest enemy of the latest snapshot. Raiders seen
  // lately are remembered: a delayed kill burst (a rocket) may come after
  // the snapshots have dropped its raider.
  const RAIDERS = 32, raiderIds = new Array(RAIDERS).fill(null);
  let raiderNext = 0;
  function rememberRaiders(enemies) {
    if (!Array.isArray(enemies)) return;
    for (let index = 0; index < enemies.length; index++) {
      const id = enemies[index]?.kind === 'raider' ? enemies[index].id : null;
      if (id === undefined || id === null || raiderIds.includes(id)) continue;
      raiderIds[raiderNext] = id; raiderNext = (raiderNext + 1) % RAIDERS;
    }
  }
  function raiderAt(event) {
    if (event.raider === true) return true;
    const id = event.zombieId;
    if (id !== undefined && id !== null && raiderIds.includes(id)) return true;
    const enemies = snapshot?.zombies;
    if (!Array.isArray(enemies)) return false;
    if (id !== undefined && id !== null) {
      for (let index = 0; index < enemies.length; index++) if (enemies[index]?.id === id) return enemies[index].kind === 'raider';
    }
    let nearest = null, gap = 1.44;
    for (let index = 0; index < enemies.length; index++) {
      const enemy = enemies[index];
      if (!enemy || !finite(enemy.x) || !finite(enemy.z)) continue;
      const dx = enemy.x - event.x, dz = enemy.z - event.z, distance = dx * dx + dz * dz, feet = finite(enemy.y) ? enemy.y : 0;
      if (distance < gap && event.y >= feet - .3 && event.y <= feet + (finite(enemy.height) ? enemy.height : 2) + .3) { gap = distance; nearest = enemy; }
    }
    return nearest?.kind === 'raider';
  }

  // Droplets: a ballistic arc solved once at throw time, a rest on whatever
  // it first comes down on, then a shrink in pixel steps. Its first 40 ms run
  // at double speed along that arc (a spurt). A new droplet takes a landed or
  // ended slot among the next SPRAY.governor.scan (128) before it reuses one
  // still in the air.
  const dropStart = new Float64Array(DROPS).fill(-Infinity), dropLand = new Float32Array(DROPS), dropLandReal = new Float32Array(DROPS);
  const dropEnd = new Float32Array(DROPS), dropSize = new Float32Array(DROPS), dropShrink = new Float32Array(DROPS);
  const dropFrom = new Float32Array(DROPS * 3), dropVelocity = new Float32Array(DROPS * 3), dropRest = new Float32Array(DROPS * 3);
  const dropShown = new Uint8Array(DROPS), dropFlags = new Uint8Array(DROPS);
  let dropNext = 0, dropsAwake = false, dropsShown = 0;
  const contact = { kind: CONTACT.NONE, time: .5, top: .5, low: .5, enter: .5, bottom: .5, minX: .5, maxX: .5, minZ: .5, maxZ: .5, normalX: 0, normalZ: 0, index: -1 };
  const GRID = BLOOD.grid, GRAVITY = BLOOD.gravity, SNAP = SPRAY.snap, EYE = SPRAY.eye, SPOT = SPRAY.spots;
  const traceInfo = onDroplet ? { layer: '', cells: 0, colour: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, time: 0, start: 0, land: 0,
    stuck: false, dropped: false, puff: false, spray: 0, closest: 0, spot: false, end: 0 } : null;
  // The spray's random numbers come from a buffer filled 256 at a time: a
  // number returned by ctx.random through a call V8 does not inline would
  // be a heap allocation, an index into this buffer never is.
  const RANDOM = new Float64Array(256);
  let randomAt = RANDOM.length;
  // Called once every 256 draws: compiled on its own, with ctx.random inlined.
  function refill() {
    for (let index = 0; index < RANDOM.length; index++) RANDOM[index] = random();
    randomAt = 0;
  }
  function draw() {
    if (randomAt === RANDOM.length) refill();
    return randomAt++;
  }
  function pickColour(layer) {
    const roll = RANDOM[draw()], base = layer * 4;
    for (let colour = 0; colour < 3; colour++) if (roll < COLOUR_STEPS[base + colour]) return colour;
    return 3;
  }
  // Cells of a flying droplet at the spray's d_eff and intensity (blood-spray.js cellsFor).
  function cellsAt() {
    const distance = G2[SPRAY_DEFF], cells = SPRAY.cells;
    if (distance > cells.three) return 3;
    if (distance > cells.two) return 2;
    const I = F[SPRAY_I], weights = I < cells.weights[0][0] ? cells.weights[0][1] : I < cells.weights[1][0] ? cells.weights[1][1] : cells.weights[2][1];
    return RANDOM[draw()] < weights[0] ? 1 : 2;
  }
  // A direction in a cone around the axis A (unit), written to D: exit
  // false, 25°-65° off it (the back spray and puffs); exit true, theta·√U
  // off it (THETA), with D_RATIO = that angle / theta. The azimuth is uniform;
  // the half below the axis is squeezed (.6) toward the horizontal, so the
  // cone leans up a little and every angle off the axis stays as drawn.
  // `lateral` (the shooter's own puffs and back spray, at any distance; a
  // little faster within 3 m): 40°-65° off it, the azimuth within ±60° of
  // the horizontal on either side, so the ring opens sideways around the
  // reticle and nothing rises over it to fall back through it (A13). `hollow` (his own exit spray): at least
  // EXIT_CORE off its axis, his line of sight, and the same sideways azimuth,
  // so no arc rises and falls back across the line he looks down.
  let lateral = false, hollow = false;
  function coneDirection(exit) {
    const wx = F[A_X], wy = F[A_Y], wz = F[A_Z], across = Math.sqrt(wx * wx + wz * wz);
    let ax = 1, az = 0;
    if (across > 1e-6) { ax = -wz / across; az = wx / across; }
    let bx = wy * az, by = wz * ax - wx * az, bz = -wy * ax;
    const length = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
    bx /= length; by /= length; bz /= length;
    if (by < 0) { bx = -bx; by = -by; bz = -bz; }
    let alpha, ratio = 0;
    if (exit) { ratio = Math.sqrt(RANDOM[draw()]); alpha = hollow ? EXIT_CORE + (F[THETA] - EXIT_CORE) * ratio : F[THETA] * ratio; }
    else alpha = lateral ? NEAR_INNER + RANDOM[draw()] * NEAR_SPAN : CONE_INNER + RANDOM[draw()] * CONE_SPAN;
    const phi = (!exit && lateral) || (exit && hollow) ? (RANDOM[draw()] < .5 ? 0 : Math.PI) + (RANDOM[draw()] * 2 - 1) * NEAR_FAN : RANDOM[draw()] * TAU;
    let c = Math.cos(phi), s = Math.sin(phi);
    if (s < 0) { s *= exit ? SPRAY.exit.down : SPRAY.cone.down; const norm = Math.sqrt(c * c + s * s); c /= norm; s /= norm; }
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    F[D_X] = wx * ca + (ax * c + bx * s) * sa; F[D_Y] = wy * ca + by * s * sa; F[D_Z] = wz * ca + (az * c + bz * s) * sa; F[D_RATIO] = ratio;
  }

  // The landing solver (unchanged in substance): the whole arc from T is
  // checked against walls, furniture, the loft floor and the treads: it lands
  // on the first top it comes down on (aimed a little so its centre is on
  // it), or the ground. Running into a side shortens the throw to drop at
  // its foot, or (first contact, 2 cells or more, its layer still has spots,
  // 60 %) sticks there; rising into an underside lowers it. A throw still
  // blocked after that falls straight down. Writes S and, for a stuck
  // droplet, its wall pixel W and stuckFace; returns 1 when it sticks.
  function solve(cells, layer, allowStick) {
    const half = cells * GRID / 2, x = F[T_X], z = F[T_Z], spotLayer = SPOT_OF[layer], spotsLeft = spotLayer >= 0 ? spotLeft[spotLayer] : 0;
    let vx = F[T_VX], vy = F[T_VY], vz = F[T_VZ];
    FLOOR_IO[0] = x; FLOOR_IO[1] = F[T_Y]; FLOOR_IO[2] = z; restingSurfaceIO();
    const y = Math.max(F[T_Y], FLOOR_IO[9] + half + .01);
    let time = 0, floor = MINIMUM_GROUND, stuck = 0;
    for (let pass = 0; ; pass++) {
      if (pass === 6) {
        FLOOR_IO[0] = x; FLOOR_IO[1] = y; FLOOR_IO[2] = z; restingSurfaceIO();
        floor = FLOOR_IO[9]; vx = vz = vy = 0; time = Math.sqrt(Math.max(0, 2 * GRAVITY * (y - floor - half))) / GRAVITY;
        break;
      }
      const ground = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * GRAVITY * (y - MINIMUM_GROUND - half)))) / GRAVITY;
      FLOOR_IO[0] = x; FLOOR_IO[1] = y; FLOOR_IO[2] = z; FLOOR_IO[3] = vx; FLOOR_IO[4] = vy; FLOOR_IO[5] = vz;
      FLOOR_IO[6] = GRAVITY; FLOOR_IO[7] = half; FLOOR_IO[8] = ground;
      arcContactIO(contact);
      if (contact.kind === CONTACT.NONE) { time = ground; floor = MINIMUM_GROUND; break; }
      if (contact.kind === CONTACT.TOP) {
        const landX = x + vx * contact.time, landZ = z + vz * contact.time;
        const loX = contact.minX + .001, hiX = contact.maxX - .001, loZ = contact.minZ + .001, hiZ = contact.maxZ - .001;
        const onX = landX < loX ? loX : landX > hiX ? hiX : landX, onZ = landZ < loZ ? loZ : landZ > hiZ ? hiZ : landZ;
        if (onX === landX && onZ === landZ) { time = contact.time; floor = contact.top; break; }
        vx = (onX - x) / contact.time; vz = (onZ - z) / contact.time;
        continue;
      }
      if (contact.kind === CONTACT.CEILING) { vy = Math.sqrt(Math.max(0, 2 * GRAVITY * (contact.low - .005 - y))); continue; }
      if (allowStick && pass === 0 && cells >= 2 && spotsLeft > 0 && contact.index >= 0 && contact.index < SOLID_COUNT && (contact.normalX !== 0 || contact.normalZ !== 0)) {
        const t = contact.time, size = cells * GRID, inner = size / 2;
        const hitX = x + vx * t, hitY = y + vy * t - GRAVITY * t * t / 2, hitZ = z + vz * t;
        const wide = contact.normalX !== 0 ? contact.maxZ - contact.minZ : contact.maxX - contact.minX;
        if (contact.top - contact.bottom >= size && wide >= size && RANDOM[draw()] < SPOT.stick) {
          let px, pz;
          if (contact.normalX !== 0) {
            const lo = contact.minZ + inner, hi = contact.maxZ - inner;
            px = (contact.normalX > 0 ? contact.maxX : contact.minX) + contact.normalX * SPOT.gap; pz = hitZ < lo ? lo : hitZ > hi ? hi : hitZ;
          } else {
            const lo = contact.minX + inner, hi = contact.maxX - inner;
            pz = (contact.normalZ > 0 ? contact.maxZ : contact.minZ) + contact.normalZ * SPOT.gap; px = hitX < lo ? lo : hitX > hi ? hi : hitX;
          }
          const low = contact.bottom + inner, high = contact.top - inner, py = hitY < low ? low : hitY > high ? high : hitY;
          FLOOR_IO[0] = px; FLOOR_IO[1] = py; FLOOR_IO[2] = pz;
          if (!openWindowAtIO()) {
            F[W_X] = px; F[W_Y] = py; F[W_Z] = pz;
            stuckFace = contact.normalX > 0 ? 1 : contact.normalX < 0 ? 2 : contact.normalZ > 0 ? 3 : 4;
            time = t; stuck = 1;
            break;
          }
        }
      }
      const speed = Math.sqrt(vx * vx + vz * vz), keep = speed > 1e-9 ? Math.max(0, speed * contact.enter - half - .005) / (speed * ground) : 0;
      vx *= keep; vz *= keep;
    }
    F[S_TIME] = time; F[S_FLOOR] = floor; F[S_VX] = vx; F[S_VY] = vy; F[S_VZ] = vz; F[S_Y] = y;
    return stuck;
  }
  // The solved arc's closest pass to the camera, into ARC_MIN: the distance
  // to the chords between eight samples, less the most an arc can bow away
  // from its chord (g·Δt²/8), so it never reads farther than it is.
  function arcClosest() {
    const x = F[T_X], y = F[S_Y], z = F[T_Z], vx = F[S_VX], vy = F[S_VY], vz = F[S_VZ], end = F[S_TIME];
    const cx = F[CAM_X], cy = F[CAM_Y], cz = F[CAM_Z], steps = EYE.samples - 1, step = end / steps;
    let px = x, py = y, pz = z, best = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy) + (z - cz) * (z - cz));
    for (let sample = 1; step > 0 && sample <= steps; sample++) {
      const t = step * sample, qx = x + vx * t, qy = y + vy * t - GRAVITY * t * t / 2, qz = z + vz * t;
      const sx = qx - px, sy = qy - py, sz = qz - pz, length = sx * sx + sy * sy + sz * sz;
      let along = length > 1e-12 ? ((cx - px) * sx + (cy - py) * sy + (cz - pz) * sz) / length : 0;
      along = along < 0 ? 0 : along > 1 ? 1 : along;
      const dx = px + sx * along - cx, dy = py + sy * along - cy, dz = pz + sz * along - cz, gap = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (gap < best) best = gap;
      px = qx; py = qy; pz = qz;
    }
    F[ARC_MIN] = best - GRAVITY * step * step / 8;
  }
  // The solved arc's nearest depth inside the camera's view, into ARC_DEPTH
  // (Infinity when it never comes into view near enough to matter). The view
  // is the cone around the camera's axis through the frame's corners.
  function arcDepth() {
    F[ARC_DEPTH] = Infinity;
    if (!looks || !(F[ARC_MIN] < F[SCREEN_REACH])) return;
    const x = F[T_X], y = F[S_Y], z = F[T_Z], vx = F[S_VX], vy = F[S_VY], vz = F[S_VZ], end = F[S_TIME];
    const cx = F[CAM_X], cy = F[CAM_Y], cz = F[CAM_Z], fx = F[FWD_X], fy = F[FWD_Y], fz = F[FWD_Z], wide = F[TAN_D] * F[TAN_D];
    const steps = SCREEN.samples;
    // Where the arc comes into view (or leaves it) between two samples, the
    // nearer of the two depths stands for the crossing.
    let best = Infinity, before = Infinity, seen = false;
    for (let sample = 0; sample <= steps; sample++) {
      const t = end * sample / steps, dx = x + vx * t - cx, dy = y + vy * t - GRAVITY * t * t / 2 - cy, dz = z + vz * t - cz;
      const depth = dx * fx + dy * fy + dz * fz;
      const inside = depth > 0 && dx * dx + dy * dy + dz * dz - depth * depth <= depth * depth * wide;
      if (inside && depth < best) best = depth;
      if (sample > 0 && inside !== seen) { const near = depth < before ? depth : before; if (near > 0 && near < best) best = near; }
      before = depth; seen = inside;
    }
    F[ARC_DEPTH] = best;
  }
  // The solved arc's speed toward the camera (from T_X, S_Y, T_Z with S's
  // velocity) is within min(.5·dist, 3.5) m/s: the solver's shortening of a
  // throw against a wall never turns it toward the eye.
  function approachFits() {
    let cx = F[CAM_X] - F[T_X], cy = F[CAM_Y] - F[S_Y], cz = F[CAM_Z] - F[T_Z];
    const distance = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (distance <= 1e-6) return false;
    cx /= distance; cy /= distance; cz /= distance;
    return F[S_VX] * cx + F[S_VY] * cy + F[S_VZ] * cz <= Math.min(EYE.approach * distance, EYE.approachMax) + 1e-6;
  }
  // One droplet from T (start T_START) of `cells`, `layer` and palette
  // `colour`. The camera rule first (BLOOD-SPRAY.md 2.3, for every droplet of
  // every shooter): the speed toward the local camera is cut to its cap, an
  // arc passing within 1.2 m is one cell, and one passing within .45 m is
  // dropped (counted as thrown, no slot). Returns 1 when it got a slot.
  function throwDroplet(cells, layer, colour, puffed) {
    thrownFrame++; thrownTotal = (thrownTotal + 1) & 0x3fffffff;
    if (hasCamera) {
      let cx = F[CAM_X] - F[T_X], cy = F[CAM_Y] - F[T_Y], cz = F[CAM_Z] - F[T_Z];
      const distance = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (distance > 1e-6) {
        cx /= distance; cy /= distance; cz /= distance;
        const toward = F[T_VX] * cx + F[T_VY] * cy + F[T_VZ] * cz, most = Math.min(EYE.approach * distance, EYE.approachMax);
        if (toward > most) { const cut = toward - most; F[T_VX] -= cx * cut; F[T_VY] -= cy * cut; F[T_VZ] -= cz * cut; }
      }
    }
    let stuck = solve(cells, layer, true), keep = true;
    if (hasCamera) {
      arcClosest(); arcDepth();
      if (cells > 1 && F[ARC_MIN] >= EYE.clearance && (F[ARC_MIN] < EYE.oneCell || F[ARC_DEPTH] < F[SCREEN_TWO] * cells / 2)) {
        cells = 1; stuck = solve(1, layer, false); arcClosest(); arcDepth();
      }
      keep = F[ARC_MIN] >= EYE.clearance && F[ARC_DEPTH] >= F[SCREEN_ONE] && approachFits();
    }
    if (!keep) { dropped++; if (onDroplet) trace(-1, cells, layer, colour, puffed, 0, false); return 0; }
    if (hasCamera && F[ARC_MIN] < F[CLOSEST]) F[CLOSEST] = F[ARC_MIN];
    // The slot: a landed or ended one among the next eight, else the next.
    const now = F[NOW];
    let index = -1;
    for (let scan = 0; scan < SPRAY.governor.scan; scan++) {
      const slot = (dropNext + scan) % DROPS;
      if (now - dropStart[slot] >= dropLandReal[slot]) { index = slot; break; }
    }
    if (index < 0) {
      index = dropNext;
      const age = now - dropStart[index];
      if (age < dropEnd[index]) recycledInAir++;
    }
    dropNext = (index + 1) % DROPS;
    const at = index * 3, time = F[S_TIME], real = time > 2 * SNAP ? time - SNAP : time / 2, start = F[T_START];
    dropStart[index] = start; dropLand[index] = time; dropLandReal[index] = real; dropSize[index] = cells * GRID;
    dropFrom[at] = F[T_X]; dropFrom[at + 1] = F[S_Y]; dropFrom[at + 2] = F[T_Z];
    dropVelocity[at] = F[S_VX]; dropVelocity[at + 1] = F[S_VY]; dropVelocity[at + 2] = F[S_VZ];
    // Under the torch's hot spot near the camera, the colour is dimmed so the
    // droplet reads as dark blood, never as bright red (2.4, B8).
    let expo = 1;
    if (hasCamera) {
      const ex = F[T_X] - F[CAM_X], ey = F[T_Y] - F[CAM_Y], ez = F[T_Z] - F[CAM_Z], away = Math.sqrt(ex * ex + ey * ey + ez * ez) / TORCH.full;
      expo = away >= 1 ? 1 : away > TORCH.floor ? away : TORCH.floor;
    }
    const c = colour * 3, o = index * 3;
    dropColour[o] = LINEAR[c] * expo; dropColour[o + 1] = LINEAR[c + 1] * expo; dropColour[o + 2] = LINEAR[c + 2] * expo;
    droplets.instanceColor.needsUpdate = true;
    dropsAwake = true;
    const g = F[GOV], spotLayer = SPOT_OF[layer];
    let spotted = false;
    if (stuck) {
      // It ends on the wall: a wall pixel from the contact, maybe a drip.
      dropFlags[index] = STUCK; dropEnd[index] = real; dropShrink[index] = BLOOD.shrink;
      dropRest[at] = F[W_X]; dropRest[at + 1] = F[W_Y]; dropRest[at + 2] = F[W_Z];
      spotLeft[spotLayer]--; spotted = true;
      const pixel = colour > SPOT.minColour + 1 ? colour - 1 : SPOT.minColour;
      F[P_X] = F[W_X]; F[P_Y] = F[W_Y]; F[P_Z] = F[W_Z]; F[P_APPEAR] = start + real;
      F[P_END] = F[P_APPEAR] + SPOT.life[0] + RANDOM[draw()] * (SPOT.life[1] - SPOT.life[0]);
      writeSpot(stuckFace, cells, pixel);
      if (RANDOM[draw()] < SPOT.drip) drip(cells, pixel);
    } else {
      dropFlags[index] = puffed ? PUFFED : 0;
      const restX = F[T_X] + F[S_VX] * time, restZ = F[T_Z] + F[S_VZ] * time, floor = F[S_FLOOR];
      dropRest[at] = restX; dropRest[at + 1] = floor; dropRest[at + 2] = restZ;
      // A landed cube rests (small ones longer), shorter under load; puffs
      // under pressure shrink as soon as they land.
      if (puffed && g < SPRAY.governor.press) { dropShrink[index] = SPRAY.governor.pressShrink; dropEnd[index] = real + SPRAY.governor.pressShrink; }
      else {
        const rest = cells === 1 ? SPRAY.rest.small : SPRAY.rest.large, scale = g > SPRAY.governor.rest ? g : SPRAY.governor.rest;
        dropShrink[index] = BLOOD.shrink; dropEnd[index] = real + (rest[0] + RANDOM[draw()] * (rest[1] - rest[0])) * scale + BLOOD.shrink;
      }
      // A floor pixel where it lands, while its layer has spots.
      if (spotLayer >= 0 && spotLeft[spotLayer] > 0 && (cells >= 2 || RANDOM[draw()] < SPOT.small)) {
        let near = true;
        if (hasCamera) {
          const dx = restX - F[CAM_X], dy = floor - F[CAM_Y], dz = restZ - F[CAM_Z];
          near = Math.sqrt(dx * dx + dy * dy + dz * dz) * F[FOV_K] <= SPOT.far;
        }
        if (near) {
          const vy = F[S_VY] - GRAVITY * time, speed = Math.sqrt(F[S_VX] * F[S_VX] + F[S_VZ] * F[S_VZ] + vy * vy);
          let size = speed > SPOT.fast ? cells + 1 : cells;
          if (size > 3) size = 3;
          const odd = size % 2 === 1;
          const px = odd ? (Math.floor(restX / GRID) + .5) * GRID : Math.round(restX / GRID) * GRID;
          const pz = odd ? (Math.floor(restZ / GRID) + .5) * GRID : Math.round(restZ / GRID) * GRID;
          FLOOR_IO[0] = px; FLOOR_IO[1] = floor; FLOOR_IO[2] = pz; FLOOR_IO[7] = size * GRID / 2;
          if (squareRestsIO()) {
            spotLeft[spotLayer]--; spotted = true;
            F[P_X] = px; F[P_Y] = floor + BLOOD.stain.lift; F[P_Z] = pz; F[P_APPEAR] = start + real;
            F[P_END] = F[P_APPEAR] + SPOT.life[0] + RANDOM[draw()] * (SPOT.life[1] - SPOT.life[0]);
            writeSpot(0, size, colour > SPOT.minColour + 1 ? colour - 1 : SPOT.minColour);
          }
        }
      }
    }
    if (onDroplet) trace(index, cells, layer, colour, puffed, stuck, spotted);
    return 1;
  }
  // The test and tool recorder (ctx.onDroplet): one refilled object; index
  // -1 is a droplet the camera rule dropped.
  function trace(index, cells, layer, colour, puffed, stuck, spotted) {
    const info = traceInfo, lost = index < 0;
    info.layer = BLOOD_LAYERS[layer]; info.cells = cells; info.colour = colour; info.puff = !!puffed; info.spray = currentSpray;
    info.x = F[T_X]; info.y = lost ? F[T_Y] : F[S_Y]; info.z = F[T_Z]; info.vx = F[S_VX]; info.vy = F[S_VY]; info.vz = F[S_VZ];
    info.time = F[S_TIME]; info.start = F[T_START]; info.land = F[S_TIME] > 2 * SNAP ? F[S_TIME] - SNAP : F[S_TIME] / 2;
    info.stuck = !!stuck; info.dropped = lost; info.spot = !!spotted; info.closest = hasCamera ? F[ARC_MIN] : Infinity;
    info.end = lost ? 0 : dropEnd[index];
    onDroplet(info);
  }
  // A drip under a wall pixel: 1-3 one-cell pixels, each 2.5 cm lower and
  // .25 s later, in its colour, never below the surface under it + 2 cm.
  function drip(cells, colour) {
    const count = 1 + Math.floor(RANDOM[draw()] * SPOT.dripMax), top = F[W_Y] - cells * GRID / 2, appear = F[P_APPEAR], end = F[P_END];
    FLOOR_IO[0] = F[W_X]; FLOOR_IO[1] = top; FLOOR_IO[2] = F[W_Z]; restingSurfaceIO();
    const lowest = FLOOR_IO[9] + .02;
    for (let step = 1; step <= count; step++) {
      const y = top - GRID * (step - .5);
      if (y - GRID / 2 < lowest) break;
      F[P_X] = F[W_X]; F[P_Y] = y; F[P_Z] = F[W_Z]; F[P_APPEAR] = appear + SPOT.dripStep * step; F[P_END] = end;
      writeSpot(stuckFace, 1, colour);
    }
  }
  function updateDroplets() {
    if (!dropsAwake) return;
    dropsAwake = false;
    let changed = false;
    const now = F[NOW], steps = BLOOD.shrinkSteps;
    for (let index = 0; index < DROPS; index++) {
      const age = now - dropStart[index], o = index * 16;
      if (!(age >= 0 && age < dropEnd[index])) {
        if (age < 0) dropsAwake = true; // staggered: not yet out
        if (dropShown[index]) { dropMatrix[o] = dropMatrix[o + 5] = dropMatrix[o + 10] = 0; dropShown[index] = 0; dropsShown--; changed = true; }
        continue;
      }
      dropsAwake = true;
      const at = index * 3, warped = age + (age < SNAP ? age : SNAP);
      let size = dropSize[index], x, y, z;
      if (warped < dropLand[index]) {
        x = dropFrom[at] + dropVelocity[at] * warped;
        y = dropFrom[at + 1] + dropVelocity[at + 1] * warped - .5 * GRAVITY * warped * warped;
        z = dropFrom[at + 2] + dropVelocity[at + 2] * warped;
      } else if (dropFlags[index] === STUCK) {
        if (dropShown[index]) { dropMatrix[o] = dropMatrix[o + 5] = dropMatrix[o + 10] = 0; dropShown[index] = 0; dropsShown--; changed = true; }
        continue;
      } else {
        const left = dropEnd[index] - age, shrink = dropShrink[index];
        if (left < shrink) size *= Math.ceil(left / shrink * steps) / steps;
        x = dropRest[at]; y = dropRest[at + 1] + size / 2; z = dropRest[at + 2];
      }
      dropMatrix[o] = size; dropMatrix[o + 5] = size; dropMatrix[o + 10] = size;
      dropMatrix[o + 12] = x; dropMatrix[o + 13] = y; dropMatrix[o + 14] = z;
      if (!dropShown[index]) { dropShown[index] = 1; dropsShown++; }
      changed = true;
    }
    if (changed) droplets.instanceMatrix.needsUpdate = true;
    droplets.visible = dropsShown > 0;
  }

  // Floor and wall pixels ("spots", BLOOD-SPRAY.md 2.5): a ring of flat
  // squares on the stains' geometry. One that lands on a pixel among the
  // last 48 (same cell, surface and face) darkens it a palette step instead.
  const spotX = new Float32Array(SPOTS), spotY = new Float32Array(SPOTS), spotZ = new Float32Array(SPOTS), spotSize = new Float32Array(SPOTS);
  const spotAppear = new Float64Array(SPOTS), spotEnd = new Float64Array(SPOTS);
  const spotFace = new Uint8Array(SPOTS), spotColour = new Uint8Array(SPOTS), spotShown = new Uint8Array(SPOTS), spotUsed = new Uint8Array(SPOTS);
  const spotLeft = new Int32Array(3);
  const SAME = Math.min(SPOT.same, SPOTS);
  let spotNext = 0, spotsShown = 0, spotsAwake = false;
  function paintSpot(index) {
    const c = spotColour[index] * 3, o = index * 3;
    spotColourArray[o] = LINEAR[c]; spotColourArray[o + 1] = LINEAR[c + 1]; spotColourArray[o + 2] = LINEAR[c + 2];
    spots.instanceColor.needsUpdate = true;
  }
  function writeSpot(face, cells, colour) {
    const x = F[P_X], y = F[P_Y], z = F[P_Z];
    for (let back = 1; back <= SAME; back++) {
      const index = (spotNext - back + SPOTS) % SPOTS;
      if (!spotUsed[index] || spotFace[index] !== face) continue;
      if (Math.abs(spotX[index] - x) < 1e-3 && Math.abs(spotY[index] - y) < 1e-3 && Math.abs(spotZ[index] - z) < 1e-3) {
        spotColour[index] = spotColour[index] > SPOT.minColour ? spotColour[index] - 1 : SPOT.minColour;
        paintSpot(index);
        if (F[P_END] > spotEnd[index]) spotEnd[index] = F[P_END];
        if (F[P_APPEAR] < spotAppear[index]) { spotAppear[index] = F[P_APPEAR]; if (F[P_APPEAR] < F[SPOT_CHANGE]) F[SPOT_CHANGE] = F[P_APPEAR]; }
        spotsAwake = true;
        return;
      }
    }
    const index = spotNext;
    spotNext = (spotNext + 1) % SPOTS;
    if (spotShown[index]) { hideSpot(index); spots.instanceMatrix.needsUpdate = true; }
    spotUsed[index] = 1; spotX[index] = x; spotY[index] = y; spotZ[index] = z; spotSize[index] = cells * GRID; spotFace[index] = face;
    spotAppear[index] = F[P_APPEAR]; spotEnd[index] = F[P_END]; spotColour[index] = colour;
    paintSpot(index);
    if (F[P_APPEAR] < F[SPOT_CHANGE]) F[SPOT_CHANGE] = F[P_APPEAR];
    spotsAwake = true;
  }
  function hideSpot(index) {
    const o = index * 16;
    for (let k = 0; k < 15; k++) spotMatrix[o + k] = 0;
    spotMatrix[o + 15] = 1;
    spotShown[index] = 0; spotsShown--;
  }
  // A flat square of side s: the floor lies as built (normal +y); a wall
  // face turns it so its normal points out of the face (+x rotZ(-π/2), -x
  // rotZ(π/2), +z rotX(π/2), -z rotX(-π/2)), scaled (s, 1, s) first. The
  // matrices' 3×3 parts, column-major: the x and z columns times s.
  function showSpot(index) {
    const o = index * 16, s = spotSize[index], at = spotFace[index] * 9;
    for (let k = 0; k < 3; k++) {
      spotMatrix[o + k] = FACE_BASIS[at + k] * s; spotMatrix[o + 4 + k] = FACE_BASIS[at + 3 + k]; spotMatrix[o + 8 + k] = FACE_BASIS[at + 6 + k] * s;
    }
    spotMatrix[o + 3] = spotMatrix[o + 7] = spotMatrix[o + 11] = 0;
    spotMatrix[o + 12] = spotX[index]; spotMatrix[o + 13] = spotY[index]; spotMatrix[o + 14] = spotZ[index]; spotMatrix[o + 15] = 1;
    spotShown[index] = 1; spotsShown++;
  }
  // Pixels appear at their droplet's landing and end one by one; the loop
  // runs only when one is due to change.
  function updateSpots() {
    const now = F[NOW];
    if (!spotsAwake || now < F[SPOT_CHANGE]) return;
    let next = Infinity, awake = false, changed = false;
    for (let index = 0; index < SPOTS; index++) {
      if (!spotUsed[index]) continue;
      if (now >= spotEnd[index]) { if (spotShown[index]) { hideSpot(index); changed = true; } spotUsed[index] = 0; continue; }
      awake = true;
      const show = now >= spotAppear[index];
      if (show && !spotShown[index]) { showSpot(index); changed = true; }
      const at = show ? spotEnd[index] : spotAppear[index];
      if (at < next) next = at;
    }
    F[SPOT_CHANGE] = next; spotsAwake = awake;
    if (changed) spots.instanceMatrix.needsUpdate = true;
    spots.visible = spotsShown > 0;
  }

  // Pending wounds: their puffs wait in this ring until they are due.
  const PENDING = budget.pending;
  const pendDue = new Float64Array(PENDING), pendSeq = new Float64Array(PENDING), pendPoint = new Float64Array(PENDING * 3), pendDir = new Float32Array(PENDING * 3);
  const pendUsed = new Uint8Array(PENDING), pendLocal = new Uint8Array(PENDING), pendSpray = new Int16Array(PENDING), pendGen = new Int32Array(PENDING);
  let pendNext = 0, pendCount = 0;
  const dueOrder = new Int16Array(Math.max(PENDING, budget.sprays)), dueKey = new Float64Array(Math.max(PENDING, budget.sprays));
  // Open sprays: the wounds of one server event on one body (BLOOD-SPRAY.md 2.1).
  const SPRAYS = budget.sprays;
  const sprayId = new Array(SPRAYS).fill(null), sprayKind = new Array(SPRAYS).fill(null);
  const sprayUsed = new Uint8Array(SPRAYS), sprayOwn = new Uint8Array(SPRAYS), sprayKill = new Uint8Array(SPRAYS), sprayLocal = new Uint8Array(SPRAYS);
  const sprayMode = new Uint8Array(SPRAYS), sprayBoss = new Uint8Array(SPRAYS), sprayDir = new Uint8Array(SPRAYS);
  const sprayCount = new Uint16Array(SPRAYS), sprayPuffs = new Uint16Array(SPRAYS), sprayGen = new Int32Array(SPRAYS);
  const sprayShot = new Float64Array(SPRAYS), sprayDue = new Float64Array(SPRAYS), sprayDamage = new Float64Array(SPRAYS), sprayHeadPower = new Float64Array(SPRAYS);
  const sprayScale = new Float32Array(SPRAYS), sprayDistance = new Float64Array(SPRAYS);
  // Per spray, 13 sums: head weight, Σw·head point (3), body weight, Σw·body point (3), Σp·u (3), the first u (3)... (16 slots).
  const SUMS = 16, spraySums = new Float64Array(SPRAYS * SUMS);
  const planBack = new Int32Array(SPRAYS), planExit = new Int32Array(SPRAYS), planGlobs = new Int32Array(SPRAYS), planFountain = new Int32Array(SPRAYS);
  const planKill = new Int32Array(SPRAYS), planSpots = new Int32Array(SPRAYS), planWant = new Int32Array(SPRAYS), planAllot = new Int32Array(SPRAYS);
  const planTheta = new Float64Array(SPRAYS), planVmax = new Float64Array(SPRAYS), planI = new Float64Array(SPRAYS), planGiven = new Int32Array(SPRAYS);
  const planBurst = new Int32Array(SPRAYS), planRecent = new Float64Array(SPRAYS);
  let sprayGenNext = 0;
  const planIn = { damage: .5, recent: .5, headShare: .5, wounds: 0, kind: null, boss: false, mode: 'bullet', kill: false, killDone: false,
    distance: .5, local: false, carry: .5, spotCarry: .5 };
  const planOut = { puffsPerWound: 0, puffsMax: 0, burst: 0, back: 0, exit: 0, globs: 0, fountain: 0, kill: 0, spots: 0, theta: .5, vmax: .5,
    carry: .5, spotCarry: .5, intensity: .5, distanceFactor: .5 };
  const sprayInfo = onSpray ? { id: null, shot: 0, mode: '', wounds: 0, damage: 0, recent: 0, headShare: 0, local: false, kill: false, distance: 0,
    burst: 0, back: 0, exit: 0, globs: 0, fountain: 0, killBurst: 0, spots: 0, want: 0, allotted: 0, governor: 1, puffs: 0,
    headX: 0, headY: 0, headZ: 0, bodyX: 0, bodyY: 0, bodyZ: 0, serial: 0, theta: 0, vmax: 0 } : null;
  // The zombies' recent damage A, rounding carries and the kill bit.
  const ZOMBIES = budget.zombies;
  const zombieId = new Array(ZOMBIES).fill(null), zombieA = new Float64Array(ZOMBIES), zombieTime = new Float64Array(ZOMBIES);
  const zombieCarry = new Float64Array(ZOMBIES), zombieSpotCarry = new Float64Array(ZOMBIES), zombieKill = new Uint8Array(ZOMBIES);
  const zombieUsed = new Uint8Array(ZOMBIES), zombieStamp = new Int32Array(ZOMBIES);
  let zombieClock = 0;
  function findZombie(id) {
    for (let index = 0; index < ZOMBIES; index++) if (zombieUsed[index] && zombieId[index] === id) return index;
    return -1;
  }
  function takeZombie(id) {
    let index = -1, oldest = 0x7fffffff;
    for (let slot = 0; slot < ZOMBIES; slot++) {
      if (!zombieUsed[slot]) { index = slot; break; }
      if (zombieStamp[slot] < oldest) { oldest = zombieStamp[slot]; index = slot; }
    }
    zombieUsed[index] = 1; zombieId[index] = id; zombieA[index] = 0; zombieTime[index] = F[NOW];
    zombieCarry[index] = .5; zombieSpotCarry[index] = .5; zombieKill[index] = 0;
    return index;
  }

  // The skin radius per unit of scale (SPRAY.inset, 2.3) into SKIN: the
  // head's for a head hit; else by the hit's height over the body's feet in
  // the latest snapshot, as a share of its standing height (SKIN_TALL, scaled),
  // along the kind's knots; the torso's when the body is not in it. The hit's
  // height comes in SKIN_Y (no double crosses the call).
  function skinAt(table, head, id) {
    if (head) { F[SKIN] = table.head; return; }
    let feet = Number.NaN;
    const enemies = snapshot?.zombies;
    if (id !== undefined && id !== null && Array.isArray(enemies)) {
      for (let index = 0; index < enemies.length; index++) if (enemies[index]?.id === id) { const value = enemies[index].y; if (finite(value)) feet = value; break; }
    }
    if (!finite(feet) || !(F[SKIN_TALL] > 0)) { F[SKIN] = table.body; return; }
    const share = (F[SKIN_Y] - feet) / F[SKIN_TALL], knots = table.knots, last = knots.length - 1;
    if (share <= knots[0][0]) { F[SKIN] = knots[0][1]; return; }
    for (let index = 1; index <= last; index++) {
      if (share > knots[index][0]) continue;
      const low = knots[index - 1];
      F[SKIN] = low[1] + (knots[index][1] - low[1]) * (share - low[0]) / (knots[index][0] - low[0]);
      return;
    }
    F[SKIN] = knots[last][1];
  }
  // ctx.hooks.impact: one wound (BLOOD-SPRAY.md 4.3), or an old-shape call
  // without damage, mode or shot (a legacy spray of its own). The event is
  // refilled by its caller: every field is read here, at once.
  function impact(event) {
    if (removed || !event) return;
    let x = event.x, y = event.y, z = event.z;
    if (!finite(x) || !finite(y) || !finite(z) || raiderAt(event)) return;
    const kill = event.kill === true, head = event.headshot === true, local = event.local === true, damage = event.damage, name = event.mode;
    let mode = name === 'melee' ? MELEE : name === 'blast' ? BLAST : name === 'legacy' ? LEGACY : BULLET, power;
    if (typeof damage !== 'number' || !finite(damage)) { mode = LEGACY; power = kill ? SPRAY.legacy.kill : SPRAY.legacy.hit; }
    else power = damage > 0 ? damage : 0;
    let ux = finite(event.dirX) ? event.dirX : 0, uy = finite(event.dirY) ? event.dirY : 0, uz = finite(event.dirZ) ? event.dirZ : 0;
    const length = Math.sqrt(ux * ux + uy * uy + uz * uz);
    let hasDir = length > 1e-6;
    if (hasDir) { ux /= length; uy /= length; uz /= length; }
    else if (mode === BULLET || mode === MELEE) {
      // No direction given: the blow came from the camera's side.
      let dx = 1, dz = 0;
      if (hasCamera) {
        dx = x - camera.position.x; dz = z - camera.position.z;
        const across = Math.sqrt(dx * dx + dz * dz);
        if (across > 1e-6) { dx /= across; dz /= across; } else { dx = 1; dz = 0; }
      }
      ux = dx; uy = 0; uz = dz; hasDir = true;
    }
    const scale = finite(event.scale) && event.scale > 0 ? event.scale : 1;
    // The skin's distance from the body's axis at this hit (2.3): by kind,
    // and by the hit's height over the feet (the snapshot's), or the head.
    const kind = event.kind, boss = event.boss === true;
    const table = boss ? INSET.boss : kind === 'brute' ? INSET.brute : kind === 'crawler' ? INSET.crawler : kind === 'armored' ? INSET.armored : INSET.walker;
    F[SKIN_Y] = y; F[SKIN_TALL] = (boss ? INSET.heights.boss : kind === 'crawler' ? INSET.heights.crawler : INSET.heights.standing) * scale;
    skinAt(table, head, event.zombieId);
    const r = F[SKIN] * scale;
    // The server's point is on the hitbox's face: move it in along the shot
    // to the skin, r from the body's axis.
    if ((mode === BULLET || mode === MELEE) && finite(event.axisX) && finite(event.axisZ)) {
      const across = Math.sqrt(ux * ux + uz * uz);
      if (across >= .2) {
        const most = INSET.max * scale;
        let inset = ((event.axisX - x) * ux + (event.axisZ - z) * uz) / across - r;
        inset = inset < 0 ? 0 : inset > most ? most : inset;
        const k = inset / across;
        x += ux * k; y += uy * k; z += uz * k;
      }
    }
    // A blast wound: from the hitbox's middle out to the far side's skin, at the chest.
    if (mode === BLAST && hasDir) {
      const body = table.body * scale;
      x += ux * body; z += uz * body; y += (kind === 'crawler' ? SPRAY.blastOrigin.crawler : SPRAY.blastOrigin.lift) * scale;
    }
    const delay = event.delay, wait = typeof delay === 'number' && delay > 0 ? (delay < BLOOD.delayMax ? delay : BLOOD.delayMax) : 0;
    const due = F[NOW] + wait;
    const raw = event.zombieId, id = raw === undefined ? null : raw, shot = event.shot;
    const keyed = id !== null && typeof shot === 'number' && finite(shot);
    let slot = -1;
    if (keyed) {
      for (let index = 0; index < SPRAYS; index++) {
        if (sprayUsed[index] === 1 && sprayOwn[index] === 0 && sprayShot[index] === shot && sprayId[index] === id) { slot = index; break; }
      }
      F[SHOT] = shot;
    } else F[SHOT] = 0;
    if (slot < 0) slot = openSpray(id, keyed);
    const at = slot * SUMS, weight = power > 0 ? power : 1e-6;
    sprayDamage[slot] += power;
    if (head) {
      sprayHeadPower[slot] += power;
      spraySums[at] += weight; spraySums[at + 1] += weight * x; spraySums[at + 2] += weight * y; spraySums[at + 3] += weight * z; spraySums[at + 15] += weight * r;
    } else { spraySums[at + 4] += weight; spraySums[at + 5] += weight * x; spraySums[at + 6] += weight * y; spraySums[at + 7] += weight * z; spraySums[at + 14] += weight * r; }
    if (hasDir) {
      spraySums[at + 8] += power * ux; spraySums[at + 9] += power * uy; spraySums[at + 10] += power * uz;
      if (!sprayDir[slot]) { spraySums[at + 11] = ux; spraySums[at + 12] = uy; spraySums[at + 13] = uz; sprayDir[slot] = 1; }
    }
    if (sprayCount[slot] === 0) {
      sprayMode[slot] = mode; sprayKind[slot] = typeof event.kind === 'string' ? event.kind : null;
      sprayBoss[slot] = event.boss === true ? 1 : 0; sprayScale[slot] = scale;
    }
    sprayCount[slot]++;
    if (kill) sprayKill[slot] = 1;
    if (local) sprayLocal[slot] = 1;
    if (due > sprayDue[slot]) sprayDue[slot] = due;
    if (mode === BULLET || mode === MELEE) {
      F[Q_X] = x; F[Q_Y] = y; F[Q_Z] = z; F[Q_UX] = ux; F[Q_UY] = uy; F[Q_UZ] = uz; F[Q_DUE] = due;
      queueWound(slot, local);
    }
  }
  function openSpray(id, keyed) {
    let slot = -1;
    for (let index = 0; index < SPRAYS; index++) if (!sprayUsed[index]) { slot = index; break; }
    if (slot < 0) {
      // A full table: the farthest open spray bleeds now and gives its slot.
      let far = -1;
      for (let index = 0; index < SPRAYS; index++) {
        sprayCentre(index);
        const dx = F[C_X] - F[CAM_X], dy = F[C_Y] - F[CAM_Y], dz = F[C_Z] - F[CAM_Z], distance = hasCamera ? dx * dx + dy * dy + dz * dz : index;
        if (distance > G2[3] || far < 0) { G2[3] = distance; far = index; }
      }
      slot = far;
      flushedFull++;
      flushNow(slot);
    }
    sprayUsed[slot] = 1; sprayOwn[slot] = keyed ? 0 : 1; sprayId[slot] = keyed ? id : null; sprayShot[slot] = F[SHOT];
    sprayGenNext = (sprayGenNext + 1) & 0x3fffffff;
    sprayGen[slot] = sprayGenNext; sprayDue[slot] = -Infinity; sprayDamage[slot] = 0; sprayHeadPower[slot] = 0;
    sprayCount[slot] = 0; sprayPuffs[slot] = 0; sprayKill[slot] = 0; sprayLocal[slot] = 0; sprayDir[slot] = 0;
    const at = slot * SUMS;
    for (let k = 0; k < SUMS; k++) spraySums[at + k] = 0;
    return slot;
  }
  // A wound's puffs wait for their due time. A full ring throws the oldest
  // wound's puffs at once (its spray is not affected).
  function queueWound(slot, local) {
    let index = -1;
    for (let scan = 0; scan < PENDING; scan++) {
      const at = (pendNext + scan) % PENDING;
      if (!pendUsed[at]) { index = at; break; }
    }
    if (index < 0) {
      let oldest = 0;
      for (let at = 1; at < PENDING; at++) if (pendSeq[at] < pendSeq[oldest]) oldest = at;
      const count = puffsOf(oldest);
      pendingFull++;
      if (count > 0) { throwPuffs(oldest, count); F[PUFFS_RECENT] += count; }
      pendUsed[oldest] = 0; pendCount--;
      index = oldest;
    }
    pendNext = (index + 1) % PENDING;
    const at = index * 3;
    pendUsed[index] = 1; pendCount++; pendLocal[index] = local ? 1 : 0; pendSpray[index] = slot; pendGen[index] = sprayGen[slot];
    pendDue[index] = F[Q_DUE]; pendSeq[index] = F[SEQ]; F[SEQ] += 1;
    pendPoint[at] = F[Q_X]; pendPoint[at + 1] = F[Q_Y]; pendPoint[at + 2] = F[Q_Z];
    pendDir[at] = F[Q_UX]; pendDir[at + 1] = F[Q_UY]; pendDir[at + 2] = F[Q_UZ];
  }
  // The puffs a pending wound may throw now: by its own d_eff, within its
  // spray's 18 (√B), at least one while it is within 35 m.
  function puffsOf(index) {
    const at = index * 3, dx = pendPoint[at] - F[CAM_X], dy = pendPoint[at + 1] - F[CAM_Y], dz = pendPoint[at + 2] - F[CAM_Z];
    const distance = hasCamera ? Math.sqrt(dx * dx + dy * dy + dz * dz) * F[FOV_K] : 0;
    const bands = SPRAY.distance;
    if (distance > bands[bands.length - 1][0]) return 0;
    let count = distance <= bands[0][0] ? PUFF_NEAR : PUFF_FAR;
    // Under pressure a teammate's (or raider's) wound keeps one puff (3.3).
    if (!pendLocal[index] && F[GOV] < SPRAY.governor.press && count > PUFF_PRESSED) count = PUFF_PRESSED;
    const slot = pendSpray[index];
    if (sprayUsed[slot] && sprayGen[slot] === pendGen[index]) {
      const room = PUFF_MAX - sprayPuffs[slot];
      if (count > room) count = room > 1 ? room : 1;
    }
    return count;
  }
  // Puffs: small entry pixels at the wound, in the hollow cone around -u,
  // one cell, faster near the camera so they open around the hit.
  function throwPuffs(index, count) {
    const at = index * 3, slot = pendSpray[index], ux = pendDir[at], uy = pendDir[at + 1], uz = pendDir[at + 2];
    const dx = pendPoint[at] - F[CAM_X], dy = pendPoint[at + 1] - F[CAM_Y], dz = pendPoint[at + 2] - F[CAM_Z];
    const near = hasCamera && Math.sqrt(dx * dx + dy * dy + dz * dz) * F[FOV_K] <= SPRAY.near;
    lateral = hasCamera && pendLocal[index] === 1;
    const range = near ? (lateral ? SPRAY.cone.lateralSpeed : SPRAY.cone.nearSpeed) : SPRAY.puffs.speed;
    currentSpray = pendGen[index];
    for (let k = 0; k < count; k++) {
      F[A_X] = -ux; F[A_Y] = -uy; F[A_Z] = -uz;
      coneDirection(false);
      const speed = range[0] + RANDOM[draw()] * (range[1] - range[0]);
      F[T_X] = pendPoint[at] - ux * SPRAY.puffs.out; F[T_Y] = pendPoint[at + 1] - uy * SPRAY.puffs.out; F[T_Z] = pendPoint[at + 2] - uz * SPRAY.puffs.out;
      F[T_VX] = F[D_X] * speed; F[T_VY] = F[D_Y] * speed + SPRAY.cone.lift; F[T_VZ] = F[D_Z] * speed; F[T_START] = F[NOW];
      throwDroplet(1, PUFF, pickColour(PUFF), 1);
    }
    lateral = false;
    if (sprayUsed[slot] && sprayGen[slot] === pendGen[index]) sprayPuffs[slot] += count;
  }
  // Frame step 1 (3.2): the puffs of the wounds now due, local first then
  // nearest, up to half the frame's cap; past it, one puff each.
  function duePuffs() {
    const now = F[NOW] + 1e-9;
    let count = 0;
    for (let index = 0; index < PENDING; index++) {
      if (!pendUsed[index] || pendDue[index] > now) continue;
      const at = index * 3, dx = pendPoint[at] - F[CAM_X], dy = pendPoint[at + 1] - F[CAM_Y], dz = pendPoint[at + 2] - F[CAM_Z];
      dueKey[count] = (pendLocal[index] ? 0 : 1e6) + (hasCamera ? Math.sqrt(dx * dx + dy * dy + dz * dz) : 0); dueOrder[count] = index;
      count = sortIn(count);
    }
    const half = CAP >> 1;
    let thrown = 0;
    for (let k = 0; k < count; k++) {
      const index = dueOrder[k];
      let puffs = puffsOf(index);
      if (puffs > 0) {
        if (thrown < half) { if (puffs > half - thrown) puffs = half - thrown; }
        else puffs = 1;
        throwPuffs(index, puffs); thrown += puffs;
      }
      pendUsed[index] = 0; pendCount--;
    }
    F[PUFFS_RECENT] += thrown;
  }
  // Insertion of the entry at `count` into dueOrder/dueKey, by key: no allocation.
  function sortIn(count) {
    const key = dueKey[count], order = dueOrder[count];
    let at = count;
    while (at > 0 && dueKey[at - 1] > key) { dueKey[at] = dueKey[at - 1]; dueOrder[at] = dueOrder[at - 1]; at--; }
    dueKey[at] = key; dueOrder[at] = order;
    return count + 1;
  }
  // The spray's centre (power-weighted over all its wounds) into C.
  function sprayCentre(slot) {
    const at = slot * SUMS, weight = spraySums[at] + spraySums[at + 4];
    if (weight > 0) {
      F[C_X] = (spraySums[at + 1] + spraySums[at + 5]) / weight; F[C_Y] = (spraySums[at + 2] + spraySums[at + 6]) / weight;
      F[C_Z] = (spraySums[at + 3] + spraySums[at + 7]) / weight;
    } else { F[C_X] = F[CAM_X]; F[C_Y] = F[CAM_Y]; F[C_Z] = F[CAM_Z]; }
  }
  // Its plan (2.2) with the zombie's A, carries and kill bit, then the
  // zombie ring updated at once, so the next spray on that body this frame
  // sees it (streams add up). Leaves W, before the governor, in planWant.
  function planSpray(slot) {
    sprayCentre(slot);
    const dx = F[C_X] - F[CAM_X], dy = F[C_Y] - F[CAM_Y], dz = F[C_Z] - F[CAM_Z];
    sprayDistance[slot] = hasCamera ? Math.sqrt(dx * dx + dy * dy + dz * dz) * F[FOV_K] : 0;
    const damage = sprayDamage[slot], id = sprayOwn[slot] ? null : sprayId[slot];
    let zombie = -1;
    planIn.recent = 0; planIn.carry = .5; planIn.spotCarry = .5; planIn.killDone = false;
    if (id !== null) {
      zombie = findZombie(id);
      if (zombie >= 0) {
        planIn.recent = zombieA[zombie] * Math.exp(-(F[NOW] - zombieTime[zombie]) / SPRAY.recent);
        planIn.carry = zombieCarry[zombie]; planIn.spotCarry = zombieSpotCarry[zombie]; planIn.killDone = zombieKill[zombie] === 1;
      }
    }
    planIn.damage = damage; planIn.headShare = damage > 0 ? sprayHeadPower[slot] / damage : 0; planIn.wounds = sprayCount[slot];
    planIn.kind = sprayKind[slot]; planIn.boss = sprayBoss[slot] === 1; planIn.mode = SPRAY_MODES[sprayMode[slot]];
    planIn.kill = sprayKill[slot] === 1; planIn.distance = sprayDistance[slot]; planIn.local = sprayLocal[slot] === 1;
    sprayPlan(planIn, preset, B, planOut);
    planBack[slot] = planOut.back; planExit[slot] = planOut.exit; planGlobs[slot] = planOut.globs; planFountain[slot] = planOut.fountain;
    planKill[slot] = planOut.kill; planSpots[slot] = planOut.spots; planTheta[slot] = planOut.theta * DEG; planVmax[slot] = planOut.vmax;
    planI[slot] = planOut.intensity; planWant[slot] = planOut.burst + planOut.fountain + planOut.kill;
    planBurst[slot] = planOut.burst; planRecent[slot] = planIn.recent;
    if (id !== null) {
      if (zombie < 0) zombie = takeZombie(id);
      zombieA[zombie] = planIn.recent + damage; zombieTime[zombie] = F[NOW];
      zombieCarry[zombie] = planOut.carry; zombieSpotCarry[zombie] = planOut.spotCarry;
      if (sprayKill[slot]) zombieKill[zombie] = 1;
      zombieClock = (zombieClock + 1) & 0x3fffffff; zombieStamp[zombie] = zombieClock;
    }
  }
  // The governor's share for one spray: g (local sprays at least .5), with
  // a running carry so many small sprays still add up to g of their sum.
  function governed(slot) {
    const want = planWant[slot], g = sprayLocal[slot] && F[GOV] < SPRAY.governor.local ? SPRAY.governor.local : F[GOV];
    const raw = want * g + F[GOV_CARRY];
    let take = Math.floor(raw);
    F[GOV_CARRY] = raw - take;
    if (take > want) take = want;
    if (take < 1 && want > 0 && sprayMode[slot] >= BLAST) take = 1;
    return take;
  }
  // Frame steps 2-4: the sprays now due, local first then nearest; their
  // plans; the governor; the frame cap split; their layers.
  function flushDue() {
    const now = F[NOW] + 1e-9;
    let count = 0;
    for (let slot = 0; slot < SPRAYS; slot++) {
      if (!sprayUsed[slot] || sprayDue[slot] > now) continue;
      sprayCentre(slot);
      const dx = F[C_X] - F[CAM_X], dy = F[C_Y] - F[CAM_Y], dz = F[C_Z] - F[CAM_Z];
      dueKey[count] = (sprayLocal[slot] ? 0 : 1e6) + (hasCamera ? Math.sqrt(dx * dx + dy * dy + dz * dz) : 0); dueOrder[count] = slot;
      count = sortIn(count);
    }
    // g (3.3) from the puffs up to now and the demand as it stood at the end
    // of the last frame: exact in steady state (throws = Pool/5 per .5 s),
    // while a lone spray from a quiet half second passes whole (the 2.7 and
    // 3.4 tables: only the frame cap cuts the owner's case).
    const before = F[WANTED_BEFORE];
    const g = before > 0 ? (TARGET - F[PUFFS_RECENT]) / before : 1;
    F[GOV] = g < SPRAY.governor.floor ? SPRAY.governor.floor : g > 1 ? 1 : g;
    let wanted = 0;
    for (let k = 0; k < count; k++) { const slot = dueOrder[k]; planSpray(slot); wanted += planWant[slot]; }
    F[WANTED_RECENT] += wanted;
    if (!count) return;
    for (let k = 0; k < count; k++) { const slot = dueOrder[k]; planGiven[slot] = governed(slot); }
    let left = CAP - thrownFrame;
    if (left < 0) left = 0;
    left = share(count, 1, left);
    share(count, 0, left);
    for (let k = 0; k < count; k++) {
      const slot = dueOrder[k];
      throwSpray(slot, planAllot[slot]);
      sprayUsed[slot] = 0;
    }
  }
  // The frame cap split (3.2 step 3) of one group (local or not): in full
  // when it fits, else each scaled by left/ΣW rounded down, at least one
  // while any is left, the leftovers to the nearest. A spray without puffs
  // (blast, legacy) keeps its first droplet past the cap (A1).
  function share(count, local, left) {
    let sum = 0;
    for (let k = 0; k < count; k++) { const slot = dueOrder[k]; if (sprayLocal[slot] === local) sum += planGiven[slot]; }
    if (sum <= left) {
      for (let k = 0; k < count; k++) { const slot = dueOrder[k]; if (sprayLocal[slot] === local) planAllot[slot] = planGiven[slot]; }
      return left - sum;
    }
    let given = 0;
    for (let k = 0; k < count; k++) {
      const slot = dueOrder[k];
      if (sprayLocal[slot] !== local) continue;
      const allot = Math.floor(planGiven[slot] * left / sum);
      planAllot[slot] = allot; given += allot;
    }
    for (let k = 0; k < count && given < left; k++) {
      const slot = dueOrder[k];
      if (sprayLocal[slot] === local && planAllot[slot] === 0 && planGiven[slot] > 0) { planAllot[slot] = 1; given++; }
    }
    for (let k = 0; k < count && given < left; k++) {
      const slot = dueOrder[k];
      if (sprayLocal[slot] === local && planAllot[slot] < planGiven[slot]) { planAllot[slot]++; given++; }
    }
    for (let k = 0; k < count; k++) {
      const slot = dueOrder[k];
      if (sprayLocal[slot] === local && planAllot[slot] === 0 && planGiven[slot] > 0 && sprayMode[slot] >= BLAST) planAllot[slot] = 1;
    }
    return left > given ? left - given : 0;
  }
  // A full spray table flushes a spray at once, outside the frame's split.
  function flushNow(slot) {
    planSpray(slot);
    F[WANTED_RECENT] += planWant[slot];
    planGiven[slot] = governed(slot);
    throwSpray(slot, planGiven[slot]);
    sprayUsed[slot] = 0;
  }
  // The layers of one spray, scaled to `total` droplets (2.3): back spray,
  // exit spray (globs among it), fountain, kill burst; head and body
  // sub-bursts when both shares are at least .2.
  function throwSpray(slot, total) {
    let back = planBack[slot], exit = planExit[slot], fountain = planFountain[slot], kill = planKill[slot];
    const want = back + exit + fountain + kill;
    if (total < want) {
      // Every layer scaled, the rounding by the largest remainders.
      const f = want > 0 ? total / want : 0;
      let rb = back * f, re = exit * f, rf = fountain * f, rk = kill * f;
      back = Math.floor(rb); exit = Math.floor(re); fountain = Math.floor(rf); kill = Math.floor(rk);
      rb -= back; re -= exit; rf -= fountain; rk -= kill;
      for (let spare = total - back - exit - fountain - kill; spare > 0; spare--) {
        if (rk >= re && rk >= rb && rk >= rf) { kill++; rk = -1; }
        else if (re >= rb && re >= rf) { exit++; re = -1; }
        else if (rb >= rf) { back++; rb = -1; }
        else { fountain++; rf = -1; }
      }
    }
    const globs = planGlobs[slot] < exit ? planGlobs[slot] : exit;
    // Spots by layer: exit 50 %, back 30 %, kill and fountain 20 %; the
    // remainder and a missing layer's share to the exit.
    const spotsTotal = planSpots[slot];
    spotLeft[0] = back > 0 ? Math.round(SPOT.layers.back * spotsTotal) : 0;
    spotLeft[2] = kill + fountain > 0 ? Math.round(SPOT.layers.kill * spotsTotal) : 0;
    spotLeft[1] = spotsTotal - spotLeft[0] - spotLeft[2];
    const at = slot * SUMS, damage = sprayDamage[slot], mode = sprayMode[slot], scale = sprayScale[slot];
    const shareHead = damage > 0 ? sprayHeadPower[slot] / damage : 0, headWeight = spraySums[at], bodyWeight = spraySums[at + 4];
    // u: the power-weighted direction, else the first wound's, else none.
    let ux = spraySums[at + 8], uy = spraySums[at + 9], uz = spraySums[at + 10];
    let length = Math.sqrt(ux * ux + uy * uy + uz * uz), directed = true;
    if (length > 1e-9) { ux /= length; uy /= length; uz /= length; }
    else if (sprayDir[slot]) { ux = spraySums[at + 11]; uy = spraySums[at + 12]; uz = spraySums[at + 13]; }
    else { ux = uy = uz = 0; directed = false; }
    F[U_X] = ux; F[U_Y] = uy; F[U_Z] = uz;
    // h, the shot's horizontal heading (random when it is steep or unknown).
    const across = Math.sqrt(ux * ux + uz * uz);
    if (across >= .2) { F[H_X] = ux / across; F[H_Z] = uz / across; }
    else { const yaw = RANDOM[draw()] * TAU; F[H_X] = Math.cos(yaw); F[H_Z] = Math.sin(yaw); }
    // e, the exit axis.
    let radial = false;
    if (mode === BULLET || mode === MELEE) {
      if (uy < -PITCH_SIN) { F[E_X] = F[H_X] * PITCH_COS; F[E_Y] = -PITCH_SIN; F[E_Z] = F[H_Z] * PITCH_COS; }
      else { F[E_X] = ux; F[E_Y] = uy; F[E_Z] = uz; }
    } else if (mode === BLAST) {
      const lift = SPRAY.exit.blastLift, norm = Math.sqrt(ux * ux + lift * lift + uz * uz);
      F[E_X] = ux / norm; F[E_Y] = lift / norm; F[E_Z] = uz / norm;
    } else if (directed) { F[E_X] = ux; F[E_Y] = uy; F[E_Z] = uz; }
    else radial = true;
    F[THETA] = planTheta[slot]; F[VMAX] = planVmax[slot]; F[SPRAY_I] = planI[slot];
    G2[SPRAY_DEFF] = sprayDistance[slot]; G2[SPRAY_SCALE] = scale; G2[SPRAY_SHARE] = shareHead;
    currentSpray = sprayGen[slot];
    // Head and body centres; sub-bursts.
    const hasHead = headWeight > 0, hasBody = bodyWeight > 0;
    const headX = hasHead ? spraySums[at + 1] / headWeight : 0, headY = hasHead ? spraySums[at + 2] / headWeight : 0, headZ = hasHead ? spraySums[at + 3] / headWeight : 0;
    const bodyX = hasBody ? spraySums[at + 5] / bodyWeight : headX, bodyY = hasBody ? spraySums[at + 6] / bodyWeight : headY, bodyZ = hasBody ? spraySums[at + 7] / bodyWeight : headZ;
    const headFirst = hasHead && (shareHead >= .5 || !hasBody);
    const mainX = headFirst ? headX : bodyX, mainY = headFirst ? headY : bodyY, mainZ = headFirst ? headZ : bodyZ;
    const split = hasHead && hasBody && shareHead >= SPRAY.split.share && 1 - shareHead >= SPRAY.split.share;
    const burst = back + exit;
    const headN = split ? Math.round(burst * shareHead) : headFirst ? burst : 0;
    let headBack = burst > 0 ? Math.round(headN * back / burst) : 0;
    let bodyBack = back - headBack;
    if (bodyBack > burst - headN) { bodyBack = burst - headN; headBack = back - bodyBack; }
    const headExit = headN - headBack, bodyExit = exit - headExit;
    const headGlobs = headFirst ? (globs < headExit ? globs : headExit) : 0, bodyGlobs = headFirst ? 0 : (globs < bodyExit ? globs : bodyExit);
    // The skin's mean distance from the axis at each centre (2.3, scaled).
    const headR = hasHead ? spraySums[at + 15] / headWeight : 0, bodyR = hasBody ? spraySums[at + 14] / bodyWeight : headR;
    if (sprayInfo) fillSprayInfo(slot, back, exit, globs, fountain, kill, total, headX, headY, headZ, bodyX, bodyY, bodyZ);
    // Back spray from each centre, then the exit spray, the fountain, the
    // kill. The shooter's own back spray opens sideways (faster within 3 m).
    lateral = hasCamera && sprayLocal[slot] === 1;
    if (headBack > 0) { F[C_X] = headX; F[C_Y] = headY; F[C_Z] = headZ; throwBack(headBack); }
    if (bodyBack > 0) { F[C_X] = bodyX; F[C_Y] = bodyY; F[C_Z] = bodyZ; throwBack(bodyBack); }
    lateral = false;
    // A bullet leaves by the body's far side (2r on); a blow splashes from
    // where it lands. His own exit spray and kill burst keep off his line of sight.
    const through = mode === BULLET;
    hollow = sprayLocal[slot] === 1 && (mode === BULLET || mode === MELEE);
    if (headExit > 0) {
      F[C_X] = headX + (through ? F[E_X] * 2 * headR : 0); F[C_Y] = headY + (through ? F[E_Y] * 2 * headR : 0); F[C_Z] = headZ + (through ? F[E_Z] * 2 * headR : 0);
      throwExit(headExit, headGlobs, radial);
    }
    if (bodyExit > 0) {
      F[C_X] = bodyX + (through ? F[E_X] * 2 * bodyR : 0); F[C_Y] = bodyY + (through ? F[E_Y] * 2 * bodyR : 0); F[C_Z] = bodyZ + (through ? F[E_Z] * 2 * bodyR : 0);
      throwExit(bodyExit, bodyGlobs, radial);
    }
    if (fountain > 0 && hasHead) { F[C_X] = headX; F[C_Y] = headY + SPRAY.fountain.lift * scale; F[C_Z] = headZ; throwFountain(fountain); }
    if (kill > 0) { F[C_X] = mainX; F[C_Y] = mainY; F[C_Z] = mainZ; throwKill(kill, directed); }
    hollow = false;
  }
  function fillSprayInfo(slot, back, exit, globs, fountain, kill, total, headX, headY, headZ, bodyX, bodyY, bodyZ) {
    const info = sprayInfo;
    info.id = sprayOwn[slot] ? null : sprayId[slot]; info.shot = sprayShot[slot]; info.mode = SPRAY_MODES[sprayMode[slot]]; info.wounds = sprayCount[slot];
    info.damage = sprayDamage[slot]; info.headShare = sprayDamage[slot] > 0 ? sprayHeadPower[slot] / sprayDamage[slot] : 0;
    info.local = sprayLocal[slot] === 1; info.kill = sprayKill[slot] === 1; info.distance = sprayDistance[slot];
    info.back = back; info.exit = exit; info.globs = globs; info.fountain = fountain; info.killBurst = kill; info.spots = planSpots[slot];
    info.want = planWant[slot]; info.allotted = total; info.governor = F[GOV]; info.puffs = sprayPuffs[slot]; info.serial = sprayGen[slot];
    info.recent = planRecent[slot]; info.burst = planBurst[slot]; info.theta = planTheta[slot] / DEG; info.vmax = planVmax[slot];
    info.headX = headX; info.headY = headY; info.headZ = headZ; info.bodyX = bodyX; info.bodyY = bodyY; info.bodyZ = bodyZ;
    onSpray(info);
  }
  // Largest first within a layer: count the cells drawn, then throw 3s, 2s, 1s.
  const cellCounts = new Int32Array(4);
  function drawCells(count, oneCell) {
    cellCounts[1] = cellCounts[2] = cellCounts[3] = 0;
    for (let k = 0; k < count; k++) cellCounts[oneCell ? 1 : cellsAt()]++;
  }
  const cellOf = k => k < cellCounts[3] ? 3 : k < cellCounts[3] + cellCounts[2] ? 2 : 1;
  // Back spray: the hollow cone around -u from the centre C, 3 cm out.
  function throwBack(count) {
    const near = G2[SPRAY_DEFF] <= SPRAY.near, I = F[SPRAY_I];
    drawCells(count, G2[SPRAY_DEFF] <= SPRAY.cells.nearOne);
    for (let k = 0; k < count; k++) {
      F[A_X] = -F[U_X]; F[A_Y] = -F[U_Y]; F[A_Z] = -F[U_Z];
      coneDirection(false);
      let speed;
      if (near) { const range = lateral ? SPRAY.cone.lateralSpeed : SPRAY.cone.nearSpeed; speed = range[0] + RANDOM[draw()] * (range[1] - range[0]); }
      else {
        speed = (SPRAY.back.speed[0] + RANDOM[draw()] * (SPRAY.back.speed[1] - SPRAY.back.speed[0])) * (1 + SPRAY.back.perI * I);
        if (speed > SPRAY.back.max) speed = SPRAY.back.max;
      }
      F[T_X] = F[C_X] - F[U_X] * SPRAY.back.out; F[T_Y] = F[C_Y] - F[U_Y] * SPRAY.back.out; F[T_Z] = F[C_Z] - F[U_Z] * SPRAY.back.out;
      F[T_VX] = F[D_X] * speed; F[T_VY] = F[D_Y] * speed + SPRAY.cone.lift; F[T_VZ] = F[D_Z] * speed; F[T_START] = F[NOW];
      throwDroplet(cellOf(k), BACK, pickColour(BACK), 0);
    }
  }
  // Exit spray: a cone of theta around e from C (the body's far side), the
  // core fast and the edge slower, the fastest first; globs heavier.
  function throwExit(count, globs, radial) {
    drawCells(count - globs, false);
    const threes = cellCounts[3], vmax = F[VMAX];
    for (let k = 0; k < count; k++) {
      // 3-cell droplets, then the globs (2 cells), then the rest.
      const glob = k >= threes && k < threes + globs, cells = k < threes ? 3 : glob ? SPRAY.globs.cells : cellOf(k - globs);
      if (radial) {
        const yaw = RANDOM[draw()] * TAU, lift = SPRAY.exit.blastLift, norm = Math.sqrt(1 + lift * lift);
        F[A_X] = Math.cos(yaw) / norm; F[A_Y] = lift / norm; F[A_Z] = Math.sin(yaw) / norm;
      } else { F[A_X] = F[E_X]; F[A_Y] = F[E_Y]; F[A_Z] = F[E_Z]; }
      coneDirection(true);
      const ratio = F[D_RATIO];
      let speed = vmax * (SPRAY.exit.spread[0] + RANDOM[draw()] * (SPRAY.exit.spread[1] - SPRAY.exit.spread[0])) * (1 - SPRAY.exit.edge * ratio * ratio);
      if (glob) speed *= SPRAY.globs.speed;
      F[T_X] = F[C_X]; F[T_Y] = F[C_Y]; F[T_Z] = F[C_Z];
      F[T_VX] = F[D_X] * speed; F[T_VY] = F[D_Y] * speed; F[T_VZ] = F[D_Z] * speed;
      F[T_START] = F[NOW] + SPRAY.exit.stagger * (vmax > 0 ? 1 - speed / vmax : 0);
      throwDroplet(cells, EXIT, pickColour(EXIT), 0);
    }
  }
  // Fountain: out of the back of the head, rising .2-.4 m, landing behind it.
  function throwFountain(count) {
    const I = F[SPRAY_I], hx = F[H_X], hz = F[H_Z], f = SPRAY.fountain;
    drawCells(count, false);
    for (let k = 0; k < count; k++) {
      const ahead = f.back[0] + RANDOM[draw()] * (f.back[1] - f.back[0]), up = f.up[0] + RANDOM[draw()] * (f.up[1] - f.up[0]) + f.perI * I;
      const side = (RANDOM[draw()] * 2 - 1) * f.side;
      F[T_X] = F[C_X]; F[T_Y] = F[C_Y]; F[T_Z] = F[C_Z];
      F[T_VX] = hx * ahead - hz * side; F[T_VY] = up; F[T_VZ] = hz * ahead + hx * side; F[T_START] = F[NOW];
      throwDroplet(cellOf(k), FOUNTAIN, pickColour(FOUNTAIN), 0);
    }
  }
  // Kill burst, once per death: half within ±60° of the heading, the rest all around.
  function throwKill(count, directed) {
    const I = F[SPRAY_I], k0 = SPRAY.kill, heading = Math.atan2(F[H_Z], F[H_X]), forward = directed ? Math.round(count * k0.forwardShare) : 0;
    const lift = G2[SPRAY_SHARE] >= .5 ? k0.head : 0;
    drawCells(count, false);
    for (let k = 0; k < count; k++) {
      // Off his line of sight by KILL_CLEAR either side when it is his own spray.
      const clear = hollow && directed ? KILL_CLEAR : 0, side = RANDOM[draw()] < .5 ? -1 : 1;
      const yaw = k < forward ? heading + side * (clear + RANDOM[draw()] * (FORWARD_YAW - clear)) : heading + side * (clear + RANDOM[draw()] * (Math.PI - clear));
      const speed = (k0.side[0] + RANDOM[draw()] * (k0.side[1] - k0.side[0])) * (1 + k0.sidePerI * I);
      F[T_X] = F[C_X]; F[T_Y] = F[C_Y]; F[T_Z] = F[C_Z];
      F[T_VX] = Math.cos(yaw) * speed; F[T_VY] = k0.up[0] + RANDOM[draw()] * (k0.up[1] - k0.up[0]) + lift; F[T_VZ] = Math.sin(yaw) * speed;
      F[T_START] = F[NOW];
      throwDroplet(cellOf(k), KILL, pickColour(KILL), 0);
    }
  }

  // Stains: each slot owns a fixed block of pixels. A stain grows from its
  // centre once the body is down, stays, then dissolves pixel by pixel.
  const S = budget.stains, P = BLOOD.stain.pixels, N = S * P;
  const stainStart = new Float64Array(S).fill(-Infinity), stainLife = new Float32Array(S), stainCount = new Uint8Array(S), stainSettled = new Uint8Array(S);
  const pixelX = new Float32Array(N), pixelY = new Float32Array(N), pixelZ = new Float32Array(N), pixelSize = new Float32Array(N);
  const pixelAppear = new Float32Array(N), pixelFade = new Float32Array(N), pixelShown = new Uint8Array(N), cells = new Int16Array(P * 2);
  let stainNext = 0, stainsAwake = false, stainPixelsShown = 0, stainsChanged = false;
  const cameraDistance = (x, y, z) => {
    const eye = camera?.position;
    return eye ? Math.sqrt((x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2) : 0;
  };
  function clearStain(slot) {
    for (let pixel = 0; pixel < stainCount[slot]; pixel++) {
      const index = slot * P + pixel;
      if (pixelShown[index]) { stains.setMatrixAt(index, hidden); pixelShown[index] = 0; stainPixelsShown--; stainsChanged = true; }
    }
    stainStart[slot] = -Infinity; stainCount[slot] = 0;
  }
  // Cells are in grid units around the centre: a block (k < blocks) is two
  // cells wide and centred on a grid line, a speck is one cell.
  function blockTaken(i, j, blocks) {
    for (let k = 0; k < blocks; k++) if (cells[k * 2] === i && cells[k * 2 + 1] === j) return true;
    return false;
  }
  function speckCovered(i, j, blocks, total) {
    for (let k = 0; k < total; k++) {
      const ci = cells[k * 2], cj = cells[k * 2 + 1];
      if (k < blocks ? i >= ci - 1 && i <= ci && j >= cj - 1 && j <= cj : i === ci && j === cj) return true;
    }
    return false;
  }
  // ctx.hooks.death: the stain under the fallen body, at the real floor
  // height (ground, tread or loft), never over an edge or through a wall.
  function death(event) {
    if (removed || !event || event.raider === true) return;
    const mesh = event.mesh, data = mesh?.userData, fall = data?.death;
    if (data?.raider === true) return;
    let x = event.x, y = event.y, z = event.z;
    // A knocked-back body lands further along the shot.
    if (fall && finite(fall.baseX) && finite(fall.baseZ)) {
      const push = finite(fall.push) ? fall.push : 0;
      x = fall.baseX + (fall.directionX || 0) * push; z = fall.baseZ + (fall.directionZ || 0) * push;
      if (finite(fall.baseY)) y = fall.baseY;
    } else if ((!finite(x) || !finite(z)) && mesh?.position) { x = mesh.position.x; z = mesh.position.z; }
    if (!finite(x) || !finite(z)) return;
    if (!finite(y)) y = finite(mesh?.position?.y) ? mesh.position.y : 0;
    if (cameraDistance(x, y, z) > BLOOD.stainFar) return;
    // The body falls along the shot, or the way it faced.
    let ax = 0, az = 0;
    if (fall && finite(fall.toYaw)) { ax = Math.sin(fall.toYaw); az = Math.cos(fall.toYaw); }
    else {
      const dx = finite(event.dirX) ? event.dirX : 0, dz = finite(event.dirZ) ? event.dirZ : 0, length = Math.hypot(dx, dz);
      if (length > 1e-6) { ax = dx / length; az = dz / length; }
      else if (finite(mesh?.rotation?.y)) { ax = Math.sin(mesh.rotation.y); az = Math.cos(mesh.rotation.y); }
    }
    const kind = event.boss === true || data?.boss === true ? 'boss' : data?.kind === 'brute' ? 'brute' : data?.kind === 'crawler' ? 'crawler' : 'walker';
    const shape = STAIN_SHAPES[kind], floor = restingSurface(x, z, y + .25), low = floor + .05, high = floor + .25;
    // The centre sits under the torso, pulled back from walls and furniture,
    // and from the loft's edge or the stair well.
    let reach = ax || az ? shape.along * (event.headshot === true ? 1.15 : 1) * (finite(mesh?.scale?.x) ? mesh.scale.x : 1) : 0;
    const travel = reach > 0 ? freeTravel(x, z, x + ax * reach, z + az * reach, low, high) : 1;
    if (travel < 1) reach *= Math.max(0, travel - .1);
    for (let tries = 0; tries < 3 && !sameFloor(x + ax * reach, z + az * reach, floor); tries++) reach /= 2;
    if (!sameFloor(x + ax * reach, z + az * reach, floor)) reach = 0;
    const grid = BLOOD.grid, centreI = Math.round((x + ax * reach) / grid), centreJ = Math.round((z + az * reach) / grid);
    const centreX = centreI * grid, centreZ = centreJ * grid;
    // Core: blocks grown from the centre by a random walk that leans along
    // the fall, so the blob stays in one piece.
    // A variant's share (Frisson léger: half) takes blocks and specks away, at least one block.
    const coreCount = SHARE === 1 ? pick(random, shape.core) : Math.max(1, Math.round(pick(random, shape.core) * SHARE)), leanX = Math.abs(ax) >= Math.abs(az) ? Math.sign(ax) : 0, leanZ = Math.abs(ax) >= Math.abs(az) ? 0 : Math.sign(az);
    let blocks = 1; cells[0] = 0; cells[1] = 0;
    for (let attempt = 0; blocks < coreCount && attempt < coreCount * 8; attempt++) {
      const from = Math.floor(random() * blocks) * 2;
      let stepX, stepZ;
      if (random() < .35 && (leanX || leanZ)) { stepX = leanX; stepZ = leanZ; }
      else { const way = Math.floor(random() * 4); stepX = way === 0 ? 1 : way === 1 ? -1 : 0; stepZ = way === 2 ? 1 : way === 3 ? -1 : 0; }
      const i = cells[from] + stepX * 2, j = cells[from + 1] + stepZ * 2;
      if (!blockTaken(i, j, blocks)) { cells[blocks * 2] = i; cells[blocks * 2 + 1] = j; blocks++; }
    }
    // Specks: single cells flicked further along the fall.
    const speckCount = SHARE === 1 ? pick(random, shape.specks) : Math.round(pick(random, shape.specks) * SHARE);
    let total = blocks;
    for (let attempt = 0; total < blocks + speckCount && attempt < speckCount * 6; attempt++) {
      const from = Math.floor(random() * blocks) * 2, ahead = 3 + random() * 6, side = (random() - .5) * 5;
      let ox, oz;
      if (ax || az) { ox = ax * ahead - az * side; oz = az * ahead + ax * side; }
      else { const angle = random() * Math.PI * 2; ox = Math.cos(angle) * ahead; oz = Math.sin(angle) * ahead; }
      const i = cells[from] + Math.round(ox), j = cells[from + 1] + Math.round(oz);
      if (!speckCovered(i, j, blocks, total)) { cells[total * 2] = i; cells[total * 2 + 1] = j; total++; }
    }
    const slot = stainNext;
    stainNext = (stainNext + 1) % S;
    clearStain(slot); stainsAwake = true;
    let farthest = 1e-6;
    for (let k = 0; k < total; k++) {
      const offset = k < blocks ? 0 : .5;
      farthest = Math.max(farthest, Math.hypot((cells[k * 2] + offset) * grid, (cells[k * 2 + 1] + offset) * grid));
    }
    let count = 0;
    for (let k = 0; k < total; k++) {
      const block = k < blocks, offset = block ? 0 : .5;
      const px = (centreI + cells[k * 2] + offset) * grid, pz = (centreJ + cells[k * 2 + 1] + offset) * grid;
      const surface = restingSurface(px, pz, high), size = block ? grid * 2 : grid;
      // The whole square rests on one surface: none hangs over an edge.
      if (Math.abs(surface - floor) > .22 || blockedAt(px, pz, surface + .05, surface + .25) || !squareRests(px, pz, size / 2, surface)
        || freeTravel(centreX, centreZ, px, pz, low, high) < 1) continue;
      const index = slot * P + count++;
      pixelX[index] = px; pixelY[index] = surface + BLOOD.stain.lift; pixelZ[index] = pz; pixelSize[index] = size;
      pixelAppear[index] = BLOOD.stain.grow * Math.hypot(px - centreX, pz - centreZ) / farthest;
      // Specks dry up first and the core last: the stain dissolves pixel by pixel.
      pixelFade[index] = block ? .35 + random() * .64 : random() * .45;
      stains.setColorAt(index, color.setHex(BLOOD_PALETTE[block ? 1 + Math.floor(random() * 3) : Math.floor(random() * 4)]));
    }
    if (!count) return;
    // It spreads once the body is down: after the fall, the knockback slide
    // and a rocket's flight (the death's start lies ahead of the frame clock).
    // A start further ahead than delayMax is on another clock: no wait.
    const frameTime = F[FRAME_TIME];
    const ahead = fall && finite(fall.start) && finite(frameTime) ? fall.start - frameTime : 0;
    const lead = finite(event.delay) ? delayOf(event.delay) : ahead >= 0 && ahead <= BLOOD.delayMax ? ahead : 0;
    const settle = fall ? Math.max(finite(fall.fall) ? fall.fall : .55, fall.push > 0 ? .42 : 0) : .55;
    stainStart[slot] = F[NOW] + lead + settle;
    stainLife[slot] = BLOOD.stain.life[0] + random() * (BLOOD.stain.life[1] - BLOOD.stain.life[0]);
    stainCount[slot] = count; stainSettled[slot] = 0;
    stains.instanceColor.needsUpdate = true;
    stainsAwake = true;
  }
  function updateStains() {
    if (!stainsAwake) return;
    let awake = false;
    const now = F[NOW];
    for (let slot = 0; slot < S; slot++) {
      if (stainStart[slot] === -Infinity) continue;
      awake = true;
      const age = now - stainStart[slot];
      if (age < 0) continue;
      const fadeFrom = stainLife[slot] - BLOOD.stain.dissolve, growing = age <= BLOOD.stain.grow;
      if (!growing && age < fadeFrom && stainSettled[slot]) continue;
      const fade = age < fadeFrom ? -1 : Math.min(1, (age - fadeFrom) / BLOOD.stain.dissolve);
      for (let pixel = 0; pixel < stainCount[slot]; pixel++) {
        const index = slot * P + pixel, show = age >= pixelAppear[index] && fade < pixelFade[index] ? 1 : 0;
        if (show === pixelShown[index]) continue;
        if (show) stains.setMatrixAt(index, matrix.makeScale(pixelSize[index], 1, pixelSize[index]).setPosition(pixelX[index], pixelY[index], pixelZ[index]));
        else stains.setMatrixAt(index, hidden);
        pixelShown[index] = show; stainPixelsShown += show ? 1 : -1; stainsChanged = true;
      }
      if (!growing && fade < 0) stainSettled[slot] = 1;
      if (fade >= 1) clearStain(slot);
    }
    stainsAwake = awake;
    if (stainsChanged) { stains.instanceMatrix.needsUpdate = true; stainsChanged = false; }
    stains.visible = stainPixelsShown > 0;
  }

  // Screen splats. Without a document or a 2D canvas (tests, a locked-down
  // browser) the rest of the blood still works.
  const doc = ctx.document, splatCount = budget.splats, sprites = [], spritePaint = [];
  const splatBorn = new Float64Array(splatCount).fill(-Infinity), splatLife = new Float32Array(splatCount);
  const splatX = new Int16Array(splatCount), splatY = new Int16Array(splatCount), splatLevel = new Uint8Array(splatCount);
  let screen = null, paint = null, splatNext = 0, splatsAwake = false, splatDamage = 0, splatAt = -Infinity;
  try {
    if (doc?.createElement && doc.body?.appendChild) {
      screen = doc.createElement('canvas'); paint = screen?.getContext?.('2d') ?? null;
      for (let slot = 0; paint && slot < splatCount; slot++) {
        const sprite = doc.createElement('canvas'); sprite.width = sprite.height = SPLATS.sprite;
        const spritePen = sprite.getContext?.('2d');
        if (!spritePen) paint = null; else { sprites.push(sprite); spritePaint.push(spritePen); }
      }
      if (paint) {
        screen.width = SPLATS.width; fitScreen();
        screen.className = 'frisson-blood-splats'; screen.setAttribute?.('aria-hidden', 'true');
        const style = screen.style;
        if (style) Object.assign(style, { position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', imageRendering: 'pixelated',
          pointerEvents: 'none', zIndex: String(SPLATS.zIndex), visibility: 'hidden' });
        paint.imageSmoothingEnabled = false;
        doc.body.appendChild(screen);
      } else screen = null;
    }
  } catch { screen = paint = null; }
  // Square pixels: the overlay's height follows the window's shape.
  function fitScreen() {
    const view = doc?.defaultView, shape = view?.innerWidth > 0 && view?.innerHeight > 0 ? view.innerHeight / view.innerWidth : 9 / 16;
    const height = clamp(Math.round(SPLATS.width * shape), 40, 160);
    if (screen.height !== height) screen.height = height;
  }
  const ROOT_SHARE = Math.sqrt(SHARE), thinned = count => SHARE === 1 ? count : Math.round(count * SHARE);
  function paintSplat(slot, low) {
    // A variant's share (Frisson léger: half) shrinks the blot to that share
    // of its area (radius by its square root) and thins its drops and drips.
    const pen = spritePaint[slot], size = SPLATS.sprite, middle = size / 2, radius = ((low ? 4.5 : 3) + random() * 2.5) * ROOT_SHARE;
    pen.clearRect(0, 0, size, size);
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const distance = Math.hypot(px + .5 - middle, py + .5 - middle);
      if (distance > radius * 1.15 || distance > radius * (.8 + random() * .35)) continue;
      pen.fillStyle = CSS[distance < radius * .5 ? 3 : distance < radius * .8 ? 2 : 1];
      pen.fillRect(px, py, 1, 1);
    }
    // A few loose drops around it, and a drip or two running down.
    for (let drop = thinned(2 + Math.floor(random() * 3)); drop > 0; drop--) {
      const angle = random() * Math.PI * 2, reach = radius + 1.5 + random() * 3.5, dot = random() < .3 ? 2 : 1;
      pen.fillStyle = CSS[Math.floor(random() * 2)];
      pen.fillRect(clamp(Math.round(middle + Math.cos(angle) * reach), 0, size - dot), clamp(Math.round(middle + Math.sin(angle) * reach), 0, size - dot), dot, dot);
    }
    for (let drip = thinned(Math.floor(random() * 3)); drip > 0; drip--) {
      const column = clamp(Math.round(middle + (random() - .5) * radius), 0, size - 1), top = Math.round(middle + radius * .5);
      const length = Math.min(size - 1 - top, 2 + Math.floor(random() * 5));
      if (length <= 0) continue;
      pen.fillStyle = CSS[1]; pen.fillRect(column, top, 1, length);
      pen.fillStyle = CSS[0]; pen.fillRect(column, top + length, 1, 1);
    }
  }
  // A splat centre never covers the HUD: the vitals (bottom left), the
  // weapon (bottom right) or the wave panel (top centre), each zone grown by
  // half a sprite in x (.075 of the 160 px width) so the sprite stays clear.
  const SPLAT_MARGIN = SPLATS.sprite / 2 / SPLATS.width;
  const onHud = (fx, fy) =>
    fx < .34 + SPLAT_MARGIN && fy > .68 ||
    fx > .72 - SPLAT_MARGIN && fy > .56 ||
    fx > .36 - SPLAT_MARGIN && fx < .64 + SPLAT_MARGIN && fy < .36;
  function placeSplat(slot) {
    const width = screen.width, height = screen.height, half = SPLATS.sprite / 2;
    let x = null, y = 0;
    for (let tries = 0; tries < 8 && x === null; tries++) {
      const roll = random();
      let cx, cy;
      if (roll < .7) { cx = roll < .35 ? 2 + random() * 24 : width - 2 - random() * 24; cy = 4 + random() * (height - 8); }
      else { cx = 12 + random() * (width - 24); cy = roll < .85 ? 2 + random() * 14 : height - 2 - random() * 14; }
      if (!onHud(cx / width, cy / height)) { x = cx; y = cy; }
    }
    // Every roll rejected: a side strip, in the free band between the panels
    // (the right strip only below the weapon panel's grown zone).
    if (x === null) {
      y = (.36 + random() * .26) * height;
      const left = y / height > .56 || random() < .5;
      x = left ? 2 + random() * 24 : width - 26 + random() * 24;
    }
    splatX[slot] = Math.round(x - half); splatY[slot] = Math.round(y - half);
  }
  // ctx.hooks.hurt: the local survivor lost HP. Small ticks add up; low
  // health throws more splats, bigger and longer-lasting. Without a source,
  // a drop no bigger than the rain's tick while the rain hurts is the rain.
  function hurt(event) {
    if (removed || !paint || !event) return;
    const amount = Number(event.amount);
    if (!(amount > 0) || SPLATS.bloodless.includes(event.source)) return;
    const rain = finite(snapshot?.outsideDamagePerSecond) ? snapshot.outsideDamagePerSecond : 3;
    if ((event.source === undefined || event.source === null) && survivor?.outsideDamageActive === true && amount <= rain + 1e-3) return;
    const now = F[NOW];
    splatDamage += amount;
    if (splatDamage < SPLATS.minDamage || now - splatAt < SPLATS.spacing) return;
    const hp = Number(event.hp), maxHp = Number(event.maxHp), low = maxHp > 0 && finite(hp) && hp / maxHp <= SPLATS.lowHealth;
    let count = 1 + (splatDamage >= 20 ? 1 : 0) + (low ? 2 : 0);
    splatDamage = 0; splatAt = now; fitScreen();
    for (; count > 0; count--) {
      const slot = splatNext;
      splatNext = (splatNext + 1) % splatCount;
      paintSplat(slot, low); placeSplat(slot);
      splatBorn[slot] = now; splatLevel[slot] = 255;
      splatLife[slot] = (SPLATS.life[0] + random() * (SPLATS.life[1] - SPLATS.life[0])) * (low ? SPLATS.lowLife : 1);
    }
    splatsAwake = true;
  }
  function updateSplats() {
    if (!splatsAwake || !paint) return;
    let awake = false, redraw = false;
    const now = F[NOW];
    for (let slot = 0; slot < splatCount; slot++) {
      const age = now - splatBorn[slot], life = splatLife[slot], hold = life * .35;
      let level = 0;
      if (age >= 0 && age < life) { awake = true; level = age < hold ? SPLATS.steps : Math.ceil((1 - (age - hold) / (life - hold)) * SPLATS.steps); }
      if (level !== splatLevel[slot]) { splatLevel[slot] = level; redraw = true; }
    }
    splatsAwake = awake;
    if (!redraw) return;
    paint.clearRect(0, 0, screen.width, screen.height);
    for (let slot = 0; slot < splatCount; slot++) {
      if (!splatLevel[slot]) continue;
      paint.globalAlpha = SPLATS.alpha * splatLevel[slot] / SPLATS.steps;
      paint.drawImage(sprites[slot], splatX[slot], splatY[slot]);
    }
    paint.globalAlpha = 1;
    if (screen.style) screen.style.visibility = awake ? 'visible' : 'hidden';
  }

  // A new night after the results starts on a clean floor.
  function clearAll() {
    dropStart.fill(-Infinity); dropsAwake = true;
    for (let slot = 0; slot < S; slot++) clearStain(slot);
    stainsAwake = true;
    splatBorn.fill(-Infinity); splatDamage = 0; splatsAwake = true;
    pendUsed.fill(0); pendCount = 0; sprayUsed.fill(0); zombieUsed.fill(0); zombieId.fill(null); sprayId.fill(null);
    for (let index = 0; index < SPOTS; index++) if (spotUsed[index]) spotEnd[index] = -Infinity;
    F[SPOT_CHANGE] = -Infinity; spotsAwake = true;
    F[PUFFS_RECENT] = F[WANTED_RECENT] = F[WANTED_BEFORE] = F[GOV_CARRY] = 0; F[GOV] = 1;
  }
  // The camera's axis and view for the rule by size on screen (A13): the
  // nearest depth at which a cube of 1 cell stays within `one` px and one of
  // 2 within `two` px at 1080p, and how far an arc may pass and still come
  // that near in depth inside the view (the cone through the frame's corners).
  function aim() {
    camera.getWorldDirection(forward);
    F[FWD_X] = forward.x; F[FWD_Y] = forward.y; F[FWD_Z] = forward.z;
    const fov = finite(camera.fov) && camera.fov > 0 && camera.fov < 180 ? camera.fov : SPRAY.fov, aspect = finite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9;
    const tanV = Math.tan(fov / 2 * DEG), focal = SCREEN.lines / 2 / tanV;
    F[TAN_D] = tanV * Math.sqrt(1 + aspect * aspect);
    F[SCREEN_ONE] = GRID * focal / SCREEN.one * SCREEN.margin; F[SCREEN_TWO] = 2 * GRID * focal / SCREEN.two * SCREEN.margin;
    F[SCREEN_REACH] = 1.5 * F[SCREEN_TWO] * Math.sqrt(1 + F[TAN_D] * F[TAN_D]);
  }
  // ctx.hooks.frame: the visual clock (frozen in a pause or a hit-stop when
  // the game's delta is), then the wounds now due, then every pool.
  function frame(event) {
    if (removed) return;
    // The event's numbers are read straight into arithmetic: passing them to
    // Number() or Number.isFinite() would box each in a heap number a frame.
    const delta = event ? event.delta : 0, step = typeof delta === 'number' && delta > 0 ? (delta < .25 ? delta : .25) : 0;
    F[NOW] += step;
    if (event?.snapshot && event.snapshot !== snapshot) { snapshot = event.snapshot; rememberRaiders(snapshot.zombies); }
    if (event?.self) survivor = event.self;
    const time = event ? event.time : Number.NaN;
    if (typeof time === 'number' && time - time === 0) F[FRAME_TIME] = time;
    const next = snapshot?.phase;
    if (typeof next === 'string' && next !== phase) { if (FINISHED.includes(phase) && !FINISHED.includes(next)) clearAll(); phase = next; }
    if (hasCamera) {
      const position = camera.position, fov = camera.fov;
      F[CAM_X] = position.x; F[CAM_Y] = position.y; F[CAM_Z] = position.z;
      F[FOV_K] = finite(fov) && fov > 0 && fov < 180 ? Math.tan(fov / 2 * DEG) / TAN_FOV : 1;
      if (looks) aim();
    }
    thrownFrame = 0;
    F[WANTED_BEFORE] = F[WANTED_RECENT];
    if (step > 0) { const decay = Math.exp(-step / SPRAY.governor.window); F[PUFFS_RECENT] *= decay; F[WANTED_RECENT] *= decay; }
    if (pendCount > 0) duePuffs();
    flushDue();
    updateDroplets(); updateStains(); updateSpots(); updateSplats();
  }

  if (parent) parent.add(group);
  // The programs compile now (world.prewarm may already have run), so the
  // first blood never stalls a frame; then the empty pools stop drawing.
  if (parent && ctx.camera && typeof ctx.renderer?.compile === 'function') try { ctx.renderer.compile(group, ctx.camera, ctx.scene ?? parent); } catch {}
  droplets.visible = stains.visible = spots.visible = false;
  if (hasCamera) { F[CAM_X] = camera.position.x; F[CAM_Y] = camera.position.y; F[CAM_Z] = camera.position.z; if (looks) aim(); }
  const handlers = { impact, death, frame, hurt };
  for (const name of HOOKS) hooks[name] = handlers[name];
  return {
    // Live counts, for tests, the bench and the shot tool: thrown is this
    // frame's; thrownTotal, dropped (by the camera rule) and recycledInAir
    // count since install.
    stats: () => ({
      droplets: dropsShown, stainPixels: stainPixelsShown, splats: splatLevel.reduce((sum, level) => sum + (level > 0), 0), spots: spotsShown,
      pending: pendCount, sprays: sprayUsed.reduce((sum, used) => sum + used, 0), thrown: thrownFrame, thrownTotal, dropped, recycledInAir,
      governor: F[GOV], closest: F[CLOSEST], pools: { droplets: DROPS, spots: SPOTS, perFrame: CAP }, knob: B,
      // The full-table paths taken since install (3.2 step 5): sprays flushed
      // early for a slot, and pending wounds thrown early for theirs.
      flushedFull, pendingFull,
    }),
    uninstall() {
      if (removed) return;
      removed = true;
      for (const name of HOOKS) if (hooks[name] === handlers[name]) hooks[name] = null;
      group.removeFromParent();
      // Spots share the stains' material (disposed once) and have their own geometry.
      droplets.geometry.dispose(); droplets.material.dispose();
      flat.dispose(); spotFlat.dispose(); stainMaterial.dispose();
      for (const mesh of [droplets, stains, spots]) mesh.dispose();
      if (screen) { if (typeof screen.remove === 'function') screen.remove(); else screen.parentNode?.removeChild(screen); }
      screen = paint = null; sprites.length = spritePaint.length = 0;
    },
  };
}
