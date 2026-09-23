import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { acquireBrowserContext, openPage } from "../services/browserPool.js";

import {
  extractChatGptWebAttachmentSources,
  isChatGptWebAttachmentContentPart,
  resolveChatGptWebAttachments,
} from "./chatgptWebAttachments.js";
import {
  PlaywrightChatGptWebBrowserSession,
  runChatGptWebBrowserTurn,
} from "./chatgptWebBrowserSession.js";
import {
  buildNextAuthSessionCookie,
  mergeRefreshedCookie,
} from "../../src/lib/providers/webCookieAuth.js";
import { isBoolean, isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const CHATGPT_WEB_PAGE_URL = "https://chatgpt.com/?temporary-chat=true";
const MAX_PROMPT_BYTES = 4 * 1024 * 1024;
const FIRST_PARTY_COOKIE_HOSTS = ["chatgpt.com", "openai.com"];

function isRecord(value) {
  return isObject(value) && value !== null && !Array.isArray(value);
}

function isFirstPartyHost(value) {
  const host = value.toLowerCase().replace(/^\./, "");
  return FIRST_PARTY_COOKIE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );
}

function validateCookie(value) {
  if (
    !isRecord(value) ||
    !isString(value.name) ||
    !value.name ||
    !isString(value.value) ||
    !isString(value.domain) ||
    !isString(value.path) ||
    !value.path.startsWith("/") ||
    !isNumber(value.expires) ||
    !Number.isFinite(value.expires) ||
    !isBoolean(value.httpOnly) ||
    !isBoolean(value.secure) ||
    !["Strict", "Lax", "None"].includes(String(value.sameSite))
  ) {
    throw new Error("ChatGPT Web browser storage state contains an invalid cookie");
  }
  if (!isFirstPartyHost(value.domain)) {
    throw new Error("ChatGPT Web browser storage state contains a foreign cookie domain");
  }
}

function validateOrigin(value) {
  if (!isRecord(value) || !isString(value.origin) || !Array.isArray(value.localStorage)) {
    throw new Error("ChatGPT Web browser storage state contains an invalid origin");
  }
  let url;
  try {
    url = new URL(value.origin);
  } catch {
    throw new Error("ChatGPT Web browser storage state contains an invalid origin");
  }
  if (url.protocol !== "https:" || !isFirstPartyHost(url.hostname)) {
    throw new Error("ChatGPT Web browser storage state contains a foreign origin");
  }
  for (const entry of value.localStorage) {
    if (!isRecord(entry) || !isString(entry.name) || !isString(entry.value)) {
      throw new Error("ChatGPT Web browser storage state contains invalid local storage");
    }
  }
}

export function normalizeChatGptWebStorageState(value) {
  if (!isRecord(value) || !Array.isArray(value.cookies) || !Array.isArray(value.origins)) {
    throw new Error("ChatGPT Web browser storage state is invalid");
  }
  for (const cookie of value.cookies) validateCookie(cookie);
  for (const origin of value.origins) validateOrigin(origin);
  return structuredClone(value);
}

function contentText(value) {
  if (isString(value)) return value;
  if (!Array.isArray(value)) {
    throw new Error("ChatGPT Web clean-room adapter supports text content only");
  }
  const parts = [];
  for (const part of value) {
    if (
      isRecord(part) &&
      (part.type === "text" || part.type === "input_text") &&
      isString(part.text)
    ) {
      parts.push(part.text);
      continue;
    }
    if (isChatGptWebAttachmentContentPart(part)) continue;
    throw new Error("ChatGPT Web clean-room adapter received unsupported content");
  }
  return parts.join("");
}

function buildPrompt(body) {
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    throw new Error("ChatGPT Web clean-room adapter does not support tools yet");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error("ChatGPT Web clean-room adapter requires messages");
  }
  const messages = body.messages.map((value) => {
    if (!isRecord(value) || !isString(value.role)) {
      throw new Error("ChatGPT Web clean-room adapter received an invalid message");
    }
    if (!["system", "developer", "user", "assistant"].includes(value.role)) {
      throw new Error("ChatGPT Web clean-room adapter does not support tool messages yet");
    }
    if (Array.isArray(value.tool_calls) && value.tool_calls.length > 0) {
      throw new Error("ChatGPT Web clean-room adapter does not support tools yet");
    }
    return { role: value.role, text: contentText(value.content) };
  });

  const prompt =
    messages.length === 1 && messages[0].role === "user"
      ? messages[0].text
      : messages
          .map(({ role, text }) => `${role[0].toUpperCase()}${role.slice(1)}:\n${text}`)
          .join("\n\n");
  if (!prompt.trim()) throw new Error("ChatGPT Web clean-room adapter requires non-empty text");
  if (new TextEncoder().encode(prompt).byteLength > MAX_PROMPT_BYTES) {
    throw new Error("ChatGPT Web clean-room adapter prompt is too large");
  }
  return prompt;
}

