import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";

const PLAN_BODIES = [
  '{"code":11158,"msg":"model [gpt-6-luna] is not allowed for user type [personal_free_user]","displayMsg":{"en":"Your account type does not support this model.","zh":"当前账号类型暂不支持该模型。"}}',
  "当前账号类型暂不支持该模型。",
  "Your account type does not support this model.",
  '{"error":{"code":"MODEL_NOT_IN_PLAN","message":"Model not included in plan"}}',
  '{"code":14018,"msg":"credits exhausted"}',
  "额度已用尽",
];
const RESTRICTED_BODY = '{"code":11140,"msg":"request illegal","displayMsg":{"en":"Your account has been restricted due to unusual activity","zh":"账号存在异常行为，已被限制使用"}}';

// A catalog model: a 400 naming an unlisted id stays request-scoped (#2315).
const classify = (status, body, provider) => checkFallbackError(status, body, 0, provider, null, null, "glm-5.3");

describe("upstream 9router #5342: CodeBuddy plan restriction fallback", () => {
  describe.each(["codebuddy-cn", "codebuddy-intl"])("%s", (provider) => {
    it.each(PLAN_BODIES)("rotates with a 2m cooldown on a 400 plan or credit refusal: %s", (body) => {
      expect(classify(400, body, provider)).toMatchObject({ shouldFallback: true, cooldownMs: 120000 });
    });

    it("cools a restricted account down for 30 minutes", () => {
      expect(classify(403, RESTRICTED_BODY, provider)).toMatchObject({ shouldFallback: true, cooldownMs: 1800000 });
    });

    it("reads the refusal from an already parsed error body too", () => {
      const parsed = JSON.parse(PLAN_BODIES[0]);
      expect(checkFallbackError(400, PLAN_BODIES[0], 0, provider, null, parsed, "glm-5.3")).toMatchObject({ shouldFallback: true, cooldownMs: 120000 });
    });

    it.each([[400, PLAN_BODIES[0], 120000], [403, RESTRICTED_BODY, 1800000]])("classifies the message the live %d error path produces", async (status, body, cooldownMs) => {
      const parsed = await parseUpstreamError(new Response(body, { status }), getExecutor(provider));
      expect(checkFallbackError(parsed.statusCode, parsed.message, 0, provider, null, parsed.errorBody, "glm-5.3")).toMatchObject({ shouldFallback: true, cooldownMs });
    });

    it("keeps a refusal for an unlisted model id request-scoped", () => {
      expect(checkFallbackError(400, PLAN_BODIES[0], 0, provider, null, null, "not-in-catalog")).toMatchObject({ shouldFallback: false, requestScoped: true });
    });

    it("keeps an unrelated 400 request-scoped", () => {
      expect(classify(400, '{"code":11101,"msg":"invalid request"}', provider)).toMatchObject({ shouldFallback: false, requestScoped: true });
    });
  });

  it.each(PLAN_BODIES)("leaves other providers unchanged: %s", (body) => {
    expect(classify(400, body, "openai")).toMatchObject({ shouldFallback: false, requestScoped: true });
  });
});
