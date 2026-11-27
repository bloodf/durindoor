// DashScope video credential variants, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts, the `qwen-cloud`, `qwen-cloud-token-plan`
// and `bailian-coding-plan` entries (id, alias, baseUrl, statusUrl, authType
// "apikey", authHeader "bearer", format "dashscope-video", models), dispatched
// by open-sse/handlers/videoGeneration.ts to
// open-sse/handlers/videoGeneration/dashscopeHandler.ts
// (handleDashscopeVideoGeneration). The source keeps the three identities
// apart: "Bailian Coding Plan, regular Qwen Cloud, and Qwen Cloud Token Plan
// intentionally share wire helpers only; their model lists and connections
// stay isolated." So does this module: each identity has its own fixed origin,
// its own model list, and only its own selected connection's key.
//
// Not ported: the source's resolveAlibabaProviderMediaBaseUrl
// (src/shared/constants/alibabaProviderRegions.ts) region selector and custom
// connection base URLs. Only the pinned registry hosts are used; a connection
// that declares another region or base URL is refused before any request, so
// its key never goes to a host it was not issued for.

/** Source registry entries, verbatim where they are wire facts. */
export const DASHSCOPE_VIDEO_IDENTITIES = Object.freeze({
  "qwen-cloud": Object.freeze({
    id: "qwen-cloud",
    alias: "qwc",
    origin: "https://dashscope-intl.aliyuncs.com",
    baseUrl: "https://dashscope-intl.aliyuncs.com/api/v1",
    statusUrl: "https://dashscope-intl.aliyuncs.com/api/v1/tasks",
    authType: "apikey",
    authHeader: "bearer",
    format: "dashscope-video",
    label: "Qwen Cloud",
    // dashscopeHandler.ts buildAlibabaMediaPayload
    payloadBuilder: "alibaba-media",
    models: Object.freeze([
      Object.freeze({ id: "happyhorse-1.1-i2v", name: "HappyHorse 1.1 I2V" }),
      Object.freeze({ id: "happyhorse-1.1-t2v", name: "HappyHorse 1.1 T2V" }),
      Object.freeze({ id: "happyhorse-1.1-r2v", name: "HappyHorse 1.1 R2V" }),
      Object.freeze({ id: "happyhorse-1.0-video-edit", name: "HappyHorse 1.0 Video Edit" }),
      Object.freeze({ id: "wan2.7-t2v", name: "Wan 2.7 T2V" }),
      Object.freeze({ id: "wan2.7-i2v", name: "Wan 2.7 I2V" }),
      Object.freeze({ id: "wan2.7-r2v-2026-06-12", name: "Wan 2.7 R2V (2026-06-12)" }),
      Object.freeze({ id: "wan2.7-videoedit", name: "Wan 2.7 Video Edit" }),
    ]),
  }),
  "qwen-cloud-token-plan": Object.freeze({
    id: "qwen-cloud-token-plan",
    alias: "qct",
    origin: "https://token-plan.ap-southeast-1.maas.aliyuncs.com",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1",
    statusUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/tasks",
    authType: "apikey",
    authHeader: "bearer",
    format: "dashscope-video",
    label: "Qwen Cloud Token Plan",
    // dashscopeHandler.ts buildHappyHorsePayload
    payloadBuilder: "happyhorse",
    models: Object.freeze([
      Object.freeze({ id: "happyhorse-1.1-i2v", name: "HappyHorse 1.1 I2V" }),
      Object.freeze({ id: "happyhorse-1.1-t2v", name: "HappyHorse 1.1 T2V" }),
      Object.freeze({ id: "happyhorse-1.1-r2v", name: "HappyHorse 1.1 R2V" }),
    ]),
  }),
  "bailian-coding-plan": Object.freeze({
    id: "bailian-coding-plan",
    alias: "bcp",
    origin: "https://coding-intl.dashscope.aliyuncs.com",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/api/v1",
    statusUrl: "https://coding-intl.dashscope.aliyuncs.com/api/v1/tasks",
    authType: "apikey",
    authHeader: "bearer",
    format: "dashscope-video",
    label: "Alibaba Coding Plan",
    // dashscopeHandler.ts buildHappyHorsePayload
    payloadBuilder: "happyhorse",
    models: Object.freeze([
      Object.freeze({ id: "happyhorse-1.1-i2v", name: "HappyHorse 1.1 I2V" }),
      Object.freeze({ id: "happyhorse-1.1-t2v", name: "HappyHorse 1.1 T2V" }),
      Object.freeze({ id: "happyhorse-1.1-r2v", name: "HappyHorse 1.1 R2V" }),
    ]),
  }),
});

export const DASHSCOPE_VIDEO_PROVIDER_IDS = Object.freeze(Object.keys(DASHSCOPE_VIDEO_IDENTITIES));
export const DASHSCOPE_VIDEO_FORMAT = "dashscope-video";

/** The identity for a canonical provider id, or null. Aliases are not resolved here. */
export const dashscopeVideoIdentity = (providerId) =>
  Object.hasOwn(DASHSCOPE_VIDEO_IDENTITIES, providerId) ? DASHSCOPE_VIDEO_IDENTITIES[providerId] : null;

export const dashscopeVideoModelIds = (providerId) => dashscopeVideoIdentity(providerId)?.models.map((model) => model.id) ?? [];

export const dashscopeVideoSubmitUrl = (identity) => `${identity.baseUrl}/services/aigc/video-generation/video-synthesis`;
export const dashscopeVideoTaskUrl = (identity, taskId) => `${identity.statusUrl}/${encodeURIComponent(taskId)}`;

/** Connection regions the pinned hosts serve (the source's default "global-sg"). */
export const DASHSCOPE_VIDEO_ACCEPTED_REGIONS = Object.freeze(["global-sg"]);
