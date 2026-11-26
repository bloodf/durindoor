import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execSync: vi.fn(), statSync: vi.fn(), lstatSync: vi.fn(), realpathSync: vi.fn(), existsSync: vi.fn(), accessSync: vi.fn() }));

vi.mock("os", async (original) => {
  const real = await original();
  return { ...real, default: { ...real.default, platform: () => "darwin" } };
});
vi.mock("fs", async (original) => {
  const real = await original();
  return { ...real, default: { ...real.default, ...mocks } };
});
vi.mock("child_process", async (original) => ({ ...(await original()), spawn: mocks.spawn, execSync: mocks.execSync }));
vi.mock("@/mitm/dns/dnsConfig", () => ({ execWithPassword: vi.fn() }));

const require = createRequire(import.meta.url);
const trusted = require("../../src/mitm/trustedBinaries.js");

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(trusted, "resolveTrustedUnixBinary").mockReturnValue("/usr/bin/sudo");
  mocks.existsSync.mockImplementation((p) => String(p) === "/opt/homebrew/bin/tailscaled");
  mocks.realpathSync.mockImplementation((p) => p);
  mocks.lstatSync.mockReturnValue({ uid: 0, isFile: () => true });
  mocks.statSync.mockImplementation((p) => ({ uid: 0, mode: 0o755, isFile: () => String(p).endsWith("tailscaled"), isDirectory: () => !String(p).endsWith("tailscaled") }));
  mocks.execSync.mockImplementation(() => { throw new Error("not running"); });
  mocks.spawn.mockReturnValue({ stdin: { write: vi.fn(), end: vi.fn() }, unref: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function start() {
  vi.resetModules();
  const { startDaemonWithPassword } = await import("../../src/lib/tunnel/tailscale/tailscale.js");
  const started = startDaemonWithPassword("password");
  await vi.runAllTimersAsync();
  await started;
}

describe("tailscaled elevation trust", () => {
  it("runs a user-owned Homebrew daemon without sudo", async () => {
    mocks.lstatSync.mockImplementation((p) => ({ uid: String(p).startsWith("/opt") ? 501 : 0, isFile: () => String(p).startsWith("/opt") }));
    await start();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn.mock.calls[0][0]).toBe("/opt/homebrew/bin/tailscaled");
    expect(mocks.spawn.mock.calls[0][1]).toContain("--tun=userspace-networking");
  });

  it("runs a root-owned daemon through sudo", async () => {
    mocks.lstatSync.mockImplementation((p) => ({ uid: 0, isFile: () => String(p).startsWith("/opt") }));
    await start();
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.spawn.mock.calls[0][0]).toBe("/usr/bin/sudo");
    expect(mocks.spawn.mock.calls[0][1]).toContain("/opt/homebrew/bin/tailscaled");
    expect(mocks.spawn.mock.calls[0][1]).not.toContain("--tun=userspace-networking");
  });

  it("rejects a writable parent directory", async () => {
    mocks.lstatSync.mockImplementation((p) => ({ uid: 0, isFile: () => String(p).startsWith("/opt") }));
    mocks.statSync.mockImplementation((p) => ({ uid: 0, mode: p === "/opt/homebrew" ? 0o775 : 0o755, isFile: () => String(p).endsWith("tailscaled"), isDirectory: () => !String(p).endsWith("tailscaled") }));
    await start();
    expect(mocks.spawn.mock.calls[0][1]).toContain("--tun=userspace-networking");
  });
});
