import { describe, it, expect, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(() => { throw new Error("not found"); }),
  execFile: vi.fn(() => ({ toString: () => "[object Object]" })),
  execFileSync: vi.fn(() => Buffer.from(JSON.stringify([
    { name: "headroom-ai", version: "0.26.0" },
    { name: "tree-sitter", version: "0.25.0" },
  ]))),
}));

vi.mock("child_process", () => ({
  execSync: mocks.execSync,
  execFile: mocks.execFile,
  execFileSync: mocks.execFileSync,
}));

import { findPython310, getHeadroomStatus, getInstalledHeadroomExtras, isLoopbackHeadroomUrl } from "../../src/lib/headroom/detect.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("headroom detect", () => {
  it("falls back to pip list when the importlib probe cannot run", () => {
    // The importlib `-c` probe is the primary path now (a uv-managed venv has
    // no pip at all); pip list only answers when that probe fails outright.
    mocks.execFileSync.mockImplementation((py, args) => {
      if (args[0] === "-c") throw new Error("interpreter cannot run the probe");
      if (args.join(" ").startsWith("-m pip list")) {
        return Buffer.from(JSON.stringify([
          { name: "headroom-ai", version: "0.26.0" },
          { name: "tree-sitter", version: "0.25.0" },
        ]));
      }
      throw new Error(`unexpected execFileSync: ${py} ${args.join(" ")}`);
    });

    const result = getInstalledHeadroomExtras("python3");

    expect(mocks.execFileSync).toHaveBeenCalledWith(
      "python3",
      ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"],
      expect.objectContaining({ windowsHide: true, timeout: 8000 }),
    );
    expect(result).toEqual({
      installed: true,
      version: "0.26.0",
      extras: { code: true, ml: false },
    });
  });

  it("reads version and extras through importlib without touching pip", () => {
    mocks.execFileSync.mockImplementation((py, args) => {
      if (args[0] === "-c") {
        return Buffer.from(JSON.stringify({ version: "0.36.1", extras: { code: true, ml: true } }));
      }
      throw new Error(`pip must not be used: ${py} ${args.join(" ")}`);
    });

    expect(getInstalledHeadroomExtras("python3")).toEqual({
      installed: true,
      version: "0.36.1",
      extras: { code: true, ml: true },
    });
    const pipCalls = mocks.execFileSync.mock.calls.filter(([, args]) => args.includes("pip"));
    expect(pipCalls).toHaveLength(0);
  });

  it("accepts a supported interpreter that has no headroom-ai visible to pip", () => {
    // Regression: the old findPython310() required `pip show headroom-ai` to
    // succeed, so a headroom installed in a separate uv tool venv (which has
    // no pip) made a perfectly good Python report as missing.
    // Fictitious path: fs.realpathSync is deliberately NOT mocked here, so a
    // real /usr/bin/python3 would resolve through its symlink to python3.14.
    mocks.execFileSync.mockImplementation((cmd, args) => {
      if (cmd === "which" || cmd === "where") {
        if (args[0] === "python3") return Buffer.from("/opt/durindoor-fixture/bin/python3\n");
        throw new Error("not found");
      }
      if (args[0] === "-c") return Buffer.from(JSON.stringify({ major: 3, minor: 14, em: true }));
      throw new Error(`unexpected execFileSync: ${cmd} ${args.join(" ")}`);
    });

    expect(findPython310()).toBe("/opt/durindoor-fixture/bin/python3");
    const headroomProbes = mocks.execFileSync.mock.calls
      .filter(([, args]) => args.join(" ").includes("headroom-ai"));
    expect(headroomProbes).toHaveLength(0);
  });

  it("treats a reachable external proxy as running without local CLI", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    mocks.execSync.mockImplementation((cmd) => {
      if (String(cmd).includes("where") || String(cmd).includes("which")) throw new Error("not found");
      throw new Error("unexpected execSync");
    });
    mocks.execFileSync.mockImplementation(() => { throw new Error("pip unavailable"); });

    const status = await getHeadroomStatus("http://headroom:8787");

    expect(status.installed).toBe(false);
    expect(status.running).toBe(true);
    expect(status.localUrl).toBe(false);
    expect(status.canStart).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/health", expect.any(Object));
  });

  it("recognizes loopback URLs for managed local mode", () => {
    expect(isLoopbackHeadroomUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://headroom:8787")).toBe(false);
    expect(isLoopbackHeadroomUrl("not-a-url")).toBe(false);
  });
});
