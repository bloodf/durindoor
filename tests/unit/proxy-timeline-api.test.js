import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTraces: vi.fn(),
  getTrace: vi.fn(),
  clearTraces: vi.fn(),
  onTimelineWrite: vi.fn(() => () => {}),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
}));
vi.mock("@/lib/db/repos/proxyTimelineRepo.js", () => mocks);

const listRoute = await import("../../src/app/api/timeline/route.js");
const detailRoute = await import("../../src/app/api/timeline/[id]/route.js");
const streamRoute = await import("../../src/app/api/timeline/stream/route.js");

function request(path, params = {}, init = {}) {
  const query = new URLSearchParams(params).toString();
  return new Request(`http://localhost${path}${query ? `?${query}` : ""}`, init);
}

describe("timeline HTTP API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTraces.mockResolvedValue({ traces: [], pagination: { page: 1, pageSize: 20 } });
    mocks.getTrace.mockResolvedValue(null);
    mocks.clearTraces.mockResolvedValue(undefined);
    mocks.onTimelineWrite.mockReturnValue(() => {});
  });

  it.each(["101", "0"])("rejects pageSize=%s with 400 and does not call the repo", async (pageSize) => {
    const res = await listRoute.GET(request("/api/timeline", { pageSize }));
    expect(res.status).toBe(400);
    expect(mocks.listTraces).not.toHaveBeenCalled();
  });

  it("rejects page=0 with 400 and does not call the repo", async () => {
    const res = await listRoute.GET(request("/api/timeline", { page: "0" }));
    expect(res.status).toBe(400);
    expect(mocks.listTraces).not.toHaveBeenCalled();
  });

  it("forwards accepted camelCase filters and ignores connection", async () => {
    const res = await listRoute.GET(request("/api/timeline", {
      provider: "openai",
      model: "gpt-4o",
      connectionId: "conn-1",
      apiKeyId: "key-1",
      status: "ok",
      endpoint: "/v1/chat/completions",
      startDate: "2026-08-01",
      endDate: "2026-08-22",
      q: "abc",
      connection: "legacy",
    }));
    expect(res.status).toBe(200);
    expect(mocks.listTraces).toHaveBeenCalledTimes(1);
    const filter = mocks.listTraces.mock.calls[0][0];
    expect(filter).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      connectionId: "conn-1",
      apiKeyId: "key-1",
      status: "ok",
      endpoint: "/v1/chat/completions",
      startDate: "2026-08-01",
      endDate: "2026-08-22",
      q: "abc",
      page: 1,
      pageSize: 20,
    });
    expect(filter).not.toHaveProperty("connection");
  });

  it("returns { trace, events } in seq order for GET /api/timeline/:id", async () => {
    mocks.getTrace.mockResolvedValue({
      id: "t1",
      events: [
        { seq: 2, type: "response" },
        { seq: 1, type: "request" },
      ],
    });
    const res = await detailRoute.GET(request("/api/timeline/t1"), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    expect(res.body.trace.id).toBe("t1");
    expect(res.body.events.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("returns 404 when the trace is missing", async () => {
    const res = await detailRoute.GET(request("/api/timeline/missing"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/timeline calls clearTraces", async () => {
    const res = await listRoute.DELETE(request("/api/timeline", {}, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mocks.clearTraces).toHaveBeenCalledTimes(1);
  });

  it("GET /api/timeline/stream returns text/event-stream", async () => {
    const res = await streamRoute.GET(request("/api/timeline/stream"));
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    res.body.cancel();
  });

  it("suppresses stream writes whose parent trace does not match provider", async () => {
    let listener;
    const unsubscribe = vi.fn();
    mocks.onTimelineWrite.mockImplementation((fn) => {
      listener = fn;
      return unsubscribe;
    });
    mocks.getTrace.mockResolvedValue({ id: "t-other", provider: "anthropic", started_at: "2026-08-22T00:00:00.000Z" });
    const res = await streamRoute.GET(request("/api/timeline/stream", { provider: "openai" }));
    const reader = res.body.getReader();
    listener({ type: "trace", id: "t-other" });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.getTrace).toHaveBeenCalledWith("t-other");
    await reader.cancel();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("emits matching stream writes after looking up the parent trace", async () => {
    let listener;
    mocks.onTimelineWrite.mockImplementation((fn) => {
      listener = fn;
      return () => {};
    });
    mocks.getTrace.mockResolvedValue({ id: "t-ok", provider: "openai", started_at: "2026-08-22T00:00:00.000Z" });
    const res = await streamRoute.GET(request("/api/timeline/stream", { provider: "openai" }));
    const reader = res.body.getReader();
    listener({ type: "trace", id: "t-ok" });
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe("data: {\"type\":\"trace\",\"id\":\"t-ok\"}\n\n");
    await reader.cancel();
  });
  it("emits a write that arrived while the previous parent lookup was in flight", async () => {
    let listener;
    let releaseFirst;
    const firstLookup = new Promise((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    mocks.onTimelineWrite.mockImplementation((fn) => {
      listener = fn;
      return () => {};
    });
    mocks.getTrace.mockImplementation(async (id) => {
      calls += 1;
      if (calls === 1) await firstLookup;
      return { id, provider: "openai", started_at: "2026-08-22T00:00:00.000Z" };
    });
    const res = await streamRoute.GET(request("/api/timeline/stream", { provider: "openai" }));
    const reader = res.body.getReader();
    listener({ type: "trace", id: "t-first" });
    listener({ type: "trace", id: "t-second" });
    releaseFirst();
    const first = await reader.read();
    const second = await reader.read();
    const frames = [first.value, second.value].map((value) => new TextDecoder().decode(value));
    expect(frames).toEqual([
      "data: {\"type\":\"trace\",\"id\":\"t-first\"}\n\n",
      "data: {\"type\":\"trace\",\"id\":\"t-second\"}\n\n",
    ]);
    await reader.cancel();
  });
});
