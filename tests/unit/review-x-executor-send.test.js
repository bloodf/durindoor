import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { isObject } from "../../src/shared/utils/typeChecks.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { GitlabExecutor } from "../../open-sse/executors/gitlab.js";
import { MimocodeExecutor } from "../../open-sse/executors/mimocode.js";
import {
  runWithProviderAttemptContext,
  settleProviderAttemptDispatch
} from "../../open-sse/services/providerAttemptContext.js";

const { parse } = createRequire(new URL("../../package.json", import.meta.url))("@babel/parser");
const executorsDir = new URL("../../open-sse/executors/", import.meta.url);

const overrideAllowlist = {
  "adapta-web.js": "Adapta browser-session chat transport awaits migration.",
  "blackbox-web.js": "Blackbox has separate session, subscription, and chat requests.",
  "chatgpt-web-http.js": "ChatGPT Web owns its browser-session HTTP protocol.",
  "chatgpt-web.js": "Selects between browser and HTTP ChatGPT transports.",
  "chatplayground.js": "ChatPlayground owns its session and chat stream requests.",
  "claude-web.js": "Claude Web owns its organization and conversation requests.",
  "cliproxyapi.js": "Talks to an operator-managed CLIProxyAPI backend.",
  "cloudflare-playground.js": "Cloudflare Playground owns its session and inference requests.",
  "codex-app-server.js": "Uses the local Codex app server RPC transport.",
  "conol-web.js": "Conol creates sessions and resolves models before posting messages.",
  "copilot-m365-web.js": "Microsoft 365 Copilot owns its web-session conversation transport.",
  "copilot-web.js": "Copilot Web owns its web-session authentication and conversation transport.",
  "cursor.js": "Cursor owns its binary Agent and Chat protocol transports.",
  "deepseek-web.js": "DeepSeek Web manages session creation and proof of work.",
  "devin-cli-agentic.js": "Dispatches through the Devin CLI bridge.",
  "devin-cli.js": "Dispatches through the Devin CLI bridge.",
  "devin-desktop.js": "Owns the Devin Desktop session and agent transport.",
  "doubao-web.js": "Doubao owns its web-session chat transport.",
  "duckduckgo-web.js": "DuckDuckGo obtains a chat token before inference.",
  "freebuff.js": "Freebuff manages its Codebuff backend protocol.",
  "gemini-web.js": "Gemini Web uses browser-session RPC requests.",
  "grok-web.js": "Grok Web owns session chat and attachment requests.",
  "huggingchat.js": "HuggingChat creates conversations and handles its event protocol.",
  "hyperagent.js": "Hyperagent owns its session and agent message protocol.",
  "kimi-web.js": "Kimi Web uses its Connect RPC stream.",
  "lmarena.js": "Arena manages its browser-session inference transport.",
  "maxai.js": "MaxAI manages its web-session chat transport.",
  "mimo-free.js": "MiMo Free owns JWT bootstrap and its free chat transport.",
  "muse-spark-web.js": "Muse Spark owns its web-session streaming protocol.",
  "notion-web.js": "Notion Web owns its workspace and AI message protocol.",
  "notrack-web.js": "Notrack owns its web-session inference transport.",
  "oneminai.js": "1min.AI owns its feature- and model-specific requests.",
  "perplexity-web.js": "Perplexity owns its browser-session event transport.",
  "promptql.js": "PromptQL owns its conversation and streaming requests.",
  "qoder.js": "Qoder owns its queue submission, polling, and replay protocol.",
  "t3-chat-web.js": "T3 Chat owns its browser-session request and streaming protocol.",
  "tencent-aistudio-web.js": "Tencent AI Studio owns its web-session chat protocol.",
  "tinycms-web.js": "TinyCMS owns its browser-session chat transport.",
  "twinmind.js": "TwinMind handles credential refresh and its chat transport.",
  "unsupported-websession.js": "Returns a local unsupported-provider response.",
  "veoaifree-web.js": "Veo AI Free owns its job submission and polling protocol.",
  "vertex.js": "Vertex manages Google authentication and dynamic regional endpoints.",
  "windsurf.js": "Windsurf owns its binary Connect RPC transport.",
  "yuanbao-web.js": "Yuanbao owns its browser-session chat protocol.",
  "zed-hosted.js": "Zed manages LLM token acquisition and its completion transport.",
  "zenmux-free.js": "ZenMux Free owns its browser-session completion transport."
};

function* nodes(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* nodes(item);
  } else if (isObject(value) && value?.type) {
    yield value;
    for (const child of Object.values(value)) yield* nodes(child);
  }
}

function isCallTo(node, name) {
  return ["CallExpression", "OptionalCallExpression"].includes(node.type) &&
    (node.callee.name === name || node.callee.property?.name === name);
}

