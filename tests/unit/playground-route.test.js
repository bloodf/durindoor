import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the heavy handler + translator init so the test exercises only the
// route's own contract: Content-Type guard + delegation. The Content-Type
// guard (requireJsonContentType) is left real — it's the behavior we assert.
const mocks = vi.hoisted(() => ({ handleChat: vi.fn() }));
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn().mockResolvedValue(undefined) }));

import { POST, OPTIONS } from "../../src/app/api/v1/chat/completions/route.js";

const { handleChat } = mocks;

function jsonRequest(body, headers = {}) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("/v1/chat/completions route (playground endpoint)", () => {
  beforeEach(() => {
    handleChat.mockReset();
    handleChat.mockResolvedValue(Response.json({ ok: true }));
  });

  it("delegates a valid JSON POST to handleChat", async () => {
    const req = jsonRequest({ model: "p/m", messages: [{ role: "user", content: "hi" }] });
    const res = await POST(req);
    expect(handleChat).toHaveBeenCalledTimes(1);
    expect(handleChat).toHaveBeenCalledWith(req);
    expect(res.status).toBe(200);
  });

  it("rejects non-JSON Content-Type with 415 and does NOT delegate", async () => {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x",
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error?.type ?? body.type).toBe("invalid_request_error");
    expect(handleChat).not.toHaveBeenCalled();
  });

  it("answers OPTIONS with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toMatch(/POST/);
  });
});
