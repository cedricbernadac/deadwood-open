// Frisson part: feedback (art/frisson/UI-SOUND.md, lot 1). The reward cues
// stop being Famille's gold and stars: hits throw a dull ember glow, a few
// falling embers and ash (the pixel blood of blood.js carries the red), a
// head-shot kill a jet of bone dust, a death puff turns to soot without its
// diamonds, and the HUD speaks in bone, rust and dried blood (feedback.css)
// with grimmer words. Raiders, living people, only raise grey dust.
// Everything is built once at install and frozen: nothing per hit, death or
// line. The sounds of the same lot belong to sounds.js.
import { setImpactStyle, getImpactStyle } from '../shot-fx.js';
import { setDeathStyle, getDeathStyle } from '../zombies.js';
import { getLanguage } from '../i18n.js';

const frozen = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const key of Object.keys(value)) frozen(value[key]); Object.freeze(value); }
  return value;
};

// The words of lot 1 (UI-SOUND.md section 2.6), one line per key: no '!',
// no star. A key missing here keeps its Famille text. Provisional until the
// owner has read them (section 7). Two changes to the brief's table, after
// review: the reaper (30) comes before the four horsemen (40), since Death
// rides among them and the ladder must climb; and the ferryman is « des
// âmes », since « le passeur » alone reads as a smuggler.
export const WORDS = frozen({
  fr: {
    'feedback.chain2': 'DEUX DE MOINS',
    'feedback.chain3': 'TROIS DE MOINS',
    'feedback.chain4': 'QUATRE DE MOINS',
    'feedback.chain5': 'FOSSOYEUR',
    'feedback.chain6': 'LE PASSEUR DES ÂMES',
    'feedback.chain8': 'LE GLAS',
    'feedback.chain10': 'MOISSON',
    'feedback.chain12': 'CIMETIÈRE',
    'feedback.chain15': 'OSSUAIRE',
    'feedback.chain20': 'NUIT DES MORTS',
    'feedback.chain25': 'FLÉAU',
    'feedback.chain30': 'LA FAUCHEUSE',
    'feedback.chain40': 'LES QUATRE CAVALIERS',
    'feedback.chain50': 'DIES IRAE',
    'feedback.chain75': 'JUGEMENT DERNIER',
    'feedback.chain100': 'FIN DES TEMPS',
    'feedback.chainCount': '{count} ABATTUS',
    'feedback.chainBonus': 'SÉRIE +{points}',
    'feedback.headshot': 'CRÂNE',
    'results.player': '{kills} élim. · {score} pts',
  },
  en: {
    'feedback.chain2': 'TWO DOWN',
    'feedback.chain3': 'THREE DOWN',
    'feedback.chain4': 'FOUR DOWN',
    'feedback.chain5': 'GRAVEDIGGER',
    'feedback.chain6': 'THE FERRYMAN',
    'feedback.chain8': 'DEATH KNELL',
    'feedback.chain10': 'HARVEST',
    'feedback.chain12': 'GRAVEYARD',
    'feedback.chain15': 'OSSUARY',
    'feedback.chain20': 'NIGHT OF THE DEAD',
    'feedback.chain25': 'SCOURGE',
    'feedback.chain30': 'THE REAPER',
    'feedback.chain40': 'THE FOUR HORSEMEN',
    'feedback.chain50': 'DIES IRAE',
    'feedback.chain75': 'LAST JUDGMENT',
    'feedback.chain100': 'END OF DAYS',
    'feedback.chainCount': '{count} PUT DOWN',
    'feedback.chainBonus': 'STREAK +{points}',
    'feedback.headshot': 'SKULL',
    'results.player': '{kills} kills · {score} pts',
  },
});

