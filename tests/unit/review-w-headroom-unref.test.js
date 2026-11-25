import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  fs: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    openSync: vi.fn(() => 17),
    closeSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

vi.mock("child_process", () => ({ spawn: mocks.spawn }));
vi.mock("fs", () => ({ default: mocks.fs, ...mocks.fs }));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/review-w-headroom-unref" }));
vi.mock("../../src/lib/headroom/pythonEnv.js", () => ({
  managedVenvBinary: vi.fn(() => null),
}));
vi.mock("../../src/lib/headroom/detect.js", () => ({
  findHeadroomBinary: vi.fn(() => "/stub/headroom"),
}));

import { startHeadroomProxy } from "../../src/lib/headroom/process.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.fs.existsSync.mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.spawn.mockReset();
});

describe("Headroom proxy event-loop ownership", () => {
  it("unrefs the child after its startup probe while returning its managed pid", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const child = new EventEmitter();
    child.pid = 4321;
    child.unref = vi.fn();
    mocks.spawn.mockReturnValue(child);

    const started = startHeadroomProxy();
    await vi.advanceTimersByTimeAsync(8000);
    await expect(started).resolves.toMatchObject({ pid: 4321, alreadyRunning: false });

    expect(mocks.spawn).toHaveBeenCalledWith(
      "/stub/headroom",
      ["proxy", "--port", "8787", "--disable-kompress"],
      expect.any(Object),
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
