import * as THREE from '/vendor/three.module.js';
import { enemyProfile, enemyAppearance } from './rules.js';
import { zombieLook, ZOMBIE_PALETTE as P } from './zombie-looks.js';
import { PartBuilder } from './mesh-merge.js';
import { emitBurn, impactBurst } from './shot-fx.js';
import { sharedEffects } from './fx.js';

// Storybook zombies: rounded, hunched and varied, with glowing eyes that
// pierce the fog, but no blood, wounds or gore. Every rigid part is merged
// into a few meshes per material. Family skin and cloth keep their shared,
// never-recoloured materials: colour is the toughness cue. The client owns
// the root transform; poses, sway and squash live on the inner body group.

const materials = new Map();
const RIM = { color: new THREE.Color(0x8fb2ff), strength: .14 };
// A cool moonlit rim keeps silhouettes readable against the fog.
export function withRim(material, rimScale = 1, rimColor = RIM.color) {
  material.onBeforeCompile = shader => {
    shader.uniforms.rimColor = { value: rimColor }; shader.uniforms.rimStrength = { value: RIM.strength * rimScale };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;')
      .replace('#include <opaque_fragment>', 'float rimLight = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0);\noutgoingLight += rimColor * rimLight * rimStrength;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'zombieRim';
  return material;
}
function cached(name, create) {
  if (!materials.has(name)) materials.set(name, create());
  return materials.get(name);
}
const standard = (name, color, roughness, extra = {}) => cached(name, () => withRim(new THREE.MeshStandardMaterial({ color, roughness, ...extra })));
const skinMaterial = appearance => standard(`enemySkin-${appearance.id}`, appearance.color, .82);
const clothMaterial = appearance => standard(`enemyCloth-${appearance.id}`, appearance.clothColor, .96);
const detailMaterial = () => standard('zombieDetail', 0xffffff, .86, { vertexColors: true });
// Three glow colours only: walkers, crawlers and the overlord. Fog does not
// dim them, so eyes shine out of the mist before the body is visible.
const EYES = {
  walker: () => cached('zombieEyes', () => new THREE.MeshStandardMaterial({ color: 0xf6b867, roughness: .2, emissive: 0xe38336, emissiveIntensity: 2.6, fog: false })),
  crawler: () => cached('crawlerEyes', () => new THREE.MeshStandardMaterial({ color: 0xe3d48b, roughness: .3, emissive: 0xa17732, emissiveIntensity: 1.1, fog: false })),
  boss: () => cached('bossEyes', () => new THREE.MeshStandardMaterial({ color: 0xc46b58, roughness: .3, emissive: 0xa13d29, emissiveIntensity: .9, fog: false })),
};

// An optional head style installed at runtime by another look; null is the
// storybook look above. style.buildHead(head, appearance, look, options)
// either adds its meshes (family skin first) and returns { hat }, or adds
// nothing and returns null for the procedural head. style.skin(appearance)
// and style.eyes(kind, boss) return a material, or null for the family skin
// and glow. Shared geometry is never flagged userData.ownedGeometry.
let zombieStyle = null;
export function setZombieStyle(style = null) { zombieStyle = style ?? null; }
export function getZombieStyle() { return zombieStyle; }
const skinFor = appearance => zombieStyle?.skin?.(appearance) ?? skinMaterial(appearance);
const eyesFor = (kind, boss) => zombieStyle?.eyes?.(kind, boss) ?? (kind === 'crawler' ? EYES.crawler() : boss ? EYES.boss() : EYES.walker());

// The same style may answer for the body (art/frisson/BODIES.md), either for
// every part of a zombie or for none: style.buildTorso(body, appearance,
// look, { kind, boss, id, crawler, build, w, d, hunch }) adds zombieTorso
// first, then zombieSkin and zombieClothes, and returns { torso, front, back }
// (the chest's and the back's z, body space), maybe with frontAt([x0, x1],
// [y0, y1]), the chest's z over that patch, for a strip off its middle;
// style.buildArm(pivot, appearance, look, { side, length, thickness, kind,
// boss, id, crawler }) and
// style.buildLeg(pivot, …, { side, thickness, bare, … }) fill a pivot placed
// here and return {} and { shinFront }. null keeps the procedural part.
// Pivots, armour, markers and animation stay here; styled meshes set their
// own shadows.

// With its own heads, a style may also cast the family's head marks onto
// them, style.markHead(headMarks, appearance, { crawler }), and dress the
// overlord's head, style.bossHelmet(head, appearance): true means done, and
// the storybook pieces are left off.

const geometries = new Map();
const shared = (key, create) => { if (!geometries.has(key)) geometries.set(key, create()); return geometries.get(key); };
const SPHERE = () => shared('sphere', () => new THREE.SphereGeometry(1, 12, 8));
const BALL = () => shared('ball', () => new THREE.SphereGeometry(1, 8, 6));
const DOME = () => shared('dome', () => new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2));
const BOX = () => shared('box', () => new THREE.BoxGeometry(1, 1, 1));
const CYLINDER = () => shared('cylinder', () => new THREE.CylinderGeometry(1, 1, 1, 14));
const TAPER = () => shared('taper', () => new THREE.CylinderGeometry(.82, 1, 1, 14));
const CONE = () => shared('cone', () => new THREE.ConeGeometry(1, 1, 7));
const RING = () => shared('ring', () => new THREE.TorusGeometry(1, .16, 6, 20).rotateX(Math.PI / 2));
const capsule = (radius, length) => shared(`capsule:${radius}:${length}`, () => new THREE.CapsuleGeometry(radius, length, 4, 10));
// A superellipsoid: a sphere pushed towards a cube, for boxy skulls and pads.
const ROUNDED = () => shared('rounded', () => {
  const geometry = new THREE.SphereGeometry(1, 16, 12), position = geometry.attributes.position, point = new THREE.Vector3();
  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index);
    position.setXYZ(index, Math.sign(point.x) * Math.abs(point.x) ** .45, Math.sign(point.y) * Math.abs(point.y) ** .45, Math.sign(point.z) * Math.abs(point.z) ** .45);
  }
  geometry.computeVertexNormals(); return geometry;
});

const shade = (hex, factor) => new THREE.Color(hex).multiplyScalar(factor).getHex();
const BUILDS = {
  regular: { width: 1, depth: 1, arm: 1, hunch: 0, shoulder: .3, limb: 1 },
  lanky: { width: .88, depth: .9, arm: 1.12, hunch: .07, shoulder: .27, limb: .88 },
  stocky: { width: 1.14, depth: 1.22, arm: .94, hunch: 0, shoulder: .32, limb: 1.12 },
  hunched: { width: 1, depth: 1.04, arm: 1.06, hunch: .26, shoulder: .3, limb: 1 },
  hulking: { width: 1.16, depth: 1.12, arm: 1.04, hunch: .14, shoulder: .33, limb: 1.15 },
};
// Skull shapes keep the head centred on the server head height and inside
// the head-shot band; `front` is the face surface depth.
const SKULLS = {
  round: { front: .2, half: .2, top: .215, parts: [[SPHERE, [0, 0, 0], [.2, .215, .2]]] },
  egg: { front: .19, half: .18, top: .237, parts: [[SPHERE, [0, .015, 0], [.18, .222, .19]]] },
  wide: { front: .2, half: .235, top: .19, parts: [[SPHERE, [0, 0, 0], [.235, .19, .2]]] },
  pear: { front: .2, half: .205, top: .22, parts: [[SPHERE, [0, .05, .01], [.17, .17, .17]], [SPHERE, [0, -.06, -.01], [.205, .145, .19]]] },
  boxy: { front: .19, half: .2, top: .21, parts: [[ROUNDED, [0, 0, 0], [.2, .21, .19]]] },
};
// Glowing eyes under heavy lids: [x, y, rx, ry, tilt]. Each lid and brow
// dips towards the nose by `tilt`, so faces glare instead of gaping.
const EYE_LAYOUTS = {
  glare: [[-.07, .028, .036, .022, .22], [.07, .028, .036, .022, .22]],
  mismatch: [[-.072, .03, .04, .026, .12], [.07, .032, .03, .017, .3]],
  squint: [[-.07, .03, .04, .017, .28], [.07, .03, .04, .017, .28]],
  heavy: [[-.07, .022, .038, .021, .18], [.07, .024, .036, .02, .22]],
  stare: [[-.075, .03, .042, .029, .16], [.075, .03, .042, .029, .16]],
};
// Brow tilt per side (positive lowers the inner end into a frown).
const BROWS = { angry: [.42, .42], scowl: [.58, .58], heavy: [.26, .3], uneven: [.5, .16], none: null };

export function zombieIdSeed(id) { return id ?? null; }

