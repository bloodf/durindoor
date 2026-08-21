# Headroom compression

DurinDoor uses [Headroom](https://pypi.org/project/headroom-ai/) as an external
compression proxy. `open-sse/rtk/headroom.js` sends eligible requests to that
proxy, and the Token Saver dashboard configures and reports on it. Headroom is
optional: if its proxy is unavailable, the gateway continues without
compression.

## Compression extras

DurinDoor installs these Headroom extras by default:

| Extra | What it provides |
| --- | --- |
| `proxy` | The HTTP compression proxy consumed by DurinDoor. |
| `code` | Tree-sitter AST compression for source code. |
| `ml` | The Kompress-v2 model. |

## Python requirement

Headroom's own `headroom-ai` package metadata declares
`requires_python = ">=3.10"`. Python 3.10 or newer is required. There is no
upper Python bound. Python 3.14 works: Headroom 0.36.1 installed cleanly on
Python 3.14.4 with `torch` and Tree-sitter installed.

## Managed virtual environment

DurinDoor owns a dedicated virtual environment at:

```text
${DATA_DIR}/headroom/venv
```

On the deployment host, `DATA_DIR` is `/opt/cortexos/.durindoor`, so the
managed environment is `/opt/cortexos/.durindoor/headroom/venv`.

This environment belongs to DurinDoor instead of the interactive user because
the service runs as root and cannot see packages in a user's `~/.local`.
It also avoids PEP 668, which prevents `pip` from installing into a
distribution-managed system interpreter. The managed virtual environment has
its own `pip`, so DurinDoor can install and update all required extras there.

Build the environment manually when the dashboard offers that repair:

```sh
/usr/bin/python3 -m venv /opt/cortexos/.durindoor/headroom/venv
/opt/cortexos/.durindoor/headroom/venv/bin/python -m pip install --upgrade 'headroom-ai[proxy,code,ml]'
```

## Existing `uv tool` and `pipx` installs

DurinDoor detects an existing `uv tool install` or `pipx` Headroom install so
it can explain why it is not selected. It never modifies or starts from those
installs:

- Their isolated tool environments have no `pip`, so DurinDoor cannot add the
  `code` and `ml` extras to them.
- They normally live under a user's home directory, which the root service
  cannot reach.

Remove a stale `uv` tool install after the managed environment is working:

```sh
uv tool uninstall headroom-ai
```

A user-scoped Python interpreter has the same problem. It may work in an
operator shell but cannot serve the root-managed DurinDoor process. Install or
select a root-visible Python instead.

## Setup diagnostics

When Headroom setup cannot continue, the Token Saver dashboard names the
observed condition and provides the appropriate repair.

| Code | Meaning | Dashboard repair |
| --- | --- | --- |
| `NO_SUPPORTED_PYTHON` | No root-visible Python 3.10 or newer was found. | Install a supported system Python, then retry setup. |
| `PYTHON_USER_SCOPED_ONLY` | A supported interpreter was found only below a user home, where the root service cannot use it. | Install a root-visible Python 3.10 or newer, then retry setup. |
| `VENV_TOOLS_MISSING` | A supported interpreter could not create a virtual environment because its venv tools, including `ensurepip`, are missing. | Install the matching `python3.<minor>-venv` package, then retry setup. |
| `VENV_CREATE_FAILED` | DurinDoor found a supported interpreter but creating its managed virtual environment failed for another reason. | Review the reported creation error, repair the host condition, then retry setup. |
| `INSTALL_FAILED` | Installing `headroom-ai[proxy,code,ml]` in the managed environment failed. | Run the dashboard's exact managed-venv install command and use the supplied log tail to correct the failure. |
| `PEP668` | Installation tried to use a distribution-managed Python, which PEP 668 protects. | Recreate or use `${DATA_DIR}/headroom/venv`; do not install Headroom into the system interpreter. |
| `EXTRA_WHEEL_UNAVAILABLE` | Pip could not find a compatible package wheel for one requested extra on the selected Python. | Install a different supported Python minor version, then retry the managed-venv install. |
| `NOT_INSTALLED` | No usable Headroom executable was found. | Install Headroom through the managed virtual environment with all default extras. |
| `EARLY_EXIT` | The Headroom proxy started and exited before becoming ready. | Review the supplied log tail, correct the reported proxy failure, then start it again. |
| `EXTERNAL_PROXY` | The requested proxy URL points at an externally-configured Headroom instance the route does not manage. | Point Token Saver at the managed proxy, or confirm and allow the external URL through the intended setting. |

## Troubleshooting: extras never install and Python appears missing

If the dashboard says **Python >= 3.10 not found** even though Python is
installed, do not assume the interpreter version is the problem. This was an
old, misleading check: it required `headroom-ai` to appear in `pip show` before
accepting an interpreter as usable.

That requirement can never be satisfied for a `uv tool` Headroom environment:
its venv has no `pip`. The check therefore rejected an otherwise valid Python,
reported Python as missing, and prevented the `code` and `ml` extras from being
installed. DurinDoor now chooses a root-visible Python 3.10 or newer, creates
its own managed virtual environment, and installs `proxy`, `code`, and `ml`
together. If a stale `uv` or `pipx` installation is detected, it is reported
but not used.
