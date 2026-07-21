import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "path";
import os from "os";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-events-"));
vi.stubEnv("DATA_DIR", tmp);

const { appendHeadroomEvent, getHeadroomStats } = await import("../../src/lib/headroom/events.js");

async function flush() {
  await new Promise((r) => setTimeout(r, 50));
}

function clearEvents() {
  const dir = path.join(tmp, "headroom");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, f));
  }
}

describe("headroom events", () => {
  beforeEach(() => {
    clearEvents();
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("records a successful compression event", async () => {
    appendHeadroomEvent({
      provider: "openai",
      model: "gpt-4o",
      applied: true,
      tokensBefore: 1000,
      tokensAfter: 700,
      tokensSaved: 300,
      durationMs: 42,
    });
    await flush();

    const stats = getHeadroomStats();
    expect(stats.windows.all.compressed).toBe(1);
    expect(stats.windows.all.tokensSaved).toBe(300);
    expect(stats.windows.all.avgCompressionMs).toBe(42);
  });

  it("classifies request failures as errors", async () => {
    appendHeadroomEvent({ applied: false, reason: "request_failed: ECONNREFUSED" });
    appendHeadroomEvent({ applied: false, reason: "unexpected_error: boom" });
    appendHeadroomEvent({ applied: false, reason: "timeout" });
    appendHeadroomEvent({ applied: false, reason: "disabled" });
    await flush();

    const stats = getHeadroomStats();
    expect(stats.windows.all.errors).toBe(3);
    expect(stats.windows.all.bypassed).toBe(1);
    expect(stats.windows.all.requests).toBe(4);
  });

  it("returns recent events in reverse chronological order", async () => {
    appendHeadroomEvent({ applied: true, tokensBefore: 10, tokensSaved: 1 });
    await flush();
    appendHeadroomEvent({ applied: true, tokensBefore: 20, tokensSaved: 2 });
    await flush();

    const stats = getHeadroomStats({ recentLimit: 2 });
    expect(stats.recent).toHaveLength(2);
    expect(stats.recent[0].tokensBefore).toBe(20);
    expect(stats.recent[1].tokensBefore).toBe(10);
  });

  it("aggregates daily timeline", async () => {
    const today = Date.now();
    appendHeadroomEvent({ applied: true, tokensSaved: 100, ts: today });
    await flush();

    const stats = getHeadroomStats();
    const todayKey = new Date(today).toISOString().slice(0, 10);
    const bucket = stats.timeline.find((d) => d.date === todayKey);
    expect(bucket).toBeDefined();
    expect(bucket.tokensSaved).toBe(100);
    expect(bucket.compressed).toBe(1);
  });

  it("distinguishes padded no-event days from real zero-savings days", async () => {
    // appendHeadroomEvent stamps the event with the current time, so use
    // today's window to land a real event in the active timeline bucket.
    const today = Date.now();
    appendHeadroomEvent({ applied: false, reason: "skipped", ts: today });
    await flush();

    const stats = getHeadroomStats();
    const todayKey = new Date(today).toISOString().slice(0, 10);
    const realZero = stats.timeline.find((d) => d.date === todayKey);
    const noEvent = stats.timeline.find((d) => d.requests === 0);

    expect(realZero).toBeDefined();
    expect(realZero.requests).toBe(1);
    expect(realZero.tokensSaved).toBe(0);
    expect(noEvent?.tokensSaved).toBeNull();
  });

  it("preserves all-time totals across multiple log rotations", async () => {
    const dir = path.join(tmp, "headroom");
    fs.mkdirSync(dir, { recursive: true });
    const padding = Buffer.alloc(6 * 1024 * 1024, "x").toString();
    fs.writeFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify({ applied: true, tokensSaved: 1, ts: Date.now() }) + "\n"}${padding}\n`, { flag: "w" });

    appendHeadroomEvent({ applied: true, tokensSaved: 2 });
    await flush();

    // Force a second rotation by appending more padding to the active file.
    fs.appendFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify({ applied: true, tokensSaved: 4, ts: Date.now() }) + "\n"}${padding}\n`);
    appendHeadroomEvent({ applied: true, tokensSaved: 8 });
    await flush();

    const stats = getHeadroomStats();
    expect(stats.windows.all.tokensSaved).toBe(15);
    expect(stats.windows.all.compressed).toBe(4);
  });

  it("aborts rotation when the rotated file cannot be read", async () => {
    const dir = path.join(tmp, "headroom");
    fs.mkdirSync(dir, { recursive: true });
    const padding = Buffer.alloc(6 * 1024 * 1024, "x").toString();
    fs.writeFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify({ applied: true, tokensSaved: 100, ts: Date.now() }) + "\n"}${padding}\n`, { flag: "w" });
    fs.writeFileSync(path.join(dir, "events.jsonl.1"), `${JSON.stringify({ applied: true, tokensSaved: 50, ts: Date.now() }) + "\n"}`);

    const original = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
      if (String(file).endsWith("events.jsonl.1")) {
        throw new Error("rotated read denied");
      }
      return original(file, ...args);
    });

    appendHeadroomEvent({ applied: true, tokensSaved: 2 });
    await flush();
    spy.mockRestore();

    const stats = getHeadroomStats();
    // The rotated file must still be readable because rotation aborted.
    expect(stats.windows.all.tokensSaved).toBe(152);
    expect(stats.windows.all.compressed).toBe(3);
  });

  it("aborts rotation when metadata cannot be persisted", async () => {
    const dir = path.join(tmp, "headroom");
    fs.mkdirSync(dir, { recursive: true });
    const padding = Buffer.alloc(6 * 1024 * 1024, "x").toString();
    fs.writeFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify({ applied: true, tokensSaved: 100, ts: Date.now() }) + "\n"}${padding}\n`, { flag: "w" });

    const original = fs.writeFileSync;
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation((file, ...args) => {
      if (String(file).includes("events-meta.json.tmp.")) {
        throw new Error("metadata write denied");
      }
      return original(file, ...args);
    });

    appendHeadroomEvent({ applied: true, tokensSaved: 2 });
    await flush();
    spy.mockRestore();

    const stats = getHeadroomStats();
    // The active file was not renamed, so all events are still readable and counted.
    expect(stats.windows.all.tokensSaved).toBe(102);
    expect(stats.windows.all.compressed).toBe(2);
  });

  it("skips a rotated file that is already folded into metadata", async () => {
    const dir = path.join(tmp, "headroom");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "events.jsonl.1"), `${JSON.stringify({ applied: true, tokensSaved: 100, ts: Date.now() }) + "\n"}`);
    const ino = fs.statSync(path.join(dir, "events.jsonl.1")).ino;
    fs.writeFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify({ applied: true, tokensSaved: 10, ts: Date.now() }) + "\n"}`);
    fs.writeFileSync(path.join(dir, "events-meta.json"), JSON.stringify({ all: { requests: 1, compressed: 1, bypassed: 0, errors: 0, tokensBefore: 0, tokensAfter: 0, tokensSaved: 100, compressionTimeMs: 0 }, lastFoldedIno: ino }));

    const stats = getHeadroomStats();
    expect(stats.windows.all.tokensSaved).toBe(110);
    expect(stats.windows.all.compressed).toBe(2);
  });

  it("classifies classifier-style diagnostic reasons as errors", async () => {
    appendHeadroomEvent({ applied: false, reason: "http-error" });
    appendHeadroomEvent({ applied: false, reason: "translation-failed" });
    appendHeadroomEvent({ applied: false, reason: "invalid-proxy-response" });
    appendHeadroomEvent({ applied: false, reason: "unexpected-error" });
    appendHeadroomEvent({ applied: false, reason: "missing-proxy-url" });
    await flush();

    const stats = getHeadroomStats();
    expect(stats.windows.all.errors).toBe(4);
    expect(stats.windows.all.bypassed).toBe(1);
    expect(stats.windows.all.requests).toBe(5);
  });

  it("rotates the log file when it exceeds the size threshold", async () => {
    const dir = path.join(tmp, "headroom");
    fs.mkdirSync(dir, { recursive: true });
    const big = Buffer.alloc(6 * 1024 * 1024, "x").toString();
    fs.writeFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify({ applied: true, tokensSaved: 1, ts: Date.now() }) + "\n"}${big}\n`, { flag: "w" });

    appendHeadroomEvent({ applied: true, tokensSaved: 2 });
    await flush();

    const stats = getHeadroomStats();
    expect(stats.windows.all.tokensSaved).toBe(3);
    expect(stats.windows.all.compressed).toBe(2);
  });

  it("skips events with an invalid timestamp", async () => {
    const dir = path.join(tmp, "headroom");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "events.jsonl"),
      `${JSON.stringify({ applied: true, tokensSaved: 999, ts: "bad" }) + "\n"}${JSON.stringify({ applied: true, tokensSaved: 111, ts: Date.now() }) + "\n"}`,
      { flag: "w" }
    );
    appendHeadroomEvent({ applied: true, tokensSaved: 2 });
    await flush();

    const stats = getHeadroomStats();
    expect(stats.windows.all.tokensSaved).toBe(113);
    expect(stats.windows.all.compressed).toBe(2);
  });
});
