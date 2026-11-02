// #1093: Lite whitespace/format compression engine.
import { describe, expect, it } from "vitest";
import { applyLiteCompression, liteEngine, normalizeProseWhitespace, resolveLiteMaxToolLength } from "../../../open-sse/services/compression/engines/lite.js";
import { getEngine, isEngineAvailable } from "../../../open-sse/services/compression/index.js";
import { runCompressionSeam } from "../../../open-sse/handlers/chatCore/compressionHook.js";
import { checkProtectedBlocks } from "../../../open-sse/services/compression/fidelityGate.js";
import { FIDELITY_CORPUS } from "../../../open-sse/services/compression/eval/corpus.js";
import { runFidelityEval } from "../../../open-sse/services/compression/eval/runFidelityEval.js";

const corpusBody = (id) => structuredClone(FIDELITY_CORPUS.find((c) => c.id === id).body);
const LONG_TOOL = Array.from({ length: 200 }, (_, i) => `line ${i} of a long build log output`).join("\n");

describe("lite engine", () => {
  it("is dispatchable from the registry", () => {
    expect(isEngineAvailable("lite")).toBe(true);
    expect(getEngine("lite").id).toBe("lite");
  });

  it("collapses prose whitespace but never touches fenced code", () => {
    const text = "Hello   \n\n\n\nworld\n```js\nconst a = 1;   \n\n\n\nconst b = 2;\n```\n\n\n\nbye  ";
    expect(normalizeProseWhitespace(text)).toBe("Hello\n\nworld\n```js\nconst a = 1;   \n\n\n\nconst b = 2;\n```\n\nbye");
  });

  it("successful run: compresses, reports stats, never mutates input", () => {
    const body = corpusBody("code-fenced");
    const before = JSON.stringify(body);
    const res = applyLiteCompression(body);
    expect(res.compressed).toBe(true);
    expect(res.stats.techniquesUsed).toContain("whitespace");
    expect(res.stats.compressedTokens).toBeLessThanOrEqual(res.stats.originalTokens);
    expect(JSON.stringify(body)).toBe(before);
    expect(res.body.messages[0]).toBe(body.messages[0]); // system preserved by default
    expect(checkProtectedBlocks(body, res.body).passed).toBe(true);
  });

  it("unchanged run: returns the same body reference", () => {
    const body = { messages: [{ role: "user", content: "already tidy" }] };
    const res = applyLiteCompression(body);
    expect(res).toEqual({ body, compressed: false, stats: null });
    expect(res.body).toBe(body);
  });

  it("does not alter tool outputs, error results or media", () => {
    for (const id of ["tool-failures", "openai-error-tool", "images-and-pdf", "openai-image-url", "json-tool-output", "thinking-signatures"]) {
      const body = corpusBody(id);
      const res = applyLiteCompression(body);
      expect(checkProtectedBlocks(body, res.body).passed, id).toBe(true);
      const tools = (b) => b.messages.filter((m) => m.role === "tool");
      expect(tools(res.body), id).toEqual(tools(body));
    }
  });

  it("system dedup only when preserveSystemPrompt is false, and by full content", () => {
    const body = { messages: [
      { role: "system", content: "A".repeat(250) + "one" },
      { role: "system", content: "A".repeat(250) + "two" },
      { role: "system", content: "A".repeat(250) + "one" },
      { role: "user", content: "hi" },
    ] };
    expect(applyLiteCompression(body).compressed).toBe(false);
    const res = applyLiteCompression(body, { preserveSystemPrompt: false });
    expect(res.body.messages.map((m) => m.content.slice(-3))).toEqual(["one", "two", "hi"]);
  });

  it("drops exact consecutive duplicates but keeps tool-call turns", () => {
    const body = { messages: [
      { role: "user", content: "retry please" },
      { role: "user", content: "retry please" },
      { role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "x", arguments: "{}" } }] },
      { role: "assistant", content: "", tool_calls: [{ id: "b", type: "function", function: { name: "x", arguments: "{}" } }] },
    ] };
    const res = applyLiteCompression(body);
    expect(res.stats.techniquesUsed).toEqual(["redundant-remove"]);
    expect(res.body.messages).toHaveLength(3);
  });

  describe("bounded tool-result truncation", () => {
    const history = (content, extra = {}) => ({ messages: [
      { role: "user", content: "run it" },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "sh", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "t1", content, ...extra },
      { role: "assistant", content: "done" },
      { role: "user", content: "next" },
    ] });

    it("is off unless explicitly enabled", () => {
      expect(applyLiteCompression(history(LONG_TOOL)).compressed).toBe(false);
    });

    it("truncates older plain-text results at a word boundary when enabled", () => {
      const res = applyLiteCompression(history(LONG_TOOL), { truncateToolResults: true, maxToolLength: 300 });
      const out = res.body.messages[2].content;
      expect(res.stats.techniquesUsed).toEqual(["tool-truncate"]);
      expect(out.endsWith("\n...[truncated]")).toBe(true);
      expect(out.length).toBeLessThanOrEqual(300 + "\n...[truncated]".length);
      expect(LONG_TOOL.startsWith(out.replace("\n...[truncated]", ""))).toBe(true);
    });

    it("never truncates error, JSON, fenced-code or current-turn results", () => {
      const opts = { truncateToolResults: true, maxToolLength: 300 };
      expect(applyLiteCompression(history(LONG_TOOL, { is_error: true }), opts).compressed).toBe(false);
      expect(applyLiteCompression(history(JSON.stringify({ rows: LONG_TOOL.split("\n") })), opts).compressed).toBe(false);
      expect(applyLiteCompression(history("```\n" + LONG_TOOL + "\n```"), opts).compressed).toBe(false);
      const current = history(LONG_TOOL);
      current.messages = current.messages.slice(0, 3);
      expect(applyLiteCompression(current, opts).compressed).toBe(false);
    });

    it("clamps maxToolLength to its bounds", () => {
      expect(resolveLiteMaxToolLength(10)).toBe(2000);
      expect(resolveLiteMaxToolLength(5_000_000)).toBe(2000);
      expect(resolveLiteMaxToolLength(512.9)).toBe(512);
      expect(liteEngine.validateConfig({ maxToolLength: 10 }).valid).toBe(false);
      expect(liteEngine.validateConfig({ maxToolLength: 512, truncateToolResults: true }).valid).toBe(true);
    });
  });

  it("compresses Responses input via the body adapter and restores item shape", async () => {
    const body = corpusBody("responses-tool-output");
    const res = await getEngine("lite").apply(body, {});
    expect(res.compressed).toBe(true);
    expect(res.body.input.map((i) => i.type)).toEqual(body.input.map((i) => i.type));
    expect(res.body.input[2]).toEqual(body.input[2]); // function_call_output untouched
    expect(res.body.instructions).toBe(body.instructions);
  });

  it("passes the corpus gate with zero invariant failures", async () => {
    const report = await runFidelityEval({ engineIds: ["lite"] });
    expect(report.records.flatMap((r) => r.failures)).toEqual([]);
    expect(report.perEngine.lite.compressed).toBeGreaterThan(0);
    expect(report.perEngine.lite.errors).toBe(0);
  });
});