export function createZombie(kind = 'walker', boss = false, maxHp, id) {
  const zombie = new THREE.Group();
  zombie.rotation.order = 'YXZ';
  const appearance = enemyAppearance({ kind, boss, maxHp });
  const look = zombieLook(id, { kind, boss });
  const body = new THREE.Group(); body.name = 'zombieBody'; zombie.add(body);
  const parts = kind === 'crawler' ? buildCrawler(body, appearance, look, id) : buildStanding(body, appearance, look, kind, boss, id);
  zombie.userData = { ...parts, body, look, appearanceId: appearance.id, maxHp, kind, boss: kind === 'crawler' ? false : boss, phase: look.phase };
  if (kind === 'brute') zombie.scale.setScalar(boss ? 1.32 : 1.22);
  if (boss) addCarapace(zombie);
  zombie.traverse(object => { if (object.isMesh && object.userData.ownedGeometry) object.castShadow = true; });
  // A style may re-dress the armour and the carapace (art/frisson/BODIES.md).
  // typeof: the test baselines rebuild this file with the style block off.
  if (typeof zombieStyle !== 'undefined') zombieStyle?.dressArmor?.(zombie, appearance);
  return zombie;
}

function mesh(builder, material, parent, name) {
  if (builder.empty) return null;
  const result = builder.build(material, name); result.userData.ownedGeometry = true; result.receiveShadow = true; parent.add(result);
  return result;
}

function buildStanding(body, appearance, look, kind, boss, id) {
  const build = BUILDS[look.build] ?? BUILDS.regular, w = build.width, d = build.depth;
  const skinHex = appearance.color, clothHex = appearance.clothColor;
  const cloth = new PartBuilder(), skin = new PartBuilder(), detail = new PartBuilder();
  const lean = -build.hunch, torsoY = 1.2;
  let front = -(.147 * d + .012);
  // Torso: a soft bean of the family cloth colour, tipped forward when hunched.
  cloth.add(capsule(.21, .28), clothHex, { position: [0, torsoY, -build.hunch * .06], rotation: [lean, 0, 0], scale: [1.12 * w, 1, .7 * d] });
  skin.add(CYLINDER(), skinHex, { position: [0, 1.52, -build.hunch * .14], scale: [.07, .16, .07] });
  // Hips and belt.
  detail.add(SPHERE(), look.pantsColor, { position: [0, .93, 0], scale: [.215 * w, .11, .15 * d] });
  addTop(look, { cloth, skin, detail, w, d, front, clothHex, skinHex, torsoY });
  const styled = zombieStyle?.buildTorso?.(body, appearance, look, { kind, boss, id, crawler: false, build, w, d, hunch: build.hunch }) ?? null;
  if (styled && Number.isFinite(styled.front)) front = styled.front;
  const backZ = styled && Number.isFinite(styled.back) ? styled.back : undefined;
  const torsoMesh = styled ? styled.torso : mesh(cloth, clothMaterial(appearance), body, 'zombieTorso');
  if (!styled) mesh(skin, skinFor(appearance), body, 'zombieSkin');
  if (!styled) mesh(detail, detailMaterial(), body, 'zombieClothes');

  const head = new THREE.Group(); head.name = 'zombieHead'; head.position.set(0, 1.68, -build.hunch * .2); body.add(head);
  const headParts = buildHead(head, appearance, look, { eyes: eyesFor(kind, boss), id, boss, kind });

  const shoulderY = 1.42 - build.hunch * .05, shoulderZ = -build.hunch * .12, armLength = .52 * build.arm;
  const arms = [-1, 1].map(side => buildArm(body, appearance, look, { side, x: side * build.shoulder * w, y: shoulderY, z: shoulderZ, length: armLength, thickness: build.limb, kind, boss, id }));
  const legs = [-1, 1].map(side => buildLeg(body, appearance, look, { side, x: side * .125 * w, thickness: build.limb, kind, boss, id }));
  const armor = kind === 'armored' ? buildArmor(body, appearance, look, { w, d, front, backZ })
    : kind === 'brute' ? buildHeavyArmor(body, head, appearance, { w, d, front, boss, legs }) : { pieces: [], cracks: null };
  const healthMarker = markZombie(body, head, appearance, { kind, boss, id, crawler: false, build, w, d, hunch: build.hunch, front, torsoY, arms, frontAt: styled?.frontAt });
  const [leftArm, rightArm] = arms, [leftLeg, rightLeg] = legs;
  const base = armPose(look);
  // The hat flies off at half health; armour pieces follow their own stages.
  const damage = [...armor.pieces, ...(headParts.hat ? [{ object: headParts.hat, stage: 2, hat: true }] : [])];
  return { head, leftArm, rightArm, leftLeg, rightLeg, healthMarker, torso: torsoMesh, hat: headParts.hat, baseArms: base, damage, cracks: armor.cracks, ...(styled ? { chestFront: front } : {}) };
}

function addTop(look, { cloth, skin, detail, w, d, front, clothHex, skinHex, torsoY }) {
  const darker = shade(clothHex, .55), lighter = shade(clothHex, 1.35);
  const frontAt = (x, y, dz = 0) => [x, y, front - dz];
  switch (look.top) {
    case 'tie':
      for (const side of [-1, 1]) detail.add(BOX(), 0xe9e4d6, { position: frontAt(side * .045, 1.47, .004), rotation: [0, 0, side * .5], scale: [.07, .035, .02] });
      detail.add(BOX(), look.tieColor, { position: frontAt(0, 1.44, .012), scale: [.04, .035, .02] });
      detail.add(BOX(), look.tieColor, { position: frontAt(0, 1.27, .008), rotation: [0, 0, .06], scale: [.055, .3, .015] });
      break;
    case 'overalls':
      detail.add(ROUNDED(), P.denim, { position: frontAt(0, 1.08, -.004), scale: [.15 * w, .15, .03] });
      for (const side of [-1, 1]) {
        detail.add(BOX(), P.denim, { position: [side * .09 * w, 1.3, front - .002], rotation: [0, 0, side * .12], scale: [.045, .34, .025] });
        detail.add(BOX(), P.denim, { position: [side * .09 * w, 1.3, -front + .002], rotation: [0, 0, -side * .12], scale: [.045, .34, .025] });
        detail.add(BALL(), 0xd8b45a, { position: frontAt(side * .085, 1.2, .022), scale: [.018, .018, .01] });
      }
      break;
    case 'hoodie':
    case 'tracksuit':
      cloth.add(SPHERE(), clothHex, { position: [0, 1.5, .1], scale: [.19 * w, .1, .12] });
      if (look.top === 'hoodie') {
        detail.add(ROUNDED(), darker, { position: frontAt(0, 1.0, .002), scale: [.14 * w, .06, .02] });
        for (const side of [-1, 1]) detail.add(BOX(), 0xe2ddd0, { position: frontAt(side * .04, 1.38, .01), scale: [.012, .12, .01] });
      } else {
        for (const side of [-1, 1]) detail.add(BOX(), 0xf0ece0, { position: [side * .225 * w, torsoY, 0], scale: [.02, .5, .2 * d] });
        detail.add(BOX(), 0xf0ece0, { position: frontAt(0, 1.32, .006), scale: [.016, .3, .012] });
      }
      break;
    case 'torn':
      // A ripped hem and a patch of skin through the shirt: no wound.
      for (const x of [-.15, -.05, .06, .16]) cloth.add(CONE(), clothHex, { position: [x * w, .9, front + .03], rotation: [Math.PI, 0, x * 2], scale: [.045, .09, .03] });
      skin.add(SPHERE(), skinHex, { position: frontAt(.06 * w, 1.08, -.004), scale: [.07, .05, .025] });
      detail.add(BOX(), 0x2a2124, { position: frontAt(-.08, 1.33, .006), rotation: [0, 0, .4], scale: [.09, .012, .01] });
      break;
    case 'vest':
      for (const side of [-1, 1]) detail.add(ROUNDED(), 0x4a3426, { position: [side * .12 * w, 1.2, front + .004], scale: [.075 * w, .23, .02] });
      break;
    case 'flannel':
      for (const y of [1.0, 1.14, 1.28, 1.42]) detail.add(BOX(), darker, { position: frontAt(0, y, .004), scale: [.38 * w, .022, .008] });
      for (const x of [-.11, .04, .15]) detail.add(BOX(), darker, { position: frontAt(x * w, 1.2, .006), scale: [.02, .5, .008] });
      detail.add(BOX(), lighter, { position: frontAt(-.05 * w, 1.21, .007), scale: [.012, .48, .008] });
      break;
    default:
      for (const y of [1.1, 1.22, 1.34]) detail.add(BALL(), 0xd9d2c0, { position: frontAt(0, y, .006), scale: [.016, .016, .01] });
  }
  if (!['overalls', 'hoodie', 'tracksuit'].includes(look.top)) detail.add(RING(), P.belt, { position: [0, .96, 0], scale: [.215 * w, .16, .155 * d] });
}

