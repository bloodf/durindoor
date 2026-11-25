// Bounded wait for live provider catalogs (decolua/9router#5100). Resolvers are
// capped only by their own timeouts (up to 30s), so one slow account stalled
// every /v1/models request. A request now waits a short while; a slower lookup
// keeps running in the background and serves later requests.
import { createHash } from "node:crypto";

export const LIVE_CATALOG_WAIT_MS = 3000;
// A lookup that never settles must not block retries for ever.
const FLIGHT_MAX_AGE_MS = 60_000;
const MAX_REMEMBERED = 256;

const lastGood = new Map();
const flights = new Map();
let nextGeneration = 0;

function remember(key, value) {
  lastGood.delete(key);
  if (!value) return;
  if (lastGood.size >= MAX_REMEMBERED) lastGood.delete(lastGood.keys().next().value);
  lastGood.set(key, value);
}

function startFlight(key, load) {
  const flight = { startedAt: Date.now(), generation: ++nextGeneration, promise: null };
  flight.promise = Promise.resolve().then(load).then(
    (value) => {
      // Only the latest flight may update cached data, even after it expires.
      if (flights.get(key)?.generation === flight.generation) remember(key, value);
      return value;
    },
    (error) => {
      if (flights.get(key)?.generation === flight.generation) lastGood.delete(key);
      throw error;
    }
  ).finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  // The failure belongs to whoever is still waiting; a late one has no waiter.
  flight.promise.catch(() => {});
  flights.set(key, flight);
  return flight;
}

/**
 * Run a catalog lookup, waiting at most `waitMs` for it.
 *
 * `identity` must cover everything that decides what the lookup may return
 * (connection, credentials, endpoint, guard), so private catalogs never cross
 * accounts. A settled lookup answers as before. While it is still running the
 * caller gets the last good catalog for the same identity, or null.
 *
 * @template T
 * @param {unknown[]} identity
 * @param {() => Promise<T>} load
 * @param {number} [waitMs]
 * @returns {Promise<T|null>}
 */
export async function withCatalogDeadline(identity, load, waitMs = LIVE_CATALOG_WAIT_MS) {
  const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  const running = flights.get(key);
  if (running && Date.now() - running.startedAt < FLIGHT_MAX_AGE_MS) {
    // Already waited on once: do not make this request wait again for stale-safe data.
    if (lastGood.has(key)) return lastGood.get(key);
    return raceDeadline(running.promise, key, waitMs);
  }
  return raceDeadline(startFlight(key, load).promise, key, waitMs);
}

async function raceDeadline(promise, key, waitMs) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(lastGood.get(key) ?? null), waitMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
