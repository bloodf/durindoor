# 1073: compression engine clear

The documented settings PATCH `{ "compressionEngines": { "lite": null } }` returned 400 because validation accepted only records for engine entries. The repository merge also retained an engine-level null rather than removing that engine.

Engine maps are partial patches: null removes only the named engine, records merge individual properties (including explicit null values), omitted engines and settings survive, and an empty map changes nothing. Invalid maps and non-record, non-null engine entries are rejected by PATCH. An available engine can be added again through ordinary settings. Both settings transactions use the same merge; existing policy authorization remains in place. Focused tests exercise PATCH and persisted reads against an isolated database, including the password-epoch transaction.
