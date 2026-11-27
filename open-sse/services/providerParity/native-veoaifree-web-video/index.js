// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// config/videoRegistry.ts, handlers/videoGeneration.ts and executors/veoaifree-web.ts.
// Private staging adapter; see registration.json for the supported subset.
import { createErrorResult } from "../../../utils/error.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";

export const config = Object.freeze({
  id: "veoaifree-web", alias: "veo-free", baseUrl: "https://veoaifree.com/wp-admin/admin-ajax.php",
  authType: "none", authHeader: "none", format: "veoaifree-web",
  serviceKinds: ["video"], models: [{ id: "veo", name: "VEO 3.1" }, { id: "seedance", name: "Seedance" }],
});
const ORIGIN = "https://veoaifree.com";
export const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const fail = (status = 502) => Object.assign(new Error("Veo AI Free video request failed"), { status });

/** Source cookie precedence: providerSpecificData cookie/WordPress key, then apiKey. Never an OAuth bearer. */
export function sessionCookie(credentials = {}) {
  const normalize = (value, name = "wordpress_logged_in") => {
    if (typeof value !== "string") return "";
    const text = value.trim().replace(/^bearer\s+/i, "").replace(/^cookie:/i, "").trim();
    if (!text) return "";
    if (text.startsWith("[") || text.startsWith("{")) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw fail(400); }
      if (Array.isArray(parsed)) return parsed.map((entry) => {
        if (!/^[\w-]+$/.test(entry?.name) || typeof entry.value !== "string" || /[;\r\n]/.test(entry.value)) throw fail(400);
        return `${entry.name}=${entry.value}`;
      }).join("; ");
      return fromRecord(parsed);
    }
    if (/[\r\n\x00]/.test(text) || text.length > 16384) throw fail(400);
    return text.includes("=") ? text : `${name}=${text}`;
  };
  const fromRecord = (record) => {
    if (!record || typeof record !== "object") return "";
    if (typeof record.cookie === "string" && record.cookie.trim()) return normalize(record.cookie);
    const key = Object.keys(record).find((k) => /^wordpress_logged_in(?:_|$)/.test(k));
    return key ? normalize(record[key], key) : "";
  };
  return fromRecord(credentials.providerSpecificData) || normalize(credentials.apiKey);
}

export function buildRequest(model, body) {
  if (!config.models.some((entry) => entry.id === model)) throw fail(400);
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 10000) throw fail(400);
  const allowed = new Set(["model", "prompt", "aspect_ratio", "size", "n", "stream", "response_format"]);
  if (Object.keys(body).some((key) => !allowed.has(key)) || (body.n !== undefined && body.n !== 1) ||
      (body.stream !== undefined && body.stream !== false) || (body.response_format !== undefined && body.response_format !== "url")) throw fail(400);
  const ratio = body.aspect_ratio ?? body.size ?? "VIDEO_ASPECT_RATIO_LANDSCAPE";
  if (!["VIDEO_ASPECT_RATIO_LANDSCAPE", "VIDEO_ASPECT_RATIO_PORTRAIT"].includes(ratio) ||
      (body.size && body.aspect_ratio && body.size !== body.aspect_ratio)) throw fail(400);
  return { prompt: body.prompt, totalVariations: "1", aspectRatio: ratio, actionType: "full-video-generate" };
}

