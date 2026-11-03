// DeepAI text2img: one synchronous POST, `api-key` header, JSON { id, output_url }.
// Source: https://deepai.org/docs (Getting Started, AI Image Generator). Requires the user's own DeepAI Pro plan.
// Unverified: no live call was made; response and error bodies follow the docs only.
import { nowSec } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

const BASE_URL = PROVIDER_MEDIA.deepai?.imageConfig?.baseUrl;
// Documented width/height range: 128-1536 in multiples of 32.
const validDimension = (n) => Number.isInteger(n) && n >= 128 && n <= 1536 && n % 32 === 0;

export default {
  buildUrl: (model) => `${BASE_URL}/${encodeURIComponent(model)}`,
  buildHeaders: (creds) => ({
    "Content-Type": "application/json",
    "api-key": creds?.apiKey || creds?.accessToken,
    "Accept": "application/json",
  }),
  buildBody: (_model, body) => {
    const req = { text: body.prompt };
    if (isString(body.negative_prompt) && body.negative_prompt) req.negative_prompt = body.negative_prompt;
    const match = isString(body.size) ? body.size.match(/^(\d+)x(\d+)$/) : null;
    if (match && validDimension(Number(match[1])) && validDimension(Number(match[2]))) {
      req.width = match[1];
      req.height = match[2];
    }
    return req;
  },
  normalize: (responseBody) => ({
    created: nowSec(),
    data: isString(responseBody?.output_url) ? [{ url: responseBody.output_url }] : [],
  }),
};
