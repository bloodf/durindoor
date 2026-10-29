/** Reject unknown HTTP/JSON state instead of painting it as a saved or empty value. */
export async function requestJSON(url, options, request = fetch) {
  const response = await request(url, options);
  let body;
  try { body = await response.json(); } catch {
    throw new Error(response.ok ? "The server returned an unreadable response. Retry." : `Request failed (${response.status}). Retry.`);
  }
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status}). Retry.`);
  return body;
}

export async function requestCollection(url, field, request = fetch) {
  const body = await requestJSON(url, { cache: "no-store" }, request);
  if (!Array.isArray(body?.[field])) throw new Error(`The ${field} response is incomplete. Retry.`);
  return body[field];
}

/** Confirm each account separately. Failed accounts retain their last confirmed state. */
export async function updateProviderConnections(connections, active, request = fetch) {
  const results = await Promise.allSettled(connections.map(async (connection) => {
    const response = await request(`/api/providers/${connection.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: active }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${response.status})`);
    }
    return connection.id;
  }));
  return {
    accepted: results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    failed: connections.filter((_, index) => results[index].status === "rejected"),
  };
}

/** Queue settings patches against the latest confirmed map; a rejected write never poisons later saves. */
export function createSettingsQueue(initial, save) {
  let current = initial;
  let tail = Promise.resolve();
  return {
    replace(value) { current = value; },
    update(change) {
      const task = tail.then(async () => {
        const next = change(current);
        await save(next);
        current = next;
        return next;
      });
      tail = task.catch(() => {});
      return task;
    },
  };
}
