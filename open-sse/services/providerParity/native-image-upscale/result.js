// Success envelope shared by the staged upscale adapters.
//
// Source (OmniRoute c71f0065 handlers/imageUpscale/shared.ts
// saveUpscaleSuccessResult): `{ created, data: [...], upscale: meta }`, shaped
// like /v1/images/generations so image clients need no changes. The source
// also wrote a call log; here the caller's usage path records `accounting`.
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { UPSCALE_MODALITY } from "./config.js";

/** `{ success, response, accounting, payload }` for one returned image. */
export function upscaleSuccess({ provider, model, images, meta, now = Date.now, accountingMeta = {} }) {
  const payload = { created: Math.floor(now() / 1000), data: images, upscale: { provider, model, ...meta } };
  const accounting = mediaAccounting(null, provider, UPSCALE_MODALITY);
  returnedImageUnits(accounting, payload);
  accounting.meta = { ...accounting.meta, model, route: "/v1/images/upscale", ...accountingMeta };
  return {
    success: true,
    accounting,
    payload,
    response: new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}
