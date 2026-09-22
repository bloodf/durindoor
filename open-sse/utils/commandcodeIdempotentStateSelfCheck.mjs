import assert from "node:assert/strict";
import "../../tests/translator/registerAll.js";
import { initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { commandCodeToOpenAIResponse } from "../translator/response/commandcode-to-openai.js";

const state = initState(FORMATS.OPENAI_RESPONSES);
assert.ok(state.responseId, "fixture: responseId pre-set by initState");

// Tool calls buffer until finish, then replay exactly once (upstream #4224).
const toolCallChunk = '{"type":"tool-call","toolCallId":"call_a","toolName":"Read","input":{"path":"x"}}';
assert.equal(commandCodeToOpenAIResponse(toolCallChunk, state), null, "tool-call is buffered");
assert.equal(commandCodeToOpenAIResponse(toolCallChunk, state), null, "duplicate tool-call is ignored");

const tc2 = '{"type":"tool-call","toolCallId":"call_b","toolName":"Grep","input":{"pattern":"y"}}';
assert.equal(commandCodeToOpenAIResponse(tc2, state), null);

const finish = commandCodeToOpenAIResponse('{"type":"finish","finishReason":"tool-calls"}', state);
const calls = finish.flatMap((chunk) => chunk.choices[0].delta.tool_calls || []);
assert.deepEqual(calls.map((call) => [call.index, call.id]), [[0, "call_a"], [1, "call_b"]], "finish replays each call once");
assert.equal(finish.at(-1).choices[0].finish_reason, "tool_calls");

assert.equal(commandCodeToOpenAIResponse('{"type":"finish","finishReason":"stop"}', state), null, "second finish is ignored");

console.log("commandcodeIdempotentStateSelfCheck: 5/5");
