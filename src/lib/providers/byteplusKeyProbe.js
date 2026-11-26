// Upstream #5861: ModelArk answers plan and model errors (403 AccessDenied, 400
// InvalidSubscription, 404 ModelNotOpen) for a good key. Only a 401 or an
// auth-shaped body says the key itself was rejected.
const KEY_REJECTED = /AuthenticationError|InvalidApiKey|(invalid|incorrect)[\s_-]*api[\s_-]*key|unauthorized/i;

export async function isByteplusKeyAccepted(response) {
  if (response.status === 401) return false;
  if (response.ok) return true;
  const body = await response.clone().text().catch(() => "");
  return !KEY_REJECTED.test(body);
}
