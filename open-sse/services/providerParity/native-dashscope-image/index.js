// Staged, unregistered DashScope native image adapters for the alibaba,
// qwen-cloud, qwen-cloud-token-plan and bailian-coding-plan connections
// (#2034). Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createDashscopeImageAdapter } from "./image.js";

export * from "./config.js";
export {
  buildDashscopeImageRequest, createDashscopeImageAdapter, dashscopeImageAcceptedJob, dashscopeImageAccounting,
  dashscopeImageIdentity, dashscopePublicUrl, isDashscopeImageRegionSupported, normalizeDashscopeImageItems,
  resolveDashscopeImageCredential, resolveDashscopeImageModel,
} from "./image.js";

/** Default instances, one per IMAGE_ADAPTERS key. */
export const alibabaImageAdapter = createDashscopeImageAdapter("alibaba");
export const qwenCloudImageAdapter = createDashscopeImageAdapter("qwen-cloud");
export const qwenCloudTokenPlanImageAdapter = createDashscopeImageAdapter("qwen-cloud-token-plan");
export const bailianCodingPlanImageAdapter = createDashscopeImageAdapter("bailian-coding-plan");
