// Regression for the ~10s stall in GET /api/tunnel/status.
//
// `status --json` and `funnel status --json` each tried the app-local socket
// (DATA_DIR/tailscale/tailscaled.sock) first. On a system-managed Tailscale
// install that path does not exist, so each command burned its full timeout
// before falling back to the system socket — measured at 10.1s on a production
// host whose system socket answers the same commands in 12-19ms. Because these
// are execSync, the event loop was blocked for the whole duration, stalling
// every other request through the gateway.
//
// The fix skips socket candidates whose socket file is absent. These tests
// assert the observable consequence: the CLI is never invoked against a socket
// that cannot answer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SYSTEM_SOCKET = "/var/run/tailscale/tailscaled.sock";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal()),
  execSync: mocks.execSync,
}));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, default: { ...real.default, existsSync: mocks.existsSync }, existsSync: mocks.existsSync };
});

/** Every socket path the CLI was actually invoked with. */
function probedSockets() {
  return mocks.execSync.mock.calls
    .map(([command]) => String(command).match(/--socket (\S+)/)?.[1])
    .filter(Boolean);
}

let getActualFunnelUrl;

beforeEach(async () => {
  vi.resetModules();
  mocks.execSync.mockReset();
  mocks.existsSync.mockReset();
  // Only the system socket and the tailscale binary exist on this host.
  mocks.existsSync.mockImplementation((p) => String(p) === SYSTEM_SOCKET || String(p).endsWith("tailscale"));
  mocks.execSync.mockImplementation((command) =>
    String(command).includes("funnel status")
      ? JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: {} })
      : JSON.stringify({ Self: { DNSName: "host.tailnet.ts.net." } })
  );
  ({ getActualFunnelUrl } = await import("../../src/lib/tunnel/tailscale/tailscale.js"));
});

afterEach(() => vi.restoreAllMocks());

describe("tailscale socket probing", () => {
  it("never invokes the CLI against a socket that does not exist", () => {
    getActualFunnelUrl(11434);

    expect(mocks.execSync).toHaveBeenCalled();
    for (const socket of probedSockets()) {
      expect(mocks.existsSync(socket)).toBe(true);
    }
    // Specifically: the app-local socket is absent here and must not be tried.
    expect(probedSockets().some((s) => s.includes("/tailscale/tailscaled.sock") && s !== SYSTEM_SOCKET)).toBe(false);
  });

  it("still resolves the funnel URL through the system socket", () => {
    expect(getActualFunnelUrl(11434)).toBe("https://host.tailnet.ts.net");
    expect(probedSockets()).toContain(SYSTEM_SOCKET);
  });

  it("caps the command timeout well below the old 5s budget", () => {
    getActualFunnelUrl(11434);
    for (const [, options] of mocks.execSync.mock.calls) {
      expect(options.timeout).toBeLessThanOrEqual(2000);
    }
  });

  it("falls back to the CLI default when no known socket exists", () => {
    // No socket files at all: the bare invocation (no --socket) must still run,
    // so installs with a non-standard socket path keep working.
    mocks.existsSync.mockImplementation((p) => String(p).endsWith("tailscale"));
    getActualFunnelUrl(11434);

    expect(mocks.execSync).toHaveBeenCalled();
    expect(probedSockets()).toEqual([]);
  });
});
