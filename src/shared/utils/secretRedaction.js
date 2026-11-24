import { isObject, isString } from "./typeChecks.js";
export const REDACTED_SECRET = "[REDACTED]";

function isSecretField(name) {
  const normalized = String(name || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "token" ||
  normalized === "authorization" ||
  /(?:apikey|authtoken|accesstoken|refreshtoken|idtoken|clitoken|password|secret)$/.test(normalized);
}

const sensitiveFlag = /^--[^=]*(?:token|key|secret|password)[^=]*$/i;

function redactUrlUserinfo(value) {
  return value.replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^/@\s]+@/gi, `$1${REDACTED_SECRET}@`);
}

function redactArgs(args) {
  if (!Array.isArray(args)) return redactSecrets(args);
  return args.map((arg, index) => {
    if (!isString(arg)) return redactSecrets(arg);
    const equalsAt = arg.indexOf("=");
    if (equalsAt > 0 && sensitiveFlag.test(arg.slice(0, equalsAt))) {
      return `${arg.slice(0, equalsAt + 1)}${REDACTED_SECRET}`;
    }
    if (sensitiveFlag.test(arg) && args[index + 1] != null) {
      return arg;
    }
    if (index > 0 && isString(args[index - 1]) && sensitiveFlag.test(args[index - 1])) {
      return REDACTED_SECRET;
    }
    return redactUrlUserinfo(arg);
  });
}

/** Return a deep copy suitable for status/management responses. */
export function redactSecrets(value, context = {}) {
  if (Array.isArray(value)) return value.map((child) => redactSecrets(child, context));
  if (!value || !isObject(value)) {
    return isString(value) ? redactUrlUserinfo(value) : value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const inMcpServer = context.inMcpServers;
    if (inMcpServer && ["env", "env_http_headers", "http_headers", "headers"].includes(key)) {
      return [key, redactAllValues(child)];
    }
    if (inMcpServer && key === "args") return [key, redactArgs(child)];
    const nextContext = { inMcpServers: inMcpServer || key === "mcp_servers" };
    return [key, isSecretField(key) && child != null && child !== ""
      ? REDACTED_SECRET
      : redactSecrets(child, nextContext)];
  }));
}

function redactAllValues(value) {
  if (Array.isArray(value)) return value.map(redactAllValues);
  if (isObject(value)) {
    return Object.fromEntries(Object.keys(value).map((key) => [key, redactAllValues(value[key])]));
  }
  return value == null || value === "" ? value : REDACTED_SECRET;
}
