# Cohere transport attempt ceiling (#1073)

The Cohere 422 reasoning-effort recovery and the 400 unsupported-field recovery could each dispatch independently. With `maxTransportAttempts: 2`, a 422 suggestion followed by a 400 naming a removable field caused a third send and hid the 400 response.

The per-base-URL ceiling now counts every actual dispatch, including both recoveries and generic retries. Once exhausted, the last response remains available to the caller; with room remaining, recovery and the existing status retry allowances still apply. Fallback URLs retain their separate budgets. The focused offline tests cover the cross-recovery boundary, available budget, and interactions with status retries. Existing cancellation, timeout, probe, and fallback behavior remains in the executor's established paths.
