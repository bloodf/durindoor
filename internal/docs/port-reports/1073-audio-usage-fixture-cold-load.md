# 1073: offline audio fixture cold load

The fixture reset the module registry and imported the driver and both audio handlers in every `beforeEach`. A cold transform/import can exceed the hook's 10-second limit before the first assertion. The focused run on this checkout reported 12.50 seconds of import time and 2.39 seconds for all 52 cases.

The fixture now imports the shared graph once under an empty private directory. `dataDir.js` and `databaseEnvFile.js` capture the directory at import; the driver's state object is also captured, while its SQLite path and engine are resolved when the adapter opens. Each case still opens and closes a fresh SQLite database in its own directory, resets that state object, mocks fetch, and restores timers, environment, and listeners. The import-time environment and listeners are restored separately.

Verification: the focused offline Vitest file passed all 52 cases; no production files or failure baseline changed.
