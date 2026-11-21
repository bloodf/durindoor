import { createHash, randomUUID } from "node:crypto";
import { linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isString } from "../../shared/utils/typeChecks.js";
import { getDataDir } from "../dataDir.js";
import {
  compareAndSwapPrivateChatGptPlanAccount,
  readPrivateChatGptPlanAccount,
} from "../db/repos/connectionsRepo.js";
import { createChatGptPlanProtocol, startChatGptPlanAuthorization } from "./chatgptPlanProtocol.js";

const provider = "chatgpt-plan";
const issuer = "https://auth.openai.com";
const tokenFields = ["accessToken", "refreshToken", "idToken"];

function fail(code) {
  throw Object.assign(new Error(`ChatGPT plan account: ${code}`), { code });
}

function stableHostId() {
  const target = join(getDataDir(), "chatgpt-plan-host-id");
  function read() {
    const value = readFileSync(target, "utf8");
    if (!/^urn:uuid:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)) fail("invalid_host_id");
    return value;
  }
  try {
    return read();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const value = `urn:uuid:${randomUUID()}`;
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, value, { flag: "wx", mode: 0o600, flush: true });
    linkSync(temporary, target);
    return value;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return read();
  } finally {
    rmSync(temporary, { force: true });
  }
}

function accountId(clientId) {
  return createHash("sha256").update(clientId).digest("hex");
}

function identityMatches(record, selection) {
  return record?.issuer === issuer && selection?.issuer === issuer &&
    isString(record.subject) && Boolean(record.subject.trim()) &&
    record.subject === selection.subject && /^oaiapp_[A-Za-z0-9_-]{1,256}$/.test(record.clientId) &&
    record.clientId === selection.clientId;
}

function toRecord(row) {
  const record = { ...row.providerSpecificData };
  for (const field of tokenFields) record[field] = row[field];
  record.email = row.email ?? undefined;
  record.planEnabled = record.scopes.includes("chatgpt.tokens.use.direct") && record.scopes.includes("resource.invoke");
  return record;
}

function toRow(id, record, existing) {
  const now = new Date().toISOString();
  const { issuer, subject, clientId, hostId, tokenType, scopes, expiresAt, earliestRefreshAt, savedAt } = record;
  return {
    id, provider, authType: "oauth", isActive: false, email: record.email,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
    revision: randomUUID(),
    accessToken: record.accessToken, refreshToken: record.refreshToken, idToken: record.idToken,
    providerSpecificData: {
      issuer, subject, clientId, hostId, tokenType, scopes: [...scopes], expiresAt, earliestRefreshAt, savedAt,
    },
  };
}

function withoutSession(row) {
  const next = { ...row, revision: randomUUID(), operation: undefined };
  for (const field of tokenFields) delete next[field];
  next.providerSpecificData = {
    ...row.providerSpecificData, scopes: [], tokenType: null,
    expiresAt: null, earliestRefreshAt: null, savedAt: null,
  };
  return next;
}

export function createChatGptPlanAccounts({ fetchAdapter, clock = Date.now }) {
  const protocol = createChatGptPlanProtocol({ fetchAdapter, clock });
  const hostId = stableHostId();
  const pending = new WeakMap();

  async function selectedRow(selection) {
    if (!isString(selection?.id) || !/^[a-f0-9]{64}$/.test(selection.id)) fail("account_mismatch");
    const row = await readPrivateChatGptPlanAccount(selection.id);
    if (!identityMatches(row?.providerSpecificData, selection) ||
        selection.id !== accountId(selection.clientId) || row.providerSpecificData.hostId !== hostId) {
      fail("account_mismatch");
    }
    return row;
  }

  async function commit(expected, next) {
    if (!await compareAndSwapPrivateChatGptPlanAccount(next.id, expected, next)) fail("stale_session");
  }

  async function claim(row, operation) {
    if (row.operation) fail("session_claimed");
    const next = { ...row, operation, revision: randomUUID() };
    await commit(row, next);
    return next;
  }

  return {
    hostId,

    async beginAuthorization({ redirectUri, selection }) {
      const row = selection === undefined ? null : await selectedRow(selection);
      const { attempt, authorizationUrl } = startChatGptPlanAuthorization({
        redirectUri, hostId, registration: row ? toRecord(row) : undefined,
      }, clock());
      const handle = Object.freeze({});
      pending.set(handle, { attempt, row });
      return { handle, authorizationUrl };
    },

    async finishAuthorization(handle, callbackUrl) {
      const authorization = pending.get(handle);
      if (!authorization) fail("unknown_attempt");
      pending.delete(handle);
      const { attempt, row } = authorization;
      const record = await protocol.exchangeCode(attempt, callbackUrl);
      if (row && !identityMatches(record, row.providerSpecificData)) fail("account_mismatch");
      const id = row?.id ?? accountId(record.clientId);
      await commit(row, toRow(id, record, row));
      return { id, issuer: record.issuer, subject: record.subject, clientId: record.clientId };
    },

    async readAccount(selection) {
      const row = await selectedRow(selection);
      return { ...toRecord(row), id: row.id, operation: row.operation ?? null };
    },

    async refresh(selection) {
      const row = await selectedRow(selection);
      if (!row.refreshToken) fail("no_refresh_token");
      if (clock() < row.providerSpecificData.earliestRefreshAt) fail("refresh_too_early");
      const claimed = await claim(row, "refresh");
      // A failed request can already have rotated the token. Leave the claim
      // in place until a fresh authorization replaces this session.
      const record = await protocol.refresh(toRecord(claimed));
      await commit(claimed, toRow(row.id, record, claimed));
      return { ...record, id: row.id, operation: null };
    },

    async signOut(selection, { localOnly = false } = {}) {
      const row = await selectedRow(selection);
      if (localOnly || !row.refreshToken) {
        await commit(row, withoutSession(row));
        return { revocation: row.refreshToken ? "unconfirmed" : "not_required" };
      }
      const claimed = await claim(row, "revoke");
      try {
        await protocol.revoke(toRecord(claimed));
      } catch (error) {
        // Revocation is idempotent. Release a failed attempt for a later retry
        // only if this is still the selected session.
        await commit(claimed, { ...row, revision: randomUUID() });
        throw error;
      }
      await commit(claimed, withoutSession(claimed));
      return { revocation: "confirmed" };
    },

    async detachForVm(selection) {
      const row = await selectedRow(selection);
      if (row.operation) fail("session_claimed");
      if (!row.refreshToken) fail("no_refresh_token");
      await commit(row, withoutSession(row));
      return { ...toRecord(row), id: row.id };
    },

    async bindFromOwnerTransfer(selection, record) {
      // The owner must authenticate the transfer from the source runtime.
      if (!identityMatches(record, selection) || selection.id !== record.id ||
          record.id !== accountId(record.clientId) || record.tokenType !== "Bearer" ||
          !Number.isSafeInteger(record.savedAt) || !Number.isSafeInteger(record.expiresAt) ||
          record.expiresAt <= record.savedAt ||
          (record.earliestRefreshAt !== null &&
            (!Number.isSafeInteger(record.earliestRefreshAt) || record.earliestRefreshAt < 0)) ||
          (record.email !== undefined && !isString(record.email)) ||
          !Array.isArray(record.scopes) || !record.scopes.every((scope) =>
            isString(scope) && /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope)) ||
          !tokenFields.every((field) => isString(record[field]) && record[field])) {
        fail("account_mismatch");
      }
      await commit(null, toRow(record.id, { ...record, hostId }));
    },
  };
}
