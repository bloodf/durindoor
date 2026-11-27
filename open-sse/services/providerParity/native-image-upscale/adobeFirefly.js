// Adobe Firefly upscale: precise unavailable disposition.
//
// Source (OmniRoute c71f0065 handlers/imageUpscale/adobeFirefly.ts and
// config/upscaleRegistry.ts `adobe-firefly` alias `firefly`, models topaz,
// topaz-standard, topaz-bloom): resolve a firefly.adobe.com session (JWT +
// Cookie → ARP), upload the source to firefly-3p /v2/storage/image, POST
// /v2/3p-images/upsample and poll the BKS result link.
//
// DurinDoor keeps the consumer `adobe-firefly` / `firefly` identity
// unregistered (docs/providers/adobe-firefly.md) and accepts no Firefly web
// cookie, web-app token or ARP session; the established guard is not
// bypassed, and an `adobe-firefly-api` Services credential is not presented
// as a consumer session. The Firefly Services API this gateway does support
// (open-sse/providers/registry/adobe-firefly-api.js, pinned OpenAPI:
// images/generate-async, status, cancel, videos/generate) documents no
// upscale operation equivalent to the source's Topaz upsample job. Both
// therefore answer the same fixed 501 before any credential is read or any
// request is sent, and the rows are not listed in the active catalog.
import { createErrorResult } from "../../../utils/error.js";
import { ADOBE_FIREFLY_DISPOSITION } from "./config.js";

/** The unavailable result for a `consumer` or `services` Firefly request. */
export function adobeFireflyUpscaleUnavailable(kind) {
  const message = kind === "services" ? ADOBE_FIREFLY_DISPOSITION.services : ADOBE_FIREFLY_DISPOSITION.consumer;
  return { ...createErrorResult(ADOBE_FIREFLY_DISPOSITION.status, message), unavailable: true };
}
