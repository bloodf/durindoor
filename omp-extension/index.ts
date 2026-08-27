import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { isBoolean, isNumber, isObject, isString } from "../src/shared/utils/typeChecks.js";

type ProviderModel = NonNullable<Parameters<ExtensionAPI["registerProvider"]>[1]["models"]>[number];
type OmpModel = ProviderModel & { supportsTools: boolean };
type Effort = NonNullable<NonNullable<ProviderModel["thinking"]>["efforts"]>[number];

/** Capability fields DurinDoor exposes on gateway model metadata. */
type CapabilityBag = {
  reasoning?: boolean;
  thinkingFormat?: string;
  thinkingCanDisable?: boolean;
  contextWindow?: number;
  maxOutput?: number;
  vision?: boolean;
  tools?: boolean;
};

/** One `/models` row before capability parsing. */
type GatewayModelEntry = {
  id: string;
  capabilities: CapabilityBag;
};

const EFFORT = {
  // SAFETY: Effort tokens are the fixed omp effort literals from ProviderModel.
  minimal: "minimal" as Effort,
  // SAFETY: Effort tokens are the fixed omp effort literals from ProviderModel.
  low: "low" as Effort,
  // SAFETY: Effort tokens are the fixed omp effort literals from ProviderModel.
  medium: "medium" as Effort,
  // SAFETY: Effort tokens are the fixed omp effort literals from ProviderModel.
  high: "high" as Effort,
  // SAFETY: Effort tokens are the fixed omp effort literals from ProviderModel.
  xhigh: "xhigh" as Effort,
  // SAFETY: Effort tokens are the fixed omp effort literals from ProviderModel.
  max: "max" as Effort,
};

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const GATEWAY_THINKING_COMPAT: OmpModel["compat"] = { thinkingFormat: "openai" };

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

function positiveNumber(value: JsonScalar | undefined): value is number {
  return isNumber(value) && Number.isFinite(value) && value > 0;
}

/** omp sends OpenAI reasoning fields; DurinDoor translates them to each model's native thinking format. */
function thinkingCompat(capabilities: CapabilityBag): OmpModel["compat"] {
  return capabilities.reasoning === true ? GATEWAY_THINKING_COMPAT : undefined;
}

function effortsForThinkingFormat(format: string): readonly Effort[] | null {
  switch (format) {
    case "openai":
      return [EFFORT.minimal, EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.xhigh];
    case "commandcode":
      return [EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.xhigh, EFFORT.max];
    case "claude-adaptive":
      return [EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.max];
    case "claude-budget":
      return [EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.xhigh, EFFORT.max];
    case "gemini-level":
      return [EFFORT.minimal, EFFORT.low, EFFORT.medium, EFFORT.high];
    case "gemini-budget":
      return [EFFORT.low, EFFORT.medium, EFFORT.high];
    case "zai":
      return [EFFORT.low];
    case "qwen":
      return [EFFORT.low, EFFORT.medium, EFFORT.high];
    case "kimi":
      return [EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.max];
    case "deepseek":
      return [EFFORT.high, EFFORT.max];
    case "minimax":
      return [EFFORT.low];
    case "hunyuan":
      return [EFFORT.low, EFFORT.medium, EFFORT.high];
    case "step":
      return [EFFORT.low, EFFORT.medium, EFFORT.high];
    default:
      return null;
  }
}

/** Maps exact gateway model contracts before falling back to format-level effort support. */
function thinkingConfig(modelId: string, capabilities: CapabilityBag): OmpModel["thinking"] {
  if (capabilities.reasoning !== true) return undefined;
  const bareModelId = modelId.toLowerCase().split("/").at(-1);
  const format = capabilities.thinkingFormat;
  let efforts: readonly Effort[] = [EFFORT.low, EFFORT.medium, EFFORT.high];
  if (bareModelId === "k3") {
    efforts = [EFFORT.low, EFFORT.high, EFFORT.max];
  } else if (
    bareModelId?.includes("gpt-5.6-sol") ||
    bareModelId?.includes("gpt-5.6-terra") ||
    bareModelId?.includes("gpt-5.6-luna")
  ) {
    efforts = [EFFORT.minimal, EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.xhigh, EFFORT.max];
  } else if (isString(format)) {
    const mapped = effortsForThinkingFormat(format);
    if (mapped) efforts = mapped;
  }
  return {
    mode: "effort",
    efforts,
    ...(isBoolean(capabilities.thinkingCanDisable) && {
      requiresEffort: !capabilities.thinkingCanDisable,
    }),
  };
}

function readJsonRecord(value: JsonValue): { [key: string]: JsonValue } | null {
  if (!isObject(value) || value === null || Array.isArray(value)) return null;
  return value;
}

