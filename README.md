<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-banner.png">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-banner.png" alt="Ancient stone portal glowing green in dark ruins" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-wordmark-theme-aware.svg">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-wordmark-theme-aware.svg" alt="DurinDoor. Speak, friend, and enter. One guarded gateway for every AI provider" width="760">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/durindoor"><img alt="npm" src="https://img.shields.io/npm/v/durindoor.svg"></a>
  <a href="https://github.com/bloodf/durindoor/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/bloodf/durindoor.svg"></a>
  <a href="https://github.com/bloodf/durindoor/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/bloodf/durindoor.svg"></a>
  <a href="https://github.com/bloodf/durindoor/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/bloodf/durindoor/ci.yml?branch=main"></a>
</p>

DurinDoor is a self-hosted AI gateway. Add provider credentials once in the dashboard, then point any OpenAI-compatible tool at `http://localhost:20128/v1` instead of wiring each app to a different vendor. Credentials stay on your machine. DurinDoor translates OpenAI-shaped requests for Claude, Gemini, Kiro, Cursor, Ollama, Vertex, and other upstream formats. It is a fork of [9router](https://github.com/decolua/9router). Existing installs keep their data, keys, and headers.

```bash
npm install -g durindoor
durindoor
```

The CLI binary is `durindoor`. Default port is 20128. The host needs Node.js 20.20.2 and npm 10.8.2. After start, the dashboard is http://localhost:20128/dashboard.

## Documentation

- [Getting started](https://durindoor.vercel.app/docs/getting-started)
- [Providers](https://durindoor.vercel.app/docs/providers)
- [Integrations](https://durindoor.vercel.app/docs/integrations)
- [Deployment](https://durindoor.vercel.app/docs/deployment)
- [Contributing](https://durindoor.vercel.app/docs/contributing)

A mocked dashboard, no local install, is at [https://durindoor.vercel.app/dashboard](https://durindoor.vercel.app/dashboard).

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

DurinDoor is a fork of [9router](https://github.com/decolua/9router), created by [decolua](https://github.com/decolua). Upstream documentation and branding remain the property of their respective authors and are not presented as DurinDoor's source of truth.