describe("lite in the compression seam", () => {
  const messy = () => ({ messages: [{ role: "user", content: "Please look   \n\n\n\n\nat this." }] });

  it("disabled seam leaves the body untouched", async () => {
    const b = messy();
    const out = await runCompressionSeam(b, undefined, { enabled: false, engines: { lite: { enabled: true } } });
    expect(out.body).toBe(b);
  });

  it("single-mode lite compresses and emits the header", async () => {
    const out = await runCompressionSeam(messy(), undefined, { enabled: true, engines: { lite: { enabled: true } } });
    expect(out.body.messages[0].content).toBe("Please look\n\nat this.");
    expect(out.headerValue).toMatch(/^lite\|/);
  });

  it("forwards per-engine options from the toggle map to the step", async () => {
    const body = {
      messages: [
        { role: "user", content: "run it" },
        { role: "tool", tool_call_id: "t1", content: LONG_TOOL },
        { role: "assistant", content: "done" },
      ],
    };
    const out = await runCompressionSeam(body, undefined, {
      enabled: true,
      engines: { lite: { enabled: true, truncateToolResults: true, maxToolLength: 300 } },
    });
    expect(out.body.messages[1].content.endsWith("...[truncated]")).toBe(true);
  });

  it("mixed stack: lite then caveman both run in priority order", async () => {
    const body = { messages: [{ role: "user", content: "I would really like you to please basically explain   \n\n\n\nthe caching layer to me in detail." }] };
    const out = await runCompressionSeam(body, undefined, {
      enabled: true,
      engines: { caveman: { enabled: true }, lite: { enabled: true } },
    });
    expect(out.headerValue).toMatch(/^lite,caveman\|/);
  });

  it("a failing lite step leaves the original body untouched", async () => {
    const b = messy();
    const deps = {
      isEngineAvailable: () => true,
      getEngine: () => ({ apply: async () => { throw new Error("boom"); } }),
      planToEngineIds: () => ["lite"],
    };
    const out = await runCompressionSeam(b, deps, { enabled: true, engines: { lite: { enabled: true } } });
    expect(out.body).toBe(b);
    expect(out.headerValue).toBeNull();
  });
});
