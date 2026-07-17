import { describe, expect, it } from "vitest";
import { sessionDedupEngine } from "../../../open-sse/services/compression/engines/session-dedup/index.js";
import { getEngine } from "../../../open-sse/services/compression/index.js";

const REPEATED_BLOCK = `function expensiveCalc(x) {
  // step 1
  const a = x * 2;
  // step 2
  const b = a + 100;
  // step 3
  return b;
}`;

const makeBody = (messages) => ({ model: "gpt-4", messages });

describe("session-dedup engine", () => {
  it("is registered and exposes the engine contract", () => {
    const engine = getEngine("session-dedup");
    expect(engine.id).toBe("session-dedup");
    expect(typeof engine.apply).toBe("function");
    expect(typeof engine.compress).toBe("function");
    expect(typeof engine.getConfigSchema).toBe("function");
    expect(typeof engine.validateConfig).toBe("function");
    expect(engine.stackable).toBe(true);
    expect(typeof engine.stackPriority).toBe("number");
  });

  it("deduplicates a block appearing verbatim in turn 1 and turn 3", () => {
    const body = makeBody([
      { role: "user", content: `Here is the code:\n${REPEATED_BLOCK}` },
      { role: "assistant", content: "I understand the code." },
      { role: "user", content: `Please review again:\n${REPEATED_BLOCK}` },
    ]);

    const result = sessionDedupEngine.apply(body);
    const messages = result.body.messages;

    expect(result.compressed).toBe(true);
    expect(messages[0].content).toContain(REPEATED_BLOCK); // first occurrence intact
    expect(messages[2].content).not.toContain(REPEATED_BLOCK); // duplicate removed
    expect(messages[2].content).toMatch(/\[dedup:ref sha=[0-9a-f]{24}\]/); // marker
    expect(JSON.stringify(result.body).length).toBeLessThan(JSON.stringify(body).length);
    expect(result.stats).not.toBeNull();
    expect(result.stats.originalTokens).toBeGreaterThan(0);
    expect(result.stats.compressedTokens).toBeLessThan(result.stats.originalTokens);
  });

  it("does NOT dedup small/unique blocks (no false positives)", () => {
    const body = makeBody([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "bye" },
    ]);
    const result = sessionDedupEngine.apply(body);
    expect(result.compressed).toBe(false);
    expect(result.body.messages.map((m) => m.content)).toEqual(["hi", "hello", "bye"]);
  });

  it("never deduplicates the system prompt", () => {
    const body = makeBody([
      { role: "system", content: REPEATED_BLOCK },
      { role: "user", content: REPEATED_BLOCK },
      { role: "assistant", content: "ok" },
    ]);
    const result = sessionDedupEngine.apply(body);
    expect(result.body.messages[0].content).toContain(REPEATED_BLOCK);
  });

  it("does not corrupt multipart (non-string) content items", () => {
    const body = {
      model: "gpt-4",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: REPEATED_BLOCK },
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
          ],
        },
        { role: "assistant", content: "ok" },
        { role: "user", content: [{ type: "text", text: REPEATED_BLOCK }] },
      ],
    };
    const result = sessionDedupEngine.apply(body);
    const first = result.body.messages[0].content;
    const image = first.find((c) => c.type === "image_url");
    expect(image).toBeDefined();
    expect(image.image_url).toEqual({ url: "data:image/png;base64,abc" });
  });

  it("getConfigSchema includes minBlockChars + enabled", () => {
    const keys = sessionDedupEngine.getConfigSchema().map((f) => f.key);
    expect(keys).toContain("minBlockChars");
    expect(keys).toContain("enabled");
  });

  it("validateConfig accepts valid and rejects invalid", () => {
    expect(sessionDedupEngine.validateConfig({}).valid).toBe(true);
    expect(sessionDedupEngine.validateConfig({ minBlockChars: 50 }).valid).toBe(true);
    expect(sessionDedupEngine.validateConfig({ minBlockChars: -1 }).valid).toBe(false);
    expect(sessionDedupEngine.validateConfig({ enabled: "yes" }).valid).toBe(false);
  });

  it("fail-open: a malformed body is returned unchanged", () => {
    const body = { model: "gpt-4" }; // no messages array
    expect(() => sessionDedupEngine.apply(body)).not.toThrow();
    const result = sessionDedupEngine.apply(body);
    expect(result.compressed).toBe(false);
  });
});