// options: { eyes, scale, crawler, id, boss, kind }.
function buildHead(head, appearance, look, options) {
  const styled = zombieStyle?.buildHead?.(head, appearance, look, options);
  if (styled) return styled;
  const { eyes, scale = 1, crawler = false } = options;
  const skull = SKULLS[look.skull] ?? SKULLS.round, skinHex = appearance.color;
  const skin = new PartBuilder(), detail = new PartBuilder(), glow = new PartBuilder();
  const s = scale, f = -skull.front * s;
  for (const [shape, position, size] of skull.parts) skin.add(shape(), skinHex, { position: position.map(v => v * s), scale: size.map(v => v * s) });
  if (look.ears !== 'none') for (const side of look.ears === 'one' ? [1] : [-1, 1])
    skin.add(SPHERE(), skinHex, { position: [side * (skull.half + .008) * s, -.005 * s, .01 * s], scale: [.032 * s, .058 * s, .044 * s] });
  if (look.nose === 'button') skin.add(SPHERE(), skinHex, { position: [0, -.015 * s, f - .012 * s], scale: [.034 * s, .03 * s, .034 * s] });
  if (look.nose === 'long') skin.add(SPHERE(), skinHex, { position: [0, -.02 * s, f - .03 * s], rotation: [.25, 0, 0], scale: [.03 * s, .03 * s, .062 * s] });
  if (look.mouth === 'jaw') skin.add(SPHERE(), skinHex, { position: [0, -.175 * s, -.03 * s], scale: [.13 * s, .055 * s, .11 * s] });
  // Eyes glow from shallow dark sockets; a skin lid cuts each one into a
  // glare, a small pupil stares at you, and the brow presses down on it.
  const layout = EYE_LAYOUTS[look.eyes] ?? EYE_LAYOUTS.glare, brows = BROWS[look.brows];
  layout.forEach(([x, y, rx, ry, tilt], index) => {
    const side = Math.sign(x), turn = side * tilt;
    detail.add(BALL(), P.mouth, { position: [x * s, (y - ry * .1) * s, f + .006 * s], scale: [rx * 1.22 * s, (ry * 1.3 + .004) * s, .02 * s] });
    glow.add(SPHERE(), 0xffffff, { position: [x * s, y * s, f - .004 * s], scale: [rx * s, ry * s, .012 * s] });
    detail.add(BALL(), 0x120a0c, { position: [(x - side * rx * .18) * s, (y - ry * .15) * s, f - .016 * s], scale: [rx * .24 * s, ry * .5 * s, .005 * s] });
    skin.add(SPHERE(), skinHex, { position: [x * s, (y + ry) * s, f - .02 * s], rotation: [0, 0, turn], scale: [rx * 1.32 * s, ry * .95 * s, .012 * s] });
    if (brows) detail.add(BOX(), P.brows, { position: [(x + side * .004) * s, (y + ry * 1.55 + .006) * s, f - .024 * s], rotation: [0, 0, side * brows[index]], scale: [.088 * s, .024 * s, .02 * s] });
  });
  addMouth(detail, look, s, f);
  addHair(detail, look, skull, s, crawler);
  // Built first, the family skin stays the head's first child.
  mesh(skin, skinFor(appearance), head, 'zombieHeadSkin');
  mesh(detail, detailMaterial(), head, 'zombieFace');
  mesh(glow, eyes, head, 'zombieEyes');
  return { hat: addZombieHat(head, look, skull, s) };
}

// The look's hat, fitted to a skull ({ front, half, top }, head-local and
// unscaled) and added to the head as its own mesh; null when bare-headed.
export function addZombieHat(head, look, skull, scale = 1) {
  const parts = new PartBuilder();
  addHat(parts, look, skull, scale);
  return mesh(parts, detailMaterial(), head, 'zombieHat');
}

function addMouth(detail, look, s, f) {
  const at = (x, y, dz = 0) => [x * s, y * s, f + dz * s];
  switch (look.mouth) {
    case 'snarl':
      detail.add(SPHERE(), P.mouth, { position: at(0, -.096, .012), scale: [.068 * s, .03 * s, .02 * s] });
      for (const x of [-.04, -.014, .014, .04]) detail.add(BOX(), P.teeth, { position: at(x, -.078, .002), scale: [.017 * s, .02 * s, .012 * s] });
      break;
    case 'crooked':
      detail.add(BOX(), P.mouth, { position: at(.01, -.088, .018), rotation: [0, 0, .2], scale: [.13 * s, .03 * s, .03 * s] });
      detail.add(BOX(), P.teeth, { position: at(.035, -.08, .004), rotation: [0, 0, .2], scale: [.024 * s, .03 * s, .012 * s] });
      break;
    case 'jaw':
      detail.add(BOX(), P.mouth, { position: at(0, -.12, .03), scale: [.13 * s, .06 * s, .03 * s] });
      for (const x of [-.035, .03]) detail.add(BOX(), P.teeth, { position: at(x, -.142, .012), scale: [.022 * s, .028 * s, .012 * s] });
      break;
    case 'stitched':
      detail.add(BOX(), P.mouth, { position: at(0, -.09, .018), scale: [.14 * s, .018 * s, .03 * s] });
      for (const x of [-.045, 0, .045]) detail.add(BOX(), 0xcfc7b4, { position: at(x, -.09, .004), scale: [.01 * s, .045 * s, .01 * s] });
      break;
    default:
      // Fangs at the corners read as a grimace; centred teeth looked goofy.
      detail.add(BOX(), P.mouth, { position: at(0, -.088, .018), scale: [.15 * s, .036 * s, .03 * s] });
      for (const x of [-.052, .052]) detail.add(BOX(), P.teeth, { position: at(x, -.08, .004), scale: [.018 * s, .034 * s, .012 * s] });
  }
}

function addHair(detail, look, skull, s, crawler) {
  const color = look.hairColor, top = skull.top * s;
  const covered = ['beanie', 'bucket', 'pot'].includes(look.hat);
  switch (look.hair) {
    case 'tufts':
      if (covered) for (const side of [-1, 1]) detail.add(CONE(), color, { position: [side * (skull.half - .01) * s, .0, .05 * s], rotation: [0, 0, side * -1.9], scale: [.035 * s, .08 * s, .035 * s] });
      else for (const [x, z, tilt] of [[-.06, .02, .4], [.02, -.03, -.1], [.07, .04, -.5]])
        detail.add(CONE(), color, { position: [x * s, top - .005 * s, z * s], rotation: [tilt * .4, 0, tilt], scale: [.035 * s, .09 * s, .035 * s] });
      break;
    case 'mop':
      if (!crawler) detail.add(DOME(), color, { position: [0, top * .3, .01 * s], scale: [(skull.half + .012) * s, top * .78, (skull.front + .012) * s] });
      break;
    case 'mohawk':
      for (let index = 0; index < 5; index++) detail.add(BOX(), color, { position: [0, top - .01 * s + Math.sin(index / 4 * Math.PI) * .012 * s, (-.12 + index * .06) * s], scale: [.03 * s, .075 * s, .05 * s] });
      break;
    case 'side':
      detail.add(SPHERE(), color, { position: [.035 * s, top * .62, 0], rotation: [0, 0, -.28], scale: [(skull.half - .01) * s, .06 * s, (skull.front - .005) * s] });
      break;
  }
}

function addHat(hat, look, skull, s) {
  const color = look.hatColor, band = shade(color, .7), top = skull.top * s, r = (skull.half + .014) * s, fr = (skull.front + .014) * s;
  switch (look.hat) {
    case 'beanie':
      hat.add(DOME(), color, { position: [0, top * .25, 0], scale: [r, top * .86, fr] });
      hat.add(CYLINDER(), band, { position: [0, top * .3, 0], scale: [r + .006 * s, .05 * s, fr + .006 * s] });
      if (look.hatColor === P.hats[0] || look.hatColor === P.hats[3]) hat.add(SPHERE(), 0xf2eadb, { position: [0, top * 1.12, 0], scale: [.038 * s, .038 * s, .038 * s] });
      break;
    case 'cap':
    case 'capBack': {
      const forward = look.hat === 'cap' ? -1 : 1;
      hat.add(DOME(), color, { position: [0, top * .42, 0], scale: [r, top * .62, fr] });
      hat.add(CYLINDER(), band, { position: [0, top * .45, forward * (fr + .05 * s)], scale: [.12 * s, .012 * s, .1 * s] });
      break;
    }
    case 'bucket':
      hat.add(TAPER(), color, { position: [0, top * .62, 0], scale: [r * .92, .1 * s, fr * .92] });
      hat.add(CYLINDER(), band, { position: [0, top * .38, 0], scale: [r + .07 * s, .012 * s, fr + .07 * s] });
      break;
    case 'bandage':
      hat.add(RING(), P.bandage, { position: [0, .05 * s, 0], rotation: [.12, 0, .08], scale: [r, .2, fr] });
      hat.add(BOX(), P.bandage, { position: [.05 * s, .02 * s, fr - .005 * s], rotation: [.4, 0, .3], scale: [.03 * s, .09 * s, .012 * s] });
      break;
    case 'headband':
    case 'sweatband':
      hat.add(RING(), look.hat === 'sweatband' ? 0xf1ece0 : color, { position: [0, .08 * s, 0], scale: [r - .004 * s, .16, fr - .004 * s] });
      break;
    case 'pot':
      hat.add(TAPER(), P.pot, { position: [0, top * .7, 0], rotation: [0, 0, .06], scale: [r * 1.02, .13 * s, fr * 1.02] });
      hat.add(BOX(), shade(P.pot, .6), { position: [r + .05 * s, top * .62, 0], scale: [.1 * s, .025 * s, .04 * s] });
      break;
  }
}

