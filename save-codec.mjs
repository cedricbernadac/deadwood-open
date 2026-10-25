// JSON-safe encoding of simulation state and the schema tools that read a
// save file back. A file is never trusted: every value is rebuilt from a
// schema, unknown keys are ignored and anything malformed falls back to the
// fresh default (or drops the record that carries it).

export const INVALID = Symbol('invalid');

export class SaveError extends Error {
  constructor(code, detail = code) { super(detail); this.name = 'SaveError'; this.code = code; }
}

// Maps, Sets and non-finite numbers have no JSON form of their own.
export function encodeValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  // -0 too: JSON would turn it into 0 and a replayed night could drift.
  if (typeof value === 'number') return Object.is(value, -0) ? { $num: '-0' } : Number.isFinite(value) ? value
    : { $num: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
  if (typeof value !== 'object') return undefined; // functions, symbols, undefined
  if (ancestors.has(value)) throw new SaveError('cycle', 'Cyclic state cannot be saved.');
  ancestors.add(value);
  try {
    if (value instanceof Map) return { $map: [...value].map(([key, item]) => [encodeValue(key, ancestors), encodeValue(item, ancestors) ?? null]) };
    if (value instanceof Set) return { $set: [...value].map(item => encodeValue(item, ancestors) ?? null) };
    if (Array.isArray(value)) return value.map(item => encodeValue(item, ancestors) ?? null);
    const result = {};
    for (const key of Object.keys(value)) {
      // Accessors (a door's aggregate hp) are derived from saved data.
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!('value' in descriptor)) continue;
      const encoded = encodeValue(descriptor.value, ancestors);
      if (encoded !== undefined) result[key] = encoded;
    }
    return result;
  } finally { ancestors.delete(value); }
}

// Prototype keys are refused outright: a save never legitimately has them.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function scanRaw(raw, { maxDepth = 40, maxNodes = 400000 } = {}) {
  let nodes = 0;
  const visit = (value, depth) => {
    if (++nodes > maxNodes || depth > maxDepth) throw new SaveError('too-large');
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new SaveError('invalid', `Forbidden key ${key}.`);
      visit(value[key], depth + 1);
    }
  };
  visit(raw, 0);
}

export const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const wrapped = (raw, key) => isPlain(raw) && Object.keys(raw).length === 1 && Object.hasOwn(raw, key) ? raw[key] : undefined;
const CONTROL = /[\u0000-\u001f\u007f]/;

// Schema constructors: each returns raw => value | INVALID.
export function num({ min = -1e12, max = 1e12, int = false, infinite = false } = {}) {
  return raw => {
    const special = wrapped(raw, '$num');
    if (special === '-0') return Math.min(max, Math.max(min, -0));
    if (special !== undefined) return infinite && (special === 'Infinity' || special === '-Infinity') ? (special === 'Infinity' ? Infinity : -Infinity) : INVALID;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return INVALID;
    const value = int ? Math.round(raw) : raw;
    return Math.min(max, Math.max(min, value));
  };
}
export const int = (min = 0, max = 1e9) => num({ min, max, int: true });
export function str({ max = 64, values = null, pattern = null } = {}) {
  return raw => typeof raw !== 'string' || raw.length > max || CONTROL.test(raw)
    || (values && !values.includes(raw)) || (pattern && !pattern.test(raw)) ? INVALID : raw;
}
export const bool = () => raw => typeof raw === 'boolean' ? raw : INVALID;
export const nullable = schema => raw => raw === null ? null : schema(raw);
// Over the cap is refused (a state the game never makes); a bad item is dropped.
export function arrayOf(schema, { max = 64 } = {}) {
  return raw => {
    if (!Array.isArray(raw) || raw.length > max) return INVALID;
    const result = [];
    for (const item of raw) { const value = schema(item); if (value !== INVALID) result.push(value); }
    return result;
  };
}
export function mapOf(keySchema, valueSchema, { max = 64, idKey = 'id', capCode = null } = {}) {
  return raw => {
    const entries = wrapped(raw, '$map');
    if (!Array.isArray(entries)) return INVALID;
    if (entries.length > max) { if (capCode) throw new SaveError(capCode); return INVALID; }
    const result = new Map();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const key = keySchema(entry[0]), value = valueSchema(entry[1]);
      if (key === INVALID || value === INVALID || result.has(key)) continue;
      // A record stored under another record's id would split one entity in two.
      if (idKey && isPlain(value) && Object.hasOwn(value, idKey) && value[idKey] !== key) continue;
      result.set(key, value);
    }
    return result;
  };
}
export function setOf(schema, { max = 64 } = {}) {
  return raw => {
    const items = wrapped(raw, '$set');
    if (!Array.isArray(items) || items.length > max) return INVALID;
    const result = new Set();
    for (const item of items) { const value = schema(item); if (value !== INVALID) result.add(value); }
    return result;
  };
}
// A record: known fields only. A bad optional field is treated as missing
// (the caller's default wins); a bad required field invalidates the record.
export function record(fields, { required = [] } = {}) {
  return raw => {
    if (!isPlain(raw) || wrapped(raw, '$map') !== undefined || wrapped(raw, '$set') !== undefined || wrapped(raw, '$num') !== undefined) return INVALID;
    const result = {};
    for (const [key, schema] of Object.entries(fields)) {
      if (!schema) continue;
      if (!Object.hasOwn(raw, key)) { if (required.includes(key)) return INVALID; continue; }
      const value = schema(raw[key]);
      if (value === INVALID) { if (required.includes(key)) return INVALID; continue; }
      result[key] = value;
    }
    return result;
  };
}
// An object keyed by a validated name (inventory, weapon clocks, bonuses).
export function dictOf(keySchema, valueSchema, { max = 16 } = {}) {
  return raw => {
    if (!isPlain(raw)) return INVALID;
    const keys = Object.keys(raw);
    if (keys.length > max) return INVALID;
    const result = {};
    for (const key of keys) {
      if (keySchema(key) === INVALID) continue;
      const value = valueSchema(raw[key]);
      if (value !== INVALID) result[key] = value;
    }
    return result;
  };
}

