// Frisson blood spray: the recipe (art/frisson/BLOOD-SPRAY.md sections 2 and
// 3). Every wound on a zombie throws pixel blood from its own entry point, and
// the size of the spray follows the damage done (the owner, 14 October 2026).
// A pure module: no THREE, no DOM, nothing allocated per call. blood.js, the
// tests, the bench and the shot tool import it; each passes its own knob B.

// The owner's knob (art/frisson/BLOOD-SPRAY.md section 7): how much blood a
// hit throws. 1 is the tuned amount; .5 half, 2 double (caps and pools
// follow; the entry puffs follow its square root). Clamped to .25–2. Speeds
// and sizes never change with it.
export const BLOOD_INTENSITY = 1;

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
};

// Every constant of sections 2 and 3, by name (BLOOD-SPRAY.md 4.4). Distances
// in metres, speeds in m/s, angles in degrees, times in seconds, damage in HP.
export const SPRAY = freeze({
  damageScale: 20, base: 3, baseFrom: 5, perI: 6, head: .3, blast: .6, exitFrom: 20, recent: .15,
  backShare: .4, nearBackShare: .5, near: 3, legacy: { kill: 40, hit: 25 },
  kinds: { crawler: .75, walker: 1, runner: 1, armored: 1, brute: 1.35, boss: 1.6 },
  distance: [[8, 1], [18, .7], [35, .45]], fov: 76, caps: { low: 32, medium: 48, high: 64 },
  // pressed: the puffs of a teammate's (or a raider's) wound while the
  // governor is under pressure (g < .5): still one, so every wound bleeds (A1).
  puffs: { near: 2, far: 1, max: 18, speed: [.4, 1], out: .02, pressed: 1 },
  back: { speed: [.5, 1.3], perI: .3, max: 3.5, out: .03 },
  // nearInner and nearFan: the shooter's own puffs and back spray open
  // sideways (40°-65° off -u, the azimuth within ±60° of the horizontal), so
  // nothing rises over the reticle and falls back through it; lateralSpeed:
  // a little faster within 3 m, so the impact frame clears it sooner (A13).
  cone: { inner: 25, outer: 65, down: .6, lift: .25, nearSpeed: [1, 2.2], nearInner: 40, nearFan: 60, lateralSpeed: [1.4, 2.4] },
  // melee: a blow splashes from where it lands, along the swing (no exit
  // wound out of the back as a bullet has). core: the shooter's own exit
  // spray leaves at least that many degrees off its axis, his line of sight,
  // and sideways (cone.nearFan), so a body that falls never uncovers blood
  // flying down that line or rising and falling across it (A13).
  exit: { narrow: 27, wide: 35, narrowFromI: 3, vmax: 2, vmaxPerI: .4, max: 5.5, spread: [.45, 1], edge: .4, down: .6, pitchMin: -15,
    blastLift: .35, stagger: .05, shell: { from: 4, angle: 42, speed: .85 }, jet: { from: 300, angle: 14, speed: 1.15, max: 6.5 },
    melee: { angle: 45, speed: .7 }, core: 8 },
  // A blast wound starts on the body's far side from the blast, at the chest
  // (the hitbox's middle + lift × scale), not at the belt.
  blastOrigin: { lift: .3, crawler: .1 },
  globs: { fromI: 3.5, max: 3, cells: 2, speed: .65 },
  fountain: { from: 150, share: .5, base: 3, cap: 6, back: [.8, 1.4], up: [1.4, 2], perI: .12, side: .35, lift: .06 },
  // clear: the shooter's own kill burst keeps that many degrees of yaw off
  // his line of sight (A13), as the exit spray's core.
  kill: { base: 6, perI: 2, capShare: .5, side: [.6, 1.6], sidePerI: .15, up: [1.2, 2.4], head: .4, forwardShare: .5, forwardYaw: 60, clear: 10 },
  split: { share: .2 },
  spots: { base: 4, perI: 3, small: .3, life: [15, 30], far: 25, stick: .6, drip: .3, dripMax: 3, dripStep: .25, same: 48, gap: .008,
    minColour: 1, fast: 3, layers: { exit: .5, back: .3, kill: .2 } },
  // The skin: the drawn Frisson body's front, as a horizontal distance from
  // its axis per unit of scale, by kind and by the hit's height over the
  // feet (a share of the kind's standing height × scale): knots [share, r],
  // linear between them, flat beyond; `head` for a head hit. Measured by
  // ray-casting the drawn zombies of every kind and health family (5.3, A6):
  // legs, then the torso (a colossus's plate, the overlord's carapace).
  // `body` is used when the feet are unknown. A wound on the hitbox face
  // moves in to r (at most `max`, the hitbox's own half-width).
  inset: { max: .32, heights: { standing: 1.82, crawler: .82, boss: 1.91 },
    walker: { knots: [[.46, .065], [.5, .115], [.6, .145], [.68, .16], [.8, .16]], body: .15, head: .16 },
    armored: { knots: [[.46, .065], [.5, .2], [.54, .245], [.77, .245], [.8, .13]], body: .245, head: .16 },
    crawler: { knots: [[.33, .1], [.45, .19], [.55, .21], [.62, .19]], body: .2, head: .21 },
    brute: { knots: [[.46, .07], [.5, .1], [.54, .265], [.77, .265], [.8, .19]], body: .265, head: .18 },
    boss: { knots: [[.12, .065], [.18, .14], [.33, .14], [.4, .065], [.46, .1], [.52, .265], [.56, .32], [.73, .32], [.79, .22]], body: .32, head: .21 } },
  // The flashlight's hot spot: a droplet thrown nearer than `full` to the
  // local camera (the torch) takes its colour × max(floor, distance / full),
  // so the torch never lights it brighter than at `full` (no bright red).
  torch: { full: 2.6, floor: .4 },
  cells: { size: .025, weights: [[1.5, [.6, .4]], [3, [.45, .55]], [Infinity, [.35, .65]]], two: 8, three: 16, nearOne: 2.5 },
  colours: { puff: [0, 0, .2, .8], back: [0, 0, .2, .8], fountain: [0, 0, .2, .8], exit: [0, 0, .6, .4], kill: [0, .2, .5, .3] },
  rest: { small: [1.1, 2], large: [.3, .6] }, snap: .04,
  // screen: the same rule by size on screen. An arc that passes inside the
  // camera's view nearer than a cube `one` px tall at 1080p (`lines`) is
  // dropped, and a 2-cell one nearer than `two` px is 1 cell: near the
  // frame's edges a droplet .45 m away is nearer in depth than in distance
  // (A13). Checked at `samples` points of the arcs that come near enough,
  // with a `margin` on the depth for what passes between two samples.
  eye: { clearance: .45, oneCell: 1.2, approach: .5, approachMax: 3.5, samples: 8,
    screen: { one: 40, two: 30, lines: 1080, samples: 32, margin: 1.04 } },
  // scan: the slots a new droplet looks through for a landed one before it
  // reuses one still in the air (3.1 says 8). In the bench's horde (5.2) 8
  // let 6 % of throws at high recycle a droplet in flight; 128 lets none, at
  // the same frame time.
  governor: { window: .5, share: .2, floor: .2, local: .5, rest: .35, press: .5, pressShrink: .3, scan: 128 },
});

