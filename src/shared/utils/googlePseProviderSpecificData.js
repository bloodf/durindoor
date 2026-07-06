const GOOGLE_PSE_PROVIDER_ID = "google-pse";

export function isGooglePseProvider(provider) {
  return provider === GOOGLE_PSE_PROVIDER_ID;
}

export function normalizeGooglePseCx(cx) {
  return typeof cx === "string" ? cx.trim() : "";
}

export function buildGooglePseProviderSpecificData(cx, existingProviderSpecificData = null) {
  const normalizedCx = normalizeGooglePseCx(cx);
  if (!normalizedCx) return undefined;

  return {
    ...((existingProviderSpecificData && typeof existingProviderSpecificData === "object")
      ? existingProviderSpecificData
      : {}),
    cx: normalizedCx,
  };
}

export function buildGooglePseValidationPayload(provider, apiKey, cx, existingProviderSpecificData = null) {
  const payload = { provider, apiKey };
  if (isGooglePseProvider(provider)) {
    const providerSpecificData = buildGooglePseProviderSpecificData(cx, existingProviderSpecificData);
    if (providerSpecificData) payload.providerSpecificData = providerSpecificData;
  }
  return payload;
}
