/**
 * IPv4 CIDR expansion and host/port normalization for LAN discovery (#2025).
 */

import { isString } from "@/shared/utils/typeChecks.js";

export const MAX_ADDRESSES = 256;
export const MAX_PORTS = 8;
export const DEFAULT_PORTS = Object.freeze([11434, 8000, 8080, 1234, 20128]);

/**
 * @param {string} value
 * @returns {number|null} Unsigned 32-bit IPv4 integer, or null when invalid.
 */
export function parseIpv4(value) {
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  // Reject non-canonical forms like "01.2.3.4" or "1.2.3".
  if (parts.some((part, i) => String(octets[i]) !== part)) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

/**
 * @param {number} value
 * @returns {string}
 */
export function formatIpv4(value) {
  const n = value >>> 0;
  return `${n >>> 24}.${n >>> 16 & 255}.${n >>> 8 & 255}.${n & 255}`;
}

/**
 * Expand an IPv4 CIDR into host addresses. Rejects IPv6 and oversized ranges.
 * @param {string} cidr
 * @returns {{ ok: true, hosts: string[] } | { ok: false, error: string }}
 */
export function expandCidr(cidr) {
  if (!isString(cidr) || !cidr.trim()) {
    return { ok: false, error: "cidr must be a non-empty IPv4 CIDR string" };
  }
  const trimmed = cidr.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return { ok: false, error: "cidr must be a non-empty IPv4 CIDR string" };
  }
  const prefixRaw = trimmed.slice(slash + 1);
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || String(prefix) !== prefixRaw || prefix < 0 || prefix > 32) {
    return { ok: false, error: "cidr prefix must be an integer 0-32" };
  }
  const base = parseIpv4(trimmed.slice(0, slash));
  if (base === null) {
    return { ok: false, error: "cidr must use a valid IPv4 network address" };
  }
  const hostBits = 32 - prefix;
  const count = 2 ** hostBits;
  if (count > MAX_ADDRESSES) {
    return { ok: false, error: `cidr expands to more than ${MAX_ADDRESSES} addresses` };
  }
  const mask = hostBits === 0 ? 0xffffffff : (0xffffffff << hostBits) >>> 0;
  const network = (base & mask) >>> 0;
  const hosts = [];
  for (let i = 0; i < count; i++) {
    hosts.push(formatIpv4((network + i) >>> 0));
  }
  return { ok: true, hosts };
}

/**
 * @param {unknown} hosts
 * @returns {{ ok: true, hosts: string[] } | { ok: false, error: string }}
 */
export function normalizeHosts(hosts) {
  if (!Array.isArray(hosts)) {
    return { ok: false, error: "hosts must be an array of hostnames or IPv4 addresses" };
  }
  if (hosts.length === 0) {
    return { ok: false, error: "hosts must include at least one address" };
  }
  if (hosts.length > MAX_ADDRESSES) {
    return { ok: false, error: `hosts must not exceed ${MAX_ADDRESSES} addresses` };
  }
  const normalized = [];
  for (const entry of hosts) {
    if (!isString(entry) || !entry.trim()) {
      return { ok: false, error: "hosts must be an array of hostnames or IPv4 addresses" };
    }
    const host = entry.trim().toLowerCase();
    // Reject URLs / paths / ports embedded in host entries.
    if (host.includes("/") || host.includes(":") || /\s/.test(host)) {
      return { ok: false, error: "hosts must be bare hostnames or IPv4 addresses" };
    }
    normalized.push(host);
  }
  return { ok: true, hosts: normalized };
}

/**
 * @param {unknown} ports
 * @returns {{ ok: true, ports: number[] } | { ok: false, error: string }}
 */
export function normalizePorts(ports) {
  if (ports === undefined || ports === null) {
    return { ok: true, ports: [...DEFAULT_PORTS] };
  }
  if (!Array.isArray(ports)) {
    return { ok: false, error: "ports must be an array of integers" };
  }
  if (ports.length === 0) {
    return { ok: false, error: "ports must include at least one port" };
  }
  if (ports.length > MAX_PORTS) {
    return { ok: false, error: `ports must not exceed ${MAX_PORTS} entries` };
  }
  const normalized = [];
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: "ports must be integers between 1 and 65535" };
    }
    normalized.push(port);
  }
  return { ok: true, ports: normalized };
}

/**
 * Resolve the address list from an exclusive hosts XOR cidr request body.
 * @param {{ hosts?: unknown, cidr?: unknown }} body
 * @returns {{ ok: true, hosts: string[] } | { ok: false, error: string }}
 */
export function resolveScanTargets(body) {
  const hasHosts = body != null && Object.prototype.hasOwnProperty.call(body, "hosts") && body.hosts != null;
  const hasCidr = body != null && Object.prototype.hasOwnProperty.call(body, "cidr") && body.cidr != null && body.cidr !== "";

  if (hasHosts && hasCidr) {
    return { ok: false, error: "provide either hosts or cidr, not both" };
  }
  if (!hasHosts && !hasCidr) {
    return { ok: false, error: "provide either hosts or cidr" };
  }
  if (hasHosts) return normalizeHosts(body.hosts);
  return expandCidr(body.cidr);
}
