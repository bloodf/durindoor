// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// config/runway.ts, config/videoRegistry.ts, handlers/videoGeneration.ts and
// handlers/videoGeneration/runwayHelpers.ts. Private; see registration.json.
import { createErrorResult, readBoundedResponseText } from '../../../utils/error.js';
import { mediaAccounting } from '../../../handlers/mediaAccounting.js';
import { sleep } from '../../../handlers/imageProviders/_base.js';
import { resolveCredentialProxyOptions } from '../../oauthCredentialManager.js';
import { isBlockedHost } from '../../../../src/shared/utils/ssrfGuard.js';

export const config = Object.freeze({
  id: 'runwayml', aliases: ['runway'], baseUrl: 'https://api.dev.runwayml.com/v1',
  authType: 'bearer', authHeader: 'Authorization', format: 'runwayml',
  version: '2024-11-06', serviceKinds: ['video'],
  models: ['gen4.5', 'gen4_turbo', 'gen3a_turbo', 'veo3.1', 'veo3.1_fast'],
});
const bad = () => { throw new Error('Unsupported Runway video input'); };
function publicUrl(value) {
  const url = new URL(value);
  if (typeof value !== 'string' || value.length > 4096 || url.protocol !== 'https:' || url.username || url.password || isBlockedHost(url.hostname)) throw new Error('Unsafe Runway media URL');
  return url.href;
}
export function buildRequest(model, body) {
  if (!config.models.includes(model) || !body || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 10000) bad();
  const allowed = new Set(['prompt', 'model', 'n', 'stream', 'response_format', 'promptImage', 'prompt_image', 'image', 'image_url', 'imageUrl', 'aspect_ratio', 'aspectRatio', 'size', 'duration', 'frames', 'fps', 'seed']);
  if (Object.keys(body).some(k => !allowed.has(k)) || (body.n !== undefined && body.n !== 1) || (body.stream !== undefined && body.stream !== false) || (body.response_format !== undefined && body.response_format !== 'url')) bad();
  const refs = ['promptImage', 'prompt_image', 'image', 'image_url', 'imageUrl'].filter(k => body[k] !== undefined);
  if (refs.length > 1) bad();
  const image = refs.length ? publicUrl(body[refs[0]]) : null;
  if (model === 'gen4_turbo' && !image) bad();
  let ratio = body.aspect_ratio ?? body.aspectRatio;
  if (ratio !== undefined && !['16:9', '9:16', '1280:720', '720:1280'].includes(ratio)) bad();
  if (body.size !== undefined) {
    if (ratio || !/^\d{1,5}x\d{1,5}$/.test(body.size)) bad();
    const [w, h] = body.size.split('x').map(Number);
    if (!w || !h) bad();
    ratio = w >= h ? '16:9' : '9:16';
  }
  ratio = ['9:16', '720:1280'].includes(ratio) ? '720:1280' : '1280:720';
  let duration = body.duration;
  if (body.frames !== undefined || body.fps !== undefined) {
    if (duration !== undefined || !Number.isFinite(body.frames) || body.frames <= 0 || !Number.isFinite(body.fps) || body.fps <= 0) bad();
    duration = body.frames / body.fps;
  }
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) bad();
  const request = { model, promptText: body.prompt, ratio, duration: Math.min(10, Math.max(2, Math.round(duration ?? 5))) };
  if (image) request.promptImage = image;
  if (body.seed !== undefined) {
    if (!Number.isFinite(body.seed)) bad();
    request.seed = Math.max(0, Math.floor(body.seed));
  }
  return { path: image ? '/image_to_video' : '/text_to_video', request };
}

