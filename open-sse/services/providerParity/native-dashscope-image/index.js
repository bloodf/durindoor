// Staged, unregistered DashScope native image adapters for the alibaba,
// qwen-cloud, qwen-cloud-token-plan and bailian-coding-plan connections
// (#2034). Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { DASHSCOPE_IMAGE_PROVIDER_IDS } from "./config.js";
import { createDashscopeImageAdapter } from "./image.js";

export * from "./config.js";
export * from "./regions.js";
export {
  buildDashscopeImageRequest, createDashscopeImageAdapter, dashscopeImageAcceptedJob, dashscopeImageAccounting,
  dashscopeImageIdentity, dashscopeImageUrl, dashscopePublicUrl, isDashscopeImageRegionSupported, normalizeDashscopeImageItems,
  resolveDashscopeImageCredential, resolveDashscopeImageModel,
} from "./image.js";

/** Pinned global-sg instances, one per identity (the first staging contract). */
export const alibabaImageAdapter = createDashscopeImageAdapter("alibaba");
export const qwenCloudImageAdapter = createDashscopeImageAdapter("qwen-cloud");
export const qwenCloudTokenPlanImageAdapter = createDashscopeImageAdapter("qwen-cloud-token-plan");
export const bailianCodingPlanImageAdapter = createDashscopeImageAdapter("bailian-coding-plan");

/**
 * Region-parity instances (#2034): the connection's source region selects the
 * identity's own fixed regional host (./regions.js). These are what the
 * serial registration step wires into IMAGE_ADAPTERS.
 */
export const dashscopeRegionalImageAdapters = Object.freeze(Object.fromEntries(
  DASHSCOPE_IMAGE_PROVIDER_IDS.map((id) => [id, createDashscopeImageAdapter(id, { regional: true })]),
));
