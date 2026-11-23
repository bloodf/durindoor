import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isFunction, isString } from "../../shared/utils/typeChecks.js";
import { publicCategory } from "./publicError.js";

const ALLOWED_HOSTS = new Set([
  "accounts.google.com",
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "openidconnect.googleapis.com",
  "ssl.gstatic.com",
  "www.gstatic.com",
  "fonts.gstatic.com",
  "apis.google.com",
]);

// ponytail: one browser recovery at a time. Add a queue when more than one opted-in account must run together.
let browserActive = false;

export function browserRecoveryAvailable(env = process.env) {
  return env.DURINDOOR_ANTIGRAVITY_BROWSER_RECOVERY === "1"
    && env.DURINDOOR_ANTIGRAVITY_EGRESS_ENFORCED === "1";
}

function ipv4Public(address) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 255 || a >= 224) return false;
  return true;
}

function ipv6Public(address) {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return false;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return false;
  if (lower.startsWith("::ffff:")) return ipv4Public(lower.slice("::ffff:".length));
  return /^[0-9a-f:]+$/.test(lower);
}

export function isPublicResolution(address) {
  if (!isString(address) || !address) return false;
  return address.includes(":") ? ipv6Public(address) : ipv4Public(address);
}

function singleParam(url, name) {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || !values[0]) return null;
  return values[0];
}

function exactCallback(url, redirectUri) {
  let expected;
  try {
    expected = new URL(redirectUri);
  } catch {
    return false;
  }
  return !url.username && !url.password && !url.hash
    && url.protocol === expected.protocol
    && url.hostname === expected.hostname
    && url.port === expected.port
    && url.pathname === expected.pathname;
}

export function classifyBrowserUrl(urlString, redirectUri) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { action: "block", category: "network" };
  }
  if (exactCallback(url, redirectUri)) {
    const code = singleParam(url, "code");
    const state = singleParam(url, "state");
    if (!code || !state) return { action: "block", category: "pre_dispatch_failure" };
    return { action: "intercept", code, state };
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    return { action: "block", category: "network" };
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) return { action: "block", category: "network" };
  if (url.pathname.includes("/challenge") && !(url.hostname === "accounts.google.com" && /^\/signin\/(?:v2\/)?challenge\/pwd\/?$/.test(url.pathname))) {
    return { action: "block", category: "challenge" };
  }
  if (url.pathname.includes("/consent") || url.pathname.includes("/signin/oauth/consent")) {
    return { action: "block", category: "consent" };
  }
  return { action: "resolve", hostname: url.hostname };
}

export function evaluateBrowserRequest(urlString, redirectUri, addresses) {
  const classified = classifyBrowserUrl(urlString, redirectUri);
  if (classified.action !== "resolve") return classified;
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some((address) => !isPublicResolution(address))) {
    return { action: "block", category: "network" };
  }
  return { action: "allow" };
}

export function cleanupAntigravityBrowserProfiles() {
  let names = [];
  try {
    names = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith("durindoor-agy-")) continue;
    try {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    } catch {
      // A live profile is removed again on the next startup.
    }
  }
}

async function lookupAddresses(hostname, lookup) {
  try {
    const result = await lookup(hostname);
    if (Array.isArray(result)) return result;
    if (isString(result)) return [result];
    if (Array.isArray(result?.address)) return result.address;
    if (isString(result?.address)) return [result.address];
    return [];
  } catch {
    return [];
  }
}

function redactResult(result) {
  return { ok: false, category: publicCategory(result?.category) };
}

