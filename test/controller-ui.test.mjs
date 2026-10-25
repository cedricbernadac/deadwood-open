import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTROLLER_DEFAULTS, CONTROLLER_SETTINGS_KEY, normalizeControllerSettings, readControllerSettings, saveControllerSettings, navigateControllerMenu } from '../public/controller-ui.js';

test('controller preferences recover from corrupt/blocked storage and never persist unsafe or unknown values', () => {
  for (const raw of [null, '', '{broken', 'null', '[]', '42', 'true']) {
    assert.deepEqual(readControllerSettings({ getItem: () => raw }), CONTROLLER_DEFAULTS);
  }
  const blocked = { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); } };
  assert.deepEqual(readControllerSettings(blocked), CONTROLLER_DEFAULTS);
  assert.deepEqual(saveControllerSettings(blocked, {}), CONTROLLER_DEFAULTS);
  const writes = [], storage = { setItem: (key, value) => writes.push([key, value]) };
  const settings = saveControllerSettings(storage, { mode: 'other', sensitivity: Infinity, deadzone: -.1, aimAssist: 'snap', invertY: 'true', rumble: 'max', secret: 'discard' });
  assert.deepEqual(settings, { ...CONTROLLER_DEFAULTS, deadzone: .05 });
  assert.deepEqual(writes, [[CONTROLLER_SETTINGS_KEY, JSON.stringify(settings)]]);
  assert.deepEqual(normalizeControllerSettings({ mode: 'mouse', sensitivity: 1000, deadzone: 1000, aimAssist: 'off', invertY: true }),
    { mode: 'mouse', sensitivity: 360, deadzone: .35, aimAssist: 'off', invertY: true, rumble: 'normal' });
});

test('all aim-assist levels including Strong round-trip through the existing v1 preference without changing the default', () => {
  assert.equal(CONTROLLER_SETTINGS_KEY, 'deadwood-controller-v1');
  assert.equal(CONTROLLER_DEFAULTS.aimAssist, 'normal');
  const values = new Map(), writes = [];
  const storage = { getItem: key => values.get(key) ?? null,
    setItem(key, value) { values.set(key, value); writes.push(key); } };
  for (const aimAssist of ['off', 'light', 'normal', 'strong']) {
    const saved = saveControllerSettings(storage, { ...CONTROLLER_DEFAULTS, aimAssist });
    assert.equal(saved.aimAssist, aimAssist);
    assert.equal(readControllerSettings(storage).aimAssist, aimAssist);
  }
  assert.deepEqual(writes, Array(4).fill(CONTROLLER_SETTINGS_KEY));
  assert.deepEqual([...values.keys()], [CONTROLLER_SETTINGS_KEY], 'no migration or second preference key');
  assert.equal(readControllerSettings({ getItem: () => '{"aimAssist":"unknown"}' }).aimAssist, 'normal');
});

function menuFixture() {
  const document = { activeElement: null }, nodes = [];
  const node = (tagName = 'BUTTON', props = {}) => {
    const control = { tagName, type: tagName === 'INPUT' ? 'text' : '', disabled: false,
      clicks: 0, events: [], selections: 0, scrolls: 0,
      getClientRects() { return this.collapsed ? [] : [{}]; }, closest() { return this.hiddenParent ? {} : null; },
      focus() { document.activeElement = this; }, click() { this.clicks++; }, select() { this.selections++; },
      scrollIntoView() { this.scrolls++; }, dispatchEvent(event) { this.events.push(event); }, ...props };
    nodes.push(control); return control;
  };
  const root = { querySelectorAll: () => nodes };
  const navigate = action => navigateControllerMenu(root, action, document);
  return { document, node, root, navigate };
}

test('controller menu navigation wraps visible enabled controls and skips collapsed, hidden and disabled descendants', () => {
  const f = menuFixture(), first = f.node(), disabled = f.node('BUTTON', { disabled: true });
  const hidden = f.node('INPUT', { type: 'hidden' }), nested = f.node('BUTTON', { hiddenParent: true });
  const collapsed = f.node('INPUT', { collapsed: true }), last = f.node();
  assert.equal(f.navigate('down'), true); assert.equal(f.document.activeElement, first);
  f.navigate('down'); assert.equal(f.document.activeElement, last);
  f.navigate('down'); assert.equal(f.document.activeElement, first);
  f.navigate('up'); assert.equal(f.document.activeElement, last);
  f.navigate('confirm'); assert.equal(last.clicks, 1);
  for (const control of [disabled, hidden, nested, collapsed]) assert.equal(control.clicks + control.scrolls, 0);
  assert.equal(navigateControllerMenu({ querySelectorAll: () => [] }, 'confirm', f.document), false);
  assert.equal(navigateControllerMenu(null, 'down', f.document), false);
});

test('controller menu changes selectors/ranges through their normal change/input events and respects limits', () => {
  const f = menuFixture(), selector = f.node('SELECT', { selectedIndex: 1, options: [{}, {}, {}] });
  selector.focus(); f.navigate('right'); assert.equal(selector.selectedIndex, 2);
  f.navigate('confirm'); assert.equal(selector.selectedIndex, 2, 'A cycles a selector without exceeding the last option');
  f.navigate('left'); assert.equal(selector.selectedIndex, 1);
  assert.deepEqual(selector.events.map(event => [event.type, event.bubbles]), [['change', true], ['change', true], ['change', true]]);
  const range = f.node('INPUT', { type: 'range', min: '.05', max: '.35', step: '.01', value: '.35' });
  range.focus(); f.navigate('right'); assert.equal(Number(range.value), .35);
  f.navigate('left'); assert.ok(Math.abs(Number(range.value) - .34) < 1e-12);
  range.value = '.05'; f.navigate('left'); assert.equal(Number(range.value), .05);
  assert.deepEqual(range.events.map(event => [event.type, event.bubbles]), [['input', true], ['input', true], ['input', true]]);
});

test('controller A selects copyable text, toggles ordinary buttons and opens native details without sending gameplay actions', () => {
  const f = menuFixture(), address = f.node('INPUT', { type: 'text' });
  address.focus(); f.navigate('confirm'); assert.equal(address.selections, 1); assert.equal(address.clicks, 0);
  const checkbox = f.node('INPUT', { type: 'checkbox' }); checkbox.focus(); f.navigate('confirm'); assert.equal(checkbox.clicks, 1);
  const details = f.node('SUMMARY'); details.focus(); f.navigate('right'); f.navigate('confirm'); assert.equal(details.clicks, 2);
  assert.equal(f.navigate('unknown'), false);
});
