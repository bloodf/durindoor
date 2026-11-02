// Magnific Mystic (formerly Freepik API) — async submit + poll (#1201).
//
// Ported from OmniRoute open-sse/handlers/imageGeneration/providers/magnific.ts
// and open-sse/config/providers/registry/magnific/index.ts
// (diegosouzapw/OmniRoute@61e07fb7, MIT). POST /v1/ai/mystic returns
// { data: { task_id } }; GET /v1/ai/mystic/{task_id} is polled until
// COMPLETED / FAILED. Fork deviation: returns the generated image URLs like
// the other async adapters (runwayml) instead of downloading them here, so no
// upstream-supplied URL is fetched by this adapter.
import { isString } from "../../../src/shared/utils/typeChecks.js";
import { sleep, nowSec, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA.magnific?.imageConfig?.baseUrl || "https://api.magnific.com/v1/ai/mystic";
const AUTH_HEADER = "x-magnific-api-key";
// OpenAI sizes advertised by the registry → Mystic aspect_ratio enum.
const SIZE_TO_ASPECT = { "1024x1024": "square_1_1", "1024x1792": "social_story_9_16", "1792x1024": "widescreen_16_9" };
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export default {
  async: true,
  buildUrl: () => BASE_URL,
  buildHeaders: (creds) => ({ "Content-Type": "application/json", [AUTH_HEADER]: creds?.apiKey || creds?.accessToken || "" }),
  buildBody: (model, body) => ({
    prompt: isString(body.prompt) ? body.prompt : String(body.prompt ?? ""),
    model: model || "realism",
    resolution: isString(body.resolution) ? body.resolution : "1k",
    aspect_ratio: isString(body.aspect_ratio) ? body.aspect_ratio : SIZE_TO_ASPECT[body.size] || "square_1_1"
  }),
  async parseResponse(response, { headers }) {
    const submitted = await response.json();
    const taskId = submitted?.data?.task_id || submitted?.task_id;
    if (!isString(taskId) || !TASK_ID_RE.test(taskId)) throw new Error("Magnific Mystic did not return a task_id");
    const statusUrl = `${BASE_URL}/${encodeURIComponent(taskId)}`;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const r = await fetch(statusUrl, { headers: { [AUTH_HEADER]: headers[AUTH_HEADER] } });
      if (!r.ok) throw new Error(`Magnific Mystic status ${r.status}`);
      const json = await r.json();
      const task = json?.data || json;
      if (task?.status === "COMPLETED") return task;
      if (task?.status === "FAILED") throw new Error("Magnific Mystic image generation failed");
    }
    throw Object.assign(new Error("Magnific Mystic image generation timed out"), { status: 504 });
  },
  normalize: (task) => {
    const urls = (Array.isArray(task?.generated) ? task.generated : []).filter(isString);
    if (urls.length === 0) throw new Error("Magnific Mystic completed without a generated image URL");
    return { created: nowSec(), data: urls.map((url) => ({ url })) };
  }
};
