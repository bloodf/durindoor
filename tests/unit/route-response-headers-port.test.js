import { afterEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { withRouteResponseHeaders } from "../../open-sse/utils/routeResponseHeaders.js";

describe("served route headers", () => {
  afterEach(() => { delete process.env.DURINDOOR_ROUTE_HEADERS; });
  it("preserves streaming responses and adds winning route and combo metadata", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("ok")); controller.close(); } });
    let response = withRouteResponseHeaders(new Response(stream, { headers: { "content-type": "text/event-stream" } }), { provider: "cx", model: "gpt-6.2-sol", attempts: 1 });
    response = withRouteResponseHeaders(response, { combo: "fallback", attempts: 2 });
    expect(response.headers.get("x-durindoor-provider")).toBe("cx");
    expect(response.headers.get("x-durindoor-model")).toBe("gpt-6.2-sol");
    expect(response.headers.get("x-durindoor-combo")).toBe("fallback");
    expect(response.headers.get("x-durindoor-attempts")).toBe("2");
    expect(await response.text()).toBe("ok");
  });
  it("labels the winning combo member after fallback", async () => {
    const handleSingleModel = vi.fn().mockResolvedValueOnce(Response.json({ error: { message: "bad request" } }, { status: 400 })).mockImplementationOnce(() => withRouteResponseHeaders(Response.json({ choices: [{ message: { content: "ok" } }] }), { provider: "cx", model: "gpt-6.2-sol", attempts: 1 }));
    const response = await handleComboChat({ body: { messages: [{ role: "user", content: "hi" }] }, models: ["openai/a", "codex/gpt-6.2-sol"], handleSingleModel, log: { info: vi.fn(), warn: vi.fn() }, comboName: "fallback", comboStrategy: "fallback", jevClassify: true });
    expect(response.headers.get("x-durindoor-model")).toBe("gpt-6.2-sol");
    expect(response.headers.get("x-durindoor-attempts")).toBe("2");
    expect(response.headers.get("x-durindoor-combo")).toBe("fallback");
  });
  it("leaves error responses and disabled headers untouched", () => {
    const error = new Response("error", { status: 429 });
    expect(withRouteResponseHeaders(error, { provider: "cx" })).toBe(error);
    process.env.DURINDOOR_ROUTE_HEADERS = "false";
    const response = new Response("ok");
    expect(withRouteResponseHeaders(response, { provider: "cx" })).toBe(response);
  });
  it("does not place invalid header values on responses", () => {
    const response = withRouteResponseHeaders(new Response("ok"), { combo: "unsafe\r\nheader" });
    expect(response.headers.has("x-durindoor-combo")).toBe(false);
  });
});