export async function runBrowserRecovery(job) {
  const testMode = job?.boundary === "test" && isFunction(job.browser);
  if (!testMode && !browserRecoveryAvailable(job?.env)) return { ok: false, category: "browser_unavailable" };
  if (browserActive) return { ok: false, category: "busy" };
  browserActive = true;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-agy-"));
  try {
    fs.chmodSync(profileDir, 0o700);
  } catch {
    // The directory is still removed in finally.
  }
  try {
    const onRequest = (urlString, lookupResult) => evaluateBrowserRequest(
      urlString,
      job.redirectUri,
      lookupResult?.addresses || []
    );
    if (testMode) {
      const result = await job.browser({ profileDir, onRequest, evaluateBrowserRequest });
      if (!result?.ok) return redactResult(result);
      if (!isString(result.code) || !result.code || !isString(job.state) || !job.state || result.state !== job.state) {
        return { ok: false, category: "pre_dispatch_failure" };
      }
      return { ok: true, code: result.code, state: result.state };
    }
    return await runRealBrowser(job, profileDir);
  } catch {
    return { ok: false, category: "browser_unavailable" };
  } finally {
    browserActive = false;
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

async function runRealBrowser(job, profileDir) {
  if (!isString(job.state) || !job.state) return { ok: false, category: "pre_dispatch_failure" };
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer-extra")).default;
    const stealth = (await import("puppeteer-extra-plugin-stealth")).default;
    puppeteer.use(stealth());
  } catch {
    return { ok: false, category: "browser_unavailable" };
  }
  const lookup = job.lookup || (async (hostname) => {
    const dns = await import("node:dns/promises");
    return dns.lookup(hostname, { all: true, verbatim: true });
  });
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: profileDir,
      args: ["--disable-breakpad", "--disable-crash-reporter", "--disable-dev-shm-usage"],
      timeout: job.deadlineMs || 60_000,
    });
  } catch {
    return { ok: false, category: "browser_unavailable" };
  }
  let captured = null;
  let blocked = null;
  const pending = new Set();
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const task = (async () => {
        let decision;
        try {
          decision = classifyBrowserUrl(request.url(), job.redirectUri);
          if (decision.action === "resolve") {
            const addresses = await lookupAddresses(decision.hostname, lookup);
            decision = evaluateBrowserRequest(request.url(), job.redirectUri, addresses);
          }
        } catch {
          decision = { action: "block", category: "network" };
        }
        try {
          const mainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
          if (decision.action === "intercept") {
            if (mainNavigation && decision.state === job.state && !captured) captured = { code: decision.code, state: decision.state };
            else if (mainNavigation && decision.state !== job.state) blocked = "pre_dispatch_failure";
            await request.abort("blockedbyclient");
            return;
          }
          if (decision.action !== "allow") {
            if (mainNavigation) blocked = decision.category;
            await request.abort("blockedbyclient");
            return;
          }
          await request.continue();
        } catch {
          // The page can close while the paused request is still settling.
        }
      })();
      pending.add(task);
      task.finally(() => pending.delete(task));
    });
    try {
      await page.goto(job.authorizeUrl, { timeout: job.deadlineMs || 60_000, waitUntil: "domcontentloaded" });
    } catch {
      // Aborting the callback rejects navigation. A captured code is still the result.
    }
    await Promise.allSettled([...pending]);
    if (!captured && !blocked && isString(job.password) && job.password) {
      const current = new URL(page.url());
      if (current.protocol === "https:" && current.hostname === "accounts.google.com"
          && (!current.port || current.port === "443")
          && /^\/signin\/(?:v2\/)?challenge\/pwd\/?$/.test(current.pathname)) {
        const input = await page.$('input[type="password"][name="Passwd"]');
        const next = await page.$("#passwordNext");
        if (input && next) {
          await input.type(job.password);
          await Promise.allSettled([
            page.waitForNavigation({ timeout: job.deadlineMs || 60_000, waitUntil: "domcontentloaded" }),
            next.click(),
          ]);
          await Promise.allSettled([...pending]);
        }
      }
    }
    if (captured?.code && captured.state === job.state && !blocked) {
      return { ok: true, code: captured.code, state: captured.state };
    }
    return { ok: false, category: blocked || "challenge" };
  } catch {
    return { ok: false, category: "browser_unavailable" };
  } finally {
    await browser?.close?.().catch(() => {});
  }
}
