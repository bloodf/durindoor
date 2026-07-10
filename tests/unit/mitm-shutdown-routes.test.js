import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  killAppProcesses: vi.fn(),
  spawnUpdaterAndExit: vi.fn(),
  scheduleIntentionalHandoffExit: vi.fn(),
  stopMitmForUpdate: vi.fn(),
  exit: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init.status || 200 }),
  },
}));
vi.mock("next/headers", () => ({
  headers: () => ({ get: () => "Bearer fixture-secret" }),
}));
vi.mock("@/lib/appUpdater", () => ({
  killAppProcesses: mocks.killAppProcesses,
  spawnUpdaterAndExit: mocks.spawnUpdaterAndExit,
  scheduleIntentionalHandoffExit: mocks.scheduleIntentionalHandoffExit,
  stopMitmForUpdate: mocks.stopMitmForUpdate,
}));

const updateRoute = await import("../../src/app/api/version/update/route.js");
const versionShutdownRoute = await import("../../src/app/api/version/shutdown/route.js");
const devShutdownRoute = await import("../../src/app/api/shutdown/route.js");

describe("MITM-aware shutdown routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(process, "exit").mockImplementation(mocks.exit);
  });

  it("does not launch the updater when authenticated cleanup fails", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    mocks.killAppProcesses.mockRejectedValue(new Error("ownership unverified"));
    try {
      const response = await updateRoute.POST();
      expect(response.status).toBe(500);
      expect(mocks.spawnUpdaterAndExit).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("does not exit for manual-update shutdown when cleanup fails", async () => {
    mocks.killAppProcesses.mockRejectedValue(new Error("redirect quarantine"));
    const response = await versionShutdownRoute.POST();
    await vi.runAllTimersAsync();
    expect(response.status).toBe(500);
    expect(mocks.exit).not.toHaveBeenCalled();
    expect(mocks.scheduleIntentionalHandoffExit).not.toHaveBeenCalled();
  });

  it("uses the intentional worker handoff path after safe manual-update cleanup", async () => {
    mocks.killAppProcesses.mockResolvedValue(undefined);

    const response = await versionShutdownRoute.POST();

    expect(response.status).toBe(200);
    expect(mocks.scheduleIntentionalHandoffExit).toHaveBeenCalledWith(500);
  });

  it("does not exit the development server when MITM cleanup fails", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousSecret = process.env.SHUTDOWN_SECRET;
    process.env.NODE_ENV = "development";
    process.env.SHUTDOWN_SECRET = "fixture-secret";
    mocks.stopMitmForUpdate.mockRejectedValue(new Error("hosts cleanup denied"));
    try {
      const response = await devShutdownRoute.POST();
      await vi.runAllTimersAsync();
      expect(response.status).toBe(500);
      expect(mocks.exit).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousSecret === undefined) delete process.env.SHUTDOWN_SECRET;
      else process.env.SHUTDOWN_SECRET = previousSecret;
    }
  });
});
