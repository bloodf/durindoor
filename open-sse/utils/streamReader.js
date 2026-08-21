/** Release a stream reader without failing when its lock is already gone. */
export function releaseReader(reader) {
  try { reader.releaseLock(); } catch { /* already released */ }
}

/**
 * Cancel and release a stream reader without trusting provider-controlled
 * cancellation latency. Moved from the Codex executor for upstream PR #3405.
 */
export async function cancelAndReleaseReader(reader, reason) {
  let timer = null;
  try {
    const cancellation = Promise.resolve(reader.cancel(reason)).catch(() => {});
    await Promise.race([
      cancellation,
      new Promise((resolve) => { timer = setTimeout(resolve, 250); }),
    ]);
  } catch { /* cancellation is best-effort */ }
  finally {
    clearTimeout(timer);
    releaseReader(reader);
  }
}
