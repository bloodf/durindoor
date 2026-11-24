import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const routeMocks = vi.hoisted(() => ({
  killAppProcesses: vi.fn(async () => {}),
  spawnUpdaterAndExit: vi.fn(),
  registryGet: vi.fn(),
}));

vi.mock("https", () => ({ default: { get: routeMocks.registryGet } }));
vi.mock("@/lib/appUpdater", () => ({
  killAppProcesses: routeMocks.killAppProcesses,
  spawnUpdaterAndExit: routeMocks.spawnUpdaterAndExit,
}));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
}));

const { POST } = await import("../../src/app/api/version/update/route.js");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("updater review regressions", () => {
  it("does not stop app processes when latest version lookup fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    routeMocks.registryGet.mockImplementation(() => {
      const request = new EventEmitter();
      request.destroy = vi.fn();
      queueMicrotask(() => request.emit("error", new Error("registry unavailable")));
      return request;
    });

    const response = await POST();

    expect(response.status).toBe(502);
    expect(routeMocks.killAppProcesses).not.toHaveBeenCalled();
    expect(routeMocks.spawnUpdaterAndExit).not.toHaveBeenCalled();
  });

  it("uses one CJS parser for app and detached updater deployment modes", () => {
    const parser = require("../../src/lib/updater/deploymentMode.cjs");
    const appParser = require("../../src/lib/updater/deploymentMode.cjs");
    expect(parser).toBe(appParser);
    expect(parser.parseDeploymentMode(" HOSTED ")).toBe("hosted");
    expect(parser.isHosted("remote")).toBe(true);
    expect(parser.isHosted("local")).toBe(false);
    expect(() => parser.parseDeploymentMode("invalid")).toThrow(/DEPLOYMENT_MODE/);
  });

  it("allows updater status CORS only for both configured loopback dashboard origins", () => {
    const { setStatusCorsHeaders } = require("../../src/lib/updater/statusCors.cjs");
    for (const origin of ["http://localhost:20128", "http://127.0.0.1:20128"]) {
      const headers = {};
      setStatusCorsHeaders({ headers: { origin } }, { setHeader: (key, value) => { headers[key] = value; } }, 20128);
      expect(headers).toEqual({ Vary: "Origin", "Access-Control-Allow-Origin": origin });
    }
    for (const origin of ["http://localhost:20129", "https://localhost:20128", "http://attacker.test"]) {
      const headers = {};
      setStatusCorsHeaders({ headers: { origin } }, { setHeader: (key, value) => { headers[key] = value; } }, 20128);
      expect(headers).toEqual({ Vary: "Origin" });
    }
  });
});
