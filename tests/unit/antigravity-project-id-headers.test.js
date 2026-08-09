import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

import {
  getProjectIdForConnection,
  removeConnection,
  stopCacheCleanup,
} from "../../open-sse/services/projectId.js";
import { ANTIGRAVITY_IDE_USER_AGENT } from "../../open-sse/providers/shared.js";
import { LOAD_CODE_ASSIST_HEADERS } from "../../open-sse/config/appConstants.js";

describe("Antigravity project provisioning headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    removeConnection("antigravity-connection");
  });

  afterAll(() => {
    stopCacheCleanup();
  });

  it("uses native IDE headers instead of Google client fingerprints", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({
      cloudaicompanionProject: { id: "antigravity-project" },
    }), { status: 200 }));

    await expect(getProjectIdForConnection(
      "antigravity-connection",
      "access-token",
      { disableEnvProxy: true },
      null,
      "antigravity",
    )).resolves.toBe("antigravity-project");

    expect(mocks.proxyAwareFetch).toHaveBeenCalledOnce();
    const [, options] = mocks.proxyAwareFetch.mock.calls[0];
    expect(options.headers).toMatchObject({
      "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
      Authorization: "Bearer access-token",
    });
    expect(options.headers).not.toHaveProperty("X-Goog-Api-Client");
    expect(options.headers).not.toHaveProperty("Client-Metadata");
  });

  // The whole point of scoping: Antigravity's header fix must not mutate the
  // shared Gemini CLI fingerprint, which still needs the vscode User-Agent.
  it("leaves gemini-cli provisioning on the shared Cloud Code headers", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({
      cloudaicompanionProject: { id: "gemini-project" },
    }), { status: 200 }));

    await expect(getProjectIdForConnection(
      "gemini-connection",
      "access-token",
      { disableEnvProxy: true },
      null,
      "gemini-cli",
    )).resolves.toBe("gemini-project");

    const [, options] = mocks.proxyAwareFetch.mock.calls[0];
    expect(options.headers["User-Agent"]).toBe(LOAD_CODE_ASSIST_HEADERS["User-Agent"]);
    expect(options.headers["User-Agent"]).not.toBe(ANTIGRAVITY_IDE_USER_AGENT);
    removeConnection("gemini-connection");
  });
});
