import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
async function flush() { await new Promise((r) => setTimeout(r, 50)); }
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pxpipe-events-"));
vi.stubEnv("DATA_DIR", tmp);
const { appendPxpipeEvent, getPxpipeStats } = await import("../../src/lib/pxpipe/events.js");

function clearEvents() {
  const dir = path.join(tmp, "pxpipe");
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
}

describe("PXPIPE timeline", () => {
  beforeEach(clearEvents);
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("distinguishes padded no-event days from real zero-savings days", async () => {
    // appendPxpipeEvent stamps the event with the current time, so use today
    // to land a real event in the active timeline bucket.
    const today = Date.now();
    appendPxpipeEvent({ applied: false, reason: "unsupported_model", ts: today });
    await flush();

    const stats = getPxpipeStats();
    const todayKey = new Date(today).toISOString().slice(0, 10);
    const realZero = stats.timeline.find((day) => day.date === todayKey);
    const noEvent = stats.timeline.find((day) => day.requests === 0);

    expect(realZero).toBeDefined();
    expect(realZero.requests).toBe(1);
    expect(realZero.tokensSavedEst).toBe(0);
    expect(noEvent?.tokensSavedEst).toBeNull();
  });
});
