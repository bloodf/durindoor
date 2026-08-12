# Upstream #3241 — Responses Namespace Tools — 2026-08-11

Scope: [`decolua/9router` PR #3241](https://github.com/decolua/9router/pull/3241),
`feat(translator): support Responses namespace tools across Chat providers`.

| Change | Verdict | Fork action |
| --- | --- | --- |
| Expand Responses `type: "namespace"` tools for Chat providers | PORTED | Emit one Chat function per declared subtool, named `namespace.subtool`. |
| Reconstruct `namespace` on Responses function calls | PORTED | `initState` records declared namespace subtools in request-scoped `toolNamespaces`; response projection splits both qualified and declared flat names. |
| Upstream global maps (`globalThis.__CB_TOOL_MAP__`, `globalThis.__CB_NS_TOOLS__`) | REJECTED | They leak tool declarations across concurrent requests. Fork keeps mappings only in translator state. |
| Dot-to-`__` function-name sanitization | NOT PORTED | No fork provider path proved dotted names invalid; preserve the reversible `namespace.subtool` transport name. |

## Verification

- `tests/translator/port-3241-namespace-tools.test.js`: 5 passed, including independent request-state namespace routing.
- `tests/translator/port-6937-responses-toolcall-shape.test.js`: 8 passed.
