// The storybook world.js as it was before the weapon-style hook
// (art/frisson/WEAPONS.md section 4.1, claude/frisson-weapons base 72ebe40):
// today's source with each hook line put back as it was. Tests load it as a
// second world.js and compare its weapons — first-person, held, rack and
// ground — with today's, so the hook is proven transparent while the rest of
// the file keeps evolving. Each pair must match exactly once: if you change a
// hook line on purpose, update its pair here.
const PAIRS = [
  [`    // Rebuilds every rack weapon with the current style (null = Famille).
    // Each rackWeapon-<type> subtree is dropped (its merged geometries
    // disposed, never the style's shared frissonShared ones), rebuilt through
    // the same helper as createArmoryRack and merged again like the initial
    // zone pass. Only the numeric suffix of the staticMerge-<n> names may
    // differ from the initial build; nothing looks those names up.
    restyleArmory() {
      for (const [type, display] of armoryDisplays) {
        const old = display.getObjectByName(\`rackWeapon-\${type}\`);
        const structure = old?.parent ?? display.children[0];
        if (old) {
          old.removeFromParent();
          old.traverse(node => { if (node.isMesh && !node.geometry.userData.frissonShared) node.geometry.dispose(); });
        }
        const gun = buildRackWeapon(type);
        structure.add(gun);
        root.updateMatrixWorld(true);
        mergeStaticMeshes(gun, { zones: [gun], keepColors: true });
      }
    },
`, ''],
  // The rack builder keeps today's shape (buildRackWeapon, then the hook
  // posts under its support points, weapon-racks lot of 24 October 2026);
  // only its dressing line is the hook.
  [`  gun.position.set(-center.x, 1.5 - center.y, .074 - bounds.min.z);
  weaponStyle?.dress(gun, { type, view: 'rack' });
  return gun;
}`,
    `  gun.position.set(-center.x, 1.5 - center.y, .074 - bounds.min.z);
  return gun;
}`],
  [`    gun.position.set(-center.x, .018 - bounds.min.y, -center.z);
    weaponStyle?.dress(gun, { type, view: 'ground' });`,
    `    gun.position.set(-center.x, .018 - bounds.min.y, -center.z);`],
  [`// A held weapon is the first-person build minus the hands; it is never
// dressed here (each view dresses its own copy: held, rack or ground).
export function createHeldWeapon(type) {
  const gun = buildWeapon(type);`,
    `function createHeldWeapon(type) {
  const gun = createWeapon(type);`],
  [`  if(d.gun){d.gun.remove(d.flash);d.holder.remove(d.gun);d.gun.traverse(node=>{if(node.geometry&&!node.geometry.userData.frissonShared)node.geometry.dispose();});d.gun.userData.heatMaterial?.dispose();}`,
    `  if(d.gun){d.gun.remove(d.flash);d.holder.remove(d.gun);d.gun.traverse(node=>node.geometry?.dispose());d.gun.userData.heatMaterial?.dispose();}`],
  [`  gun.position.fromArray(held.position);gun.scale.setScalar(held.scale);
  weaponStyle?.dress(gun,{type,view:'held'});`,
    `  gun.position.fromArray(held.position);gun.scale.setScalar(held.scale);`],
  [`    hot = barrels[0].material.clone(); hot.name = 'minigunHotBarrels';
    // Material.copy drops onBeforeCompile/customProgramCacheKey; copy them
    // when they are own properties of the source (a Frisson weapon material),
    // so a hot minigun keeps the already-compiled zombieRim program. Famille
    // materials have no such own properties: nothing changes for them.
    for (const key of ['onBeforeCompile', 'customProgramCacheKey'])
      if (Object.prototype.hasOwnProperty.call(barrels[0].material, key)) hot[key] = barrels[0].material[key];`,
    `    hot = barrels[0].material.clone(); hot.name = 'minigunHotBarrels';`],
  [`}
// An optional weapon style (the Frisson pack's weapons module) dresses every
// weapon built from now on; null is the Famille build, exactly.
// One style at a time. Switching styles drops the cached ground templates, so
// the next pickup is built in the new style; shared Frisson geometries
// (geometry.userData.frissonShared) belong to the style and are never
// disposed here.
let weaponStyle = null;
export function setWeaponStyle(style = null) {
  weaponStyle = style ?? null;
  for (const template of groundWeaponTemplates.values()) {
    template.traverse(node => {
      if (!node.isMesh) return;
      if (!node.geometry.userData.frissonShared) node.geometry.dispose();
      if (node.material?.isMeshBasicMaterial) node.material.dispose(); // the pickup halo's two materials
    });
  }
  groundWeaponTemplates.clear();
}
export function getWeaponStyle() { return weaponStyle; }

export function createWeapon(type = 'pistol') {
  const gun = buildWeapon(type);
  weaponStyle?.dress(gun, { type, view: 'firstPerson' });
  return gun;
}

export function buildWeapon(type='pistol') {`,
    `}
export function createWeapon(type='pistol') {`],
];

export function withoutWeaponStyleHook(source) {
  let text = source.replace(/\r\n/g, '\n');
  for (const [hook, original] of PAIRS) {
    const found = text.split(hook).length - 1;
    if (found !== 1) throw new Error(`world.js weapon hook found ${found} times, expected 1: ${hook.split('\n')[0]}`);
    text = text.split(hook).join(original);
  }
  return text;
}
