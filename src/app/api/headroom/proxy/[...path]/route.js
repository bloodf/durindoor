import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { isString } from "../../../../../shared/utils/typeChecks.js";

export const dynamic = "force-dynamic";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export const DASHBOARD_PREFIX = "/api/headroom/proxy";

const ALLOWED_PREFIXES = [
  "dashboard",
  "assets",
  "_next",
  "static",
  "favicon",
  "stats",
  "stats-history",
  "health",
  "livez",
  "readyz",
  "metrics",
  "settings",
  "transformations",
];

function isAllowedPath(url, prefix) {
  if (url === prefix || url.startsWith(prefix + "/")) return false;
  if (url.startsWith("//")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return false;
  if (!url.startsWith("/")) return false;
  const pathOnly = url.split("?")[0].split("#")[0];
  return ALLOWED_PREFIXES.some(
    (allowed) =>
      pathOnly === `/${allowed}` ||
      pathOnly.startsWith(`/${allowed}/`) ||
      pathOnly.startsWith(`/${allowed}.`),
  );
}

/** Rewrite Headroom-owned root URLs while leaving arbitrary HTML values unchanged. */
export function rewriteHeadroomHtml(html, prefix = DASHBOARD_PREFIX) {
  if (!isString(html) || !html) return html;

  return html
    .replace(
      /\b(src|href|action)\s*=\s*(["'])(\/[^"']*)\2/g,
      (match, attr, quote, url) =>
        isAllowedPath(url, prefix) ? `${attr}=${quote}${prefix}${url}${quote}` : match,
    )
    .replace(/fetch\s*\(\s*(['"`])(\/[^'"`]*?)\1/g, (match, quote, url) => {
      if (url.includes("\\") || url.includes("${") || !isAllowedPath(url, prefix)) return match;
      return `fetch(${quote}${prefix}${url}${quote}`;
    });
}

/** Resolve redirects from the fetched URL, then strip the configured upstream base once. */
export function rewriteLocation(value, requestedTarget, upstreamBase) {
  if (!isString(value) || !value) return value;
  if (value === DASHBOARD_PREFIX || value.startsWith(DASHBOARD_PREFIX + "/")) return value;
  if (value.startsWith("//")) return value;

  try {
    const target = requestedTarget instanceof URL ? requestedTarget : new URL(requestedTarget);
    const base = upstreamBase instanceof URL ? upstreamBase : new URL(upstreamBase);
    const location = new URL(value, target);
    if (!["http:", "https:"].includes(location.protocol) || location.origin !== base.origin) {
      return value;
    }
    const basePath = base.pathname.replace(/\/$/, "");
    const pathname =
      basePath && (location.pathname === basePath || location.pathname.startsWith(basePath + "/"))
        ? location.pathname.slice(basePath.length) || "/"
        : location.pathname;
    return `${DASHBOARD_PREFIX}${pathname}${location.search}${location.hash}`;
  } catch {
    return value;
  }
}

export function forwardedHeaders(request) {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) headers.delete(key);
  }
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("authorization");
  headers.delete("proxy-authorization");
  headers.delete("proxy-authenticate");

  const requestUrl = new URL(request.url);
  const firstHeaderValue = (name, fallback) =>
    (request.headers.get(name) || "").split(",")[0].trim() || fallback;
  headers.set(
    "x-forwarded-proto",
    firstHeaderValue("x-forwarded-proto", requestUrl.protocol.slice(0, -1)),
  );
  headers.set("x-forwarded-host", firstHeaderValue("x-forwarded-host", requestUrl.host));

  const apiKey = process.env.HEADROOM_API_KEY?.trim();
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  return headers;
}

async function getTargetConfig() {
  const settings = await getSettings();
  const target = new URL(settings.headroomUrl || DEFAULT_HEADROOM_URL);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Headroom URL must use http or https");
  }
  const timeoutMs = settings.headroomTimeoutMs;
  return {
    target,
    timeoutMs:
      Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000
        ? timeoutMs
        : 15000,
  };
}

function buildTargetUrl(base, path, search) {
  const target = new URL(base);
  const basePath = target.pathname.replace(/\/$/, "");
  const incoming = path.join("/");
  target.pathname = incoming ? `${basePath}/${incoming}` : basePath || "/";
  target.search = search;
  return target;
}

async function proxy(request, { params }) {
  try {
    const { target: base, timeoutMs } = await getTargetConfig();
    const { search } = new URL(request.url);
    const path = (await params).path || [];
    const target = buildTargetUrl(base, path, search);
    const method = request.method;
    const hasBody = !["GET", "HEAD"].includes(method);

    /** Bound an unavailable Headroom upstream without changing the route's generic 502 contract. */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(target, {
        method,
        headers: forwardedHeaders(request),
        body: hasBody ? request.body : undefined,
        duplex: hasBody ? "half" : undefined,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const headers = new Headers(response.headers);
    for (const key of [...headers.keys()]) {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) headers.delete(key);
    }

    const location = headers.get("location");
    if (location) headers.set("location", rewriteLocation(location, target, base));

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const body = await response.text();
      const rewritten = rewriteHeadroomHtml(body);
      /** Fetch decoded this body, so describe the emitted decoded bytes rather than upstream encoding. */
      headers.delete("content-encoding");
      headers.set("content-length", String(Buffer.byteLength(rewritten)));
      return new NextResponse(rewritten, { status: response.status, headers });
    }

    return new NextResponse(response.body, { status: response.status, headers });
  } catch {
    return NextResponse.json({ error: "Headroom proxy request failed" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
