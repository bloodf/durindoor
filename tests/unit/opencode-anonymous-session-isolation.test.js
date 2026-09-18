import { describe, expect, it } from "vitest";

import { OpenCodeExecutor, OPENCODE_REQUEST_RE, OPENCODE_SESSION_RE } from "../../open-sse/executors/opencode.js";

// HIGH finding on the opencode free-tier stack: every no-auth caller shares
// the literal connectionId "noauth" (src/sse/services/auth.js
// buildNoAuthCredential/buildOptionalNoAuthCredential), so on a first turn
// with no client session hint, trustedSessionKey (and chatCore's own
// resolveSessionId(connectionId) fallback) collapse to the same source for
// every anonymous caller. Folding in the unspoofable peer IP (already
// trusted for free-tier rate-limit bucketing, PR #3321) narrows that
// collision to "callers sharing one public IP" — a real, documented
// mitigation, not a full fix.
describe("OpenCodeExecutor anonymous session isolation", () => {
  const anonymousCredentials = (ip) => ({
    id: "noauth",
    connectionId: "noauth",
    rawHeaders: ip ? { "x-9r-real-ip": ip } : {},
  });

  it("gives two anonymous callers on different public IPs different sessions", () => {
    const executor = new OpenCodeExecutor();
    const a = executor.prepareRequestCredentials({ credentials: anonymousCredentials("203.0.113.10") });
    const b = executor.prepareRequestCredentials({ credentials: anonymousCredentials("198.51.100.20") });
    expect(a._opencodeSession).toMatch(OPENCODE_SESSION_RE);
    expect(a._opencodeSession).not.toBe(b._opencodeSession);
  });

  // #917: x-opencode-request is derived from the session id, so the peer-IP
  // isolation above must carry through to it too, not just to the session —
  // otherwise two anonymous callers on different IPs would get different
  // sessions but the identical request id on their first ("hi") turn.
  it("gives two anonymous callers on different public IPs different request ids too, for the identical turn text", () => {
    const executor = new OpenCodeExecutor();
    const body = { messages: [{ role: "user", content: "hi" }] };
    const a = executor.prepareRequestCredentials({ body, credentials: anonymousCredentials("203.0.113.10") });
    const b = executor.prepareRequestCredentials({ body, credentials: anonymousCredentials("198.51.100.20") });
    expect(a._opencodeRequest).toMatch(OPENCODE_REQUEST_RE);
    expect(a._opencodeRequest).not.toBe(b._opencodeRequest);
    expect(a._opencodeSession).not.toBe(b._opencodeSession);
  });

  it("is stable for the same anonymous caller (same public IP), same request id on a retry", () => {
    const executor = new OpenCodeExecutor();
    const body = () => ({ messages: [{ role: "user", content: "run the deploy" }] });
    const first = executor.prepareRequestCredentials({ body: body(), credentials: anonymousCredentials("203.0.113.10") });
    const retry = executor.prepareRequestCredentials({ body: body(), credentials: anonymousCredentials("203.0.113.10") });
    expect(first._opencodeSession).toBe(retry._opencodeSession);
    expect(first._opencodeRequest).toBe(retry._opencodeRequest);
  });

  it("is stable for the same anonymous caller (same public IP) across requests", () => {
    const executor = new OpenCodeExecutor();
    const first = executor.prepareRequestCredentials({ credentials: anonymousCredentials("203.0.113.10") });
    const second = executor.prepareRequestCredentials({ credentials: anonymousCredentials("203.0.113.10") });
    expect(first._opencodeSession).toBe(second._opencodeSession);
  });

  it("documents the residual collision: two anonymous callers sharing one public IP still share a session", () => {
    const executor = new OpenCodeExecutor();
    const a = executor.prepareRequestCredentials({ credentials: anonymousCredentials("203.0.113.10") });
    const b = executor.prepareRequestCredentials({ credentials: anonymousCredentials("203.0.113.10") });
    expect(a._opencodeSession).toBe(b._opencodeSession);
  });

  it("documents the residual collision: anonymous callers with no forwarded/public IP still share a session", () => {
    const executor = new OpenCodeExecutor();
    // No x-9r-real-ip/x-real-ip header at all (e.g. no reverse proxy stamping it).
    const a = executor.prepareRequestCredentials({ credentials: anonymousCredentials(null) });
    const b = executor.prepareRequestCredentials({ credentials: anonymousCredentials(null) });
    expect(a._opencodeSession).toBe(b._opencodeSession);
  });

  it("ignores the peer IP for a real (non-noauth) connection identity", () => {
    const executor = new OpenCodeExecutor();
    const credentialsWithIp = (ip, connectionId) => ({ connectionId, rawHeaders: { "x-9r-real-ip": ip } });
    const a = executor.prepareRequestCredentials({ credentials: credentialsWithIp("203.0.113.10", "account-a") });
    const b = executor.prepareRequestCredentials({ credentials: credentialsWithIp("198.51.100.20", "account-a") });
    // Same real account, different (irrelevant) peer IP -> still the same session.
    expect(a._opencodeSession).toBe(b._opencodeSession);
  });
});
