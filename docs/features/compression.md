# Compression

DurinDoor can reduce the size of outbound prompts before they are sent to upstream providers. Compression runs after translation and before provider dispatch, operating on the translated request body. It is opt-in and fail-open: a failure at any point returns the original body and does not break the request.

## Compression seam

The single execution path is \"runCompressionSeam\" in the chat core. There is no parallel inline loop. The stack runs after RTK/Headroom and before any pxpipe injection when compression is enabled. Engines never mutate the caller's body; each step works on a fresh value, so a failed step can be rolled back without affecting the original request.

## Studio controls

The dashboard has two related compression surfaces:

- `/dashboard/compression-studio` (Compression Studio V2) renders the pipeline editor. Modes include off, lite, standard, aggressive, ultra, rtk, stacked, and caveman. Selecting `stacked` runs the configured stack; selecting `caveman` runs only the caveman engine with full intensity. The same page (Test Savers) also dry-runs engines against an arbitrary payload and reports per-engine savings.

Studio settings are stored in the standard settings row with the \"compressionV2*\" prefix. The legacy \"rtkEnabled\", \"cavemanEnabled\", \"headroomEnabled\", and \"ponytailEnabled\" flags are kept unchanged so installations that do not enable V2 see no behaviour change.

## Supported engines

These engines have a real implementation in this tree and can be dispatched:

| Engine | What it does |
| --- | --- |
| `session-dedup` | Cross-turn block deduplication. |
| `caveman` | Rule-based prose compression. |
| `headroom` | Headroom adapter with its own availability and configuration checks. |

The catalog also names `ccr`, `lite`, `rtk`, `relevance`, `aggressive`, `llmlingua`, and `ultra` as metadata-only placeholders with `available: false`. They can appear in listings and validation errors but are not dispatched. Heavy engines such as LLMLingua/ONNX runtime are not shipped in this tree.


## Per-request bypass

Send this header on a chat request to disable every token saver, including the compression seam, for that request:

```http
X-DurinDoor-Token-Saver: off
```

The legacy `X-9Router-Token-Saver: off` header remains accepted for wire compatibility. When both headers are present, `X-DurinDoor-Token-Saver` takes precedence. Only the exact value `off`, case-insensitive, bypasses savers.


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

PXPIPE management endpoints follow a dedicated access rule. A dashboard reached through a reverse proxy must present a valid dashboard session or machine-bound CLI token even when `requireLogin` is disabled; API keys do not grant management access. Direct loopback access keeps the normal local `requireLogin` policy. An authorization or status-probe failure is shown as `Unavailable` and is not evidence that the bundled dependency needs reinstalling.

## Observability

- `/api/compression/preview` dry-runs the engine catalog against an arbitrary payload and reports per-engine status and savings.
- The chat core records compression savings into the standard usage and request-detail storage, visible in the dashboard usage views.

## Troubleshooting

- No compression header: compression is disabled, the request matched a bypass header, or every engine returned unchanged/rolled back. Check the dashboard settings and the request logs.
- Unexpectedly large request: some engines only compress messages, not tool results. Verify which engines are enabled and the input shape.
- Preview shows "unavailable" for an engine you expected: the engine is a catalog placeholder in this tree; it cannot be dispatched.
- PXPIPE "DEPENDENCY_MISSING": run "npm install" and rebuild; do not look for an install endpoint in the dashboard.
- Headroom auto-configure shows it recovered the URL to the default port: the previously saved loopback URL was unreachable (possibly another service claimed that port), so auto-configure fell back to `http://localhost:8787`. No action needed; this is the intended recovery.
- Headroom reports `openai-responses request did not translate to messages[]` when a Responses request cannot be converted for compression; the request still proceeds uncompressed.
- Headroom proxy started but remains unreachable: after auto-configure starts the proxy it polls `/health` for a few attempts. If the proxy still does not answer, auto-configure stops the proxy it just started and writes no enable or URL changes. A pre-existing proxy that was already running is left alone — only the process started in this run is cleaned up. Check the Headroom process logs and confirm port 8787 is available.
- PXPIPE reports a health-check failure in auto-configure but was previously enabled: the bundled `pxpipe-proxy` module failed to load or returned an invalid transform shape. Auto-configure reports the error and skips writing `pxpipeEnabled`, leaving the previous setting intact. This is distinct from "DEPENDENCY_MISSING", which requires a fresh install.
- Auto-configure dry-run preview does not health-check the PXPIPE module: the preview shows planned setting changes without loading or probing the transformer. A real (non-dry-run) run loads the module, performs a synthetic transform self-test, and surfaces failures.
