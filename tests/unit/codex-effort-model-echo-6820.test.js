import { describe, it, expect } from "vitest";

/**
 * OmniRoute #6820 (issue #3697) port — Codex CLI compatibility shim.
 *
 * The Codex CLI status line / model button reads the `model` field of
 * Responses payloads (`response.created` / `response.in_progress` /
 * `response.completed`, and the final non-streaming JSON body) to display the
 * active model + reasoning effort. The upstream wire id stays the bare catalog
 * id (`gpt-5.5`); the echo rewrites the client-visible `model` on the response
 * side only.
 *
 * DurinDoor layout: the echo is a chatCore boundary wrapper
 * (`applyResponseModelEcho`) applied to the terminal handler `Response`,
 * triggered by `isCodexOriginatedHeaders` — NOT by the routed provider, so a
 * `codex/gpt-5.5-xhigh` id routed through a combo to a non-Codex upstream
 * still echoes. Compact unary requests are excluded.
 */

import {
  applyResponseModelEcho,
  createResponsesModelEchoStream,
  resolveResponsesEchoModel,
} from "../../open-sse/services/responseModelEcho.js";
import { isCodexOriginatedHeaders } from "../../open-sse/utils/clientDetector.js";

const ECHO = "gpt-5.5-xhigh";

function lifecycleFrames(eol = "\n") {
  return [
    `event: response.created${eol}data: {"type":"response.created","response":{"id":"resp_1","object":"response","model":"gpt-5.5","status":"in_progress"}}`,
    `event: response.in_progress${eol}data: {"type":"response.in_progress","response":{"id":"resp_1","object":"response","model":"gpt-5.5","status":"in_progress"}}`,
    `event: response.output_text.delta${eol}data: {"type":"response.output_text.delta","delta":"ok"}`,
    `event: response.completed${eol}data: {"type":"response.completed","response":{"id":"resp_1","object":"response","model":"gpt-5.5","status":"completed"}}`,
  ];
}

function sseResponse(eol = "\n") {
  return new Response(lifecycleFrames(eol).join(`${eol}${eol}`) + `${eol}${eol}`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function readAll(response) {
  return new Response(response.body).text();
}

describe("isCodexOriginatedHeaders", () => {
  it("matches originator/user-agent STARTING with codex (case-insensitive)", () => {
    expect(isCodexOriginatedHeaders({ originator: "codex_exec" })).toBe(true);
    expect(isCodexOriginatedHeaders({ "user-agent": "codex_cli_rs/0.136.0" })).toBe(true);
    expect(isCodexOriginatedHeaders({ "User-Agent": "Codex/1.2.3" })).toBe(true);
    expect(isCodexOriginatedHeaders(new Headers({ originator: "codex_cli_rs" }))).toBe(true);
  });

  it("rejects substring / non-codex / non-string / empty headers", () => {
    expect(isCodexOriginatedHeaders({ originator: "my-codex-proxy" })).toBe(false);
    expect(isCodexOriginatedHeaders({ "user-agent": "claude-cli/1.0" })).toBe(false);
    expect(isCodexOriginatedHeaders({ originator: { toString: () => "codex_exec" } })).toBe(false);
    expect(isCodexOriginatedHeaders({})).toBe(false);
    expect(isCodexOriginatedHeaders(null)).toBe(false);
  });
});

describe("resolveResponsesEchoModel", () => {
  it("echoes the ORIGINAL client body model, never the routed upstream id", () => {
    expect(resolveResponsesEchoModel({ body: { model: "gpt-5.5-xhigh" } })).toBe("gpt-5.5-xhigh");
    expect(resolveResponsesEchoModel({ body: { model: "gpt-5.5" } })).toBe("gpt-5.5");
    // No raw body model → nothing safe to echo (no routed fallback).
    expect(resolveResponsesEchoModel({ body: {} })).toBe(null);
    expect(resolveResponsesEchoModel(null)).toBe(null);
  });
});

describe("createResponsesModelEchoStream", () => {
  it("rewrites nested response.model on lifecycle events, keyed off payload type", async () => {
    const out = await readAll(new Response(
      new Response(lifecycleFrames().join("\n\n") + "\n\n").body
        .pipeThrough(createResponsesModelEchoStream(ECHO)),
    ));
    const created = out.match(/data: (\{[^\n]*response\.created[^\n]*\})/);
    expect(created).toBeTruthy();
    expect(JSON.parse(created[1]).response.model).toBe(ECHO);
    const completed = out.match(/data: (\{[^\n]*response\.completed[^\n]*\})/);
    expect(JSON.parse(completed[1]).response.model).toBe(ECHO);
    // Non-lifecycle events are untouched.
    expect(out).toContain('"response.output_text.delta","delta":"ok"');
    expect(out).not.toContain(`"delta":"ok","model"`);
  });

  it("rewrites data-only lifecycle frames that have no event: header", async () => {
    const dataOnly = 'data: {"type":"response.created","response":{"id":"r","model":"gpt-5.5"}}\n\n';
    const out = await readAll(new Response(
      new Response(dataOnly).body.pipeThrough(createResponsesModelEchoStream(ECHO)),
    ));
    expect(JSON.parse(out.match(/data: (\{.*\})/)[1]).response.model).toBe(ECHO);
  });

  it("handles \\r\\n line endings and multi-byte JSON split across chunks", async () => {
    const text = lifecycleFrames("\r\n").join("\r\n\r\n") + "\r\n\r\n";
    const bytes = new TextEncoder().encode(text);
    // Split mid-frame to prove frame-accurate buffering.
    const mid = Math.floor(bytes.length / 2);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, mid));
        controller.enqueue(bytes.slice(mid));
        controller.close();
      },
    });
    const out = await readAll(new Response(stream.pipeThrough(createResponsesModelEchoStream(ECHO))));
    expect(out).toContain(`"model":"${ECHO}"`);
    expect(out).toContain("\r\n");
  });
});

