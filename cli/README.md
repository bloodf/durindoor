# DurinDoor — AI Gateway CLI

**DurinDoor** is a self-hosted AI gateway that unifies multiple LLM providers behind a single OpenAI-compatible API.

[![npm](https://img.shields.io/npm/v/durindoor.svg)](https://www.npmjs.com/package/durindoor)
[![License](https://img.shields.io/npm/l/durindoor.svg)](https://github.com/bloodf/durindoor/blob/main/LICENSE)

[🌐 Website](https://bloodf.github.io/durindoor/) • [📖 Full Docs](https://github.com/bloodf/durindoor)

---

## 🤔 Why DurinDoor?

**Stop wasting money, tokens, and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)
- ❌ Manual switching between providers

**DurinDoor solves this:**

- ✅ **Token Saver** — Auto-compress tool_result, save tokens
- ✅ **Maximize subscriptions** — Track quota, use every bit before reset
- ✅ **Auto fallback** — Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** — Round-robin between accounts per provider
- ✅ **Universal** — Works with any OpenAI/Claude-compatible CLI

---

## ⚡ Quick Start

**Option 1 — npm (recommended for desktop):**

```bash
npm install -g durindoor
durindoor

# Or run directly with npx
npx durindoor
```

**Option 2 — Docker (server/VPS):**

```bash
docker run -d --name durindoor -p 20128:20128 \
  -v "$HOME/.durindoor:/app/data" -e DATA_DIR=/app/data \
  ghcr.io/bloodf/durindoor:latest
```

Published images: [GHCR](https://github.com/bloodf/durindoor/pkgs/container/durindoor) (multi-platform amd64/arm64).

🎉 Dashboard opens at `http://localhost:20128`

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (free Claude unlimited) or **OpenCode Free** (no auth) → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with free AI models.

---

## 🚀 CLI Options

```bash
durindoor                    # Start with default settings
durindoor --port 8080        # Custom port
durindoor --no-browser       # Don't open browser
durindoor --skip-update      # Skip auto-update check
durindoor --help             # Show all options
```

**Dashboard**: `http://localhost:20128/dashboard`

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `<<~/.durindoor>>/db/data.sqlite` (legacy/migration compatibility)
- **Windows**: `%APPDATA%/durindoor/db/data.sqlite` (legacy/migration compatibility)
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.durindoor` to persist)

If you have an existing `<<~/.durindoor>>` directory from the previous project, DurinDoor will migrate it on first run.

---

## 📚 Documentation

Full docs, advanced setup, video tutorials & development guide:

- **GitHub**: https://github.com/bloodf/durindoor
- **Full README**: https://github.com/bloodf/durindoor/blob/main/README.md
- **Website**: https://bloodf.github.io/durindoor/

---

## 🙏 Acknowledgments

- **[durindoor](https://github.com/bloodf/durindoor)** — Original project by decolua, forked as the foundation for DurinDoor.
- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — Original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
