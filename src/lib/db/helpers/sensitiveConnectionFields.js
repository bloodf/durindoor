// SEC-B-02: credential fields that must be AES-256-GCM-encrypted at rest
// inside providerConnections.data. All other fields stay plaintext.
//
// Zero-dependency constant so migrations can encrypt legacy rows without
// importing connectionsRepo.js (which pulls in the fallback-scope/provider
// registry chain and its Kimchi user-agent side effects at module load).
export const SENSITIVE_CONNECTION_FIELDS = Object.freeze([
  "accessToken",
  "refreshToken",
  "apiKey",
  "idToken",
  "firecrawlHeaders",
]);
