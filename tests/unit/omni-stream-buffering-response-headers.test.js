// #1073: self-built SSE wrappers must carry X-Accel-Buffering: no.
// Offline only: no network, no provider, no browser.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSyntheticResponse } from "../../open-sse/utils/bypassResponse.js";
import {
  ANTHROPIC_PING_FRAME,
  withEarlyStreamKeepalive,
} from "../../open-sse/utils/earlyStreamKeepalive.js";
import { SSE_HEADERS_NO_BUFFER } from "../../open-sse/utils/sseConstants.js";

const decoder = new TextDecoder();
const ROOT = resolve(import.meta.dirname, "../..");

function deferred() {
  let resolvePromise;
  const promise = new Promise((done) => { resolvePromise = done; });
  return { promise, resolve: resolvePromise };
}

function upstreamSse(body, extra = {}) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "X-Upstream": "kept", ...extra },
  });
}

describe("#1073 central unbuffered header contract", () => {
  it("uses the existing literal the wrappers must match", () => {
    expect(SSE_HEADERS_NO_BUFFER["X-Accel-Buffering"]).toBe("no");
  });
});

describe("#1073 synthetic bypass stream", () => {
  it("adds X-Accel-Buffering and preserves the other headers, status and body", async () => {
    const { response } = createSyntheticResponse({
      sourceFormat: FORMATS.OPENAI,
      model: "demo-model",
      text: "hello world",
      stream: true,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const text = await response.text();
    expect(text).toContain("hello world");
    expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("leaves the JSON bypass response without the SSE-only header", async () => {
    const { response } = createSyntheticResponse({
      sourceFormat: FORMATS.OPENAI,
      model: "demo-model",
      text: "hello world",
      stream: false,
    });
    expect(response.headers.get("X-Accel-Buffering")).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect((await response.json()).object).toBe("chat.completion");
  });
});

describe("#1073 early keepalive slow path", () => {
  it("adds X-Accel-Buffering, keeps framing, and forwards the upstream body", async () => {
    const upstream = deferred();
    const response = await withEarlyStreamKeepalive(upstream.promise, {
      thresholdMs: 0,
      keepaliveFrame: ANTHROPIC_PING_FRAME,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(response.headers.get("Connection")).toBe("keep-alive");

    const reader = response.body.getReader();
    expect(decoder.decode((await reader.read()).value)).toBe(decoder.decode(ANTHROPIC_PING_FRAME));
    upstream.resolve(upstreamSse("data: real\n\n"));
    expect(decoder.decode((await reader.read()).value)).toBe("data: real\n\n");
    expect((await reader.read()).done).toBe(true);
  });

  it("returns a fast handler response verbatim, without adding the header", async () => {
    const handlerResponse = upstreamSse("data: fast\n\n");
    const result = await withEarlyStreamKeepalive(Promise.resolve(handlerResponse), {
      thresholdMs: 5_000,
    });
    expect(result).toBe(handlerResponse);
    expect(result.headers.get("X-Accel-Buffering")).toBeNull();
    expect(result.headers.get("X-Upstream")).toBe("kept");
  });

  it("returns the handler response unchanged when the wrapper is disabled", async () => {
    const handlerResponse = upstreamSse("data: off\n\n");
    const result = await withEarlyStreamKeepalive(Promise.resolve(handlerResponse), { intervalMs: 0 });
    expect(result).toBe(handlerResponse);
    expect(result.headers.get("X-Accel-Buffering")).toBeNull();
  });
});

describe("#1073 existing local coverage preserved", () => {
  // These transports already sent the header before this port; the upstream
  // MCP wrapper change is therefore a verified no-op here.
  it.each([
    "src/app/api/mcp-gateway/sse/route.js",
    "src/app/api/mcp/[plugin]/sse/route.js",
  ])("%s keeps its X-Accel-Buffering literal", (file) => {
    expect(readFileSync(resolve(ROOT, file), "utf8")).toMatch(/"X-Accel-Buffering":\s*"no"/);
  });
});
