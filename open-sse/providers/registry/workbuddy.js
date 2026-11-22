import { isObject } from "../../../src/shared/utils/typeChecks.js";
// OmniRoute release/v3.8.55, open-sse/config/providers/registry/workbuddy/index.ts.
export const clientHeaders = Object.freeze({
  "User-Agent": "WorkBuddy/5.5.6", "X-Product": "SaaS", "X-IDE-Type": "WorkBuddy",
  "X-IDE-Name": "WorkBuddy", "X-IDE-Version": "5.5.6", "X-Requested-With": "XMLHttpRequest",
  "X-Domain": "www.workbuddy.ai",
});
// The pinned upstream uses device authorization, not a cookie-based session.
export const cookieCaptureProfile = Object.freeze({ origin: "https://www.workbuddy.ai", domains: ["www.workbuddy.ai"], cookieNames: [], validationProbe: null });
export const modelsConfig = {
  url: "https://www.workbuddy.ai/v3/config", method: "GET", headers: clientHeaders,
  authHeader: "Authorization", authPrefix: "Bearer ",
  parseResponse(payload) {
    const models = payload?.data?.models;
    const entries = Array.isArray(models) ? models : models && isObject(models) ? Object.entries(models).map(([id, value]) => ({ ...value, id })) : [];
    return entries.filter((model) => model?.id && !model.tags?.some((tag) => /(?:image|video)/i.test(tag)))
      .map((model) => ({ id: model.id, name: model.name || model.id, owned_by: "workbuddy" }));
  },
};
export default {
  id: "workbuddy", alias: "wb", display: { name: "WorkBuddy", icon: "hub", color: "#315efb", textIcon: "WB", website: "https://www.workbuddy.ai" },
  category: "oauth", authType: "oauth", hasOAuth: true, authModes: ["oauth"], serviceKinds: ["llm"], models: [], passthroughModels: true,
  transport: { baseUrl: "https://www.workbuddy.ai/v2/chat/completions", format: "openai", executor: "workbuddy", forceStream: true,
    headers: { ...clientHeaders, "X-Agent-Intent": "craft", "X-Agent-Purpose": "conversation", "X-Agent-Type": "main" } },
};
