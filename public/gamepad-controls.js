// Standard Gamepad API layout. Extra buttons are reported, never guessed as
// distinct Elite paddles: many drivers expose paddles as ordinary face keys.
export const GAMEPAD_BUTTONS = Object.freeze({
  jump: 0, umbrella: 1, reload: 2, cycle: 3, grenade: 4, interact: 5,
  alternate: 6, fire: 7, view: 8, menu: 9, sprint: 10, crouch: 11,
  radar: 12, drop: 13, previous: 14, next: 15, guide: 16,
});
export const GAMEPAD_DEFAULTS = Object.freeze({ sensitivity: 240, deadzone: .16, invertY: false, responseCurve: 1.6 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const setting = (value, fallback, min, max) => Number.isFinite(value) ? clamp(value, min, max) : fallback;
const actions = Object.keys(GAMEPAD_BUTTONS);
const flags = () => Object.fromEntries(actions.map(name => [name, false]));

export function normalizeGamepadSettings(value = {}) {
  return {
    sensitivity: setting(value?.sensitivity, GAMEPAD_DEFAULTS.sensitivity, 30, 720),
    deadzone: setting(value?.deadzone, GAMEPAD_DEFAULTS.deadzone, 0, .5),
    invertY: value?.invertY === true,
    responseCurve: setting(value?.responseCurve, GAMEPAD_DEFAULTS.responseCurve, 1, 3),
  };
}

export function radialStick(x, y, deadzone = GAMEPAD_DEFAULTS.deadzone, curve = 1) {
  x = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
  y = Number.isFinite(y) ? clamp(y, -1, 1) : 0;
  const magnitude = Math.hypot(x, y), threshold = setting(deadzone, .16, 0, .5);
  if (magnitude <= threshold || magnitude === 0) return { x: 0, y: 0 };
  const amount = ((Math.min(1, magnitude) - threshold) / (1 - threshold)) ** setting(curve, 1, 1, 3);
  return { x: x / magnitude * amount, y: y / magnitude * amount };
}

export function isStandardGamepad(gamepad) {
  return Boolean(gamepad?.connected !== false && gamepad?.mapping === 'standard'
    && gamepad.axes?.length >= 4 && gamepad.buttons?.length >= 16);
}

const buttonValue = button => Number.isFinite(button?.value) ? clamp(button.value, 0, 1) : button?.pressed === true ? 1 : 0;
const neutral = (connected = false, index = null, supported = false) => ({
  connected, supported, index, label: '', forward: 0, strafe: 0, lookX: 0, lookY: 0,
  yawDelta: 0, pitchDelta: 0, held: flags(), pressed: flags(), released: flags(), extras: [],
});

export function createGamepadControls(initialSettings = {}) {
  let settings = normalizeGamepadSettings(initialSettings), device = null, initial = true;
  let previous = [], blocked = new Set(), triggerState = new Map();
  const reset = () => { device = null; initial = true; previous = []; blocked = new Set(); triggerState = new Map(); };
  return {
    configure(value = {}) { settings = normalizeGamepadSettings({ ...settings, ...value }); return { ...settings }; },
    settings() { return { ...settings }; },
    reset,
    update(gamepad, deltaSeconds, { enabled = true } = {}) {
      const valid = isStandardGamepad(gamepad);
      if (!valid || !enabled) {
        const released = flags();
        for (const name of actions) released[name] = previous[GAMEPAD_BUTTONS[name]] === true;
        reset();
        const connected = Boolean(gamepad && gamepad.connected !== false);
        return { ...neutral(connected, connected ? gamepad.index ?? 0 : null, valid), released };
      }
      const identity = `${gamepad.index ?? 0}:${gamepad.id ?? ''}`;
      if (device !== identity) { reset(); device = identity; }
      const state = neutral(true, gamepad.index ?? 0, true);
      state.label = String(gamepad.id ?? 'Gamepad').slice(0, 180);
      const left = radialStick(gamepad.axes[0], gamepad.axes[1], settings.deadzone);
      const right = radialStick(gamepad.axes[2], gamepad.axes[3], settings.deadzone, settings.responseCurve);
      state.forward = -left.y; state.strafe = left.x; state.lookX = right.x; state.lookY = right.y;
      const dt = Number.isFinite(deltaSeconds) ? clamp(deltaSeconds, 0, .05) : 0;
      const angularStep = settings.sensitivity * Math.PI / 180 * dt;
      state.yawDelta = -right.x * angularStep;
      state.pitchDelta = right.y * angularStep * (settings.invertY ? 1 : -1);
      const current = [], rawValues = [];
      for (let index = 0; index < gamepad.buttons.length; index++) {
        const value = buttonValue(gamepad.buttons[index]); rawValues[index] = value;
        let held;
        if (index === 6 || index === 7) {
          held = triggerState.get(index) === true ? value > .4 : value >= .55;
          triggerState.set(index, held);
        } else held = value >= .5;
        if ((initial || previous[index] === undefined) && held) blocked.add(index);
        if (!held) blocked.delete(index);
        current[index] = held && !blocked.has(index);
      }
      for (const name of actions) {
        const index = GAMEPAD_BUTTONS[name];
        state.held[name] = current[index] === true;
        state.pressed[name] = state.held[name] && previous[index] !== true;
        state.released[name] = !state.held[name] && previous[index] === true;
      }
      for (let index = 17; index < current.length; index++) state.extras.push({
        index, value: rawValues[index], held: current[index] === true,
        pressed: current[index] === true && previous[index] !== true,
        released: current[index] !== true && previous[index] === true,
      });
      previous = current; initial = false;
      return state;
    },
  };
}
