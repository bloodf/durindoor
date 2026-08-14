import { describe, expect, it } from "vitest";

import {
  createCodexClientIdentity,
  getCodexFingerprintMode,
  resolveCodexFingerprintIdentity,
} from "../../open-sse/config/codexIdentity.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

describe("Codex OAuth fingerprint identity", () => {
  it("defaults OAuth accounts to a stable session identity", () => {
    const credentials = {
      connectionId: "connection-a",
      accessToken: "access-token",
      providerSpecificData: { workspaceId: "workspace-a" },
    };
    const first = resolveCodexFingerprintIdentity({
      credentials,
      clientHeaders: { "session-id": "client-session" },
    });
    const second = resolveCodexFingerprintIdentity({
      credentials,
      clientHeaders: { "session-id": "client-session" },
    });

    expect(getCodexFingerprintMode(credentials.providerSpecificData)).toBe("session");
    expect(first).toMatchObject({ mode: "session", installationId: expect.any(String) });
    expect(first.installationId).toBe(second.installationId);
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.threadId).toBe(second.threadId);
    expect(first.turnId).not.toBe(second.turnId);
  });

  it("keeps non-OAuth credentials and compact requests unmodified", () => {
    expect(createCodexClientIdentity("client", {}, { isOAuth: false })).toBeNull();
    expect(resolveCodexFingerprintIdentity({
      credentials: { accessToken: "token", requestEndpointPath: "/compact" },
    })).toBeNull();
  });

  it("writes resolved identity into Codex outbound headers and request metadata", () => {
    const identity = createCodexClientIdentity("client-session", { workspaceId: "workspace-a" });
    const executor = new CodexExecutor();
    const credentials = {
      connectionId: "connection-a",
      providerSpecificData: { codexClientIdentity: identity },
    };
    const headers = executor.buildHeaders(credentials);
    const body = executor.transformRequest("gpt-5-codex", { input: "hello" }, true, credentials);

    expect(headers["x-codex-installation-id"]).toBe(identity.installationId);
    expect(headers["session-id"]).toBe(identity.sessionId);
    expect(body.client_metadata).toMatchObject({
      "x-codex-installation-id": identity.installationId,
      session_id: identity.sessionId,
      thread_id: identity.threadId,
    });
  });
});
