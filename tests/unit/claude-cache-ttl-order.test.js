import { describe, expect, it } from "vitest";
import { anchorClaudeCache, normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

const H1 = { type: "ephemeral", ttl: "1h" };
const M5 = { type: "ephemeral" };
const text = (value, marker) => ({ type: "text", text: value, ...(marker ? { cache_control: { ...marker } } : {}) });

// Prefix order Anthropic reads breakpoints in: tools, system, messages.
const markersInOrder = (body) => [
  ...(body.tools ?? []),
  ...(Array.isArray(body.system) ? body.system : []),
  ...body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])),
].filter((b) => b?.cache_control).map((b) => b.cache_control);

const assertValidBreakpoints = (body) => {
  const markers = markersInOrder(body);
  expect(markers.length).toBeLessThanOrEqual(4);
  const firstShort = markers.findIndex((m) => m.ttl !== "1h");
  if (firstShort >= 0) expect(markers.slice(firstShort).every((m) => m.ttl !== "1h")).toBe(true);
};

const passthrough = (body) => {
  normalizeClaudePassthrough(body, body.model, "claude", null, { foldSystemTurns: true });
  return anchorClaudeCache(body, "claude");
};

describe("9router#5860 follow-up: folded 1h marker never lands after a 5m breakpoint", () => {
  it("raises earlier 5m markers to the moved 1h marker's TTL when the cap path returns early", () => {
    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: [text("You are an agent.", M5)],
      tools: [{ name: "read", description: "read", input_schema: { type: "object" }, cache_control: { ...M5 } }],
      messages: [
        { role: "user", content: [text("Fix the bug.", M5)] },
        { role: "assistant", content: [text("Reading.", M5)] },
        { role: "user", content: [text("Continue.")] },
        { role: "system", content: [text("reminder", H1)] },
      ],
    };
    passthrough(body);
    assertValidBreakpoints(body);
    expect(markersInOrder(body)).toEqual([H1, H1, H1, H1]);
    expect(body.messages.at(-1).content.at(-1).cache_control).toEqual(H1);
  });

  it("keeps the ordering invariant and four-marker budget on every anchor path", () => {
    let seed = 5860;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const pick = () => [null, M5, H1][Math.floor(rand() * 3)];
    for (let run = 0; run < 500; run++) {
      const messages = [];
      const turns = 1 + Math.floor(rand() * 5);
      for (let t = 0; t < turns; t++) {
        messages.push({ role: "user", content: [text(`u${t}`, pick()), ...(rand() < 0.3 ? [text(`u${t}b`, pick())] : [])] });
        if (t < turns - 1 || rand() < 0.3) messages.push({ role: "assistant", content: [text(`a${t}`, pick())] });
        if (rand() < 0.25) messages.push({ role: "system", content: [text(`s${t}`, pick())] });
      }
      const body = {
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: [text("sys", pick())],
        tools: rand() < 0.6 ? [{ name: "t", description: "t", input_schema: { type: "object" }, ...(pick() ? { cache_control: { ...pick() ?? M5 } } : {}) }] : undefined,
        messages,
      };
      if (!body.tools) delete body.tools;
      const plain = structuredClone(body);
      plain.messages = plain.messages.filter((m) => m.role !== "system");
      assertValidBreakpoints(passthrough(body));
      assertValidBreakpoints(anchorClaudeCache(plain, "claude"));
    }
  });
});
