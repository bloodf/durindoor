import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as proxyFetch from "../../open-sse/utils/proxyFetch.js";
import { GitlabExecutor } from "../../open-sse/executors/gitlab.js";
import { TraeExecutor } from "../../open-sse/executors/trae.js";
import { TheOldLlmExecutor } from "../../open-sse/executors/theoldllm.js";
import { InnerAiExecutor } from "../../open-sse/executors/inner-ai.js";
import { MimocodeExecutor } from "../../open-sse/executors/mimocode.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXECUTORS_DIR = path.join(ROOT, "open-sse/executors");

/** Deliberate direct `fetch(` call sites still awaiting the shared send-wrapper port. */
const BARE_FETCH_ALLOWLIST = {
  "blackbox-web.js": "Blackbox session/subscription/chat still uses direct fetch pending shared wrapper.",
  "chipotle.js": "Amelia init still uses direct fetch pending shared wrapper.",
  "conol-web.js": "Conol session/model/message hops still use direct fetch pending shared wrapper.",
  "deepseek-web.js": "DeepSeek web session bootstrap still uses direct fetch pending shared wrapper.",
  "grok-web.js": "Grok web chat still uses direct fetch pending shared wrapper.",
  "websession-utils.js": "fetchWithTimeout falls back to global fetch only when proxyOptions is null."
};

const FIXED_OVERRIDE_FILES = [
  "gitlab.js",
  "theoldllm.js",
  "trae.js",
  "inner-ai.js",
  "mimocode.js"
];

function listExecutorJsFiles(dir = EXECUTORS_DIR) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listExecutorJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out.sort();
}

function stripCommentsForScan(source) {
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      if (ch === "\n") out += ch;
      i += 1;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      i += 1;
      continue;
    }
    if ((inSingle || inDouble || inTemplate) && ch === "\\") {
      out += ch;
      escaped = true;
      i += 1;
      continue;
    }
    if (!inDouble && !inTemplate && ch === "'") inSingle = !inSingle;
    else if (!inSingle && !inTemplate && ch === '"') inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === "`") inTemplate = !inTemplate;
    else if (!inSingle && !inDouble && !inTemplate && ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    } else if (!inSingle && !inDouble && !inTemplate && ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function findBareFetchSites(source) {
  const sites = [];
  const lines = stripCommentsForScan(source).split("\n");
  const bareFetch = /(?<![\w.$])fetch\s*\(/g;
  for (let i = 0; i < lines.length; i++) {
    bareFetch.lastIndex = 0;
    if (bareFetch.test(lines[i])) sites.push(i + 1);
  }
  return sites;
}

function makeJwt(extra = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra
  })).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("s-exec-fetch: override proxy + redirect contract (#2308)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects bare global fetch() in executors unless explicitly allowlisted", () => {
    const offenders = [];
    for (const file of listExecutorJsFiles()) {
      const rel = path.relative(EXECUTORS_DIR, file);
      const sites = findBareFetchSites(readFileSync(file, "utf8"));
      if (sites.length === 0) continue;
      const reason = BARE_FETCH_ALLOWLIST[rel];
      if (!reason) {
        offenders.push(`${rel}:${sites.join(",")}`);
        continue;
      }
      expect(reason.trim().length, `${rel} allowlist reason`).toBeGreaterThan(0);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps allowlist entries only for files that still have a bare fetch", () => {
    for (const [rel, reason] of Object.entries(BARE_FETCH_ALLOWLIST)) {
      expect(reason.trim().length, rel).toBeGreaterThan(0);
      const sites = findBareFetchSites(readFileSync(path.join(EXECUTORS_DIR, rel), "utf8"));
      expect(sites.length, `${rel} should still have bare fetch or leave the allowlist`).toBeGreaterThan(0);
    }
  });

  it.each(FIXED_OVERRIDE_FILES)("%s routes through proxyAwareFetch with redirect:error", (name) => {
    const source = readFileSync(path.join(EXECUTORS_DIR, name), "utf8");
    expect(source).toContain('from "../utils/proxyFetch.js"');
    expect(source).toContain("proxyAwareFetch");
    expect(source).toContain('redirect: "error"');
    expect(findBareFetchSites(source)).toEqual([]);
  });

  it("threads connection proxyOptions and rejects redirects on GitLab Duo", async () => {
    const proxyOptions = { proxyUrl: "http://proxy.test:8080" };
    const spy = vi.spyOn(proxyFetch, "proxyAwareFetch").mockResolvedValue(
      Response.json({ choices: [{ message: { content: "ok" } }] })
    );
    await new GitlabExecutor().execute({
      model: "duo",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { accessToken: "tok", providerSpecificData: { baseUrl: "https://gitlab.example" } },
      proxyOptions
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][1]).toMatchObject({ redirect: "error", method: "POST" });
    expect(spy.mock.calls[0][2]).toBe(proxyOptions);
  });

  it("threads connection proxyOptions through TheOldLLM, Trae, Inner.ai, and Mimocode", async () => {
    const proxyOptions = { proxyUrl: "http://proxy.test:9090" };
    const spy = vi.spyOn(proxyFetch, "proxyAwareFetch").mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("/users/profile")) {
        return Response.json({ data: { email: "u@example.com" } });
      }
      if (href.includes("/ai_models")) {
        return Response.json({
          data: [{ id: "m1", llm_model: "gpt-4o", ai_model_categories: [{ unique_identifier: "text" }] }]
        });
      }
      if (href.includes("theoldllm")) {
        return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        });
      }
      if (href.includes("/chat_sessions") && !href.includes("/events")) {
        return Response.json({ code: 0, data: { chat_session_id: "s1", message_id: "m1" } });
      }
      if (href.includes("/events")) {
        return new Response("event: done\ndata: {}\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        });
      }
      if (href.includes("/bootstrap") || href.includes("innerai.com/chat") || href.includes("/free-ai/openai/chat")) {
        if (href.includes("/bootstrap")) return Response.json({ jwt: makeJwt() });
        if (href.includes("innerai.com/chat")) {
          return new Response('data: {"type":"text","item":"hi"}\n\ndata: {"type":"end_stream","item":"end"}\n\n', {
            status: 200,
            headers: { "Content-Type": "text/event-stream" }
          });
        }
        return new Response("ok", { status: 200 });
      }
      return new Response("ok", { status: 200 });
    });

    await new TheOldLlmExecutor().execute({
      model: "GPT_5_4",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {},
      proxyOptions
    });

    await new TraeExecutor().execute({
      model: "auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { accessToken: "jwt", providerSpecificData: {} },
      proxyOptions
    });

    await new InnerAiExecutor().execute({
      model: "gpt-4o",
      stream: false,
      credentials: { apiKey: makeJwt({ device_id: "d1", plan: "pro" }) },
      body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      proxyOptions
    });

    await new MimocodeExecutor().execute({
      model: "mimo-auto",
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: {},
      proxyOptions
    });

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect(call[1]).toMatchObject({ redirect: "error" });
      expect(call[2]).toBe(proxyOptions);
    }
  });
});
