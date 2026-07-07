import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BaseExecutor } from "./base.js";
import { buildErrorBody, errorResponse } from "../utils/error.js";
import auggieRegistry from "../providers/registry/auggie.js";

const AUGGIE_URL = "auggie://cli/stdio";
const MODEL_ALLOWLIST = new Set((auggieRegistry.models || []).map((model) => model.id));
const DEFAULT_MODEL = auggieRegistry.models?.[0]?.id || "claude-sonnet-4.6";

function sanitizeErrorMessage(message) {
  return String(message || "")
    .replace(/[^\s]+(?:\.js|\.ts):\d+(?::\d+)?/g, "[source]")
    .split("\n")
    .slice(0, 3)
    .join(" ")
    .slice(0, 2000);
}

export function resolveAuggieModel(model) {
  const requested = typeof model === "string" ? model.trim() : "";
  if (!requested) return { ok: true, model: DEFAULT_MODEL };
  if (requested.startsWith("-")) {
    return { ok: false, error: `Invalid Auggie model "${requested}": model must not start with "-".` };
  }
  if (!MODEL_ALLOWLIST.has(requested)) {
    return {
      ok: false,
      error: `Unknown Auggie model "${requested}". Supported models: ${[...MODEL_ALLOWLIST].join(", ")}.`,
    };
  }
  return { ok: true, model: requested };
}

function buildAuggieArgs(model) {
  return ["--print", "--quiet", "--model", model, "--"];
}

export function resolveAuggieBin() {
  const envBin = (process.env.AUGGIE_BIN || process.env.CLI_AUGGIE_BIN || "").trim();
  if (envBin) return envBin;

  const isWin = process.platform === "win32";
  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const winPath = path.join(localAppData, "auggie", "bin", "auggie.exe");
    if (fs.existsSync(winPath)) return winPath;
  }

  for (const candidate of [
    path.join(os.homedir(), ".local", "share", "auggie", "bin", "auggie"),
    path.join(os.homedir(), ".auggie", "bin", "auggie"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return isWin ? "auggie.cmd" : "auggie";
}

export function buildAuggiePrompt(messages = []) {
  const lines = [];
  for (const message of messages) {
    const role = String(message?.role || "user");
    let text = "";
    if (typeof message?.content === "string") {
      text = message.content;
    } else if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (part?.type === "text") text += String(part.text || "");
      }
    }
    if (!text.trim()) continue;
    if (role === "system") lines.push(`[System]\n${text}`);
    else if (role === "assistant") lines.push(`[Assistant]\n${text}`);
    else lines.push(`[User]\n${text}`);
  }
  return lines.join("\n\n") || "(empty)";
}

function isEnoentLike(message) {
  return message.includes("ENOENT") || message.includes("not found");
}

function cliNotFoundMessage(bin) {
  return sanitizeErrorMessage(
    `Auggie CLI not found: ${bin}. Install it and run "auggie login", or set AUGGIE_BIN to an absolute path.`
  );
}

export function checkAuggieCliVersion(timeoutMs = 5000) {
  const bin = resolveAuggieBin();
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawn(bin, ["--version"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      settle({ ok: false, error: isEnoentLike(message) ? cliNotFoundMessage(bin) : sanitizeErrorMessage(message) });
      return;
    }

    const timer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
      settle({ ok: false, error: "Auggie CLI version check timed out" });
    }, timeoutMs);

    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      const message = error?.message || String(error);
      settle({ ok: false, error: isEnoentLike(message) ? cliNotFoundMessage(bin) : sanitizeErrorMessage(message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) settle({ ok: true, version: stdout.trim().slice(0, 200) });
      else settle({ ok: false, error: `Auggie CLI exited with code ${code}` });
    });
  });
}

export class AuggieExecutor extends BaseExecutor {
  constructor() {
    super("auggie", { format: "openai", noAuth: true, baseUrl: AUGGIE_URL });
  }

  buildUrl() {
    return AUGGIE_URL;
  }

  buildHeaders() {
    return {};
  }

  transformRequest() {
    return null;
  }

  async refreshCredentials() {
    return null;
  }

  async execute({ model, body, stream, signal, log }) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const promptText = buildAuggiePrompt(messages);
    const auggieBin = resolveAuggieBin();
    const wantsStream = stream !== false;
    const modelResolution = resolveAuggieModel(model);
    if (!modelResolution.ok) {
      const response = wantsStream
        ? buildAuggieSseError(modelResolution.error)
        : errorResponse(400, modelResolution.error);
      return { response, url: AUGGIE_URL, headers: {}, transformedBody: { error: true } };
    }

    const safeModel = modelResolution.model;
    log?.info?.("AUGGIE", `auggie --print model=${safeModel} stream=${wantsStream}`);
    const response = wantsStream
      ? this.runStreaming(auggieBin, safeModel, promptText, signal, log)
      : await this.runNonStreaming(auggieBin, safeModel, promptText, signal, log);

