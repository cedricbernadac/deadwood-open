// Shared labels and qualitative ratings for the lobby and observer. Ratings
// use a 1–5 scale: they describe a style, never a probability of hitting.
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export const COMPANION_ARCHETYPES = freeze([
  { id: 'sharpshooter', labels: { fr: 'Tireur', en: 'Sharpshooter' },
    descriptions: { fr: 'Précis et posé ; préfère couvrir à distance.', en: 'Accurate and deliberate; prefers covering from a distance.' },
    ratings: { accuracy: 5, reaction: 2, courage: 3, teamwork: 3 } },
  { id: 'rusher', labels: { fr: 'Fonceur', en: 'Rusher' },
    descriptions: { fr: 'Réactif et audacieux ; tire vite, vise moins bien.', en: 'Quick and bold; fires eagerly, with less accurate aim.' },
    ratings: { accuracy: 2, reaction: 4, courage: 5, teamwork: 2 } },
  { id: 'protector', labels: { fr: 'Protecteur', en: 'Protector' },
    descriptions: { fr: 'Équilibré et solidaire ; privilégie la couverture et les secours.', en: 'Balanced and supportive; favors covering teammates and rescues.' },
    ratings: { accuracy: 3, reaction: 3, courage: 4, teamwork: 5 } },
  { id: 'timid', labels: { fr: 'Trouillard', en: 'Timid' },
    descriptions: { fr: 'Hésitant et peu précis ; préfère la distance et les abris.', en: 'Hesitant and shaky; prefers distance and shelter.' },
    ratings: { accuracy: 1, reaction: 1, courage: 1, teamwork: 2 } },
  { id: 'veteran', labels: { fr: 'Vétéran', en: 'Veteran' },
    descriptions: { fr: 'Précis, réactif et solidaire ; garde son calme sous pression.', en: 'Accurate, quick and supportive; stays composed under pressure.' },
    ratings: { accuracy: 5, reaction: 5, courage: 4, teamwork: 5 } },
]);

export const COMPANION_PROFILE_CHOICES = Object.freeze(['random', ...COMPANION_ARCHETYPES.map(profile => profile.id)]);

export function companionArchetype(id) {
  return COMPANION_ARCHETYPES.find(profile => profile.id === id) ?? null;
}
