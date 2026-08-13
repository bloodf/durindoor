import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

type DurinDoorExtensionAPI = ExtensionAPI & {
  config?: { get(key: string): unknown };
};

type OmpModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  supportsTools: boolean;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  thinking?: {
    mode: "effort";
    efforts: readonly ("minimal" | "low" | "medium" | "high" | "xhigh" | "max")[];
    requiresEffort?: boolean;
  };
  compat?: { thinkingFormat: "openai" | "openrouter" | "zai" | "kimi" | "qwen" | "qwen-chat-template" };
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

const THINKING_EFFORTS = {
  openai: ["minimal", "low", "medium", "high", "xhigh"],
  commandcode: ["low", "medium", "high", "xhigh", "max"],
  "claude-adaptive": ["low", "medium", "high", "max"],
  "claude-budget": ["low", "medium", "high", "xhigh", "max"],
  "gemini-level": ["minimal", "low", "medium", "high"],
  "gemini-budget": ["low", "medium", "high"],
  zai: ["low"],
  qwen: ["low", "medium", "high"],
  kimi: ["low", "medium", "high", "max"],
  deepseek: ["high", "max"],
  minimax: ["low"],
  hunyuan: ["low", "medium", "high"],
  step: ["low", "medium", "high"],
} as const;

/** Maps DurinDoor's format-level effort surface; numeric budget clamping remains gateway-owned. */
function thinkingConfig(capabilities: Record<string, unknown>): OmpModel["thinking"] {
  if (capabilities.reasoning !== true) return undefined;
  const efforts =
    typeof capabilities.thinkingFormat === "string" && capabilities.thinkingFormat in THINKING_EFFORTS
      ? THINKING_EFFORTS[capabilities.thinkingFormat as keyof typeof THINKING_EFFORTS]
      : (["low", "medium", "high"] as const);
  return {
    mode: "effort",
    efforts,
    ...(typeof capabilities.thinkingCanDisable === "boolean" && {
      requiresEffort: true,
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

    const capabilities = entry.capabilities;
    if (!positiveNumber(capabilities.contextWindow) || !positiveNumber(capabilities.maxOutput)) {
      skipped++;
      continue;
    }

    const compat = thinkingCompat(capabilities);
    const thinking = thinkingConfig(capabilities);
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

function configuredString(pi: DurinDoorExtensionAPI, key: string, fallback?: string): string | undefined {
  const value = pi.config?.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
/** Fetches current gateway metadata and atomically replaces omp's in-memory DurinDoor provider. */
async function refresh(pi: DurinDoorExtensionAPI): Promise<void> {

  try {
    const baseUrl = configuredString(pi, "durindoor.baseUrl", DEFAULT_BASE_URL)!;
    const apiKey = configuredString(pi, "durindoor.apiKey");
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
      apiKey,
      // omp always speaks Chat Completions to DurinDoor; gateway is the translation boundary for each upstream transport.
      api: "openai-completions",
      authHeader: Boolean(apiKey),
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
  const api = pi as DurinDoorExtensionAPI;
  pi.on("session_start", async () => refresh(api));
  pi.registerCommand("durindoor-refresh", {
    description: "Refresh models from DurinDoor",
    handler: async () => refresh(api),
  });
}
