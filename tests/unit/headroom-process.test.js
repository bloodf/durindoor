import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/headroom-process-test" }));
vi.mock("../../src/lib/headroom/detect.js", () => ({
  findHeadroomBinary: vi.fn(() => "/usr/bin/headroom"),
  findPython310: vi.fn(),
  HEADROOM_COMPRESSION_EXTRAS: ["code", "ml"],
  getInstalledHeadroomExtras: vi.fn(),
}));

import { startHeadroomProxy } from "../../src/lib/headroom/process.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  mocks.spawn.mockReset();
});

describe("startHeadroomProxy", () => {
  it("disables Kompress by default", async () => {
    vi.useFakeTimers();
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const child = new EventEmitter();
    child.pid = 1234;
    child.unref = vi.fn();
    mocks.spawn.mockReturnValue(child);

    const started = startHeadroomProxy();
    await vi.advanceTimersByTimeAsync(8000);
    await started;

    expect(mocks.spawn).toHaveBeenCalledWith(
      "/usr/bin/headroom",
      ["proxy", "--port", "8787", "--disable-kompress"],
      expect.any(Object),
    );
  });
});