function armPose(look) {
  switch (look.arms) {
    case 'dangle': return [.32, .38];
    case 'oneUp': return [1.25, .45];
    case 'claw': return [.62, .7];
    case 'pump': return [.35, .35];
    default: return [.95, 1.05];
  }
}

function buildArm(body, appearance, look, { side, x, y, z, length, thickness = 1, ...who }) {
  const pivot = new THREE.Group(); pivot.name = side < 0 ? 'zombieLeftArm' : 'zombieRightArm'; pivot.position.set(x, y, z); body.add(pivot);
  if (zombieStyle?.buildArm?.(pivot, appearance, look, { side, length, thickness, ...who, crawler: false })) return pivot;
  const cloth = new PartBuilder(), skin = new PartBuilder(), skinHex = appearance.color;
  const sleeve = look.top === 'torn' ? .13 : .2;
  const t = thickness;
  cloth.add(capsule(.085, .1), appearance.clothColor, { position: [0, -.02 - sleeve / 2, 0], scale: [t, sleeve / .27, t] });
  skin.add(capsule(.066, .2), skinHex, { position: [0, -sleeve - (length - sleeve) / 2 + .02, -.01], scale: [t, (length - sleeve) / .33, t] });
  skin.add(SPHERE(), skinHex, { position: [0, -length, -.025], scale: [.074 * t, .064, .09 * t] });
  if (look.arms === 'claw') for (const fx of [-.03, 0, .03]) skin.add(CONE(), skinHex, { position: [fx, -length - .065, -.05], rotation: [-.5, 0, 0], scale: [.014, .05, .014] });
  else skin.add(SPHERE(), skinHex, { position: [side * -.045, -length + .02, -.045], scale: [.024, .022, .032] });
  mesh(cloth, clothMaterial(appearance), pivot, 'zombieSleeve');
  mesh(skin, skinFor(appearance), pivot, 'zombieHand');
  return pivot;
}

function buildLeg(body, appearance, look, { side, x, thickness = 1, ...who }) {
  const pivot = new THREE.Group(); pivot.name = side < 0 ? 'zombieLeftLeg' : 'zombieRightLeg'; pivot.position.set(x, .93, 0); body.add(pivot);
  const detail = new PartBuilder(), bare = look.shoes === 'oneBare' && side < 0;
  const styled = zombieStyle?.buildLeg?.(pivot, appearance, look, { side, thickness, bare, ...who, crawler: false });
  if (styled) { if (Number.isFinite(styled.shinFront)) pivot.userData.shinFront = styled.shinFront; return pivot; }
  const t = thickness;
  detail.add(SPHERE(), look.pantsColor, { position: [0, -.08, 0], scale: [.118 * t, .16, .125 * t] });
  detail.add(capsule(.1, .46), look.pantsColor, { position: [0, bare ? -.33 : -.42, 0], scale: [t, bare ? .82 : 1, t] });
  if (look.top === 'tracksuit') detail.add(BOX(), 0xf0ece0, { position: [side * .08, -.42, 0], scale: [.012, .6, .05] });
  if (bare) {
    detail.add(capsule(.06, .12), appearance.color, { position: [0, -.68, 0] });
    detail.add(SPHERE(), appearance.color, { position: [0, -.86, -.05], scale: [.075, .055, .14] });
  } else {
    const color = look.shoes === 'sneakers' ? P.sneakers : P.boots;
    detail.add(SPHERE(), color, { position: [0, -.855, -.045], scale: [.09, .068, .148] });
    detail.add(BOX(), P.soles, { position: [0, -.905, -.05], scale: [.18, .025, .28] });
  }
  mesh(detail, detailMaterial(), pivot, 'zombieLeg');
  return pivot;
}

// Armour is split into pieces that break off as health drops (see
// DAMAGE_STAGES): a satisfying read of the damage dealt, never a wound.
function armorPiece(parent, builder, material, name, stage, pieces) {
  const piece = mesh(builder, material, parent, name);
  if (piece) pieces.push({ object: piece, stage });
  return piece;
}
function buildArmor(body, appearance, look, { w, d, front, backZ = -front }) {
  const steel = standard(`scavengedArmor-${appearance.id}`, appearance.clothColor, .5, { metalness: .7 });
  const back = new PartBuilder(), chest = new PartBuilder(), rust = new PartBuilder(), rustHex = 0x6f4937, pieces = [];
  back.add(ROUNDED(), appearance.clothColor, { position: [0, 1.18, backZ + .02], scale: [.235 * w, .25, .035] });
  chest.add(ROUNDED(), appearance.clothColor, { position: [0, 1.18, front - .025], scale: [.25 * w, .26, .045] });
  for (const y of [1.0, 1.17, 1.34]) rust.add(BOX(), rustHex, { position: [0, y, front - .07], scale: [.4 * w, .025, .02] });
  for (const side of [-1, 1]) rust.add(BOX(), rustHex, { position: [side * .16 * w, 1.18, front - .072], rotation: [0, 0, side * .07], scale: [.04, .46, .02] });
  mesh(back, steel, body, 'zombieArmor');
  const chestGroup = new THREE.Group(); chestGroup.name = 'zombieChestArmor'; body.add(chestGroup);
  mesh(chest, steel, chestGroup, 'zombieChestPlate'); mesh(rust, detailMaterial(), chestGroup, 'zombieArmorStraps');
  pieces.push({ object: chestGroup, stage: 3 });
  [-1, 1].forEach((side, index) => {
    const pad = new PartBuilder();
    pad.add(DOME(), appearance.clothColor, { position: [side * .29 * w, 1.4, 0], rotation: [0, 0, -side * .35], scale: [.12, .09, .15] });
    armorPiece(body, pad, steel, side < 0 ? 'zombieArmorPadLeft' : 'zombieArmorPadRight', index ? 2 : 1, pieces);
  });
  return { pieces, cracks: null };
}

