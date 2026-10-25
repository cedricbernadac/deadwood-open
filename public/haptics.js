// Controller rumble for the recoil of each shot (owner request, 12 October).
// Uses the Gamepad API's vibrationActuator where the browser offers it
// (Chrome and Edge with an Xbox controller): 'trigger-rumble' when the
// browser lists it, so the right trigger's impulse motor kicks too, otherwise
// 'dual-rumble' for the two body motors. Firefox's hapticActuators pulse is a
// last resort. Every call is guarded: no controller, no actuator or a refused
// effect simply means no rumble.
export const RUMBLE_LEVELS = Object.freeze({ off: 0, light: .5, normal: 1, strong: 1.4 });

// Duration in ms; strong = low-frequency body motor, weak = high-frequency
// one, trigger = right trigger. Automatic rifles pulse once per round, shorter
// than their firing interval, so each kick is felt; the gatling and the
// flamethrower last past their interval, so a held trigger hums.
export const RUMBLE = Object.freeze({
  pistol: Object.freeze({ duration: 50, strong: .2, weak: .45, trigger: .35 }),
  smg: Object.freeze({ duration: 50, strong: .22, weak: .45, trigger: .35 }),
  assault: Object.freeze({ duration: 80, strong: .45, weak: .5, trigger: .55 }),
  rifle: Object.freeze({ duration: 60, strong: .42, weak: .5, trigger: .5 }),
  minigun: Object.freeze({ duration: 90, strong: .5, weak: .35, trigger: .45 }),
  flamethrower: Object.freeze({ duration: 170, strong: .08, weak: .3, trigger: .2 }),
  magnum: Object.freeze({ duration: 110, strong: .75, weak: .55, trigger: .85 }),
  shotgun: Object.freeze({ duration: 130, strong: .9, weak: .6, trigger: 1 }),
  sniper: Object.freeze({ duration: 140, strong: .85, weak: .45, trigger: 1 }),
  rocket: Object.freeze({ duration: 220, strong: 1, weak: .5, trigger: 1 }),
});

const clamp01 = value => Math.max(0, Math.min(1, value));

// The effect for one shot at a settings level, or null (melee, unknown, off).
export function rumbleEffect(weapon, level = 'normal') {
  const profile = RUMBLE[weapon], scale = RUMBLE_LEVELS[level] ?? RUMBLE_LEVELS.normal;
  if (!profile || !(scale > 0)) return null;
  return { duration: profile.duration, strongMagnitude: clamp01(profile.strong * scale),
    weakMagnitude: clamp01(profile.weak * scale), rightTrigger: clamp01(profile.trigger * scale) };
}

// Returns which kind of rumble was requested, or null.
export function playRumble(pad, effect) {
  if (!pad || !effect) return null;
  try {
    const actuator = pad.vibrationActuator;
    if (typeof actuator?.playEffect === 'function') {
      const trigger = Array.isArray(actuator.effects) && actuator.effects.includes('trigger-rumble');
      const parameters = { startDelay: 0, duration: effect.duration, strongMagnitude: effect.strongMagnitude, weakMagnitude: effect.weakMagnitude };
      if (trigger) Object.assign(parameters, { leftTrigger: 0, rightTrigger: effect.rightTrigger });
      actuator.playEffect(trigger ? 'trigger-rumble' : 'dual-rumble', parameters)?.catch?.(() => {});
      return trigger ? 'trigger' : 'dual';
    }
    const haptic = pad.hapticActuators?.[0];
    if (typeof haptic?.pulse === 'function') {
      haptic.pulse(Math.max(effect.strongMagnitude, effect.weakMagnitude), effect.duration)?.catch?.(() => {});
      return 'pulse';
    }
  } catch {}
  return null;
}

export function stopRumble(pad) {
  try { pad?.vibrationActuator?.reset?.()?.catch?.(() => {}); } catch {}
}
