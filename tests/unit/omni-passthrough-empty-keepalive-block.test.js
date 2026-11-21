/**
 * Port of OmniRoute #1146 (PR head 1e7df54, squash merge bd33b53).
 *
 * A provider `event: keepalive` block carries no payload. Strict
 * OpenAI-compatible SDKs try to JSON.parse the empty body and crash, so the
 * gateway drops the whole block — the label and the frame body — in Chat and
 * Responses passthrough.
 *
 * The local port keeps every other frame: the payload that follows the block
 * (and its order), genuine Anthropic `event: ping` frames, SSE comments,
 * error and terminal frames, the gateway-generated keepalives, and the 9router
 * #5441 field-only-frame rule that drops a label that has no payload.
 *
 * The fixtures are bounded and offline: no provider traffic, no network.
 */

import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import {
  createProviderKeepaliveFilter,
  isProviderKeepaliveEvent,
} from "../../open-sse/utils/providerKeepalive.js";
import { ANTHROPIC_PING_FRAME } from "../../open-sse/utils/earlyStreamKeepalive.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const encoder = new TextEncoder();

/** Run a passthrough stream over the given chunks and return the client bytes. */
async function runPassthrough(chunks, targetFormat, provider = "openai", onComplete = null) {
  const stream = createPassthroughStreamWithLogger(
    provider,
    null,                    // reqLogger
    null,                    // toolNameMap
    "gpt-4.1-mini",          // model
    "connection-1",          // connectionId
    {},                      // body
    onComplete,              // onStreamComplete
    null,                    // apiKey
    targetFormat,
  );

  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const decoder = new TextDecoder();

  const readAll = (async () => {
    let out = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    return out;
  })();

  for (const chunk of chunks) {
    await writer.write(encoder.encode(chunk));
  }
  const [closeResult, readResult] = await Promise.allSettled([writer.close(), readAll]);
  if (closeResult.status === "rejected") throw closeResult.reason;
  if (readResult.status === "rejected") throw readResult.reason;
  return readResult.value;
}

