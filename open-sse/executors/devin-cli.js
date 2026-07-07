import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BaseExecutor } from "./base.js";

const DEVIN_ACP_TIMEOUT_MS = parseInt(process.env.DEVIN_ACP_TIMEOUT_MS || "300000", 10);

function resolveDevinBin() {
  const envBin = process.env.CLI_DEVIN_BIN?.trim();
  if (envBin) return envBin;
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const winPath = path.join(localAppData, "devin", "cli", "bin", "devin.exe");
    if (fs.existsSync(winPath)) return winPath;
    return "devin.exe";
  }
  for (const candidate of [
    path.join(os.homedir(), ".local", "share", "devin", "bin", "devin"),
    path.join(os.homedir(), ".devin", "bin", "devin"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "devin";
}

function rpc(method, params, id) {
  const message = { jsonrpc: "2.0", method, params };
  if (id !== undefined) message.id = id;
  return `${JSON.stringify(message)}\n`;
}

function buildAcpInitializeParams() {
  return {
    protocolVersion: 1,
    clientInfo: { name: "durindoor", version: "1.0" },
    clientCapabilities: {},
  };
}

function buildAcpSessionNewParams() {
  return { cwd: process.cwd(), mcpServers: [] };
}

function buildPromptText(messages = []) {
  const lines = [];
  for (const message of messages) {
    const role = String(message.role || "user");
    let text = "";
    if (typeof message.content === "string") {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && typeof part === "object" && part.type === "text") {
          text += String(part.text || "");
        }
      }
    }
    if (!text.trim()) continue;
    if (role === "system") lines.push(`[System]\n${text}`);
    else if (role === "assistant") lines.push(`[Assistant]\n${text}`);
    else lines.push(`[User]\n${text}`);
  }
  return lines.join("\n\n") || "(empty)";
}

function extractResultText(result = {}) {
  if (typeof result.content === "string") return result.content;
  if (typeof result.text === "string") return result.text;
  if (result.message && typeof result.message.content === "string") return result.message.content;
  if (Array.isArray(result.messages)) {
    return result.messages
      .filter(message => message.role === "assistant")
      .map(message => String(message.content || ""))
      .join("\n");
  }
  return "";
}

export function buildAcpPromptParams(sessionId, promptText) {
  return { sessionId, prompt: [{ type: "text", text: promptText }] };
}

export function parseAcpSessionUpdate(params = {}) {
  const update = params.update && typeof params.update === "object" ? params.update : params;
  const type = update.sessionUpdate || update.type || params.type;
  if (type === "agent_message_chunk") {
    return { kind: "delta", text: update.content?.text || update.text || "" };
  }
  if (type === "message_delta" || type === "text_delta" || type === "content_delta") {
    return { kind: "delta", text: update.content || update.delta || update.text || "" };
  }
  if (type === "message_stop" || type === "stop" || type === "done" || update.stopReason) {
    return { kind: "stop" };
  }
  if (type === "error") {
    return { kind: "error", message: String(update.message || update.error || "Devin ACP error") };
  }
  return { kind: "ignore" };
}

