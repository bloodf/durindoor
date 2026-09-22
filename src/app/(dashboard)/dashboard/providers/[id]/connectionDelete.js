/**
 * Delete provider connections through DELETE /api/providers/[id] and report
 * what actually happened. The route answers 409 with a readable message when
 * the account is the last scoped one of an API key, and 500 on a storage
 * failure; callers must show that message and keep the row, otherwise a
 * refused delete looks like a delete that silently does nothing.
 */
export async function deleteConnection(id, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`/api/providers/${id}`, { method: "DELETE" });
    if (res.ok) return { id, ok: true, error: null };
    const data = await res.json().catch(() => ({}));
    return { id, ok: false, error: data?.error || `Delete failed (HTTP ${res.status})` };
  } catch (error) {
    return { id, ok: false, error: error?.message || "Delete failed" };
  }
}

/** Delete each id in turn; returns the ids that were deleted and the failures. */
export async function deleteConnections(ids, fetchImpl = fetch) {
  const deletedIds = [];
  const failures = [];
  for (const id of ids) {
    const result = await deleteConnection(id, fetchImpl);
    if (result.ok) deletedIds.push(id);
    else failures.push(result);
  }
  return { deletedIds, failures };
}

/** One-line bulk summary naming how many failed and the distinct reasons. */
export function bulkDeleteFailureMessage({ deletedIds, failures }) {
  const reasons = [...new Set(failures.map((failure) => failure.error))].join("; ");
  return `Deleted ${deletedIds.length} connection(s), ${failures.length} failed: ${reasons}`;
}