export const SPRAY_MODES = Object.freeze(['bullet', 'melee', 'blast', 'legacy']);
const finite = Number.isFinite;
const TAN_HALF_FOV = Math.tan(SPRAY.fov / 2 * Math.PI / 180);

// B: the knob, clamped to .25–2; anything not a number is the shipped value.
export function knob(value = BLOOD_INTENSITY) {
  const number = typeof value === 'number' ? value : Number.NaN;
  const chosen = finite(number) ? number : BLOOD_INTENSITY;
  return Math.min(2, Math.max(.25, chosen));
}
// A variant's share of the blood (ctx.variant.blood, chosen by ambiance.js):
// Frisson 1, Frisson léger .5 (the owner, 15 October 2026: "diminuer le sang
// de moitié"). A variant only ever takes blood away: a share that is not a
// positive number is 1, and none is above 1.
export function variantShare(variant) {
  const share = variant?.blood;
  return typeof share === 'number' && finite(share) && share > 0 ? Math.min(1, share) : 1;
}
// The knob a variant draws its sprays with: B = knob(value) × share, so
// Frisson's B is knob(value), exactly as before, and Frisson léger's is half
// of it whatever the owner's knob, down to .125 (the .25 floor is the
// owner's knob's, not the variant's).
export function variantKnob(value, variant) {
  return knob(value) * variantShare(variant);
}
// I(x) = log2(1 + x / 20): 25 HP → 1.17, 380 → 4.32, 835 → 5.42.
export function intensity(damage) {
  return Math.log2(1 + Math.max(0, damage) / SPRAY.damageScale);
}
// R(x), the raw burst count: R(0) = 0, so a zombie's first hit gets it whole.
export function rawBurst(damage) {
  const x = Math.max(0, damage);
  return SPRAY.base * Math.min(1, x / SPRAY.baseFrom) + SPRAY.perI * Math.log2(1 + x / SPRAY.damageScale);
}
// S(x), the raw count of floor and wall pixels.
export function rawSpots(damage) {
  const x = Math.max(0, damage);
  return SPRAY.spots.base * Math.min(1, x / SPRAY.baseFrom) + SPRAY.spots.perI * Math.log2(1 + x / SPRAY.damageScale);
}
// K: crawlers bleed less, colossi more and the overlord most.
export function kindFactor(kind, boss) {
  if (boss === true) return SPRAY.kinds.boss;
  const factor = typeof kind === 'string' && Object.hasOwn(SPRAY.kinds, kind) ? SPRAY.kinds[kind] : 1;
  return factor;
}
// d_eff: a scope (a narrower fov) brings everything nearer.
export function effectiveDistance(distance, fov) {
  if (!finite(fov) || fov <= 0 || fov >= 180) return distance;
  return distance * Math.tan(fov / 2 * Math.PI / 180) / TAN_HALF_FOV;
}
// L: 1 within 8 m, .7 within 18, .45 within 35 and nothing beyond.
export function distanceFactor(distanceEff) {
  const bands = SPRAY.distance;
  for (let index = 0; index < bands.length; index++) if (distanceEff <= bands[index][0]) return bands[index][1];
  return 0;
}
// Entry puffs of one wound at d_eff: none past 35 m and none for blasts and
// legacy calls; the knob counts by its square root.
export function puffsFor(distanceEff, mode, B) {
  const L = distanceFactor(distanceEff);
  if (L === 0 || mode === 'blast' || mode === 'legacy') return 0;
  const root = Math.sqrt(B);
  return L >= 1 ? Math.round(SPRAY.puffs.near * root) : Math.max(1, Math.round(SPRAY.puffs.far * root));
}

