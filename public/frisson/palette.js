// Frisson (15+): the family colours as corpses. A PROPOSAL awaiting the
// owner's choice (art/frisson/DESIGN.md, "In the engine" and "Choosing").
//
// In Famille the skin and cloth of each health family (enemies.js) are the
// toughness cue, in storybook colours: a yellow, an orange and a red face
// look like toys on a horror head. Here each family keeps its hue (within a
// few degrees) and its place in the lightness order (relative luminance,
// all ten families, skin and cloth each), with about half the chroma: pale
// goes corpse-white, sallow a jaundiced olive, rust a dried-clay brown,
// scarlet a bruised dusky red. Lightness is spread a little to make up for
// the lost colour, so that in the dark at 6 m (the game's ACES, the Frisson
// night, a face lit by the flashlight and the moon or turned from it) the
// closest pair of each group stays about as far apart (CIEDE2000) as in
// Famille: 95 % or more in the test's model of the night
// (test/frisson-tune-look-palette.test.mjs), 92 % or more measured on the
// engine's own swatches (DESIGN.md).
//
// Frisson only: heads.js and bodies.js read it, and nothing in Famille ever
// loads this folder. To go back to the Famille colours in Frisson, set
// USE_PALETTE to false (or remove a family from the table).
export const USE_PALETTE = true;

export const PALETTE = Object.freeze({
  //                               Frisson                        Famille (enemies.js)
  pale: Object.freeze({ skin: 0xd4d0ca, cloth: 0x7b7773 }),     // 0xd3c8b4, 0x746e66
  sallow: Object.freeze({ skin: 0xb9b38e, cloth: 0x6a654a }),   // 0xc6b764, 0x756b39
  rust: Object.freeze({ skin: 0xb08a75, cloth: 0x674c3f }),     // 0xb8754d, 0x74452e
  scarlet: Object.freeze({ skin: 0x916862, cloth: 0x553638 }),  // 0xa95950, 0x622c32
  umber: Object.freeze({ skin: 0x867b72, cloth: 0x4b4843 }),    // 0x8e7967, 0x49443d
  charcoal: Object.freeze({ skin: 0x5a5e63, cloth: 0x26292e }), // 0x585e66, 0x242a31
  hulk: Object.freeze({ skin: 0x849c93, cloth: 0x363c3b }),     // 0x759b8e, 0x343d3b
  iron: Object.freeze({ skin: 0x697783, cloth: 0x343841 }),     // 0x637889, 0x323846
  dread: Object.freeze({ skin: 0x4f4d5f, cloth: 0x2a2633 }),    // 0x55506e, 0x292436
  overlord: Object.freeze({ skin: 0x6e3b4b, cloth: 0x19181e }), // 0x6e384a, 0x211f29
});

// The colour a Frisson zombie of this family wears; raiders and anything
// not in the table keep their own.
export function skinColor(appearance) { return USE_PALETTE && PALETTE[appearance?.id] ? PALETTE[appearance.id].skin : appearance.color; }
export function clothColor(appearance) { return USE_PALETTE && PALETTE[appearance?.id] ? PALETTE[appearance.id].cloth : appearance.clothColor; }
