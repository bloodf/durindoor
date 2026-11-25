// Every upstream call is a local mock; no provider is contacted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch,
}));

import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

const sttConfig = {
  baseUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
  authType: "apikey",
  authHeader: "bearer",
  format: "openai",
};

async function sentForm(fields) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([0, 1, 2])], "audio.wav", { type: "audio/wav" }));
  for (const [name, value] of fields) form.append(name, value);
  const result = await handleSttCore({
    provider: "groq",
    model: "whisper-large-v3",
    formData: form,
    credentials: { apiKey: "test-key" },
    sttConfig,
  });
  expect(result.success).toBe(true);
  return proxyAwareFetch.mock.calls[0][1].body;
}

describe("9router#5840 STT timestamp_granularities forwarding", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("live network is not allowed"); }));
    proxyAwareFetch.mockReset().mockImplementation(async () => new Response(JSON.stringify({ text: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("merges both spellings into deduplicated timestamp_granularities[] parts", async () => {
    const body = await sentForm([
      ["response_format", "verbose_json"],
      ["timestamp_granularities[]", "word"],
      ["timestamp_granularities", "Segment, word"],
    ]);
    expect(body.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
    expect(body.has("timestamp_granularities")).toBe(false);
  });

  it("drops values other than word and segment", async () => {
    const body = await sentForm([
      ["response_format", "verbose_json"],
      ["timestamp_granularities[]", "sentence"],
      ["timestamp_granularities[]", "segment"],
    ]);
    expect(body.getAll("timestamp_granularities[]")).toEqual(["segment"]);
  });

  it.each([[[]], [[["response_format", "json"]]]])("omits granularities unless verbose_json is requested", async (format) => {
    const body = await sentForm([...format, ["timestamp_granularities[]", "word"], ["language", "en"]]);
    expect(body.has("timestamp_granularities[]")).toBe(false);
    expect(body.has("timestamp_granularities")).toBe(false);
    expect(body.get("language")).toBe("en");
  });

  it("keeps forwarding unrelated repeated fields", async () => {
    const body = await sentForm([["include[]", "logprobs"], ["include[]", "other"]]);
    expect(body.getAll("include[]")).toEqual(["logprobs", "other"]);
  });
});
