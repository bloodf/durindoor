// #2313 items 4-5: agy shares the Google anti-burst spacing in background
// refresh, and src/lib/oauth/providers.js keeps extension-full relative
// imports so plain Node ESM can resolve it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBackgroundTokenRefreshTick } from "../../src/sse/services/backgroundTokenRefresh.js";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function conn(id, provider) {
  return {
    id,
    provider,
    authType: "oauth",
    refreshToken: `refresh-${id}`,
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    isActive: true,
  };
}

describe("arch #2313", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubEnv("BG_REFRESH_GOOGLE_DELAY_MS", "12000");
    vi.stubEnv("BG_REFRESH_DELAY_MS", "1500");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("spaces agy accounts by the sensitive-provider delay", async () => {
    const sleeps = [];
    const refreshConnection = vi.fn(async () => {});
    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [conn("agy-1", "agy"), conn("agy-2", "agy"), conn("gh", "github"), conn("last", "github")],
      refreshConnection,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(refreshConnection.mock.calls.map(([c]) => c.id)).toEqual(["agy-1", "agy-2", "gh", "last"]);
    // agy -> 12 s + 0 jitter; non-Google -> 1.5 s + 200 ms.
    expect(sleeps).toEqual([12_000, 12_000, 1_700]);
  });

  it("uses extension-full relative static imports in src/lib/oauth/providers.js", () => {
    const file = fileURLToPath(new URL("../../src/lib/oauth/providers.js", import.meta.url));
    const source = readFileSync(file, "utf8");
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    const relative = specifiers.filter((s) => s.startsWith("."));
    expect(relative.length).toBeGreaterThan(0);
    expect(relative.filter((s) => !/\.(?:m?js|json)$/.test(s))).toEqual([]);
  });
});
