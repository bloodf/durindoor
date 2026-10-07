# DurinDoor CLI

The `durindoor` package installs and runs the self-hosted DurinDoor AI gateway.

Use Node.js `20.20.2` and npm `10.8.2`. Start a local instance with an explicit loopback address:

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
export INITIAL_PASSWORD="CHANGE_ME_STRONG_PASSWORD"
npm install --global durindoor
durindoor --host 127.0.0.1
```

Replace the password before running the command. Keep the signing secret stable across restarts. Open `http://localhost:20128/dashboard`, sign in, connect a provider, and create a gateway key.

The CLI performs startup cleanup before launching. Use the [CLI reference](../docs/reference/cli.mdx) for flags, updates, tray behavior, port handling, and recovery. Follow [Installation](../docs/getting-started/installation.mdx) for other install methods and first-run configuration.

- [First request](../docs/getting-started/first-request.mdx)
- [npm package](https://www.npmjs.com/package/durindoor)
- [Docker image](https://github.com/bloodf/durindoor/pkgs/container/durindoor)
- [MIT license](LICENSE)
