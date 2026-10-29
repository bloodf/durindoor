/** Decode provider chunks as they arrive. Partial content stays with the caller
 * on transport failure or cancellation; cancellation also releases the reader. */
export async function readProviderStream(response, { signal, onChunk }) {
  if (!response.ok) throw new Error(`Provider request failed (${response.status})`);
  if (!response.body) throw new Error("Provider returned no response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      content += decoder.decode(value, { stream: true });
      onChunk(content);
    }
    content += decoder.decode();
    onChunk(content);
    return content;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
