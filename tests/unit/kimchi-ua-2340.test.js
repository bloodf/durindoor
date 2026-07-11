/**
 * #2340 Kimchi dynamic User-Agent.
 *
 * Verifies getKimchiUserAgent() returns a stable `kimchi/<version>` string,
 * and that the registry transport header + catalog fetch both read through the
 * same helper (so a version bump propagates without code changes).
 *
 * The `updateKimchiUserAgent` block covers the dynamic update path: GitHub
 * releases fetch + `tag_name` parse, 1h cache dedup, in-flight
 * `activePromise` dedup, propagation into getKimchiUserAgent(), and graceful
 * failure. The optional `fetcher` seam lets tests inject a fetch stub
 * directly, leaving the no-arg production path (proxyAwareFetch via the
 * native file loader) untouched.
 *
 * Importing the UA module fires a background `updateKimchiUserAgent()` and
 * arms a 4h interval. We preseed `globalThis.__kimchi_ua_state` with
 * `intervalStarted: true` BEFORE each dynamic import so that side effect is
 * skipped, then `vi.resetModules()` + dynamic-import to get a fresh module
 * that still shares the preseeded global state. All UA/registry access goes
 * through dynamic imports after the preseed — no static imports that would
 * capture a stale `uaState`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";

const GLOBAL_KEY = "__kimchi_ua_state";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UA_URL = pathToFileURL(
  path.join(REPO_ROOT, "open-sse", "utils", "kimchiUserAgent.js"),
).href;
const KIMCHI_REGISTRY_URL = pathToFileURL(
  path.join(REPO_ROOT, "open-sse", "providers", "registry", "kimchi.js"),
).href;
const KIMCHI_MODELS_URL = pathToFileURL(
  path.join(REPO_ROOT, "open-sse", "services", "kimchiModels.js"),
).href;
const LATEST_RELEASE_URL = "https://api.github.com/repos/getkimchi/kimchi/releases/latest";
const KIMCHI_UA_RE = /^kimchi\/\d+\.\d+\.\d+$/;

beforeEach(() => {
  globalThis[GLOBAL_KEY] = {
    currentAgent: "kimchi/0.1.01",
    lastFetchTime: 0,
    activePromise: null,
    intervalStarted: true,
  };
  vi.resetModules();
});

afterEach(() => {
  delete globalThis[GLOBAL_KEY];
  vi.resetModules();
});

function okJson(body) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("getKimchiUserAgent (#2340)", () => {
  it("returns a kimchi/<semver> string", async () => {
    const { getKimchiUserAgent } = await import(UA_URL);
    expect(getKimchiUserAgent()).toMatch(KIMCHI_UA_RE);
  });

  it("is stable across repeated synchronous reads", async () => {
    const { getKimchiUserAgent } = await import(UA_URL);
    const a = getKimchiUserAgent();
    const b = getKimchiUserAgent();
    expect(b).toBe(a);
  });

  it("registry transport.headers reads through the helper (getter, not frozen literal)", async () => {
    const [{ getKimchiUserAgent }, { default: kimchiRegistry }] = await Promise.all([
      import(UA_URL),
      import(KIMCHI_REGISTRY_URL),
    ]);
    const first = kimchiRegistry.transport.headers["User-Agent"];
    const second = kimchiRegistry.transport.headers["User-Agent"];
    expect(first).toMatch(KIMCHI_UA_RE);
    expect(second).toBe(getKimchiUserAgent());
  });

  it("kimchiModels.js no longer exports a frozen KIMCHI_USER_AGENT literal", async () => {
    const mod = await import(KIMCHI_MODELS_URL);
    expect("KIMCHI_USER_AGENT" in mod).toBe(false);
  });
});

describe("updateKimchiUserAgent (#2340)", () => {
  it("fetches latest release, parses tag_name, and propagates into getKimchiUserAgent", async () => {
    const fetchMock = vi.fn(async () => okJson({ tag_name: "v1.2.3" }));
    const { getKimchiUserAgent, updateKimchiUserAgent } = await import(UA_URL);

    expect(getKimchiUserAgent()).toBe("kimchi/0.1.01");
    const result = await updateKimchiUserAgent(fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(LATEST_RELEASE_URL);
    expect(result).toBe("kimchi/1.2.3");
    expect(getKimchiUserAgent()).toBe("kimchi/1.2.3");
  });

  it("deduplicates concurrent rapid calls into a single fetch (activePromise)", async () => {
    let releaseFetch;
    const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });
    const fetchMock = vi.fn(() => fetchGate.then(() => okJson({ tag_name: "v3.0.0" })));
    const { getKimchiUserAgent, updateKimchiUserAgent } = await import(UA_URL);

    // Two rapid calls while the first fetch is still in flight.
    const p1 = updateKimchiUserAgent(fetchMock);
    const p2 = updateKimchiUserAgent(fetchMock);

    // Let the microtask queue advance so the second call observes activePromise.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFetch();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1).toBe("kimchi/3.0.0");
    expect(r2).toBe("kimchi/3.0.0");
    expect(getKimchiUserAgent()).toBe("kimchi/3.0.0");
  });

  it("skips the network within the 1h cache window after a successful fetch", async () => {
    const fetchMock = vi.fn(async () => okJson({ tag_name: "v1.2.3" }));
    const { updateKimchiUserAgent } = await import(UA_URL);

    await updateKimchiUserAgent(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call after the first succeeded → cached, no new fetch.
    const r2 = await updateKimchiUserAgent(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r2).toBe("kimchi/1.2.3");
  });

  it("leaves currentAgent unchanged when the release fetch rejects (graceful)", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("network down"); });
    const { getKimchiUserAgent, updateKimchiUserAgent } = await import(UA_URL);

    const before = getKimchiUserAgent();
    const result = await updateKimchiUserAgent(fetchMock);
    expect(result).toBe(before);
    expect(getKimchiUserAgent()).toBe("kimchi/0.1.01");
  });
});
