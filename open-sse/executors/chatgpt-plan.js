import { authorizeChatgptPlan, listChatgptPlanModels } from "../providers/chatgpt-plan/index.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

// Request normalization adapted from OmniRoute b748429cf5b3aeb142a708fd3e8751b6918b9dc8,
// open-sse/executors/chatgpt.ts. This adapter is intentionally not registered.
const OMIT = new Set(["background", "conversation", "max_output_tokens", "max_tokens", "max_completion_tokens", "max_tool_calls", "metadata", "moderation", "multi_agent", "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user", "previous_response_id"]);
const TOOLS = new Set(["function", "custom", "namespace", "web_search", "web_search_preview"]);

function checkTools(tools, depth = 0) {
  if (!Array.isArray(tools) || depth > 5) throw new Error("Invalid ChatGPT tools");
  for (const tool of tools) {
    if (!tool || !isObject(tool) || !TOOLS.has(tool.type)) throw new Error("Unsupported ChatGPT tool");
    if (tool.type === "namespace") checkTools(tool.tools, depth + 1);
  }
}

export function prepareChatgptPlanRequest(model, source) {
  if (!source || !isObject(source) || Array.isArray(source)) throw new Error("Invalid request");
  const body = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith("_") && !OMIT.has(key)));
  const input = isString(body.input) ? [{ role: "user", content: body.input }] : body.input;
  if (!Array.isArray(input)) throw new Error("Invalid ChatGPT input");
  body.input = input.map((item) => {
    if (!item || !isObject(item) || Array.isArray(item)) throw new Error("Invalid ChatGPT input");
    if (item.type === "additional_tools") checkTools(item.tools);
    return item.role === "system" ? { ...item, role: "developer" } : { ...item };
  });
  if (body.tools !== undefined) {
    checkTools(body.tools);
    const clientTools = body.tools.filter((tool) => tool.type === "function" || tool.type === "custom");
    body.tools = body.tools.filter((tool) => tool.type !== "function" && tool.type !== "custom");
    if (clientTools.length) body.input.unshift({ type: "additional_tools", role: "developer", tools: clientTools });
  }
  return { ...body, model, store: false, stream: true };
}

// Parse frames while forwarding original bytes. EOF without a terminal event is an error.
function validateStream(body) {
  if (!body) throw new Error("Missing ChatGPT response stream");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", terminal = false;
  function inspect(frame) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    let event;
    try { event = JSON.parse(data); } catch { throw new Error("Invalid ChatGPT response event"); }
    if (event.type === "response.completed" || event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") terminal = true;
  }
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop();
        for (const frame of frames) inspect(frame);
        if (done) {
          if (buffer.trim()) inspect(buffer);
          if (!terminal) throw new Error("ChatGPT response stream interrupted");
          controller.close();
        } else controller.enqueue(value);
      } catch (error) { await reader.cancel(error).catch(() => {}); controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export async function executeChatgptPlan({ connection, grant, model, body, stream = true, signal, fetch: fetchImpl = globalThis.fetch }) {
  authorizeChatgptPlan(connection, grant);
  const request = prepareChatgptPlanRequest(model, body);
  const models = await listChatgptPlanModels({ connection, grant, signal, fetch: fetchImpl });
  if (!models.some((entry) => entry.slug === model)) throw new Error("Model is not available to this account");
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(request), signal, redirect: "error",
  });
  if (!response.ok) return response;
  const checked = validateStream(response.body);
  if (stream) return new Response(checked, { status: response.status, headers: response.headers });
  const text = await new Response(checked).text();
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    const event = JSON.parse(data);
    if (event.type === "response.completed") return Response.json(event.response);
    if (["response.failed", "response.incomplete", "error"].includes(event.type)) return Response.json(event.response || event, { status: 502 });
  }
  throw new Error("ChatGPT response stream interrupted");
}
