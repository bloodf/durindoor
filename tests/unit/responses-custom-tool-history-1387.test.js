// #1387: Responses→Chat must keep custom_tool_call / custom_tool_call_output history.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const PATCH = "*** Begin Patch\n*** Update File: a.txt\n-old\n+new\n*** End Patch";

const toChat = (body) =>
  translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", structuredClone(body), false, null, null);

const historyBody = (name) => ({
  input: [
    { type: "message", role: "user", content: [{ type: "input_text", text: "patch it" }] },
    { type: "custom_tool_call", call_id: "c1", name, input: PATCH },
    { type: "custom_tool_call_output", call_id: "c1", output: "Done" },
    { type: "message", role: "user", content: [{ type: "input_text", text: "again" }] },
  ],
  tools: [{ type: "custom", name, description: "Apply a patch" }],
});

describe("#1387 Responses→Chat custom tool history", () => {
  it.each([
    ["plain", "apply_patch"],
    ["dotted", "files.patch"],
    ["over 64 chars", `apply_patch_${"z".repeat(70)}`],
  ])("pairs a multi-turn apply_patch history (%s name)", (_label, name) => {
    const out = toChat(historyBody(name));
    const roles = out.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "user"]);

    const [call] = out.messages[1].tool_calls;
    expect(call.id).toBe("c1");
    expect(call.type).toBe("function");
    // Same `{input}` shape the custom declaration lowers to.
    expect(JSON.parse(call.function.arguments)).toEqual({ input: PATCH });
    // Call name goes through the same name map as its declaration.
    expect(call.function.name).toBe(out.tools[0].function.name);
    expect(out._toolNameMap?.get(call.function.name) ?? call.function.name).toBe(name);

    expect(out.messages[2]).toMatchObject({ role: "tool", tool_call_id: "c1", content: "Done" });
  });

  it("serializes non-string custom input instead of dropping it", () => {
    const out = toChat({
      input: [
        { type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: { raw: 1 } },
        { type: "custom_tool_call_output", call_id: "c2", output: [{ type: "input_text", text: "ok" }] },
      ],
    });
    expect(JSON.parse(out.messages[0].tool_calls[0].function.arguments)).toEqual({ input: "{\"raw\":1}" });
    expect(out.messages[1]).toMatchObject({ role: "tool", tool_call_id: "c2", content: "ok" });
  });

  it("strips an orphaned custom_tool_call_output like a function_call_output", () => {
    const out = toChat({
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "custom_tool_call_output", call_id: "gone", output: "Done" },
      ],
    });
    expect(out.messages.some((m) => m.role === "tool")).toBe(false);
  });
});
