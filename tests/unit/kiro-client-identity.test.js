import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildKiroIdentityHeaders } from "../../open-sse/shared/kiroHeaders.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";

afterEach(() => vi.unstubAllGlobals());

describe("Kiro client identity", () => {
  it("uses a stable hashed account identity for inference without exposing credentials", () => {
    const credentials = { accessToken: "access", refreshToken: "refresh", providerSpecificData: { authMethod: "builder-id" } };
    const headers = new KiroExecutor().buildHeaders(credentials);
    const identity = `KiroIDE-1.4.154-${createHash("sha256").update("refresh").digest("hex")}`;
    expect(headers["User-Agent"]).toContain(identity);
    expect(headers["x-amz-user-agent"]).toContain(identity);
    expect(headers.Authorization).toBe("Bearer access");
    expect(headers["User-Agent"]).not.toContain("refresh");
    expect(buildKiroIdentityHeaders({ ...credentials, accessToken: "rotated" })).toEqual(buildKiroIdentityHeaders(credentials));
  });
  it("uses the same identity for API key validation", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ profiles: [{ arn: "arn:aws:codewhisperer:us-east-1:123:profile/test" }] }) });
    vi.stubGlobal("fetch", fetch);
    await new KiroService().validateApiKey("test-key");
    const headers = fetch.mock.calls[0][1].headers;
    expect(headers["User-Agent"]).toBe(buildKiroIdentityHeaders({ apiKey: "test-key" })["User-Agent"]);
    expect(headers.Authorization).toBe("Bearer test-key");
  });
});
