import { getApiKeyProviderConnectionIds, getProviderConnections } from "@/lib/localDb";
import { createChatGptPlanAccounts } from "@/lib/oauth/chatgptPlanAccounts.js";
import { listChatgptPlanModels } from "open-sse/providers/chatgpt-plan/index.js";
import { executeChatgptPlan } from "open-sse/executors/chatgpt-plan.js";
import { resolveCredentialProxyOptions } from "open-sse/services/oauthCredentialManager.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { projectProviderCredentials } from "./auth.js";
import { resolveChatgptPlanAccess } from "./chatgptPlanAccess.js";

const provider = "chatgpt-plan";

function sameBinding(left, right) {
  return left.connectionId === right.connectionId && left.revision === right.revision &&
    left.account.id === right.account.id && left.account.issuer === right.account.issuer &&
    left.account.subject === right.account.subject && left.account.clientId === right.account.clientId;
}

export async function resolveChatgptPlanDispatch({
  planRequest, providerRegistered, preferredConnectionId, comboRouting, signal,
}) {
  const ownerOperatedEnabled = process.env.DURINDOOR_CHATGPT_PLAN_ENROLLMENT === "1";
  const key = planRequest?.verifiedKey;
  if (!ownerOperatedEnabled || !providerRegistered || !key?.id || key.isActive !== true || signal?.aborted) return null;

  async function resolveScope() {
    const [ids, rows] = await Promise.all([
      getApiKeyProviderConnectionIds(key.id),
      getProviderConnections({ provider, isActive: true }),
    ]);
    const allowedConnectionIds = ids.filter((id) =>
      comboRouting?.restrictionApplied !== true || comboRouting.allowedConnectionIds?.includes(id)
    );
    const pin = planRequest.binding?.connectionId ?? preferredConnectionId;
    if (preferredConnectionId && preferredConnectionId !== pin) return null;
    const candidates = rows.filter((row) =>
      row.provider === provider && row.isActive === true && row.authType === "oauth" &&
      allowedConnectionIds.includes(row.id) && (!pin || pin === row.id)
    );
    if (candidates.length !== 1) return null;
    const [selectedConnection] = candidates;
    const accountSelection = selectedConnection.providerSpecificData?.chatgptPlanAccount;
    if (!accountSelection) return null;
    const { id, issuer, subject, clientId } = accountSelection;
    const binding = {
      connectionId: selectedConnection.id,
      account: { id, issuer, subject, clientId },
      revision: selectedConnection.providerSpecificData.chatgptPlanBindingRevision,
    };
    if (planRequest.binding && !sameBinding(planRequest.binding, binding)) return null;
    return {
      selectedConnection,
      binding,
      accessInput: {
        verifiedKey: { id: key.id, isActive: key.isActive, providerConnectionIds: ids },
        allowedConnectionIds,
        selectedConnection,
        accountSelection: binding.account,
        ownerOperatedEnabled,
        providerRegistered,
      },
    };
  }

  const scope = await resolveScope();
  if (!scope || signal?.aborted) return null;

  // Resolve persisted egress with the same proxy projection as ordinary OAuth.
  // A relay terminates TLS and receives bearer headers, so it cannot carry
  // these private credentials.
  const projected = await projectProviderCredentials(scope.selectedConnection);
  const proxy = resolveCredentialProxyOptions(projected);
  if (proxy.vercelRelayUrl) return null;

  const fetch = (url, options, requestSignal = signal) => proxyAwareFetch(url, {
    ...options,
    redirect: "error",
    signal: requestSignal && options.signal
      ? AbortSignal.any([requestSignal, options.signal])
      : requestSignal || options.signal,
  }, proxy);

  // Fusion leaves can overlap while reading the private account. Commit the
  // validated binding synchronously before either refresh or inference.
  function bindAccount() {
    if (planRequest.binding && !sameBinding(planRequest.binding, scope.binding)) return false;
    planRequest.binding = scope.binding;
    return true;
  }

  async function refreshBoundAccount(refreshSignal) {
    if (planRequest.refreshAttempted || refreshSignal?.aborted) return false;
    const current = await resolveScope();
    if (!current || !sameBinding(current.binding, scope.binding) ||
        planRequest.refreshAttempted || refreshSignal?.aborted || !bindAccount()) return false;
    planRequest.refreshAttempted = true;
    const refreshAccounts = createChatGptPlanAccounts({
      fetchAdapter: (url, options) => fetch(url, options, refreshSignal),
    });
    await refreshAccounts.refresh(scope.binding.account);
    return !refreshSignal?.aborted && Boolean(await resolveScope());
  }

  let accounts;
  let access;
  try {
    accounts = createChatGptPlanAccounts({ fetchAdapter: fetch });
    access = await resolveChatgptPlanAccess({
      ...scope.accessInput, accounts, renewExpired: () => refreshBoundAccount(signal),
    });
  } catch {
    return null;
  }
  if (!access || signal?.aborted || !bindAccount()) return null;

  return {
    connectionId: scope.binding.connectionId,
    async listModels() {
      return listChatgptPlanModels({ ...access, signal, fetch });
    },
    credentials: {
      authType: "oauth",
      connectionName: projected.connectionName,
      accessToken: access.connection.accessToken,
    },
    executorOverride: {
      targetFormat: FORMATS.OPENAI_RESPONSES,
      forceStream: true,
      shouldRefreshAfterAuthFailure: ({ statusCode }) => statusCode === 401,
      async execute({ model, body, signal: providerSignal }) {
        const response = await executeChatgptPlan({
          ...access,
          model,
          body,
          stream: true,
          signal: providerSignal,
          fetch,
        });
        return { response, terminalProvenance: "validated" };
      },
    },
    async refreshCredentials({ signal: refreshSignal }) {
      if (planRequest.refreshAttempted || refreshSignal?.aborted) return null;
      const current = await resolveScope();
      if (!current || planRequest.refreshAttempted || refreshSignal?.aborted) return null;
      const currentAccess = await resolveChatgptPlanAccess({ ...current.accessInput, accounts });
      if (!currentAccess || !await refreshBoundAccount(refreshSignal)) return null;
      const refreshed = await resolveScope();
      if (!refreshed || refreshSignal?.aborted) return null;
      const refreshedAccess = await resolveChatgptPlanAccess({ ...refreshed.accessInput, accounts });
      if (!refreshedAccess) return null;
      access = refreshedAccess;
      return { accessToken: access.connection.accessToken };
    },
  };
}
