// An opt-in, in-memory trace. The caller supplies both data and a monotonic
// timestamp; this module never observes the browser or writes anywhere.
function copySimple(value, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || ancestors.has(value)) return undefined;
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  // An ordinary object from another realm has its own Object.prototype, whose
  // prototype is also null. Class instances still have an extra prototype.
  if (!array && prototype !== null && Object.getPrototypeOf(prototype) !== null) return undefined;
  ancestors.add(value);
  const result = array ? [] : {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) continue;
    const copy = copySimple(descriptor.value, ancestors);
    if (copy === undefined) continue;
    Object.defineProperty(result, key, { value: copy, enumerable: true, writable: true, configurable: true });
  }
  ancestors.delete(value);
  return result;
}

function copiedData(value) {
  // Diagnostics must not interrupt controls if a caller supplies an unsupported
  // object. Accessors, prototypes, cycles and non-finite numbers are not traced.
  try { return copySimple(value) ?? {}; } catch { return {}; }
}

export function createAimDiagnostics({ capacity = 4096, maxAgeMs = 15000 } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new RangeError('maxAgeMs must be a non-negative finite number');
  const entries = new Array(capacity);
  let enabled = false, captured = false, head = 0, count = 0, lastTime = -Infinity;

  function status() { return { enabled, captured, count, capacity, maxAgeMs }; }
  function clear() {
    entries.fill(undefined);
    head = 0; count = 0; lastTime = -Infinity; captured = false;
    return status();
  }
  function record(type, data, time) {
    if (!enabled || captured || typeof type !== 'string' || !type || !Number.isFinite(time) || time < lastTime) return false;
    const copied = copiedData(data);
    const threshold = time - maxAgeMs;
    while (count && entries[head].time < threshold) {
      entries[head] = undefined;
      head = (head + 1) % capacity;
      count--;
    }
    if (count === capacity) {
      entries[head] = undefined;
      head = (head + 1) % capacity;
      count--;
    }
    entries[(head + count) % capacity] = { type, time, data: copied };
    count++; lastTime = time;
    return true;
  }

  return {
    get enabled() { return enabled; },
    get captured() { return captured; },
    setEnabled(value) {
      enabled = value === true;
      if (!enabled) clear();
      return status();
    },
    record,
    capture(data, time) {
      if (!record('capture', data, time)) return false;
      captured = true;
      return true;
    },
    clear,
    status,
    report(metadata = {}) {
      const events = [];
      for (let index = 0; index < count; index++) events.push(copiedData(entries[(head + index) % capacity]));
      return { version: 1, ...status(), metadata: copiedData(metadata), events };
    },
  };
}
