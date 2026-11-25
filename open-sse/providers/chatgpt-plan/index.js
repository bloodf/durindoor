import { isString } from "../../../src/shared/utils/typeChecks.js";

// Private transport contract; the registry exposes only the guarded owner-operated identity.
// Source: OmniRoute b748429cf5b3aeb142a708fd3e8751b6918b9dc8,
// open-sse/config/providers/registry/chatgpt/index.ts.
export const chatgptPlan = Object.freeze({
  id: "chatgpt-plan", format: "openai-responses", authType: "oauth", models: Object.freeze([]),
});

export function authorizeChatgptPlan(connection, grant) {
  if (connection?.credentialClass !== "chatgpt-plan-oauth" ||
      !isString(connection.accessToken) || !connection.accessToken.trim() ||
      !isString(connection.id) || !connection.id.trim() ||
      grant?.allowed !== true || grant.connectionId !== connection.id ||
      !isString(grant.accountId) || !grant.accountId.trim() ||
      connection.accountId !== grant.accountId) {
    throw new Error("ChatGPT plan connection is not authorized");
  }
}

export async function listChatgptPlanModels({ connection, grant, signal, fetch: fetchImpl = globalThis.fetch }) {
  authorizeChatgptPlan(connection, grant);
  const response = await fetchImpl("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${connection.accessToken}` }, signal, redirect: "error",
  });
  if (!response.ok) throw new Error(`ChatGPT model catalog failed (${response.status})`);
  const catalog = await response.json();
  if (!Array.isArray(catalog?.models)) throw new Error("Invalid ChatGPT model catalog");
  return catalog.models.filter((model) => model?.visibility === "list" &&
    isString(model.slug) && model.slug.trim()).map(({ slug, display_name }) => ({ slug, display_name }));
}
