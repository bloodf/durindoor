// Port of OmniRoute #20224 (responses-call-id-clamp). Strict Responses upstreams cap
// call_id at 64 characters. A plain cut merged long ids that differ only at the end
// (`name:0`, `name:1`), so parallel calls collapsed into one id and their outputs
// paired with the wrong call. An over-long id keeps a prefix plus a hash of the whole
// id; the same id always maps to the same clamped id, so call and output stay paired.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { ROLE, RESPONSES_ITEM, OPENAI_BLOCK } from "../../open-sse/translator/schema/index.js";
import {
  clampResponsesCallId,
  MAX_RESPONSES_CALL_ID_LEN,
} from "../../open-sse/translator/formats/responsesApi.js";

const LONG_PREFIX = "functions.mcp__very_long_server_name__very_long_tool_name_xxxxxxxx:".padEnd(
  MAX_RESPONSES_CALL_ID_LEN + 2,
  "x"
);
const idA = `${LONG_PREFIX}0`;
const idB = `${LONG_PREFIX}1`;

const toolCall = (id, index) => ({
  id,
  type: OPENAI_BLOCK.FUNCTION,
  function: { name: "probe", arguments: JSON.stringify({ i: index }) },
});

const toResponses = (messages) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", { messages }, false);

describe("Responses call_id clamp keeps long ids distinct (#20224)", () => {
  it("leaves ids within the limit unchanged", () => {
    expect(clampResponsesCallId("call_abc")).toBe("call_abc");
    const exact = "x".repeat(MAX_RESPONSES_CALL_ID_LEN);
    expect(clampResponsesCallId(exact)).toBe(exact);
  });

  it("maps ids sharing a 64-character prefix to distinct, stable ids within the limit", () => {
    const a = clampResponsesCallId(idA);
    const b = clampResponsesCallId(idB);
    expect(a).not.toBe(b);
    expect(clampResponsesCallId(idA)).toBe(a);
    expect(a.length).toBeLessThanOrEqual(MAX_RESPONSES_CALL_ID_LEN);
    expect(b.length).toBeLessThanOrEqual(MAX_RESPONSES_CALL_ID_LEN);
  });

  it("keeps one function_call and one paired output per long id through Chat to Responses", () => {
    const out = toResponses([
      { role: ROLE.USER, content: "u" },
      { role: ROLE.ASSISTANT, content: null, tool_calls: [toolCall(idA, 0), toolCall(idB, 1)] },
      { role: ROLE.TOOL, tool_call_id: idA, content: "RA" },
      { role: ROLE.TOOL, tool_call_id: idB, content: "RB" },
    ]);
    const calls = out.input.filter((item) => item.type === RESPONSES_ITEM.FUNCTION_CALL);
    const outputs = out.input.filter((item) => item.type === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT);

    expect(new Set(calls.map((item) => item.call_id)).size).toBe(2);
    expect(outputs.map((item) => item.call_id)).toEqual(calls.map((item) => item.call_id));
    expect(calls.map((item) => JSON.parse(item.arguments).i)).toEqual([0, 1]);
    expect(outputs.map((item) => item.output)).toEqual(["RA", "RB"]);
    for (const item of [...calls, ...outputs]) {
      expect(item.call_id.length).toBeLessThanOrEqual(MAX_RESPONSES_CALL_ID_LEN);
    }
  });
});
