// The "Check" probe must test the same base URL that saving the node stores,
// so both use normalizeNodeBaseUrl (#2314).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) },
}));

import { POST } from "../../src/app/api/provider-nodes/validate/route.js";
import { validateProviderNode } from "../../src/lib/providerNodes/validateNode.js";

const BASE = "https://node.example.test/v1";
let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const probe = (body) => POST(new Request("http://localhost/api/provider-nodes/validate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ apiKey: "synthetic", modelId: "m", ...body }),
}));

describe("provider-node probe base URL", () => {
  it.each([
    ["custom-embedding", `${BASE}/embeddings`, `${BASE}/embeddings`],
    ["custom-embedding", `  ${BASE}/embeddings/  `, `${BASE}/embeddings`],
    ["anthropic-compatible", ` ${BASE}/messages/ `, `${BASE}/models`],
    ["openai-compatible", `  ${BASE}/  `, `${BASE}/models`],
    ["systemone-compatible", ` ${BASE}/ `, `${BASE}/models`],
  ])("%s probes the saved form of %j", async (type, baseUrl, expected) => {
    const saved = validateProviderNode({ baseUrl }, { type }).value.baseUrl;

    const response = await probe({ type, baseUrl });

    expect((await response.json()).valid).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(expected);
    expect(expected.startsWith(saved.replace(/\/$/, ""))).toBe(true);
  });

  it("falls back to chat on the same base URL", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 404 }));

    await probe({ type: "openai-compatible", baseUrl: ` ${BASE}/ ` });

    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/chat/completions`);
  });

  it("rejects a non-string base URL without probing", async () => {
    const response = await probe({ type: "openai-compatible", baseUrl: [BASE] });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
