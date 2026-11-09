// DeepAI text2img: one synchronous multipart POST, `api-key` header, JSON { id, output_url }.
// Source: https://deepai.org/docs (Getting Started, AI Image Generator). Requires the user's own DeepAI Pro plan.
// Unverified: no live call was made; response and error bodies follow the docs only.
import { nowSec } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

const BASE_URL = PROVIDER_MEDIA.deepai?.imageConfig?.baseUrl;
// Documented width/height range: 128-1536 in multiples of 32.
const validDimension = (n) => Number.isInteger(n) && n >= 128 && n <= 1536 && n % 32 === 0;

const fail = (message, status) => Object.assign(new Error(message), { status });

export default {
  buildUrl: (model) => `${BASE_URL}/${encodeURIComponent(model)}`,
  buildHeaders: (creds) => {
    const key = creds?.apiKey || creds?.accessToken;
    if (!key) throw fail("DeepAI API key is missing", 401);
    // No Content-Type: fetch sets the multipart boundary for FormData.
    return { "api-key": key, "Accept": "application/json" };
  },
  buildBody: (_model, body) => {
    const form = new FormData();
    form.append("text", body.prompt);
    if (isString(body.negative_prompt) && body.negative_prompt) form.append("negative_prompt", body.negative_prompt);
    const match = isString(body.size) ? body.size.match(/^(\d+)x(\d+)$/) : null;
    if (match && validDimension(Number(match[1])) && validDimension(Number(match[2]))) {
      form.append("width", match[1]);
      form.append("height", match[2]);
    }
    return form;
  },
  // A 200 without output_url is a failure so combo fallback can move on; DeepAI errors use { err }.
  async parseResponse(response) {
    const data = await response.json();
    if (!isString(data?.output_url) || !data.output_url) {
      throw fail(isString(data?.err) ? data.err : "DeepAI response had no output_url", 502);
    }
    return data;
  },
  normalize: (responseBody) => ({ created: nowSec(), data: [{ url: responseBody.output_url }] }),
};
