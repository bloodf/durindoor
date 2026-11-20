# 1073: OpenCode endpoint unavailable

Source: [OmniRoute #15474](https://github.com/cheaper-inference/OmniRoute/pull/15474), merged at `71cc6360c5336f070b1cfccc502c3c3f0c88b90d`. The merged change adds a five-minute model cooldown for the endpoint-unavailable phrase on HTTP 400 and 429. The current source PR and merge commit were inspected; this is an applicable gap, adapted to the local structured-error classifier and bounded catalog lock resolver. No provider or model was added.

The built-in rule examines the error envelope message for the three existing OpenCode providers. Operator rules retain priority; terminal billing and explicit exhausted-quota evidence retain their existing account handling. The existing retry-delay and reset policies determine the effective stored deadline, and unknown model IDs retain the bounded account-wide fallback key.

The existing free-tier static policy caps the automatic `opencode` lock at one minute; configured retry delays and authoritative resets retain precedence. The other two providers use the five-minute rule by default.

Local evidence: `test -s internal/docs/port-reports/1073-opencode-model-unavailable.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-opencode-model-unavailable.test.js)` passed 11 deterministic classifier and auth-store tests without provider requests.
