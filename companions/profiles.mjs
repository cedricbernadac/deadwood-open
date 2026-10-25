import { COMPANION_ARCHETYPES, COMPANION_PROFILE_CHOICES, companionArchetype } from '../public/companion-profiles.js';

const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

// These change the body's handling only. Weapon speed, spread, damage,
// magazines, reloads and legal firing intervals remain the human rules.
const PROFILES = freeze({
  sharpshooter: { aim: { tremorYaw: .045, tremorPitch: .026, reaction: [.38, .54], pause: [.08, .17], flinch: 1.9, crowd: .12 },
    traits: { courage: .55, teamwork: .55, aggression: .4 } },
  rusher: { aim: { tremorYaw: .10, tremorPitch: .06, reaction: [.16, .28], pause: [.015, .08], flinch: 2, crowd: .14 },
    traits: { courage: .95, teamwork: .35, aggression: .95 } },
  protector: { aim: { tremorYaw: .075, tremorPitch: .045, reaction: [.3, .45], pause: [.05, .2], flinch: 2.2, crowd: .15 },
    traits: { courage: .75, teamwork: .95, aggression: .5 } },
  timid: { aim: { tremorYaw: .12, tremorPitch: .07, reaction: [.50, .75], pause: [.10, .24], flinch: 2.4, crowd: .18 },
    traits: { courage: .18, teamwork: .4, aggression: .15 } },
  veteran: { aim: { tremorYaw: .025, tremorPitch: .016, reaction: [.12, .23], pause: [.02, .08], flinch: 1.35, crowd: .07 },
    traits: { courage: .85, teamwork: .9, aggression: .7 } },
});

const sample = random => {
  const value = Number(random());
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .5;
};
const vary = random => .92 + .16 * sample(random);
const scaled = (range, factor) => range.map(value => value * factor);

// Called once when a companion joins a night. Nothing here is sampled by
// the body tick or by a prompt refresh; a random seat may repeat another.
export function rollCompanionProfile(selection, random = Math.random) {
  const chosen = COMPANION_PROFILE_CHOICES.includes(selection) ? selection : 'random';
  const archetype = chosen === 'random'
    ? COMPANION_ARCHETYPES[Math.min(COMPANION_ARCHETYPES.length - 1, Math.floor(sample(random) * COMPANION_ARCHETYPES.length))].id
    : chosen;
  return buildProfile(chosen, archetype, { accuracy: vary(random), reaction: vary(random), pause: vary(random) });
}

function buildProfile(selection, archetype, variation) {
  const base = PROFILES[archetype];
  return freeze({ selection, archetype,
    aim: { ...base.aim, tremorYaw: base.aim.tremorYaw * variation.accuracy,
      tremorPitch: base.aim.tremorPitch * variation.accuracy,
      reaction: scaled(base.aim.reaction, variation.reaction), pause: scaled(base.aim.pause, variation.pause) },
    traits: { ...base.traits }, variation });
}

// A saved profile (manual save): the same frozen values again, rebuilt from
// its archetype and variation, never from numbers a file could inflate.
export function restoreCompanionProfile(saved) {
  const selection = COMPANION_PROFILE_CHOICES.includes(saved?.selection) ? saved.selection : null;
  const archetype = Object.hasOwn(PROFILES, saved?.archetype ?? '') ? saved.archetype : null;
  if (!selection || !archetype || (selection !== 'random' && selection !== archetype)) return null;
  const bounded = value => Number.isFinite(value) ? Math.max(.92, Math.min(1.08, value)) : 1;
  const variation = saved.variation ?? {};
  return buildProfile(selection, archetype, { accuracy: bounded(variation.accuracy), reaction: bounded(variation.reaction), pause: bounded(variation.pause) });
}

export function publicCompanionProfile(profile) {
  if (!profile || !COMPANION_PROFILE_CHOICES.includes(profile.selection) || !companionArchetype(profile.archetype)
    || (profile.selection !== 'random' && profile.selection !== profile.archetype)) return null;
  return { selection: profile.selection, archetype: profile.archetype };
}

export function companionProfilePrompt(profile) {
  if (!publicCompanionProfile(profile) || !profile.aim || !profile.traits) return '';
  const { aim, traits } = profile;
  if (!Array.isArray(aim.reaction) || aim.reaction.length !== 2 || !Array.isArray(aim.pause) || aim.pause.length !== 2
    || ![aim.tremorYaw, aim.tremorPitch, ...aim.reaction, ...aim.pause, traits.courage, traits.teamwork, traits.aggression].every(Number.isFinite)) return '';
  const range = values => values.map(value => value.toFixed(2)).join('-');
  const entry = companionArchetype(profile.archetype);
  return `${entry.labels.en}: ${entry.descriptions.en} Aim tremor yaw/pitch ${aim.tremorYaw.toFixed(3)}/${aim.tremorPitch.toFixed(3)} rad; reaction ${range(aim.reaction)}s; extra semiauto pause ${range(aim.pause)}s. Courage ${traits.courage.toFixed(2)}, teamwork ${traits.teamwork.toFixed(2)}, aggression ${traits.aggression.toFixed(2)} (0-1). Soft preferences; adapt to emergencies and team needs.`;
}
