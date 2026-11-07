// #1137: side-by-side playground comparisons.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createLimiter,
  readCompareSelections,
  writeCompareSelections,
  MAX_COMPARE_COLUMNS,
  MAX_PARALLEL_COMPARE_RUNS,
  MIN_COMPARE_COLUMNS,
  readAssistantText,
  streamCompletion,
} from "../../src/lib/playground/compare.js";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });
const { default: PlaygroundCompare } = await import("../../src/app/(dashboard)/dashboard/playground/PlaygroundCompare.jsx");

function sseResponse(events, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

describe("compare limits", () => {
  it("allows 2-4 columns with at most 2 requests in flight", () => {
    expect([MIN_COMPARE_COLUMNS, MAX_COMPARE_COLUMNS, MAX_PARALLEL_COMPARE_RUNS]).toEqual([2, 4, 2]);
  });

  it("createLimiter caps concurrency and drains in FIFO order", async () => {
    const limit = createLimiter(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started = [];
    let active = 0;
    let peak = 0;
    const runs = gates.map((gate, i) => limit(async () => {
      started.push(i);
      active++;
      peak = Math.max(peak, active);
      await gate.promise;
      active--;
      return i;
    }));
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    gates[1].resolve();
    await runs[1];
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([0, 1, 2]);
    gates[0].resolve();
    gates[2].resolve();
    gates[3].resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });

  it("a rejected task frees its slot", async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await limit(async () => "next")).toBe("next");
  });
});

describe("streamCompletion", () => {
  it("streams text, captures usage, latency and first-token time", async () => {
    let t = 100;
    const now = () => (t += 10);
    const fetchImpl = vi.fn(async () => sseResponse([
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      "[DONE]",
    ]));
    const seen = [];
    const result = await streamCompletion({ fetchImpl, body: { model: "codex/m", messages: [] }, headers: { "x-connection-id": "c1" }, onText: (text) => seen.push(text), now });
    expect(result.text).toBe("Hello");
    expect(seen).toEqual(["Hel", "Hello"]);
    expect(result.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2 });
    expect(result.ttftMs).toBe(10);
    expect(result.latencyMs).toBeGreaterThan(result.ttftMs);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/v1/chat/completions");
    expect(init.headers["x-connection-id"]).toBe("c1");
    expect(JSON.parse(init.body)).toMatchObject({ model: "codex/m", stream: true, stream_options: { include_usage: true } });
  });

  it("throws a sanitized error on HTTP failure", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "<b>quota</b> exceeded at /srv/app/x.js" } }), { status: 429 });
    await expect(streamCompletion({ fetchImpl, body: {} })).rejects.toThrow(/^quota exceeded at$/);
  });

  it("does not dispatch when already aborted, and propagates aborts", async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(streamCompletion({ fetchImpl, body: {}, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();

    const live = new AbortController();
    const pending = streamCompletion({
      fetchImpl: (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
      body: {},
      signal: live.signal,
    });
    live.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("each column has its own controller: cancelling one leaves the other running", async () => {
    const a = new AbortController();
    const b = new AbortController();
    const fetchImpl = (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      setTimeout(() => resolve(sseResponse([{ choices: [{ delta: { content: "ok" } }] }])), 5);
    });
    const runA = streamCompletion({ fetchImpl, body: {}, signal: a.signal });
    const runB = streamCompletion({ fetchImpl, body: {}, signal: b.signal });
    a.abort();
    await expect(runA).rejects.toMatchObject({ name: "AbortError" });
    expect((await runB).text).toBe("ok");
  });
});

describe("helpers", () => {
  it("reads delta, message and output_text shapes", () => {
    expect(readAssistantText({ choices: [{ delta: { content: "a" } }] })).toBe("a");
    expect(readAssistantText({ choices: [{ message: { content: "b" } }] })).toBe("b");
    expect(readAssistantText({ output_text: "c" })).toBe("c");
    expect(readAssistantText(null)).toBe("");
  });

  it("persists only selectors and restores no prompt, response or running state", () => {
    let stored;
    const storage = { setItem: (_key, value) => { stored = value; }, getItem: () => stored };
    writeCompareSelections([
      { modelId: "codex/a", connectionId: "c1", text: "private response", status: "running" },
      { modelId: "claude/b", connectionId: "auto", content: "private prompt" },
    ], storage);
    expect(JSON.parse(stored)).toEqual([
      { modelId: "codex/a", connectionId: "c1" },
      { modelId: "claude/b", connectionId: "auto" },
    ]);
    expect(readCompareSelections(storage)).toEqual(JSON.parse(stored));
  });

  it("rejects malformed and out-of-bounds saved columns and tolerates denied storage", () => {
    for (const saved of ["{", "null", "[]", '[{"modelId":"x","connectionId":"auto"}]', JSON.stringify(Array(5).fill({ modelId: "x", connectionId: "auto" })), '[{},{}]']) {
      expect(readCompareSelections({ getItem: () => saved })).toBeNull();
    }
    const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readCompareSelections(denied)).toBeNull();
    expect(() => writeCompareSelections([], denied)).not.toThrow();
  });
});

describe("PlaygroundCompare render", () => {
  const models = [
    { id: "codex/a", requestModel: "codex/a", name: "Alpha", providerId: "codex", providerName: "Codex" },
    { id: "claude/b", requestModel: "claude/b", name: "Bravo", providerId: "claude", providerName: "Claude" },
  ];

  it("starts with two independently scrollable columns and no request", () => {
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const html = renderToStaticMarkup(createElement(PlaygroundCompare, { modelOptions: models, providerGroups: [], content: "hi", fetchImpl }));
    expect(html.match(/role="region"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Response from Alpha"');
    expect(html).toContain('aria-label="Response from Bravo"');
    expect(html).toContain("Run all");
    expect(html.match(/Authoritative cost/g)).toHaveLength(2);
    expect(html.match(/Unknown/g)).toHaveLength(2);
    expect(html).not.toContain("Est. cost");
    expect(fetchImpl).not.toHaveBeenCalled(); // effects do not run during SSR; nothing auto-dispatches
  });

  it("shows an empty state without models", () => {
    const html = renderToStaticMarkup(createElement(PlaygroundCompare, { modelOptions: [], providerGroups: [] }));
    expect(html).toContain("No models to compare");
  });
});
