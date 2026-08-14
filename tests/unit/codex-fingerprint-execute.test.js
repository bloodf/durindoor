import { describe, expect, it } from "vitest";

import {
  applyCodexClientIdentityHeaders,
  applyCodexClientMetadata,
  applyCodexOriginalIdentityHeaders,
  resolveCodexOriginalIdentityHeaders,
  withCodexFingerprintCredentials,
} from "../../open-sse/config/codexIdentity.js";

const baseProviderSpecific = (mode) => ({
  workspaceId: "workspace-a",
  codexFingerprintMode: mode,
});

const oauthCredentials = (mode) => ({
  connectionId: "connection-a",
  accessToken: "oauth-access",
  idToken: "id-token",
  providerSpecificData: baseProviderSpecific(mode),
});

describe("Codex executor request fingerprint carriers", () => {
  it("preserves caller-provided identity when mode is off", () => {
    const credentials = oauthCredentials("off");
    const clientHeaders = {
      "session-id": "caller-session",
      "session_id": "caller-session",
      "thread-id": "caller-thread",
      "x-client-request-id": "caller-req",
      "x-codex-installation-id": "caller-installation",
      "x-codex-window-id": "caller-window",
      "x-codex-turn-metadata": "caller-meta",
    };
    const wrapped = withCodexFingerprintCredentials(credentials, clientHeaders, null);
    const original = resolveCodexOriginalIdentityHeaders({
      credentials: wrapped,
      clientHeaders,
    });
    expect(wrapped.providerSpecificData.codexClientIdentity).toBeUndefined();
    expect(original).toMatchObject({
      "session-id": "caller-session",
      "session_id": "caller-session",
      "thread-id": "caller-thread",
      "x-client-request-id": "caller-req",
      "x-codex-installation-id": "caller-installation",
      "x-codex-window-id": "caller-window",
      "x-codex-turn-metadata": "caller-meta",
    });

    const headers = {};
    applyCodexOriginalIdentityHeaders(headers, original);
    expect(headers).toEqual(original);
  });

  it("synthesizes a device-only identity when mode is device", () => {
    const wrapped = withCodexFingerprintCredentials(oauthCredentials("device"), {}, null);
    const identity = wrapped.providerSpecificData.codexClientIdentity;
    expect(identity).toMatchObject({ mode: "device" });
    expect(identity.installationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(identity.sessionId).toBeUndefined();

    const headers = {};
    applyCodexClientIdentityHeaders(headers, identity);
    expect(headers["x-codex-installation-id"]).toBe(identity.installationId);
    expect(headers["session-id"]).toBeUndefined();
    expect(headers["session_id"]).toBeUndefined();

    const body = { input: "hi" };
    applyCodexClientMetadata(body, identity);
    expect(body.client_metadata["x-codex-installation-id"]).toBe(identity.installationId);
    expect(body.client_metadata.session_id).toBeUndefined();
  });

  it("synthesizes a full session carrier for session mode", () => {
    const wrapped = withCodexFingerprintCredentials(oauthCredentials("session"), {}, null);
    const identity = wrapped.providerSpecificData.codexClientIdentity;
    expect(identity.mode).toBe("session");
    expect(identity.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(identity.threadId).toBe(identity.sessionId);

    const headers = {};
    applyCodexClientIdentityHeaders(headers, identity);
    expect(headers["session-id"]).toBe(identity.sessionId);
    expect(headers["session_id"]).toBe(identity.sessionId);
    expect(headers["thread-id"]).toBe(identity.sessionId);
    expect(headers["x-client-request-id"]).toBe(identity.sessionId);
    expect(headers["x-codex-window-id"]).toBe(identity.windowId);
    const meta = JSON.parse(headers["x-codex-turn-metadata"]);
    expect(meta.installation_id).toBe(identity.installationId);
    expect(meta.session_id).toBe(identity.sessionId);
    expect(meta.thread_id).toBe(identity.sessionId);
    expect(meta.turn_id).toBe(identity.turnId);
    expect(typeof meta.turn_started_at_unix_ms).toBe("number");

    const body = { input: "hi" };
    applyCodexClientMetadata(body, identity);
    expect(body.client_metadata.session_id).toBe(identity.sessionId);
    expect(body.client_metadata.thread_id).toBe(identity.sessionId);
    expect(body.client_metadata.turn_id).toBe(identity.turnId);
    expect(body.client_metadata["x-codex-window-id"]).toBe(identity.windowId);
  });

  it("synthesizes a distinct thread for full mode", () => {
    const wrapped = withCodexFingerprintCredentials(oauthCredentials("full"), {}, null);
    const identity = wrapped.providerSpecificData.codexClientIdentity;
    expect(identity.mode).toBe("full");
    expect(identity.sessionId).not.toBe(identity.threadId);

    const headers = {};
    applyCodexClientIdentityHeaders(headers, identity);
    expect(headers["thread-id"]).toBe(identity.threadId);
    expect(headers["x-client-request-id"]).toBe(identity.threadId);
  });

  it("skips fingerprinting on the compact endpoint even for OAuth credentials", () => {
    const wrapped = withCodexFingerprintCredentials(oauthCredentials("session"), {}, "/compact");
    expect(wrapped).toMatchObject({
      connectionId: "connection-a",
      providerSpecificData: baseProviderSpecific("session"),
    });
  });
});
