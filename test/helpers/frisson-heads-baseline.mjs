// The storybook zombies.js as it was before the head-style hook: today's
// source with each hook line put back as it was. Tests load it as a second
// zombies.js and compare its models with today's, so the hook is proven
// transparent while the rest of the file keeps evolving. Each pair must
// match exactly (the count is checked): if you change a hook line on
// purpose, update its pair here. The two youngest changes come off first,
// each on its own lines so their order does not matter: the death-look hook
// (art/frisson/UI-SOUND.md section 4.4) and the weapons lot's rim parameters
// (below); then the armour dress hook, the chest-strip and whole-family
// marker hooks (all younger than the final pack's first zombies.js), then the
// head-mark and boss-helmet hooks, then the body hooks (art/frisson/BODIES.md),
// then the head hooks.
const DEATH_PAIRS = [
  [`// An optional death look: style.poof(appearance, kind, boss) returns
// { smoke, sparks } materials for the puff (sparks false hides the ring), or
// null for the storybook puff. The materials are the style's to free.
let deathStyle = null;
export function setDeathStyle(style = null) { deathStyle = style && typeof style === 'object' ? style : null; }
export function getDeathStyle() { return deathStyle; }
`, ''],
  ['    let own = null; try { own = deathStyle?.poof?.(appearance, d.kind, d.boss === true) ?? null; } catch {}\n', ''],
  ['own?.smoke || ', ''],
  ['own?.sparks || ', ''],
  ['    if (own?.sparks === false) sparks.visible = false;\n', ''],
];
// The weapons lot's per-material rim parameters (art/frisson/WEAPONS.md 2.1:
// a strength scale and a colour, both uniforms, Famille passes neither), as
// young as the death look, come off with it before anything else.
const RIM_PAIRS = [
  ['export function withRim(material, rimScale = 1, rimColor = RIM.color) {', 'export function withRim(material) {'],
  ['shader.uniforms.rimColor = { value: rimColor }; shader.uniforms.rimStrength = { value: RIM.strength * rimScale };', 'shader.uniforms.rimColor = { value: RIM.color }; shader.uniforms.rimStrength = { value: RIM.strength };'],
];
const STRIP_PAIRS = [
  [`  // A style may re-dress the armour and the carapace (art/frisson/BODIES.md).
  // typeof: the test baselines rebuild this file with the style block off.
  if (typeof zombieStyle !== 'undefined') zombieStyle?.dressArmor?.(zombie, appearance);
`, ''],
  ['zombie.userData.carapace = { shell, plates, cracks, material: plateMaterial, ratio: 1, colors: { base: 0x677069, hurt: 0x744b3b } };', 'zombie.userData.carapace = { shell, plates, cracks, material: plateMaterial, ratio: 1 };'],
  [`  // A style's shared carapace material (styleMaterial) is the style's to free.
  if (group?.userData?.carapace && !group.userData.carapace.styleMaterial) group.userData.carapace.material?.dispose?.();`, `  group?.userData?.carapace?.material?.dispose?.();`],
  ['carapace.material.color.setHex(carapace.colors.base).lerp(new THREE.Color(carapace.colors.hurt), 1 - ratio);', 'carapace.material.color.setHex(0x677069).lerp(new THREE.Color(0x744b3b), 1 - ratio);'],
  [`// (the chest's and the back's z, body space), maybe with frontAt([x0, x1],
// [y0, y1]), the chest's z over that patch, for a strip off its middle;
// style.buildArm(pivot, appearance, look, { side, length, thickness, kind,
// boss, id, crawler }) and
`, `// (the chest's and the back's z, body space); style.buildArm(pivot,
// appearance, look, { side, length, thickness, kind, boss, id, crawler }) and
`],
  ['markZombie(body, head, appearance, { kind, boss, id, crawler: false, build, w, d, hunch: build.hunch, front, torsoY, arms, frontAt: styled?.frontAt });', 'markZombie(body, head, appearance, { kind, boss, id, crawler: false, build, w, d, hunch: build.hunch, front, torsoY, arms });'],
  ['function markZombie(body, head, appearance, { kind, boss, id, crawler = false, build, w = 1, d = 1, hunch = 0, front: torsoFront, torsoY, arms, frontAt = null } = {}) {', 'function markZombie(body, head, appearance, { kind, boss, id, crawler = false, build, w = 1, d = 1, hunch = 0, front: torsoFront, torsoY, arms } = {}) {'],
  ['add(accent, accentHex, -.11 * w, torso, stripFront(frontAt, -.11 * w, torso, front), .09,', 'add(accent, accentHex, -.11 * w, torso, front, .09,'],
  [`// The z of a chest strip at (x, y): on a styled body that measures its own
// chest (frontAt), from the chest under the strip (x ± .075: the strip's
// half width and lean; y ± .24): its face 4 mm proud of the most forward
// point there, its thickness taking the bulge, so it lies on a rounder
// chest instead of standing off its sides; else the torso's front.
function stripFront(frontAt, x, y, front) {
  const z = frontAt?.([x - .075, x + .075], [y - .24, y + .24]);
  return Number.isFinite(z) ? z + .005 : front;
}

`, ''],
];
const MARK_PAIRS = [
  [`// With its own heads, a style may also cast the family's head marks onto
// them, style.markHead(headMarks, appearance, { crawler }), and dress the
// overlord's head, style.bossHelmet(head, appearance): true means done, and
// the storybook pieces are left off.

`, ''],
  [`  // A head style may cast the same head marks onto its own heads.
  if (!zombieStyle?.markHead?.(headMarks, appearance, { crawler })) {
    mesh(headAccent, accentMaterial, headMarks, 'healthHeadAccent');
    mesh(headCloth, clothMat, headMarks, 'healthHeadCloth');
  }
`, `  mesh(headAccent, accentMaterial, headMarks, 'healthHeadAccent');
  mesh(headCloth, clothMat, headMarks, 'healthHeadCloth');
`],
  [`    // A head style may dress the overlord's head itself: then no helmet or cage.
    if (!zombieStyle?.bossHelmet?.(head, appearance)) {
      mesh(helmet, armor, head, 'zombieHelmet');
      mesh(cage, detailMaterial(), head, 'zombieCage');
    }
`, `    mesh(helmet, armor, head, 'zombieHelmet');
    mesh(cage, detailMaterial(), head, 'zombieCage');
`],
];
const BODY_PAIRS = [
  [`// The same style may answer for the body (art/frisson/BODIES.md), either for
// every part of a zombie or for none: style.buildTorso(body, appearance,
// look, { kind, boss, id, crawler, build, w, d, hunch }) adds zombieTorso
// first, then zombieSkin and zombieClothes, and returns { torso, front, back }
// (the chest's and the back's z, body space); style.buildArm(pivot,
// appearance, look, { side, length, thickness, kind, boss, id, crawler }) and
// style.buildLeg(pivot, …, { side, thickness, bare, … }) fill a pivot placed
// here and return {} and { shinFront }. null keeps the procedural part.
// Pivots, armour, markers and animation stay here; styled meshes set their
// own shadows.

`, ''],
  [`  const lean = -build.hunch, torsoY = 1.2;
  let front = -(.147 * d + .012);
`, `  const lean = -build.hunch, torsoY = 1.2, front = -(.147 * d + .012);
`],
  [`  const styled = zombieStyle?.buildTorso?.(body, appearance, look, { kind, boss, id, crawler: false, build, w, d, hunch: build.hunch }) ?? null;
  if (styled && Number.isFinite(styled.front)) front = styled.front;
  const backZ = styled && Number.isFinite(styled.back) ? styled.back : undefined;
  const torsoMesh = styled ? styled.torso : mesh(cloth, clothMaterial(appearance), body, 'zombieTorso');
  if (!styled) mesh(skin, skinFor(appearance), body, 'zombieSkin');
  if (!styled) mesh(detail, detailMaterial(), body, 'zombieClothes');
`, `  const torsoMesh = mesh(cloth, clothMaterial(appearance), body, 'zombieTorso');
  mesh(skin, skinFor(appearance), body, 'zombieSkin');
  mesh(detail, detailMaterial(), body, 'zombieClothes');
`],
  ['length: armLength, thickness: build.limb, kind, boss, id }));', 'length: armLength, thickness: build.limb }));'],
  ["buildArmor(body, appearance, look, { w, d, front, backZ })", "buildArmor(body, appearance, look, { w, d, front })"],
  ["function buildArmor(body, appearance, look, { w, d, front, backZ = -front }) {", "function buildArmor(body, appearance, look, { w, d, front }) {"],
  ["position: [0, 1.18, backZ + .02]", "position: [0, 1.18, -front + .02]"],
  ['x: side * .125 * w, thickness: build.limb, kind, boss, id }));', 'x: side * .125 * w, thickness: build.limb }));'],
  ['cracks: armor.cracks, ...(styled ? { chestFront: front } : {}) };', 'cracks: armor.cracks };'],
  [`function buildArm(body, appearance, look, { side, x, y, z, length, thickness = 1, ...who }) {
  const pivot = new THREE.Group(); pivot.name = side < 0 ? 'zombieLeftArm' : 'zombieRightArm'; pivot.position.set(x, y, z); body.add(pivot);
  if (zombieStyle?.buildArm?.(pivot, appearance, look, { side, length, thickness, ...who, crawler: false })) return pivot;
`, `function buildArm(body, appearance, look, { side, x, y, z, length, thickness = 1 }) {
  const pivot = new THREE.Group(); pivot.name = side < 0 ? 'zombieLeftArm' : 'zombieRightArm'; pivot.position.set(x, y, z); body.add(pivot);
`],
  [`function buildLeg(body, appearance, look, { side, x, thickness = 1, ...who }) {`, `function buildLeg(body, appearance, look, { side, x, thickness = 1 }) {`],
  [`  const styled = zombieStyle?.buildLeg?.(pivot, appearance, look, { side, thickness, bare, ...who, crawler: false });
  if (styled) { if (Number.isFinite(styled.shinFront)) pivot.userData.shinFront = styled.shinFront; return pivot; }
`, ''],
  ['position: [0, -.45, leg.userData.shinFront === undefined ? -.12 : leg.userData.shinFront - .005]', 'position: [0, -.45, -.12]'],
  [`  const styled = zombieStyle?.buildTorso?.(body, appearance, look, { kind: 'crawler', boss: false, id, crawler: true, build: BUILDS.regular, w: 1, d: 1, hunch: 0 }) ?? null;
  if (!styled) mesh(cloth, clothMaterial(appearance), body, 'zombieTorso');
  if (!styled) mesh(skin, skinFor(appearance), body, 'zombieSkin');
  if (!styled) mesh(detail, detailMaterial(), body, 'zombieClothes');
`, `  mesh(cloth, clothMaterial(appearance), body, 'zombieTorso');
  mesh(skin, skinFor(appearance), body, 'zombieSkin');
  mesh(detail, detailMaterial(), body, 'zombieClothes');
`],
  [`if (!zombieStyle?.buildArm?.(pivot, appearance, look, { side, length: .4, thickness: 1, kind: 'crawler', boss: false, id, crawler: true })) mesh(arm,`, 'mesh(arm,'],
  [`if (!zombieStyle?.buildLeg?.(pivot, appearance, look, { side, thickness: 1, bare: look.shoes === 'oneBare' && side < 0, kind: 'crawler', boss: false, id, crawler: true })) mesh(leg,`, 'mesh(leg,'],
  ['front = zombie.userData.chestFront ?? zombie.userData.torso?.geometry?.boundingBox?.min.z ?? -.16;', 'front = zombie.userData.torso?.geometry?.boundingBox?.min.z ?? -.16;'],
];
// The whole-family marker hook (art/frisson/MARKERS.md): with it stripped,
// markZombie is exactly the Famille function the bodies work left.
const MARKER_PAIRS = [
  [`// Fabric, scars and ash identify maximum health; none adds head protection.
// Accent pieces come first so the marker's first child is the accent.
// A style may draw the whole family's markers itself (art/frisson/MARKERS.md):
// style.markZombie(body, head, appearance, { kind, boss, id, crawler, build,
// w, d, hunch, front, arms }) returns the healthMarker group, or null for the
// pieces below. The arms are already built. A family is answered whole or not
// at all: Famille and style pieces are never mixed.
function markZombie(body, head, appearance, { kind, boss, id, crawler = false, build, w = 1, d = 1, hunch = 0, front: torsoFront, torsoY, arms } = {}) {
  const styled = zombieStyle?.markZombie?.(body, head, appearance, { kind, boss, id, crawler, build, w, d, hunch, front: torsoFront, arms });
  if (styled) return styled;
`, `// Fabric, scars and ash identify maximum health; none adds head protection.
// Accent pieces come first so the marker's first child is the accent.
function markZombie(body, head, appearance, { crawler = false, front: torsoFront, w = 1, d = 1, torsoY }) {
`],
  ['markZombie(body, head, appearance, { kind, boss, id, crawler: false, build, w, d, hunch: build.hunch, front, torsoY, arms })', 'markZombie(body, head, appearance, { front, w, d, torsoY })'],
  [`  const crawlerFront = styled && Number.isFinite(styled.front) ? styled.front : -.215;
`, ''],
  ['markZombie(body, head, appearance, { kind: \'crawler\', boss: false, id, crawler: true, build: BUILDS.regular, w: 1, d: 1, hunch: 0, front: crawlerFront, torsoY: .4, arms })', 'markZombie(body, head, appearance, { crawler: true, front: -.215, w: 1, torsoY: .4 })'],
];
const PAIRS = [
  ['export function withRim(material) {', 'function withRim(material) {'],
  [`// An optional head style installed at runtime by another look; null is the
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

`, ''],
  ['buildCrawler(body, appearance, look, id) : buildStanding(body, appearance, look, kind, boss, id);', 'buildCrawler(body, appearance, look) : buildStanding(body, appearance, look, kind, boss);'],
  ['function buildStanding(body, appearance, look, kind, boss, id) {', 'function buildStanding(body, appearance, look, kind, boss) {'],
  ['skinFor(appearance)', 'skinMaterial(appearance)', 5],
  ['{ eyes: eyesFor(kind, boss), id, boss, kind }', '{ eyes: boss ? EYES.boss() : EYES.walker() }'],
  [`// options: { eyes, scale, crawler, id, boss, kind }.
function buildHead(head, appearance, look, options) {
  const styled = zombieStyle?.buildHead?.(head, appearance, look, options);
  if (styled) return styled;
  const { eyes, scale = 1, crawler = false } = options;
  const skull = SKULLS[look.skull] ?? SKULLS.round, skinHex = appearance.color;
  const skin = new PartBuilder(), detail = new PartBuilder(), glow = new PartBuilder();
`, `function buildHead(head, appearance, look, { eyes, scale = 1, crawler = false }) {
  const skull = SKULLS[look.skull] ?? SKULLS.round, skinHex = appearance.color;
  const skin = new PartBuilder(), detail = new PartBuilder(), glow = new PartBuilder(), hatParts = new PartBuilder();
`],
  [`  addHair(detail, look, skull, s, crawler);
  // Built first, the family skin stays the head's first child.
  mesh(skin, skinMaterial(appearance), head, 'zombieHeadSkin');
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
`, `  addHair(detail, look, skull, s, crawler);
  addHat(hatParts, look, skull, s);
  // Built first, the family skin stays the head's first child.
  mesh(skin, skinMaterial(appearance), head, 'zombieHeadSkin');
  mesh(detail, detailMaterial(), head, 'zombieFace');
  mesh(glow, eyes, head, 'zombieEyes');
  const hat = mesh(hatParts, detailMaterial(), head, 'zombieHat');
  return { hat };
}
`],
  ['function buildCrawler(body, appearance, look, id) {', 'function buildCrawler(body, appearance, look) {'],
  ["{ eyes: eyesFor('crawler', false), scale: .74, crawler: true, id, boss: false, kind: 'crawler' }", '{ eyes: EYES.crawler(), scale: .74, crawler: true }'],
];