    return {
      response,
      url: AUGGIE_URL,
      headers: {},
      transformedBody: { model: safeModel, promptLength: promptText.length },
    };
  }

  spawnAuggie(auggieBin, model, promptText) {
    const child = spawn(auggieBin, buildAuggieArgs(model), {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.on("error", () => {});
    try {
      child.stdin.write(promptText);
      child.stdin.end();
    } catch {
      // Child error/close handlers surface the subprocess failure.
    }
    return child;
  }

  runStreaming(auggieBin, model, promptText, signal, log) {
    const responseId = `chatcmpl-auggie-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let child = null;

    const sseStream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const emit = (data) => controller.enqueue(enc.encode(data));
        let closed = false;
        let roleEmitted = false;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {}
          }
        };
        const emitDelta = (delta) => {
          if (!delta) return;
          if (!roleEmitted) {
            emit(`data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
            })}\n\n`);
            roleEmitted = true;
          }
          emit(`data: ${JSON.stringify({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          })}\n\n`);
        };
        const emitError = (message) => {
          emit(`data: ${JSON.stringify(buildErrorBody(502, sanitizeErrorMessage(message)))}\n\n`);
          emit("data: [DONE]\n\n");
          finish();
        };
        const emitStop = () => {
          emit(`data: ${JSON.stringify({
            id: responseId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`);
          emit("data: [DONE]\n\n");
          finish();
        };

        try {
          child = spawn(auggieBin, buildAuggieArgs(model), {
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emitError(isEnoentLike(message) ? cliNotFoundMessage(auggieBin) : message);
          return;
        }

        child.stdin.on("error", () => {});
        try {
          child.stdin.write(promptText);
          child.stdin.end();
        } catch {}

        signal?.addEventListener("abort", () => {
          if (child && !child.killed) child.kill("SIGTERM");
          finish();
        }, { once: true });

        child.on("error", (error) => {
          const message = error?.message || String(error);
          emitError(isEnoentLike(message) ? cliNotFoundMessage(auggieBin) : message);
        });

        let stderrTail = "";
        child.stdout?.on("data", (chunk) => emitDelta(chunk.toString("utf8")));
        child.stderr?.on("data", (chunk) => {
          stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
          log?.debug?.("AUGGIE", `stderr: ${chunk.toString("utf8").slice(0, 200)}`);
        });
        child.on("close", (code) => {
          if (finished) return;
          if (code !== 0) {
            emitError(`Auggie CLI exited with code ${code}${stderrTail ? `: ${stderrTail}` : ""}`);
            return;
          }
          emitStop();
        });
      },
      cancel() {
        if (child && !child.killed) child.kill("SIGTERM");
      },
    });

    return new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  runNonStreaming(auggieBin, model, promptText, signal, log) {
    return new Promise((resolve) => {
      let child;
      try {
        child = this.spawnAuggie(auggieBin, model, promptText);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve(buildAuggieErrorResponse(isEnoentLike(message) ? cliNotFoundMessage(auggieBin) : message));
        return;
      }

      let stdout = "";
      let stderrTail = "";
      let settled = false;
      const settle = (response) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };

      signal?.addEventListener("abort", () => {
        if (!child.killed) child.kill("SIGTERM");
        settle(buildAuggieErrorResponse("Auggie CLI request aborted"));
      }, { once: true });

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
        log?.debug?.("AUGGIE", `stderr: ${chunk.toString("utf8").slice(0, 200)}`);
      });
      child.on("error", (error) => {
        const message = error?.message || String(error);
        settle(buildAuggieErrorResponse(isEnoentLike(message) ? cliNotFoundMessage(auggieBin) : message));
      });
      child.on("close", (code) => {
        if (code !== 0) {
          settle(buildAuggieErrorResponse(`Auggie CLI exited with code ${code}${stderrTail ? `: ${stderrTail}` : ""}`));
          return;
        }
        settle(buildChatCompletionResponse(model, promptText, stdout));
      });
    });
  }
}

function buildChatCompletionResponse(model, promptText, content) {
  const trimmed = content.trim();
  const body = {
    id: `chatcmpl-auggie-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: trimmed }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: Math.ceil(promptText.length / 4),
      completion_tokens: Math.ceil(trimmed.length / 4),
      total_tokens: Math.ceil((promptText.length + trimmed.length) / 4),
      estimated: true,
    },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function buildAuggieErrorResponse(message) {
  return errorResponse(502, sanitizeErrorMessage(message));
}

function buildAuggieSseError(message) {
  const enc = new TextEncoder();
  const sseStream = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify(buildErrorBody(400, sanitizeErrorMessage(message)))}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(sseStream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export default AuggieExecutor;
