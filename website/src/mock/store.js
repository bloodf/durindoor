// In-memory collections seeded from fixtures and mirrored to localStorage so
// edits made in the demo survive reloads. Values are always replaced, never
// mutated in place.

export const STORAGE_PREFIX = "durindoor-demo:";

const seeds = new Map();
const cache = new Map();

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/** Register a seed factory for a collection. Later definitions win. */
export function define(name, seed) {
  seeds.set(name, seed);
}

export function get(name) {
  if (cache.has(name)) return cache.get(name);
  let value;
  const raw = storage()?.getItem(STORAGE_PREFIX + name);
  if (raw != null) {
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
  }
  if (value === undefined) {
    const seed = seeds.get(name);
    value = clone(typeof seed === "function" ? seed() : seed);
  }
  cache.set(name, value);
  return value;
}

export function set(name, value) {
  cache.set(name, value);
  try {
    storage()?.setItem(STORAGE_PREFIX + name, JSON.stringify(value));
  } catch (error) {
    console.debug("[demo] could not persist", name, error);
  }
  return value;
}

export function update(name, fn) {
  return set(name, fn(get(name)));
}

// Array-of-records helpers keyed by `id`.
export function list(name) {
  return get(name) || [];
}

export function find(name, id) {
  return list(name).find((item) => String(item.id) === String(id)) || null;
}

export function insert(name, item) {
  update(name, (items = []) => [...items, item]);
  return item;
}

export function patch(name, id, changes) {
  let next = null;
  update(name, (items = []) =>
    items.map((item) => {
      if (String(item.id) !== String(id)) return item;
      next = { ...item, ...changes, id: item.id };
      return next;
    }),
  );
  return next;
}

export function remove(name, id) {
  const existing = find(name, id);
  update(name, (items = []) => items.filter((item) => String(item.id) !== String(id)));
  return existing;
}

export function newId(prefix = "demo") {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export function resetDemoData() {
  cache.clear();
  const s = storage();
  if (!s) return;
  const keys = [];
  for (let index = 0; index < s.length; index += 1) {
    const key = s.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => s.removeItem(key));
}

export const store = { define, get, set, update, list, find, insert, patch, remove, newId };
