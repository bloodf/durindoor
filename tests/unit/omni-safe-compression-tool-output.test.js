// #1073 / OmniRoute #18818: existing safe compression keeps ordinary tool output and
// signed/tool metadata byte-for-byte. Offline: synthetic structured bodies only, no provider,
// no network, no database. Explicit opt-in lossy behavior and error exclusions stay pinned.
import { describe, expect, it } from "vitest";
import { runCompressionSeam } from "../../open-sse/handlers/chatCore/compressionHook.js";
import { adaptBodyForCompression } from "../../open-sse/services/compression/bodyAdapter.js";
import { getEngine } from "../../open-sse/services/compression/index.js";
import { rtkEngine } from "../../open-sse/services/compression/engines/rtkAdapter.js";

const MARKER = "\n...[truncated]";

// Whitespace-sensitive, no repeated blocks: trailing spaces, tab tails and blank-line runs
// that Lite would fold if it were allowed to touch a tool message.
function sensitiveToolText(bytes) {
  const rows = [];
  let size = 0;
  for (let i = 0; size < bytes; i++) {
    const row = `row ${i} value=${(i * 7919) % 10007}  \t\n\n\n\n`;
    rows.push(row);
    size += row.length;
  }
  return rows.join("").slice(0, bytes);
}
const SIZES = [10_800, 16_000, 100_000];
const MESSY_USER = "please   look\n\n\n\n\nat this   ";
const CLEAN_USER = "please   look\n\nat this";
const SIGNED_THINKING = { type: "thinking", thinking: "plan", signature: "sig-synthetic-0001" };

const chatBody = (tool, extra = {}) => ({
  model: "synthetic",
  messages: [
    { role: "user", content: MESSY_USER },
    {
      role: "assistant",
      content: [SIGNED_THINKING, { type: "text", text: "running" }],
      tool_calls: [{ id: "call_1", type: "function", function: { name: "sh", arguments: '{"cmd":"cat  log"}' } }],
    },
    { role: "tool", tool_call_id: "call_1", content: tool, ...extra },
    { role: "assistant", content: "done" },
    { role: "user", content: "next" },
  ],
});

const responsesBody = (tool, customTool = tool) => ({
  model: "synthetic",
  instructions: "keep   this\n\n\n\nverbatim  ",
  input: [
    { type: "message", role: "user", content: MESSY_USER },
    { type: "reasoning", id: "rs_1", encrypted_content: "enc-synthetic-0001", summary: [] },
    { type: "function_call", call_id: "fc_1", name: "sh", arguments: '{"cmd":"cat  log"}' },
    { type: "function_call_output", call_id: "fc_1", output: tool },
    { type: "custom_tool_call", call_id: "ct_1", name: "patch", input: "a  \n\n\n\nb" },
    { type: "custom_tool_call_output", call_id: "ct_1", output: customTool },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
    { type: "message", role: "user", content: "next" },
  ],
});

const kiroBody = (ok, failed) => ({
  conversationState: {
    history: [
      {
        userInputMessage: {
          content: MESSY_USER,
          userInputMessageContext: {
            toolResults: [
              { toolUseId: "tu_ok", status: "success", content: [{ text: ok }] },
              { toolUseId: "tu_bad", status: "error", content: [{ text: failed }] },
            ],
          },
        },
      },
      { assistantResponseMessage: { content: "done" } },
    ],
    currentMessage: { userInputMessage: { content: "next" } },
  },
});

const seam = (body, engines, extra = {}) =>
  runCompressionSeam(body, undefined, { enabled: true, engines, ...extra });

const SAFE_STACKS = {
  "lite alone": { lite: { enabled: true } },
  "caveman alone": { caveman: { enabled: true } },
  "lite + caveman": { lite: { enabled: true }, caveman: { enabled: true } },
  "session-dedup + lite": { "session-dedup": { enabled: true }, lite: { enabled: true } },
  "lite with an unopted clipping length": { lite: { enabled: true, maxToolLength: 300 } },
};