function buildHeavyArmor(body, head, appearance, { w, d, front, boss, legs }) {
  const armor = standard(`heavyArmor-${appearance.id}`, appearance.clothColor, .65, { metalness: .5 });
  const plates = new PartBuilder(), trims = new PartBuilder(), cracks = new PartBuilder(), pieces = [];
  plates.add(ROUNDED(), appearance.clothColor, { position: [0, 1.2, front - .03], scale: [.27 * w, .235, .06] });
  // Cartoon cracks across the chest plate, shown from half health.
  for (const [x, y, angle, length] of [[-.08, 1.27, .9, .14], [-.02, 1.21, -.5, .12], [.05, 1.16, .8, .13], [.1, 1.25, -1.1, .09], [-.12, 1.13, -.4, .08]])
    cracks.add(BOX(), 0x1a1214, { position: [x * w, y, front - .093], rotation: [0, 0, angle], scale: [length, .014, .006] });
  const pads = [new PartBuilder(), new PartBuilder()];
  [-1, 1].forEach((side, index) => pads[index].add(DOME(), appearance.clothColor, { position: [side * .31 * w, 1.42, 0], rotation: [0, 0, -side * .4], scale: [.15, .11, .18] }));
  if (boss) {
    for (const side of [-1, 1]) {
      trims.add(BOX(), 0x743d34, { position: [side * .19, 1.21, front - .09], rotation: [0, 0, side * .08], scale: [.075, .43, .04] });
      pads[side < 0 ? 0 : 1].add(ROUNDED(), appearance.clothColor, { position: [side * .36, 1.44, -.04], rotation: [0, 0, side * .15], scale: [.15, .07, .21] });
      const leg = legs[side < 0 ? 0 : 1], guard = new PartBuilder();
      guard.add(ROUNDED(), appearance.clothColor, { position: [0, -.45, leg.userData.shinFront === undefined ? -.12 : leg.userData.shinFront - .005], scale: [.12, .21, .04] });
      mesh(guard, armor, leg, 'zombieLegGuard');
    }
    for (const y of [1.07, 1.22, 1.37]) trims.add(CYLINDER(), 0x66706a, { position: [0, y, front - .1], rotation: [0, 0, Math.PI / 2], scale: [.02, .52, .02] });
    const helmet = new PartBuilder(), cage = new PartBuilder();
    helmet.add(ROUNDED(), appearance.clothColor, { position: [0, .19, 0], scale: [.2, .045, .175] });
    for (const side of [-1, 1]) helmet.add(ROUNDED(), appearance.clothColor, { position: [side * .19, .015, -.02], scale: [.03, .17, .165] });
    cage.add(BOX(), 0x66706a, { position: [0, -.14, -.21], scale: [.36, .05, .045] });
    for (const x of [-.12, 0, .12]) cage.add(BOX(), 0x66706a, { position: [x, -.025, -.214], scale: [.022, .25, .025] });
    // A head style may dress the overlord's head itself: then no helmet or cage.
    if (!zombieStyle?.bossHelmet?.(head, appearance)) {
      mesh(helmet, armor, head, 'zombieHelmet');
      mesh(cage, detailMaterial(), head, 'zombieCage');
    }
  }
  const chestGroup = new THREE.Group(); chestGroup.name = 'zombieChestArmor'; body.add(chestGroup);
  mesh(plates, armor, chestGroup, 'zombieHeavyArmor');
  mesh(trims, detailMaterial(), chestGroup, 'zombieArmorTrim');
  const crackMesh = mesh(cracks, detailMaterial(), chestGroup, 'zombieArmorCracks'); crackMesh.visible = false;
  pieces.push({ object: chestGroup, stage: 3 });
  armorPiece(body, pads[0], armor, 'zombieArmorPadLeft', 1, pieces);
  armorPiece(body, pads[1], armor, 'zombieArmorPadRight', 3, pieces);
  return { pieces, cracks: crackMesh };
}

function buildCrawler(body, appearance, look, id) {
  const skinHex = appearance.color, clothHex = appearance.clothColor;
  const cloth = new PartBuilder(), skin = new PartBuilder(), detail = new PartBuilder();
  cloth.add(capsule(.2, .22), clothHex, { position: [0, .38, .04], rotation: [Math.PI / 2, 0, 0], scale: [1.1, 1, .62] });
  if (look.top === 'hoodie') cloth.add(SPHERE(), clothHex, { position: [0, .5, -.04], scale: [.16, .07, .1] });
  if (look.top === 'torn') skin.add(SPHERE(), skinHex, { position: [.06, .27, .1], scale: [.07, .02, .05] });
  skin.add(CYLINDER(), skinHex, { position: [0, .54, -.11], rotation: [.6, 0, 0], scale: [.065, .12, .065] });
  detail.add(SPHERE(), look.pantsColor, { position: [0, .36, .3], scale: [.19, .1, .1] });
  const styled = zombieStyle?.buildTorso?.(body, appearance, look, { kind: 'crawler', boss: false, id, crawler: true, build: BUILDS.regular, w: 1, d: 1, hunch: 0 }) ?? null;
  if (!styled) mesh(cloth, clothMaterial(appearance), body, 'zombieTorso');
  if (!styled) mesh(skin, skinFor(appearance), body, 'zombieSkin');
  if (!styled) mesh(detail, detailMaterial(), body, 'zombieClothes');
  const head = new THREE.Group(); head.name = 'zombieHead'; head.position.set(0, enemyProfile({ kind: 'crawler' }).head, -.11); body.add(head);
  // Scaled so the skull tops out at the crawler's .82 m server height.
  const headParts = buildHead(head, appearance, look, { eyes: eyesFor('crawler', false), scale: .74, crawler: true, id, boss: false, kind: 'crawler' });
  const arms = [-1, 1].map(side => {
    const pivot = new THREE.Group(); pivot.name = side < 0 ? 'zombieLeftArm' : 'zombieRightArm'; pivot.position.set(side * .24, .4, -.05); body.add(pivot);
    const arm = new PartBuilder();
    arm.add(capsule(.055, .22), skinHex, { position: [0, -.17, 0] });
    arm.add(SPHERE(), skinHex, { position: [0, -.33, -.03], scale: [.065, .045, .085] });
    if (!zombieStyle?.buildArm?.(pivot, appearance, look, { side, length: .4, thickness: 1, kind: 'crawler', boss: false, id, crawler: true })) mesh(arm, skinFor(appearance), pivot, 'zombieHand');
    pivot.rotation.x = .55; return pivot;
  });
  const legs = [-1, 1].map(side => {
    const pivot = new THREE.Group(); pivot.name = side < 0 ? 'zombieLeftLeg' : 'zombieRightLeg'; pivot.position.set(side * .18, .29, .13); body.add(pivot);
    const leg = new PartBuilder();
    leg.add(capsule(.075, .12), look.pantsColor, { position: [0, -.12, 0] });
    leg.add(SPHERE(), look.shoes === 'sneakers' ? P.sneakers : P.boots, { position: [0, -.24, -.03], scale: [.08, .06, .12] });
    if (!zombieStyle?.buildLeg?.(pivot, appearance, look, { side, thickness: 1, bare: look.shoes === 'oneBare' && side < 0, kind: 'crawler', boss: false, id, crawler: true })) mesh(leg, detailMaterial(), pivot, 'zombieLeg');
    pivot.rotation.x = -.65; return pivot;
  });
  const crawlerFront = styled && Number.isFinite(styled.front) ? styled.front : -.215;
  const healthMarker = markZombie(body, head, appearance, { kind: 'crawler', boss: false, id, crawler: true, build: BUILDS.regular, w: 1, d: 1, hunch: 0, front: crawlerFront, torsoY: .4, arms });
  return { head, leftArm: arms[0], rightArm: arms[1], leftLeg: legs[0], rightLeg: legs[1], healthMarker, hat: headParts.hat, baseArms: [.65, .65],
    damage: headParts.hat ? [{ object: headParts.hat, stage: 2, hat: true }] : [], cracks: null };
}

// The z of a chest strip at (x, y): on a styled body that measures its own
// chest (frontAt), from the chest under the strip (x ± .075: the strip's
// half width and lean; y ± .24): its face 4 mm proud of the most forward
// point there, its thickness taking the bulge, so it lies on a rounder
// chest instead of standing off its sides; else the torso's front.
function stripFront(frontAt, x, y, front) {
  const z = frontAt?.([x - .075, x + .075], [y - .24, y + .24]);
  return Number.isFinite(z) ? z + .005 : front;
}

