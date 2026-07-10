import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards decolua/9router#2320 (issue #2287):
 * google-tts returned 502 for input text >~200 chars because the Translate
 * batchexecute RPC returns null audio for long text, and the old line-index
 * parser crashed on it.
 *
 * This is an adapter integration test against the real `synthesize()`:
 * fetch is mocked to (1) serve token HTML, then (2) one batchexecute response
 * per chunk carrying a distinct >50-char base64 payload. We assert:
 *   - long input produces multiple segmented batchexecute requests,
 *   - each segment payload sent in `f.req` is ≤ MAX_CHUNK chars,
 *   - the returned audio is the byte-concatenation of every segment's bytes
 *     (MP3 frames are self-delimiting; concatenation is the merge strategy).
 */

// googleTts is imported dynamically per test so its module-level token cache
// does not leak state between tests (a cached token would skip the token-scrape
// fetch and desync the queued mock responses).
let googleTts;

const MAX_CHUNK = 190;
const RPC_URL_MARK = "TranslateWebserverUi/data/batchexecute";

/** Token-scrape HTML containing the f.sid + bl the parser looks for. */
const TOKEN_HTML = `<html><script>"FdrFJe":"TEST_SID"</script><script>"cfb2h":"TEST_BL"</script></html>`;

/**
 * Build a batchexecute response body whose rpcId line carries the given
 * base64 audio payload (mirrors the format extractBase64 scans for).
 */
function makeBatchResponse(base64) {
  const innerJson = JSON.stringify([base64]);
  const entry = [["wrb.fr", "jQ1olc", innerJson, null, null, null, "generic"]];
  return `)]}'\n\n128\n${JSON.stringify(entry)}\n12\n[["di",88]\n]\n`;
}

/** Distinct, decodable, >50-char base64 payload. */
function audioBytes(seed) {
  return Buffer.from(`MP3FRAME-${seed}`.repeat(6)).toString("base64"); // ~80 chars
}

/** Decode the text segment embedded in a batchexecute `f.req` form body. */
function decodeChunkFromReq(bodyStr) {
  const params = new URLSearchParams(bodyStr);
  const freq = JSON.parse(params.get("f.req"));
  const rpcArgs = JSON.parse(freq[0][0][1]);
  return rpcArgs[0];
}

describe("googleTts.synthesize — long-text chunking", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    googleTts = (await import("../../open-sse/handlers/ttsProviders/googleTts.js")).default;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("long text is segmented across multiple requests and bytes are concatenated", async () => {
    const seg1 = audioBytes("one");
    const seg2 = audioBytes("two");
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(TOKEN_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response(makeBatchResponse(seg1), { status: 200 }))
      .mockResolvedValueOnce(new Response(makeBatchResponse(seg2), { status: 200 }));

    // Two sentences, each padded so the combined text forces a split.
    const text = ("A".repeat(160) + ". ") + ("B".repeat(80) + ".");
    expect(text.length).toBeGreaterThan(MAX_CHUNK);

    const out = await googleTts.synthesize(text, "en");

    const rpcCalls = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes(RPC_URL_MARK));
    expect(rpcCalls.length).toBeGreaterThanOrEqual(2);

    // Every segment sent upstream is ≤ MAX_CHUNK chars.
    for (const [, init] of rpcCalls) {
      const chunk = decodeChunkFromReq(init.body.toString());
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK);
    }

    // Returned audio equals concatenation of segment bytes in order.
    const expected = Buffer.concat([Buffer.from(seg1, "base64"), Buffer.from(seg2, "base64")]);
    expect(Buffer.from(out.base64, "base64").equals(expected)).toBe(true);
  });
});
