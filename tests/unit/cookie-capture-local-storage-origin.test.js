/**
 * The extension reads a provider's localStorage item only on that provider's own origin
 * (review finding on #2034). Closed mocks only: a fake `chrome`, a fake `fetch`, a synthetic
 * page whose `location` and `localStorage` are stubbed per call. No browser, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { PAIRING_HEADER } from "../../extensions/provider-cookie-capture/providers.js";
import {
  MESSAGES, parsePairing, preflightPermissions, runCapture, confirmationFor, readLocalStorageItems,
} from "../../extensions/provider-cookie-capture/capture.js";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const PROVIDER = "https://site.tinycms.xyz";
const OTHER = "https://attacker.example";
// Synthetic only: not a real device id.
const UUID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const OTHER_VALUE = "synthetic-other-site-value";

afterEach(() => { vi.unstubAllGlobals(); });

/** Stub the page the reader runs in, then call it as `chrome.scripting` would. */
function runInPage(origin, items, args) {
  vi.stubGlobal("location", { origin });
  vi.stubGlobal("localStorage", { getItem: (key) => items[key] ?? null });
  try { return readLocalStorageItems(...args); } finally { vi.unstubAllGlobals(); }
}

describe("readLocalStorageItems origin check", () => {
  it("returns the value when the page origin equals the expected origin", () => {
    expect(runInPage(PROVIDER, { "app-config-uuid": UUID }, [["app-config-uuid"], PROVIDER])).toEqual({ "app-config-uuid": UUID });
  });

  it("returns nothing on any other origin, a near-miss origin or without an expected origin", () => {
    const items = { "app-config-uuid": OTHER_VALUE };
    for (const pageOrigin of [OTHER, "http://site.tinycms.xyz", "https://site.tinycms.xyz:8443", "https://evil.site.tinycms.xyz"]) {
      expect(runInPage(pageOrigin, items, [["app-config-uuid"], PROVIDER]), pageOrigin).toEqual({});
    }
    expect(runInPage(PROVIDER, items, [["app-config-uuid"]])).toEqual({});
    expect(runInPage(PROVIDER, items, [["app-config-uuid"], ""])).toEqual({});
    expect(runInPage(PROVIDER, items, [["app-config-uuid"], `${PROVIDER}/`])).toEqual({});
  });

  it("does not touch storage when the origin does not match", () => {
    const getItem = vi.fn(() => OTHER_VALUE);
    vi.stubGlobal("location", { origin: OTHER });
    vi.stubGlobal("localStorage", { getItem });
    expect(readLocalStorageItems(["app-config-uuid"], PROVIDER)).toEqual({});
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe("runCapture refuses a tab that left the provider origin", () => {
  const pairingText = () => JSON.stringify({ pairing: {
    token: `ddpair_${"C".repeat(43)}`, header: PAIRING_HEADER, provider: "tinycms-web", action: "create", name: "Synthetic TinyCMS",
    expiresAt: new Date(NOW + 60_000).toISOString(), importUrl: "https://dashboard.example/api/providers/cookie-import",
    contract: { origin: PROVIDER, cookieNames: [], cookiePrefixes: [], localStorageKeys: ["app-config-uuid"] },
  } });

  /**
   * `urls` is the tab URL answered by each successive `tabs.get`; the last one repeats.
   * `pageOrigin` is the origin of the document the injected reader runs in.
   */
  function makeChrome({ urls, pageOrigin = PROVIDER, items = { "app-config-uuid": UUID } }) {
    const calls = [];
    const held = new Set();
    const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
    let gets = 0;
    const chrome = {
      tabs: {
        get: async (id) => {
          const url = urls[Math.min(gets, urls.length - 1)];
          gets += 1;
          calls.push(["tabs.get", url]);
          return { id, url };
        },
      },
      permissions: {
        contains: async (q) => names(q).every((n) => held.has(n)),
        request: async (q) => { names(q).forEach((n) => held.add(n)); return true; },
        remove: async (q) => { calls.push(["permissions.remove", q]); names(q).forEach((n) => held.delete(n)); return true; },
      },
      scripting: {
        executeScript: async (details) => {
          calls.push(["scripting.executeScript", details.args]);
          return [{ frameId: 0, result: runInPage(pageOrigin, items, details.args) }];
        },
      },
    };
    return { chrome, calls };
  }

  async function capture(options) {
    const parsed = parsePairing(pairingText(), NOW);
    expect(parsed.ok).toBe(true);
    const plan = { ...parsed.plan, tabId: 4 };
    const harness = makeChrome(options);
    await preflightPermissions(harness.chrome, plan);
    const fetch = vi.fn(async () => ({ status: 201, ok: true, json: async () => ({ connection: { id: "c", name: "n" } }) }));
    const result = await runCapture({ chrome: harness.chrome, fetch, plan, confirmed: confirmationFor(plan), now: () => NOW });
    return { ...harness, result, fetch };
  }

  it("passes the provider origin to the reader and sends the value when the tab stays put", async () => {
    const { result, calls, fetch } = await capture({ urls: [`${PROVIDER}/chat`] });
    expect(result).toMatchObject({ ok: true, localStorageCount: 1 });
    expect(calls.find(([name]) => name === "scripting.executeScript")[1]).toEqual([["app-config-uuid"], PROVIDER]);
    // Checked once after the permission prompt, then just before and just after the injection.
    expect(calls.filter(([name]) => name === "tabs.get")).toHaveLength(3);
    expect(JSON.parse(fetch.mock.calls[0][1].body).localStorage).toEqual({ "app-config-uuid": UUID });
  });

  it("refuses, without injecting, when the tab navigated before the read", async () => {
    const { result, calls, fetch } = await capture({ urls: [`${PROVIDER}/chat`, `${OTHER}/`] });
    expect(result).toEqual({ ok: false, code: "tab_navigated", message: MESSAGES.tab_navigated, expectedOrigin: PROVIDER });
    expect(calls.some(([name]) => name === "scripting.executeScript")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    // What this run was granted is still given back.
    expect(calls.some(([name]) => name === "permissions.remove")).toBe(true);
  });

  it("refuses when the tab URL changed during the injection, even if a value came back", async () => {
    const { result, fetch } = await capture({ urls: [`${PROVIDER}/chat`, `${PROVIDER}/chat`, `${OTHER}/`], pageOrigin: PROVIDER });
    expect(result).toMatchObject({ ok: false, code: "tab_navigated", expectedOrigin: PROVIDER });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(UUID);
  });

  it("sends nothing when the page itself is on another origin, even if the tab URL still matches", async () => {
    const { result, fetch } = await capture({ urls: [`${PROVIDER}/chat`], pageOrigin: OTHER, items: { "app-config-uuid": OTHER_VALUE } });
    expect(result).toMatchObject({ ok: false, code: "no_local_storage" });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(OTHER_VALUE);
  });

  it("explains the refusal in fixed text", () => {
    expect(MESSAGES.tab_navigated).toMatch(/nothing was sent/);
  });
});
