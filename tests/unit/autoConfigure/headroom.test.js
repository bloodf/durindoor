import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureHeadroom } from "../../../src/lib/autoConfigure/headroom.js";
import * as detectModule from "../../../src/lib/headroom/detect.js";
import * as processModule from "../../../src/lib/headroom/process.js";

vi.mock("../../../src/lib/headroom/detect.js", async () => {
  const actual = await vi.importActual("../../../src/lib/headroom/detect.js");
  return {
    ...actual,
    getHeadroomStatus: vi.fn(),
    findHeadroomBinary: vi.fn(),
  };
});

vi.mock("../../../src/lib/headroom/process.js", () => ({
  startHeadroomProxy: vi.fn(),
}));

describe("configureHeadroom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processModule.startHeadroomProxy.mockResolvedValue({ alreadyRunning: false });
  });

  it("starts headroom proxy after a fresh install", async () => {
    detectModule.getHeadroomStatus.mockResolvedValue({
      installed: false,
      running: false,
      python: "python3",
      path: null,
      localUrl: true,
    });
    detectModule.findHeadroomBinary
      .mockReturnValueOnce(null)
      .mockReturnValueOnce("/usr/bin/headroom");

    const res = await configureHeadroom({
      headroomEnabled: false,
      headroomUrl: "",
      headroomCompressUserMessages: false,
    }, { url: "http://localhost:8787", install: vi.fn().mockResolvedValue({ installed: true, method: "pip" }) });
    expect(res.installed).toBe(true);
    expect(res.running).toBe(true);
    expect(res.changed).toBe(true);
    expect(processModule.startHeadroomProxy).toHaveBeenCalledWith({ port: 8787 });
    expect(res.updates.headroomUrl).toBe("http://localhost:8787");
  });

  it("preserves a reachable configured headroomUrl without a local CLI", async () => {
    detectModule.getHeadroomStatus.mockResolvedValue({
      installed: false,
      running: true,
      python: null,
      path: null,
      localUrl: false,
    });
    detectModule.findHeadroomBinary.mockReturnValue(null);

    const res = await configureHeadroom({
      headroomEnabled: false,
      headroomUrl: "http://headroom.example.com",
      headroomCompressUserMessages: false,
    });
    expect(res.installed).toBe(false);
    expect(res.running).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.updates.headroomUrl).toBe("http://headroom.example.com");
    expect(processModule.startHeadroomProxy).not.toHaveBeenCalled();
  });

  it("does not enable when proxy start fails after install", async () => {
    detectModule.getHeadroomStatus.mockResolvedValue({
      installed: false,
      running: false,
      python: "python3",
      path: null,
      localUrl: true,
    });
    detectModule.findHeadroomBinary
      .mockReturnValueOnce(null)
      .mockReturnValueOnce("/usr/bin/headroom");
    processModule.startHeadroomProxy.mockRejectedValue(new Error("port in use"));

    const res = await configureHeadroom({
      headroomEnabled: false,
      headroomUrl: "",
      headroomCompressUserMessages: false,
    }, { url: "http://localhost:8787", install: vi.fn().mockResolvedValue({ installed: true, method: "pip" }) });
    expect(res.installed).toBe(true);
    expect(res.running).toBe(false);
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
  });

  it("skips settings when headroom not installed and no install path", async () => {
    detectModule.getHeadroomStatus.mockResolvedValue({
      installed: false,
      running: false,
      python: null,
      path: null,
      localUrl: true,
    });
    detectModule.findHeadroomBinary.mockReturnValue(null);

    const res = await configureHeadroom({ headroomEnabled: false, headroomUrl: "", headroomCompressUserMessages: false }, { install: vi.fn().mockResolvedValue({ installed: false, error: "No install path" }) });
    expect(res.installed).toBe(false);
    expect(res.wouldChange).toBe(false);
    expect(res.changed).toBe(false);
    expect(res.updates).toEqual({});
  });

  it("enables when headroom is already installed", async () => {
    detectModule.getHeadroomStatus.mockResolvedValue({
      installed: true,
      running: true,
      python: "python3",
      path: "/usr/bin/headroom",
      localUrl: true,
    });
    detectModule.findHeadroomBinary.mockReturnValue("/usr/bin/headroom");

    const res = await configureHeadroom({
      headroomEnabled: false,
      headroomUrl: "",
      headroomCompressUserMessages: false,
    }, { url: "http://localhost:8787" });
    expect(res.installed).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.updates).toEqual({
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: true,
    });
  });

  it("is idempotent when already configured", async () => {
    detectModule.getHeadroomStatus.mockResolvedValue({
      installed: true,
      running: true,
      python: "python3",
      path: "/usr/bin/headroom",
      localUrl: true,
    });
    detectModule.findHeadroomBinary.mockReturnValue("/usr/bin/headroom");

    const res = await configureHeadroom({
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: true,
    }, { url: "http://localhost:8787" });
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
  });
});