// Today's source with the death-look hook taken off: zombies.js as it was
// before the feedback look (claude/frisson-ui 562d8a1), the weapons lot's rim
// parameters aside.
export function withoutDeathStyleHook(source) { return replacePairs(source, DEATH_PAIRS); }
// Today's source less the weapons lot's rim parameters: Famille's
// withRim(material) exactly as every older baseline has it, the death look
// aside.
export function withoutRimParams(source) { return replacePairs(source, RIM_PAIRS); }
// Then the armour dress hook (a style's dressArmor and the carapace's style
// colours), the chest-strip hook (a body style's frontAt) and the
// whole-family marker hook (art/frisson/MARKERS.md) — all came after the
// final pack's first zombies.js — once both of the youngest changes are off:
// the file the final pack first left it as (claude/frisson-final ae63a07).
export function withoutStripHook(source) { return replacePairs(replacePairs(withoutRimParams(withoutDeathStyleHook(source)), STRIP_PAIRS), MARKER_PAIRS); }
// Then the head-mark and boss-helmet hooks: zombies.js as the bodies left it
// (claude/frisson e394d2f).
export function withoutMarkStyleHook(source) { return replacePairs(withoutStripHook(source), MARK_PAIRS); }
// Today's source with the body hooks taken off too: zombies.js as the heads
// left it (claude/frisson-heads).
export function withoutBodyStyleHook(source) { return replacePairs(withoutMarkStyleHook(source), BODY_PAIRS); }
export function withoutHeadStyleHook(source) { return replacePairs(withoutBodyStyleHook(source), PAIRS); }

function replacePairs(source, pairs) {
  let text = source.replace(/\r\n/g, '\n');
  for (const [hook, original, count = 1] of pairs) {
    const found = text.split(hook).length - 1;
    if (found !== count) throw new Error(`zombies.js hook line found ${found} times, expected ${count}: ${hook.split('\n')[0]}`);
    text = text.split(hook).join(original);
  }
  return text;
}