// Fabric, scars and ash identify maximum health; none adds head protection.
// Accent pieces come first so the marker's first child is the accent.
// A style may draw the whole family's markers itself (art/frisson/MARKERS.md):
// style.markZombie(body, head, appearance, { kind, boss, id, crawler, build,
// w, d, hunch, front, arms }) returns the healthMarker group, or null for the
// pieces below. The arms are already built. A family is answered whole or not
// at all: Famille and style pieces are never mixed.
function markZombie(body, head, appearance, { kind, boss, id, crawler = false, build, w = 1, d = 1, hunch = 0, front: torsoFront, torsoY, arms, frontAt = null } = {}) {
  const styled = zombieStyle?.markZombie?.(body, head, appearance, { kind, boss, id, crawler, build, w, d, hunch, front: torsoFront, arms });
  if (styled) return styled;
  const marker = new THREE.Group(); marker.name = 'healthMarker'; body.add(marker);
  const headMarks = new THREE.Group(); headMarks.name = 'healthHeadMarker'; head.add(headMarks);
  if (crawler) headMarks.scale.setScalar(.82);
  const accentHex = appearance.accentColor, clothHex = appearance.clothColor;
  const accent = new PartBuilder(), cloth = new PartBuilder(), headAccent = new PartBuilder(), headCloth = new PartBuilder();
  const torso = crawler ? .4 : 1.18, front = crawler ? -.215 : torsoFront - .004;
  // Sizes are full extents, as for the old boxes; round shapes take radii.
  const add = (builder, color, x, y, z, sx, sy, sz, rz = 0, shape = BOX) => builder.add(shape(), color,
    { position: [x, y, z], rotation: [0, 0, rz], scale: shape === BOX ? [sx, sy, sz] : [sx / 2, sy / 2, sz / 2] });
  const headFront = crawler ? -.142 : -.2;
  switch (appearance.marker) {
    case 'wrap':
      add(headAccent, accentHex, 0, crawler ? .07 : .1, 0, crawler ? .26 : .33, .05, crawler ? .24 : .32, 0, ROUNDED);
      add(accent, accentHex, -.11 * w, torso, stripFront(frontAt, -.11 * w, torso, front), .09, crawler ? .18 : .48, .018, -.12);
      break;
    case 'scarf':
      add(accent, accentHex, 0, crawler ? .51 : 1.47, crawler ? -.075 : 0, crawler ? .38 : .52 * w, .1, crawler ? .3 : .4 * d, 0, ROUNDED);
      add(accent, accentHex, .13 * w, torso + (crawler ? .03 : .12), front - .01, .11, crawler ? .15 : .31, .025, -.18);
      add(headCloth, clothHex, .07, .15, .035, crawler ? .12 : .15, .045, .14, -.2);
      break;
    case 'straps':
      for (const side of [-1, 1]) add(accent, accentHex, side * .035, torso, front, .065, crawler ? .25 : .54, .025, side * .65);
      add(headAccent, accentHex, -.11, .015, headFront + .03, .04, crawler ? .12 : .17, .02, -.2);
      break;
    case 'cowl':
      for (const side of [-1, 1]) {
        add(accent, accentHex, side * .17 * w, torso + (crawler ? .08 : .23), 0, .14, crawler ? .09 : .11, crawler ? .3 : .31, side * .16);
        add(accent, accentHex, side * .14 * w, torso - (crawler ? .015 : .08), front, .08, crawler ? .14 : .28, .025, side * .16);
      }
      add(headCloth, clothHex, 0, .025, crawler ? .09 : .13, crawler ? .26 : .34, crawler ? .2 : .29, .075, 0, ROUNDED);
      break;
    case 'ash':
      for (const side of [-1, 1]) {
        add(headAccent, accentHex, side * (crawler ? .09 : .11), .02, headFront + .006, .03, crawler ? .11 : .16, .018);
        add(accent, accentHex, side * .18 * w, torso + (crawler ? .05 : .23), 0, .12, .055, crawler ? .31 : .29);
        add(accent, accentHex, side * .11 * w, torso, front, .04, crawler ? .16 : .4, .018, side * .1);
      }
      break;
    case 'plate':
      add(accent, accentHex, 0, 1.2, front - .09, .07, .4, .018);
      break;
    case 'rivets':
      for (const side of [-1, 1]) {
        add(accent, accentHex, side * .3, 1.49, -.06, .22, .055, .22);
        for (const y of [1.08, 1.23, 1.38]) accent.add(BALL(), accentHex, { position: [side * .2, y, front - .09], scale: [.027, .027, .027] });
      }
      add(headCloth, clothHex, 0, .08, .13, .27, .08, .05);
      break;
    case 'cage':
      for (const x of [-.17, 0, .17]) add(accent, accentHex, x, 1.2, front - .1, .04, .44, .025);
      for (const side of [-1, 1]) add(accent, accentHex, side * .3, 1.49, -.05, .23, .055, .25);
      add(headAccent, accentHex, 0, -.08, -.18, .3, .04, .025);
      break;
    case 'crown':
      for (const side of [-1, 1]) {
        add(accent, accentHex, side * .34, 1.48, -.065, .25, .035, .35, side * .15);
        add(accent, accentHex, side * .19, 1.21, front - .12, .035, .39, .018);
      }
      // A jagged crown: a band and five points.
      // A ring around the helmet's rim, points leaning out, all under the
      // overlord's server height: shots at the crown count.
      headAccent.add(CYLINDER(), accentHex, { position: [0, .175, -.01], scale: [.235, .04, .21] });
      for (let index = 0; index < 5; index++) {
        const angle = index / 5 * Math.PI * 2;
        headAccent.add(CONE(), accentHex, { position: [Math.sin(angle) * .235, .205, -.01 + Math.cos(angle) * .21], rotation: [Math.cos(angle) * .35, 0, -Math.sin(angle) * .35], scale: [.03, .05, .03] });
      }
      break;
  }
  const accentMaterial = standard(`enemyAccent-${appearance.id}`, accentHex, .96, { emissive: accentHex, emissiveIntensity: .12 });
  const clothMat = clothMaterial(appearance);
  mesh(accent, accentMaterial, marker, 'healthMarkerAccent');
  mesh(cloth, clothMat, marker, 'healthMarkerCloth');
  // A head style may cast the same head marks onto its own heads.
  if (!zombieStyle?.markHead?.(headMarks, appearance, { crawler })) {
    mesh(headAccent, accentMaterial, headMarks, 'healthHeadAccent');
    mesh(headCloth, clothMat, headMarks, 'healthHeadCloth');
  }
  return marker;
}

function addCarapace(zombie) {
  const shell = new THREE.Group(); shell.name = 'bossDamagedCarapace'; zombie.userData.body.add(shell);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0x677069, roughness: .62, metalness: .65 });
  const crackMaterial = new THREE.MeshBasicMaterial({ color: 0xd29c69 });
  const plates = [], cracks = [], front = zombie.userData.chestFront ?? zombie.userData.torso?.geometry?.boundingBox?.min.z ?? -.16;
  for (const side of [-1, 1]) for (const y of [1.1, 1.32]) {
    const plate = new THREE.Mesh(BOX(), plateMaterial); plate.position.set(side * .14, y, front - .135); plate.scale.set(.245, .19, .025);
    plate.userData.side = side; shell.add(plate); plates.push(plate);
  }
  for (let index = 0; index < 6; index++) {
    const crack = new THREE.Mesh(BOX(), crackMaterial);
    crack.position.set(-.19 + (index % 3) * .19, 1.11 + Math.floor(index / 3) * .21, front - .151); crack.scale.set(.012, .14, .004);
    crack.rotation.z = index % 2 ? -.42 : .48; crack.visible = false; shell.add(crack); cracks.push(crack);
  }
  zombie.userData.carapace = { shell, plates, cracks, material: plateMaterial, ratio: 1, colors: { base: 0x677069, hurt: 0x744b3b } };
}

// Releases the GPU buffers this zombie owns; shared materials stay cached.
export function disposeZombie(group) {
  // A hat knocked off by a head shot may still be flying in the scene.
  const hat = group?.userData?.hat;
  if (hat && group.getObjectById?.(hat.id) !== hat) { hat.removeFromParent(); hat.geometry?.dispose?.(); }
  for (const piece of group?.userData?.flying ?? []) releasePiece(piece.object);
  if (group?.userData) group.userData.flying = [];
  group?.traverse?.(object => { if (object.isMesh && object.userData.ownedGeometry) object.geometry.dispose(); });
  // A style's shared carapace material (styleMaterial) is the style's to free.
  if (group?.userData?.carapace && !group.userData.carapace.styleMaterial) group.userData.carapace.material?.dispose?.();
}

