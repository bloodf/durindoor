# ChatGPT plan connection preparation

The local loopback helper starts an HTTP listener on `127.0.0.1` before it creates an authorization request. It hands the exact callback to the private account service, which validates the state and exchanges the code. The listener closes on completion, cancellation, or timeout. It does not open a browser or expose a management endpoint.

This helper is not connected to the owner flow. Registration, explicit owner-install enablement, connection/account binding, scoped gateway authorization, and the protected VM handoff remain required before activation. The production provider registry remains unchanged. Do not use this helper as a complete sign-in flow.
