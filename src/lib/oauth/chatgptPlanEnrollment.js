import { randomUUID } from "node:crypto";
import { startChatGptPlanLoopback } from "./chatgptPlanLoopback.js";

// The only client-visible attempt identifier is random; the connection snapshot,
// authenticated principal and verified private selection remain server-side.
export function createChatGptPlanEnrollment({ accounts, repository, startLoopback = startChatGptPlanLoopback }) {
  const pending = new Map();
  async function connection(id) {
    const row = await repository.get(id);
    if (!row || row.provider !== "chatgpt-plan" || row.authType !== "oauth") throw new Error("invalid_connection");
    return row;
  }
  function owned(id, actor) {
    const attempt = pending.get(id);
    if (!attempt || attempt.actor !== actor) throw new Error("unknown_attempt");
    return attempt;
  }
  return {
    async create(name) {
      return repository.create({ provider: "chatgpt-plan", authType: "oauth", name, isActive: false }, { createOnly: true });
    },
    async start(id, actor) {
      const row = await connection(id);
      const selection = row.providerSpecificData?.chatgptPlanAccount;
      const expected = { snapshot: JSON.stringify(row), selection: selection ? { ...selection } : null };
      const attempt = { actor, active: true, status: "pending" };
      const flow = await startLoopback(accounts, { selection });
      attempt.cancel = flow.cancel;
      const attemptId = randomUUID();
      pending.set(attemptId, attempt);
      const expiry = setTimeout(() => { attempt.active = false; attempt.cancel(); pending.delete(attemptId); }, 660_000);
      expiry.unref();
      attempt.expiry = expiry;
      flow.result.then(async (verified) => {
        const applied = await repository.bind(id, expected, verified, () => attempt.active);
        if (!applied) throw new Error("stale_connection");
        attempt.status = "complete";
      }).catch(() => { attempt.status = attempt.active ? "failed" : "cancelled"; });
      return { attemptId, authorizationUrl: flow.authorizationUrl };
    },
    status(id, actor) {
      const attempt = owned(id, actor);
      const status = attempt.status;
      if (status !== "pending") { clearTimeout(attempt.expiry); pending.delete(id); }
      return { status };
    },
    cancel(id, actor) {
      const attempt = owned(id, actor);
      attempt.active = false;
      attempt.cancel();
      clearTimeout(attempt.expiry);
      pending.delete(id);
    },
    async signOut(id, localOnly) {
      const row = await connection(id);
      if (!row.providerSpecificData?.chatgptPlanAccount) throw new Error("account_missing");
      return accounts.signOut(row.providerSpecificData.chatgptPlanAccount, { localOnly });
    },
  };
}
