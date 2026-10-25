// The storybook world.js as it was before the pickup-style hook
// (art/frisson/PICKUPS.md section 3.1, claude/frisson-pickups base 4b66be7):
// today's source with each hook line put back as it was. Tests load it as a
// second world.js and compare its pickups — coins, ammo, health, armor,
// grenade, revive, bonus and ground weapons — with today's, so the hook is
// proven transparent while the rest of the file keeps evolving. Each pair
// must match exactly once: if you change a hook line on purpose, update its
// pair here.
const PAIRS = [
  [`  if (pickupStyle && STYLED_PICKUP_KINDS.includes(kind)) pickupStyle.dress(model, { kind, special });
  // Shared geometry/materials survive collection. The halo is unlit and adds no light or collider.`,
    `  // Shared geometry/materials survive collection. The halo is unlit and adds no light or collider.`],
  [`// An optional pickup style (the Frisson pack's pickups part) dresses the
// models of the styled kinds built from now on; null is the Famille build,
// exactly. One style at a time. Switching styles drops the cached templates
// of the styled kinds only (bonus and the ground weapons keep theirs), so the
// next pickup is built in the new style; shared Frisson geometries
// (geometry.userData.frissonShared) belong to the style and are never disposed
// here, and a MeshStandardMaterial (the world's shared mats, or the style's)
// is never disposed either — only the halo's two MeshBasicMaterials are
// per-template.
export const STYLED_PICKUP_KINDS = Object.freeze(['points', 'ammo', 'health', 'armor', 'grenade', 'revive']);
let pickupStyle = null;
export function setPickupStyle(style = null) {
  pickupStyle = style ?? null;
  for (const [key, template] of pickupTemplates) {
    if (!STYLED_PICKUP_KINDS.some(kind => key.startsWith(\`\${kind}-\`))) continue;
    template.traverse(node => {
      if (!node.isMesh) return;
      if (!node.geometry.userData.frissonShared) node.geometry.dispose();
      if (node.material?.isMeshBasicMaterial) node.material.dispose(); // the pickup halo's two materials
    });
    pickupTemplates.delete(key);
  }
}
export function getPickupStyle() { return pickupStyle; }

`, ''],
];

export function withoutPickupStyleHook(source) {
  let text = source.replace(/\r\n/g, '\n');
  for (const [hook, original] of PAIRS) {
    const found = text.split(hook).length - 1;
    if (found !== 1) throw new Error(`world.js pickup hook found ${found} times, expected 1: ${hook.split('\n')[0]}`);
    text = text.split(hook).join(original);
  }
  return text;
}
