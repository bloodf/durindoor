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
    headroomUrl: "http://127.0.0.1:8099",
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

  it("recalculates content-length after an HTML rewrite", async () => {
    const body = '<a href="/dashboard">é</a>';
    global.fetch = vi.fn(async () =>
      new Response(body, {
        headers: { "content-type": "text/html", "content-length": "1" },
      }),
    );

    const response = await GET(request(), context);
    const rewritten = `<a href="${DASHBOARD_PREFIX}/dashboard">é</a>`;

    expect(await response.text()).toBe(rewritten);
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(rewritten)));
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
