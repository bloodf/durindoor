import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { GeminiWebExecutor, resetGeminiBrowserLeaseForTests } from "../../open-sse/executors/gemini-web.js";

const root = resolve(import.meta.dirname, "../..");

afterEach(async () => {
  await resetGeminiBrowserLeaseForTests();
  vi.restoreAllMocks();
});

describe("issue 2300", () => {
  it("shares the first browser launch between concurrent requests", async () => {
    let finishLaunch;
    const browser = {
      isConnected: () => true,
      close: vi.fn(async () => {}),
      newContext: vi.fn(async () => { throw new Error("fixture stops after launch"); }),
    };
    const launch = vi.spyOn(chromium, "launch").mockImplementation(() => new Promise((resolveLaunch) => {
      finishLaunch = resolveLaunch;
    }));
    const executor = new GeminiWebExecutor();
    const input = {
      body: { messages: [{ role: "user", content: "hello" }] },
      credentials: { apiKey: "__Secure-1PSID=fixture" },
    };
    const requests = [executor.execute(input), executor.execute(input)];
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    finishLaunch(browser);
    await Promise.all(requests);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(2);
  });

  it("keeps removed baseline files absent and unreferenced", () => {
    const removed = ["current.json", "verify-oauth-urls.mjs"];
    const tracked = execFileSync("git", ["grep", "-l", "-F", "tests/__baseline__/", "--", ":!tests/unit/arch-a2300.test.js"], {
      cwd: root, encoding: "utf8",
    }).trim().split("\n");
    for (const name of removed) {
      const path = `tests/__baseline__/${name}`;
      expect(existsSync(resolve(root, path))).toBe(false);
      const matches = tracked.filter((file) => {
        const content = execFileSync("git", ["show", `:${file}`], { cwd: root, encoding: "utf8" });
        return content.includes(path);
      });
      expect(matches).toEqual([]);
    }
  });
});
