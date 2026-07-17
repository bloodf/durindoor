/**
 * Unit tests for the CommandCode validation dispatch in
 * /api/providers/validate (src/app/api/providers/validate/route.js).
 *
 * Regression coverage for: users adding a "command-code" or "cmd" connection
 * previously fell through to the generic `default` case (which requires
 * `format: "openai"`) and got "Provider validation not supported", instead
 * of hitting the existing CommandCode probe used by "commandcode".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/models", () => ({
  getProviderNodeById: vi.fn(),
}));

import { POST } from "../../src/app/api/providers/validate/route.js";
import { normalizeProviderId } from "../../src/lib/providerNormalization.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

const originalFetch = global.fetch;

function postRequest(body) {
  return new Request("http://localhost/api/providers/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("providerNormalization: command-code alias", () => {
  it("resolves the 'cmd' alias to the 'command-code' provider id", () => {
    expect(normalizeProviderId("cmd")).toBe("command-code");
  });

  it("leaves 'command-code' and 'commandcode' ids untouched", () => {
    expect(normalizeProviderId("command-code")).toBe("command-code");
    expect(normalizeProviderId("commandcode")).toBe("commandcode");
  });
});

describe("POST /api/providers/validate - CommandCode dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("validates 'command-code' via the CommandCode probe, not the generic fallback", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });

    const res = await POST(postRequest({ provider: "command-code", apiKey: "user_test" }));
    const data = await res.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.commandcode.ai/alpha/generate",
      expect.objectContaining({ method: "POST" })
    );
    const [, callOpts] = global.fetch.mock.calls[0];
    const payload = JSON.parse(callOpts.body);
    expect(payload.params.model).toBe(PROVIDERS["command-code"].validationModelId);
    expect(payload.params.model).toBe("deepseek/deepseek-v4-flash");
    expect(data).toEqual({ valid: true, error: null });
  });

  it("validates the 'cmd' alias by normalizing to 'command-code' first", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });

    const res = await POST(postRequest({ provider: "cmd", apiKey: "user_test" }));
    const data = await res.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.commandcode.ai/alpha/generate",
      expect.objectContaining({ method: "POST" })
    );
    const [, callOpts] = global.fetch.mock.calls[0];
    const payload = JSON.parse(callOpts.body);
    expect(payload.params.model).toBe(PROVIDERS["command-code"].validationModelId);
    expect(data).toEqual({ valid: true, error: null });
  });
  it("reports invalid on 401/403 for 'command-code' (not 'not supported')", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 401 });

    const res = await POST(postRequest({ provider: "command-code", apiKey: "bad-key" }));
    const data = await res.json();

    expect(data.valid).toBe(false);
    expect(data.error).not.toMatch(/not supported/i);
  });

  it.each([400, 422, 429])(
    "accepts %d as proof that Command Code authenticated and parsed the probe",
    async (status) => {
      global.fetch = vi.fn().mockResolvedValue({ status });
      const data = await (await POST(postRequest({
        provider: "command-code",
        apiKey: "user_test",
      }))).json();
      expect(data).toEqual({ valid: true, error: null });
    },
  );

  it.each([404, 405, 500])(
    "does not mark an unusable Command Code endpoint response %d as valid",
    async (status) => {
      global.fetch = vi.fn().mockResolvedValue({ status });
      const data = await (await POST(postRequest({
        provider: "command-code",
        apiKey: "user_test",
      }))).json();
      expect(data.valid).toBe(false);
    },
  );

  it("still validates the original 'commandcode' id (no regression)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 });

    const res = await POST(postRequest({ provider: "commandcode", apiKey: "user_test" }));
    const data = await res.json();

    const [, callOpts] = global.fetch.mock.calls[0];
    expect(JSON.parse(callOpts.body).params.model).toBe(PROVIDERS.commandcode.validationModelId);
    expect(data).toEqual({ valid: true, error: null });
  });
});
