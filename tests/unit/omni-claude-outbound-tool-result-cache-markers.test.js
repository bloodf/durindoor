import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { anchorClaudeCache } from "../../open-sse/translator/formats/claude.js";

const eph = { type: "ephemeral" };
const hour = { type: "ephemeral", ttl: "1h" };
const png = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };

const nativeBody = (content, extra = {}) => ({
  model: "claude-sonnet-4-6", max_tokens: 100,
  messages: [
    { role: "user", content: "shoot" },
    { role: "assistant", content: [{ type: "tool_use", id: "shot", name: "screenshot", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "shot", content, ...extra }] },
  ],
});
const result = (body) => body.messages.flatMap((m) => Array.isArray(m.content) ? m.content : []).find((b) => b.type === "tool_result");
const nested = (body) => (Array.isArray(result(body).content) ? result(body).content : []).filter((p) => "cache_control" in p);

function bridged(content, provider = "claude") {
  const body = {
    model: "claude-sonnet-4-6", max_tokens: 100,
    messages: [
      { role: "user", content: "shoot" },
      { role: "assistant", content: null, tool_calls: [{ id: "shot", type: "function", function: { name: "screenshot", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "shot", content },
    ],
    tools: [{ type: "function", function: { name: "screenshot", parameters: { type: "object" } } }],
  };
  const before = structuredClone(body);
  const out = translateRequest("openai", "claude", "claude-sonnet-4-6", body, true, null, provider);
  expect(body).toEqual(before);
  return out;
}
const partsWithMarker = () => [
  { type: "text", text: "screen", cache_control: eph },
  { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" }, cache_control: hour },
];

describe("Claude outbound tool-result cache markers", () => {
  describe.each(["claude", "anthropic"])("native passthrough to %s", (provider) => {
    it("hoists the first valid nested marker, strips the rest, keeps payload and flags", () => {
      const body = nativeBody([{ type: "text", text: "a", cache_control: hour }, { ...png, cache_control: eph }], { is_error: true });
      anchorClaudeCache(body, provider);
      expect(nested(body)).toEqual([]);
      expect(result(body)).toMatchObject({ is_error: true, tool_use_id: "shot", content: [{ type: "text", text: "a" }, png] });
    });

    it("keeps an existing parent marker over nested ones (budget spent so message markers survive)", () => {
      const body = nativeBody([{ type: "text", text: "a", cache_control: hour }], { cache_control: eph });
      body.messages[0].content = [{ type: "text", text: "u", cache_control: eph }, { type: "text", text: "v", cache_control: eph }];
      body.messages[1].content[0].cache_control = eph;
      anchorClaudeCache(body, provider);
      expect(result(body).cache_control).toEqual(eph);
      expect(nested(body)).toEqual([]);
    });

    it("hoists into a spent budget and enforces the four-marker limit", () => {
      const body = nativeBody([{ type: "text", text: "a", cache_control: hour }]);
      body.system = [{ type: "text", text: "sys" }];
      body.messages[0].content = [{ type: "text", text: "u", cache_control: eph }, { type: "text", text: "v", cache_control: eph }, { type: "text", text: "w", cache_control: eph }];
      anchorClaudeCache(body, provider);
      const count = [body.system, ...body.messages.map((m) => m.content)].flat().filter((b) => b?.cache_control).length;
      expect(count).toBeLessThanOrEqual(4);
      expect(result(body).cache_control).toEqual(hour);
      expect(nested(body)).toEqual([]);
    });

    it("omits malformed nested markers without hoisting them and leaves string content alone", () => {
      const bad = [true, "ephemeral", { type: "forever" }, { type: "ephemeral", ttl: "2d" }, null];
      for (const marker of bad) {
        const body = nativeBody([{ type: "text", text: "a", cache_control: marker }]);
        anchorClaudeCache(body, provider);
        expect(result(body).content).toEqual([{ type: "text", text: "a" }]);
        expect(result(body).cache_control).toBeUndefined();
      }
      const str = nativeBody("plain");
      anchorClaudeCache(str, provider);
      expect(result(str)).toEqual({ type: "tool_result", tool_use_id: "shot", content: "plain" });
    });

    it("does not mutate caller-owned parts", () => {
      const part = { type: "text", text: "a", cache_control: hour };
      anchorClaudeCache(nativeBody([part]), provider);
      expect(part).toEqual({ type: "text", text: "a", cache_control: hour });
    });
  });

  it("leaves compatible Claude-wire native bodies untouched", () => {
    const body = nativeBody([{ type: "text", text: "a", cache_control: hour }]);
    anchorClaudeCache(body, "glm");
    expect(nested(body)).toEqual([{ type: "text", text: "a", cache_control: hour }]);
    const noProvider = nativeBody([{ type: "text", text: "a", cache_control: hour }]);
    anchorClaudeCache(noProvider);
    expect(nested(noProvider)).toHaveLength(1);
  });

  describe("bridged OpenAI → Claude preparation", () => {
    it.each(["claude", "anthropic"])("removes nested markers for %s and keeps converter payload", (provider) => {
      const out = bridged(partsWithMarker(), provider);
      expect(nested(out)).toEqual([]);
      expect(result(out).content).toEqual([
        { type: "text", text: "screen" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      ]);
      const count = [out.system, out.tools, ...out.messages.map((m) => m.content)].flat().filter((b) => b?.cache_control).length;
      expect(count).toBeLessThanOrEqual(4);
    });

    it("keeps nested markers for unverified compatible targets", () => {
      expect(nested(bridged(partsWithMarker(), "glm"))).toHaveLength(2);
    });
  });
});
