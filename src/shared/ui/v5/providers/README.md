The dedicated Model auto-sync card uses the production GET/POST /api/models/auto-sync and GET/PATCH /api/settings contract. The toggle merges other provider choices into modelAutoSyncProviders and reloads server status. A disabled toggle returns the model list to registry defaults, preserving custom model behavior owned by the provider page.

Loading, unsupported-provider, no-active-connection, paused, synced, failed and retry states stay visible. Failure retains the previous successful model list. Requests for status are aborted on unmount or provider changes, and stale status responses cannot replace the current provider.

The original ProviderDetailPage keeps connections, custom models, provider parameters and all settings handlers. Its ModelAutoSyncPanel is replaced only in the v5 Storybook boundary and should sit between the Connections and Available Models sections as a standalone card. The component stays hidden for compatible providers, matching the current catalog contract.
