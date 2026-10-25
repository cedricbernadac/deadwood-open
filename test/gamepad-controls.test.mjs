import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAMEPAD_BUTTONS, GAMEPAD_DEFAULTS, normalizeGamepadSettings, radialStick,
  isStandardGamepad, createGamepadControls,
} from '../public/gamepad-controls.js';

const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function pad(overrides = {}) {
  return { mapping: 'standard', connected: true, index: 0, id: 'Xbox Wireless Controller',
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })), ...overrides };
}
function setButton(gamepad, index, value) {
  gamepad.buttons[index] = { value, pressed: value >= .5 };
}
function armed(settings) {
  const controls = createGamepadControls(settings), gamepad = pad();
  controls.update(gamepad, 1 / 60);
  return { controls, gamepad };
}

test('standard Xbox mapping exposes all agreed controls without inventing Elite paddles', () => {
  assert.deepEqual(GAMEPAD_BUTTONS, {
    jump: 0, umbrella: 1, reload: 2, cycle: 3, grenade: 4, interact: 5,
    alternate: 6, fire: 7, view: 8, menu: 9, sprint: 10, crouch: 11,
    radar: 12, drop: 13, previous: 14, next: 15, guide: 16,
  });
  for (const [action, index] of Object.entries(GAMEPAD_BUTTONS)) {
    const { controls, gamepad } = armed();
    setButton(gamepad, index, 1);
    const first = controls.update(gamepad, 1 / 60), sustained = controls.update(gamepad, 1 / 60);
    assert.equal(first.held[action], true, action);
    assert.equal(first.pressed[action], true, action);
    assert.deepEqual(Object.keys(first.pressed).filter(name => first.pressed[name]), [action]);
    assert.equal(sustained.held[action], true);
    assert.equal(sustained.pressed[action], false);
    setButton(gamepad, index, 0);
    assert.equal(controls.update(gamepad, 1 / 60).released[action], true);
    assert.equal(controls.update(gamepad, 1 / 60).released[action], false);
  }
});

test('unsupported and incomplete layouts stay neutral while reporting a connected unsupported device', () => {
  const controls = createGamepadControls();
  for (const gamepad of [pad({ mapping: '' }), pad({ axes: [0, 0] }), pad({ buttons: [] })]) {
    assert.equal(isStandardGamepad(gamepad), false);
    const state = controls.update(gamepad, 1 / 60);
    assert.equal(state.connected, true);
    assert.equal(state.supported, false);
    assert.equal(state.yawDelta, 0);
    assert.equal(Object.values(state.held).some(Boolean), false);
  }
  assert.equal(isStandardGamepad(undefined), false);
  assert.equal(isStandardGamepad(pad({ connected: false })), false);
  assert.equal(controls.update(null, 1 / 60).connected, false);
  assert.equal(isStandardGamepad(pad({ buttons: Array.from({ length: 16 }, () => ({ value: 0 })) })), true);
});

test('radial deadzone suppresses drift and preserves direction without a diagonal speed boost', () => {
  assert.deepEqual(radialStick(.1, .1), { x: 0, y: 0 });
  assert.deepEqual(radialStick(.16, 0), { x: 0, y: 0 });
  const diagonal = radialStick(1, 1);
  near(Math.hypot(diagonal.x, diagonal.y), 1);
  near(diagonal.x, diagonal.y);
  const partial = radialStick(.3, .4);
  near(partial.x / partial.y, .75);
  near(Math.hypot(partial.x, partial.y), (.5 - .16) / .84);
  assert.deepEqual(radialStick(NaN, Infinity), { x: 0, y: 0 });
});

test('look response is continuous and softer than movement near the deadzone', () => {
  let previous = 0;
  for (const input of [.161, .2, .3, .6, .9, 1]) {
    const linear = radialStick(input, 0, .16, 1), curved = radialStick(input, 0, .16, 1.6);
    assert.ok(curved.x > previous && curved.x <= linear.x);
    previous = curved.x;
  }
  near(radialStick(1, 0, .16, 1.6).x, 1);
});

test('left stick moves forward and strafes independently from signed right-stick look', () => {
  const { controls, gamepad } = armed();
  gamepad.axes = [1, -1, 1, -1];
  const state = controls.update(gamepad, 1 / 60);
  assert.ok(state.forward > 0 && state.strafe > 0);
  near(Math.hypot(state.forward, state.strafe), 1);
  assert.ok(state.yawDelta < 0, 'right stick right turns towards negative yaw');
  assert.ok(state.pitchDelta > 0, 'right stick up looks upwards');
  controls.configure({ invertY: true });
  assert.ok(controls.update(gamepad, 1 / 60).pitchDelta < 0);
});

test('sensitivity is degrees per second and accumulates equally at 60 and 144 FPS', () => {
  const simulate = fps => {
    const { controls, gamepad } = armed({ sensitivity: 240 });
    gamepad.axes = [0, 0, .7, -.3];
    let yaw = 0, pitch = 0;
    for (let frame = 0; frame < fps; frame++) {
      const state = controls.update(gamepad, 1 / fps);
      yaw += state.yawDelta; pitch += state.pitchDelta;
    }
    return { yaw, pitch };
  };
  const low = simulate(60), high = simulate(144);
  near(low.yaw, high.yaw); near(low.pitch, high.pitch);
  const { controls, gamepad } = armed(); gamepad.axes[2] = 1;
  near(controls.update(gamepad, .05).yawDelta, -240 * Math.PI / 180 * .05);
});

