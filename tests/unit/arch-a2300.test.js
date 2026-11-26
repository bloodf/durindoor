// #2300: dead baseline files stay deleted, and concurrent first Gemini Web
// requests share one Playwright launch. Every browser here is a local mock.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { GeminiWebExecutor, resetGeminiBrowserLeaseForTests } from "../../open-sse/executors/gemini-web.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const DELETED = [
  "current.json",
  "baseline-results.json",
  "providers-baseline.json",
  "verify-alias.mjs",
  "verify-providers.mjs",
  "snapshot-providers.mjs",
  "verify-oauth-urls.mjs",
];

describe("#2300 dead baseline data", () => {
  it("is deleted and no script, config or test references it", () => {
    for (const file of DELETED) {
      expect(existsSync(join(repoRoot, "tests/__baseline__", file)), file).toBe(false);
    }
    const pattern = DELETED.filter((file) => file !== "current.json")
      .map((file) => file.replaceAll(".", "\\."))
      .join("|");
    let hits = "";
    try {
      hits = execFileSync(
        "git",
        ["grep", "-lE", `${pattern}|__baseline__/current\\.json`, "--", "package.json", "tests/package.json", "scripts", "tests", ".github", "*vitest*", "*eslint*",
          ":!tests/unit/arch-a2300.test.js",
          // Lists baseline-results.json only as a documented exception, not a use.
          ":!tests/unit/review-x-dead-baseline.test.js"],
        { cwd: repoRoot, encoding: "utf8" },
      );
    } catch (error) {
      if (error.status !== 1) throw error; // 1 = no matches
    }
    expect(hits.trim()).toBe("");
    for (const file of DELETED) {
      let imports = "";
      try {
        imports = execFileSync("git", ["grep", "-nE", `^[[:space:]]*(import|export|.*require\\().*${file.replaceAll(".", "\\.")}`, "--", "src", "open-sse"], { cwd: repoRoot, encoding: "utf8" });
      } catch (error) {
        if (error.status !== 1) throw error;
      }
      expect(imports.trim()).toBe("");
    }
  });
});

describe("#2300 gemini-web browser launch", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetGeminiBrowserLeaseForTests();
  });

  it("launches Chromium once for two concurrent first requests", async () => {
    let finishLaunch;
    const gate = new Promise((resolveGate) => { finishLaunch = resolveGate; });
    const browser = {
      isConnected: () => true,
      close: vi.fn(async () => {}),
      newContext: vi.fn(async () => { throw new Error("mock context refused"); }),
    };
    const launch = vi.spyOn(chromium, "launch").mockImplementation(async () => {
      await gate;
      return browser;
    });
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const run = (psid) => new GeminiWebExecutor().execute({
      model: "gemini-3.1-pro",
      body: { model: "gemini-3.1-pro", messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { apiKey: `__Secure-1PSID=${psid}; __Secure-1PSIDTS=ts-${psid}` },
      log,
    });

    const pending = Promise.allSettled([run("a"), run("b")]);
    await vi.waitFor(() => expect(launch).toHaveBeenCalled());
    finishLaunch();
    await pending;

    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(2);
  });
});
