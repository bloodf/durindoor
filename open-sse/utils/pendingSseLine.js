// Match the upstream 64 MiB limit while allowing large inline media events.
export const MAX_PENDING_SSE_LINE_BYTES = 64 * 1024 * 1024;

/** Count every line in raw bytes before decoding or retaining the chunk. */
export function advancePendingSseLineBytes(pending, chunk) {
  let start = 0;
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] !== 10) continue;
    if (pending + i - start > MAX_PENDING_SSE_LINE_BYTES) return null;
    pending = 0;
    start = i + 1;
  }
  pending += chunk.length - start;
  return pending > MAX_PENDING_SSE_LINE_BYTES ? null : pending;
}
