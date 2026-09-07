// Deterministic OpenAI-compatible upstream. It never fetches, proxies, or accepts a target URL.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const MODEL_ID = "gpt-qa-fixture";
const MODES = new Set(["success", "error", "cancel", "tool", "reasoning", "media"]);
const PNG_BUFFER = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9aQAAAABJRU5ErkJggg==", "base64");
const MEDIA_PATH = "/media/qa-fixture.png";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function modeFor(body) {
  const value = body?.qa_mode || body?.metadata?.qa_mode || "success";
  return MODES.has(value) ? value : "success";
}

function completion(model, mode) {
  const message = { role: "assistant", content: "QA fixture response" };
  if (mode === "tool") {
    message.content = null;
    message.tool_calls = [{ id: "call_qa_tool", type: "function", function: { name: "qa_lookup", arguments: "{\"query\":\"fixture\"}" } }];
  }
  if (mode === "reasoning") message.reasoning_content = "QA deterministic reasoning";
  return { id: `chatcmpl-qa-${randomUUID()}`, object: "chat.completion", created: 0, model: model || MODEL_ID, choices: [{ index: 0, message, finish_reason: mode === "tool" ? "tool_calls" : "stop" }], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } };
}

function sse(res, data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }
function sseDone(res) { res.write("data: [DONE]\n\n"); res.end(); }
function streamCompletion(res, model, mode) {
  const id = `chatcmpl-qa-${randomUUID()}`;
  const common = { id, object: "chat.completion.chunk", created: 0, model: model || MODEL_ID };
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  sse(res, { ...common, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
  if (mode === "cancel") {
    // Keep a real stream open until the UI aborts; a terminal marker cannot
    // prove that the Stop action cancelled an in-flight request.
    sse(res, { ...common, choices: [{ index: 0, delta: { content: "QA fixture streaming" }, finish_reason: null }] });
    const timer = setInterval(() => res.write(": waiting for cancellation\n\n"), 1000);
    res.once("close", () => clearInterval(timer));
    return;
  } else if (mode === "tool") {
    sse(res, { ...common, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_qa_tool", type: "function", function: { name: "qa_lookup", arguments: "{\"query\":\"fixture\"}" } }] }, finish_reason: null }] });
    sse(res, { ...common, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  } else {
    if (mode === "reasoning") sse(res, { ...common, choices: [{ index: 0, delta: { reasoning_content: "QA deterministic reasoning" }, finish_reason: null }] });
    sse(res, { ...common, choices: [{ index: 0, delta: { content: "QA fixture response" }, finish_reason: null }] });
    sse(res, { ...common, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } });
  }
  sseDone(res);
}

export function createFakeUpstream() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://fake-upstream.invalid");
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) return json(res, 200, { ok: true });
    if (req.method === "GET" && (url.pathname === "/models" || url.pathname === "/v1/models")) return json(res, 200, { object: "list", data: [{ id: MODEL_ID, object: "model", created: 0, owned_by: "qa" }] });
    if (req.method === "GET" && url.pathname === MEDIA_PATH) {
      res.writeHead(200, { "content-type": "image/png", "content-length": PNG_BUFFER.length, "cache-control": "no-store" });
      return res.end(PNG_BUFFER);
    }
    if (req.method !== "POST") return json(res, 404, { error: { message: "fixture endpoint not found", type: "invalid_request_error", code: "not_found" } });
    let body;
    try { body = await readJson(req); }
    catch (error) { return json(res, error.status || 400, { error: { message: error.message, type: "invalid_request_error", code: "invalid_json" } }); }
    const mode = modeFor(body);
    if (mode === "error") return json(res, 429, { error: { message: "QA fixture upstream rate limit", type: "rate_limit_error", code: "qa_rate_limit" } });
    if (url.pathname === "/images/generations" || url.pathname === "/v1/images/generations") {
      const data = body?.response_format === "b64_json" ? { b64_json: PNG_BUFFER.toString("base64") } : { url: `http://${req.headers.host}${MEDIA_PATH}` };
      return json(res, 200, { created: 0, data: [data] });
    }
    if (url.pathname !== "/chat/completions" && url.pathname !== "/v1/chat/completions") return json(res, 404, { error: { message: "fixture endpoint not found", type: "invalid_request_error", code: "not_found" } });
    if (body?.stream === true) return streamCompletion(res, body.model, mode);
    if (mode === "cancel") return json(res, 499, { error: { message: "QA fixture request cancelled", type: "cancelled_error", code: "qa_cancelled" } });
    return json(res, 200, completion(body.model, mode));
  });
}

export async function startFakeUpstream({ host = "127.0.0.1", port = 0 } = {}) {
  if (!new Set(["127.0.0.1", "::1", "0.0.0.0"]).has(host)) throw new Error("fake upstream host must be a local bind address");
  const server = createFakeUpstream();
  const sockets = new Set();
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const address = server.address();
  const urlHost = typeof address === "object" && address.address.includes(":") ? "[::1]" : "127.0.0.1";
  return {
    server,
    baseURL: `http://${urlHost}:${address.port}`,
    async stop() {
      const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DURIN_QA_FAKE_UPSTREAM_PORT || 4100);
  const host = process.env.DURIN_QA_FAKE_UPSTREAM_HOST || "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid fake-upstream port");
  const fixture = await startFakeUpstream({ host, port });
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    try { await fixture.stop(); }
    catch (error) { process.stderr.write(`QA fake upstream stop failed (${signal}): ${error.message}\n`); process.exitCode = 1; }
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void stop(signal); });
  console.log(`QA fake upstream ready on ${host}:${port}`);
}
