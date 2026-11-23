"use strict";

const IPV6_LITERAL = /:/;

function getProbeHost(host) {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "::1";
  return host || "127.0.0.1";
}

function getDisplayHost(host) {
  if (!host || host === "0.0.0.0" || host === "::") return "localhost";
  return IPV6_LITERAL.test(host) && !(host.startsWith("[") && host.endsWith("]"))
    ? `[${host}]`
    : host;
}

function getDisplayUrl(host, port, path = "") {
  return `http://${getDisplayHost(host)}:${port}${path}`;
}

module.exports = { getProbeHost, getDisplayHost, getDisplayUrl };
