// decolua/9router#3213 (issue #3212) — Codex auto-ping sent a fixed gpt-5.5
// request, which fails outright on an account whose plan does not expose that
// model. getCodexModels reads the account's live catalog so the ping can pick a
// model the account can actually call.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

const { getCodexModels } = await import("../../open-sse/services/usage/codex.js");

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// Each case installs its own implementation. A leftover queued promise from a
// previous case would otherwise surface as an unhandled rejection when a later
// case swaps in a throwing transport.
const respondWith = (impl) => mocks.proxyAwareFetch.mockImplementation(impl);

describe("getCodexModels", () => {
  beforeEach(() => mocks.proxyAwareFetch.mockReset());

  it("returns supported models ordered by catalog priority", async () => {
    respondWith(async () => jsonResponse({
      models: [
        { slug: "gpt-5.4", priority: 20 },
        { slug: "gpt-5.6-sol", priority: 5 },
        { slug: "gpt-5.5", priority: 10 },
      ],
    }));

    const models = await getCodexModels("token", null, {});

    expect(models.map((m) => m.slug)).toEqual(["gpt-5.6-sol", "gpt-5.5", "gpt-5.4"]);
  });

  it("drops models the API cannot serve and entries without a slug", async () => {
    respondWith(async () => jsonResponse({
      models: [
        { slug: "gpt-5.5", priority: 1 },
        { slug: "internal-only", priority: 2, supported_in_api: false },
        { priority: 3 },
        { slug: "", priority: 4 },
      ],
    }));

    const models = await getCodexModels("token", null, {});

    expect(models.map((m) => m.slug)).toEqual(["gpt-5.5"]);
  });

  it("sends the account binding and client version", async () => {
    respondWith(async () => jsonResponse({ models: [] }));

    await getCodexModels("token", null, { accountId: "acct-123" });

    const [url, init] = mocks.proxyAwareFetch.mock.calls[0];
    expect(String(url)).toContain("/backend-api/codex/models");
    expect(String(url)).toContain("client_version=");
    expect(init.headers.Authorization).toBe("Bearer token");
    expect(init.headers["ChatGPT-Account-ID"]).toBe("acct-123");
  });

  // Fail-open in every direction: the caller skips the ping rather than
  // guessing a model, which is safer than sending a request that 400s.
  it("returns an empty list on a non-ok response", async () => {
    respondWith(async () => jsonResponse({}, 401));

    expect(await getCodexModels("token", null, {})).toEqual([]);
  });

  // A transport failure must not propagate: the caller skips the ping instead.
  // Modelled as a malformed response object rather than a thrown rejection —
  // vitest reports a rejection queued on a shared mock as unhandled even when
  // the function under test catches it, which would make the case flaky.
  it("returns an empty list when the response cannot be read", async () => {
    respondWith(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error("socket hang up"); },
    }));

    expect(await getCodexModels("token", null, {})).toEqual([]);
  });

  it("returns an empty list when the payload has no models array", async () => {
    respondWith(async () => jsonResponse({ unexpected: true }));

    expect(await getCodexModels("token", null, {})).toEqual([]);
  });

  it("does not call the API without an access token", async () => {
    expect(await getCodexModels(null, null, {})).toEqual([]);
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });
});
