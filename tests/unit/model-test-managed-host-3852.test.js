import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config.mjs";

const mocks = vi.hoisted(() => ({ handleChat: vi.fn() }));

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "cli-token") }));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));
vi.mock("@/lib/tunnel", () => ({
  getTunnelStatus: vi.fn(() => new Promise(() => {})),
  getTailscaleStatus: vi.fn(async () => ({})),
  getDownloadStatus: vi.fn(() => ({})),
}));

const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
const { POST } = await import("../../src/app/api/models/test/route.js");

const originalFetch = global.fetch;
const transportFailure = (code) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
const completion = () => Response.json({ choices: [{ message: { content: "hello" }, finish_reason: "stop" }] });

describe("upstream 9router #3852: model tests on managed production hosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleChat.mockImplementation(async () => completion());
  });
  afterEach(() => { global.fetch = originalFetch; });

  it("runs the chat probe in process when the loopback listener is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(transportFailure("ECONNREFUSED"));

    const result = await pingModelByKind("openai/gpt-5", "llm", undefined, "conn-1");

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
    const request = mocks.handleChat.mock.calls[0][0];
    expect(new URL(request.url).pathname).toBe("/api/v1/chat/completions");
    expect(request.headers.get("x-9r-cli-token")).toBe("cli-token");
    expect(request.headers.get("x-connection-id")).toBe("conn-1");
    expect(await request.json()).toMatchObject({ model: "openai/gpt-5", stream: false });
  });

  it("does not replay a probe that may already have reached the server", async () => {
    global.fetch = vi.fn().mockRejectedValue(transportFailure("ECONNRESET"));

    const result = await pingModelByKind("openai/gpt-5", "llm");

    expect(result).toMatchObject({ ok: false, status: 502, error: "Connection failed" });
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });

  // The upstream diff builds the probe origin from these headers. DurinDoor must
  // not: the probe carries the CLI token.
  it("never sends the probe to a host named by forwarded headers", async () => {
    global.fetch = vi.fn().mockResolvedValue(completion());

    await POST(new Request("http://localhost/api/models/test", {
      method: "POST",
      headers: { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" },
      body: JSON.stringify({ model: "openai/gpt-5", kind: "llm" }),
    }));

    expect(new URL(global.fetch.mock.calls[0][0]).hostname).toBe("127.0.0.1");
  });

  it("ends a hung tunnel status read instead of holding the request open", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { GET } = await import("../../src/app/api/tunnel/status/route.js");
      const pending = GET();
      await vi.advanceTimersByTimeAsync(10000);
      const response = await pending;
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Tunnel status timed out" });
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("forbids caching dashboard and login HTML", async () => {
    const routes = await nextConfig.headers();
    for (const source of ["/dashboard/:path*", "/login"]) {
      const route = routes.find((entry) => entry.source === source);
      expect(route?.headers).toContainEqual({ key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" });
    }
  });
});