/** Split a fixture into bounded chunks of at most `size` bytes. */
function chunked(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

/** The payloads of every `data:` line the client received. */
function dataPayloads(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
}

const chatChunk = {
  id: "chatcmpl_1",
  object: "chat.completion.chunk",
  created: 1,
  model: "gpt-4.1-mini",
  choices: [{ index: 0, delta: { content: "Hello keepalive-safe" } }],
};

const chatFrame = `data: ${JSON.stringify(chatChunk)}\n\n`;

/** A provider keepalive block: the label plus a frame with an empty payload. */
const emptyKeepaliveBlock = "event: keepalive\ndata:\n\n";

describe("provider empty keepalive blocks (OmniRoute #1146)", () => {
  it("drops the keepalive block in Chat passthrough and keeps the following payload", async () => {
    const output = await runPassthrough(
      [emptyKeepaliveBlock, chatFrame, "data: [DONE]\n\n"],
      FORMATS.OPENAI,
    );

    expect(output).not.toContain("event: keepalive");
    // The empty payload of the dropped block must not reach the client.
    expect(dataPayloads(output).filter((payload) => payload === "")).toHaveLength(0);
    expect(output).toContain(JSON.stringify(chatChunk));
    expect(output).toContain("data: [DONE]");
    // The payload after the block keeps its order.
    expect(output.indexOf("Hello keepalive-safe")).toBeLessThan(output.indexOf("data: [DONE]"));
  });

  it("drops the keepalive block in Responses passthrough without losing Responses deltas", async () => {
    const output = await runPassthrough(
      [
        emptyKeepaliveBlock,
        `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: "response.output_text.delta",
          sequence_number: 2,
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: "Hello keepalive-safe",
        })}\n\n`,
        `event: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          sequence_number: 3,
          response: {
            id: "resp_keepalive",
            status: "completed",
            usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
          },
        })}\n\n`,
        "data: [DONE]\n\n",
      ],
      FORMATS.OPENAI_RESPONSES,
      "codex",
    );

    expect(output).not.toContain("event: keepalive");
    expect(dataPayloads(output).filter((payload) => payload === "")).toHaveLength(0);
    expect(output).toContain("response.output_text.delta");
    expect(output).toContain("Hello keepalive-safe");
    expect(output).toContain("data: [DONE]");
    expect(output.indexOf("Hello keepalive-safe")).toBeLessThan(output.indexOf("data: [DONE]"));
  });

  it("drops the keepalive block when the payload arrives in bounded chunks", async () => {
    const fixture = emptyKeepaliveBlock + chatFrame + "data: [DONE]\n\n";
    const output = await runPassthrough(chunked(fixture, 3), FORMATS.OPENAI);

    expect(output).not.toContain("event: keepalive");
    expect(dataPayloads(output).filter((payload) => payload === "")).toHaveLength(0);
    expect(output).toContain("Hello keepalive-safe");
    expect(output).toContain("data: [DONE]");
  });

  it("drops the keepalive block in a CRLF stream", async () => {
    const fixture = (emptyKeepaliveBlock + chatFrame + "data: [DONE]\n\n").replace(/\n/g, "\r\n");
    const output = await runPassthrough([fixture], FORMATS.OPENAI);

    expect(output).not.toContain("event: keepalive");
    expect(dataPayloads(output).filter((payload) => payload === "")).toHaveLength(0);
    expect(output).toContain("Hello keepalive-safe");
    expect(output).toContain("data: [DONE]");
  });

  it("drops the tail of a stream that ends inside a keepalive block", async () => {
    const output = await runPassthrough(
      [chatFrame, "event: keepalive\ndata: "],
      FORMATS.OPENAI,
    );

    expect(output).not.toContain("event: keepalive");
    expect(output).toContain("Hello keepalive-safe");
    expect(output).not.toContain("data: \n");
  });

  it("retains identical usage frames through normal Chat processing for both labels", async () => {
    const payload = JSON.stringify({ id: "chatcmpl_usage", object: "chat.completion.chunk", created: 1, choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } });
    const calls = [];
    for (const label of ["provider-status", "keepalive"]) {
      const complete = vi.fn();
      const output = await runPassthrough(chunked(`event: ${label}\ndata: ${payload}\n\ndata: [DONE]\n\n`, 3), FORMATS.OPENAI, "openai", complete);
      expect(output).toContain(`event: ${label}`);
      expect(output).toContain(payload);
      expect(complete).toHaveBeenCalledTimes(1);
      calls.push(complete.mock.calls[0][1]);
    }
    expect(calls[0]).toMatchObject({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
    expect(calls[1]).toEqual(calls[0]);
  });

  it("retains data-bearing and prefix event labels in Responses", async () => {
    for (const label of ["keepalive", "keepalive-status"]) {
      const payload = JSON.stringify({ type: "response.output_text.delta", sequence_number: 1, delta: "retained" });
      const terminal = JSON.stringify({ type: "response.completed", sequence_number: 2, response: { id: "resp_1", status: "completed" } });
      const output = await runPassthrough([`event: ${label}\ndata: ${payload}\n\nevent: response.completed\ndata: ${terminal}\n\n`], FORMATS.OPENAI_RESPONSES, "codex");
      expect(output).toContain(`event: ${label}\n`);
      expect(output).toContain(payload);
    }
  });

  it("retains a data-bearing unterminated keepalive tail", async () => {
    const output = await runPassthrough([`event: keepalive\ndata: ${JSON.stringify(chatChunk)}`], FORMATS.OPENAI);
    expect(output).toContain("event: keepalive");
    expect(output).toContain("Hello keepalive-safe");
  });

  it("keeps a genuine Anthropic ping frame", async () => {
    const output = await runPassthrough(
      [
        'event: ping\ndata: {"type":"ping"}\n\n',
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":3}}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ],
      FORMATS.CLAUDE,
      "claude",
    );

    expect(output).toContain("event: ping");
    expect(output).toContain('{"type":"ping"}');
  });

  it("keeps the gateway-generated keepalive frames out of the filter", async () => {
    // The gateway keepalives are client-protocol bytes: an SSE comment for
    // Chat clients and a real `ping` event for Anthropic clients.
    const gatewayKeepalive = new TextDecoder().decode(ANTHROPIC_PING_FRAME);
    expect(isProviderKeepaliveEvent(gatewayKeepalive.split("\n")[0])).toBe(false);
    expect(isProviderKeepaliveEvent(": keepalive")).toBe(false);
    expect(isProviderKeepaliveEvent("event: ping")).toBe(false);
    expect(isProviderKeepaliveEvent("event: keepalive")).toBe(true);
    expect(isProviderKeepaliveEvent("event: keepalive-status")).toBe(false);
    expect(isProviderKeepaliveEvent("event: keepalive ")).toBe(false);
  });

  it("keeps SSE comments in Chat passthrough", async () => {
    const output = await runPassthrough(
      [": keepalive\n\n", chatFrame, "data: [DONE]\n\n"],
      FORMATS.OPENAI,
    );

    expect(output).toContain(": keepalive");
    expect(output).toContain("Hello keepalive-safe");
  });

  it("keeps error and terminal frames in Chat passthrough", async () => {
    const output = await runPassthrough(
      [
        `data: ${JSON.stringify({ error: { message: "boom", type: "server_error" } })}\n\n`,
        "data: [DONE]\n\n",
      ],
      FORMATS.OPENAI,
    );

    expect(output).toContain("boom");
    expect(output).toContain("server_error");
    expect(output).toContain("data: [DONE]");
  });

  it("keeps the 9router #5441 field-only-frame rule", async () => {
    // A label with no payload is dropped (9router #5441) ...
    const fieldOnly = await runPassthrough(
      ["event: message_start\n\n", chatFrame, "data: [DONE]\n\n"],
      FORMATS.OPENAI,
    );
    expect(fieldOnly).not.toContain("event: message_start");
    expect(fieldOnly).toContain("Hello keepalive-safe");

    // ... and the same label is kept when its frame carries a payload.
    const withPayload = await runPassthrough(
      ["event: message_start\ndata: {\"type\":\"message_start\"}\n\n"],
      FORMATS.OPENAI,
    );
    expect(withPayload).toContain("event: message_start");
    expect(withPayload).toContain('"type":"message_start"');
  });
});

describe("provider keepalive filter", () => {
  it("drops the label and the body of a keepalive block only", () => {
    const filter = createProviderKeepaliveFilter();

    expect(filter.drop("event: keepalive")).toBe(true);
    expect(filter.dropping).toBe(true);
    expect(filter.drop("data:")).toBe(true);
    expect(filter.drop("")).toBe(true);
    expect(filter.dropping).toBe(false);

    expect(filter.drop("data: {\"id\":\"chatcmpl_1\"}")).toBe(false);
    expect(filter.drop("")).toBe(false);
  });

  it("keeps a label that only looks like a keepalive", () => {
    const filter = createProviderKeepaliveFilter();

    expect(filter.drop("event: keepalives")).toBe(false);
    expect(filter.drop("event: ping")).toBe(false);
    expect(filter.drop("data: keepalive")).toBe(false);
  });
});
