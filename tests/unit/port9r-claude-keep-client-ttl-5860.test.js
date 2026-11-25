import { describe, expect, it } from "vitest";
import { anchorClaudeCache, normalizeClaudePassthrough, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const H1 = { type: "ephemeral", ttl: "1h" };
const M5 = { type: "ephemeral" };
const text = (value, extra = {}) => ({ type: "text", text: value, ...extra });

const conversation = (marker) => ({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  system: [text("You are an agent.", { cache_control: H1 })],
  messages: [
    { role: "user", content: [text("Fix the bug.", marker ? { cache_control: marker } : {})] },
    { role: "assistant", content: [text("Reading.")] },
    { role: "user", content: [text("Continue.")] },
  ],
});

const messageMarkers = (body) =>
  body.messages.flatMap((message) => message.content.filter((block) => block.cache_control).map((block) => block.cache_control));

describe("port(upstream) 9router#5860: re-anchored message breakpoints keep the client's TTL", () => {
  describe.each([
    ["anchorClaudeCache", (body) => anchorClaudeCache(body, "claude")],
    ["prepareClaudeRequest", (body) => prepareClaudeRequest(body, "claude")],
  ])("%s", (_name, run) => {
    it("keeps 1h when a client message marker asked for it", () => {
      expect(messageMarkers(run(conversation(H1)))).toEqual([H1]);
    });

    it("stays at 5m for 5m markers and for no markers", () => {
      expect(messageMarkers(run(conversation(M5)))).toEqual([M5]);
      expect(messageMarkers(run(conversation(null)))).toEqual([M5]);
    });
  });

  it("reads a 1h marker on a single-object content block", () => {
    const body = conversation(null);
    body.messages[0].content = text("Fix the bug.", { cache_control: H1 });
    expect(messageMarkers(anchorClaudeCache(body, "claude"))).toEqual([H1]);
  });

  it("keeps 1h when the only message marker sits on a trailing system turn that folding drops", () => {
    const body = conversation(null);
    body.messages.push({ role: "system", content: [text("reminder", { cache_control: H1 })] });
    const original = body.messages[2].content[0];
    normalizeClaudePassthrough(body, body.model, "claude", null, { foldSystemTurns: true });
    expect(messageMarkers(anchorClaudeCache(body, "claude"))).toEqual([H1]);
    expect(original.cache_control).toBeUndefined();
  });
});
