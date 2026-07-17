import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRefreshSpacingMs,
  rotationGroupFor,
  serializeRefresh,
} from "../../open-sse/services/refreshSerializer.js";

// Drain the shared group lanes between tests so spacing timers from a prior
// case cannot leak into the next one.
async function flushMicrotasks(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

describe("refresh serializer", () => {
  beforeEach(() => {
    delete process.env.CODEX_REFRESH_SPACING_MS;
  });

  afterEach(async () => {
    vi.useRealTimers();
    delete process.env.CODEX_REFRESH_SPACING_MS;
    await flushMicrotasks();
  });

  it("maps sibling Auth0 providers to one shared rotation group", () => {
    expect(rotationGroupFor("codex")).toBe("openai-auth0");
    expect(rotationGroupFor("openai")).toBe("openai-auth0");
    expect(rotationGroupFor("claude")).toBe("anthropic-oauth");
    expect(rotationGroupFor("github")).toBeNull();
    expect(rotationGroupFor("unknown-provider")).toBeNull();
  });

  it("passes non-rotating providers straight through with no locking", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const run = () => serializeRefresh("github", async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent -= 1;
      return "ok";
    });

    await expect(Promise.all([run(), run()])).resolves.toEqual(["ok", "ok"]);
    expect(maxConcurrent).toBe(2);
  });

  it("serializes concurrent refreshes across different connections of the same rotation group", async () => {
    process.env.CODEX_REFRESH_SPACING_MS = "0";
    const events = [];
    const run = (id) => serializeRefresh("codex", async () => {
      events.push(`start:${id}`);
      await flushMicrotasks(3);
      events.push(`end:${id}`);
      return id;
    });

    const results = await Promise.all([run("conn-a"), run("conn-b"), run("conn-c")]);

    expect(results).toEqual(["conn-a", "conn-b", "conn-c"]);
    // Strict lane discipline: every start only happens after the previous end.
    expect(events).toEqual([
      "start:conn-a", "end:conn-a",
      "start:conn-b", "end:conn-b",
      "start:conn-c", "end:conn-c",
    ]);
  });

  it("shares one lane between codex and openai (same Auth0 backend)", async () => {
    process.env.CODEX_REFRESH_SPACING_MS = "0";
    const events = [];
    const codex = serializeRefresh("codex", async () => {
      events.push("start:codex");
      await flushMicrotasks(3);
      events.push("end:codex");
    });
    const openai = serializeRefresh("openai", async () => {
      events.push("start:openai");
      events.push("end:openai");
    });

    await Promise.all([codex, openai]);

    expect(events).toEqual(["start:codex", "end:codex", "start:openai", "end:openai"]);
  });

  it("runs different rotation groups concurrently", async () => {
    let releaseCodex;
    const codex = serializeRefresh("codex", async () => {
      await new Promise((resolve) => { releaseCodex = resolve; });
    });
    let claudeStarted = false;
    const claude = serializeRefresh("claude", async () => {
      claudeStarted = true;
    });

    await flushMicrotasks();
    // Claude's lane is independent: its fn ran while codex still holds its lane.
    expect(claudeStarted).toBe(true);
    releaseCodex();
    await Promise.all([codex, claude]);
  });

  it("releases a lone refresh immediately — no settle gap when nobody is queued", async () => {
    vi.useFakeTimers();
    let resolved = false;
    const pending = serializeRefresh("codex", async () => "done").then((value) => {
      resolved = value;
      return value;
    });

    await flushMicrotasks();

    expect(resolved).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
    await pending;
  });

  it("pays the 2000ms settle gap only when a sibling is queued behind", async () => {
    vi.useFakeTimers();
    const events = [];

    // Enqueue both refreshes back-to-back so the sibling chains onto the lane
    // before the first refresh finishes — otherwise the first is a lone
    // refresh and (correctly) pays no gap.
    const first = serializeRefresh("codex", async () => {
      events.push("first:start");
      await flushMicrotasks(2);
      events.push("first:end");
    });
    const second = serializeRefresh("codex", async () => {
      events.push("second:start");
      return "second";
    });

    await flushMicrotasks(10);
    // First finished its fn but holds the lane for the settle gap; second has
    // not started and a 2000ms timer is pending.
    expect(events).toEqual(["first:start", "first:end"]);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1999);
    await flushMicrotasks(5);
    expect(events).toEqual(["first:start", "first:end"]);

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks(5);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe("second");
  });

  it("honors CODEX_REFRESH_SPACING_MS=0 as an opt-out even with a sibling queued", async () => {
    vi.useFakeTimers();
    process.env.CODEX_REFRESH_SPACING_MS = "0";

    // Same back-to-back enqueue: the sibling must already be chained when the
    // first refresh finishes, and with spacing 0 no timer may be scheduled.
    const first = serializeRefresh("codex", async () => {
      await flushMicrotasks(2);
    });
    const second = serializeRefresh("codex", async () => "second");

    await flushMicrotasks(10);

    expect(vi.getTimerCount()).toBe(0);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe("second");
  });

  it("keeps the queue flowing after a failed refresh", async () => {
    process.env.CODEX_REFRESH_SPACING_MS = "0";
    const failure = serializeRefresh("codex", async () => {
      throw new Error("refresh_token_reused");
    });
    const next = serializeRefresh("codex", async () => "recovered");

    await expect(failure).rejects.toThrow("refresh_token_reused");
    await expect(next).resolves.toBe("recovered");
  });

  it("defaults the spacing to 2000ms and falls back on unparseable env", () => {
    expect(getRefreshSpacingMs()).toBe(2000);
    process.env.CODEX_REFRESH_SPACING_MS = "";
    expect(getRefreshSpacingMs()).toBe(2000);
    process.env.CODEX_REFRESH_SPACING_MS = "not-a-number";
    expect(getRefreshSpacingMs()).toBe(2000);
    process.env.CODEX_REFRESH_SPACING_MS = "-5";
    expect(getRefreshSpacingMs()).toBe(2000);
    process.env.CODEX_REFRESH_SPACING_MS = "250";
    expect(getRefreshSpacingMs()).toBe(250);
  });
});
