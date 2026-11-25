import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  findHeadroomBinary: vi.fn(),
  getSettings: vi.fn(),
  fs: {
    existsSync: vi.fn(() => false), mkdirSync: vi.fn(), openSync: vi.fn(() => 17),
    closeSync: vi.fn(), writeFileSync: vi.fn(), readFileSync: vi.fn(() => ""), unlinkSync: vi.fn(),
  },
}));

vi.mock("child_process", () => ({ spawn: mocks.spawn, execFileSync: vi.fn(), execSync: vi.fn() }));
vi.mock("fs", () => ({ default: mocks.fs, ...mocks.fs }));
vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/port-5850-headroom" }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("../../src/lib/headroom/pythonEnv.js", () => ({ ensureManagedVenv: vi.fn(), managedVenvBinary: () => null }));
vi.mock("../../src/lib/headroom/detect.js", async (importOriginal) => ({
  ...await importOriginal(), findHeadroomBinary: mocks.findHeadroomBinary,
}));

import { startHeadroomProxy } from "../../src/lib/headroom/process.js";

const url = "http://127.0.0.1:9878";
const external = { running: true, external: true, alreadyRunning: true };
const up = () => new Response();
const down = () => new Response(null, { status: 503 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findHeadroomBinary.mockReturnValue("headroom");
  mocks.fs.existsSync.mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function spawnThatExitsEarly() {
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { pid: 123, unref: vi.fn() });
    setImmediate(() => child.emit("exit", 3));
    return child;
  });
}

describe("9router#5850 externally managed Headroom proxy", () => {
  it("reuses a healthy external proxy without a local CLI", async () => {
    mocks.findHeadroomBinary.mockReturnValue(null);
    fetch.mockResolvedValueOnce(up());
    await expect(startHeadroomProxy({ url, port: 9878 })).resolves.toEqual(external);
    expect(fetch).toHaveBeenCalledWith(`${url}/health`, { signal: expect.any(AbortSignal) });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("keeps reporting the managed PID without probing", async () => {
    mocks.fs.existsSync.mockReturnValue(true);
    mocks.fs.readFileSync.mockReturnValue(String(process.pid));
    await expect(startHeadroomProxy({ url })).resolves.toMatchObject({ pid: process.pid, alreadyRunning: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("returns the external proxy when it wins a startup race", async () => {
    fetch.mockResolvedValueOnce(down()).mockResolvedValueOnce(up());
    spawnThatExitsEarly();
    await expect(startHeadroomProxy({ url, port: 9878 })).resolves.toEqual(external);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("keeps the early exit error when nothing answers", async () => {
    fetch.mockImplementation(async () => down());
    spawnThatExitsEarly();
    await expect(startHeadroomProxy({ url, port: 9878 })).rejects.toMatchObject({ code: "EARLY_EXIT" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("lets the start route succeed against a healthy external proxy with no CLI", async () => {
    mocks.findHeadroomBinary.mockReturnValue(null);
    mocks.getSettings.mockResolvedValue({ headroomUrl: url });
    fetch.mockResolvedValueOnce(up());
    const { POST } = await import("../../src/app/api/headroom/start/route.js");
    const response = await POST();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, ...external });
  });
});
