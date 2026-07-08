# DurinDoor

Run DurinDoor in a container. Published image: [`ghcr.io/bloodf/durindoor`](https://github.com/bloodf/durindoor/pkgs/container/durindoor) — multi-platform `linux/amd64` + `linux/arm64`.

---

# 👤 For Users

## Quick start

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.durindoor:/app/data" \
  -e DATA_DIR=/app/data \
  --name durindoor \
  ghcr.io/bloodf/durindoor:latest
```

App listens on port `20128`. Open: http://localhost:20128

## Manage container

```bash
docker logs -f durindoor        # view logs
docker stop durindoor           # stop
docker start durindoor          # start again
docker rm -f durindoor          # remove
```

## Data persistence

```bash
-v "$HOME/.durindoor:/app/data" \
-e DATA_DIR=/app/data
```

Without `DATA_DIR`, the app falls back to `<<~/.durindoor>>/` (macOS/Linux) or `<<%APPDATA%/durindoor%>>\` (Windows) for migration compatibility. In the container, `DATA_DIR=/app/data` makes the bind mount work.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # auto backups
└── ...                   # certs, logs, runtime configs
```

Host path: `$HOME/.durindoor/db/data.sqlite`
Container path: `/app/data/db/data.sqlite`

## Optional env vars

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.durindoor:/app/data" \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DEBUG=true \
  --name durindoor \
  ghcr.io/bloodf/durindoor:latest
```

## Optional Headroom sidecar

The DurinDoor image does not bundle Python or Headroom. To use Headroom in Docker, run it as a separate service and point DurinDoor at that proxy:

```yaml
services:
  durindoor:
    image: ghcr.io/bloodf/durindoor:latest
    ports:
      - "20128:20128"
    volumes:
      - "$HOME/.durindoor:/app/data"
    environment:
      DATA_DIR: /app/data
      HEADROOM_URL: http://headroom:8787
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/chopratejas/headroom:latest
    ports:
      - "8787:8787"
```

In the dashboard, open `Endpoint` → `Token Saver` → `Headroom`, confirm the URL is `http://headroom:8787`, recheck status, then enable Headroom.

If Headroom runs on the Docker host instead of as a sidecar, use `http://host.docker.internal:8787` on macOS/Windows. On Linux, add `--add-host=host.docker.internal:host-gateway` or the equivalent compose `extra_hosts` entry.

## Update to latest

```bash
docker pull ghcr.io/bloodf/durindoor:latest
docker rm -f durindoor
# re-run the quick start command
```

---

# 🛠 For Developers

## Build image locally (test)

```bash
docker build -t durindoor .

docker run --rm -p 20128:20128 \
  -v "$HOME/.durindoor:/app/data" \
  -e DATA_DIR=/app/data \
  durindoor
```

## Publish (automatic via CI)

Push a git tag `v*` → GitHub Actions builds multi-platform (amd64+arm64) and pushes to:
- `ghcr.io/bloodf/durindoor:v{version}` + `:latest`

```bash
# Or manually
git tag v0.5.x && git push origin v0.5.x
```

Workflow: `.github/workflows/docker-publish.yml`
