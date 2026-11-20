import "../translator/registerAll.js";
import { describe, expect, it } from "vitest";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { normalizeDsmlCompletion } from "../../open-sse/translator/concerns/dsml.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { buildTransformStream } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

const frame = '<|DSML|invoke name="run"><|DSML|parameter name="cmd" string="true">ls</|DSML|parameter></|DSML|invoke>';
const chunk = (content, finish_reason = null, extra = {}) => ({ choices: [{ index: 0, delta: { ...(content === null ? {} : { content }), ...extra }, finish_reason }] });

describe("DSML response integration", () => {
  it("normalizes split content and keeps structured calls with distinct indices", () => {
    const state = { ...initState(FORMATS.OPENAI), model: "alias", dsmlModel: "deepseek-chat" };
    const input = [chunk('before ' + frame.slice(0, 8), null, { tool_calls: [{ index: 0, id: 'existing', type: 'function', function: { name: 'old', arguments: '{}' } }] }), chunk(frame.slice(8) + ' after'), chunk(null, 'stop')];
    const out = input.flatMap((item) => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, item, state));
    expect(out.flatMap((x) => x.choices[0].delta.tool_calls || []).map((x) => x.index)).toEqual([0, 1]);
    expect(out.map((x) => x.choices[0].delta.content || '').join('')).toBe('before  after');
    expect(out.at(-1).choices[0].finish_reason).toBe('tool_calls');
  });
  it("leaves non-DeepSeek and malformed content alone", () => {
    const other = { ...initState(FORMATS.OPENAI), model: 'other' };
    expect(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, chunk(frame, 'stop'), other)[0].choices[0].delta.content).toBe(frame);
    const deepseek = { ...initState(FORMATS.OPENAI), model: 'deepseek-chat' };
    const bad = frame.slice(0, -1);
    expect(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, chunk(bad, 'stop'), deepseek)[0].choices[0].delta.content).toBe(bad);
  });
  it("converts the OpenAI pivot to Claude tool blocks", () => {
    const state = { ...initState(FORMATS.CLAUDE), model: 'deepseek-chat' };
    const output = [chunk(frame), chunk(null, 'stop')].flatMap((c) => translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, c, state));
    expect(JSON.stringify(output)).toContain('tool_use');
    expect(JSON.stringify(output)).not.toContain('DSML');
  });
  it("normalizes non-streaming responses without replacing existing calls", () => {
    const response = { choices: [{ message: { content: `hi ${frame}`, tool_calls: [{ id: 'old' }] }, finish_reason: 'stop' }] };
    normalizeDsmlCompletion(response, 'alias', 'deepseek');
    expect(response.choices[0].message.content).toBe('hi ');
    expect(response.choices[0].message.tool_calls).toHaveLength(2);
    expect(response.choices[0].finish_reason).toBe('tool_calls');
  });
  it("projects non-streaming chat completions into Responses", () => {
    const input = { id: 'chat-1', model: 'alias', choices: [{ index: 0, message: { role: 'assistant', content: frame }, finish_reason: 'stop' }] };
    const output = translateNonStreamingResponse(input, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, { effectiveModel: 'deepseek-chat' });
    expect(JSON.stringify(output)).toContain('function_call');
    expect(JSON.stringify(output)).not.toContain('DSML');
  });
  it("selects the translating stream for a DeepSeek combo member", () => {
    const result = buildTransformStream({ sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI, model: 'alias', providerBody: { model: 'deepseek-chat' } });
    expect(result.emittedFormat).toBe(FORMATS.OPENAI);
    expect(result.stream).toBeInstanceOf(TransformStream);
  });
  it("translates actual SSE frames on the same-format path", async () => {
    const stream = createSSEStream({ mode: 'translate', targetFormat: FORMATS.OPENAI, sourceFormat: FORMATS.OPENAI, model: 'alias', providerBody: { model: 'deepseek-chat' } });
    const input = [chunk(frame.slice(0, 10)), chunk(frame.slice(10)), chunk(null, 'stop')].map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
    const output = await new Response(new Response(input).body.pipeThrough(stream)).text();
    expect(output).toContain('tool_calls');
    expect(output).toContain('"name":"run"');
    expect(output).not.toContain('DSML');
  });
});