function reasoningEffort(body) {
  if (isString(body.reasoning_effort)) return body.reasoning_effort.toLowerCase();
  if (isRecord(body.reasoning) && isString(body.reasoning.effort)) {
    return body.reasoning.effort.toLowerCase();
  }
  return null;
}

function effortIndex(effort) {
  if (effort === null || effort === "medium") return 1;
  if (["none", "off", "minimal", "low"].includes(effort)) return 0;
  if (effort === "high") return 2;
  if (effort === "xhigh" || effort === "max") return 3;
  throw new Error(`ChatGPT Web clean-room adapter does not support reasoning effort ${effort}`);
}

function normalizedModel(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^chatgpt-web\//, "")
    .replace(/^cgpt-web\//, "")
    .replace(/\./g, "-");
}

function resolveSelection(model, body) {
  const normalized = normalizedModel(model);
  if (normalized === "gpt-5-6-luna-free") {
    return { kind: "free", thinkEnabled: false };
  }
  if (normalized === "gpt-5-6-luna-free-thinking") {
    return { kind: "free", thinkEnabled: true };
  }
  if (normalized === "gpt-5-6-pro") {
    return { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 4 };
  }
  if (normalized === "gpt-5-6-instant" || normalized === "gpt-5-6") {
    return { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 0 };
  }
  if (["gpt-5-6-thinking", "gpt-5-6-sol"].includes(normalized)) {
    return {
      kind: "picker",
      modelLabel: "GPT-5.6 Sol",
      effortIndex: effortIndex(reasoningEffort(body)),
    };
  }
  if (normalized === "gpt-5-5-pro") {
    return { kind: "picker", modelLabel: "GPT-5.5", effortIndex: 4 };
  }
  if (normalized === "gpt-5-5-instant") {
    return { kind: "picker", modelLabel: "GPT-5.5", effortIndex: 0 };
  }
  if (["gpt-5-5", "gpt-5-5-thinking"].includes(normalized)) {
    return {
      kind: "picker",
      modelLabel: "GPT-5.5",
      effortIndex: effortIndex(reasoningEffort(body)),
    };
  }
  throw new Error(`ChatGPT Web clean-room adapter received an unsupported model: ${model}`);
}

export function prepareChatGptWebBrowserRequest(model, body) {
  if (!isRecord(body)) throw new Error("ChatGPT Web clean-room adapter requires an object body");
  const prompt = buildPrompt(body);
  const attachments = extractChatGptWebAttachmentSources(body.messages);
  return { prompt, selection: resolveSelection(model, body), attachments };
}

/**
 * Build a Playwright storage state from a pasted chatgpt.com Cookie header or
 * session-token value (the dashboard's cookie connection format). `__Host-`
 * cookies are skipped: they cannot carry the Domain attribute.
 * @param {string} rawCookie
 * @returns {{cookies: object[], origins: object[]}}
 */
export function cookieStringToChatGptWebStorageState(rawCookie) {
  const header = buildNextAuthSessionCookie(rawCookie);
  if (!header) throw new Error("ChatGPT Web credentials contain no session cookie");
  const cookies = header
    .split("; ")
    .map((pair) => {
      const eq = pair.indexOf("=");
      return { name: pair.slice(0, eq), value: pair.slice(eq + 1) };
    })
    .filter(({ name }) => !name.startsWith("__Host-"))
    .map(({ name, value }) => ({
      name,
      value,
      domain: ".chatgpt.com",
      path: "/",
      expires: -1,
      httpOnly: name.startsWith("__Secure-next-auth."),
      secure: true,
      sameSite: "Lax",
    }));
  return { cookies, origins: [] };
}

function isJsonStorageState(raw) {
  return isString(raw) && raw.trim().startsWith("{");
}

function readStorageState(credentials) {
  const providerData = credentials.providerSpecificData;
  const raw = providerData?.storageState ?? credentials.apiKey;
  if (isString(raw) && !isJsonStorageState(raw)) {
    return normalizeChatGptWebStorageState(cookieStringToChatGptWebStorageState(raw));
  }
  if (isString(raw)) {
    try {
      return normalizeChatGptWebStorageState(JSON.parse(raw));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("ChatGPT Web browser storage state JSON is invalid");
      }
      throw error;
    }
  }
  return normalizeChatGptWebStorageState(raw);
}

function optionalString(value) {
  return isString(value) && value.trim() ? value.trim() : undefined;
}

/**
 * chatgpt.com's anti-bot checks reject some headless Chromium sessions, so the
 * browser runs headed (off-screen) by default. Servers without a display can
 * opt into headless with DURINDOOR_CHATGPT_WEB_HEADLESS=1 or the connection's
 * `headless: true`, or run headed under Xvfb (the Docker image does).
 */
export function resolveChatGptWebHeadless(providerData, env = process.env) {
  if (isBoolean(providerData?.headless)) return providerData.headless;
  return /^(1|true|yes|on)$/i.test(env.DURINDOOR_CHATGPT_WEB_HEADLESS || "");
}

