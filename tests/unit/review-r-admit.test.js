import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSettings, resolveClientApiKey } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  resolveClientApiKey: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings }));
vi.mock("@/sse/services/auth.js", () => ({ resolveClientApiKey }));
vi.mock("open-sse/services/operationalMetrics.js", () => ({
  annotateClientAdmissionFailure: (response, reason) => {
    response.headers.set("x-admission-failure", reason);
    return response;
  },
}));

import { admit } from "@/sse/services/admission.js";

describe("shared client admission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSettings.mockResolvedValue({ requireApiKey: true });
  });

  it.each([
    [null, { ok: false, reason: "missing" }, 401, "Missing API key", "auth_missing"],
    ["bad", { ok: false, reason: "invalid" }, 401, "Invalid API key", "auth_invalid"],
    ["good", { ok: true, billingEpoch: "epoch" }, null, null, null],
  ])("preserves admission result for %s", async (key, auth, status, message, reason) => {
    resolveClientApiKey.mockResolvedValue({ apiKey: key, auth });
    const result = await admit(new Request("https://example.test/v1/chat/completions"), { kind: "chat" });
    expect(getSettings).toHaveBeenCalledOnce();
    expect(resolveClientApiKey).toHaveBeenCalledWith(expect.any(Request), { required: true });
    expect(result.apiKey).toBe(key);
    if (!status) {
      expect(result.error).toBeNull();
      expect(result.auth).toBe(auth);
      return;
    }
    expect(result.error.status).toBe(status);
    expect((await result.error.json()).error.message).toBe(message);
    expect(result.error.headers.get("x-admission-failure")).toBe(reason);
  });
});