// The plan of one spray (BLOOD-SPRAY.md 2.2). `spray` is { damage (D),
// recent (A), headShare, wounds, kind, boss, mode, kill, killDone, distance
// (d_eff), local, carry, spotCarry }; `out` receives { puffsPerWound,
// puffsMax, burst, back, exit, globs, fountain, kill, spots, theta, vmax,
// carry, spotCarry, intensity, distanceFactor }. Every number is computed in
// this body (no helper call): blood.js calls it on every spray, and a double
// handed across a call V8 does not inline is a heap allocation.
export function sprayPlan(spray, quality, B, out) {
  const S = SPRAY;
  const D = spray.damage > 0 ? spray.damage : 0, A = spray.recent > 0 ? spray.recent : 0, mode = spray.mode;
  const blast = mode === 'blast', puffless = blast || mode === 'legacy';
  const share = spray.headShare > 0 ? Math.min(1, spray.headShare) : 0, wounds = spray.wounds > 0 ? spray.wounds : 0;
  const kind = spray.kind;
  const K = spray.boss === true ? S.kinds.boss
    : kind === 'crawler' ? S.kinds.crawler : kind === 'brute' ? S.kinds.brute : kind === 'boss' ? S.kinds.boss : 1;
  const distance = spray.distance > 0 ? spray.distance : 0;
  const bands = S.distance;
  const L = distance <= bands[0][0] ? bands[0][1] : distance <= bands[1][0] ? bands[1][1] : distance <= bands[2][0] ? bands[2][1] : 0;
  const id = typeof quality === 'string' ? quality : quality?.id;
  const cap = id === 'low' ? S.caps.low : id === 'high' ? S.caps.high : S.caps.medium;
  const big = K > 1 ? K : 1, root = Math.sqrt(B);
  const I = Math.log2(1 + D / S.damageScale);
  const iA = Math.log2(1 + A / S.damageScale), iAD = Math.log2(1 + (A + D) / S.damageScale);
  const rA = S.base * Math.min(1, A / S.baseFrom) + S.perI * iA;
  const rAD = S.base * Math.min(1, (A + D) / S.baseFrom) + S.perI * iAD;
  const sA = S.spots.base * Math.min(1, A / S.baseFrom) + S.spots.perI * iA;
  const sAD = S.spots.base * Math.min(1, (A + D) / S.baseFrom) + S.spots.perI * iAD;
  const carry = finite(spray.carry) ? spray.carry : .5, spotCarry = finite(spray.spotCarry) ? spray.spotCarry : .5;

  const puffsPerWound = L === 0 || puffless ? 0 : L >= 1 ? Math.round(S.puffs.near * root) : Math.max(1, Math.round(S.puffs.far * root));
  const raw = (rAD - rA) * K * (1 + S.head * share) * L * B * (blast ? S.blast : 1) + carry;
  let burst = Math.floor(raw);
  const carryOut = raw - burst, burstCap = Math.round(cap * B * big);
  if (burst > burstCap) burst = burstCap;
  if (L > 0 && puffless && burst < 1) burst = 1;
  const backShare = spray.local === true && distance <= S.near ? S.nearBackShare : S.backShare;
  const back = puffless ? 0 : D < S.exitFrom ? burst : Math.round(backShare * burst), exit = burst - back;
  const globs = I >= S.globs.fromI ? Math.min(S.globs.max, 1 + Math.floor(I - S.globs.fromI), exit) : 0;
  const fountain = mode === 'bullet' && share >= S.fountain.share && D >= S.fountain.from
    ? Math.min(Math.round(S.fountain.cap * K * B), Math.round((S.fountain.base + Math.floor(I)) * K * L * B)) : 0;
  const killing = spray.kill === true;
  const kill = killing && spray.killDone !== true
    ? Math.min(Math.round(cap * S.kill.capShare * B * big), Math.round((S.kill.base + S.kill.perI * I) * K * L * B)) + fountain : 0;
  // Floor and wall pixels follow the burst's kind and head factors: a
  // colossus's head leaves more than a walker's body for the same damage.
  const spotRaw = (sAD - sA) * K * (1 + S.head * share) * L * B + spotCarry, spots = Math.floor(spotRaw);

  let theta = S.exit.wide, speed = 1, top = Infinity;
  if (!puffless) {
    if (mode === 'melee') { theta = S.exit.melee.angle; speed = S.exit.melee.speed; }
    else if (wounds >= S.exit.shell.from) { theta = S.exit.shell.angle; speed = S.exit.shell.speed; }
    else if (wounds <= 1 && D >= S.exit.jet.from) { theta = S.exit.jet.angle; speed = S.exit.jet.speed; top = S.exit.jet.max; }
    else theta = I >= S.exit.narrowFromI ? S.exit.narrow : S.exit.wide;
  }
  const vmax = Math.min(top, Math.min(S.exit.max, S.exit.vmax * (1 + S.exit.vmaxPerI * I)) * speed);

  out.puffsPerWound = puffsPerWound; out.puffsMax = Math.round(S.puffs.max * root);
  out.burst = burst; out.back = back; out.exit = exit; out.globs = globs;
  out.fountain = killing ? 0 : fountain; out.kill = kill; out.spots = spots;
  out.theta = theta; out.vmax = vmax; out.carry = carryOut; out.spotCarry = spotRaw - spots;
  out.intensity = I; out.distanceFactor = L;
  return out;
}

