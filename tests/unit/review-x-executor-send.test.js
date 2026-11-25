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
  "unsupported-websession.js": "Sends nothing: it returns a local 501 or delegates to another executor's own sender."
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
