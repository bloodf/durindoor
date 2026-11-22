import { describe, expect, it, vi } from "vitest";
import { ChatGptWebExecutor } from "../../open-sse/executors/chatgpt-web.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { BLOCKED_OMNIROUTE_PROVIDERS } from "../../open-sse/executors/unsupported-websession.js";
import { ChatGptWebCodexExecutor } from "../../open-sse/executors/chatgpt-web-codex.js";

const input = (body, overrides = {}) => ({
  model: "gpt-5.6-sol-medium",
  body,
  stream: false,
  credentials: { apiKey: "cookie", providerSpecificData: {} },
  ...overrides,
});

describe("web-session executor wiring regressions", () => {
  it("does not send image or file tool requests to ChatGPT Web HTTP", async () => {
    const httpExecutor = { execute: vi.fn() };
    const runBrowser = vi.fn();
    const executor = new ChatGptWebExecutor({ httpExecutor, runBrowser });
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "inspect this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }],
      tools: [{ type: "function", function: { name: "lookup" } }],
    };

    const result = await executor.execute(input(body));

    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toMatchObject({ error: { message: expect.stringMatching(/image or file.*tools/i) } });
    expect(httpExecutor.execute).not.toHaveBeenCalled();
    expect(runBrowser).not.toHaveBeenCalled();
  });

  it("keeps image-only auto requests on browser and does not fall back to lossy HTTP", async () => {
    const httpExecutor = { execute: vi.fn() };
    const runBrowser = vi.fn(async () => { throw new Error("Chromium unavailable"); });
    const executor = new ChatGptWebExecutor({ httpExecutor, runBrowser });
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "describe" }, { type: "input_file", file_id: "file-1" }] }] };

    const result = await executor.execute(input(body));

    expect(result.response.status).toBe(503);
    expect(runBrowser).toHaveBeenCalledOnce();
    expect(httpExecutor.execute).not.toHaveBeenCalled();
  });

  it("uses the real executor registry for ChatGPT Web Codex and records valid Muse source paths", () => {
    expect(getExecutor("chatgpt-web-codex")).toBeInstanceOf(ChatGptWebCodexExecutor);
    expect(getExecutor("cgpt-codex")).toBeInstanceOf(ChatGptWebCodexExecutor);
    expect(BLOCKED_OMNIROUTE_PROVIDERS["muse-spark-web"].source).toEqual([
      "open-sse/executors/muse-spark-web.js",
      "open-sse/executors/muse-spark-web/response-parser.js",
    ]);
  });
});