describe("applyResponseModelEcho", () => {
  it("returns the result unchanged when echoModel is null", async () => {
    const result = { success: true, response: sseResponse() };
    const out = await applyResponseModelEcho(result, null);
    expect(out).toBe(result);
  });

  it("rewrites SSE bodies and drops content-length", async () => {
    const result = {
      success: true,
      response: new Response(sseResponse().body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "content-length": "999" },
      }),
    };
    const out = await applyResponseModelEcho(result, ECHO);
    expect(out.response.headers.get("content-length")).toBe(null);
    const text = await out.response.text();
    expect(text).toContain(`"model":"${ECHO}"`);
  });

  it("sets top-level model on Responses JSON objects (forced-SSE→JSON converter)", async () => {
    // Converter output has object:"response" but no model field.
    const body = JSON.stringify({ id: "resp_1", object: "response", status: "completed", output: [], usage: {} });
    const result = {
      success: true,
      response: new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
    };
    const out = await applyResponseModelEcho(result, ECHO);
    expect(JSON.parse(await out.response.text()).model).toBe(ECHO);
  });

  it("overwrites an existing string model on non-streaming Responses JSON", async () => {
    const body = JSON.stringify({ id: "resp_1", object: "response", model: "gpt-5.5", status: "completed" });
    const result = {
      success: true,
      response: new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
    };
    const out = await applyResponseModelEcho(result, ECHO);
    expect(JSON.parse(await out.response.text()).model).toBe(ECHO);
  });

  it("leaves non-Responses JSON (error objects) untouched", async () => {
    const body = JSON.stringify({ error: { message: "boom", type: "server_error" } });
    const result = {
      success: true,
      response: new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }),
    };
    const out = await applyResponseModelEcho(result, ECHO);
    expect(await out.response.text()).toBe(body);
  });

  it("returns the result unchanged for unsuccessful results", async () => {
    const result = { success: false, response: sseResponse() };
    const out = await applyResponseModelEcho(result, ECHO);
    expect(out).toBe(result);
  });

  it("propagates transport read failures instead of swallowing them into an empty body", async () => {
    // A JSON body whose stream errors mid-read must reject so chatCore's error
    // handling sees the transport failure — never be folded into a 200 with an
    // empty/garbage body.
    const failing = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"object":"response"'));
        controller.error(new Error("boom: connection reset"));
      },
    });
    const result = {
      success: true,
      response: new Response(failing, { status: 200, headers: { "Content-Type": "application/json" } }),
    };
    await expect(applyResponseModelEcho(result, ECHO)).rejects.toThrow("boom: connection reset");
  });
});
