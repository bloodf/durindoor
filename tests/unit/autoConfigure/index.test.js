import { describe, it, expect, vi } from "vitest";
import { runAutoConfigure, getAutoConfigureStatus } from "../../../src/lib/autoConfigure/index.js";

vi.mock("../../../src/lib/autoConfigure/headroom.js", async () => ({
  configureHeadroom: vi.fn(),
}));

vi.mock("../../../src/lib/autoConfigure/pxpipe.js", async () => ({
  configurePxpipe: vi.fn(),
}));

vi.mock("../../../src/lib/autoConfigure/firecrawl.js", async () => ({
  configureFirecrawl: vi.fn(),
}));

vi.mock("../../../src/lib/autoConfigure/toggles.js", async () => ({
  configureToggles: vi.fn(),
}));

import { configureHeadroom } from "../../../src/lib/autoConfigure/headroom.js";
import { configurePxpipe } from "../../../src/lib/autoConfigure/pxpipe.js";
import { configureFirecrawl } from "../../../src/lib/autoConfigure/firecrawl.js";
import { configureToggles } from "../../../src/lib/autoConfigure/toggles.js";

describe("runAutoConfigure", () => {
  it("aggregates service reports and returns changed", async () => {
    configureHeadroom.mockResolvedValue({ changed: true, wouldChange: true, updates: { headroomEnabled: true }, actions: ["headroom"] });
    configurePxpipe.mockReturnValue({ changed: false, wouldChange: false, updates: {}, actions: [] });
    configureFirecrawl.mockResolvedValue({ changed: true, wouldChange: true, updates: { firecrawlBaseUrl: "http://127.0.0.1:3002" }, actions: ["firecrawl"], connection: null });
    configureToggles.mockReturnValue({ changed: false, wouldChange: false, updates: {}, actions: [] });

    const report = await runAutoConfigure({}, { firecrawl: { probe: vi.fn() } });
    expect(report.changed).toBe(true);
    expect(report.updates).toEqual({ headroomEnabled: true, firecrawlBaseUrl: "http://127.0.0.1:3002" });
  });

  it("dry-run does not claim changed when services would change", async () => {
    configureHeadroom.mockResolvedValue({ changed: false, wouldChange: true, updates: {}, actions: [] });
    configurePxpipe.mockReturnValue({ changed: false, wouldChange: false, updates: {}, actions: [] });
    configureFirecrawl.mockResolvedValue({ changed: false, wouldChange: true, updates: {}, actions: [], connection: null });
    configureToggles.mockReturnValue({ changed: false, wouldChange: false, updates: {}, actions: [] });

    const report = await runAutoConfigure({}, { dryRun: true, firecrawl: { probe: vi.fn() } });
    expect(report.changed).toBe(false);
  });

  it("getAutoConfigureStatus returns wouldChange", async () => {
    configureHeadroom.mockResolvedValue({ changed: false, wouldChange: true, updates: {}, actions: ["a"] });
    configurePxpipe.mockReturnValue({ changed: false, wouldChange: false, updates: {}, actions: [] });
    configureFirecrawl.mockResolvedValue({ changed: false, wouldChange: false, updates: {}, actions: [], connection: null });
    configureToggles.mockReturnValue({ changed: false, wouldChange: false, updates: {}, actions: [] });

    const status = await getAutoConfigureStatus({}, { firecrawl: { probe: vi.fn() } });
    expect(status.wouldChange).toBe(true);
  });
});
