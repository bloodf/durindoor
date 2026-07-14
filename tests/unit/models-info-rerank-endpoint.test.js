import { describe, expect, it } from "vitest";

// PR #139 review (Codex): /v1/models/rerank advertises openrouter/cohere/rerank-*
// but GET /v1/models/info built endpoint metadata from KIND_ENDPOINT which had
// no `rerank` entry, so the info response returned endpoint: null and clients
// could not route the newly-discoverable rerank models. Pin the endpoint.
describe("GET /v1/models/info rerank endpoint metadata", () => {
  it("returns endpoint /v1/rerank for a rerank model", async () => {
    const { GET } = await import("../../src/app/api/v1/models/info/route.js");
    const res = await GET(
      new Request("http://local.test/v1/models/info?id=openrouter/cohere/rerank-4-pro"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("rerank");
    expect(body.endpoint).toBe("/v1/rerank");
  });
});
