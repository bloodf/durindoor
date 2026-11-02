// #1128: opt-in OpenTelemetry routing traces over OTLP/HTTP JSON.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  startTrace: vi.fn(() => null),
  record: vi.fn(),
  finishTrace: vi.fn(),
}));
vi.mock("@/lib/db/repos/proxyTimelineRepo.js", () => repo);

const otel = await import("../../open-sse/services/otelTracing.js");
const timeline = await import("../../open-sse/handlers/chatCore/proxyTimeline.js");

const REQUEST_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const FIELDS = {
  provider: "openai", model: "gpt-4o", connection_id: "conn-secret-1", api_key_id: null,
  endpoint: "/v1/chat/completions?key=sk-leak", client_format: "openai", provider_format: "openai",
};

let fetchMock;
const posted = () => fetchMock.mock.calls.map(([url, init]) => ({ url, init, body: JSON.parse(init.body) }));
const spansOf = (call) => call.body.resourceSpans[0].scopeSpans[0].spans;
const attrs = (span) => Object.fromEntries(span.attributes.map((a) => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.doubleValue]));

beforeEach(() => {
  vi.clearAllMocks();
  repo.startTrace.mockImplementation(() => null);
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  otel.resetOtelForTests({ DURINDOOR_OTEL_ENDPOINT: "http://collector:4318", OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20abc,bad key=x" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  otel.resetOtelForTests({});
});

describe("configuration", () => {
  it("is off without an endpoint and when OTEL_SDK_DISABLED=true", () => {
    otel.resetOtelForTests({});
    expect(otel.isOtelEnabled()).toBe(false);
    otel.resetOtelForTests({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318", OTEL_SDK_DISABLED: "true" });
    expect(otel.isOtelEnabled()).toBe(false);
    otel.resetOtelForTests({ OTEL_EXPORTER_OTLP_ENDPOINT: "file:///tmp/x" });
    expect(otel.isOtelEnabled()).toBe(false);
  });

  it("appends /v1/traces to a base endpoint and uses the traces endpoint as-is", async () => {
    for (const [env, url] of [
      [{ OTEL_EXPORTER_OTLP_ENDPOINT: "https://c:4318/" }, "https://c:4318/v1/traces"],
      [{ DURINDOOR_OTEL_ENDPOINT: "https://c/v1/traces" }, "https://c/v1/traces"],
      [{ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://c/custom" }, "https://c/custom"],
    ]) {
      otel.resetOtelForTests(env);
      fetchMock.mockClear();
      otel.otelStart("a", FIELDS);
      otel.otelFinish("a", { status: "ok" });
      await otel.flushOtel();
      expect(fetchMock.mock.calls[0][0]).toBe(url);
    }
  });

  it("disabled tracing leaves the timeline seam untouched", () => {
    otel.resetOtelForTests({});
    repo.startTrace.mockReturnValue("repo-id");
    expect(timeline.startTrace(FIELDS, { requestId: REQUEST_ID })).toBe("repo-id");
    expect(repo.startTrace).toHaveBeenCalledWith(FIELDS);
    timeline.startTrace(FIELDS);
    repo.startTrace.mockReturnValue(null);
    expect(timeline.startTrace(FIELDS)).toBeNull();
  });
});

describe("routing spans", () => {
  it("exports one allowlisted span per attempt with TTFT, outcome and request-scoped trace id", async () => {
    const id = timeline.startTrace(FIELDS, { requestId: REQUEST_ID });
    expect(id).toBeTruthy();
    timeline.record(id, { type: "route", summary: "openai to openai" });
    timeline.record(id, { type: "error", summary: "prompt says: my password is hunter2" });
    timeline.record(id, { type: "sse_chunk", payload: { content: "secret answer" } });
    timeline.finishTrace(id, { status: "error" });
    await otel.flushOtel();

    const [call] = posted();
    expect(call.init.headers).toMatchObject({ authorization: "Bearer abc", "Content-Type": "application/json" });
    expect(call.init.headers["bad key"]).toBeUndefined();
    const [span] = spansOf(call);
    expect(span.traceId).toBe(REQUEST_ID.replace(/-/g, ""));
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.status.code).toBe(2);
    expect(span.events.map((e) => e.name)).toEqual(["route", "error"]);
    const a = attrs(span);
    expect(a).toMatchObject({
      "gen_ai.provider.name": "openai", "gen_ai.request.model": "gpt-4o", "gen_ai.operation.name": "chat",
      "durindoor.endpoint": "/v1/chat/completions", "durindoor.outcome": "error",
    });
    expect(a["durindoor.ttft_ms"]).toBeDefined();
    const wire = call.init.body;
    for (const leak of ["hunter2", "secret answer", "conn-secret-1", "sk-leak", "openai to openai"]) {
      expect(wire).not.toContain(leak);
    }
  });

  it("fallback attempts of one request share the trace id but not the span id", async () => {
    for (const status of ["error", "ok"]) {
      const id = timeline.startTrace(FIELDS, { requestId: REQUEST_ID });
      timeline.finishTrace(id, { status });
    }
    await otel.flushOtel();
    const spans = spansOf(posted()[0]);
    expect(spans).toHaveLength(2);
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    expect(new Set(spans.map((s) => s.spanId)).size).toBe(2);
    expect(spans.map((s) => s.status.code)).toEqual([2, 1]);
  });

  it("OTel-only ids never reach the timeline repo and skip SSE framing", () => {
    const id = timeline.startTrace(FIELDS, { requestId: REQUEST_ID });
    const tap = timeline.attachClientFrameTap(id, "sse-lines");
    tap.onClientBytes(new TextEncoder().encode("data: {}\n\n"));
    timeline.record(id, { type: "route" });
    timeline.finishTrace(id, { status: "ok" });
    expect(repo.record).not.toHaveBeenCalled();
    expect(repo.finishTrace).not.toHaveBeenCalled();
  });

  it("repo-backed ids still persist to the timeline", () => {
    repo.startTrace.mockReturnValue("repo-1");
    const id = timeline.startTrace(FIELDS);
    timeline.record(id, { type: "route" });
    timeline.finishTrace(id, { status: "ok" });
    expect(id).toBe("repo-1");
    expect(repo.record).toHaveBeenCalledWith("repo-1", { type: "route" });
    expect(repo.finishTrace).toHaveBeenCalledWith("repo-1", { status: "ok" });
  });
});

describe("failure isolation and bounds", () => {
  it("collector failures never throw and are dropped after repeated failures", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    otel.otelStart("x", FIELDS);
    otel.otelFinish("x", { status: "ok" });
    for (let i = 0; i < 6; i++) await expect(otel.flushOtel()).resolves.toBeUndefined();
    const s = otel.getOtelStats();
    expect(s.failures).toBe(5);
    expect(s.dropped).toBe(1);
    expect(s.buffered).toBe(0);
  });

  it("a non-2xx collector response counts as a failure", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    otel.otelStart("y", FIELDS);
    otel.otelFinish("y", {});
    await otel.flushOtel();
    expect(otel.getOtelStats()).toMatchObject({ failures: 1, exported: 0, buffered: 1 });
  });

  it("bounds the export buffer and drops oldest", () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // collector hangs
    for (let i = 0; i < 700; i++) {
      otel.otelStart(`s${i}`, FIELDS);
      otel.otelFinish(`s${i}`, {});
    }
    const s = otel.getOtelStats();
    expect(s.buffered).toBeLessThanOrEqual(512);
    expect(s.dropped).toBeGreaterThan(0);
  });

  it("shutdown flushes pending spans", async () => {
    otel.otelStart("z", FIELDS);
    otel.otelFinish("z", { status: "ok" });
    await otel.shutdownOtel();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(otel.getOtelStats().exported).toBe(1);
  });

  it("unknown ids and malformed events are ignored", () => {
    expect(() => {
      otel.otelEvent("missing", { type: "route" });
      otel.otelFinish("missing", {});
      otel.otelStart(null, FIELDS);
    }).not.toThrow();
    expect(otel.getOtelStats().buffered).toBe(0);
  });
});
