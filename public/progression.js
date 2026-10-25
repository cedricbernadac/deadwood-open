// Preserve the original night’s difficulty endpoints while reaching them
// over twenty rounds. A difficulty level is continuous, never rounded.
export const MAX_WAVES = 20;
export const LEGACY_MAX_WAVES = 30;
export function boundedWave(wave = 1) {
  return Math.max(1, Math.min(MAX_WAVES, Number.isFinite(wave) ? wave : 1));
}
export function difficultyLevel(wave = 1) {
  return 1 + (boundedWave(wave) - 1) * (LEGACY_MAX_WAVES - 1) / (MAX_WAVES - 1);
}
// First actual round at which an old discrete unlock is reached.
export function waveAtDifficultyLevel(level = 1) {
  const threshold = Math.max(1, Math.min(LEGACY_MAX_WAVES, Number.isFinite(level) ? level : 1));
  return Math.ceil(1 + (threshold - 1) * (MAX_WAVES - 1) / (LEGACY_MAX_WAVES - 1));
}
