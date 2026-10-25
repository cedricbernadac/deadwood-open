// Generated silhouettes, using the same alpha-mask presentation as weapon HUD art.
// Artwork paths and markup are fixed; no user content enters HTML or CSS.
const KINDS = ["stone","perforating","extended","reinforced","vitamins","reload","switching","vitality","rainproof","toughskin","medic","grenadier","radar","frostaura"];
export const BONUS_ICONS = Object.freeze(Object.fromEntries(KINDS.map(kind => {
  const src = `./bonus-icons/${kind}.webp`;
  return [kind, `<span class="bonus-silhouette" aria-hidden="true" style="--bonus-silhouette:url('${src}')"><img src="${src}" alt="" width="128" height="128"></span>`];
})));
export const bonusIcon = kind => Object.hasOwn(BONUS_ICONS, kind) ? BONUS_ICONS[kind] : '';
