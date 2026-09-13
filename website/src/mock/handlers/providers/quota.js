// Per-connection quota (/api/usage/:connectionId), Codex reset credits and
// TTS voice listings.
import { reply, notFound, badRequest } from "../../http.js";
import { quotaSnapshot, codexCredits } from "../../fixtures/providers/quota.js";
import { ttsVoiceListing } from "../../fixtures/providers/catalog.js";
import { CONNECTIONS, RESET_CREDITS } from "./shared.js";

function creditCount(store, connectionId) {
  return (store.get(RESET_CREDITS) || {})[connectionId] ?? 0;
}

function codexConnection(store, connectionId) {
  const connection = store.find(CONNECTIONS, connectionId);
  if (!connection) return { error: notFound("Connection not found") };
  if (connection.provider !== "codex") return { error: badRequest("Codex reset credits are only available for Codex connections.") };
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
    return quotaSnapshot(connection, creditCount(store, connection.id));
  });

  router.get("/api/usage/:connectionId/codex-reset-credits", ({ params }) => {
    const { connection, error } = codexConnection(store, params.connectionId);
    return error || codexCredits(creditCount(store, connection.id));
  });

  router.post("/api/usage/:connectionId/codex-reset-credits", ({ params }) => {
    const { connection, error } = codexConnection(store, params.connectionId);
    if (error) return error;
    const available = creditCount(store, connection.id);
    if (available <= 0) {
      return reply({ code: "no_credit", reset: false, windows_reset: 0, message: "No Codex reset credits available." }, { status: 409 });
    }
    store.update(RESET_CREDITS, (all = {}) => ({ ...all, [connection.id]: available - 1 }));
    if (connection.testStatus === "unavailable") {
      const locks = Object.fromEntries(Object.keys(connection).filter((key) => key.startsWith("modelLock_")).map((key) => [key, null]));
      store.patch(CONNECTIONS, connection.id, { ...locks, testStatus: "active", lastError: null, lastErrorAt: null, errorCode: null, rateLimitedUntil: null, backoffLevel: 0 });
    }
    const credit = codexCredits(available).credits[0] || null;
    return { code: "ok", reset: true, windows_reset: 2, redeemRequestId: store.newId("redeem"), credit };
  });

  router.get("/api/media-providers/tts/voices", voices);
  router.get("/api/media-providers/tts/:provider/voices", voices);
}
