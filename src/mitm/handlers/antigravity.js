const { err, createResponseDumper } = require("../logger");
const { IS_DEV } = require("../config");
const { fetchRouter, pipeSSE } = require("./base");

/**
 * Apply a source-model mapping and replace conflicting native thinking controls
 * when an explicit reasoning effort is configured for that Antigravity source.
 */
function applyRequestOverrides(body, override = {}) {
  if (override.model) body.model = override.model;
  if (override.reasoningEffort) {
    body.reasoning_effort = override.reasoningEffort;
    delete body.thinkingConfig;
    if (body.generationConfig) delete body.generationConfig.thinkingConfig;
    if (body.request?.generationConfig) delete body.request.generationConfig.thinkingConfig;
  }
  return body;
}

/**
 * Route mapped Antigravity requests through the Gemini gateway and restore
 * the Cloud Code response envelope expected by the client.
 */
async function intercept(req, res, bodyBuffer, override) {
  const dumper = IS_DEV ? createResponseDumper(req, "intercept-antigravity") : null;
  const isStream = req.url.includes(":streamGenerateContent");
  try {
    const body = applyRequestOverrides(JSON.parse(bodyBuffer.toString()), override);

    const model = body.model;
    if (!model || model.constructor !== String) throw new Error("Missing mapped model");
    const geminiBody = { ...(body.request || body) };
    if (body.reasoning_effort) geminiBody.reasoning_effort = body.reasoning_effort;
    const action = isStream ? "streamGenerateContent?alt=sse" : "generateContent";
    const path = `/v1beta/models/${model.split("/").map(encodeURIComponent).join("/")}:${action}`;
    const routerRes = await fetchRouter(geminiBody, path, req.headers);
    if (!routerRes.ok) return await pipeSSE(routerRes, res, dumper);
    if (!isStream) {
      const response = await routerRes.json();
      res.writeHead(routerRes.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ response }));
    }
    const wrapped = new TransformStream({
      start() { this.buffer = ""; this.decoder = new TextDecoder(); },
      transform(chunk, controller) {
        this.buffer += this.decoder.decode(chunk, { stream: true });
        const frames = this.buffer.split(/\r?\n\r?\n/);
        this.buffer = frames.pop();
        for (const frame of frames) {
          const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
          if (data) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: JSON.parse(data) })}\n\n`));
        }
      },
      flush() {
        this.buffer += this.decoder.decode();
        if (this.buffer.trim()) throw new Error("Incomplete Gemini stream");
      },
    });
    await pipeSSE(new Response(routerRes.body.pipeThrough(wrapped), { status: routerRes.status, headers: routerRes.headers }), res, dumper);
  } catch (error) {
    err(`[antigravity] ${error.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${error.message}\n`); dumper.end(); }
    // For stream endpoint, send SSE error chunk so SDK doesn't hang waiting
    if (res.headersSent) { res.destroy(error); return; }
    if (isStream) {
      if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ error: { message: error.message } })}\r\n\r\n`);
    } else {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
    }
  }
}

module.exports = { intercept, applyRequestOverrides };
