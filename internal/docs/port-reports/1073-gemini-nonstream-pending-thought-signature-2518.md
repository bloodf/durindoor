# #1073: Gemini non-streaming pending thought signature

Port of the narrow non-streaming Gemini thought-signature behavior from OmniRoute #2518, head `b2317fed979379a23b380fabdd60362367684eb7`, merge `caefdfa9715e8d6e8e563bf309b5c8e550dfadf9`. The exact head captures a signature attached to a `functionCall` part. DurinDoor additionally retains a signature from a preceding thinking-only part in the selected candidate, for the next function call only.

The adapter still prefers a call part's own `thoughtSignature` or `thought_signature`; otherwise it consumes the pending signature. The existing signature transport ID encoding and OpenAI-to-Gemini request replay are reused. No signature is copied to later calls or held outside this response conversion. Raw function-call IDs, arguments, text, streaming and native paths, and the no-signature fallback remain unchanged.

Offline fixtures use opaque deterministic signature strings. Coverage exercises both signature spellings, exact adapter output, request replay, direct-signature precedence, one-time consumption and isolation across calls and separate adapter invocations. No provider traffic or credentials are used.

Evidence:

```sh
test -s internal/docs/port-reports/1073-gemini-nonstream-pending-thought-signature-2518.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 translator/omni-gemini-nonstream-pending-thought-signature.test.js translator/bugs-antigravity.test.js translator/gemini-thought-signature.test.js translator/gemini-thought-signature-store.test.js)
```

Refs #1073
