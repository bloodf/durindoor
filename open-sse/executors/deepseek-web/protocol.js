import { isString, isObject } from "../../../src/shared/utils/typeChecks.js";
// Fragment decoding adapted from cheaper-inference/OmniRoute (MIT),
// open-sse/executors/deepseek-web.ts at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
// See LICENSE.omniroute. Malformed/truncated bodies fail closed before success output.
export function envelopeStatus(value) {
  const code = value?.code;
  if (code !== undefined && code !== 0) return code === 40003 ? 401 : code === 40002 ? 429 : 502;
  return null;
}

/** Bound bytes, UTF-8 validity, caller cancellation and elapsed time even for a stalled body. */
export async function readBounded(response, signal, maxBytes = 4 * 1024 * 1024) {
  if (!response.body) throw new Error("Missing DeepSeek response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => reject(new DOMException("Request aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("DeepSeek response exceeds limit");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function decodeEvents(text, thinking = false) {
  let content = "";
  let reasoning = "";
  let path = thinking ? "thinking" : "content";
  let source = false;
  let finished = false;
  let legacy = false;
  let legacyMessage = false;
  let nativeFinished = false;
  const append = value => { if (path === "thinking") reasoning += value; else content += value; };
  const fragment = f => {
    if (!f || !isObject(f)) throw new Error("Invalid DeepSeek fragment");
    if (f.type === "THINK") path = "thinking";
    if (f.type === "ANSWER" || f.type === "RESPONSE") path = "content";
    if (f.content !== undefined && !isString(f.content)) throw new Error("Invalid DeepSeek content");
    if (f.content) append(f.content);
  };
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith(":")) continue;
    if (/^(event|id|retry):/.test(raw)) {
      if (raw === "event: hint" || raw === "event: error") throw new Error("DeepSeek stream rejected");
      continue;
    }
    const data = raw.startsWith("data:") ? raw.slice(5).trim() : raw;
    if (data === "[DONE]") { finished = true; continue; }
    const event = JSON.parse(data);
    const status = envelopeStatus(event);
    if (status) throw Object.assign(new Error("DeepSeek rejection"), { status });
    if (event?.error) throw new Error("DeepSeek stream rejected");
    const { p, v } = event;
    if (p !== undefined || v !== undefined) source = true;
    if (p === "response/status") { if (v === "FINISHED") nativeFinished = true; continue; }
    if (v?.response) {
      if (v.response.thinking_enabled !== undefined) path = v.response.thinking_enabled ? "thinking" : "content";
      if (Array.isArray(v.response.fragments)) v.response.fragments.forEach(fragment);
    } else if (p === "response/fragments") {
      (Array.isArray(v) ? v : [v]).forEach(fragment);
    } else if (isString(v) && !p?.startsWith("response/search")) append(v);
    else if (p === "response" && Array.isArray(v)) {
      for (const entry of v) {
        if (entry?.v?.thinking_enabled === true) path = "thinking";
        if (Array.isArray(entry?.v)) entry.v.forEach(fragment);
      }
    }
    const choice = event?.choices?.[0];
    if (choice?.delta) {
      legacy = true;
      content += choice.delta.content || "";
      reasoning += choice.delta.reasoning_content || "";
      if (choice.finish_reason) finished = true;
    }
    const payload = event?.data?.biz_data || event?.biz_data || event?.data;
    const value = payload?.response || payload?.content || payload?.message?.content;
    if (isString(value)) { content += value; legacy = true; legacyMessage = true; }
  }
  // Legacy complete-message envelopes are retained; native source streams require FINISHED.
  // [DONE] alone is an OpenAI terminal, never a native DeepSeek terminal.
  if (source && !nativeFinished) throw new Error("DeepSeek stream ended before completion");
  if (!source && (!legacy || (!legacyMessage && !finished))) throw new Error("DeepSeek stream ended before completion");
  if (!content && !reasoning) throw new Error("Empty DeepSeek completion");
  return { content, reasoning };
}