describe("#1073 safe compression keeps ordinary tool output (existing Lite/Caveman/dedup)", () => {
  describe("Chat Completions bodies", () => {
    for (const [label, engines] of Object.entries(SAFE_STACKS)) {
      for (const bytes of SIZES) {
        it(`${label}: ${bytes}-byte unique result and tool metadata stay byte-identical`, async () => {
          const tool = sensitiveToolText(bytes);
          const body = chatBody(tool);
          const before = JSON.stringify(body);
          const out = await seam(body, engines);
          expect(JSON.stringify(body)).toBe(before); // caller body never mutated
          const tm = out.body.messages[2];
          expect(tm.content).toBe(tool);
          expect(tm.tool_call_id).toBe("call_1");
          expect(out.body.messages[1]).toEqual(body.messages[1]); // tool_calls + signed thinking
          expect(out.body.messages[1].content[0].signature).toBe("sig-synthetic-0001");
        });
      }
    }

    it("array-shaped tool content is left untouched", async () => {
      const parts = [{ type: "text", text: sensitiveToolText(10_800) }, { type: "text", text: "tail  \n\n\n\n" }];
      const body = chatBody(parts);
      const out = await seam(body, { lite: { enabled: true } });
      expect(out.body.messages[2].content).toEqual(parts);
    });

    it("non-tool processing is unchanged: ordinary user whitespace is still folded", async () => {
      const out = await seam(chatBody(sensitiveToolText(10_800)), { lite: { enabled: true } });
      expect(out.body.messages[0].content).toBe(CLEAN_USER);
      expect(out.headerValue).toMatch(/^lite\|/);
    });

    it("a result with only tool whitespace to fold reports no compression", async () => {
      const body = { messages: [{ role: "user", content: "run" }, { role: "tool", tool_call_id: "c", content: "a  \n\n\n\nb" }] };
      const out = await seam(body, { lite: { enabled: true } });
      expect(out.body).toBe(body);
      expect(out.headerValue).toBeNull();
    });
  });

  describe("Responses bodies (adapter transport)", () => {
    for (const [label, engines] of Object.entries(SAFE_STACKS)) {
      for (const bytes of SIZES) {
        it(`${label}: ${bytes}-byte function and custom tool outputs plus signed items stay identical`, async () => {
          const tool = sensitiveToolText(bytes);
          const body = responsesBody(tool);
          const before = JSON.stringify(body);
          const out = await seam(body, engines);
          expect(JSON.stringify(body)).toBe(before);
          const items = out.body.input;
          expect(items[3]).toEqual(body.input[3]); // function_call_output: call_id + output
          expect(items[5]).toEqual(body.input[5]); // custom_tool_call_output
          expect(items[1]).toEqual(body.input[1]); // reasoning encrypted_content
          expect(items[2]).toEqual(body.input[2]); // function_call arguments
          expect(items[4]).toEqual(body.input[4]); // custom_tool_call input
          expect(out.body.instructions).toBe(body.instructions);
          expect(items.map((i) => i.type)).toEqual(body.input.map((i) => i.type));
        });
      }
    }

    it("Lite still folds the ordinary user item while every tool output is verbatim", async () => {
      const tool = sensitiveToolText(10_800);
      const out = await seam(responsesBody(tool), { lite: { enabled: true } });
      expect(out.body.input[0].content).toBe(CLEAN_USER);
      expect(out.body.input[3].output).toBe(tool);
      expect(out.body.input[5].output).toBe(tool);
    });

    it("the adapter round-trips unchanged string tool output and restores the original item shape", () => {
      const tool = sensitiveToolText(10_800);
      const body = responsesBody(tool);
      const adapter = adaptBodyForCompression(body);
      expect(adapter.adapted).toBe(true);
      expect(adapter.body.messages.filter((m) => m.role === "tool").map((m) => m.content)).toEqual([tool, tool]);
      expect(adapter.restore(adapter.body)).toEqual(body);
    });
  });

  describe("Kiro envelopes", () => {
    it("successful and error tool results are untouched by safe Lite and Caveman", async () => {
      const ok = sensitiveToolText(10_800);
      const failed = sensitiveToolText(10_800) + "ERR  \n\n\n\n";
      const body = kiroBody(ok, failed);
      for (const engines of [{ lite: { enabled: true } }, { caveman: { enabled: true } }]) {
        const out = await seam(body, engines);
        const results = out.body.conversationState.history[0].userInputMessage.userInputMessageContext.toolResults;
        expect(results[0].content[0].text).toBe(ok);
        expect(results[1].content[0].text).toBe(failed);
        expect(results[1].status).toBe("error");
      }
    });
  });

  describe("request-scoped transport and options", () => {
    it("never mutates the stored engine settings it was handed", async () => {
      const engines = Object.freeze({ lite: Object.freeze({ enabled: true, maxToolLength: 300 }) });
      const snapshot = JSON.stringify(engines);
      await seam(chatBody(sensitiveToolText(10_800)), engines);
      await seam(responsesBody(sensitiveToolText(10_800)), engines);
      expect(JSON.stringify(engines)).toBe(snapshot);
    });

    it("the Lite config schema defaults clipping to off and exposes no other tool-output option", () => {
      const schema = getEngine("lite").getConfigSchema();
      expect(schema.map((f) => f.key)).toEqual(["truncateToolResults", "maxToolLength"]);
      expect(schema.find((f) => f.key === "truncateToolResults").defaultValue).toBe(false);
      expect(getEngine("caveman").getConfigSchema().map((f) => f.key)).not.toContain("compressRoles");
    });
  });

  describe("explicit opt-in lossy behavior and error exclusions are preserved", () => {
    const optIn = { lite: { enabled: true, truncateToolResults: true, maxToolLength: 300 } };
    const prose = Array.from({ length: 200 }, (_, i) => `line ${i} of a long build log output`).join("\n");

    it("Chat: an older plain-text result is clipped with the marker; the unclipped control is verbatim", async () => {
      const clipped = (await seam(chatBody(prose), optIn)).body.messages[2];
      expect(clipped.content.endsWith(MARKER)).toBe(true);
      expect(clipped.content.length).toBeLessThanOrEqual(300 + MARKER.length);
      expect(prose.startsWith(clipped.content.slice(0, -MARKER.length))).toBe(true);
      expect(clipped.tool_call_id).toBe("call_1");
      const control = (await seam(chatBody(prose), { lite: { enabled: true } })).body.messages[2];
      expect(control.content).toBe(prose);
    });

    it("Chat: error, JSON, fenced and current-turn results are never clipped even when opted in", async () => {
      const keep = async (body) => (await seam(body, optIn)).body.messages[2].content;
      expect(await keep(chatBody(prose, { is_error: true }))).toBe(prose);
      const json = JSON.stringify({ rows: prose.split("\n") });
      expect(await keep(chatBody(json))).toBe(json);
      const fenced = "```\n" + prose + "\n```";
      expect(await keep(chatBody(fenced))).toBe(fenced);
      const current = chatBody(prose);
      current.messages = current.messages.slice(0, 3);
      expect(await keep(current)).toBe(prose);
    });

    it("Responses: an opted-in older tool output is clipped and the item keeps its call_id and type", async () => {
      const out = await seam(responsesBody(prose), optIn);
      const item = out.body.input[3];
      expect(item.type).toBe("function_call_output");
      expect(item.call_id).toBe("fc_1");
      expect(item.output.endsWith(MARKER)).toBe(true);
      expect(out.body.input[1]).toEqual(responsesBody(prose).input[1]);
    });

    it("Kiro: opted-in clipping reaches the success result and excludes the error result", async () => {
      const out = await seam(kiroBody(prose, prose), optIn);
      const results = out.body.conversationState.history[0].userInputMessage.userInputMessageContext.toolResults;
      expect(results[0].content[0].text.endsWith(MARKER)).toBe(true);
      expect(results[1].content[0].text).toBe(prose);
    });

    it("RTK (an explicit lossy engine) still filters a successful result and skips an error result", () => {
      const diff = [
        "diff --git a/foo.js b/foo.js",
        "index abc..def 100644",
        "--- a/foo.js",
        "+++ b/foo.js",
        "@@ -1,3 +1,200 @@",
        ...Array.from({ length: 200 }, (_, i) => `+added line ${i} UNIQUE_PADDING_${i} ${"x".repeat(20)}`),
      ].join("\n");
      const ok = rtkEngine.apply(chatBody(diff), {});
      expect(ok.compressed).toBe(true);
      expect(ok.body.messages[2].content.length).toBeLessThan(diff.length);
      const failed = rtkEngine.apply(chatBody(diff, { is_error: true }), {});
      expect(failed.compressed).toBe(false);
      expect(failed.body.messages[2].content).toBe(diff);
    });
  });
});
