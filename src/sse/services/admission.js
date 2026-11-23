import { getSettings } from "@/lib/localDb";
import { resolveClientApiKey } from "./auth.js";
import { annotateClientAdmissionFailure } from "open-sse/services/operationalMetrics.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

/** Admit a public API request with the configured client-key policy. */
export async function admit(request, { kind, respond = errorResponse } = {}) {
  const settings = await getSettings();
  const { apiKey, auth } = await resolveClientApiKey(request, {
    required: settings.requireApiKey === true,
  });
  const message = auth.reason === "missing" ? "Missing API key" : "Invalid API key";
  const error = auth.ok ? null : annotateClientAdmissionFailure(
    respond(HTTP_STATUS.UNAUTHORIZED, message),
    message === "Missing API key" ? "auth_missing" : "auth_invalid",
  );
  return { kind, settings, apiKey, auth, error };
}