// Health thresholds for visible damage: 75 %, 50 % and 25 % left.
export const DAMAGE_STAGES = Object.freeze([.75, .5, .25]);
export function damageStage(ratio) {
  if (!Number.isFinite(ratio)) return 0;
  return DAMAGE_STAGES.filter(threshold => ratio <= threshold + 1e-9).length;
}
const flyPoint = new THREE.Vector3(), flyCenter = new THREE.Vector3(), TUMBLE = new THREE.Quaternion(), TUMBLE_ANGLES = new THREE.Euler();
// Shows or hides the pieces of a stage. With a time, pieces break off and fly
// in world space with a burst of sparks; without, they simply disappear.
function applyDamageStage(group, stage, time) {
  const d = group.userData;
  if (d.cracks) d.cracks.visible = stage >= 2;
  for (const piece of d.damage ?? []) {
    if (piece.stage > stage || piece.gone) continue;
    piece.gone = true;
    if (piece.hat) d.hat = null;
    if (time === null || !group.parent) { piece.object.visible = false; continue; }
    group.updateMatrixWorld(true);
    piece.object.getWorldPosition(flyPoint); group.getWorldPosition(flyCenter);
    const out = new THREE.Vector3(flyPoint.x - flyCenter.x, 0, flyPoint.z - flyCenter.z);
    if (out.lengthSq() < 1e-6) out.set(Math.sin(group.rotation.y), 0, Math.cos(group.rotation.y));
    out.normalize();
    group.parent.attach(piece.object);
    (d.flying ??= []).push({ object: piece.object, start: time, x: piece.object.position.x, y: piece.object.position.y, z: piece.object.position.z,
      vx: out.x * 1.8, vy: 2.6, vz: out.z * 1.8, spin: piece.hat ? 7 : 4, turn: piece.object.quaternion.clone() });
    impactBurst(flyPoint, { kind: 'solid', time });
  }
}
function updateFlying(group, time) {
  const flying = group.userData.flying;
  if (!flying?.length) return;
  for (let index = flying.length - 1; index >= 0; index--) {
    const piece = flying[index], age = time - piece.start;
    if (!(age >= 0)) continue;
    if (age > 1.3) { releasePiece(piece.object); flying.splice(index, 1); continue; }
    piece.object.position.set(piece.x + piece.vx * age, Math.max(piece.y * .1 + .05, piece.y + piece.vy * age - 4.9 * age * age), piece.z + piece.vz * age);
    piece.object.quaternion.copy(piece.turn).multiply(TUMBLE.setFromEuler(TUMBLE_ANGLES.set(piece.spin * age, 0, piece.spin * .7 * age)));
    piece.object.scale.setScalar(Math.max(.001, age < 1 ? 1 : 1 - (age - 1) / .3));
  }
}
function releasePiece(object) {
  object.removeFromParent();
  object.traverse(node => { if (node.isMesh && node.userData.ownedGeometry) node.geometry.dispose(); });
}
export function setZombieHealth(group, hp, maxHp = group?.userData.maxHp) {
  if (!group?.userData) return;
  const d = group.userData;
  if (Number.isFinite(hp)) {
    if (Number.isFinite(d.hp) && hp < d.hp - 1e-6) d.hitPending = true;
    d.hp = hp;
  }
  if (Number.isFinite(maxHp) && maxHp > 0) d.maxHp = maxHp;
  if (Number.isFinite(d.hp) && d.maxHp > 0) {
    const stage = damageStage(d.hp / d.maxHp);
    // The first sync (a late joiner, a respawned model) shows the state
    // silently; later drops break pieces off on screen.
    if (!Number.isFinite(d.damageStage)) { d.damageStage = stage; applyDamageStage(group, stage, null); }
    else if (stage > d.damageStage) d.pendingStage = Math.max(d.pendingStage ?? 0, stage);
  }
  const carapace = d.carapace;
  if (!carapace) return;
  const ratio = Number.isFinite(d.hp) && d.maxHp > 0 ? THREE.MathUtils.clamp(d.hp / d.maxHp, 0, 1) : 1;
  if (ratio === carapace.ratio) return;
  carapace.ratio = ratio;
  carapace.material.color.setHex(carapace.colors.base).lerp(new THREE.Color(carapace.colors.hurt), 1 - ratio);
  const count = Math.min(6, Math.floor((1 - ratio) * 6 + 1e-8));
  carapace.cracks.forEach((crack, index) => { crack.visible = index < count; });
  carapace.plates.forEach(plate => { plate.rotation.z = plate.userData.side * (1 - ratio) * .08; });
}

export function animateZombie(group, time, moving = true, delta = 1 / 60) {
  const d = group.userData; if (!d.leftArm) return;
  const crawler = d.kind === 'crawler', runner = d.kind === 'runner', brute = d.kind === 'brute';
  const step = Number.isFinite(delta) ? Math.max(1e-4, Math.min(.1, delta)) : 1 / 60;
  // Stride follows the rendered speed: no moon-walking on the spot while a
  // zombie claws at a barricade, and runners really sprint.
  const x = group.position.x, z = group.position.z;
  if (!Number.isFinite(d.lastX)) { d.lastX = x; d.lastZ = z; d.speed = moving ? 1.2 : 0; }
  const measured = Math.min(6, Math.hypot(x - d.lastX, z - d.lastZ) / step); d.lastX = x; d.lastZ = z;
  d.speed += (measured - d.speed) * (1 - Math.exp(-step * 5));
  const walk = moving ? THREE.MathUtils.clamp(d.speed / (runner ? 2.6 : 1.3), 0, 1) : 0;
  const rate = crawler ? 8 : brute ? 3.8 : runner ? 8.5 : 6;
  d.cycle = (Number.isFinite(d.cycle) ? d.cycle : d.phase) + step * rate * (d.look?.stride ?? 1) * (.3 + .7 * walk);
  const gait = Math.sin(d.cycle) * (.07 + (runner ? .5 : .31) * walk);
  const [baseLeft, baseRight] = d.baseArms ?? [.85, .85];
  d.leftLeg.rotation.x = (crawler ? -.65 : 0) + gait * (crawler ? .4 : 1);
  d.rightLeg.rotation.x = (crawler ? -.65 : 0) - gait * (crawler ? .4 : 1);
  d.leftArm.rotation.x = baseLeft - gait * (crawler ? 1 : runner ? 1.1 : .45);
  d.rightArm.rotation.x = baseRight + gait * (crawler ? 1 : runner ? 1.1 : .45);
  const tilt = (d.look?.headTilt ?? 0) * (crawler ? .3 : 1);
  d.head.rotation.z = tilt + Math.sin(time * 1.7 + d.phase) * (crawler ? .05 : .08);
  d.head.rotation.y = Math.sin(time * .7 + d.phase) * .09; d.head.rotation.x = 0;
  // A shambling bob while walking, a slow menacing sway at rest.
  const body = d.body;
  if (body && !d.death) {
    body.position.y = crawler ? 0 : Math.abs(Math.sin(d.cycle)) * .035 * walk;
    body.rotation.z = Math.sin(time * 1.1 + d.phase) * .035 * (1 - walk) + Math.sin(d.cycle) * .03 * walk;
    body.rotation.x = crawler ? 0 : -(runner ? .2 : .05) * walk;
  }
  // A blow on a survivor or a plank: both arms rise, then slam down.
  const attack = Number.isFinite(d.attackAt) ? (time - d.attackAt) / .42 : -1;
  if (attack >= 0 && attack < 1) {
    const swing = attack < .4 ? .85 + 1.45 * attack / .4 : attack < .7 ? 2.3 - 2.1 * (attack - .4) / .3 : .2 + .65 * (attack - .7) / .3;
    d.leftArm.rotation.x = crawler ? .7 + .6 * Math.sin(attack * Math.PI) : swing;
    d.rightArm.rotation.x = crawler ? .7 - .25 * Math.sin(attack * Math.PI) : swing - .15;
    d.head.rotation.x = (crawler ? .12 : .22) * Math.sin(attack * Math.PI);
  }
  // Keep the lean in world space so turning does not reverse the impact direction.
  const pushX = Number.isFinite(d.pushX) ? d.pushX : 0, pushZ = Number.isFinite(d.pushZ) ? d.pushZ : 0;
  const speed = Math.hypot(pushX, pushZ), lean = speed > 0 ? Math.min(.1, speed * .045) / speed : 0;
  const blend = 1 - Math.exp(-Math.max(0, Math.min(.1, delta)) * 25);
  d.hitLeanX = (d.hitLeanX ?? 0) + (pushX * lean - (d.hitLeanX ?? 0)) * blend;
  d.hitLeanZ = (d.hitLeanZ ?? 0) + (pushZ * lean - (d.hitLeanZ ?? 0)) * blend;
  const cosine = Math.cos(group.rotation.y), sine = Math.sin(group.rotation.y);
  group.rotation.x = sine * d.hitLeanX + cosine * d.hitLeanZ;
  group.rotation.z = -(cosine * d.hitLeanX - sine * d.hitLeanZ);
  // A cartoon squash when a hit lands: satisfying, never gory.
  // Sustained damage (fire, a minigun) keeps one squash going instead of
  // restarting it at every snapshot.
  if (d.hitPending) { if (!Number.isFinite(d.hitAt) || time - d.hitAt > .2 || time < d.hitAt) d.hitAt = time; d.hitPending = false; }
  if (body && !d.death) {
    const hit = Number.isFinite(d.hitAt) ? (time - d.hitAt) / .22 : 1;
    const squash = hit >= 0 && hit < 1 ? Math.sin(hit * Math.PI) * (1 - hit) * 1.6 : 0;
    const width = d.look?.widthJitter ?? 1;
    body.scale.set(width * (1 + .09 * squash), 1 - .11 * squash, 1 + .09 * squash);
  }
  animateZombieBurn(group, time);
  if (d.carapace) setZombieHealth(group, d.hp, d.maxHp);
  if (d.pendingStage > d.damageStage) { d.damageStage = d.pendingStage; applyDamageStage(group, d.damageStage, time); }
  updateFlying(group, time);
  // Badly hurt: slumped and smoking (colossi), never bleeding.
  if (d.damageStage >= 3 && body && !d.death) {
    body.rotation.x -= .09;
    d.leftArm.rotation.x -= .2; d.rightArm.rotation.x -= .15;
    if ((d.kind === 'brute' || d.kind === 'armored') && Number.isFinite(time) && !(time - (d.smokeAt ?? -1) < .35)) {
      d.smokeAt = time; group.updateMatrixWorld(true);
      flyPoint.set((Math.sin(time * 7) > 0 ? 1 : -1) * .25, 1.45, 0); group.localToWorld(flyPoint);
      sharedEffects().smoke({ start: time, life: 1.1, x: flyPoint.x, y: flyPoint.y, z: flyPoint.z, vx: Math.sin(time * 3) * .15, vy: .7, vz: Math.cos(time * 3) * .15, drag: .8,
        size: .12, sizeTo: .45, color: 0x5a5560, alpha: .4, fadeIn: .15, fadeOut: .45, rotation: time, spin: .8 });
    }
  }
}

