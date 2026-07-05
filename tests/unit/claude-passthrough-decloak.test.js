/**
 * Unit tests for open-sse/utils/stream.js — passthrough tool-name decloaking
 *
 * claude→claude streaming passthrough forwards provider SSE bytes without
 * running translateResponse (which is where TRANSLATE mode applies
 * `toolNameMap`). Without decloaking, a client that had its tools cloaked
 * for OAuth anti-ban (see claudeCloaking.js) sees the internal suffixed
 * tool name (e.g. "Execute_ide") instead of the tool it actually asked for.
 */

import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

async function runPassthrough(toolNameMap, chunks) {
  const stream = createPassthroughStreamWithLogger(
    "claude",           // provider
    null,               // reqLogger
    toolNameMap,        // toolNameMap
    "claude-opus-4",    // model
    "conn-1",           // connectionId
    {},                 // body
    null,               // onStreamComplete
    "sk-ant-oat-test"   // apiKey
  );

  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readAll = (async () => {
    let out = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += decoder.decode(value);
    }
    return out;
  })();

  for (const chunk of chunks) {
    await writer.write(encoder.encode(chunk));
  }
  await writer.close();

  return readAll;
}

describe("claude→claude passthrough tool-name decloaking", () => {
  it("decloaks a cloaked tool_use name in content_block_start", async () => {
    const toolNameMap = new Map([["Execute_ide", "Execute"]]);
    const sseChunk =
      `data: ${JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_01", name: "Execute_ide", input: {} }
      })}\n\n`;

    const output = await runPassthrough(toolNameMap, [sseChunk]);

    expect(output).not.toContain("Execute_ide");
    expect(output).toContain('"name":"Execute"');
  });

  it("leaves non-tool_use content_block_start events untouched", async () => {
    const toolNameMap = new Map([["Execute_ide", "Execute"]]);
    const sseChunk =
      `data: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" }
      })}\n\n`;

    const output = await runPassthrough(toolNameMap, [sseChunk]);

    expect(output).toContain('"type":"text"');
  });

  it("is a no-op when toolNameMap is null (non-cloaked route)", async () => {
    const sseChunk =
      `data: ${JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_01", name: "Execute", input: {} }
      })}\n\n`;

    const output = await runPassthrough(null, [sseChunk]);

    expect(output).toContain('"name":"Execute"');
  });

  it("does not decloak a tool name not present in the map", async () => {
    const toolNameMap = new Map([["Other_ide", "Other"]]);
    const sseChunk =
      `data: ${JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_01", name: "Execute_ide", input: {} }
      })}\n\n`;

    const output = await runPassthrough(toolNameMap, [sseChunk]);

    expect(output).toContain('"name":"Execute_ide"');
  });
});