// The impact recipes (UI-SOUND.md section 2.1), in shot-fx.js's shape. Dim
// ember reds in the additive pools (no green above 0x60: no gold, no white;
// intensity 1 at most, under Famille's white-hot 1.2 to 1.8), ash and bone
// dust in the smoke pool, never more particles than Famille: a bullet hit 6
// (Famille 15), a melee blow 7 (31), a kill 14 (31), a head-shot kill 20
// (42), a raider hit 4 and a raider kill 6.
// The hit's embers are a little redder than the brief's 0xb04a1c: two of
// those overlapping already add up to gold once red clips.
const ASH = { count: 2, jitter: .05, vx: .4, spread: .3, vy: [.2, .45], drag: 3, life: [.35, .55], size: [.05, .16, .22], color: 0x2c2622, colorTo: 0x161210, alpha: .42 };
const EMBERS = { count: 3, speed: [2, 4], up: .2, gravity: 9, drag: 2.6, life: [.16, .28], size: [.022, .008], color: 0xb03c18, colorTo: 0x4a1006, intensity: .9, trail: .03 };
const HIT_FLASH = { size: [.12, .24], color: 0x7a2a14, colorTo: 0x2a0a04, intensity: .7, life: .07 };
// A kill is the reward: it must read above any hit (F2), still far dimmer
// than Famille's gold (F4). The brief's kill (11 particles, a .34 m flash)
// drew 0 to 91 changed pixels, fewer than a bullet hit: client.js draws a
// kill at the body's middle, and the torso hid it. `front` brings it .3 m
// out toward the killer (`under` keeps it on a crawler), with a longer flash
// and more, faster, longer-lived embers that kindle as they leave the
// silhouette, so their light never piles into a gold core. Effects sheet,
// 14 October: 874 changed pixels at +.08 s, a bullet hit 217, Famille's kill
// 1343, no gold, never brighter than today's Frisson.
const KILL_EMBERS = { ...EMBERS, count: 9, speed: [3, 6], up: .3, drag: 2.4, life: [.26, .42], size: [.036, .014], color: 0xb83a18, colorTo: 0x3a0a04, intensity: 1, trail: .025, jitter: .05, fadeIn: .25 };
const KILL_ASH = { ...ASH, count: 4, vy: [.25, .55], drag: 2.5, size: [.08, .26, .36], alpha: .55, life: [.6, .9] };
const KILL_FLASH = { size: [.14, .4], color: 0x942812, colorTo: 0x2a0604, intensity: .6, life: .12 };
// Living people stay bloodless and neutral: Famille's solid dust, a dull
// flash; a raider brought down raises more of it than a raider hit.
const RAIDER = { flash: { size: [.14, .26], color: 0x4a4440, colorTo: 0x1a1814, intensity: .6, life: .07 }, ash: { ...ASH, count: 3, color: 0x9c9a94, colorTo: 0x6a6862, alpha: .5 } };
const RAIDER_KILL = { front: .3, under: .3, flash: { size: [.22, .42], color: 0x5a544e, colorTo: 0x1a1814, intensity: .8, life: .12 }, ash: { ...RAIDER.ash, count: 4, alpha: .4, size: [.06, .18, .24], life: [.3, .48] }, blow: RAIDER };
export const IMPACT_STYLE = frozen({
  zombie: { flash: HIT_FLASH, embers: EMBERS, ash: ASH, raider: RAIDER },
  kill: {
    front: .3, under: .3, flash: KILL_FLASH, embers: KILL_EMBERS, ash: KILL_ASH,
    // A melee blow that did not kill: a bullet hit's look, a little wider.
    blow: { flash: { ...HIT_FLASH, size: [.14, .28] }, embers: { ...EMBERS, count: 4 }, ash: ASH },
    raider: RAIDER_KILL,
  },
  headshot: {
    front: .3, under: .3, flash: { ...KILL_FLASH, size: [.16, .44], color: 0xa02a14, intensity: .65 }, embers: { ...KILL_EMBERS, count: 10 }, ash: { ...KILL_ASH, count: 3 },
    // The one burst with a readable shape: a jet of pale bone dust rising
    // straight up from the crown, where Famille has its crown of gold stars.
    // shot-fx.js starts it at the enemy's own crown (client.js gives it with
    // the kill), so it sits on a crawler's head as on a brute's.
    grit: { count: 6, lift: .05, jitter: 0, vx: 0, spread: .5, vy: [2.2, 3.2], gravity: 6, drag: 1.5, life: [.3, .45], size: [.05, .14, .14], color: 0xa89f8e, colorTo: 0x5a544a, alpha: .6 },
    raider: RAIDER_KILL,
  },
});

