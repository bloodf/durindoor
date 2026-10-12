import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { getExecutor } from "../../open-sse/executors/index.js";
import { shutdownPool, getBrowserPoolMetrics } from "../../open-sse/services/browserPool.js";
import { isolatedEnv } from "../../scripts/smoke-installed-artifact.mjs";

const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright", () => ({ chromium: { launch } }));
// Registry import must not start the unrelated Kimchi release-refresh network job.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/offline-acceptance",
}));

function browserRequest() {
  return {
    model: "gpt-5-6",
    body: { messages: [{ role: "user", content: "offline runtime acceptance" }] },
    stream: false,
    credentials: {
      apiKey: "__Secure-next-auth.session-token=synthetic-fleet-session",
      connectionId: "fleet-pr1273-offline",
      providerSpecificData: { transport: "browser", headless: false },
    },
  };
}

function forbidNetwork(executor) {
  const fetch = vi.fn(() => { throw new Error("Acceptance tests must not call providers"); });
  vi.stubGlobal("fetch", fetch);
  const http = vi.spyOn(executor.httpExecutor, "execute").mockImplementation(() => {
    throw new Error("Pinned browser transport must not invoke HTTP fallback");
  });
  return { fetch, http };
}

afterEach(async () => {
  await shutdownPool("fleet-pr1273-acceptance");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  launch.mockReset();
});

describe("PR #1273 optional runtime acceptance through registered executors", () => {
  it.each(["chatgpt-web", "cgpt-web"])("%s reports missing Chromium with explicit offline prerequisites", async (provider) => {
    vi.stubEnv("DURINDOOR_BROWSER_POOL", "1");
    vi.stubEnv("DURINDOOR_BROWSER_AUTO_INSTALL", "0");
    launch.mockRejectedValue(new Error("Executable doesn't exist at /uninstalled/chromium"));
    const executor = getExecutor(provider);
    const network = forbidNetwork(executor);
    const before = getBrowserPoolMetrics().metrics.browserLaunchFailures;

    const result = await executor.execute(browserRequest());

    expect(result.response.status).toBe(503);
    expect(await result.response.json()).toMatchObject({
      error: {
        type: "upstream_error", code: "HTTP_503",
        message: expect.stringContaining("npx playwright install chromium"),
      },
    });
    expect(launch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ headless: false }));
    expect(getBrowserPoolMetrics().metrics.browserLaunchFailures).toBe(before + 1);
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.http).not.toHaveBeenCalled();
  });

  it.each(["chatgpt-web", "cgpt-web"])("%s reports missing display without disguising it as missing credentials", async (provider) => {
    vi.stubEnv("DURINDOOR_BROWSER_POOL", "1");
    vi.stubEnv("DURINDOOR_BROWSER_AUTO_INSTALL", "0");
    launch.mockRejectedValue(new Error("Missing X server or $DISPLAY"));
    const executor = getExecutor(provider);
    const network = forbidNetwork(executor);

    const result = await executor.execute(browserRequest());

    expect(result.response.status).toBe(503);
    const { error } = await result.response.json();
    expect(error.message).toContain("xvfb-run");
    expect(error.message).toContain("DURINDOOR_CHATGPT_WEB_HEADLESS=1");
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.http).not.toHaveBeenCalled();
  });

  it.each(["chatgpt-web", "cgpt-web"])("%s reports an explicitly disabled runtime before loading Chromium or making provider requests", async (provider) => {
    vi.stubEnv("DURINDOOR_BROWSER_POOL", "off");
    const executor = getExecutor(provider);
    const network = forbidNetwork(executor);

    const result = await executor.execute(browserRequest());

    const { error } = await result.response.json();
    expect(error.message).toContain("DURINDOOR_BROWSER_POOL=off");
    // Runtime unavailability is 503, not malformed input (the message contains "requested").
    expect.soft(result.response.status).toBe(503);
    expect(launch).not.toHaveBeenCalled();
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.http).not.toHaveBeenCalled();
  });
});

describe("installed artifact environment boundary", () => {
  it("does not inherit provider credentials, proxies, module injection, or browser caches", () => {
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL", "HTTP_PROXY", "HTTPS_PROXY", "NODE_OPTIONS", "NODE_PATH", "PLAYWRIGHT_BROWSERS_PATH"]) {
      vi.stubEnv(key, "synthetic-parent-value");
    }
    const home = path.join(process.env.HOME, "artifact-home");
    const data = path.join(process.env.DATA_DIR, "artifact-data");
    const env = isolatedEnv(home, data, 20128);

    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL", "HTTP_PROXY", "HTTPS_PROXY"]) {
      expect(env).not.toHaveProperty(key);
    }
    expect(env).toMatchObject({
      HOME: home, USERPROFILE: home, DATA_DIR: data, HOSTNAME: "127.0.0.1", PORT: "20128",
      NODE_OPTIONS: "", NODE_PATH: "", DURINDOOR_BROWSER_AUTO_INSTALL: "0",
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1", PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"),
      XDG_CACHE_HOME: path.join(home, "cache"), TMPDIR: home,
    });
    const next = isolatedEnv(home, data, 20128);
    for (const key of ["INITIAL_PASSWORD", "JWT_SECRET", "API_KEY_SECRET"]) {
      expect(env[key]).toMatch(/^[a-f0-9]{48,64}$/);
      expect(next[key]).not.toBe(env[key]);
    }
  });
});