/** One submit only. Per-call session state; no nonce, cookies, or jobs cross connections. */
export function createVeoAiFreeVideoAdapter({ timeoutMs = 660000, requestTimeoutMs = 30000, pollIntervalMs = 20000, maxPolls = 30 } = {}) {
  return {
    provider: config.id, models: config.models, async: true, responseFormats: ["url"], defaultResponseFormat: "url",
    async generate({ model, body, credentials, signal }) {
      let params, cookie;
      try { params = buildRequest(model, body); cookie = sessionCookie(credentials); } catch { return createErrorResult(400, "Unsupported Veo AI Free video input or session"); }
      const controller = new AbortController();
      const totalTimer = setTimeout(() => controller.abort(fail(504)), Math.min(660000, Math.max(1, timeoutMs)));
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let submitted = false;
      let jobState = "submit-unknown";
      const proxyOptions = resolveCredentialProxyOptions(credentials);
      async function request(url, values) {
        const perCall = AbortSignal.timeout(Math.min(30000, Math.max(1, requestTimeoutMs)));
        const callSignal = AbortSignal.any([combined, perCall]);
        callSignal.throwIfAborted();
        const headers = { "User-Agent": USER_AGENT, Referer: `${ORIGIN}/` };
        if (values) {
          Object.assign(headers, { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" });
          if (cookie) headers.Cookie = cookie;
        }
        const pending = (async () => {
          const response = await fetch(url, { method: values ? "POST" : "GET", headers, redirect: "manual", proxyOptions,
            ...(values ? { body: new URLSearchParams(values).toString() } : {}), signal: callSignal });
          if (response.redirected || (response.url && new URL(response.url).origin !== ORIGIN) || !response.ok) {
            void response.body?.cancel().catch(() => {});
            throw fail([401, 403, 429].includes(response.status) ? response.status : 502);
          }
          // Bounded streamed reads, covered by the same deadline as network setup.
          const reader = response.body?.getReader();
          if (!reader) throw fail();
          const chunks = []; let bytes = 0;
          const abort = () => { void reader.cancel().catch(() => {}); };
          callSignal.addEventListener("abort", abort, { once: true });
          try {
            for (;;) {
              callSignal.throwIfAborted();
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 65536) throw fail();
              chunks.push(Buffer.from(value));
            }
            callSignal.throwIfAborted();
            {
              const cookies = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie")].filter(Boolean);
              const jar = new Map(cookie.split(/;\s*/).filter(Boolean).map((s) => { const i = s.indexOf("="); return [s.slice(0, i), s.slice(i + 1)]; }));
              for (const raw of cookies) {
                const pair = raw.split(";")[0]; const i = pair.indexOf("=");
                if (i > 0 && !/[\r\n]/.test(pair)) jar.set(pair.slice(0, i), pair.slice(i + 1));
              }
              cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
            }
            return Buffer.concat(chunks).toString("utf8").trim();
          } finally { callSignal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); }
        })();
        let stop;
        const aborted = new Promise((_, reject) => {
          stop = () => reject(callSignal.reason);
          callSignal.addEventListener("abort", stop, { once: true });
          if (callSignal.aborted) stop();
        });
        try { return await Promise.race([pending, aborted]); }
        finally { callSignal.removeEventListener("abort", stop); }
      }
      const check = (text) => {
        if (/login to create|log in to create|please log\s?in/i.test(text)) throw fail(401);
        if (/rate-limit-exceed|rate limit/i.test(text)) throw fail(429);
      };
      try {
        combined.throwIfAborted();
        const html = await request(ORIGIN);
        const nonce = html.match(/nonce":"([a-f0-9]+)"/)?.[1];
        if (!nonce) throw fail();
        combined.throwIfAborted();
        submitted = true;
        const sceneData = await request(config.baseUrl, { action: "veo_video_generator", nonce, ...params });
        check(sceneData);
        if (!sceneData || sceneData === "0" || /error|<|<\//i.test(sceneData)) throw fail();
        jobState = "accepted";
        for (let i = 0; i < Math.min(30, maxPolls); i++) {
          await sleep(Math.min(20000, Math.max(0, pollIntervalMs)), combined);
          const text = await request(config.baseUrl, { action: "veo_video_generator", nonce, sceneData, actionType: "final-video-results" });
          check(text);
          if (!text || text === "0" || /error/i.test(text)) continue;
          const candidate = text.split(/[,\n]/).map((s) => s.trim()).find((s) => /^https?:\/\//i.test(s));
          if (!candidate) continue;
          const url = new URL(candidate);
          if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || isBlockedHost(url.hostname) || candidate.length > 4096) throw fail();
          const accounting = mediaAccounting(null, config.id, "video");
          accounting.nativeUnits = { videos: 1 };
          accounting.meta = { nativeUnitsSource: "returned-videos" };
          return { success: true, accounting, response: Response.json({ created: Math.floor(Date.now() / 1000), data: [{ url: url.href, type: "video" }] }) };
        }
        throw fail(504);
      } catch (error) {
        const status = signal?.aborted ? 499 : controller.signal.aborted || error?.name === "TimeoutError" ? 504 : error.status || 502;
        const result = createErrorResult(status, "Veo AI Free video request failed");
        if (submitted) result.acceptedJob = { ...mediaAccounting(null, config.id, "video"), costSource: "accepted-job", meta: { jobState } };
        return result;
      } finally { clearTimeout(totalTimer); }
    },
  };
}
export default createVeoAiFreeVideoAdapter();
