// Deterministic visual variety for zombies: pure data and arithmetic, no
// THREE and no DOM. The server id seeds every choice, so all players see the
// same zombie. Health families (skin, cloth, marker) are never chosen here:
// they stay the readable toughness cue from enemies.js.

export function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const ZOMBIE_PALETTE = Object.freeze({
  hair: Object.freeze([0x3a2a20, 0x5c4630, 0x8b8f93, 0x26262e, 0x9a5130, 0x6f6a3c]),
  hats: Object.freeze([0x7d3434, 0x34587d, 0x5f7d34, 0xc89a3c, 0x5d3c7d, 0x2f6b62]),
  pants: Object.freeze([0x2b3446, 0x3c3226, 0x3a3d40, 0x2a3a2e, 0x46302c]),
  ties: Object.freeze([0x8e2f3c, 0x2f4e8e, 0x3c7d4f, 0xb8862f]),
  denim: 0x34507a, boots: 0x3a281c, sneakers: 0xa9a496, soles: 0x1d1d22,
  mouth: 0x150e16, brows: 0x231b1c, teeth: 0xe6dcc0, bandage: 0xe9e2d0, pot: 0x8a9097, belt: 0x2a211c,
});

export const ZOMBIE_LOOK_OPTIONS = Object.freeze({
  builds: Object.freeze(['regular', 'lanky', 'stocky', 'hunched']),
  skulls: Object.freeze(['round', 'egg', 'wide', 'pear', 'boxy']),
  eyes: Object.freeze(['glare', 'mismatch', 'squint', 'heavy', 'stare']),
  brows: Object.freeze(['angry', 'scowl', 'heavy', 'uneven', 'none']),
  mouths: Object.freeze(['grimace', 'snarl', 'crooked', 'jaw', 'stitched']),
  noses: Object.freeze(['button', 'long', 'none']),
  hair: Object.freeze(['none', 'tufts', 'mop', 'mohawk', 'side']),
  hats: Object.freeze(['none', 'beanie', 'cap', 'capBack', 'bucket', 'bandage', 'headband', 'sweatband', 'pot']),
  tops: Object.freeze(['shirt', 'tie', 'overalls', 'hoodie', 'torn', 'vest', 'tracksuit', 'flannel']),
  shoes: Object.freeze(['boots', 'sneakers', 'oneBare']),
  arms: Object.freeze(['reach', 'dangle', 'oneUp', 'claw', 'pump']),
});

const COVERING_HATS = new Set(['beanie', 'bucket', 'pot']);

// Returns a frozen description of one zombie's look. `id` is the server id
// (z<n>); kind and boss select the matching wardrobe.
export function zombieLook(id, { kind = 'walker', boss = false } = {}) {
  const random = seededRandom(hashSeed(`${id ?? 'zombie'}|${kind}|${boss ? 'boss' : ''}`));
  const pick = list => list[Math.floor(random() * list.length) % list.length];
  const chance = probability => random() < probability;
  const O = ZOMBIE_LOOK_OPTIONS, P = ZOMBIE_PALETTE;
  const brute = kind === 'brute', runner = kind === 'runner', crawler = kind === 'crawler', armored = kind === 'armored';
  const build = runner ? 'lanky' : brute ? 'hulking' : crawler ? 'regular' : pick(['regular', 'regular', 'lanky', 'stocky', 'hunched']);
  const skull = boss ? 'wide' : crawler ? pick(['round', 'wide', 'boxy']) : pick(O.skulls);
  const eyes = pick(O.eyes), brows = pick(O.brows), mouth = pick(O.mouths), nose = pick(O.noses);
  const ears = chance(.72) ? (chance(.18) ? 'one' : 'both') : 'none';
  let hat;
  if (boss) hat = 'none';
  else if (armored) hat = 'pot';
  else if (brute) hat = pick(['none', 'none', 'beanie', 'bandage']);
  else if (runner) hat = pick(['none', 'sweatband', 'capBack', 'headband']);
  // Crawlers stay flat: nothing may lift them to standing height.
  else if (crawler) hat = pick(['none', 'none', 'bandage', 'headband']);
  else hat = chance(.42) ? 'none' : pick(['beanie', 'cap', 'capBack', 'bucket', 'bandage', 'headband']);
  let hair = pick(O.hair);
  if (COVERING_HATS.has(hat) && hair !== 'none') hair = 'tufts';
  if (boss) hair = 'none';
  if (crawler && !['none', 'side'].includes(hair)) hair = pick(['none', 'side']);
  const top = runner ? pick(['hoodie', 'tracksuit'])
    : brute ? pick(['flannel', 'overalls'])
    : crawler ? pick(['shirt', 'torn', 'hoodie'])
    : pick(['shirt', 'tie', 'overalls', 'hoodie', 'torn', 'vest', 'flannel']);
  const shoes = runner ? 'sneakers' : chance(.12) && !boss ? 'oneBare' : pick(['boots', 'boots', 'sneakers']);
  const arms = runner ? 'pump' : crawler ? 'reach' : pick(['reach', 'reach', 'dangle', 'oneUp', 'claw']);
  return Object.freeze({
    id: id ?? null, kind, boss: Boolean(boss),
    build, skull, eyes, brows, mouth, nose, ears, hair, hat, top, shoes, arms,
    hairColor: pick(P.hair), hatColor: pick(P.hats), tieColor: pick(P.ties),
    pantsColor: top === 'overalls' ? P.denim : pick(P.pants),
    headTilt: (random() - .5) * .3,
    widthJitter: .95 + random() * .1,
    phase: random() * Math.PI * 2,
    stride: .92 + random() * .16,
  });
}