export function resolveChatGptWebChromeExecutable(explicit, deps = {}) {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const candidates = [
    explicit,
    env.CHATGPT_WEB_CHROME_PATH,
    env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...(env.PROGRAMFILES
      ? [join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")]
      : []),
    ...(env["PROGRAMFILES(X86)"]
      ? [join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")]
      : []),
    ...(env.LOCALAPPDATA
      ? [join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")]
      : []),
  ];
  return candidates.find((candidate) => Boolean(candidate?.trim() && exists(candidate.trim())));
}

async function createDefaultSession(input) {
  const digest = createHash("sha256")
    .update(input.connectionId)
    .update("\0")
    .update(JSON.stringify(input.storageState))
    .update("\0")
    .update(input.proxyUrl || "")
    .digest("hex");
  const pooled = await acquireBrowserContext(`chatgpt-web-cleanroom:${digest}`, {
    cookieDomain: "chatgpt.com",
    proxyUrl: input.proxyUrl,
    storageState: input.storageState,
    userAgent: input.userAgent,
    locale: input.locale,
    timezone: input.timezone,
      warmupUrl: CHATGPT_WEB_PAGE_URL,
    headless: input.headless === true,
    executablePath: input.chromeExecutablePath,
  });
  const page =
    pooled.warmupPage && !pooled.warmupPage.isClosed() ? pooled.warmupPage : await openPage(pooled);
  if (pooled.warmupPage !== page) pooled.warmupPage = page;
  return new PlaywrightChatGptWebBrowserSession(page, {
    pageUrl: CHATGPT_WEB_PAGE_URL,
    selection: input.selection,
    closePageOnCleanup: false,
  });
}

export function buildChatGptWebOpenAiResponse(model, result, stream, metadata = {}) {
  const id = metadata.id ?? `chatcmpl-${randomUUID()}`;
  const created = metadata.created ?? Math.floor(Date.now() / 1000);
  if (!stream) {
    return Response.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: result.text },
          finish_reason: "stop",
        },
      ],
    });
  }

  const chunks = [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }
  );
}

async function readBrowserSessionCookies(session) {
  const context = session?.page?.context?.();
  if (!context) return [];
  return context.cookies("https://chatgpt.com");
}

/**
 * chatgpt.com rotates the NextAuth session cookie (and may re-chunk it) while
 * the page runs. For cookie-string connections, write the rotated chunks back
 * so the stored credential does not go stale. Storage-state JSON connections
 * are left alone. Failures only log: the turn itself already succeeded.
 */
async function persistRotatedSessionCookie(session, input, deps) {
  const stored = input.credentials?.apiKey;
  if (!input.onCredentialsRefreshed || !isString(stored)) return;
  if (input.credentials.providerSpecificData?.storageState || isJsonStorageState(stored)) return;
  try {
    const cookies = await (deps.readSessionCookies ?? readBrowserSessionCookies)(session);
    const live = cookies
      .filter((cookie) => /^__Secure-next-auth\.session-token(?:\.\d+)?$/.test(cookie.name))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const merged = mergeRefreshedCookie(stored, live);
    if (merged && merged !== stored) {
      await input.onCredentialsRefreshed({ ...input.credentials, apiKey: merged });
    }
  } catch (error) {
    input.log?.warn?.(
      "CGPT-WEB",
      `Failed to persist rotated session cookie: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function executeChatGptWebCleanRoom(input, deps = {}) {
  const prepared = prepareChatGptWebBrowserRequest(input.model, input.body);
  const attachments = await resolveChatGptWebAttachments(prepared.attachments);
  const storageState = readStorageState(input.credentials);
  const connectionId = optionalString(input.credentials.connectionId);
  if (!connectionId) throw new Error("ChatGPT Web clean-room adapter requires a connection ID");
  const providerData = input.credentials.providerSpecificData;
  const session = await (deps.createSession ?? createDefaultSession)({
    connectionId,
    storageState,
    selection: prepared.selection,
    userAgent: optionalString(providerData?.customUserAgent),
    locale: optionalString(providerData?.locale),
    timezone: optionalString(providerData?.timezone),
    chromeExecutablePath: resolveChatGptWebChromeExecutable(
      optionalString(providerData?.chromeExecutablePath)
    ),
    proxyUrl: input.proxyUrl,
    headless: resolveChatGptWebHeadless(providerData),
  });
  const result = await (deps.runTurn ?? runChatGptWebBrowserTurn)(session, {
    prompt: prepared.prompt,
    attachments,
    signal: input.signal,
  });
  await persistRotatedSessionCookie(session, input, deps);
  return buildChatGptWebOpenAiResponse(input.model, result, input.stream, {
    id: deps.id?.(),
    created: deps.now ? Math.floor(deps.now() / 1000) : undefined,
  });
}
