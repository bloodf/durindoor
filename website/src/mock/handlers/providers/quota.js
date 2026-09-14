// Per-connection quota (/api/usage/:connectionId), Codex reset credits and
// TTS voice listings.
import { reply, notFound, badRequest } from "../../http.js";
import { quotaSnapshot } from "../../fixtures/providers/quota.js";
import { ttsVoiceListing } from "../../fixtures/providers/catalog.js";
import { CONNECTIONS } from "./shared.js";

function readQuota(store, connection) {
  const snapshot = quotaSnapshot(connection);
  if (!connection.demoQuota) store.patch(CONNECTIONS, connection.id, { demoQuota: snapshot });
  return snapshot;
}

function codexConnection(store, connectionId) {
  const connection = store.find(CONNECTIONS, connectionId);
  if (!connection) return { error: notFound("Connection not found") };
  if (connection.provider !== "codex") return { error: badRequest("Codex reset credits are only available for Codex connections.") };
  if (!["oauth", "access_token"].includes(connection.authType)) {
    return { error: badRequest("Codex reset credits require an OAuth or access-token connection.") };
  }
  return { connection };
}

function voices({ params, query }) {
  const provider = params.provider || query.provider || "edge-tts";
  const listing = ttsVoiceListing(provider === "minimax-cn" ? "minimax" : provider);
  if (query.lang) return { voices: listing.byLang[query.lang]?.voices || [] };
  return params.provider ? { languages: listing.languages, byLang: listing.byLang } : listing;
}

export default function registerQuota(router, { store }) {
  router.get("/api/usage/:connectionId", ({ params }) => {
    const connection = store.find(CONNECTIONS, params.connectionId);
    if (!connection) return notFound("Connection not found");
    return readQuota(store, connection);
  });

  router.get("/api/usage/:connectionId/codex-reset-credits", ({ params }) => {
    const { connection, error } = codexConnection(store, params.connectionId);
    return error || readQuota(store, connection).resetCredits;
  });

  router.post("/api/usage/:connectionId/codex-reset-credits", ({ params }) => {
    const { connection, error } = codexConnection(store, params.connectionId);
    if (error) return error;
    const snapshot = quotaSnapshot(connection);
    const available = snapshot.resetCredits.credits.filter((credit) => credit.status === "available");
    if (available.length === 0) {
      return reply({ code: "no_credit", reset: false, windows_reset: 0, message: "No Codex reset credits available." }, { status: 409 });
    }
    const now = new Date().toISOString();
    const credit = { ...available[0], status: "consumed", consumedAt: now };
    const quotas = Object.fromEntries(Object.entries(snapshot.quotas).map(([name, window]) => [
      name,
      {
        ...window,
        used: 0,
        remaining: window.total,
        ...(window.remainingPercentage !== undefined ? { remainingPercentage: 100 } : null),
      },
    ]));
    const demoQuota = {
      ...snapshot,
      quotas,
      limitReached: false,
      reviewLimitReached: false,
      sparkLimitReached: false,
      resetCredits: {
        availableCount: available.length - 1,
        credits: snapshot.resetCredits.credits.map((item) => item.id === credit.id ? credit : item),
      },
    };
    // One immutable collection write keeps balance, usage and cooldown state
    // together in memory and localStorage. Rejections above never write.
    const locks = Object.fromEntries(Object.keys(connection).filter((key) => key.startsWith("modelLock_")).map((key) => [key, null]));
    store.patch(CONNECTIONS, connection.id, {
      ...locks, demoQuota, testStatus: "active", lastError: null, lastErrorType: null,
      lastErrorAt: null, errorCode: null, rateLimitedUntil: null, backoffLevel: 0, updatedAt: now,
    });
    return { code: "ok", reset: true, windows_reset: Object.keys(quotas).length, redeemRequestId: store.newId("redeem"), credit };
  });

  router.get("/api/media-providers/tts/voices", voices);
  router.get("/api/media-providers/tts/:provider/voices", voices);
}
