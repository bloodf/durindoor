import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...await importOriginal(),
  proxyAwareFetch: fetchMock,
}));

const { DefaultExecutor } = await import("../../open-sse/executors/default.js");

async function wireBody(provider, body) {
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await new DefaultExecutor(provider).execute({
    model: body.model,
    body,
    stream: false,
    credentials: { apiKey: "test-key" },
  });
  return fetchMock.mock.calls[0][1].body;
}

const body = () => ({
  model: "claude-sonnet-4-5",
  max_tokens: 16,
  messages: [
    { role: "user", content: "cut \uD800 tail 😀" },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "read", input: { "bad\uDC00key": "v\uD83D" } }] },
  ],
});

describe("OmniRoute #20129 - lone surrogates on the Claude wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("replaces lone surrogates in strings and keys, and keeps an emoji", async () => {
    const original = body();
    const wire = await wireBody("anthropic", original);

    expect(wire).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    const sent = JSON.parse(wire);
    expect(sent.messages[0].content).toBe("cut � tail 😀");
    expect(sent.messages[1].content[0].input).toEqual({ "bad�key": "v�" });
    expect(original).toEqual(body());
  });

  it("leaves other wire formats as the client sent them", async () => {
    const wire = await wireBody("openai", { model: "gpt-4o", messages: [{ role: "user", content: "cut \uD800" }] });

    expect(wire).toContain("\\ud800");
  });
});