function readCapabilityBag(value: JsonValue): CapabilityBag | null {
  const record = readJsonRecord(value);
  if (!record) return null;
  const out: CapabilityBag = {};
  if (isBoolean(record.reasoning)) out.reasoning = record.reasoning;
  if (isString(record.thinkingFormat)) out.thinkingFormat = record.thinkingFormat;
  if (isBoolean(record.thinkingCanDisable)) out.thinkingCanDisable = record.thinkingCanDisable;
  if (isNumber(record.contextWindow)) out.contextWindow = record.contextWindow;
  if (isNumber(record.maxOutput)) out.maxOutput = record.maxOutput;
  if (isBoolean(record.vision)) out.vision = record.vision;
  if (isBoolean(record.tools)) out.tools = record.tools;
  return out;
}

function readGatewayModelEntry(value: JsonValue): GatewayModelEntry | null {
  const record = readJsonRecord(value);
  if (!record || !isString(record.id)) return null;
  const capabilities = readCapabilityBag(record.capabilities ?? null);
  if (!capabilities) return null;
  return { id: record.id, capabilities };
}

/** Maps DurinDoor capability metadata to omp's model budget and feature fields. */
export function mapDurinDoorModels(entries: readonly GatewayModelEntry[]) {
  const models: OmpModel[] = [];
  let skipped = 0;

  for (const entry of entries) {
    const { capabilities } = entry;
    if (!positiveNumber(capabilities.contextWindow) || !positiveNumber(capabilities.maxOutput)) {
      skipped++;
      continue;
    }

    const compat = thinkingCompat(capabilities);
    const thinking = thinkingConfig(entry.id, capabilities);
    models.push({
      id: entry.id,
      name: entry.id,
      reasoning: capabilities.reasoning === true,
      input: capabilities.vision === true ? ["text", "image"] : ["text"],
      supportsTools: capabilities.tools === true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: capabilities.contextWindow,
      maxTokens: capabilities.maxOutput,
      ...(compat && { compat }),
      ...(thinking && { thinking }),
    });
  }

  return { models, skipped };
}

/** Reads non-empty DurinDoor settings from omp's process environment without exposing secret material. */
function environmentString(key: "DURINDOOR_BASE_URL" | "DURINDOOR_API_KEY", fallback?: string): string | undefined {
  const value = process.env[key];
  return isString(value) && value.trim() ? value.trim() : fallback;
}

function parseModelsPayload(payload: JsonValue): GatewayModelEntry[] {
  const record = readJsonRecord(payload);
  if (!record || !Array.isArray(record.data)) {
    throw new Error("GET /models returned malformed JSON");
  }
  const entries: GatewayModelEntry[] = [];
  for (const item of record.data) {
    const entry = readGatewayModelEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Fetches current gateway metadata and atomically replaces omp's in-memory DurinDoor provider. */
async function refresh(pi: ExtensionAPI): Promise<void> {
  try {
    const baseUrl = environmentString("DURINDOOR_BASE_URL", DEFAULT_BASE_URL)!;
    const apiKey = environmentString("DURINDOOR_API_KEY");
    pi.logger.debug("DurinDoor API key configuration", { found: Boolean(apiKey) });
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    if (!response.ok) throw new Error(`GET /models returned HTTP ${response.status}`);

    const rawJson: JsonValue | null = await response.json().then((body) => {
      if (isObject(body) || Array.isArray(body) || body === null || isString(body) || isNumber(body) || isBoolean(body)) {
        // SAFETY: fetch JSON is a JSON value; helpers above accept the JSON domain.
        return body as JsonValue;
      }
      return null;
    });
    if (rawJson === null) throw new Error("GET /models returned malformed JSON");

    const parsedEntries = parseModelsPayload(rawJson);
    const { models, skipped } = mapDurinDoorModels(parsedEntries);
    if (models.length === 0) {
      pi.logger.warn("DurinDoor model refresh returned no usable models", { skipped });
      return;
    }
    pi.registerProvider("durindoor", {
      baseUrl,
      // omp's OpenAI transport recognizes N/A as its no-auth sentinel and omits Authorization.
      apiKey: apiKey ?? "N/A",
      ...(apiKey && { authHeader: true }),
      // omp always speaks Chat Completions to DurinDoor; gateway is the translation boundary for each upstream transport.
      api: "openai-completions",
      models,
    });
    pi.logger.info("DurinDoor models refreshed", { registered: models.length, skipped });
  } catch (error) {
    pi.logger.warn("DurinDoor model refresh failed; continuing without gateway models", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export default function durindoorExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async () => refresh(pi));
  pi.registerCommand("durindoor-refresh", {
    description: "Refresh models from DurinDoor",
    handler: async () => refresh(pi),
  });
}
