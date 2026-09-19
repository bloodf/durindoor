// Port of decolua/9router aa14ef72 + eafac37d, scoped to what each fork executor
// actually needed (see the commit message for what was skipped and why):
//   1. OpenCode Free 400s muse-spark-1.3-contributor-free when tool_choice is
//      anything but "auto" — force it via the new forceAutoToolChoiceModels quirk.
//   2. A native Responses client skips translation, so a prior-turn `reasoning`
//      item's encrypted_content can reach an OpenCode/OpenCode Go executor
//      unvalidated by this caller's pooled/rotated credentials — strip it.
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import { stripPriorReasoningItem } from "../../open-sse/translator/formats/responsesApi.js";

const FREE_13 = "muse-spark-1.3-contributor-free";

function responsesBody(model, tool_choice) {
  const body = {
    model,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    tools: [{ type: "function", name: "get_weather", description: "w", parameters: { type: "object", properties: {} } }],
  };
  if (tool_choice !== undefined) body.tool_choice = tool_choice;
  return body;
}

describe("opencode registry: forceAutoToolChoiceModels quirk", () => {
  it("declares the quirk for muse-spark-1.3-contributor-free only", () => {
    expect(PROVIDERS.opencode.quirks?.forceAutoToolChoiceModels).toEqual([FREE_13]);
  });
});

describe("OpenCodeExecutor Muse Free tool_choice normalization", () => {
  it.each([
    ["function tool_choice object", { type: "function", name: "get_weather" }],
    ["required", "required"],
    ["none", "none"],
  ])("demotes %s to auto, plain and thinking-suffixed", (_label, choice) => {
    for (const model of [FREE_13, `${FREE_13}(max)`]) {
      const body = responsesBody(model, structuredClone(choice));
      const out = new OpenCodeExecutor().transformRequest(model, body, true, {});
      expect(out.tool_choice).toBe("auto");
      // The cluster's unconditional decoy cloaking (port(upstream): #907) appends
      // bash/read fingerprint tools alongside the caller's own tool; assert the
      // caller's tool survives rather than pinning an exact count.
      expect(out.tools.some((t) => t.name === "get_weather")).toBe(true);
    }
  });

  it("leaves an explicit auto untouched regardless of caller tools", () => {
    const autoOut = new OpenCodeExecutor().transformRequest(FREE_13, responsesBody(FREE_13, "auto"), true, {});
    expect(autoOut.tool_choice).toBe("auto");
  });

  it("absent tool_choice composes with #4146's own hasTools-gated default", () => {
    // #4146 (decolua/9607 #915) narrowed cloakOpencodeTools's own default to
    // `!hasTools && !body.tool_choice`, so it only fills in "auto" when the
    // caller sent no tools of its own — this quirk's force only ever acts on
    // an EXPLICIT non-auto value, so the two compose without fighting:
    const noToolsBody = { model: FREE_13, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    const noToolsOut = new OpenCodeExecutor().transformRequest(FREE_13, noToolsBody, true, {});
    expect(noToolsOut.tool_choice).toBe("auto"); // #4146's own default fires (no caller tools)

    const withToolsOut = new OpenCodeExecutor().transformRequest(FREE_13, responsesBody(FREE_13, undefined), true, {});
    expect("tool_choice" in withToolsOut).toBe(false); // #4146's default does NOT fire (caller sent tools)
  });

  it.each([
    ["1.2-Free (not in the quirk allowlist)", "muse-spark-1.2-contributor-free"],
    ["a non-Muse model", "big-pickle"],
  ])("does not touch tool_choice for %s", (_label, model) => {
    const choice = { type: "function", name: "get_weather" };
    const body = responsesBody(model, structuredClone(choice));
    const out = new OpenCodeExecutor().transformRequest(model, body, true, {});
    expect(out.tool_choice).toEqual(choice);
  });
});

describe("stripPriorReasoningItem", () => {
  it("drops a reasoning item and reports false", () => {
    const item = { type: "reasoning", id: "rs_1", encrypted_content: "ENC" };
    expect(stripPriorReasoningItem(item)).toBe(false);
  });

  it("scrubs encrypted content fields from a surviving item and reports true", () => {
    const item = { type: "function_call", encrypted_content: "ENC", reasoning_encrypted_content: "ENC2" };
    expect(stripPriorReasoningItem(item)).toBe(true);
    expect(item.encrypted_content).toBeUndefined();
    expect(item.reasoning_encrypted_content).toBeUndefined();
  });
});

describe("OpenCodeExecutor strips prior-turn reasoning items on Muse Spark", () => {
  it("removes reasoning items and their encrypted_content, keeps everything else", () => {
    const body = {
      model: FREE_13,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "reasoning", id: "rs_123", encrypted_content: "ENC_BLOB", summary: [{ type: "summary_text", text: "thinking" }] },
        { type: "function_call", call_id: "c1", name: "read", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
    };
    const out = new OpenCodeExecutor().transformRequest(FREE_13, body, true, {});
    expect(out.input.some((i) => i.type === "reasoning")).toBe(false);
    expect(JSON.stringify(out.input)).not.toContain("ENC_BLOB");
    expect(out.input.map((i) => i.type)).toEqual(["message", "function_call", "function_call_output"]);
  });

  it("does not touch body.input for non-Muse models", () => {
    const body = {
      model: "big-pickle",
      input: [{ type: "reasoning", id: "rs_1", encrypted_content: "ENC" }],
    };
    const out = new OpenCodeExecutor().transformRequest("big-pickle", body, true, {});
    expect(out.input).toEqual([{ type: "reasoning", id: "rs_1", encrypted_content: "ENC" }]);
  });
});

describe("OpenCodeGoExecutor strips prior-turn reasoning items on Muse Spark Responses", () => {
  const MODEL = "muse-spark-1.3-contributor";

  it("removes reasoning items and their encrypted_content, keeps call items", () => {
    const ex = new OpenCodeGoExecutor();
    const body = {
      model: MODEL,
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "reasoning", id: "rs_123", encrypted_content: "ENC_BLOB_TURN_1", summary: [{ type: "summary_text", text: "thinking text" }] },
        { type: "function_call", call_id: "c1", name: "read", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
    };
    const out = ex.transformRequest(MODEL, body, true, {});
    expect(out.input.some((i) => i.type === "reasoning")).toBe(false);
    expect(JSON.stringify(out.input)).not.toContain("ENC_BLOB_TURN_1");
    expect(out.input.map((i) => i.type)).toEqual(["message", "function_call", "function_call_output"]);
  });
});
