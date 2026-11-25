/**
 * Port of decolua/9router#2558 — reorder connections by availability.
 *
 * Availability model (upstream parity, plus a DurinDoor `isActive` guard):
 * - `testStatus` "active"/"success" → available.
 * - `testStatus` "unavailable" with no live `modelLock_*` cooldown → treated as
 *   available (the lock already expired; the status is stale until the next
 *   successful request clears it).
 * - `isActive === false` → NEVER available (disabled rows are not routable,
 *   regardless of a stale healthy `testStatus`).
 *
 * The sort is stable within each group (Array.prototype.sort is stable in V8),
 * so relative order inside the available/unavailable partitions is preserved.
 */

/**
 * @param {object[]} connections
 * @returns {object[]} new array, available connections first, stable
 */
export function sortConnectionsByAvailability(connections) {
  const getEffectiveStatus = (conn) => {
    const isCooldown = Object.entries(conn).some(
      ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now()
    );
    return conn.testStatus === "unavailable" && !isCooldown ? "active" : conn.testStatus;
  };

  return [...connections].sort((a, b) => {
    const availableA = a.isActive !== false && ["active", "success"].includes(getEffectiveStatus(a));
    const availableB = b.isActive !== false && ["active", "success"].includes(getEffectiveStatus(b));
    if (availableA && !availableB) return -1;
    if (!availableA && availableB) return 1;
    return 0;
  });
}

/** Last queued order write per provider. */
const orderWrites = new Map();

/**
 * Persist a sorted order atomically via `PUT /api/providers/reorder` — ONE DB
 * transaction updates every priority. Per-connection PUTs were the upstream
 * approach but race under `reorderInTx` normalization (a later write creates a
 * priority tie whose `updatedAt` tie-breaker resurrects the old order), and a
 * partial sequence leaves a corrupted order on failure.
 *
 * Writes for one provider are sent one at a time in call order, so rapid moves
 * cannot land out of order (decolua/9router#4280). A failed write also rejects
 * the moves already queued behind it: they were built on an order the server
 * never accepted, and their callers reload like the first one.
 *
 * @param {string} providerId
 * @param {object[]} sorted connections in desired final order
 * @returns {Promise<void>}
 * @throws {Error} when the server rejects the order (non-2xx)
 */
export function persistConnectionOrder(providerId, sorted) {
  const orderedIds = sorted.map((c) => c.id);
  const write = (orderWrites.get(providerId) ?? Promise.resolve()).then(() => sendOrder(providerId, orderedIds));
  orderWrites.set(providerId, write);
  const release = () => {
    if (orderWrites.get(providerId) === write) orderWrites.delete(providerId);
  };
  write.then(release, release);
  return write;
}

async function sendOrder(providerId, orderedIds) {
  const res = await fetch("/api/providers/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, orderedIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Reorder failed (HTTP ${res.status})`);
}
