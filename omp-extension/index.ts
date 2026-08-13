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
  compat?: { thinkingFormat: "openai" | "openrouter" | "zai" | "qwen" | "qwen-chat-template" };
};

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const SUPPORTED_THINKING_FORMATS: Record<string, true> = {
  openai: true,
  openrouter: true,
  zai: true,
  qwen: true,
  "qwen-chat-template": true,
};

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function thinkingCompat(value: unknown): OmpModel["compat"] {
  if (typeof value !== "string" || !SUPPORTED_THINKING_FORMATS[value]) return undefined;
  return { thinkingFormat: value as NonNullable<OmpModel["compat"]>["thinkingFormat"] };
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

    const compat = thinkingCompat(capabilities.thinkingFormat);
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
