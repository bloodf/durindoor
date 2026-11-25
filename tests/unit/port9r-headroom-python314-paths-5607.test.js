// Port of decolua/9router#5607 (headroom): Windows PATH extras include Python
// 3.14 Scripts dirs and top-level C:\PythonXYZ installs.
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(() => { throw new Error("not found"); }),
  execFile: vi.fn(),
  execFileSync: vi.fn(() => Buffer.from(JSON.stringify({ version: "0.26.0", extras: {} }))),
}));
vi.mock("child_process", () => ({ execSync: mocks.execSync, execFile: mocks.execFile, execFileSync: mocks.execFileSync }));

const realPlatform = Object.getOwnPropertyDescriptor(process, "platform");
afterEach(() => {
  Object.defineProperty(process, "platform", realPlatform);
  vi.resetModules();
  vi.clearAllMocks();
});

describe("headroom Windows PATH extras (#5607)", () => {
  it("probes with Python 3.14 Scripts and C:\\Python3xx on the PATH", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    vi.resetModules();
    const { getInstalledHeadroomExtras } = await import("../../src/lib/headroom/detect.js");
    getInstalledHeadroomExtras("python");
    const env = mocks.execFileSync.mock.calls[0][2].env;
    expect(env.PATH).toContain("Python314\\Scripts");
    expect(env.PATH).toContain("C:\\Python314");
    expect(env.PATH).toContain("C:\\Python310");
  });
});
