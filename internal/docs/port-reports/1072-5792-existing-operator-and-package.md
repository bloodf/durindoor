# #1072 — 9router #5792: operator and package comparison

## Pins and scope

Compared the complete 30-file source PR [#5792](https://github.com/decolua/9router/pull/5792) at exact head [`621383bf7e50b17af876326ed4413e2c7d4164a3`](https://github.com/decolua/9router/commit/621383bf7e50b17af876326ed4413e2c7d4164a3) against exact merge base [`1855aa44473e88feac9d3f131b9c0c5fc9706b68`](https://github.com/decolua/9router/commit/1855aa44473e88feac9d3f131b9c0c5fc9706b68), also the integrated 9router default-branch pin. The source diff was read from `/var/tmp/durindoor-9router-5792.4k0bmkkX/source.git`. This report covers only dashboard/menu routes, version reporting, update control, package and deployment inputs. Provider/model changes and other source PR paths are outside this requested scope.

## Per-subchange dispositions

| Source subchange | Source behavior | Local evidence and disposition |
| --- | --- | --- |
| Header menu and sidebar | Adds an Update action to the header; turns the sidebar update prompt into a request to pull `master` and rebuild Docker; polls `/api/auto-update` status and reloads on success. | **Do not port the Docker updater UI.** Local `src/shared/components/Sidebar.js` already presents npm version availability and `UpdatePanel` offers bounded package update with manual fallback. `src/shared/components/HeaderMenu.js` has changelog, theme, shutdown and logout actions; it has no need for a second update control. The package updater is durable for installed CLI deployments. |
| `/api/version` | Chooses the greater of app and CLI package versions for current version. | **No gap demonstrated.** Local `src/app/api/version/route.js` reports the `durindoor` app package version; root and CLI package versions are both `4.11.0` at this checkout. The server and package are versioned together here, so the source PR's `9router`-specific max-version rule is not justified by local evidence. The endpoint queries npm for latest version; network failure resolves to no latest version. |
| `/api/auto-update` and dashboard guard | Reads status from `data/update-status.json`; posts to a configurable webhook, but supplies hardcoded fallback URL/token. Adds `/api/auto-update` to `ALWAYS_PROTECTED`. | **Do not port.** Local `/api/version/update` starts the package updater and `/api/version/shutdown` handles orderly shutdown. `src/dashboardGuard.js` protects these operator routes; the new source endpoint would add an external host-control path and persisted status-file contract without local need. The source defaults are not acceptable credential/configuration boundaries for local adoption. No secret values are repeated here. |
| Package version | Changes source `package.json` from `0.5.116` to `0.5.119`. | **No port.** This is a release bump for upstream's separate `9router` package. Local root and CLI package versions are both `4.11.0`; source release numbering does not establish a local version change. |
| Dockerfile and Compose | Docker entrypoint changes `/app/data` permissions; Compose switches from published image/named volume to local build and bind-mounted `./data`, changes restart policy, adds host-gateway mapping, and removes the `9router-data` volume declaration. | **Docker-only; no runtime performed.** These alter image build, host filesystem permissions, network name resolution and persistence semantics. Local `docker-compose.yml` uses the published DurinDoor image, named data volume and explicit Postgres profiles; local `Dockerfile` runs its own entrypoint. These are not interchangeable deployment inputs. Preserve local volume-based upgrade/rollback documented in `docs/deployment/docker.mdx` and `docs/operations/upgrading.mdx`. |
| Update proposal docs | Documents a host webhook listener that runs Git and Docker commands. | **Do not adopt.** This describes operator-owned host automation rather than a local application contract. Local upgrade documentation directs operators to back up data and update the image or npm package, then verify health and inference. |

## Operator routes and credential boundaries

Local package updates use `POST /api/version/update`, guarded to production mode, which cleans up app processes and starts the detached updater for the configured npm package. The update panel polls a separate bounded status endpoint, filters stale status, falls back to manual install when the updater fails, and waits for the relaunched app before reload. `POST /api/version/shutdown` uses the same process-cleanup boundary for manual updates. Both routes are listed in `src/dashboardGuard.js`'s always-protected paths. The source PR's webhook action does not replace these semantics: its GET/POST status flow and host listener are a distinct deployment mechanism.

The local `durindoor` package and CLI are at `4.11.0`; `src/app/api/version/route.js` compares the app package version against the `durindoor` npm latest endpoint. The endpoint is informational and its registry request is bounded; package installation remains the updater's explicit operator action. No provider credentials, provider terms, or provider-agreement action are required for this report. The source PR's Cloudflare agreement route and test are outside the requested scope and remain unshipped.

## Existing workflow and acceptance statement

Ordinary offline acceptance: **Given a production CLI installation, an operator opens the sidebar's available-update prompt and starts the package update; the panel either observes a fresh terminal updater status and the relaunched app, or transitions to the manual install command on timeout/failure.** This is already implemented in `src/shared/components/Sidebar.js`, `src/shared/components/UpdatePanel.js`, `src/app/api/version/update/route.js`, `src/lib/appUpdater.js`, and `src/shared/utils/updaterStatus.js`. Docker operators instead follow the documented backup, image/Compose update, and post-upgrade health/inference verification workflow; the source webhook flow is not an equivalent needed gap.

No demonstrated existing gap in this requested scope warrants importing the source-only host webhook updater or provider-agreement action. No Docker, browser, deployment, live-provider, or e2e action was performed.

## Local evidence links

- [Header menu](../../../src/shared/components/HeaderMenu.js)
- [Sidebar update entry](../../../src/shared/components/Sidebar.js)
- [Update panel](../../../src/shared/components/UpdatePanel.js)
- [Version route](../../../src/app/api/version/route.js)
- [Package update route](../../../src/app/api/version/update/route.js)
- [Shutdown route](../../../src/app/api/version/shutdown/route.js)
- [Dashboard route guard](../../../src/dashboardGuard.js)
- [Updater process lifecycle](../../../src/lib/appUpdater.js)
- [Updater status handling](../../../src/shared/utils/updaterStatus.js)
- [Root package](../../../package.json) and [CLI package](../../../cli/package.json)
- [Local Docker Compose](../../../docker-compose.yml) and [Dockerfile](../../../Dockerfile)
- [Docker upgrade guide](../../../docs/deployment/docker.mdx) and [operator upgrade guide](../../../docs/operations/upgrading.mdx)