// A burning enemy rolls with flames, embers and smoke drawn by the shared
// particle engine: no mesh, no light, no draw call per burning body.
export function setZombieBurn(group, burning = false) {
  if (!group?.userData) return;
  group.userData.burning = Boolean(burning);
  if (!burning) group.userData.burnLast = undefined;
}
export function animateZombieBurn(group, time) {
  if (!group?.userData?.burning) return;
  emitBurn(group, time, { crawler: group.userData.kind === 'crawler' });
}

// The authoritative zombie is already gone. Its model falls away from the
// shot, then vanishes in a puff of dusk-coloured smoke and family-coloured
// sparks; a hat struck by a head shot flies off.
const POOF_DURATION = 1.5;
export const ZOMBIE_DEATH_DURATION = POOF_DURATION;
let poofTemplate;
// One merged smoke cloud and one spark ring, shared by every death.
function poofParts() {
  if (poofTemplate) return poofTemplate;
  const smoke = new PartBuilder(), sparks = new PartBuilder(), spark = new THREE.OctahedronGeometry(1, 0);
  for (const [x, y, z, r] of [[0, 0, 0, .3], [.22, .08, .05, .22], [-.2, .05, -.08, .24], [.05, .2, -.12, .2], [-.08, -.06, .2, .2], [.14, -.04, -.2, .18]])
    smoke.add(BALL(), 0xffffff, { position: [x, y, z], scale: [r, r, r] });
  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2, tilt = (index % 3 - 1) * .5;
    sparks.add(spark, 0xffffff, { position: [Math.cos(angle) * .55, .1 + tilt * .4, Math.sin(angle) * .55], scale: [.05, .05, .05] });
  }
  return poofTemplate = { smoke: smoke.build(null).geometry, sparks: sparks.build(null).geometry };
}
// An optional death look: style.poof(appearance, kind, boss) returns
// { smoke, sparks } materials for the puff (sparks false hides the ring), or
// null for the storybook puff. The materials are the style's to free.
let deathStyle = null;
export function setDeathStyle(style = null) { deathStyle = style && typeof style === 'object' ? style : null; }
export function getDeathStyle() { return deathStyle; }
// `knockback` ({ distance, hop, fall }) shoves a heavy death back along the
// shot: the caller has already shortened the distance at walls.
export function startZombieDeath(group, { time = 0, directionX = 0, directionZ = 0, headshot = false, knockback = null } = {}) {
  const d = group.userData, length = Math.hypot(directionX, directionZ);
  const push = length > 1e-6 && Number.isFinite(knockback?.distance) ? Math.max(0, knockback.distance) : 0;
  d.death = { start: time, fromYaw: group.rotation.y, toYaw: length > 1e-6 ? Math.atan2(directionX, directionZ) : group.rotation.y, baseY: group.position.y,
    directionX: length > 1e-6 ? directionX / length : 0, directionZ: length > 1e-6 ? directionZ / length : 0, headshot: Boolean(headshot),
    baseX: group.position.x, baseZ: group.position.z, push, hop: push > 0 && Number.isFinite(knockback.hop) ? Math.max(0, knockback.hop) : 0,
    fall: push > 0 && knockback.fall > 0 ? knockback.fall : .55 };
  // The hat leaves the head while the zombie still stands.
  if (d.death.headshot && d.hat && group.parent) {
    group.updateMatrixWorld(true); group.parent.attach(d.hat);
    d.death.hat = { x: d.hat.position.x, y: d.hat.position.y, z: d.hat.position.z, turn: d.hat.quaternion.clone() };
  }
  if (!d.poof) {
    const template = poofParts(), appearance = enemyAppearance({ kind: d.kind, boss: d.boss, maxHp: d.maxHp });
    // Placed on the fallen torso; its rotation cancels the fall so the
    // sparks ring stays level above the floor.
    const poof = new THREE.Group(); poof.name = 'zombiePoof'; poof.visible = false; group.add(poof);
    if (d.kind === 'crawler') poof.position.set(0, .45, -.15); else poof.position.set(0, 1, -.4);
    let own = null; try { own = deathStyle?.poof?.(appearance, d.kind, d.boss === true) ?? null; } catch {}
    const smoke = new THREE.Mesh(template.smoke, own?.smoke || cached('zombiePoofSmoke', () => new THREE.MeshLambertMaterial({ color: 0x4a4458 })));
    const sparks = new THREE.Mesh(template.sparks, own?.sparks || cached(`zombieSpark-${appearance.id}`, () => new THREE.MeshBasicMaterial({ color: appearance.accentColor, toneMapped: false })));
    smoke.name = 'zombiePoofSmoke'; sparks.name = 'zombiePoofSparks'; poof.add(smoke, sparks);
    if (own?.sparks === false) sparks.visible = false;
    d.poof = { group: poof, smoke, sparks };
  }
}
export function animateZombieDeath(group, time) {
  const d = group.userData, death = d.death; if (!death || !d.leftArm) return false;
  updateFlying(group, time);
  const age = Math.max(0, time - death.start), fall = THREE.MathUtils.clamp(age / (death.fall ?? .55), 0, 1), ease = fall * fall;
  const turn = Math.atan2(Math.sin(death.toYaw - death.fromYaw), Math.cos(death.toYaw - death.fromYaw)) * THREE.MathUtils.clamp(age / .15, 0, 1);
  group.rotation.set(ease * 1.48, death.fromYaw + turn, 0, 'YXZ');
  group.position.y = death.baseY + .13 * ease;
  // A heavy death slides back fast and settles, with a short lift on a blast.
  if (death.push > 0) {
    const slide = THREE.MathUtils.clamp(age / .42, 0, 1), travel = death.push * (1 - (1 - slide) ** 2);
    group.position.x = death.baseX + death.directionX * travel; group.position.z = death.baseZ + death.directionZ * travel;
    if (death.hop > 0) group.position.y += death.hop * Math.sin(Math.PI * THREE.MathUtils.clamp(age / .38, 0, 1));
  }
  d.leftArm.rotation.x = d.rightArm.rotation.x = .85 + 1.9 * ease;
  d.leftLeg.rotation.x = -.25 * ease; d.rightLeg.rotation.x = .18 * ease;
  d.head.rotation.x = -.3 * ease;
  // The body shrinks into the puff, which swells then collapses.
  const poof = THREE.MathUtils.clamp((age - .75) / (POOF_DURATION - .75), 0, 1);
  if (d.body) d.body.scale.setScalar(Math.max(.001, 1 - poof * poof * 1.6));
  if (d.body && poof >= .62) d.body.visible = false;
  if (d.poof) {
    d.poof.group.rotation.x = -group.rotation.x;
    d.poof.group.visible = poof > 0 && poof < 1;
    const swell = Math.sin(Math.min(1, poof * 1.15) * Math.PI);
    d.poof.smoke.scale.setScalar(Math.max(.001, swell * (1.1 - .2 * poof)));
    d.poof.smoke.rotation.y = poof * 1.6;
    d.poof.sparks.scale.setScalar(Math.max(.001, poof < .7 ? .4 + 1.6 * poof / .7 : 2 * (1 - poof) / .3));
    d.poof.sparks.rotation.y = -poof * 3;
  }
  // A head shot pops the hat off, flying up and along the shot in world
  // space, then it vanishes with the body.
  if (death.headshot && d.hat) {
    const world = group.parent;
    if (!death.hat && world) {
      group.updateMatrixWorld(true); world.attach(d.hat);
      death.hat = { x: d.hat.position.x, y: d.hat.position.y, z: d.hat.position.z, turn: d.hat.quaternion.clone() };
    }
    if (death.hat) {
      const flight = Math.min(age, .9);
      d.hat.position.set(death.hat.x + death.directionX * flight * 1.6, Math.max(.05, death.hat.y + flight * 2.2 - flight * flight * 3.6), death.hat.z + death.directionZ * flight * 1.6);
      d.hat.quaternion.copy(death.hat.turn ?? d.hat.quaternion).multiply(TUMBLE.setFromEuler(TUMBLE_ANGLES.set(-flight * 7, 0, flight * 4)));
      d.hat.visible = age < POOF_DURATION - .1;
    }
  }
  if (age >= POOF_DURATION && death.hat) { d.hat.removeFromParent(); group.add(d.hat); d.hat.visible = false; }
  return age < POOF_DURATION;
}
