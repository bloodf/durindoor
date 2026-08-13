# DurinDoor omp extension

Discovers DurinDoor models at session start and registers them in omp's in-memory model registry. Use `/durindoor-refresh` after gateway model changes.

## Install

Copy this directory into omp's user extension directory:

```bash
mkdir -p ~/.omp/agent/extensions/
cp -r omp-extension ~/.omp/agent/extensions/durindoor
```

Restart omp after installing.

## Configure

Set these omp config keys:

- `durindoor.baseUrl`: OpenAI-compatible API base URL. Defaults to `http://127.0.0.1:11434/v1`.
- `durindoor.apiKey`: DurinDoor API key used for discovery and model requests.

```bash
omp config set durindoor.baseUrl http://127.0.0.1:11434/v1
omp config set durindoor.apiKey YOUR_DURINDOOR_KEY
```

## Model capability mapping

omp always calls DurinDoor through `/v1/chat/completions`, so every discovered model is registered as `api: openai-completions`. DurinDoor is the translation boundary: it converts Chat Completions requests and OpenAI reasoning-effort labels to each model's upstream transport and native thinking shape.

| DurinDoor `/v1/models` field | omp model field |
| --- | --- |
| `id` | `id`, `name` (provider-qualified value preserved) |
| `capabilities.contextWindow` | `contextWindow` |
| `capabilities.maxOutput` | `maxTokens` |
| `capabilities.vision` | `input` includes `image` |
| `capabilities.tools` | `supportsTools` |
| `capabilities.reasoning` | `reasoning` and `thinking` availability |
| `capabilities.thinkingFormat` | Supported omp `thinking.efforts`; wire `compat.thinkingFormat` stays `openai` because gateway translates it |
| `capabilities.thinkingCanDisable` | `thinking.requiresEffort` when false |

omp exposes per-effort thinking budgets, but they apply to direct budget-based provider transports. This extension deliberately does not map DurinDoor's `thinkingRange`: omp speaks effort labels over Chat Completions, and DurinDoor owns native budget selection and range clamping.


## Test

Run the extension's Bun-only package script from the repository root:

```bash
cd omp-extension && bun test
```

## Verify

Start omp, then watch today's log for the `DurinDoor models refreshed` entry:

```bash
tail -f ~/.omp/logs/omp.$(date +%F).*.log
```

If DurinDoor is stopped or returns invalid model metadata, omp logs a warning and continues starting without DurinDoor models.