// The simplest fields follow their fresh default: a number stays a finite
// number (or may be infinite when the default is), a string a short string,
// a boolean a boolean, a plain object the same recursively. Null, arrays,
// Maps and Sets carry no kind of their own: they need an explicit schema,
// otherwise the file's value is ignored and the default kept. A number's
// range comes from numberFor(key, path, default): ±1e12 lets a crafted
// value cost a tick unbounded work, so the save module gives each its own.
export function templateFields(template, overrides = {}, numberFor = () => null, path = '') {
  const fields = {};
  for (const key of Object.keys(template)) {
    if (Object.hasOwn(overrides, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(template, key);
    if (!('value' in descriptor)) continue;
    const schema = derived(key, descriptor.value, numberFor, `${path}${key}`);
    if (schema) fields[key] = schema;
  }
  for (const [key, schema] of Object.entries(overrides)) if (schema) fields[key] = schema;
  return fields;
}
function derived(key, value, numberFor, path) {
  if (typeof value === 'number') return numberFor(key, path, value) ?? num({ infinite: !Number.isFinite(value) });
  if (typeof value === 'string') return str();
  if (typeof value === 'boolean') return bool();
  if (isPlain(value) && !(value instanceof Map) && !(value instanceof Set) && Object.getPrototypeOf(value) === Object.prototype)
    return record(templateFields(value, {}, numberFor, `${path}.`));
  return null;
}

// Generic id renaming over live or decoded state: string values, Map keys
// and Set members equal to `from` become `to`, in place and in order. Names
// are free text and never renamed; frozen objects hold no ids.
export function renameId(root, from, to, { skip = ['name', 'owner', 'profile'] } = {}) {
  const seen = new Set();
  const visit = value => {
    if (typeof value === 'string') return value === from ? to : value;
    if (value === null || typeof value !== 'object' || seen.has(value) || Object.isFrozen(value)) return value;
    seen.add(value);
    if (value instanceof Map) {
      const entries = [...value].map(([key, item]) => [visit(key), visit(item)]);
      value.clear(); for (const [key, item] of entries) value.set(key, item);
    } else if (value instanceof Set) {
      const items = [...value].map(visit);
      value.clear(); for (const item of items) value.add(item);
    } else if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) value[index] = visit(value[index]);
    } else for (const key of Object.keys(value)) {
      if (skip.includes(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!('value' in descriptor) || !descriptor.writable) continue;
      const next = visit(descriptor.value);
      if (next !== descriptor.value) value[key] = next;
    }
    return value;
  };
  return visit(root);
}

// Objects reachable through two paths (tests use this to check that only the
// relinked references remain shared).
export function sharedReferences(root, { skip = [] } = {}) {
  const firstPath = new Map(), shared = [];
  const visit = (value, path) => {
    if (value === null || typeof value !== 'object') return;
    if (firstPath.has(value)) { shared.push([firstPath.get(value), path]); return; }
    firstPath.set(value, path);
    if (value instanceof Map) for (const [key, item] of value) visit(item, `${path}<${String(key)}>`);
    else if (value instanceof Set) { let index = 0; for (const item of value) visit(item, `${path}{${index++}}`); }
    else for (const key of Object.keys(value)) {
      if (skip.includes(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if ('value' in descriptor) visit(descriptor.value, `${path}.${key}`);
    }
  };
  visit(root, '$');
  return shared;
}
