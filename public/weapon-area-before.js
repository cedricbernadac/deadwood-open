// Additive historical snapshot; the original 14-weapon JSON stays immutable.
// Read from the habitual server's live rules.js before the area-edge revision.
export const GRENADE_BASELINE_PROVENANCE = Object.freeze({
  sourceUrl: 'http://127.0.0.1:3002/rules.js',
  exportName: 'GRENADES',
  checkedAt: '2026-10-17T09:49:35.8594035Z',
  attenuation: 'Full damage through 2 m, linear decay to zero at 4 m.',
});
export const BASELINE_GRENADE = Object.freeze({
  name: 'Grenade', explosive: true, damage: 450, innerRadius: 2, radiusDamage: 4,
});
