// Fixture teardown for the DB driver's shared handle (globalThis._dbAdapter).
// Call it before deleting `dir`: sql.js writes unsaved pages during close(), so
// the directory must still exist.
import path from "node:path";

/**
 * Closes and resets `state` only when its database file lies inside `dir`.
 * A failed close rejects and leaves `state` unchanged.
 */
export async function closeAdapterWithin(state, dir) {
  // An open still in flight has not published its handle yet. A failed open
  // belongs to whoever requested it, and the driver resets itself.
  if (state && !state.instance && state.initPromise) await state.initPromise.catch(() => {});
  if (!state?.file?.startsWith(dir + path.sep)) return;
  await state.instance?.close?.();
  Object.assign(state, { instance: null, initPromise: null, file: null, cacheKey: null });
}
