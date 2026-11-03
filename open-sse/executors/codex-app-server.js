import { BaseExecutor } from "./base.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { CodexAppServerClient, resolveAppServerConfig, resolveTurnPolicy } from "./codex-app-server/client.js";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};
const REASONING_SUFFIX = /-(none|low|medium|high|xhigh)$/;

function sanitize(message, secret) {
  const text = String(message || "Codex app-server error");
  return (secret ? text.split(secret).join("[redacted]") : text)
    .replace(/Bearer\s+[A-Za-z0-9._:-]+/gi, "Bearer [redacted]")
    .split("\n")[0]
    .slice(0, 500);
}

function textOf(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (isObject(part) && isString(part.text) ? part.text : "")).join("");
}

// Stateless history flattened into one text turn; images are out of scope.
export function buildPromptText(messages = []) {
  const labels = { system: "System", developer: "System", assistant: "Assistant", tool: "Tool result" };
  const lines = [];
  for (const message of messages) {
    let text = textOf(message?.content);
    for (const call of message?.tool_calls || []) {
      text += `\n[Tool call ${call.id || ""}] ${call.function?.name || ""}(${call.function?.arguments || ""})`;
    }
    if (!text.trim()) continue;
    lines.push(`[${labels[message.role] || "User"}]\n${text.trim()}`);
  }
  return lines.join("\n\n") || "(empty)";
}

// OpenAI chat tools -> app-server DynamicToolSpec[] (experimental API).
export function buildDynamicTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => tool?.function || (tool?.type === "function" ? tool : null))
    .filter((fn) => isString(fn?.name))
    .map((fn) => ({
      type: "function",
      name: fn.name,
      description: isString(fn.description) ? fn.description : "",
      inputSchema: isObject(fn.parameters) ? fn.parameters : { type: "object", properties: {} },
    }));
}

function splitModel(model, bodyEffort) {
  const match = REASONING_SUFFIX.exec(model || "");
  // An explicit suffix is a deliberate choice and wins over a client default.
  return match ? { baseModel: model.slice(0, match.index), effort: match[1] } : { baseModel: model, effort: bodyEffort };
}

export class CodexAppServerExecutor extends BaseExecutor {
  /** @param {{ webSocketFactory?: Function, defaultTimeoutMs?: number }} clientOptions test seam */
  constructor(clientOptions = {}) {
    super("codex-app-server", { id: "codex-app-server", baseUrl: "codex-app-server://cli/websocket", noAuth: true });
    this.clientOptions = clientOptions;
  }

  buildUrl() {
    return "codex-app-server://cli/websocket";
  }

  buildHeaders() {
    return {};
  }

  transformRequest() {
    return null;
  }

