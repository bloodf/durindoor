/**
 * Finish every `<img>` under `root` before a story removes it. Gecko cancels an
 * image request when its element leaves the document, and the browser gate
 * counts that as a failed request. Lazy images are made eager so none can still
 * be waiting to start. A failed load also settles; the gate reports it itself.
 * Resolves with the number of images found; rejects if any stays pending.
 */
export async function settleImages(root, { timeoutMs = 10_000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Re-query each pass: late fixture responses can mount more images.
    const images = Array.from(root.querySelectorAll("img"));
    for (const image of images) image.loading = "eager";
    const pending = images.filter((image) => !image.complete);
    if (!pending.length) return images.length;
    if (Date.now() >= deadline) {
      const sources = pending.map((image) => image.getAttribute("src")).join(", ");
      throw new Error(`Images still loading after ${timeoutMs} ms: ${sources}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