test('trigger hysteresis keeps full-auto fire continuous across noisy trigger readings', () => {
  const { controls, gamepad } = armed();
  for (const trigger of [6, 7]) {
    const action = trigger === 6 ? 'alternate' : 'fire';
    for (const [value, held, pressed, released] of [
      [.54, false, false, false], [.55, true, true, false], [.5, true, false, false],
      [.41, true, false, false], [.52, true, false, false], [.4, false, false, true],
      [.54, false, false, false], [.6, true, true, false], [0, false, false, true],
    ]) {
      setButton(gamepad, trigger, value);
      const state = controls.update(gamepad, 1 / 60);
      assert.equal(state.held[action], held, `${action} value=${value}`);
      assert.equal(state.pressed[action], pressed, `${action} value=${value}`);
      assert.equal(state.released[action], released, `${action} value=${value}`);
    }
  }
});

test('buttons held on connection cannot fire, jump, or open menus until released and pressed again', () => {
  const controls = createGamepadControls(), gamepad = pad();
  for (const index of [0, 7, 9]) setButton(gamepad, index, 1);
  for (let frame = 0; frame < 3; frame++) {
    const state = controls.update(gamepad, 1 / 60);
    for (const action of ['jump', 'fire', 'menu']) {
      assert.equal(state.held[action], false);
      assert.equal(state.pressed[action], false);
    }
  }
  for (const index of [0, 7, 9]) setButton(gamepad, index, 0);
  controls.update(gamepad, 1 / 60);
  for (const index of [0, 7, 9]) setButton(gamepad, index, 1);
  const state = controls.update(gamepad, 1 / 60);
  for (const action of ['jump', 'fire', 'menu']) assert.equal(state.pressed[action], true);
});

test('reset, focus disable, disconnect and controller replacement all rearm held buttons safely', () => {
  for (const reason of ['reset', 'disabled', 'disconnect', 'replacement']) {
    const { controls, gamepad } = armed();
    setButton(gamepad, 7, 1);
    assert.equal(controls.update(gamepad, 1 / 60).held.fire, true);
    if (reason === 'reset') controls.reset();
    if (reason === 'disabled') {
      const state = controls.update(gamepad, 1 / 60, { enabled: false });
      assert.equal(state.held.fire, false); assert.equal(state.released.fire, true);
      assert.equal(state.connected, true);
    }
    if (reason === 'disconnect') {
      const state = controls.update(null, 1 / 60);
      assert.equal(state.released.fire, true); assert.equal(state.connected, false);
    }
    if (reason === 'replacement') gamepad.id = 'Second controller';
    assert.equal(controls.update(gamepad, 1 / 60).held.fire, false, reason);
    setButton(gamepad, 7, 0); controls.update(gamepad, 1 / 60);
    setButton(gamepad, 7, 1);
    assert.equal(controls.update(gamepad, 1 / 60).pressed.fire, true, reason);
  }
});

test('optional exposed buttons remain informational, including safe rearming when they first appear', () => {
  const { controls, gamepad } = armed();
  setButton(gamepad, 17, 1); setButton(gamepad, 18, 0);
  let state = controls.update(gamepad, 1 / 60);
  assert.deepEqual(state.extras.map(button => button.index), [17, 18]);
  assert.equal(state.extras[0].held, false);
  setButton(gamepad, 17, 0); controls.update(gamepad, 1 / 60);
  setButton(gamepad, 17, 1);
  state = controls.update(gamepad, 1 / 60);
  assert.equal(state.extras[0].pressed, true);
  assert.equal(Object.values(state.pressed).some(Boolean), false);
  setButton(gamepad, 17, 0);
  assert.equal(controls.update(gamepad, 1 / 60).extras[0].released, true);
});

test('settings remain bounded and partial changes preserve existing preferences', () => {
  assert.deepEqual(normalizeGamepadSettings(), GAMEPAD_DEFAULTS);
  assert.deepEqual(normalizeGamepadSettings({ sensitivity: Infinity, deadzone: NaN, invertY: 'yes', responseCurve: -1 }),
    { sensitivity: 240, deadzone: .16, invertY: false, responseCurve: 1 });
  assert.deepEqual(normalizeGamepadSettings({ sensitivity: 900, deadzone: -.1, invertY: true, responseCurve: 8 }),
    { sensitivity: 720, deadzone: 0, invertY: true, responseCurve: 3 });
  const controls = createGamepadControls({ sensitivity: 300, deadzone: .2 });
  const settings = controls.configure({ invertY: true });
  assert.equal(settings.sensitivity, 300); assert.equal(settings.deadzone, .2);
  settings.sensitivity = 40;
  assert.equal(controls.settings().sensitivity, 300);
});

test('frame hitches and corrupt timing cannot inject huge aim changes', () => {
  const { controls, gamepad } = armed(); gamepad.axes[2] = 1;
  near(controls.update(gamepad, 5).yawDelta, controls.update(gamepad, .05).yawDelta);
  for (const elapsed of [-1, NaN, Infinity, undefined]) near(controls.update(gamepad, elapsed).yawDelta, 0);
});
