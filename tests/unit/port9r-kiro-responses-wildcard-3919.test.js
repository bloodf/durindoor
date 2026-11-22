// Port of decolua/9router#3919 (the parts DurinDoor lacked):
//  - Kiro 1.x+ sends the agentic chat turn as POST /v1/responses; it must be
//    classified as a chat turn and forwarded to the router /v1/responses with
//    the alias-mapped model, response piped back unchanged.
//  - A "*" entry in a tool's MITM alias table maps any model nothing else matched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

const { isChatRequest } = require("../../src/mitm/config.js");
const { getMappedOverride } = require("../../src/mitm/server.js");
const { intercept } = require("../../src/mitm/handlers/kiro.js");

function fakeRes() {
  const res = {
    headersSent: false,
    writableEnded: false,
    status: null,
    headers: null,
    chunks: [],
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    write(chunk) { this.chunks.push(String(chunk)); return true; },
    end(chunk) { if (chunk) this.chunks.push(String(chunk)); this.writableEnded = true; },
  };
  return res;
}

describe("port9r #3919 Kiro /v1/responses", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies POST /v1/responses on Kiro as a chat turn, other tools unaffected", () => {
    expect(isChatRequest("kiro", { url: "/v1/responses", headers: {} })).toBe(true);
    expect(isChatRequest("kiro", { url: "/v1/other", headers: {} })).toBe(false);
    expect(isChatRequest("antigravity", { url: "/v1/responses", headers: {} })).toBe(false);
  });

  it("remaps the model, forwards to router /v1/responses and pipes the SSE back", async () => {
    const sse = "event: response.completed\ndata: {\"type\":\"response.completed\"}\n\n";
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    const res = fakeRes();
    const body = Buffer.from(JSON.stringify({ model: "auto", input: "hi", stream: true }));
    await intercept({ url: "/v1/responses", headers: {} }, res, body, "cc/claude-sonnet");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/v1\/responses$/);
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ model: "cc/claude-sonnet", input: "hi", stream: true });
    expect(res.status).toBe(200);
    expect(res.chunks.join("")).toBe(sse);
    expect(res.writableEnded).toBe(true);
  });

  it("answers 500 JSON when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = fakeRes();
    await intercept({ url: "/v1/responses", headers: {} }, res, Buffer.from("not json"), "x/y");
    expect(res.status).toBe(500);
    expect(JSON.parse(res.chunks.join("")).error.type).toBe("mitm_error");
  });
});

describe("port9r #3919 wildcard MITM alias", () => {
  const aliases = {
    auto: { model: "ag/flash" },
    "*": { model: "fallback/model" },
  };

  it("exact and prefix matches still win over the wildcard", () => {
    expect(getMappedOverride("kiro", "auto", aliases)?.model).toBe("ag/flash");
  });

  it("maps an otherwise unmatched model through the wildcard", () => {
    expect(getMappedOverride("kiro", "totally-unknown-model", aliases)?.model).toBe("fallback/model");
  });

  it("stays null without a wildcard entry", () => {
    expect(getMappedOverride("kiro", "totally-unknown-model", { auto: { model: "ag/flash" } })).toBeNull();
  });
});
