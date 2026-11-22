import { EventEmitter } from "node:events";
import vm from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFileSync: vi.fn(), fs: {
  existsSync: vi.fn(() => false), mkdirSync: vi.fn(), openSync: vi.fn(() => 17),
  closeSync: vi.fn(), writeFileSync: vi.fn(), readFileSync: vi.fn(() => "No matching distribution"),
} }));
// Vitest resolves child_process and node:child_process to the same mock.
vi.mock("node:child_process", () => ({ spawn: mocks.spawn, execFileSync: mocks.execFileSync }));
vi.mock("fs", () => ({ default: mocks.fs, ...mocks.fs }));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/child-env-test" }));
vi.mock("../../src/lib/headroom/pythonEnv.js", () => ({ ensureManagedVenv: async () => ({ python: "/python" }), managedVenvBinary: () => null }));
vi.mock("../../src/lib/headroom/detect.js", () => ({ findHeadroomBinary: () => "/headroom", HEADROOM_COMPRESSION_EXTRAS: ["code"], getInstalledHeadroomExtras: () => ({}) }));

const realFs = await vi.importActual("node:fs");
const { __test__ } = await import("../../src/lib/mcp/gateway/stdioClient.js");
const { startHeadroomProxy, installHeadroomExtras } = await import("../../src/lib/headroom/process.js");

function child() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn() }; proc.pid = 1234; proc.unref = vi.fn();
  return proc;
}
function checkEnv(env) {
  expect(env).toMatchObject({ PATH: "/test/path", HOME: "/test/home", LC_TEST: "locale", https_proxy: "proxy" });
  expect(env).not.toHaveProperty("JWT_SECRET");
  expect(env).not.toHaveProperty("API_KEY_SECRET");
  expect(env).not.toHaveProperty("OTHER_PRIVATE_TOKEN");
}
beforeEach(() => {
  vi.stubEnv("PATH", "/test/path"); vi.stubEnv("HOME", "/test/home");
  vi.stubEnv("LC_TEST", "locale"); vi.stubEnv("https_proxy", "proxy");
  vi.stubEnv("JWT_SECRET", "jwt"); vi.stubEnv("API_KEY_SECRET", "api"); vi.stubEnv("OTHER_PRIVATE_TOKEN", "private");
  mocks.spawn.mockReset().mockImplementation(child);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("limits gateway environment while passing instance configuration", async () => {
  const entry = new __test__.StdioEntry({ slug: "test", command: "mcp", env: JSON.stringify({ CUSTOM: "configured", PATH: "/configured", JWT_SECRET: "override" }) });
  await entry.ensure();
  const env = mocks.spawn.mock.calls[0][2].env;
  checkEnv({ ...env, PATH: "/test/path" });
  expect(env).toMatchObject({ CUSTOM: "configured", PATH: "/configured" });
});

it("limits the local plugin bridge environment", () => {
  const source = realFs.readFileSync(new URL("../../src/lib/mcp/stdioSseBridge.js", import.meta.url), "utf8");
  const module = { exports: {} };
  const require = (name) => {
    if (name === "child_process") return { spawn: mocks.spawn };
    if (name === "crypto") return {};
    if (name.includes("typeChecks")) return { isString: (value) => Object.prototype.toString.call(value) === "[object String]" };
    return { LOCAL_STDIO_PLUGINS: [{ name: "test", command: "mcp", args: [] }] };
  };
  vm.runInNewContext(source, { module, require, process, globalThis: {}, console });
  module.exports.getOrSpawn("test");
  checkEnv(mocks.spawn.mock.calls[0][2].env);
});

it("limits Headroom proxy, installer and version probe environments", async () => {
  vi.useFakeTimers();
  vi.spyOn(process, "kill").mockReturnValue(true);
  const started = startHeadroomProxy();
  await vi.advanceTimersByTimeAsync(8000);
  await started;
  checkEnv(mocks.spawn.mock.calls[0][2].env);
  const installing = installHeadroomExtras(["code"]);
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));
  const options = mocks.spawn.mock.calls[1][2];
  checkEnv(options.env);
  expect(options.env.TMPDIR).toContain("pip-tmp");
  expect(options.env.PIP_CACHE_DIR).toContain("pip-tmp/cache");
  mocks.execFileSync.mockReturnValue(Buffer.from("3.13"));
  mocks.spawn.mock.results[1].value.emit("exit", 1);
  await expect(installing).rejects.toMatchObject({ code: "EXTRA_WHEEL_UNAVAILABLE" });
  expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
  checkEnv(mocks.execFileSync.mock.calls[0][2].env);
});
