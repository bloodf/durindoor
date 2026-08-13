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

## Verify

Start omp, then watch today's log for the `DurinDoor models refreshed` entry:

```bash
tail -f ~/.omp/logs/omp.$(date +%F).*.log
```

If DurinDoor is stopped or returns invalid model metadata, omp logs a warning and continues starting without DurinDoor models.
