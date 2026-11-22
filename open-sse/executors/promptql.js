import { BaseExecutor } from "./base.js";

const GQL = "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql";
const REFRESH = "https://auth.pro.ql.app/ddn/project/token";
const ORIGIN = "https://prompt.ql.app";
const MODEL_QUERY = `query FetchLlmConfigs { llm_config(where: {deleted_at: {_is_null: true}}, order_by: {display_label: asc}) { id display_label model_reference model_id } }`;
const START = `mutation StartThreadRoomless($message: String!, $projectId: String!, $timezone: String!, $uploads: [UserUploadInput!], $agentResponseConfig: String) { start_thread(message: $message, projectId: $projectId, timezone: $timezone, roomless: true, uploads: $uploads, agentResponseConfig: $agentResponseConfig) { thread_id thread_events { thread_event_id } } }`;
const START_MODEL = `mutation StartThreadWithModel($message: String!, $projectId: String!, $timezone: String!, $llmConfigId: String!, $uploads: [UserUploadInput!], $agentResponseConfig: String) { start_thread(message: $message, projectId: $projectId, timezone: $timezone, llmConfigId: $llmConfigId, roomless: true, uploads: $uploads, agentResponseConfig: $agentResponseConfig) { thread_id thread_events { thread_event_id } } }`;
const SEND = `mutation SendThreadMessage($message: String!, $timezone: String!, $threadId: String!, $uploads: [UserUploadInput!], $agentResponseConfig: String) { send_thread_message(threadId: $threadId, timezone: $timezone, message: $message, uploads: $uploads, agentResponseConfig: $agentResponseConfig) { thread_event_id } }`;
const EVENTS = `query QueryThreadEvents($thread_id: uuid!, $after_event_id: bigint!) { thread_events(where: {thread_id: {_eq: $thread_id}, thread_event_id: {_gt: $after_event_id}}, order_by: {thread_event_id: asc}) { thread_event_id event_data } }`;