// A line of the words above in the page's language, its {name} placeholders
// filled from the params' own properties as i18n.js t() does; null when the
// key has no Frisson words.
function text(key, params = {}) {
  const words = WORDS[getLanguage() === 'en' ? 'en' : 'fr'];
  if (!Object.hasOwn(words, key)) return null;
  return words[key].replace(/\{(\w+)\}/g, (match, name) => params && Object.hasOwn(params, name) ? String(params[name]) : match);
}
// The score popup keeps its arc (it shows where the score goes) but jumps in
// two steps and never overshoots (UI-SOUND.md section 2.4): no scale above 1.
// One array literal per popup, as Famille's.
function popupFrames(flight, rise) {
  return flight ? [
    { transform: 'translate(-50%,-50%) scale(.9)', opacity: 1, offset: 0, easing: 'steps(2,end)' },
    { transform: `${rise} scale(1)`, opacity: 1, offset: .12, easing: 'linear' },
    { transform: `${rise} scale(1)`, opacity: 1, offset: .4, easing: 'ease-in' },
    { transform: `translate(-50%,-50%) translate(${flight.dx * .2}px,${flight.dy * .75}px) scale(.7)`, opacity: .8, offset: .72, easing: 'ease-out' },
    { transform: `translate(-50%,-50%) translate(${flight.dx}px,${flight.dy}px) scale(.45)`, opacity: .25, offset: 1 },
  ] : [
    { transform: 'translate(-50%,-50%) scale(.9)', opacity: 1, offset: 0, easing: 'steps(2,end)' },
    { transform: `${rise} scale(1)`, opacity: 1, offset: .12, easing: 'linear' },
    { transform: `${rise} scale(1)`, opacity: 1, offset: .4, easing: 'ease-in' },
    { transform: 'translate(-50%,-50%) translateY(-46px) scale(.9)', opacity: 0, offset: 1 },
  ];
}
export const FEEDBACK_STYLE = Object.freeze({ text, popupFrames });

function detach(node) {
  if (typeof node?.remove === 'function') node.remove(); else node?.parentNode?.removeChild?.(node);
}

// Synchronous and fetch-free, so there is nothing to call off. ctx.feedback
// (the HUD) and ctx.THREE may be missing: tests and tools install without.
export function install(ctx = {}) {
  const { THREE = null, feedback = null, document: doc = null, base = '/frisson/' } = ctx;
  setImpactStyle(IMPACT_STYLE);
  // Soot that swallows the body and darkens with the night: the program of
  // Famille's Lambert smoke, the colour a uniform. The spark ring is built
  // as in Famille but hidden. One shared answer for every death.
  const smoke = THREE ? new THREE.MeshLambertMaterial({ color: 0x2e2926 }) : null;
  if (smoke) smoke.name = 'frisson:zombiePoofSmoke';
  const look = Object.freeze({ smoke, sparks: false });
  const death = Object.freeze({ poof: () => look });
  setDeathStyle(death);
  feedback?.setStyle?.(FEEDBACK_STYLE);
  // After style.css and frisson.css: its same-specificity rules win, and
  // removing it restores Famille.
  let link = null;
  if (doc?.createElement) {
    detach(doc.getElementById?.('frisson-feedback-css'));
    link = doc.createElement('link');
    link.id = 'frisson-feedback-css'; link.rel = 'stylesheet'; link.href = `${base}feedback.css`;
    (doc.head ?? doc.body)?.appendChild?.(link);
  }
  let on = true;
  // Takes off only its own, once. When the pack comes off mid-night the
  // client removes the falling bodies, so no corpse keeps the freed soot.
  return {
    uninstall() {
      if (!on) return;
      on = false;
      if (getImpactStyle() === IMPACT_STYLE) setImpactStyle(null);
      if (getDeathStyle() === death) setDeathStyle(null);
      if (feedback?.style === FEEDBACK_STYLE) feedback.setStyle(null);
      detach(link); link = null;
      smoke?.dispose();
    },
  };
}
