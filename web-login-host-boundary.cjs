"use strict";

const { isString } = require("./src/shared/utils/typeChecks.cjs");

function parseOrigin(raw) {
  if (!isString(raw) || !raw || raw !== raw.trim()) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function hostname(url) {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

function configuredLoginOrigin(dashboardOrigin) {
  const login = parseOrigin(process.env.DURINDOOR_WEB_LOGIN_ORIGIN);
  const dashboard = parseOrigin(dashboardOrigin);
  if (!login || !dashboard || hostname(login) === hostname(dashboard)) return null;
  return login.origin;
}

// Classify the Host itself, never client-supplied forwarded origin headers.
// Even a configured URL with a forbidden path must not expose the dashboard.
function isLoginHost(req) {
  try {
    const configured = new URL(process.env.DURINDOOR_WEB_LOGIN_ORIGIN || "");
    const host = req.headers?.host;
    if (!isString(host) || /[\s,/@\\?#]/.test(host)) return false;
    return hostname(new URL(`http://${host}`)) === hostname(configured);
  } catch {
    return false;
  }
}

function allowsLoginRequest(req) {
  const dashboard = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || 20128}`;
  if (!configuredLoginOrigin(dashboard)) return false;
  const rawPath = String(req.url || "").split("?")[0];
  if (!rawPath.startsWith("/") || rawPath.includes("\\")) return false;
  let pathname;
  try { pathname = decodeURIComponent(rawPath); } catch { return false; }
  if (/%|\\/.test(pathname) || pathname.split("/").some((part) => part === "." || part === "..")) return false;
  // Encoded separators can be resolved differently by Next and the proxy.
  if (/%2f|%5c/i.test(rawPath)) return false;
  if (pathname === "/__web_login/bootstrap") return true;
  return !pathname.startsWith("/__web_login/bootstrap/") &&
    /^\/__web_login\/[a-z0-9]+(?:-[a-z0-9]+)*\//.test(pathname);
}

function denyIsolatedHttpRequest(req, res) {
  if (!isLoginHost(req) || allowsLoginRequest(req)) return false;
  res.writeHead(403, { "content-type": "text/plain", "cache-control": "no-store", "referrer-policy": "no-referrer" });
  res.end("Forbidden");
  return true;
}

// There is no isolated login WebSocket transport. Never dispatch an upgrade
// to Next, the realtime API, or a local administration bridge on this host.
function denyIsolatedUpgrade(req, socket) {
  if (!isLoginHost(req)) return false;
  socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  return true;
}

module.exports = { configuredLoginOrigin, isLoginHost, allowsLoginRequest, denyIsolatedHttpRequest, denyIsolatedUpgrade };
