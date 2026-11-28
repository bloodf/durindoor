import { randomUUID } from "node:crypto";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { BaseExecutor } from "./base.js";
import { bindsConnectionRoute, createExecutorSender } from "./sendRequest.js";
import { transferProviderAttemptDispatch } from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { extractChunkText, isolatedHome, rpc, spawnDevinAcp } from "./devin-acp-stdio.js";
import registry from "../providers/registry/devin-cli-agentic.js";
import { FORMATS } from "../translator/formats.js";
import { CLAUDE_BLOCK, OPENAI_FINISH, ROLE } from "../translator/schema/index.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const ACP_VERSION = 1;
const TURN_TIMEOUT_MS = 120_000;
const MAX_FRAME_LENGTH = 1_048_576;
const MAX_OUTPUT_LENGTH = 1_048_576;
const TOOL_STATUSES = new Set(["pending", "in_progress", "completed", "failed"]);
const TOOL_KINDS = new Set(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode"]);
const STOP_REASONS = {
  end_turn: OPENAI_FINISH.STOP,
  max_tokens: OPENAI_FINISH.LENGTH,
  max_turn_requests: OPENAI_FINISH.LENGTH,
  refusal: OPENAI_FINISH.CONTENT_FILTER,
};

function promptFor(body) {
  if (body?.tools?.length || !Array.isArray(body?.messages)) return null;
  const turns = [{ role: ROLE.SYSTEM, content: body?.system }, ...body.messages];
  const lines = [];
  for (const turn of turns) {
    if (!turn || ![ROLE.SYSTEM, ROLE.USER, ROLE.ASSISTANT].includes(turn.role)) return null;
    const { role, content } = turn;
    if (Array.isArray(content) && content.some((block) => block?.type !== CLAUDE_BLOCK.TEXT)) return null;
    const text = extractChunkText(content);
    if (text.trim()) lines.push(`[${role}]\n${text}`);
  }
  return lines.join("\n\n");
}

export class DevinCliAgenticExecutor extends BaseExecutor {
  constructor() {
    super(registry.id, registry.transport);
  }

  async execute(input) {
    const { model, body, stream = body?.stream === true, signal, proxyOptions } = input;
    const sender = createExecutorSender(this, input);
    const url = registry.transport.baseUrl;
    const wrap = (response) => ({ response, url, headers: {}, responseFormat: FORMATS.OPENAI, transformedBody: { model } });
    const fail = (message, status) => wrap(Response.json({ error: { message, type: "devin_cli_agentic_error" } }, { status }));

    if (!registry.models.some((entry) => entry.id === model)) return fail("Model is outside the Devin CLI catalog", 400);
    const prompt = promptFor(body);
    if (!prompt) return fail("Devin CLI requires text input and does not accept client tools", 400);
    if (signal?.aborted) return fail("Devin ACP turn cancelled", 499);
    if (bindsConnectionRoute(proxyOptions)) {
      return fail("Devin ACP cannot use gateway proxy or relay settings", 400);
    }
    const home = isolatedHome();
    const bin = process.env.CLI_DEVIN_BIN?.trim();
    if (!home || !bin || !path.isAbsolute(bin) || process.platform === "win32") {
      return fail("Set DEVIN_AGENTIC_HOME and CLI_DEVIN_BIN to isolated home and executable paths on Linux or macOS", 503);
    }

    const env = {
      HOME: home,
      PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local", "share"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
    };

    // Spawning the CLI is the physical send. The whole turn is wired up in the same
    // synchronous step, so no child event can arrive before its listener exists.
    const startTurn = () => {
      const child = spawnDevinAcp(bin, ["--sandbox", "--permission-mode", "normal", "acp", "--model", model], { cwd: home, env });
      const id = `chatcmpl-devin-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      const common = { id, created, model };
      let output = "";
      let assistantText = "";
      let sessionId;
      let expectedId = 1;
      let cancel;
      let settled = false;
      let resolveResponse;
      const completed = new Promise((resolve) => { resolveResponse = resolve; });
      const enc = new TextEncoder();
      const decoder = new StringDecoder("utf8");
      const toolCalls = new Map();
      let controller;
      const readable = stream ? new ReadableStream({
        start(value) { controller = value; },
        cancel() { cancel(false); },
      }) : null;
      const send = (message) => child.stdin.write(message);
      const emit = (object) => controller?.enqueue(enc.encode(`data: ${JSON.stringify(object)}\n\n`));
      const chunk = (delta, finishReason = null, usage) => emit({
        ...common, object: "chat.completion.chunk",
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(usage && { usage }),
      });
      function append(text) {
        if (!text) return;
        if (output.length + text.length > MAX_OUTPUT_LENGTH) {
          finish({ error: "Devin ACP response exceeded the output limit", interrupt: true });
          return;
        }
        if (!output) chunk({ role: ROLE.ASSISTANT });
        output += text;
        chunk({ content: text });
      }
      function finish({ error, code = 502, reason, usage, consumerClosed = false, interrupt = false }) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (interrupt && sessionId) {
          try { send(rpc("session/cancel", { sessionId })); } catch { /* Process is gone. */ }
        }
        child.stdin.end();
        if (interrupt) {
          const killTimer = setTimeout(() => {
            if (!child.killed && child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
          }, 500);
          killTimer.unref?.();
        } else if (!child.killed && child.exitCode == null && child.signalCode == null) {
          child.kill("SIGKILL");
        }
        if (consumerClosed) return;
        if (stream) {
          if (error) emit({ error: { message: error, type: "devin_cli_agentic_error" } });
          else chunk({}, reason, usage);
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        } else {
          resolveResponse(error ? fail(error, code) : wrap(Response.json({
            ...common, object: "chat.completion",
            choices: [{ index: 0, message: { role: ROLE.ASSISTANT, content: output }, finish_reason: reason }],
            usage,
          })));
        }
      }
      cancel = (notify = true) => finish({
        error: "Devin ACP turn cancelled", code: 499, interrupt: true, consumerClosed: !notify,
      });
      const abort = () => cancel();
      const timer = setTimeout(() => finish({
        error: "Devin ACP turn timed out", code: 504, interrupt: true,
      }), TURN_TIMEOUT_MS);
      timer.unref?.();

      function update({ sessionId: updateSession, update: event } = {}) {
        if (expectedId !== 3 || updateSession !== sessionId || !event) return;
        if (event.sessionUpdate === "agent_message_chunk") {
          const text = extractChunkText(event.content);
          assistantText += text;
          append(text);
        }
        if (event.sessionUpdate !== "tool_call" && event.sessionUpdate !== "tool_call_update") return;
        if (!isString(event.toolCallId) || event.toolCallId.length === 0) return;
        const previous = toolCalls.get(event.toolCallId);
        if (!previous && event.sessionUpdate === "tool_call_update") return;
        const kind = TOOL_KINDS.has(event.kind) ? event.kind : previous?.kind || "other";
        const status = TOOL_STATUSES.has(event.status) ? event.status : previous?.status || "pending";
        if (previous?.status === status && previous.kind === kind) return;
        toolCalls.set(event.toolCallId, { kind, status });
        append(`\n[Devin tool: ${kind} — ${status}]\n`);
      }

      function receive(message) {
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.method && message.id != null) {
          const reply = message.method === "session/request_permission"
            ? { result: { outcome: { outcome: "cancelled" } } }
            : { error: { code: -32601, message: "Method not supported" } };
          send(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, ...reply })}\n`);
          return;
        }
        if (message.method === "session/update") {
          update(message.params);
          return;
        }
        if (message.method || message.id !== expectedId) return;
        if (message.error) {
          finish({ error: "Devin ACP rejected the request. Check CLI sign-in, model access and sandbox configuration." });
          return;
        }
        if (expectedId === 1) {
          if (message.result?.protocolVersion !== ACP_VERSION) {
            finish({ error: "Unsupported Devin ACP protocol version" });
            return;
          }
          expectedId = 2;
          send(rpc("session/new", { cwd: home, mcpServers: [] }, expectedId));
          return;
        }
        if (expectedId === 2) {
          sessionId = message.result?.sessionId;
          if (!isString(sessionId) || !sessionId) {
            finish({ error: "Devin ACP returned no session ID" });
            return;
          }
          expectedId = 3;
          send(rpc("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] }, expectedId));
          return;
        }

        const stop = message.result?.stopReason;
        if (!Object.hasOwn(STOP_REASONS, stop) || (!assistantText && stop !== "refusal")) {
          finish({ error: stop === "cancelled" ? "Devin ACP turn cancelled" : "Devin ACP ended without a complete response", code: stop === "cancelled" ? 499 : 502 });
          return;
        }
        const promptTokens = Math.ceil(prompt.length / 4);
        const completionTokens = Math.ceil(assistantText.length / 4);
        finish({
          reason: STOP_REASONS[stop],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens, estimated: true },
        });
      }

      let pending = "";
      child.stdout.on("data", (data) => {
        if (settled) return;
        const lines = (pending + decoder.write(data)).split("\n");
        pending = lines.pop();
        try {
          for (const line of lines) {
            if (settled) return;
            if (line.length > MAX_FRAME_LENGTH) throw new Error("ACP frame too large");
            if (line.trim()) receive(JSON.parse(line));
          }
          if (!settled && pending.length > MAX_FRAME_LENGTH) throw new Error("ACP frame too large");
        } catch {
          finish({ error: "Invalid Devin ACP stdio frame or closed input" });
        }
      });
      child.stderr.on("data", () => {}); // Drain stderr without exposing local paths or credentials.
      child.stdin.on?.("error", () => finish({ error: "Devin ACP input closed" }));
      child.on("error", () => finish({ error: "Could not launch Devin CLI" }));
      child.on("close", () => finish({ error: "Devin CLI exited before completing the ACP turn" }));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      if (!settled) {
        try {
          send(rpc("initialize", {
            protocolVersion: ACP_VERSION,
            clientInfo: { name: "durindoor", version: "1.0" },
            clientCapabilities: {},
          }, expectedId));
        } catch {
          finish({ error: "Devin ACP input closed" });
        }
      }
      return stream ? wrap(new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } })) : completed;
    };

    let sent;
    try {
      sent = await sender.sendRequest(url, { signal }, null, { transport: () => ({ reply: startTurn() }) });
    } catch (error) {
      if (isQuotaDispatchUnavailable(error)) throw error;
      if (signal?.aborted) return fail("Devin ACP turn cancelled", 499);
      return fail("Could not launch Devin CLI", 502);
    }
    const result = await sent.reply;
    transferProviderAttemptDispatch(sent, result.response);
    return { ...result, attemptStartedAt: sender.attemptStartedAt };
  }
}
