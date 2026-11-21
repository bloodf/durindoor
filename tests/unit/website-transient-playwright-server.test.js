import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSIENT_PORT,
  LOOPBACK_HOST,
  TRANSIENT_PORT_ENV,
  isLoopbackUrl,
  isPortListening,
  reserveLoopbackPort,
  resolveTransientPort,
  startTransientServer,
  transientServerPlan,
} from "../../website/scripts/transient-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

describe("website transient Playwright server", () => {
  it("binds the loopback interface only", () => {
    const plan = transientServerPlan();

    expect(plan.host).toBe(LOOPBACK_HOST);
    expect(plan.baseURL).toBe(`http://${LOOPBACK_HOST}:${DEFAULT_TRANSIENT_PORT}`);
    expect(plan.url).toBe(plan.baseURL);
    expect(plan.nextArgs).toEqual([
      "start",
      "--hostname",
      LOOPBACK_HOST,
      "--port",
      String(DEFAULT_TRANSIENT_PORT),
    ]);
    expect(plan.env.HOSTNAME).toBe(LOOPBACK_HOST);
    expect(JSON.stringify(plan)).not.toContain("0.0.0.0");
  });

  it("keeps wildcard and remote origins out of the suite", () => {
    expect(isLoopbackUrl(`http://${LOOPBACK_HOST}:3100`)).toBe(true);
    expect(isLoopbackUrl("http://localhost:3100")).toBe(true);
    expect(isLoopbackUrl("http://0.0.0.0:3100")).toBe(false);
    expect(isLoopbackUrl("http://192.168.1.10:3100")).toBe(false);
    expect(isLoopbackUrl("https://durindoor.vercel.app")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("uses an explicit validated port", () => {
    expect(resolveTransientPort({})).toBe(DEFAULT_TRANSIENT_PORT);
    expect(resolveTransientPort({ [TRANSIENT_PORT_ENV]: "4321" })).toBe(4321);
    expect(() => resolveTransientPort({ [TRANSIENT_PORT_ENV]: "0" })).toThrow(
      /integer port between 1 and 65535/,
    );
    expect(() => resolveTransientPort({ [TRANSIENT_PORT_ENV]: "http" })).toThrow(
      /integer port between 1 and 65535/,
    );
  });

  it("starts and stops the server process it owns", async () => {
    const port = await reserveLoopbackPort();
    const server = startTransientServer({
      command: process.execPath,
      args: [
        "-e",
        `const { createServer } = require("node:net"); createServer().listen(${port}, "${LOOPBACK_HOST}"); setInterval(() => {}, 1000);`,
      ],
    });

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await isPortListening(LOOPBACK_HOST, port)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await isPortListening(LOOPBACK_HOST, port)).toBe(true);

    const result = await server.stop();
    expect(result.code === 0 || result.signal !== null).toBe(true);
    expect(await isPortListening(LOOPBACK_HOST, port)).toBe(false);
  }, 30_000);
});

describe("website Playwright configuration", () => {
  const config = read("website/playwright.config.mjs");

  it("starts its own transient server and never reuses one", () => {
    expect(config).toContain("transientServerPlan()");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).not.toContain("reuseExistingServer: true");
    expect(config).toContain("gracefulShutdown");
    expect(config).toContain("globalSetup");
    expect(config).toContain("robots.txt");
  });

  it("offers no path to an existing server", () => {
    expect(config).not.toContain("DOCS_BASE_URL");
    expect(config).not.toContain("localhost:3000");
  });

  it("creates no unit, schedule or daemon", () => {
    for (const forbidden of ["systemctl", "systemd", "crontab", "nohup", "launchctl", "pm2"]) {
      expect(config).not.toContain(forbidden);
    }
    expect(config).not.toMatch(/\s&\s*$/m);
  });

  it("keeps the screenshot, console, accessibility and responsive suites", () => {
    for (const spec of ["docs.spec.mjs", "marketing.spec.mjs", "public-verification.spec.mjs"]) {
      expect(config).toContain(spec);
    }
    const setup = read("website/tests/global-setup.mjs");
    expect(setup).toContain("the browser suite must target the loopback interface");
    expect(setup).toContain("the transient server process must be running");
    expect(setup).toContain("TRANSIENT_STATE_ENV");
  });
});
