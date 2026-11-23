import { afterEach, describe, expect, it, vi } from "vitest";

const proxyFetch = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: proxyFetch }));

import { GrokWebExecutor } from "../../open-sse/executors/grok-web.js";

const executor = new GrokWebExecutor();
const frame = (response) => `${JSON.stringify({ result: { response } })}\n`;
const thinkingAndAnswer = frame({ token: "pondering", isThinking: true }) + frame({ token: "answer" });
const run = (model, stream = true, messages = [{ role: "user", content: "input prompt" }], proxyOptions = null) =>
  executor.execute({ model, body: { messages }, stream, credentials: { apiKey: "fake-session" }, proxyOptions });

afterEach(() => proxyFetch.mockReset());

describe("Grok Web issue 2264 fixes", () => {
  it("emits marked thinking tokens as reasoning only for thinking models", async () => {
    proxyFetch.mockResolvedValue(new Response(thinkingAndAnswer));
    const { response } = await run("grok-4-thinking");
    const frames = (await response.text()).split("\n\n").filter((entry) => entry.startsWith("data: {")).map((entry) => JSON.parse(entry.slice(6)));
    const deltas = frames.flatMap((item) => item.choices[0].delta);
    expect(deltas).toContainEqual({ reasoning_content: "pondering" });
    expect(deltas).toContainEqual({ content: "answer" });
    expect(deltas).not.toContainEqual({ content: "pondering" });
  });

  it("drops marked thinking tokens from non-thinking models", async () => {
    proxyFetch.mockResolvedValue(new Response(thinkingAndAnswer));
    const { response } = await run("grok-4");
    const output = await response.text();
    expect(output).not.toContain("pondering");
    expect(output).not.toContain("reasoning_content");
    expect(output).toContain('"content":"answer"');
  });

  it("estimates prompt usage from the input and passes proxy options to fetch", async () => {
    proxyFetch.mockResolvedValue(new Response(frame({ token: "a much longer answer" })));
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.test:3128" };
    const { response } = await run("grok-4", false, [{ role: "user", content: "input prompt" }], proxyOptions);
    const body = await response.json();
    expect(body.usage.prompt_tokens).toBe(Math.ceil("input prompt".length / 4));
    expect(proxyFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "POST" }), proxyOptions);
  });

  it("returns 400 invalid_request for a null message", async () => {
    const { response } = await run("grok-4", false, [null]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.type).toBe("invalid_request");
    expect(proxyFetch).not.toHaveBeenCalled();
  });
});
