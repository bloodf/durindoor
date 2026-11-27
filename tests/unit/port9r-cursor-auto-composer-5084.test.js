import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/cursorModels.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveCursorModels: vi.fn(),
  };
});

import { resolveAutoModelSelection, resolveCursorModels } from "../../open-sse/services/cursorModels.js";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;
const msg = (field, value) => encodeField(field, LEN, value);

function thinkingFrame(text) {
  return wrapConnectRPCFrame(msg(1, msg(4, msg(1, text))));
}

function turnEndedFrame() {
  return wrapConnectRPCFrame(msg(1, msg(14, new Uint8Array())));
}

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: ") && !chunk.includes("[DONE]"))
    .map((chunk) => JSON.parse(chunk.slice(6)));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("upstream PR #5084: Cursor auto-resolved Composer extraction and omitted supportsAgent flags", () => {
  it("treats usable models with omitted supportsAgent as agent-capable while excluding explicit false/chat-only/hidden", () => {
    expect(resolveAutoModelSelection([
      { id: "chat-only", isChatOnly: true },
      { id: "hidden-one", isHidden: true },
      { id: "not-agent", supportsAgent: false },
      { id: "composer-1.5", name: "Composer 1.5" },
    ])).toEqual({ modelId: "composer-1.5", matchedBy: "auto-default" });
  });

  it("extracts visible text after </think> when model 'auto' resolves to a Composer model", async () => {
    vi.stubGlobal("fetch", vi.fn());
    resolveCursorModels.mockResolvedValue({
      models: [{ id: "composer-1.5", name: "Composer 1.5", defaultOn: true, supportsAgent: true }],
    });

    const executor = new CursorExecutor();
    const queue = [
      thinkingFrame("internal reasoning</think>Visible answer"),
      turnEndedFrame(),
    ];
    executor.openAgentHttp2Stream = async () => ({
      responseHeaders: Promise.resolve({ ":status": 200 }),
      write() {},
      end() {},
      close() {},
      async read() {
        if (!queue.length) return { value: undefined, done: true };
        return { value: queue.shift(), done: false };
      },
    });

    const result = await executor.executeAgent({
      model: "auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "tok", providerSpecificData: { machineId: "a".repeat(64) } },
      proxyOptions: { disableEnvProxy: true },
    });

    const events = parseSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("Visible answer");
    expect(content).not.toContain("internal reasoning");
  });
});
