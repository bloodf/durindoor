import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";
import { BLOCKED_OMNIROUTE_PROVIDERS } from "open-sse/executors/unsupported-websession.js";

// #2034: opt-out remains guarded with all network closed.
const body = { messages: [{ role: "user", content: "hello" }] };
const credsFor = (connectionId, enableSessionDispatch) => ({
  connectionId,
  apiKey: `ecto_1_sess=synthetic-${connectionId}`,
  providerSpecificData: enableSessionDispatch === undefined ? {} : { enableSessionDispatch },
});

let fetchSpy;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("closed mock: no network"));
});
afterEach(() => vi.restoreAllMocks());

describe("Muse Spark Web guarded dispatch (#2034)", () => {
  for (const id of ["muse-spark-web", "ms-web"]) {
    for (const flag of [undefined, false]) {
      for (const stream of [false, true]) {
        it(`${id} flag=${flag} stream=${stream} stays on the guard with no request`, async () => {
          const result = await getExecutor(id).execute({
            model: "muse-spark",
            body,
            stream,
            credentials: credsFor("conn-a", flag),
          });
          expect(result.response.status).toBe(501);
          const json = await result.response.json();
          expect(json.error.type).toBe("provider_port_pending");
          expect(JSON.stringify(json)).not.toContain("synthetic-conn-a");
          expect(JSON.stringify(result.headers)).not.toContain("synthetic-conn-a");
          expect(fetchSpy).not.toHaveBeenCalled();
        });
      }
    }
  }

  it("never vends a URL or authenticated header for translate-path callers", () => {
    const executor = getExecutor("muse-spark-web");
    expect(() => executor.buildUrl("muse-spark", true)).toThrow(/provider|runtime execution/i);
    expect(() => executor.buildHeaders(credsFor("conn-a", true), true)).toThrow();
  });

  it("records the blocker with the pinned upstream sources", () => {
    expect(BLOCKED_OMNIROUTE_PROVIDERS["muse-spark-web"]).toMatchObject({
      aliases: ["ms-web"],
      reason: expect.any(String),
    });
  });

  it("documents opt-in with pinned source links", () => {
    const doc = readFileSync(new URL("../../docs/providers/muse-spark-web.mdx", import.meta.url), "utf8");
    expect(doc).toContain("4265bb2ad5477450a07d3a43ea33a62c6c874878");
    expect(doc).toContain("fresh-access-token.ts");
    expect(doc).toContain("wss://gateway.meta.ai/ws/clippy");
    expect(doc).toContain("enableSessionDispatch");
  });
});
