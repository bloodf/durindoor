/**
 * Laya on POST /v1/systemone: the self-hosted origin comes from the connection,
 * the registry path is kept, the call goes through the outbound guard, and the
 * translator tools refuse providers that cannot serve chat.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const guarded = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/outboundUrlGuard.js", async (importOriginal) => ({ ...(await importOriginal()), guardedProbeFetch: guarded }));
vi.mock("@/lib/localDb.js", () => ({ getProviderConnections: vi.fn(async () => []), updateProviderConnection: vi.fn() }));

const { handleSystemoneCore } = await import("../../open-sse/handlers/systemoneCore.js");
const { isChatProvider } = await import("../../open-sse/providers/chatCapability.js");
const { POST: translatorSend } = await import("../../src/app/api/translator/send/route.js");

const body = { state: "refund please", questions: { urgent: { type: "noul", instructions: "Urgent?" } } };
const layaAnswer = () => new Response(JSON.stringify({ model: "laya-rl-agent", answers: { urgent: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 12, output_tokens: 0 } }), { status: 200 });

beforeEach(() => guarded.mockReset());

describe("Laya System One passthrough", () => {
  it("posts to the connection's origin with the registry path, keyless", async () => {
    guarded.mockResolvedValue(layaAnswer());
    const result = await handleSystemoneCore({
      body,
      modelInfo: { provider: "laya", model: "english" },
      credentials: { apiKey: "", providerSpecificData: { baseUrl: "http://192.168.1.30:9000/ignored/path" } }
    });
    expect(result.success).toBe(true);
    const [url, init] = guarded.mock.calls[0];
    expect(url).toBe("http://192.168.1.30:9000/v1/systemone");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body).model).toBe("english");
  });

  it("sends the bearer key when the connection has one, default host when none is saved", async () => {
    guarded.mockResolvedValue(layaAnswer());
    await handleSystemoneCore({ body, modelInfo: { provider: "laya", model: "auto" }, credentials: { apiKey: "k" } });
    const [url, init] = guarded.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/v1/systemone");
    expect(init.headers.Authorization).toBe("Bearer k");
  });

  it("refuses a blocked host without calling it", async () => {
    const result = await handleSystemoneCore({
      body,
      modelInfo: { provider: "laya", model: "english" },
      credentials: { providerSpecificData: { baseUrl: "http://169.254.169.254" } }
    });
    expect(result.success).toBeFalsy();
    expect(result.status).toBe(400);
    expect(guarded).not.toHaveBeenCalled();
  });
});

describe("chat-only tools refuse non-chat providers", () => {
  it("isChatProvider", () => {
    expect(isChatProvider("laya")).toBe(false);
    expect(isChatProvider("tavily")).toBe(false);
    expect(isChatProvider("openrouter")).toBe(true);
    expect(isChatProvider("my-custom-node")).toBe(true);
  });

  it("translator send returns 400 for Laya before loading a connection", async () => {
    const res = await translatorSend(new Request("http://localhost/api/translator/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "laya", model: "english", body: { messages: [{ role: "user", content: "hi" }] } })
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("does not serve chat");
  });
});
