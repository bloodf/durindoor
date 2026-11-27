/**
 * #2309 items 2-3:
 * (a) chatplayground, zcode and cloudflare-playground have one canonical source
 *     (registered once in open-sse/providers/registry, not duplicated in
 *     open-sse/providers/private or staged manifests).
 * (b) Per-provider constant modules in open-sse/config/ live with their
 *     registry entries and the old config paths re-export them; providers.js
 *     and models.js stay in place.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { STAGED_PROVIDERS } from "../../open-sse/providers/staged.js";
import { hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import executorManifest from "../../open-sse/executors/staged.json";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SINGLE_SOURCE_PROVIDERS = ["chatplayground", "zcode", "cloudflare-playground"];

const MOVED_MODULES = [
  {
    configFile: "open-sse/config/bedrock.js",
    registryFile: "open-sse/providers/registry/bedrock.js",
    symbols: [
      "BEDROCK_DEFAULT_REGION",
      "normalizeBedrockRegion",
      "extractBedrockRegionFromBaseUrl",
      "resolveBedrockRegion",
      "buildBedrockRuntimeBaseUrl",
      "buildBedrockNativeConverseUrl",
      "BEDROCK_CREDENTIAL_MODE",
      "BEDROCK_PROFILE_PATTERN",
    ],
  },
  {
    configFile: "open-sse/config/cerebrium.js",
    registryFile: "open-sse/providers/registry/cerebrium.js",
    symbols: ["cerebriumBaseUrl"],
  },
  {
    configFile: "open-sse/config/commandcode.js",
    registryFile: "open-sse/providers/registry/commandcode.js",
    symbols: [
      "COMMANDCODE_MAX_TOKENS",
      "COMMANDCODE_PREFLIGHT_MAX_BYTES",
      "COMMANDCODE_PREFLIGHT_MAX_FRAMES",
      "COMMANDCODE_RATE_LIMIT_PATTERNS",
      "COMMANDCODE_OVERLOAD_PATTERNS",
    ],
  },
  {
    configFile: "open-sse/config/jev.js",
    registryFile: "open-sse/providers/registry/typesafe.js",
    symbols: [
      "JEV_ENDPOINT_PATH",
      "JEV_DEFAULT_BASE",
      "JEV_DEFAULT_MODEL",
      "JEV_TIERS",
      "JEV_TIER_TO_TASK_LEVEL",
      "JEV_DEFAULT_CRITERIA",
      "JEV_DEFAULT_INSTRUCTIONS",
      "JEV_STATE_CHAR_BUDGET",
      "JEV_TIMEOUT_MS",
      "JEV_BREAKER_COOLDOWN_MS",
      "JEV_MIN_CONFIDENCE",
      "JEV_INPUT_PRICE_PER_MTOK",
      "JEV_OUTPUT_PRICE_PER_MTOK",
    ],
  },
  {
    configFile: "open-sse/config/laya.js",
    registryFile: "open-sse/providers/registry/laya.js",
    symbols: [
      "LAYA_PROVIDER_ID",
      "LAYA_DEFAULT_HOST",
      "LAYA_HEALTH_PATH",
      "LAYA_CHECKPOINTS",
      "LAYA_TIMEOUT_MS",
      "LAYA_MIN_CONFIDENCE",
      "resolveLayaHost",
      "resolveLayaCheckpoint",
    ],
  },
  {
    configFile: "open-sse/config/museCode.js",
    registryFile: "open-sse/providers/registry/muse-code.js",
    symbols: [
      "MUSE_CODE_USER_AGENT",
      "MUSE_CODE_INFERENCE_USER_AGENT",
      "MUSE_CODE_DEVICE_CODE_URL",
      "MUSE_CODE_TOKEN_URL",
      "MUSE_CODE_MINT_URL",
      "MUSE_CODE_RESPONSES_URL",
      "MUSE_CODE_DEVICE_GRANT",
      "MUSE_CODE_DEFAULT_POLL_INTERVAL_SEC",
      "META_MODEL_API_BASE_URL",
      "META_MODEL_API_RESPONSES_URL",
      "META_MODEL_API_MODELS_URL",
      "MUSE_CODE_CLIENT_IDENTITY_HEADERS",
      "MUSE_CODE_ATTESTATION_DENIED",
      "MUSE_CODE_ATTESTATION_DENIED_MESSAGE",
      "isMuseAttestationDenied",
      "museCodeHeaders",
      "isMuseDcaToken",
    ],
  },
  {
    configFile: "open-sse/config/freebuff.js",
    registryFile: "open-sse/providers/registry/freebuff.js",
    symbols: [
      "FREEBUFF_API_BASE",
      "FREEBUFF_OPT_IN_KEY",
      "FREEBUFF_OAUTH",
      "freebuffCookieProfile",
      "freebuffConnectionOptIn",
      "FREEBUFF_AGENT_BY_MODEL",
      "FREEBUFF_MODELS",
    ],
  },
  {
    configFile: "open-sse/config/github.js",
    registryFile: "open-sse/providers/registry/github.js",
    symbols: [
      "GITHUB_CLAUDE_MAX_PROMPT_TOKENS",
      "GITHUB_COUNT_TOKENS_PREFLIGHT_RATIO",
      "GITHUB_COUNT_TOKENS_TIMEOUT_MS",
      "GITHUB_MESSAGES_BODY_FIELDS",
    ],
  },
  {
    configFile: "open-sse/config/gheCopilot.js",
    registryFile: "open-sse/providers/registry/ghe-copilot.js",
    symbols: [
      "normalizeGheUrl",
      "resolveGheCopilotApiBase",
      "gheCopilotTokenUrl",
      "gheOAuthTokenUrl",
    ],
  },
  {
    configFile: "open-sse/config/grokCli.js",
    registryFile: "open-sse/providers/registry/grok-cli.js",
    symbols: [
      "GROK_CLI_VERSION",
      "GROK_CLI_SHELL_USER_AGENT",
      "GROK_CLI_PAGER_USER_AGENT",
    ],
  },
  {
    configFile: "open-sse/config/copilotM365.js",
    registryFile: "open-sse/providers/registry/copilot-m365-web.js",
    symbols: [
      "M365_PROVIDER_ID",
      "M365_LOGIN_ORIGIN",
      "M365_NATIVE_REDIRECT_URI",
      "M365_OAUTH_SCOPE",
      "M365_CONSUMER_TENANT_ID",
      "isM365Guid",
      "getM365ClientId",
      "M365_OAUTH_CONFIG",
      "m365TokenUrl",
      "M365_IMAGE_ARTIFACT_SCOPE",
    ],
  },
  {
    configFile: "open-sse/config/googleTtsLanguages.js",
    registryFile: "open-sse/providers/registry/google-tts.js",
    symbols: ["GOOGLE_TTS_LANGUAGES"],
  },
  {
    configFile: "open-sse/config/openrouterRouting.js",
    registryFile: "open-sse/providers/registry/openrouter.js",
    symbols: [
      "OPENROUTER_QUANTIZATIONS",
      "OPENROUTER_PRECISION_PRESETS",
      "OPENROUTER_QUANTIZATION_FAMILIES",
      "OPENROUTER_UNDISCLOSED_PRECISION_MODELS",
      "OPENROUTER_ROUTING_ENDPOINTS",
    ],
  },
  {
    configFile: "open-sse/config/ollamaModels.js",
    registryFile: "open-sse/providers/registry/ollama-local.js",
    symbols: ["ollamaModels"],
  },
  {
    configFile: "open-sse/config/kiroClient.js",
    registryFile: "open-sse/providers/registry/kiro.js",
    symbols: [
      "KIRO_IDE_VERSION",
      "KIRO_RUNTIME_SDK_VERSION",
      "KIRO_AGENT_OS",
      "KIRO_AGENT_OS_VERSION",
      "KIRO_NODE_VERSION",
    ],
  },
  {
    configFile: "open-sse/config/kiroRegions.js",
    registryFile: "open-sse/providers/registry/kiro.js",
    symbols: [
      "KIRO_DEFAULT_REGION",
      "normalizeKiroRegion",
      "regionFromProfileArn",
      "resolveKiroRegion",
      "buildKiroBaseUrls",
      "buildKiroProfileEndpoint",
      "buildKiroOidcEndpoint",
      "alignProfileArnRegion",
    ],
  },
  {
    configFile: "open-sse/config/codexIdentity.js",
    registryFile: "open-sse/providers/registry/codex.js",
    symbols: [
      "CODEX_FINGERPRINT_MODES",
      "CODEX_FINGERPRINT_MODE_KEY",
      "readNamedHeader",
      "deriveStableUUIDv4",
      "accountSeed",
      "isCodexOAuthCredentials",
      "getCodexFingerprintMode",
      "createCodexClientIdentity",
      "resolveCodexOriginalIdentityHeaders",
      "applyCodexOriginalIdentityHeaders",
      "resolveCodexFingerprintIdentity",
      "withCodexFingerprintCredentials",
      "applyCodexClientIdentityHeaders",
      "applyCodexClientMetadata",
    ],
  },
  {
    configFile: "open-sse/config/codexInstructions.js",
    registryFile: "open-sse/providers/registry/codex.js",
    symbols: ["CODEX_DEFAULT_INSTRUCTIONS"],
  },
  {
    configFile: "open-sse/config/codexClientVersion.js",
    registryFile: "open-sse/providers/registry/codex.js",
    symbols: ["getCodexClientVersionFromHeaders", "meetsMinimalCodexClientVersion"],
  },
];

describe("#2309 item 2: single provider source", () => {
  it("gives chatplayground, zcode, and cloudflare-playground exactly one source in the registry", () => {
    const manifestIds = new Set(
      executorManifest.modules.map(({ catalogProvider, module }) => catalogProvider || path.basename(module, ".js")),
    );
    const privateFiles = fs.readdirSync(path.join(ROOT, "open-sse/providers/private"), {
      recursive: true,
      withFileTypes: true,
    });
    const privateDefinitions = new Set(
      privateFiles
        .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
        .filter((entry) => /export\s+default\b/.test(fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8")))
        .map((entry) => path.basename(entry.name).replace(/\.[cm]?js$/, "")),
    );

    for (const id of SINGLE_SOURCE_PROVIDERS) {
      const regMatches = REGISTRY.filter((entry) => entry.id === id);
      expect(regMatches, `${id} in REGISTRY`).toHaveLength(1);
      expect(fs.existsSync(path.join(ROOT, `open-sse/providers/registry/${id}.js`)), `${id} file`).toBe(true);
      expect(hasSpecializedExecutor(id), `${id} executor`).toBe(true);
      expect(STAGED_PROVIDERS[id], `${id} not in STAGED_PROVIDERS`).toBeUndefined();
      expect(manifestIds.has(id), `${id} not in staged.json`).toBe(false);
      expect(privateDefinitions.has(id), `${id} not in private/`).toBe(false);
    }
  });

  it("keeps STAGED_PROVIDERS and staged.json aligned without duplicating private definitions", () => {
    const manifestIds = executorManifest.modules.map(({ module }) => path.basename(module, ".js")).sort();
    expect(Object.keys(STAGED_PROVIDERS).sort()).toEqual(manifestIds);
    for (const id of manifestIds) {
      expect(STAGED_PROVIDERS[id]?.staged, id).toBe(true);
      expect(hasSpecializedExecutor(id), id).toBe(false);
    }
  });
});

describe("#2309 item 3: per-provider constants live with registry entries", () => {
  it.each(MOVED_MODULES)("$configFile re-exports moved symbols from $registryFile", async ({ configFile, registryFile, symbols }) => {
    const configSource = fs.readFileSync(path.join(ROOT, configFile), "utf8");
    const registryRel = path.posix.relative("open-sse/config", registryFile);
    expect(configSource).toContain(`from "${registryRel}"`);
    expect(configSource).not.toMatch(/\bexport\s+(?:const|let|var|function)\b/);

    const configMod = await import(path.join(ROOT, configFile));
    const registryMod = await import(path.join(ROOT, registryFile));
    for (const sym of symbols) {
      expect(registryMod[sym], `${registryFile}:${sym}`).toBeDefined();
      expect(configMod[sym], `${configFile}:${sym}`).toBe(registryMod[sym]);
    }
  });

  it("re-exports pure Kiro constants from open-sse/providers/registry/kiro.js via kiroConstants.js", async () => {
    const kiroReg = await import(path.join(ROOT, "open-sse/providers/registry/kiro.js"));
    const kiroConstants = await import(path.join(ROOT, "open-sse/config/kiroConstants.js"));
    for (const sym of [
      "KIRO_TOOL_CALL_REPAIR_INSTRUCTION",
      "KIRO_MAX_TOOL_CALL_REPAIR_ATTEMPTS",
      "KIRO_MAX_TOOL_CALL_WRAPPER_BYTES",
      "KIRO_UNSUPPORTED_SCHEMA_KEYS",
      "normalizeKiroToolSchema",
      "KIRO_DEFAULT_PROFILE_ARNS",
      "KIRO_DEFAULT_PROFILE_ARN",
      "resolveDefaultProfileArn",
      "KIRO_UNSUPPORTED_THINKING_FIELDS",
      "KIRO_AGENTIC_SYSTEM_PROMPT",
      "resolveKiroModel",
      "buildThinkingSystemPrefix",
    ]) {
      expect(kiroReg[sym], `registry/kiro.js:${sym}`).toBeDefined();
      expect(kiroConstants[sym], `config/kiroConstants.js:${sym}`).toBe(kiroReg[sym]);
    }
  });

  it("removes reverse config imports from registry entries and keeps providers.js/models.js in place", () => {
    for (const regFile of [
      "open-sse/providers/registry/freebuff.js",
      "open-sse/providers/registry/github.js",
      "open-sse/providers/registry/grok-cli.js",
      "open-sse/providers/registry/muse-code.js",
    ]) {
      const source = fs.readFileSync(path.join(ROOT, regFile), "utf8");
      expect(source, regFile).not.toMatch(/from\s+["']\.\.\/\.\.\/config\//);
    }
    expect(fs.existsSync(path.join(ROOT, "open-sse/config/providers.js"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "open-sse/config/models.js"))).toBe(true);
  });
});
