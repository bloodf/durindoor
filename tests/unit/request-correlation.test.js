import { describe, expect, it, vi } from "vitest";
import { correlateResponse, createRequestId, getRequestId, validateProviderRequestId, withRequestCorrelation } from "../../src/sse/utils/requestCorrelation.js";
import { errorResponse } from "../../open-sse/utils/error.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body, status = 400, headers = {}) => new Response(JSON.stringify(body), {
  status, statusText: "Provider Error", headers: { "content-type": "application/json", ...headers },
});

describe("trusted request correlation", () => {
  it("creates one fresh server UUID per request and ignores inbound x-request-id", async () => {
    const firstRequest = new Request("https://durindoor.test/v1/test", { headers: { "x-request-id": "spoofed" } });
    const secondRequest = new Request("https://durindoor.test/v1/test", { headers: { "x-request-id": "spoofed" } });
    const handler = withRequestCorrelation(() => json({ error: { message: "bad request" } }));
    const first = await handler(firstRequest);
    const repeated = await handler(firstRequest);
    const second = await handler(secondRequest);
    const firstBody = await first.json();

    expect(first.headers.get("x-request-id")).toMatch(UUID);
    expect(first.headers.get("x-request-id")).not.toBe("spoofed");
    expect(repeated.headers.get("x-request-id")).toBe(first.headers.get("x-request-id"));
    expect(second.headers.get("x-request-id")).not.toBe(first.headers.get("x-request-id"));
    expect(firstBody.error.request_id).toBe(first.headers.get("x-request-id"));
    expect(getRequestId(firstRequest)).toBe(first.headers.get("x-request-id"));
    expect(createRequestId()).toMatch(UUID);
  });

  it("reuses one ID through nested shared-handler and route boundaries", async () => {
    const inner = withRequestCorrelation(() => json({ error: { message: "bad request" } }));
    const outer = withRequestCorrelation((request) => inner(request));
    const response = await outer(new Request("https://durindoor.test/v1/test"));
    const body = await response.json();

    expect(body.error.request_id).toBe(response.headers.get("x-request-id"));
  });

  it.each([" leading", "trailing ", "two words", "line\nbreak", "tab\tvalue", "comma,value", "semi;value", "slash/value", "unicode-іd", `a${"b".repeat(128)}`])("drops unsafe provider request ID %#", async (upstreamRequestId) => {
    expect(validateProviderRequestId(upstreamRequestId)).toBeNull();
    const response = await correlateResponse(json({ error: { message: "failed", request_id: upstreamRequestId } }), createRequestId());
    expect((await response.json()).error).not.toHaveProperty("upstream_request_id");
  });

  it("keeps a validated provider ID separate from the server ID", async () => {
    const serverRequestId = createRequestId();
    const response = await correlateResponse(json({ error: { message: "failed", request_id: "provider.req:123-abc" } }), serverRequestId);
    const body = await response.json();
    expect(response.headers.get("x-request-id")).toBe(serverRequestId);
    expect(body.error.request_id).toBe(serverRequestId);
    expect(body.error.upstream_request_id).toBe("provider.req:123-abc");
  });

  it("keeps Anthropic error shape and places correlation at its top level", async () => {
    const response = await correlateResponse(json({ type: "error", error: { type: "authentication_error", message: "denied" } }, 401), createRequestId());
    const body = await response.json();

    expect(body.request_id).toBe(response.headers.get("x-request-id"));
    expect(body.error).toEqual({ type: "authentication_error", message: "denied" });
  });

  it("preserves successful JSON, binary, and SSE bodies and response metadata without reading streams", async () => {
    const bodies = [
      ["application/json", new TextEncoder().encode('{"ok":true}')],
      ["application/octet-stream", new Uint8Array([0, 255, 12, 44])],
      ["text/event-stream", new TextEncoder().encode("data: one\n\n")],
    ];
    for (const [contentType, bytes] of bodies) {
      const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
      const original = new Response(stream, { status: 201, statusText: "Created", headers: {
        "content-type": contentType, "content-length": String(bytes.byteLength), "access-control-allow-origin": "*", "x-existing": "kept",
      } });
      const correlated = await correlateResponse(original, createRequestId());
      expect(original.bodyUsed).toBe(false);
      expect(correlated.status).toBe(201);
      expect(correlated.statusText).toBe("Created");
      expect(correlated.headers.get("content-type")).toBe(contentType);
      expect(correlated.headers.get("content-length")).toBe(String(bytes.byteLength));
      expect(correlated.headers.get("access-control-allow-origin")).toBe("*");
      expect(correlated.headers.get("x-existing")).toBe("kept");
      expect(new Uint8Array(await correlated.arrayBuffer())).toEqual(bytes);
    }
  });

  it("sanitizes reflected diagnostic fields through the shared sanitizer", async () => {
    const serverRequestId = createRequestId();
    const secret = "super-secret-value";
    const message = `https://user:pass@example.test api_key=${secret} Bearer token /home/user/app.js\nstack`;
    const response = await correlateResponse(json({ error: { message }, details: '{"access_token":"token"}' }), serverRequestId);
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("Bearer token");
    expect(serialized).not.toContain("/home/user/app.js");
    expect(serialized).not.toContain("access_token\":\"token");
    expect(body.error.request_id).toBe(serverRequestId);
  });

  it.each([[499, "Request aborted"], [415, "Unsupported media type"]])("preserves generated %i error type and empty code", async (status, message) => {
    const response = await correlateResponse(errorResponse(status, message), createRequestId());
    const body = await response.json();

    expect(body.error).toMatchObject({
      message,
      type: "invalid_request_error",
      code: "",
    });
  });

  it("sanitizes named diagnostics without mutating structured fields", async () => {
    const response = await correlateResponse(json({ error: {
      message: "first line\nsecond line",
      details: "Bearer secret-token",
      type: "custom\ntype",
      code: "",
      param: null,
      nested: { message: "", details: "" },
    } }), createRequestId());
    const body = await response.json();

    expect(body.error).toMatchObject({
      message: "first line",
      details: "Bearer [redacted]",
      type: "custom\ntype",
      code: "",
      param: null,
      nested: { message: "", details: "" },
    });
  });

  it("logs sanitized thrown handler failures with their server request ID", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await withRequestCorrelation(() => { throw new Error("Bearer secret-token /home/user/private.js"); })(new Request("https://durindoor.test/v1/test"));
    const body = await response.json();
    const requestId = response.headers.get("x-request-id");

    expect(response.status).toBe(500);
    expect(requestId).toMatch(UUID);
    expect(body.error.request_id).toBe(requestId);
    expect(body.error.message).toBe("Request failed");
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0].join(" ")).toContain(requestId);
    expect(logged.mock.calls[0].join(" ")).not.toContain("secret-token");
    expect(logged.mock.calls[0].join(" ")).not.toContain("/home/user/private.js");
    logged.mockRestore();
  });
});