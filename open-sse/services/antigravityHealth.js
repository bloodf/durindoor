import { frameCarriesContent, inheritStreamTokenLimit } from "../utils/streamContentPeek.js";
import { extractStreamErrorPayload } from "../utils/streamLifecycle.js";

// Process-local account/model health. Only confirmed header timeouts and useful
// completed responses are samples; all other outcomes release a probe unchanged.
export const HEALTH_POLICY = Object.freeze({ minSamples: 8, maxSamples: 32, windowMs: 300000, maxEntries: 1000, baseCooldown: 30000, maxCooldown: 300000 });
export const healthEnabled = (provider, settings) => (provider === "antigravity" || provider === "agy") &&
  ((settings?.antigravityAdaptiveHealth?.enabled === true || settings?.antigravityAdaptiveHealth?.enabled === false) ? settings.antigravityAdaptiveHealth.enabled : process.env.DURINDOOR_ANTIGRAVITY_ADAPTIVE_HEALTH_ENABLED === "true");

export class AntigravityHealthTracker {
  constructor(now = Date.now) { this.now = now; this.entries = new Map(); }
  key(id, model) { return JSON.stringify([id, model.trim().replace(/^(antigravity|agy)\//i, "").toLowerCase()]); }
  candidates(connections, model, forced = false) {
    if (forced) return connections;
    const usable = connections.filter((c) => { const e = this.entries.get(this.key(c.id, model)); return !e?.backoff || (!e.probe && e.until <= this.now()); });
    if (usable.length) return usable;
    const available = connections.filter((c) => !this.entries.get(this.key(c.id, model))?.probe);
    return available.sort((a, b) => (this.entries.get(this.key(a.id, model))?.until || 0) - (this.entries.get(this.key(b.id, model))?.until || 0)).slice(0, 1);
  }
  begin(id, model, early = false) {
    const key = this.key(id, model);
    let e = this.entries.get(key);
    if (!e) {
      if (this.entries.size >= HEALTH_POLICY.maxEntries) {
        const idle = [...this.entries].filter(([, value]) => !value.inflight).sort((a, b) => a[1].touched - b[1].touched)[0];
        if (!idle) return { finish() {} };
        this.entries.delete(idle[0]);
      }
      e = { samples: [], backoff: 0, until: 0, probe: false, inflight: 0, generation: 0, recovered: 0, touched: this.now() };
      this.entries.set(key, e);
    }
    const probe = e.backoff > 0;
    if (e.probe || (probe && e.until > this.now() && !early)) return null;
    if (probe) e.probe = true;
    e.inflight++; e.touched = this.now();
    const generation = e.generation;
    let done = false;
    return { probe, finish: (outcome) => {
      if (done) return;
      done = true; e.inflight--; e.touched = this.now();
      if (generation !== e.generation) return;
      if (probe) e.probe = false;
      if (outcome !== "success" && outcome !== "timeout") return;
      e.samples = e.samples.filter((s) => s.at > this.now() - HEALTH_POLICY.windowMs);
      e.samples.push({ at: this.now(), outcome });
      e.samples = e.samples.slice(-HEALTH_POLICY.maxSamples);
      const quarantine = () => { e.backoff = Math.min(e.backoff + 1, 5); e.until = this.now() + Math.min(HEALTH_POLICY.maxCooldown, HEALTH_POLICY.baseCooldown * 2 ** (e.backoff - 1)); e.recovered = 0; e.generation++; };
      if (probe) {
        if (outcome === "timeout") quarantine();
        else if (++e.recovered >= 2) { e.backoff = 0; e.until = 0; e.samples = []; e.recovered = 0; e.generation++; }
        else e.until = this.now();
      } else if (e.samples.length >= HEALTH_POLICY.minSamples && (e.samples.filter((s) => s.outcome === "timeout").length / e.samples.length >= 0.5 || e.samples.slice(-3).every((s) => s.outcome === "timeout"))) quarantine();
    } };
  }
}
export const antigravityHealth = new AntigravityHealthTracker();

const isNonEmptyText = (value) => Boolean(value && value.length && value.trim?.());

// A response must finish and contain actual generated content or a tool call.
export function trackHealthResponse(response, ticket, signal) {
  if (!ticket) return response;
  if (!response.body) { ticket.finish("ignored"); return response; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", useful = false, failed = false;
  const inspect = (line) => {
    if (frameCarriesContent(line)) useful = true;
    const data = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!data || data === "[DONE]") return;
    try {
      const value = JSON.parse(data);
      if (value.type === "error" || value.type === "response.failed" || extractStreamErrorPayload(value)) failed = true;
      const choice = value.choices?.[0];
      const message = choice?.message;
      if (message?.tool_calls?.length || message?.function_call ||
          (isNonEmptyText(message?.content)) ||
          (Array.isArray(message?.content) && message.content.some((part) => isNonEmptyText(part.text) || part.type === "tool_use")) ||
          (Array.isArray(value.content) && value.content.some((part) => isNonEmptyText(part.text) || part.type === "tool_use"))) useful = true;
    } catch { /* partial event or non-JSON metadata */ }
  };
  let timer;
  let settled = false;
  let streamController;
  const stop = () => { settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); ticket.finish("ignored"); reader.cancel().catch(() => {}); };
  const abort = () => { stop(); };
  const armProbeTimeout = () => {
    if (!ticket.probe || settled) return;
    clearTimeout(timer);
    timer = setTimeout(() => { stop(); streamController?.error(new Error("Antigravity recovery probe stream idle timeout")); }, 300000);
    timer.unref?.();
  };
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const finish = (outcome) => { settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); ticket.finish(outcome); };
  const body = new ReadableStream({
    start(controller) { streamController = controller; armProbeTimeout(); },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { buffer += decoder.decode(); inspect(buffer); finish(useful && !failed ? "success" : "ignored"); controller.close(); return; }
        armProbeTimeout();
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop().slice(-65536); for (const line of lines) inspect(line);
        controller.enqueue(chunk.value);
      } catch (error) { finish("ignored"); controller.error(error); }
    },
    async cancel(reason) { finish("ignored"); await reader.cancel(reason); }
  });
  inheritStreamTokenLimit(response.body, body);
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
