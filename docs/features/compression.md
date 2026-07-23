# Compression

DurinDoor can reduce the size of outbound prompts before they are sent to upstream providers. Compression runs after translation and before provider dispatch, operating on the translated request body. It is opt-in and fail-open: a failure at any point returns the original body and does not break the request.

## Compression seam

The single execution path is \"runCompressionSeam\" in the chat core. There is no parallel inline loop. The stack runs after RTK/Headroom and before any pxpipe injection when compression is enabled. Engines never mutate the caller's body; each step works on a fresh value, so a failed step can be rolled back without affecting the original request.

## Studio controls

The dashboard has two related compression surfaces:

- \"/dashboard/compression\" (Compression Studio V2) renders the pipeline editor. Modes include off, lite, standard, aggressive, ultra, rtk, stacked, and caveman. Selecting \"stacked\" runs the configured stack; selecting \"caveman\" runs only the caveman engine with full intensity.
- \"/dashboard/compression-studio\" (Test Savers) dry-runs engines against an arbitrary payload and reports per-engine savings.

Studio settings are stored in the standard settings row with the \"compressionV2*\" prefix. The legacy \"rtkEnabled\", \"cavemanEnabled\", \"headroomEnabled\", and \"ponytailEnabled\" flags are kept unchanged so installations that do not enable V2 see no behaviour change.

## Supported engines

These engines have a real implementation in this tree and can be dispatched:

| Engine | What it does |
| --- | --- |
| `session-dedup` | Cross-turn block deduplication. |
| `caveman` | Rule-based prose compression. |
| `headroom` | Headroom adapter with its own availability and configuration checks. |

The catalog also names `ccr`, `lite`, `rtk`, `relevance`, `aggressive`, `llmlingua`, and `ultra` as metadata-only placeholders with `available: false`. They can appear in listings and validation errors but are not dispatched. Heavy engines such as LLMLingua/ONNX runtime are not shipped in this tree.


## Bypass header precedence

A client can bypass compression for a single request by sending:

```http
X-DurinDoor-No-Compression: 1
```

If the header is present, the compression seam returns the body untouched and emits no compression header. This header is checked before any engine runs.

## Fail-open behavior

Compression is designed to never break a request:

- Planning error: original body, no compression header.
- Per-engine error, malformed result, or unavailable engine: that step is rolled back, the loop continues.
- Catastrophic seam failure: the chat core restores the pre-stack snapshot and emits no compression header.

## Error-result preservation

The compression engine contract preserves provider-specific error content and tool-result structure. For example, Kiro and AWS CodeWhisperer tool-result text can be rewritten and restored into the original envelope shape, and object outputs are serialized so compression engines can process them and restored as string outputs accepted by the Responses API.

## Configuration

Compression is opt-in via two settings:

- \"compressionEnabled\" (boolean) — master toggle for the legacy seam. When false, \"runCompressionSeam\" returns the body untouched and emits no header.
- \"compressionEngines\" (map) — per-engine config, e.g. \"{ caveman: { enabled: true }, \"session-dedup\": { enabled: true } }\".

V2 settings use the \"compressionV2*\" prefix and are controlled from the dashboard Compression Studio. The default stack is:

```text
rtk (standard) → caveman (full)
```

## Preview endpoint

\"POST /api/compression/preview\" dry-runs the catalog against an arbitrary JSON body and returns a per-id status. The dashboard Test Savers page posts here without a DurinDoor API key; it relies on the dashboard JWT proxy, so the handler does not re-check the global LLM-endpoint API-key requirement.

Status values:

- \"compressed\" / \"unchanged\" — the engine is available and ran. \"compressed\" and \"savingsPercent\" describe the outcome. If the engine fell back, \"fallbackReasons\" lists the deduped reasons, and \"fallbackReason\" is the pipeline's canonical reason or the first entry. Non-fallback runs report empty arrays.
- \"unavailable\" — the engine is a catalog placeholder not shipped in this tree; it is not dispatched.
- \"error\" — the engine is available but its \"apply()\" threw. This is distinct from \"unavailable\".

## Response header

When at least one available engine actually changes the body, the chat response carries:

```http
X-DurinDoor-Compression: <engineId>[,<engineId>...]|<overallSavingsPercent>%
```

Only engines that both reported \"compressed: true\" and changed their step's body are listed. A no-op run, even one that reported \"compressed: true\" with no real change, is not advertised. Disabled, no-op, and upstream-error responses emit no header.

## PXPIPE installation model

PXPIPE (image-compression transform) ships as a direct dependency (\"pxpipe-proxy\" in \"package.json\"). The build script copies it into \".next/standalone/node_modules\", so a normal \"npm install\" + build produces a working PXPIPE out of the box. There is no runtime install endpoint; the former \"/api/pxpipe/install\" route and dashboard Install/Auto-install actions were removed.

If status reports \"DEPENDENCY_MISSING\", the installation is corrupt. Reinstall the application (\"npm install\" or redeploy the standalone build). \"/api/pxpipe/start\" responds 409 while the dependency is missing, and the Token Saver card shows repair guidance. The PXPIPE dashboard log card lists real transform events from \"src/lib/pxpipe/events.js\".

## Observability

- \"/api/compression/telemetry\" returns aggregated savings over an in-memory ring buffer.
- \"/api/compression/telemetry/record\" is the fire-and-forget deposit endpoint used by the chat core.
- \"/dashboard/compression/live\" shows real-time per-engine savings, total bytes saved, and recent runs (10-second auto-refresh).

## Troubleshooting

- No compression header: compression is disabled, the request matched a bypass header, or every engine returned unchanged/rolled back. Check the dashboard settings and the request logs.
- Unexpectedly large request: some engines only compress messages, not tool results. Verify which engines are enabled and the input shape.
- Preview shows \"unavailable\" for an engine you expected: the engine is a catalog placeholder in this tree; it cannot be dispatched.
- PXPIPE "DEPENDENCY_MISSING": run "npm install" and rebuild; do not look for an install endpoint in the dashboard.