function devinErrorResponse(status, message) {
  return new Response(JSON.stringify({ error: { message, type: "devin_cli_error" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function runAcpCompletion({ model, promptText, apiKey, devinBin, signal, log }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (apiKey) env.WINDSURF_API_KEY = apiKey;
    const child = spawn(devinBin, ["acp", "--agent-type", "summarizer"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdinClosed = false;
    let idCounter = 1;
    let initDone = false;
    let sessionCreated = false;
    let promptSent = false;
    let totalText = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
      try {
        if (!stdinClosed) {
          stdinClosed = true;
          child.stdin.end();
        }
      } catch {
        // Ignore close races.
      }
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const fail = message => settle(reject, new Error(message));
    const sendRpc = (method, params) => {
      if (stdinClosed || child.stdin.destroyed) return;
      child.stdin.write(rpc(method, params, idCounter++));
    };
    const onAbort = () => {
      if (!child.killed) child.kill("SIGTERM");
      fail("Devin ACP request aborted");
    };
    const timeout = setTimeout(() => {
      if (!child.killed) child.kill("SIGTERM");
      fail("Devin ACP request timed out");
    }, DEVIN_ACP_TIMEOUT_MS);
    timeout.unref?.();
    if (signal?.aborted) onAbort();
    else if (signal) signal.addEventListener("abort", onAbort, { once: true });

    let buffer = "";
    child.stdout.on("data", chunk => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.error) {
          fail(`Devin ACP error ${message.error.code}: ${message.error.message}`);
          return;
        }
        if (!initDone && message.result !== undefined && !message.method) {
          initDone = true;
          sendRpc("session/new", buildAcpSessionNewParams());
          continue;
        }
        if (initDone && !sessionCreated && message.result !== undefined && !message.method) {
          const sessionId = message.result?.sessionId || null;
          if (!sessionId) {
            fail("Devin ACP: session/new returned no sessionId");
            return;
          }
          sessionCreated = true;
          promptSent = true;
          sendRpc("session/prompt", buildAcpPromptParams(sessionId, promptText));
          continue;
        }
        if (message.method === "session/update" || message.method === "$/update") {
          const update = parseAcpSessionUpdate(message.params || {});
          if (update.kind === "delta" && update.text) totalText += update.text;
          if (update.kind === "stop") {
            settle(resolve, totalText);
            return;
          }
          if (update.kind === "error") {
            fail(update.message);
            return;
          }
          continue;
        }
        if (promptSent && message.result !== undefined && !message.method) {
          const content = totalText ? "" : extractResultText(message.result);
          if (content) totalText = content;
          if (message.result?.stopReason && message.result.stopReason !== "cancelled") {
            settle(resolve, totalText);
            return;
          }
        }
      }
    });

    child.stderr.on("data", chunk => log?.debug?.("DEVIN", `stderr: ${chunk.toString("utf8").slice(0, 200)}`));
    child.on("error", error => {
      const message = error.message.includes("ENOENT") || error.message.includes("not found")
        ? `Devin CLI not found: ${devinBin}. Install https://cli.devin.ai or set CLI_DEVIN_BIN.`
        : `Devin CLI spawn error: ${error.message}`;
      fail(message);
    });
    child.on("close", code => {
      if (!settled) {
        if (code !== 0 && !totalText) fail(`Devin CLI exited with code ${code}`);
        else settle(resolve, totalText);
      }
    });
    sendRpc("initialize", buildAcpInitializeParams());
  });
}

export const __test__ = { rpc, buildAcpInitializeParams, buildAcpSessionNewParams };

export class DevinCliExecutor extends BaseExecutor {
  constructor() {
    super("devin-cli", { id: "devin-cli", baseUrl: "devin://acp/stdio" });
  }

  buildUrl() {
    return "devin://acp/stdio";
  }

  buildHeaders() {
    return {};
  }

  transformRequest() {
    return null;
  }

  async execute({ model, body, stream = true, credentials = {}, signal, log }) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const promptText = buildPromptText(messages);
    const apiKey = credentials.apiKey || credentials.accessToken || process.env.WINDSURF_API_KEY || "";
    const devinBin = resolveDevinBin();
    log?.info?.("DEVIN", `devin acp model=${model || "default"} bin=${devinBin}`);

    if (devinBin.includes(path.sep) && !fs.existsSync(devinBin)) {
      const message = `Devin CLI not found: ${devinBin}. Install https://cli.devin.ai or set CLI_DEVIN_BIN.`;
      return {
        response: devinErrorResponse(502, message),
        url: this.buildUrl(),
        headers: {},
        transformedBody: { model, promptLength: promptText.length },
      };
    }

    if (stream === false) {
      const created = Math.floor(Date.now() / 1000);
      try {
        const content = await runAcpCompletion({ model, promptText, apiKey, devinBin, signal, log });
        return {
          response: new Response(JSON.stringify({
            id: `chatcmpl-devin-${Date.now()}`,
            object: "chat.completion",
            created,
            model,
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: Math.ceil(promptText.length / 4),
              completion_tokens: Math.ceil(content.length / 4),
              total_tokens: Math.ceil((promptText.length + content.length) / 4),
              estimated: true,
            },
          }), { status: 200, headers: { "Content-Type": "application/json" } }),
          url: this.buildUrl(),
          headers: {},
          transformedBody: { model, promptLength: promptText.length },
        };
      } catch (error) {
        return {
          response: devinErrorResponse(502, error.message),
          url: this.buildUrl(),
          headers: {},
          transformedBody: { model, promptLength: promptText.length },
        };
      }
    }

    const sseStream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const emitRaw = data => controller.enqueue(enc.encode(data));
        const emit = object => emitRaw(`data: ${JSON.stringify(object)}\n\n`);
        const env = { ...process.env };
        if (apiKey) env.WINDSURF_API_KEY = apiKey;

        const child = spawn(devinBin, ["acp", "--agent-type", "summarizer"], {
          env,
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32",
        });

        let stdinClosed = false;
        let idCounter = 1;
        let initDone = false;
        let sessionCreated = false;
        let promptSent = false;
        let sessionId = null;
        let roleEmitted = false;
        let totalText = "";
        let finished = false;
        const responseId = `chatcmpl-devin-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        const sendRpc = (method, params) => {
          if (stdinClosed || child.stdin.destroyed) return;
          try {
            child.stdin.write(rpc(method, params, idCounter++));
          } catch {
            // Ignore writes after the process exits.
          }
        };

        const finish = error => {
          if (finished) return;
          finished = true;
          if (error) {
            emit({ error: { message: error, type: "devin_cli_error" } });
          } else {
            emit({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: {
                prompt_tokens: Math.ceil(promptText.length / 4),
                completion_tokens: Math.ceil(totalText.length / 4),
                total_tokens: Math.ceil((promptText.length + totalText.length) / 4),
                estimated: true,
              },
            });
          }
          emitRaw("data: [DONE]\n\n");
          try {
            if (!stdinClosed) {
              stdinClosed = true;
              child.stdin.end();
            }
          } catch {
            // Ignore close races.
          }
          const killTimer = setTimeout(() => {
            if (!child.killed) child.kill("SIGKILL");
          }, 2000);
          killTimer.unref?.();
          controller.close();
        };

        const emitRoleIfNeeded = () => {
          if (roleEmitted) return;
          emit({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
          });
          roleEmitted = true;
        };

        let buffer = "";
        child.stdout.on("data", chunk => {
          buffer += chunk.toString("utf8");
          let newline;
          while ((newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            let message;
            try {
              message = JSON.parse(line);
            } catch {
              continue;
            }
            if (message.error) {
              finish(`Devin ACP error ${message.error.code}: ${message.error.message}`);
              return;
            }
            if (!initDone && message.result !== undefined && !message.method) {
              initDone = true;
              sendRpc("session/new", buildAcpSessionNewParams());
              continue;
            }
            if (initDone && !sessionCreated && message.result !== undefined && !message.method) {
              sessionId = message.result?.sessionId || null;
              if (!sessionId) {
                finish("Devin ACP: session/new returned no sessionId");
                return;
              }
              sessionCreated = true;
              promptSent = true;
              sendRpc("session/prompt", buildAcpPromptParams(sessionId, promptText));
              continue;
            }
            if (message.method === "session/update" || message.method === "$/update") {
              const update = parseAcpSessionUpdate(message.params || {});
              if (update.kind === "delta") {
                const delta = update.text || "";
                if (delta) {
                  emitRoleIfNeeded();
                  totalText += delta;
                  emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] });
                }
              } else if (update.kind === "stop") {
                finish();
                return;
              } else if (update.kind === "error") {
                finish(update.message);
                return;
              }
              continue;
            }
            if (promptSent && message.result !== undefined && !message.method && !finished) {
              const content = !roleEmitted ? extractResultText(message.result) : "";
              if (content) {
                emitRoleIfNeeded();
                totalText = content;
                emit({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
              }
              if (message.result?.stopReason && message.result.stopReason !== "cancelled") finish();
            }
          }
        });

        child.stderr.on("data", chunk => log?.debug?.("DEVIN", `stderr: ${chunk.toString("utf8").slice(0, 200)}`));
        child.on("error", error => {
          const message = error.message.includes("ENOENT") || error.message.includes("not found")
            ? `Devin CLI not found: ${devinBin}. Install https://cli.devin.ai or set CLI_DEVIN_BIN.`
            : `Devin CLI spawn error: ${error.message}`;
          finish(message);
        });
        child.on("close", code => {
          if (!finished) finish(code !== 0 && !roleEmitted ? `Devin CLI exited with code ${code}` : undefined);
        });
        if (signal) {
          signal.addEventListener("abort", () => {
            if (!child.killed) child.kill("SIGTERM");
          }, { once: true });
        }
        sendRpc("initialize", buildAcpInitializeParams());
      },
    });

    return {
      response: new Response(sseStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }),
      url: this.buildUrl(),
      headers: {},
      transformedBody: { model, promptLength: promptText.length },
    };
  }
}
