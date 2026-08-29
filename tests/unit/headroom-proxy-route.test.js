import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class NextResponse extends Response {
    static json(body, init) {
      return Response.json(body, init);
    }
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({
    headroomUrl: "http://127.0.0.1:8099/base",
    headroomTimeoutMs: 1000,
  })),
}));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://127.0.0.1:8099" }));

const { DASHBOARD_PREFIX, GET } = await import(
  "../../src/app/api/headroom/proxy/[...path]/route.js"
);

const request = () =>
  new Request("https://dashboard.example/api/headroom/proxy/dashboard", { method: "GET" });
const context = { params: Promise.resolve({ path: ["dashboard"] }) };

describe("Headroom proxy route", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("round-trips a base-prefixed upstream redirect without duplicating the base", async () => {
    global.fetch = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "/base/dashboard" } }),
    );

    const response = await GET(request(), context);

    expect(global.fetch.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:8099/base/dashboard",
    );
    expect(response.headers.get("location")).toBe(`${DASHBOARD_PREFIX}/dashboard`);
  });

  it("resolves relative redirects from the requested upstream URL", async () => {
    global.fetch = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "child" } }),
    );

    const response = await GET(
      new Request("https://dashboard.example/api/headroom/proxy/dashboard/sub", { method: "GET" }),
      { params: Promise.resolve({ path: ["dashboard", "sub"] }) },
    );

    expect(global.fetch.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:8099/base/dashboard/sub",
    );
    expect(response.headers.get("location")).toBe(`${DASHBOARD_PREFIX}/dashboard/child`);
  });

  it("describes decoded rewritten gzip HTML", async () => {
    const body = '<a href="/dashboard">é</a>';
    global.fetch = vi.fn(async () =>
      new Response(body, {
        headers: {
          "content-type": "text/html",
          "content-encoding": "gzip",
          "content-length": "1",
        },
      }),
    );

    const response = await GET(request(), context);
    const rewritten = `<a href="${DASHBOARD_PREFIX}/dashboard">é</a>`;

    expect(await response.text()).toBe(rewritten);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(rewritten)));
  });

  it("describes decoded gzip HTML when rewriting is a no-op", async () => {
    const body = '<a href="/unknown">é</a>';
    global.fetch = vi.fn(async () =>
      new Response(body, {
        headers: {
          "content-type": "text/html",
          "content-encoding": "gzip",
          "content-length": "1",
        },
      }),
    );

    const response = await GET(request(), context);

    expect(await response.text()).toBe(body);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(body)));
  });

  it("aborts a stalled upstream fetch through the existing generic 502 boundary", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((_target, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason));
      }),
    );

    const pending = GET(request(), context);
    await vi.advanceTimersByTimeAsync(1000);
    const response = await pending;

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Headroom proxy request failed" });
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
