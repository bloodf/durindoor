import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";

export class XaiExecutor extends BaseExecutor {
  constructor() {
    super("xai", PROVIDERS.xai);
  }

  /**
   * Port of OmniRoute#6709 (decolua/9router#2439, author: @ryanngit): xAI
   * ships a native `/v1/responses` endpoint alongside `/v1/chat/completions`.
   * Models tagged `targetFormat: "openai-responses"` in the registry
   * (currently grok-4.20-multi-agent-0309) resolve to that endpoint instead
   * of the default chat-completions bridge. The per-model registry tag is
   * the single source of truth — chatCore translates the request body from
   * the same tag, so URL and translated body stay in lockstep.
   */
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (getModelTargetFormat("xai", model) === "openai-responses" && this.config.responsesUrl) {
      return this.config.responsesUrl;
    }
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  transformRequest(model, body) {
    const DENY_REASONING = ["grok-build", "grok-composer-2.5-fast"];
    const ALLOW_REASONING = ["grok-4", "grok-4.3", "grok-3"];

    let out = { ...body };
    const modelId = (out.model || model || "").toLowerCase();

    const effortLevels = ["none", "low", "medium", "high", "xhigh"];
    let modelEffort = null;
    for (const level of effortLevels) {
      if (out.model && out.model.endsWith(`-${level}`)) {
        modelEffort = level;
        out.model = out.model.replace(`-${level}`, "");
        break;
      }
    }

    const isDenied = DENY_REASONING.some((m) => modelId.includes(m));
    const isAllowed = ALLOW_REASONING.some((m) => modelId.includes(m));

    if (isDenied) {
      delete out.reasoning_effort;
    } else if (isAllowed && (body.reasoning_effort || modelEffort)) {
      out.reasoning_effort = body.reasoning_effort || modelEffort;
    }

    return out;
  }
}
