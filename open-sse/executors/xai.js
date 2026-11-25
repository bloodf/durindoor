import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";
import { nestResponsesReasoningEffort } from "../translator/concerns/responsesReasoning.js";
import { isObject, isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { createHash } from "node:crypto";

const XAI_RESPONSE_TOOLS = new Set(["web_search", "x_search", "image_generation", "collections_search", "file_search", "code_execution", "code_interpreter", "mcp", "shell", "tool_search"]);

/** Normalize Chat content and tool declarations accepted by xAI Responses. */
function normalizeResponses(body) {
  if (Array.isArray(body.input)) body.input = body.input.map((item) => {
    if (!isObject(item) || !Array.isArray(item.content)) return item;
    return { ...item, content: item.content.map((part) => {
      if (!isObject(part)) return part;
      if (part.type === "text") return { ...part, type: item.role === "assistant" ? "output_text" : "input_text" };
      if (part.type === "image_url") return { type: "input_image", image_url: isObject(part.image_url) ? part.image_url.url : part.image_url };
      return part;
    }) };
  });
  if (Array.isArray(body.tools)) {
    const tools = [];
    const names = new Set();
    const pending = [...body.tools];
    for (const tool of pending) {
      if (!isObject(tool)) continue;
      if (tool.type === "namespace") {
        const namespace = isString(tool.name) ? tool.name : "";
        for (const child of Array.isArray(tool.tools) ? tool.tools : []) {
          if (!isObject(child)) continue;
          const fn = isObject(child.function) ? child.function : child;
          if (!isString(fn.name) || !fn.name.trim()) continue;
          const leaf = fn.name.trim();
          let name = !namespace || namespace === "functions" || leaf.includes("__") ? leaf : `${namespace}${namespace.endsWith("__") ? "" : "__"}${leaf}`;
          if (name.length > 64) name = `${name.slice(0, 56)}_${createHash("sha256").update(name).digest("hex").slice(0, 7)}`;
          pending.push({ ...fn, type: "function", name });
        }
        continue;
      }
      if (tool.type === "custom" && isString(tool.name)) {
        pending.push({ type: "function", name: tool.name, description: tool.description, parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] } });
        continue;
      }
      if (!tool.type || tool.type === "function") {
        const fn = isObject(tool.function) ? tool.function : tool;
        if (!isString(fn.name) || !fn.name.trim() || names.has(fn.name.trim())) continue;
        const { name, description, parameters, strict } = fn;
        const normalized = { type: "function", name: name.trim() };
        if (isString(description)) normalized.description = description;
        if (parameters !== undefined) normalized.parameters = parameters;
        if (strict === true || strict === false) normalized.strict = strict;
        tools.push(normalized);
        names.add(name.trim());
      } else if (XAI_RESPONSE_TOOLS.has(tool.type)) {
        if (tool.type !== "web_search") { tools.push(tool); continue; }
        const { external_web_access, search_context_size, filters, ...search } = tool;
        if (isObject(filters)) {
          if (Array.isArray(filters.allowed_domains) && search.allowed_domains === undefined) search.allowed_domains = filters.allowed_domains;
          if (Array.isArray(filters.blocked_domains) && search.excluded_domains === undefined) search.excluded_domains = filters.blocked_domains;
        }
        tools.push(search);
      }
    }
    if (tools.length) body.tools = tools; else delete body.tools;
  }
  if (!Array.isArray(body.tools) || !body.tools.length) {
    delete body.tool_choice;
    delete body.parallel_tool_calls;
  }
}

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
    if (credentials?.runtimeTransport?.baseUrl) {
      return credentials.runtimeTransport.baseUrl;
    }
    if (getModelTargetFormat("xai", model) === "openai-responses" && this.config.responsesUrl) {
      return this.config.responsesUrl;
    }
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  transformRequest(model, body, stream, credentials) {
    const DENY_REASONING = ["grok-build", "grok-composer-2.5-fast", "non-reasoning"];
    const ALLOW_REASONING = ["grok-4", "grok-4.3", "grok-3"];

    let out = { ...body };
    // CLIProxyAPI xai_executor_request.go: Responses does not support stop.
    const responses = credentials?.runtimeTransport?.format === "openai-responses-oauth" ||
        getModelTargetFormat("xai", model) === "openai-responses";
    if (responses) {
      delete out.stop;
      delete out.stream_options;
      normalizeResponses(out);
    }
    const modelId = (out.model || model || "").toLowerCase();

    const effortLevels = ["none", "low", "medium", "high", "xhigh"];
    let modelEffort = null;
    for (const level of effortLevels) {
      if (out.model && out.model.endsWith(`-${level}`)) {
        modelEffort = level;
        out.model = out.model.slice(0, -level.length - 1);
        break;
      }
    }

    // grok-build-latest is a grok-4.5 alias and keeps its reasoning effort.
    const isDenied = !modelId.includes("grok-build-latest") && DENY_REASONING.some((m) => modelId.includes(m));
    const isAllowed = ALLOW_REASONING.some((m) => modelId.includes(m));

    if (isDenied) {
      delete out.reasoning_effort;
      delete out.reasoning;
    } else if (isAllowed && (body.reasoning_effort || modelEffort)) {
      out.reasoning_effort = body.reasoning_effort || modelEffort;
    }

    // xAI chat streams report actual usage only when explicitly requested.
    if (!responses && stream === true && (out.stream === undefined || out.stream === true) &&
        !credentials?.providerSpecificData?.disableStreamOptions) {
      out.stream = true;
      out.stream_options = isRecord(out.stream_options) ? { ...out.stream_options, include_usage: true } : { include_usage: true };
    } else {
      delete out.stream_options;
    }
    // API-key Responses clients take the "openai-responses" transport, not the OAuth one.
    return responses || credentials?.runtimeTransport?.format === "openai-responses" ?
      nestResponsesReasoningEffort(out) : out;
  }
}
