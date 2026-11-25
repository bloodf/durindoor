import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

// The body OpenRouter returns once no provider serves a model, as chatCore flattens it.
const REMOVED = '[404]: {"error":{"message":"vendor/retired-model:free is no longer available on OpenRouter: ' +
  'no provider serves this model anymore. See available models at https://openrouter.ai/models","code":404},"user_id":"user_fixture"}';

describe("OpenRouter removed-model 404", () => {
  it("does not cool the account down: every key gets the same answer", () => {
    expect(checkFallbackError(404, REMOVED, 0, "openrouter")).toEqual({
      shouldFallback: false, cooldownMs: 0, scope: null, requestScoped: true,
    });
  });

  it("stays scoped to OpenRouter and to status 404", () => {
    expect(checkFallbackError(404, REMOVED, 0, "other")).toMatchObject({ shouldFallback: true, cooldownMs: 120000 });
    expect(checkFallbackError(401, REMOVED, 0, "openrouter")).toMatchObject({ shouldFallback: true, cooldownMs: 120000 });
  });
});