// The skin radius per unit of scale (2.3, `inset`) of a hit at `share` of
// the kind's standing height over its feet (not finite: unknown, the
// torso's), or on the head. blood.js computes the same inline (its hot path
// passes no double across a call); the tests and the shot tool use this.
export function skinTable(kind, boss) {
  const table = SPRAY.inset;
  return boss === true ? table.boss : kind === 'brute' ? table.brute : kind === 'crawler' ? table.crawler : kind === 'armored' ? table.armored : table.walker;
}
export function skinHeight(kind, boss) {
  const heights = SPRAY.inset.heights;
  return boss === true ? heights.boss : kind === 'crawler' ? heights.crawler : heights.standing;
}
export function skinRadius(kind, boss, share, head) {
  const entry = skinTable(kind, boss);
  if (head === true) return entry.head;
  if (!finite(share)) return entry.body;
  const knots = entry.knots;
  if (share <= knots[0][0]) return knots[0][1];
  for (let index = 1; index < knots.length; index++) {
    if (share > knots[index][0]) continue;
    const s0 = knots[index - 1][0], r0 = knots[index - 1][1], s1 = knots[index][0], r1 = knots[index][1];
    return r0 + (r1 - r0) * (share - s0) / (s1 - s0);
  }
  return knots[knots.length - 1][1];
}

// Cells (2.5 cm each) of one flying droplet: 1 or 2 within 8 m (bigger hits
// lean to 2), 2 to 16 m, 3 beyond (3 px or less there). Puffs, the near back
// spray, globs and droplets passing the camera are decided by blood.js.
export function cellsFor(intensity, distanceEff, random) {
  const cells = SPRAY.cells;
  if (distanceEff > cells.three) return 3;
  if (distanceEff > cells.two) return 2;
  const weights = intensity < cells.weights[0][0] ? cells.weights[0][1] : intensity < cells.weights[1][0] ? cells.weights[1][1] : cells.weights[2][1];
  return random() < weights[0] ? 1 : 2;
}
