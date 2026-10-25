// Survivors GLBs for tests (art/frisson/SURVIVORS.md): the placeholder
// built in memory (deterministic, plain Node: no committed binary fixture
// needed, unlike the heads placeholder which requires Blender), the
// placeholder with its optional Raider, and the roots of the generator, so
// tests can drop, rename or bend parts. Since proposal A was installed
// provisionally, public/frisson/survivors.glb is a real proposal; the final
// file is pinned by test/frisson-final-survivors.test.mjs.
import { writeFrissonGlb } from '../../tools/frisson-glb-write.mjs';
import { placeholderRoots, placeholderGlb, PLACEHOLDER_CHARACTERS } from '../../art/frisson/placeholder/frisson_survivors_placeholder.mjs';

export { placeholderRoots, placeholderGlb, PLACEHOLDER_CHARACTERS };
export const PLACEHOLDER_SURVIVORS = placeholderGlb();
export const RAIDERS_SURVIVORS = placeholderGlb(placeholderRoots({ raiders: true }));
// A GLB from root lists; options as writeFrissonGlb (mutate, text).
export const survivorsGlb = (roots, options = {}) => writeFrissonGlb(roots, { generator: 'frisson-survivors test', materials: ['cloth', 'detail', 'glow'], ...options });
// The placeholder's roots (with the raider when asked) after `edit(roots)`, a deep copy.
export function editedRoots(edit, { raiders = false } = {}) {
  const roots = structuredClone(placeholderRoots({ raiders }));
  return edit(roots) ?? roots;
}
export const rootNamed = (roots, name) => roots.find(root => root.name === name);
// The points of every channel of a root moved by move([x, y, z]).
export function moveRoot(root, move) {
  for (const child of root.children) child.positions = child.positions.map(move);
  return root;
}
