# Safe media credential checks (#2034)

The add/edit validation route no longer derives probes from media inference
configuration. Its fallback returns `{valid:false, skipped:true}` without network
traffic. The dashboard permits storage and describes the credential as unverified.
Skipped responses cannot set active status, including older provider-specific
responses that also set valid=true. Existing failed/unavailable edit semantics
are preserved.

Primary references inspected on 2026-11-27:

- deAPI: https://docs.deapi.ai/api/v2/keys/get-current-key — GET
  `https://api.deapi.ai/api/v2/key`, Bearer auth, both ADMIN/API roles. Unlike
  balance, this does not require an ADMIN key.
- Deepgram: https://developers.deepgram.com/reference/manage/projects/list — GET
  `https://api.deepgram.com/v1/projects`, Token auth; projects belonging to the key.
- ElevenLabs: https://elevenlabs.io/docs/api-reference/user/get and
  https://elevenlabs.io/docs/api-reference/authentication — GET
  `https://api.elevenlabs.io/v1/user`, xi-api-key auth; account information.

The new reads have fixed origins, manual redirects, a ten-second deadline and
caller cancellation. They discard account bodies and return canned errors.
Public model lists are not introduced as credential checks. AssemblyAI's existing
transcript-list check stays reachable. Fal and HuggingFace remain before fallback;
redirects and caller cancellation are applied to their existing checks.

Protected Fal tests require exact transient payloads without unavailable=true and
network errors as URL validation failed. Those assertions remain unchanged; this
patch preserves that legacy contract rather than weakening it. Saved-connection
batch testing and inference adapters are outside this change.

No upstream implementation was ported. Validation uses offline mocked transport,
the real validation route and rendered dashboard forms. No live provider account,
inference request or browser is needed. Stories are unchanged.
