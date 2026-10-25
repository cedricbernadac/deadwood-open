export const CONTROLLER_SETTINGS_KEY = 'deadwood-controller-v1';
export const CONTROLLER_DEFAULTS = Object.freeze({ mode: 'auto', sensitivity: 240, deadzone: .16, aimAssist: 'normal', invertY: false, rumble: 'normal' });
const bounded = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export function normalizeControllerSettings(value) {
  return { mode: ['auto', 'mouse', 'gamepad'].includes(value?.mode) ? value.mode : 'auto',
    sensitivity: bounded(value?.sensitivity, 240, 120, 360), deadzone: bounded(value?.deadzone, .16, .05, .35),
    aimAssist: ['off', 'light', 'normal', 'strong'].includes(value?.aimAssist) ? value.aimAssist : 'normal', invertY: value?.invertY === true,
    rumble: ['off', 'light', 'normal', 'strong'].includes(value?.rumble) ? value.rumble : 'normal' };
}
export function readControllerSettings(storage) {
  try { return normalizeControllerSettings(JSON.parse(storage?.getItem(CONTROLLER_SETTINGS_KEY))); } catch { return { ...CONTROLLER_DEFAULTS }; }
}
export function saveControllerSettings(storage, value) {
  const settings = normalizeControllerSettings(value);
  try { storage?.setItem(CONTROLLER_SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  return settings;
}

// Work with normal focusable controls: their click/input handlers remain the
// same for mouse, keyboard and controller. Collapsed/hidden controls are skipped.
export function navigateControllerMenu(root, action, document, EventClass = Event) {
  if (!root?.querySelectorAll) return false;
  const controls = [...root.querySelectorAll('button, input, select, summary, a[href]')]
    .filter(node => !node.disabled && node.type !== 'hidden' && node.getClientRects?.().length && !node.closest?.('[hidden]'));
  if (!controls.length) return false;
  let index = controls.indexOf(document?.activeElement);
  if (action === 'up' || action === 'down') {
    index = index < 0 ? 0 : (index + (action === 'up' ? -1 : 1) + controls.length) % controls.length;
    controls[index].focus(); controls[index].scrollIntoView?.({ block: 'nearest' }); return true;
  }
  const focused = controls[index < 0 ? 0 : index];
  if (index < 0) focused.focus();
  if (action === 'confirm') {
    if (focused.tagName === 'SELECT') return navigateControllerMenu(root, 'right', document, EventClass);
    if (focused.tagName === 'INPUT' && ['text', 'number'].includes(focused.type)) { focused.select?.(); return true; }
    focused.click?.(); return true;
  }
  if (action !== 'left' && action !== 'right') return false;
  const direction = action === 'left' ? -1 : 1;
  if (focused.tagName === 'SELECT') {
    focused.selectedIndex = Math.max(0, Math.min(focused.options.length - 1, focused.selectedIndex + direction));
    focused.dispatchEvent(new EventClass('change', { bubbles: true })); return true;
  }
  if (focused.tagName === 'INPUT' && focused.type === 'range') {
    const min = Number(focused.min || 0), max = Number(focused.max || 100), step = Number(focused.step) || 1;
    focused.value = String(Math.max(min, Math.min(max, Number(focused.value) + direction * step)));
    focused.dispatchEvent(new EventClass('input', { bubbles: true })); return true;
  }
  if (focused.tagName === 'SUMMARY') { focused.click?.(); return true; }
  return false;
}