/** One selected connection, one submit, no replay. Bounds include body reads. */
export function createRunwayVideoAdapter({ timeoutMs = 300000, requestTimeoutMs = 30000, pollIntervalMs = 5000 } = {}) {
  return {
    async: true, responseFormats: ['url'], defaultResponseFormat: 'url',
    async generate({ model, body, credentials, signal }) {
      let built;
      try { built = buildRequest(model, body); } catch { return createErrorResult(400, 'Unsupported Runway video input'); }
      const key = credentials?.apiKey || credentials?.accessToken;
      if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) return createErrorResult(401, 'Runway credentials required');
      if (signal?.aborted) return createErrorResult(499, 'Runway request aborted');
      const total = new AbortController();
      const timer = setTimeout(() => total.abort(), Math.min(300000, Math.max(1, timeoutMs)));
      const combined = signal ? AbortSignal.any([signal, total.signal]) : total.signal;
      let mayBill = false;
      const accounting = () => mediaAccounting(null, config.id, 'video');
      const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Runway-Version': config.version };
      async function call(path, request) {
        const controller = new AbortController();
        const callSignal = AbortSignal.any([combined, controller.signal]);
        const callTimer = setTimeout(() => controller.abort(), Math.min(30000, Math.max(1, requestTimeoutMs)));
        let onAbort;
        const interrupted = new Promise((_, reject) => {
          onAbort = () => reject(new Error('Runway request interrupted'));
          callSignal.addEventListener('abort', onAbort, { once: true });
          if (callSignal.aborted) onAbort();
        });
        const work = (async () => {
          const response = await fetch(config.baseUrl + path, { method: request ? 'POST' : 'GET', headers, redirect: 'manual', signal: callSignal, ...resolveCredentialProxyOptions(credentials), ...(request ? { body: JSON.stringify(request) } : {}) });
          if (callSignal.aborted) { await response.body?.cancel(); throw new Error('Interrupted'); }
          if (response.redirected || (response.url && response.url !== config.baseUrl + path) || response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('Redirect refused'); }
          if (!response.ok) {
            await response.body?.cancel();
            if (request && response.status >= 400 && response.status < 500) mayBill = false;
            throw Object.assign(new Error('Runway upstream refused request'), { status: [401, 403, 402, 429].includes(response.status) ? response.status : 502 });
          }
          const text = await readBoundedResponseText(response, { signal: callSignal, timeoutMs: requestTimeoutMs, maxBytes: 262144, throwOnTimeout: true });
          const data = JSON.parse(text);
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Malformed response');
          return data;
        })();
        try { return await Promise.race([work, interrupted]); }
        finally { clearTimeout(callTimer); callSignal.removeEventListener('abort', onAbort); }
      }
      try {
        if (combined.aborted) throw new Error('Interrupted');
        mayBill = true;
        const submitted = await call(built.path, built.request);
        if (typeof submitted.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(submitted.id)) throw new Error('Malformed task');
        while (!combined.aborted) {
          const task = await call(`/tasks/${encodeURIComponent(submitted.id)}`);
          const status = typeof task.status === 'string' ? task.status.toUpperCase() : '';
          if (status === 'SUCCEEDED') {
            const output = task.output ?? task.result;
            if (!Array.isArray(output) || !output.length || output.length > 16) throw new Error('Malformed output');
            const data = output.map(entry => ({ url: publicUrl(typeof entry === 'string' ? entry : entry?.url ?? entry?.uri ?? entry?.videoUrl ?? entry?.video_url), format: 'mp4' }));
            const usage = accounting();
            usage.nativeUnits = { videos: data.length };
            usage.meta.nativeUnitsSource = 'returned-videos';
            return { success: true, accounting: usage, response: Response.json({ created: Math.floor(Date.now() / 1000), data }) };
          }
          if (['FAILED', 'CANCELLED', 'CANCELED'].includes(status)) throw new Error('Runway task failed');
          if (!['PENDING', 'RUNNING', 'THROTTLED'].includes(status)) throw new Error('Malformed task status');
          await sleep(Math.min(5000, Math.max(1, pollIntervalMs)), combined);
        }
        throw new Error('Deadline');
      } catch (error) {
        const result = createErrorResult(signal?.aborted ? 499 : total.signal.aborted ? 504 : error.status ?? 502, 'Runway video generation could not complete');
        if (mayBill) result.acceptedJob = { ...accounting(), costSource: 'accepted-job', meta: { jobState: 'outcome-unknown' } };
        return result;
      } finally { clearTimeout(timer); }
    },
  };
}
export default createRunwayVideoAdapter();
