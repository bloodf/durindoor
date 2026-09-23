import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSettingsSync: vi.fn() }));

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettingsSync: mocks.getSettingsSync
}));

import {
  DEFAULT_SERVER_HOST,
  resolveServerHost,
  warnIfInferenceServerExposed,
  warnIfNonLoopbackWithoutApiKey
} from "@/lib/startup/nonLoopbackApiKeyGuard.js";

describe("nonLoopbackApiKeyGuard", () => {
  let warnSpy;
  const originalHostname = process.env.HOSTNAME;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getSettingsSync.mockReset();
    delete process.env.HOSTNAME;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (originalHostname === undefined) delete process.env.HOSTNAME;
    else process.env.HOSTNAME = originalHostname;
  });

  it("resolves the loopback default when HOSTNAME is unset", () => {
    expect(resolveServerHost()).toBe(DEFAULT_SERVER_HOST);
    expect(DEFAULT_SERVER_HOST).toBe("127.0.0.1");
  });

  it("resolves HOSTNAME when the operator sets one", () => {
    process.env.HOSTNAME = "0.0.0.0";
    expect(resolveServerHost()).toBe("0.0.0.0");
  });

  it("warns on a non-loopback bind with requireApiKey off", () => {
    warnIfNonLoopbackWithoutApiKey("test server", "0.0.0.0", false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/non-loopback host "0\.0\.0\.0"/);
    expect(warnSpy.mock.calls[0][0]).toMatch(/requireApiKey/);
  });

  it("stays silent on loopback binds", () => {
    warnIfNonLoopbackWithoutApiKey("test server", "127.0.0.1", false);
    warnIfNonLoopbackWithoutApiKey("test server", "::1", false);
    warnIfNonLoopbackWithoutApiKey("test server", "localhost", false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("stays silent on a non-loopback bind once requireApiKey is on", () => {
    warnIfNonLoopbackWithoutApiKey("test server", "192.168.1.5", true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warnIfInferenceServerExposed reads the live setting and the bound host", async () => {
    process.env.HOSTNAME = "0.0.0.0";
    mocks.getSettingsSync.mockReturnValue({ requireApiKey: false });
    await warnIfInferenceServerExposed();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/Dashboard\/API server/);
  });

  it("warnIfInferenceServerExposed stays silent once requireApiKey is on", async () => {
    process.env.HOSTNAME = "0.0.0.0";
    mocks.getSettingsSync.mockReturnValue({ requireApiKey: true });
    await warnIfInferenceServerExposed();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warnIfInferenceServerExposed fails open when settings cannot be read", async () => {
    process.env.HOSTNAME = "0.0.0.0";
    mocks.getSettingsSync.mockImplementation(() => {
      throw new Error("db unavailable");
    });
    await expect(warnIfInferenceServerExposed()).resolves.toBeUndefined();
  });
});
