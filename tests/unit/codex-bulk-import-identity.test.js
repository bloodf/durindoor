import { beforeEach, describe, expect, it, vi } from "vitest";

const createProviderConnection = vi.hoisted(() => vi.fn());

vi.mock("@/models", () => ({ createProviderConnection }));
vi.mock("@/lib/oauth/providers", () => ({ extractCodexAccountInfo: vi.fn(() => null) }));

import { POST } from "../../src/app/api/oauth/codex/bulk-import/route.js";

function request(body) {
  return new Request("http://localhost/api/oauth/codex/bulk-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Codex OAuth bulk import identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createProviderConnection.mockResolvedValue({ id: "codex-1" });
  });

  it("persists fingerprint mode while stripping transient imported identity", async () => {
    const response = await POST(request({
      accessToken: "token",
      providerSpecificData: {
        codexFingerprintMode: "full",
        codexClientIdentity: { sessionId: "caller-session" },
        codexOriginalIdentityHeaders: { "session-id": "caller-session" },
      },
    }));

    expect(response.status).toBe(200);
    expect(createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerSpecificData: { codexFingerprintMode: "full" },
    }));
  });
});
