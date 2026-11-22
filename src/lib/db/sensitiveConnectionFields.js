// SEC-B-02: credential fields that must be AES-256-GCM-encrypted at rest
// inside providerConnections.data. All other fields stay plaintext.
// Leaf module so schema migrations can encrypt these fields without loading
// the connection repository (and, through it, the provider registry).
export const SENSITIVE_CONNECTION_FIELDS = Object.freeze([
  "accessToken",
  "refreshToken",
  "apiKey", "managementApiKey",
  "idToken",
  "firecrawlHeaders",
  // STS session token for temporary AWS keys (Bedrock static-key mode).
  "sessionToken",
]);