function jwtPayload(token) { try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()); } catch { return {}; } }
function isPlainRecord(value) { return value !== null && Object.getPrototypeOf(value) === Object.prototype; }
function readCredentials(input) {
  const ps = input.credentials?.providerSpecificData || {};
  let token = String(ps.token || ps.jwt || input.credentials?.apiKey || "").replace(/^Bearer\s+/i, "").trim();
  const projectId = String(ps.projectId || ps.project_id || jwtPayload(token)["https://promptql.hasura.io"]?.["x-hasura-project-id"] || "").trim();
  return { token, projectId, cookie: String(ps.cookie || ps.sessionCookie || "") };
}
function error(status, message, body) { return { response: new Response(JSON.stringify({ error: { message, type: "upstream_error", code: `HTTP_${status}` } }), { status, headers: { "content-type": "application/json" } }), url: GQL, headers: {}, transformedBody: body }; }
function eventText(v) {
  let out = "";
  const walk = (x) => { if (!x) return; if (Array.isArray(x)) return x.forEach(walk); if (!isPlainRecord(x)) { try { walk(JSON.parse(String(x))); } catch {} return; } for (const [k, val] of Object.entries(x)) { if (["text", "content", "message"].includes(k) && val && !isPlainRecord(val) && !Array.isArray(val)) out += String(val); else if (isPlainRecord(val) || Array.isArray(val)) walk(val); } };
  walk(v); return out;
}
function response(content, model, stream) {
  const id = `chatcmpl-pql-${crypto.randomUUID()}`, created = Math.floor(Date.now() / 1000);
  if (!stream) return new Response(JSON.stringify({ id, object: "chat.completion", created, model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
  const enc = new TextEncoder(), chunks = [{ delta: { role: "assistant" }, finish_reason: null }, { delta: { content }, finish_reason: null }, { delta: {}, finish_reason: "stop" }];
  return new Response(new ReadableStream({ start(c) { for (const part of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, ...part }] })}\n\n`)); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } }), { headers: { "content-type": "text/event-stream" } });
}

export class PromptQlExecutor extends BaseExecutor {
  constructor(deps = {}) { super("promptql", { id: "promptql", baseUrl: GQL }); this.fetch = deps.fetch || ((...args) => fetch(...args)); }
  async execute(input) {
    const body = input.body || {}, { token: initialToken, projectId, cookie } = readCredentials(input);
    if (!initialToken) return error(401, "Missing PromptQL playground enrich-token JWT", body);
    if (!projectId) return error(400, "Missing PromptQL projectId", body);
    let token = initialToken;
    try {
      const payload = jwtPayload(token);
      if (payload.exp && payload.exp * 1000 < Date.now() + 30000 && cookie) {
        const refreshed = await this.fetch(REFRESH, { method: "POST", headers: { "x-hasura-project-id": projectId, origin: ORIGIN, referer: `${ORIGIN}/`, cookie }, signal: input.signal });
        if (refreshed.ok) { const raw = (await refreshed.text()).trim(); try { const j = JSON.parse(raw); token = j.token || j.accessToken || j.access_token || j.jwt || token; } catch { if (raw.startsWith("eyJ")) token = raw.replace(/^"|"$/g, ""); } }
      }
      const headers = { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}`, origin: ORIGIN, referer: `${ORIGIN}/` };
      const gql = async (query, variables, operationName) => {
        const r = await this.fetch(GQL, { method: "POST", headers, body: JSON.stringify({ query, variables, operationName }), signal: input.signal });
        if (r.status === 401 || r.status === 403) throw Object.assign(new Error("PromptQL session expired"), { status: 401 });
        if (r.status === 429) throw Object.assign(new Error("PromptQL quota or rate limit exceeded"), { status: 429 });
        const j = await r.json(); if (!r.ok || j.errors?.length) throw Object.assign(new Error(j.errors?.map((e) => e.message).join("; ") || `PromptQL HTTP ${r.status}`), { status: r.status }); return j.data;
      };
      if (input.action === "models") return { models: (await gql(MODEL_QUERY, {}, "FetchLlmConfigs")).llm_config || [] };
      const msgs = Array.isArray(body.messages) ? body.messages : [], last = [...msgs].reverse().find((m) => m.role === "user");
      const text = Array.isArray(last?.content) ? last.content.map((part) => part.text || "").join("\n") : String(last?.content || "");
      if (!text.trim()) return error(400, "No user message found", body);
      const threadId = body.promptql_thread_id || input.clientHeaders?.["x-promptql-thread-id"];
      let thread;
      if (threadId) { await gql(SEND, { message: `<agent_mention /> ${text}`, timezone: "UTC", threadId, uploads: [], agentResponseConfig: "force_respond" }, "SendThreadMessage"); thread = threadId; }
      else {
        const variables = { message: `<agent_mention /> ${text}`, projectId, timezone: "UTC", uploads: [], agentResponseConfig: "force_respond" };
        let started;
        const requested = String(input.model || body.model || "").replace(/^(promptql|pql)\//, "").toLowerCase();
        if (requested) {
          try {
            const catalog = await gql(MODEL_QUERY, {}, "FetchLlmConfigs");
            const selected = (catalog.llm_config || []).find((row) => [row.model_reference, row.model_id, row.id, row.display_label].some((name) => String(name || "").toLowerCase() === requested));
            if (selected?.id) started = await gql(START_MODEL, { ...variables, llmConfigId: selected.id }, "StartThreadWithModel");
          } catch { /* Use the playground default if discovery or model selection fails. */ }
        }
        if (!started) started = await gql(START, variables, "StartThreadRoomless");
        thread = started.start_thread.thread_id;
      }
      let cursor = "0", answer = "";
      for (let i = 0; i < 150; i++) {
        if (input.signal?.aborted) throw new Error("Request aborted");
        const data = await gql(EVENTS, { thread_id: thread, after_event_id: cursor }, "QueryThreadEvents");
        for (const ev of data.thread_events || []) { cursor = String(ev.thread_event_id); answer = eventText(ev.event_data) || answer; }
        if (answer && /final_response_sent|final_response|AgentMessage/i.test(JSON.stringify(data.thread_events || []))) break;
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (!answer) throw new Error("PromptQL returned no assistant message before timeout");
      return { response: response(answer, input.model || body.model || "promptql-default", input.stream ?? body.stream), url: GQL, headers: { "X-PromptQL-Thread-Id": thread }, transformedBody: body };
    } catch (e) { const status = e.status || (/expired|unauthorized|JWT/i.test(e.message) ? 401 : /quota|rate limit|429/i.test(e.message) ? 429 : 502); return error(status, e.message || "PromptQL request failed", body); }
  }
}
