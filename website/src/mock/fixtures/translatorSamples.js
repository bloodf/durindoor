// Seed capture for the translator debug page: a Claude-format request from a
// coding agent routed to the Codex account, with every pipeline step rendered
// by the same converters the translate endpoint uses so the files agree.

import { claudeStream, openaiChatStream, responsesStream } from "./playgroundFrames.js";
import { cannedReply } from "./playgroundReplies.js";
import { detectFormat, fromOpenAI, headersFor, targetFor, toOpenAI } from "./translatorFormats.js";
import { resolveModel } from "./playgroundCatalog.js";
import { isoAgo, MINUTE_MS } from "./world.js";

const PROMPT = "Write a function that retries a fetch call with exponential backoff and jitter.";

const CLIENT_BODY = Object.freeze({
  model: "cx/gpt-6-astra",
  max_tokens: 32000,
  stream: true,
  system: [{ type: "text", text: "You are a careful senior engineer. Prefer small, well-tested functions." }],
  messages: [{ role: "user", content: [{ type: "text", text: PROMPT }] }],
  tools: [
    {
      name: "read_file",
      description: "Read a file from the workspace",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ],
  thinking: { type: "enabled", budget_tokens: 16000 },
});

const pretty = (value) => JSON.stringify(value, null, 2);

export function buildTranslatorFiles() {
  const timestamp = isoAgo(4 * MINUTE_MS);
  const { provider, model } = resolveModel(CLIENT_BODY.model);
  const target = targetFor(provider);
  const openai = toOpenAI(detectFormat(CLIENT_BODY), CLIENT_BODY, model);
  const targetBody = fromOpenAI(target.format, openai, model);
  const text = cannedReply(PROMPT, CLIENT_BODY.model);
  const frameArgs = { model, prompt: PROMPT, text };

  return {
    "1_req_client.json": pretty({
      timestamp,
      endpoint: "/v1/messages",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": "sk-dd-••••9c2e", "user-agent": "claude-cli/2.4.1 (external, cli)" },
      body: CLIENT_BODY,
    }),
    "2_req_source.json": pretty({ timestamp, headers: {}, body: CLIENT_BODY }),
    "3_req_openai.json": pretty(openai),
    "4_req_target.json": pretty({ url: target.url, headers: headersFor(provider), body: targetBody, provider, model }),
    "5_res_provider.txt": responsesStream(frameArgs).join(""),
    "6_res_openai.txt": openaiChatStream(frameArgs).join(""),
    "7_res_client.txt": claudeStream({ ...frameArgs, model: CLIENT_BODY.model }).join(""),
  };
}
