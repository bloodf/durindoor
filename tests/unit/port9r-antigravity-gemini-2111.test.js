import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { convertGeminiToInternal } from "../../src/app/api/v1beta/models/[...path]/geminiBridge.js";

const require = createRequire(import.meta.url);
const { intercept } = require("../../src/mitm/handlers/antigravity.js");

function response() {
  return { status: 0, headersSent: false, data: "", writeHead(status) { this.status = status; this.headersSent = true; }, write(chunk) { this.data += chunk; }, end(chunk = "") { this.data += chunk; }, destroy(error) { this.error = error; } };
}

describe("mapped Antigravity Gemini routing", () => {
  it("sends the mapped request and wraps Gemini stream frames", async () => {
    const original = global.fetch;
    global.fetch = vi.fn(async () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}\n\n', { headers: { "content-type": "text/event-stream" } }));
    try {
      const res = response();
      await intercept({ url: "/v1internal:streamGenerateContent", headers: {} }, res, Buffer.from(JSON.stringify({ model: "old", request: { contents: [], generationConfig: { thinkingConfig: { thinkingBudget: 5 } } } })), { model: "provider/new", reasoningEffort: "high" });
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain("/v1beta/models/provider/new:streamGenerateContent?alt=sse");
      expect(JSON.parse(options.body)).toEqual({ contents: [], generationConfig: {}, reasoning_effort: "high" });
      expect(JSON.parse(res.data.slice(6))).toEqual({ response: { candidates: [{ content: { parts: [{ text: "hello" }] } }] } });
      expect(convertGeminiToInternal(JSON.parse(options.body), "provider/new", true).reasoning_effort).toBe("high");
    } finally { global.fetch = original; }
  });
  it("preserves gateway errors", async () => {
    const original = global.fetch;
    global.fetch = vi.fn(async () => new Response('{"error":"denied"}', { status: 403 }));
    try {
      const res = response();
      await intercept({ url: "/v1internal:generateContent", headers: {} }, res, Buffer.from('{"model":"old","request":{"contents":[]}}'), { model: "new" });
      expect(res.status).toBe(403);
      expect(res.data).toBe('{"error":"denied"}');
    } finally { global.fetch = original; }
  });
});
