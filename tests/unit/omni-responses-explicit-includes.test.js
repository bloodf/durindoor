import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { openaiToOpenAIResponsesRequest, openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { CLAUDE_NATIVE_TOOLS, RESPONSES_INCLUDE, RESPONSES_INCLUDE_ENTRIES } from "../../open-sse/translator/schema/index.js";

// OmniRoute #2154 (head 69d1a53e59913a5c8bbef4df291cf3ce0183ac20, merged upstream as
// fca89049c90127b48380c624879fb01bd3d5b5c8): a chat client that asks for a Responses
// `include` entry must keep it on the Responses wire, otherwise the provider answers
// with an empty reasoning summary and the client sees no thinking stream.
const ENCRYPTED = RESPONSES_INCLUDE.REASONING_ENCRYPTED_CONTENT;
const SOURCES = RESPONSES_INCLUDE.WEB_SEARCH_CALL_ACTION_SOURCES;
const LOGPROBS = RESPONSES_INCLUDE.MESSAGE_OUTPUT_TEXT_LOGPROBS;

const chatBody = (extra = {}) => ({
  messages: [{ role: "user", content: "Hello" }],
  reasoning: { effort: "high", summary: "auto" },
  ...extra,
});

const toResponses = (body, provider = "codex") =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-5.3-codex-spark", body, false, null, provider);

describe("Chat to Responses explicit include fields", () => {
  it("forwards a caller-provided include entry to the Responses wire", () => {
    expect(toResponses(chatBody({ include: [ENCRYPTED] })).include).toEqual([ENCRYPTED]);
  });

  it("keeps every supported entry the caller asked for", () => {
    expect(toResponses(chatBody({ include: [ENCRYPTED, LOGPROBS] })).include).toEqual([ENCRYPTED, LOGPROBS]);
  });

  it("does not invent an include when the caller sent none", () => {
    expect(toResponses(chatBody()).include).toBeUndefined();
  });

  it("drops include entries outside the Responses contract", () => {
    expect(toResponses(chatBody({ include: ["arbitrary"] })).include).toBeUndefined();
    expect(toResponses(chatBody({ include: ["arbitrary", ENCRYPTED] })).include).toEqual([ENCRYPTED]);
  });

  it("ignores a malformed include value", () => {
    expect(toResponses(chatBody({ include: ENCRYPTED })).include).toBeUndefined();
    expect(toResponses(chatBody({ include: [] })).include).toBeUndefined();
    expect(toResponses(chatBody({ include: [42, null, ""] })).include).toBeUndefined();
  });

  it("leaves the caller's include array untouched", () => {
    const body = chatBody({ include: [ENCRYPTED] });
    const wire = toResponses(body);

    expect(body.include).toEqual([ENCRYPTED]);
    expect(wire.include).not.toBe(body.include);
  });

  it("exposes the supported include vocabulary from the translator schema", () => {
    expect(RESPONSES_INCLUDE_ENTRIES).toEqual([ENCRYPTED, LOGPROBS, SOURCES,
      "web_search_call.results", "output.encrypted_content", "file_search_call.results",
      "message.input_image.image_url", "computer_call_output.output.image_url", "code_interpreter_call.outputs"]);
  });
});

describe("Responses include contracts that stay as they are", () => {
  it("keeps a native Responses request's include untouched", () => {
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      include: [ENCRYPTED],
    };
    const original = structuredClone(body);

    expect(translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "gpt-4o", body, false, null, "openai")).toEqual(original);
    expect(body).toEqual(original);
  });

  it("omits include when a Responses request is lowered to Chat", () => {
    const body = {
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      include: [ENCRYPTED],
    };

    expect(openaiResponsesToOpenAIRequest("gpt-4o", body, false, null).include).toBeUndefined();
    expect(translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", body, false, null, "openai").include).toBeUndefined();
    expect(convertResponsesApiFormat(body).include).toBeUndefined();
  });

  it("keeps the native search include and merges it with the caller's entries", () => {
    const nativeSearch = { type: "web_search_20250305", name: "web_search" };
    const build = (extra) => {
      const body = { messages: [{ role: "user", content: "Find it" }], tools: [{ type: "web_search" }], ...extra };
      Object.defineProperty(body, CLAUDE_NATIVE_TOOLS, { value: [nativeSearch], enumerable: false });
      return body;
    };

    expect(openaiToOpenAIResponsesRequest("gpt-5.3-codex-spark", build(), false, null).include).toEqual([SOURCES]);
    expect(openaiToOpenAIResponsesRequest("gpt-5.3-codex-spark", build({ include: [ENCRYPTED] }), false, null).include).toEqual([ENCRYPTED, SOURCES]);
  });

  it("keeps the Claude native-search include on the Claude to Responses route", () => {
    const wire = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, "upstream", {
      messages: [{ role: "user", content: "Find it" }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }, true, null, "codex");

    expect(wire.include).toEqual([SOURCES]);
  });

  it("keeps the Codex executor include default", () => {
    const wire = new CodexExecutor().transformRequest("upstream", {
      model: "upstream",
      input: [{ type: "message", role: "user", content: "Hello" }],
      include: [ENCRYPTED],
    }, true, {});

    expect(wire.include).toEqual([ENCRYPTED]);
  });

  it("keeps the target-specific include filtering", () => {
    const body = { include: [ENCRYPTED, LOGPROBS] };
    stripUnsupportedParams("openai", "gpt-6-astra", body);
    expect(body.include).toEqual([ENCRYPTED]);

    const empty = { include: [LOGPROBS] };
    stripUnsupportedParams("openai", "gpt-6-astra", empty);
    expect(empty.include).toBeUndefined();
  });
});
