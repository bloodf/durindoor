import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findOffendingField } from "../../open-sse/config/providerFieldStrips.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const REJECTION = { object: "error", message: "top_k sampling is not enabled for this model", code: 400 };

describe("OmniRoute #20112: retry without top_k when a 400 rejects it", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline test"); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names top_k from Mistral's 400 and ignores a nested message path", () => {
    expect(findOffendingField(JSON.stringify(REJECTION))).toBe("top_k");
    expect(findOffendingField("messages.0.content.0.top_k: Extra inputs are not permitted")).toBeNull();
  });

  it("drops only top_k and returns the retry's reply", async () => {
    const requests = [];
    const result = await new DefaultExecutor("mistral").execute({
      model: "mistral-large-latest",
      body: { messages: [{ role: "user", content: "hi" }], top_k: 40, top_p: 0.9 },
      stream: false,
      credentials: { apiKey: "test" },
      directFetch: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return requests.length === 1 ? Response.json(REJECTION, { status: 400 }) : Response.json({ ok: true });
      },
    });

    expect(result.response.status).toBe(200);
    expect(requests.map(({ top_k, top_p }) => [top_k, top_p])).toEqual([[40, 0.9], [undefined, 0.9]]);
  });
});
