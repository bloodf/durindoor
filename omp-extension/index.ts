import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

type ProviderModel = NonNullable<Parameters<ExtensionAPI["registerProvider"]>[1]["models"]>[number];
type OmpModel = ProviderModel & { supportsTools: boolean };
type Effort = NonNullable<NonNullable<ProviderModel["thinking"]>["efforts"]>[number];

const EFFORT = {
  minimal: "minimal" as Effort,
  low: "low" as Effort,
  medium: "medium" as Effort,
  high: "high" as Effort,
  xhigh: "xhigh" as Effort,
  max: "max" as Effort,
};

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const GATEWAY_THINKING_COMPAT: OmpModel["compat"] = { thinkingFormat: "openai" };

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}


/** omp sends OpenAI reasoning fields; DurinDoor translates them to each model's native thinking format. */
function thinkingCompat(capabilities: Record<string, unknown>): OmpModel["compat"] {
  return capabilities.reasoning === true ? GATEWAY_THINKING_COMPAT : undefined;
}

const THINKING_EFFORTS: Record<string, readonly Effort[]> = {
  openai: [EFFORT.minimal, EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.xhigh],
  commandcode: [EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.xhigh, EFFORT.max],
  "claude-adaptive": [EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.max],
  "claude-budget": [EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.xhigh, EFFORT.max],
  "gemini-level": [EFFORT.minimal, EFFORT.low, EFFORT.medium, EFFORT.high],
  "gemini-budget": [EFFORT.low, EFFORT.medium, EFFORT.high],
  zai: [EFFORT.low],
  qwen: [EFFORT.low, EFFORT.medium, EFFORT.high],
  kimi: [EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.max],
  deepseek: [EFFORT.high, EFFORT.max],
  minimax: [EFFORT.low],
  hunyuan: [EFFORT.low, EFFORT.medium, EFFORT.high],
  step: [EFFORT.low, EFFORT.medium, EFFORT.high],
};

/** Maps exact gateway model contracts before falling back to format-level effort support. */
function thinkingConfig(modelId: string, capabilities: Record<string, unknown>): OmpModel["thinking"] {
  if (capabilities.reasoning !== true) return undefined;
  const bareModelId = modelId.toLowerCase().split("/").at(-1);
  const efforts =
    bareModelId === "kimi-k3"
      ? [EFFORT.max]
      : bareModelId?.includes("gpt-5.6-sol") || bareModelId?.includes("gpt-5.6-terra") || bareModelId?.includes("gpt-5.6-luna")
        ? [EFFORT.minimal, EFFORT.low, EFFORT.medium, EFFORT.high, EFFORT.xhigh, EFFORT.max]
        : typeof capabilities.thinkingFormat === "string" && capabilities.thinkingFormat in THINKING_EFFORTS
          ? THINKING_EFFORTS[capabilities.thinkingFormat]
          : [EFFORT.low, EFFORT.medium, EFFORT.high];
  return {
    mode: "effort",
    efforts,
    ...(typeof capabilities.thinkingCanDisable === "boolean" && {
      requiresEffort: !capabilities.thinkingCanDisable,
    }),
  };
}

/** Maps DurinDoor capability metadata to omp's model budget and feature fields. */
export function mapDurinDoorModels(entries: unknown[]): { models: OmpModel[]; skipped: number } {
  const models: OmpModel[] = [];
  let skipped = 0;

  for (const entry of entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !("capabilities" in entry) ||
      typeof entry.capabilities !== "object" ||
      entry.capabilities === null
    ) {
      skipped++;
      continue;
    }

    const capabilities = entry.capabilities as Record<string, unknown>;

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
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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

    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload) ||
      !Array.isArray(payload.data)
    ) {
      throw new Error("GET /models returned malformed JSON");
    }

    const { models, skipped } = mapDurinDoorModels(payload.data);
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
