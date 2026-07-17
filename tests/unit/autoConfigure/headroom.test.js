import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureHeadroom } from "../../../src/lib/autoConfigure/headroom.js";
import * as detectModule from "../../../src/lib/headroom/detect.js";

vi.mock("../../../src/lib/headroom/detect.js", async () => {
  const actual = await vi.importActual("../../../src/lib/headroom/detect.js");
  return {
    ...actual,
    getHeadroomStatus: vi.fn(),
    findHeadroomBinary: vi.fn(),
  };
});

describe("configureHeadroom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const res = await configureHeadroom({ headroomEnabled: false, headroomUrl: "", headroomCompressUserMessages: false });
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
