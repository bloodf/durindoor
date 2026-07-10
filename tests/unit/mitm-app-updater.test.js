import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import processExitCodes from "../../src/shared/constants/processExitCodes.js";

const { stopServer, getCachedPassword, loadEncryptedPassword } = vi.hoisted(() => ({
  stopServer: vi.fn(),
  getCachedPassword: vi.fn(),
  loadEncryptedPassword: vi.fn(),
}));

vi.mock("@/mitm/manager", () => ({
  stopServer,
  getCachedPassword,
  loadEncryptedPassword,
}));

const { scheduleIntentionalHandoffExit, stopMitmForUpdate } = await import("../../src/lib/appUpdater.js");

describe("application updater MITM shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopServer.mockResolvedValue({ running: false, pid: null });
    getCachedPassword.mockReturnValue(null);
    loadEncryptedPassword.mockResolvedValue("stored-password");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses the manager's gated authenticated stop path", async () => {
    await expect(stopMitmForUpdate()).resolves.toBeUndefined();
    expect(loadEncryptedPassword).toHaveBeenCalledTimes(1);
    expect(stopServer).toHaveBeenCalledWith(null, { preserveDesiredState: true });
  });

  it("uses only the in-memory cached password after purging legacy storage", async () => {
    getCachedPassword.mockReturnValue("cached-password");

    await expect(stopMitmForUpdate()).resolves.toBeUndefined();

    expect(stopServer).toHaveBeenCalledWith("cached-password", { preserveDesiredState: true });
    expect(stopServer).not.toHaveBeenCalledWith("stored-password", expect.anything());
  });

  it("propagates ownership failures instead of falling back to a raw PID kill", async () => {
    const failure = Object.assign(new Error("ownership unverified"), {
      code: "MITM_OWNERSHIP_UNVERIFIED",
    });
    stopServer.mockRejectedValue(failure);
    await expect(stopMitmForUpdate()).rejects.toBe(failure);
  });

  it("uses the reserved CLI handoff code for an intentional worker exit", async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {});

    scheduleIntentionalHandoffExit(25);
    await vi.advanceTimersByTimeAsync(25);

    expect(exit).toHaveBeenCalledWith(processExitCodes.INTENTIONAL_HANDOFF_EXIT_CODE);
  });
});
