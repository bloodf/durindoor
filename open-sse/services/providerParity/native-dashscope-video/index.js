// Staged, unregistered DashScope video credential variants (#2034): qwen-cloud,
// qwen-cloud-token-plan and bailian-coding-plan. Nothing in production imports
// this module yet; ./registration.json describes the serial registration step.
// Source attribution is in ./config.js.
import { createDashscopeVariantVideoAdapter } from "./adapter.js";
import { DASHSCOPE_VIDEO_PROVIDER_IDS } from "./config.js";

export * from "./config.js";
export { createDashscopeVariantVideoAdapter } from "./adapter.js";
export { buildDashscopeVariantVideoRequest, isDashscopeVariantVideoModel } from "./request.js";
export {
  runDashscopeVariantVideoJob,
  dashscopeVariantAcceptedJob,
  dashscopeVariantConnectionMismatch,
  resolveDashscopeVideoPolling,
  DASHSCOPE_VIDEO_POLL_INTERVAL_MS,
  DASHSCOPE_VIDEO_TIMEOUT_MS,
  DASHSCOPE_VIDEO_SUBMIT_TIMEOUT_MS,
  DASHSCOPE_VIDEO_REQUEST_TIMEOUT_MS,
} from "./job.js";

/** Default instances for VIDEO_GENERATION_ADAPTERS, one per canonical id. */
export const qwenCloudVideoAdapter = createDashscopeVariantVideoAdapter("qwen-cloud");
export const qwenCloudTokenPlanVideoAdapter = createDashscopeVariantVideoAdapter("qwen-cloud-token-plan");
export const bailianCodingPlanVideoAdapter = createDashscopeVariantVideoAdapter("bailian-coding-plan");

/**
 * Region-parity instances (#2034), keyed by canonical id: the connection's
 * source region selects the identity's own fixed regional host. These are
 * what the serial registration step wires into VIDEO_GENERATION_ADAPTERS.
 */
export const dashscopeRegionalVideoAdapters = Object.freeze(Object.fromEntries(
  DASHSCOPE_VIDEO_PROVIDER_IDS.map((id) => [id, createDashscopeVariantVideoAdapter(id, { regional: true })]),
));
