# NVIDIA default order (#2112)

Already landed on main in `fa28f14aff52faa3c5b6abfaa82ad044c6c85dbc` (#2118). The NVIDIA registry starts with `meta/llama-3.3-70b-instruct`; `tests/unit/port9r-nvidia-existing-catalog-5780.test.js` checks the registry head, provider default, and connection-validation fallback model. The focused `sh scripts/checks.sh unit` selection for that test passes on this checkout. No provider requests were made.
