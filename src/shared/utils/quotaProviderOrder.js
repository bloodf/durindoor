import { isString } from "./typeChecks.js";

/** Display-only order. Unknown saved providers remain in place for later reconnection. */
export function quotaProviderOrder(connections, saved = []) {
  const known = [...new Set(connections.map((connection) => connection.provider).filter(Boolean))];
  return [...new Set([...(Array.isArray(saved) ? saved.filter((id) => isString(id) && id.length > 0 && id.length <= 128) : []), ...known])];
}

export function moveQuotaProvider(order, provider, target) {
  if (provider === target || !order.includes(provider) || !order.includes(target)) return order;
  const next = [...order];
  const from = next.indexOf(provider);
  const to = next.indexOf(target);
  next.splice(from, 1);
  next.splice(to, 0, provider);
  return next;
}

export function applyQuotaProviderOrder(connections, order) {
  if (!order.length) return connections;
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...connections].sort((a, b) => (ranks.get(a.provider) ?? order.length) - (ranks.get(b.provider) ?? order.length));
}
