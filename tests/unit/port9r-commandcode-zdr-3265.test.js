/**
 * Upstream 9router PR #3265: per-connection Zero Data Retention (ZDR) toggle for
 * Command Code. A connection stored with providerSpecificData.zdrEnabled === true
 * sends `x-cmd-zdr: 1` on chat and on the key-validation probe; anything else
 * must not send the header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/models", () => ({ getProviderNodeById: vi.fn() }));

import { CommandCodeExecutor } from "../../open-sse/executors/commandcode.js";
import { POST } from "../../src/app/api/providers/validate/route.js";
import { sanitizeProviderConnectionForClient } from "../../src/lib/providers/sanitizeProviderConnectionForClient.js";

const originalFetch = global.fetch;

function validateRequest(body) {
  return new Request("http://localhost/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("CommandCodeExecutor.buildHeaders ZDR", () => {
  for (const provider of ["commandcode", "command-code"]) {
    it(`sends x-cmd-zdr: 1 only when ${provider} connection opted in`, () => {
      const ex = new CommandCodeExecutor(provider);
      expect(ex.buildHeaders({ apiKey: "user_k", providerSpecificData: { zdrEnabled: true } })["x-cmd-zdr"]).toBe("1");
      expect(ex.buildHeaders({ apiKey: "user_k", providerSpecificData: { zdrEnabled: false } })["x-cmd-zdr"]).toBeUndefined();
      expect(ex.buildHeaders({ apiKey: "user_k", providerSpecificData: { zdrEnabled: "true" } })["x-cmd-zdr"]).toBeUndefined();
      expect(ex.buildHeaders({ apiKey: "user_k" })["x-cmd-zdr"]).toBeUndefined();
    });
  }
});

describe("POST /api/providers/validate Command Code ZDR", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { global.fetch = originalFetch; });

  it("forwards x-cmd-zdr on the probe when the form opted in", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await POST(validateRequest({ provider: "commandcode", apiKey: "user_k", providerSpecificData: { zdrEnabled: true } }));
    expect(global.fetch.mock.calls[0][1].headers["x-cmd-zdr"]).toBe("1");
  });

  it("omits x-cmd-zdr on the probe by default", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });
    await POST(validateRequest({ provider: "commandcode", apiKey: "user_k" }));
    expect(global.fetch.mock.calls[0][1].headers["x-cmd-zdr"]).toBeUndefined();
  });
});

describe("sanitizeProviderConnectionForClient ZDR", () => {
  it("exposes zdrEnabled so the edit modal can show the saved choice", () => {
    const safe = sanitizeProviderConnectionForClient({
      id: "c1", provider: "commandcode", apiKey: "secret",
      providerSpecificData: { zdrEnabled: true },
    });
    expect(safe.providerSpecificData.zdrEnabled).toBe(true);
    expect(safe.apiKey).toBeUndefined();
  });
});
