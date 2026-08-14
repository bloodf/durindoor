import { describe, expect, it } from "vitest";

import {
  applyCodexClientIdentityHeaders,
  applyCodexClientMetadata,
  createCodexClientIdentity,
  getCodexFingerprintMode,
  resolveCodexFingerprintIdentity,
  withCodexFingerprintCredentials,
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

  it("removes transient request identity from cloned credentials", () => {
    const credentials = {
      accessToken: "token",
      connectionId: "connection-a",
      providerSpecificData: {
        codexFingerprintMode: "session",
        codexClientIdentity: { sessionId: "stale" },
        codexOriginalIdentityHeaders: { "session-id": "stale" },
      },
    };

    const requestCredentials = withCodexFingerprintCredentials(credentials, {
      "session-id": "caller-session",
      "x-codex-installation-id": "caller-installation",
    });

    expect(requestCredentials.providerSpecificData.codexClientIdentity.sessionId).not.toBe("stale");
    expect(requestCredentials.providerSpecificData.codexOriginalIdentityHeaders).toBeUndefined();
  });

  it("scrubs persisted transient identity for off and compact requests", () => {
    const credentials = {
      accessToken: "token",
      providerSpecificData: {
        codexFingerprintMode: "off",
        codexClientIdentity: { sessionId: "stale" },
        codexOriginalIdentityHeaders: { "session-id": "stale" },
      },
    };

    expect(withCodexFingerprintCredentials(credentials, {}, "/compact").providerSpecificData).toEqual({
      codexFingerprintMode: "off",
    });
    expect(withCodexFingerprintCredentials(credentials, {}).providerSpecificData).toEqual({
      codexFingerprintMode: "off",
    });
  });

  it("replaces session identity carriers while preserving device metadata merge", () => {
    const identity = createCodexClientIdentity("client", { workspaceId: "workspace" });
    const headers = {
      "session-id": "caller",
      "x-codex-turn-metadata": JSON.stringify({ caller: true }),
    };
    applyCodexClientIdentityHeaders(headers, identity);
    expect(headers["session-id"]).toBe(identity.sessionId);
    expect(JSON.parse(headers["x-codex-turn-metadata"])).toMatchObject({
      installation_id: identity.installationId,
      session_id: identity.sessionId,
    });

    const device = { ...identity, mode: "device" };
    const body = { client_metadata: { "x-codex-turn-metadata": JSON.stringify({ caller: true }) } };
    applyCodexClientMetadata(body, device);
    expect(JSON.parse(body.client_metadata["x-codex-turn-metadata"])).toEqual({
      caller: true,
      installation_id: identity.installationId,
    });
    expect(body.client_metadata["x-codex-installation-id"]).toBe(identity.installationId);
  });
});