  async execute({ model, body, signal, log }) {
    const config = resolveAppServerConfig();
    if (!config) {
      return {
        response: new Response(JSON.stringify({
          error: {
            code: "codex_app_server_unconfigured",
            type: "provider_error",
            message: "Codex app-server is not configured. Set DURINDOOR_CODEX_APPSERVER_WS (ws:// or wss://) and DURINDOOR_CODEX_APPSERVER_WS_TOKEN or DURINDOOR_CODEX_APPSERVER_WS_TOKEN_FILE.",
          },
        }), { status: 503, headers: { "Content-Type": "application/json" } }),
        url: this.buildUrl(),
        headers: {},
        transformedBody: { model },
      };
    }
    const policy = resolveTurnPolicy(config);
    const clean = (value) => sanitize(value, config.token);
    const promptText = buildPromptText(Array.isArray(body?.messages) ? body.messages : []);
    const { baseModel, effort } = splitModel(model, body?.reasoning_effort || body?.reasoning?.effort);
    const dynamicTools = buildDynamicTools(body?.tools);
    const client = new CodexAppServerClient({ ...this.clientOptions, autoApprove: policy.autoApprove });
    const id = `chatcmpl-cxa-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let cancelHook = () => client.close();
    const stream = new ReadableStream({
      start: (controller) => {
        const enc = new TextEncoder();
        // sealed: the stream is closed or cancelled, so nothing may be enqueued any more.
        let sealed = false;
        const enqueue = (text) => {
          if (sealed) return;
          try {
            controller.enqueue(enc.encode(text));
          } catch {
            sealed = true;
          }
        };
        const emit = (delta, finish = null, extra = {}) => enqueue(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
        })}\n\n`);
        let done = false;
        let threadId = "";
        let turnId = "";
        let timer = null;
        let graceTimer = null;
        let turnStartSent = false;
        let interruptLater = false;
        const interrupt = () => {
          // turn/interrupt is a client request (it needs an id); the reply and any rejection are ignored.
          if (threadId && turnId) client.request("turn/interrupt", { threadId, turnId }, 5000).catch(() => {});
        };
        // A turn id can arrive after the stream already ended; interrupt it then and close.
        const learnTurnId = (value) => {
          turnId = value;
          if (!interruptLater) return;
          interruptLater = false;
          clearTimeout(graceTimer);
          interrupt();
          client.close();
        };
        let toolIndex = 0;
        let started = false;
        const start = () => {
          if (started) return;
          started = true;
          emit({ role: "assistant", content: "" });
        };
        const finish = (reason, usage, error, keepOpen = false) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (error) {
            enqueue(`data: ${JSON.stringify({ error: { message: error, type: "provider_error", code: "codex_app_server_turn_failed" } })}\n\n`);
          } else {
            start();
            emit({}, reason, usage ? { usage } : {});
          }
          enqueue("data: [DONE]\n\n");
          if (!keepOpen) client.close();
          if (!sealed) {
            sealed = true;
            try {
              controller.close();
            } catch {
              // Already closed by a cancel.
            }
          }
        };
        // End the stream. If turn/start is still in flight, keep the socket open briefly so the
        // interrupt can carry the real turn id once it arrives.
        const endTurn = (reason, error) => {
          if (done) return;
          if (turnId || !turnStartSent) {
            interrupt();
            finish(reason, null, error);
            return;
          }
          interruptLater = true;
          finish(reason, null, error, true);
          graceTimer = setTimeout(() => client.close(), 5000);
        };
        const abort = () => endTurn("stop");
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
        const timeoutMs = this.clientOptions.turnTimeoutMs ?? config.turnTimeoutMs;
        timer = setTimeout(() => endTurn(null, `Codex app-server turn timed out after ${timeoutMs}ms`), timeoutMs);
        // A body cancel ends the turn like an abort: interrupt if the id is known, else wait briefly for it.
        cancelHook = () => {
          sealed = true;
          clearTimeout(timer);
          if (!done) endTurn("stop");
        };

        const run = async () => {
          await client.connect(config.url, config.token);
          if (done) return;
          await client.request("initialize", {
            clientInfo: { name: "durindoor-codex-app-server", title: null, version: "1.0" },
            capabilities: dynamicTools.length ? { experimentalApi: true, requestAttestation: false } : null,
          });
          if (done) return;
          const threadParams = { cwd: config.cwd, approvalPolicy: policy.approvalPolicy, sandbox: policy.sandbox };
          if (dynamicTools.length) threadParams.dynamicTools = dynamicTools;
          const thread = await client.request("thread/start", threadParams);
          if (done) return;
          threadId = thread?.thread?.id ?? thread?.threadId ?? "";
          client.onNotification((method, params) => {
            const p = isObject(params) ? params : {};
            if (method === "turn/started" && isString(p.turn?.id)) {
              learnTurnId(p.turn.id);
            } else if (method === "item/agentMessage/delta" && isString(p.delta) && p.delta) {
              start();
              emit({ content: p.delta });
            } else if ((method === "item/reasoning/textDelta" || method === "item/reasoning/summaryTextDelta") && isString(p.delta) && p.delta) {
              start();
              emit({ reasoning_content: p.delta });
            } else if (method === "turn/completed") {
              const u = p.turn?.usage ?? p.turn?.tokenUsage ?? p.turn?.token_usage ?? p.usage;
              const input = Number(u?.input_tokens) || 0;
              const output = Number(u?.output_tokens) || 0;
              finish("stop", u ? { prompt_tokens: input, completion_tokens: output, total_tokens: Number(u.total_tokens) || input + output } : null);
            } else if (method === "error") {
              finish(null, null, clean(p.error?.message || p.message));
            } else if (method === "__transport_closed__") {
              finish(null, null, clean(p.reason));
            }
          });
          // A stateless router cannot run the harness tool: surface the call and end the turn.
          client.onToolCall((_id, params, api) => {
            const p = isObject(params) ? params : {};
            const name = isString(p.namespace) && p.namespace ? `${p.namespace}__${p.tool}` : p.tool;
            start();
            emit({ tool_calls: [{
              index: toolIndex++,
              id: isString(p.callId) && p.callId ? p.callId : `call_${Date.now()}`,
              type: "function",
              function: { name, arguments: isString(p.arguments) ? p.arguments : JSON.stringify(p.arguments ?? {}) },
            }] });
            api.respond({
              contentItems: [{ type: "inputText", text: "router: tool executed by harness; call surfaced as tool_calls" }],
              success: false,
            });
            finish("tool_calls");
          });
          const turnParams = { threadId, input: [{ type: "text", text: promptText, text_elements: [] }], model: baseModel };
          if (effort) turnParams.effort = effort;
          turnStartSent = true;
          const started = await client.request("turn/start", turnParams);
          if (isString(started?.turn?.id)) learnTurnId(started.turn.id);
        };
        run().catch((error) => {
          log?.warn?.("CODEX-APP-SERVER", clean(error.message));
          finish(null, null, clean(error.message));
        });
      },
      cancel: () => cancelHook(),
    });

    return { response: new Response(stream, { status: 200, headers: SSE_HEADERS }), url: config.url, headers: {}, transformedBody: { model: baseModel } };
  }
}
