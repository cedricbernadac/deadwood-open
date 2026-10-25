// Colour as the game shows it, for the Frisson palette tests: a family
// colour on a Frisson faceted material (vertex grey .8), lit at 6 m on the
// Frisson night, through three r180's ACESFilmic tone mapping, the sRGB
// output and the canvas's CSS saturate(.9); then CIELAB (D65) and
// CIEDE2000, plus OKLCH and relative luminance for hue and order.

// The light falling on a card 6 m from the player at night (wave 1, the
// flashlight on), facing the moon or turned from it: fitted on 2026-10-13
// to the Famille swatches of the body shooter's palette shot (Edge, RTX
// 3080, art/frisson/tools/bodies-shot, --shots palette): rms 5.1 and 3.7 /255
// over 20 swatches each. RGB irradiance in three's units (times albedo/pi).
export const NIGHT_AT_6M = Object.freeze({ moon: Object.freeze([1.798, 1.817, 1.652]), shadow: Object.freeze([1.426, 1.215, .832]) });
export const GREY = .8;
export const SATURATE = .9;

export const toLinear = c => (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
export const toSrgb = c => (c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055);
export const linear = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(value => toLinear(value / 255));
export const luminance = hex => { const [r, g, b] = linear(hex); return .2126 * r + .7152 * g + .0722 * b; };

// three r180 ACESFilmicToneMapping (tonemapping_pars_fragment).
const mul = (m, v) => [0, 1, 2].map(r => m[0][r] * v[0] + m[1][r] * v[1] + m[2][r] * v[2]);
const IN = [[.59719, .07600, .02840], [.35458, .90834, .13383], [.04823, .01566, .83777]];
const OUT = [[1.60475, -.10208, -.00327], [-.53108, 1.10813, -.07276], [-.07367, -.00605, 1.07602]];
const rrt = v => v.map(x => (x * (x + .0245786) - .000090537) / (x * (.983729 * x + .4329510) + .238081));
export const aces = (color, exposure) => mul(OUT, rrt(mul(IN, color.map(x => x * exposure / .6)))).map(x => Math.min(1, Math.max(0, x)));
// CSS saturate() on the encoded values (Filter Effects matrix).
function cssSaturate(color, s) {
  const e = color.map(toSrgb);
  const m = [[.213 + .787 * s, .715 - .715 * s, .072 - .072 * s], [.213 - .213 * s, .715 + .285 * s, .072 - .072 * s], [.213 - .213 * s, .715 - .715 * s, .072 + .928 * s]];
  return m.map(row => Math.min(1, Math.max(0, row[0] * e[0] + row[1] * e[1] + row[2] * e[2]))).map(toLinear);
}
export function lab([r, g, b]) {
  const X = (.4124564 * r + .3575761 * g + .1804375 * b) / .95047, Y = .2126729 * r + .7151522 * g + .0721750 * b, Z = (.0193339 * r + .1191920 * g + .9503041 * b) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
// The Lab colour shown for a family colour on one side, at `exposure`.
export function shown(hex, side, exposure) {
  const light = NIGHT_AT_6M[side];
  return lab(cssSaturate(aces(linear(hex).map((value, index) => value * GREY / Math.PI * light[index]), exposure), SATURATE));
}

export function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = .5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => { const value = Math.atan2(b, a) / rad; return value < 0 ? value + 360 : value; };
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  let dhp = 0;
  if (C1p * C2p) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dLp = L2 - L1, dCp = C2p - C1p, dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * rad / 2);
  const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p) { if (Math.abs(h1p - h2p) > 180) hpm += h1p + h2p < 360 ? 360 : -360; hpm /= 2; }
  const T = 1 - .17 * Math.cos((hpm - 30) * rad) + .24 * Math.cos(2 * hpm * rad) + .32 * Math.cos((3 * hpm + 6) * rad) - .2 * Math.cos((4 * hpm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + .015 * (Lpm - 50) ** 2 / Math.sqrt(20 + (Lpm - 50) ** 2), Sc = 1 + .045 * Cpm, Sh = 1 + .015 * Cpm * T, Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// OKLCH: [lightness, chroma, hue in degrees].
export function oklch(hex) {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const L = .2104542553 * l + .7936177850 * m - .0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}

// The closest pair of a set of colours on one side: { distance, pair }.
export function closestPair(colors, side, exposure) {
  const ids = Object.keys(colors), labs = ids.map(id => shown(colors[id], side, exposure));
  let distance = Infinity, pair = null;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const d = ciede2000(labs[i], labs[j]);
    if (d < distance) { distance = d; pair = `${ids[i]}/${ids[j]}`; }
  }
  return { distance, pair };
}