describe("executor send contract (#2308)", () => {
  it("requires each execute override to use the shared sender or have an explicit reason", () => {
    const missingSender = [];
    for (const name of readdirSync(executorsDir, { recursive: true }).sort()) {
      if (!name.endsWith(".js") || name === "base.js") continue;
      const source = parse(readFileSync(new URL(name, executorsDir), "utf8"), { sourceType: "module" }).program;
      const importsSender = source.body.some((node) =>
        node.type === "ImportDeclaration" && node.source.value.endsWith("/sendRequest.js"));
      const usesSendRequest = importsSender && [...nodes(source)].some((node) => isCallTo(node, "sendRequest"));
      for (const node of nodes(source)) {
        if (!["ClassMethod", "ClassProperty", "ObjectMethod"].includes(node.type) ||
            node.static || (node.key.name ?? node.key.value) !== "execute") continue;
        const body = [...nodes(node.body ?? node.value)];
        const delegates = body.some((child) => isCallTo(child, "execute") && child.callee.object?.type === "Super");
        const usesSender = usesSendRequest && body.some((child) =>
          isCallTo(child, "sendRequest") || isCallTo(child, "createExecutorSender"));
        if (!delegates && !usesSender) missingSender.push(name);
      }
    }
    expect(missingSender).toEqual(Object.keys(overrideAllowlist).sort());
    for (const reason of Object.values(overrideAllowlist)) expect(reason.trim()).not.toBe("");
  });

  const input = {
    model: "duo",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: { accessToken: "test-token", providerSpecificData: { baseUrl: "https://gitlab.test" } }
  };

  it("charges GitLab's send once and preserves the ticket after rewriting the response", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({ choices: [{ message: { content: "hi" } }] })
    );
    const restoreFetch = __setOriginalFetchForTesting(fetch);
    const ticket = { tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }) };
    const beginQuotaDispatch = vi.fn().mockResolvedValue(ticket);
    const onProviderAttempt = vi.fn().mockReturnValue(123);
    try {
      const result = await runWithProviderAttemptContext(onProviderAttempt,
        () => new GitlabExecutor().execute(input), { beginQuotaDispatch });
      expect(beginQuotaDispatch).toHaveBeenCalledOnce();
      expect(onProviderAttempt).toHaveBeenCalledOnce();
      expect(result.attemptStartedAt).toBe(123);
      expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
      await settleProviderAttemptDispatch(result.response, { success: true });
      expect(ticket.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
    } finally {
      restoreFetch();
    }
  });

  it("settles a discarded MiMo Code attempt before reserving the next chat send", async () => {
    const executor = new MimocodeExecutor();
    const credentials = { providerSpecificData: { fingerprints: ["quota-a", "quota-b"] } };
    executor.accounts.splice(0);
    executor.syncAccountsFromCredentials(credentials);
    for (const account of executor.accounts) {
      account.jwt = `token-${account.fingerprint}`;
      account.expiresAt = Date.now() + 3_600_000;
    }

    const rejected = { tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }) };
    const accepted = { tracked: true, settle: vi.fn().mockResolvedValue({ changed: true }) };
    const beginQuotaDispatch = vi.fn().mockResolvedValueOnce(rejected).mockImplementationOnce(async () => {
      expect(rejected.settle).toHaveBeenCalledWith({ success: false, reason: "fallback" });
      return accepted;
    });
    const fetch = vi.fn().mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok"));
    const restoreFetch = __setOriginalFetchForTesting(fetch);
    try {
      const result = await runWithProviderAttemptContext(
        vi.fn().mockReturnValueOnce(123).mockReturnValueOnce(124),
        () => executor.execute({ ...input, model: "mimo-auto", credentials }),
        { beginQuotaDispatch }
      );
      expect(beginQuotaDispatch).toHaveBeenCalledTimes(2);
      expect(result.response.status).toBe(200);
      expect(result.attemptStartedAt).toBe(124);
      await settleProviderAttemptDispatch(result.response, { success: true });
      expect(accepted.settle).toHaveBeenCalledWith({ success: true, reason: "success" });
    } finally {
      restoreFetch();
    }
  });

  it("skips pre-aborted sends and aborts a GitLab request that stalls before headers", async () => {
    const fetch = vi.fn((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));
    const restoreFetch = __setOriginalFetchForTesting(fetch);
    try {
      const executor = new GitlabExecutor();
      await expect(executor.execute({ ...input, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
      expect(fetch).not.toHaveBeenCalled();

      executor.config = { ...executor.config, timeoutMs: 5 };
      await expect(executor.execute(input)).rejects.toThrow(/timeout/i);
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      restoreFetch();
    }
  });
});
