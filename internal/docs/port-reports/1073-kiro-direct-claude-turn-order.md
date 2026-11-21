# Direct Claude to Kiro turn order (#1073)

The direct Claude translator keeps every emitted turn in history when the transcript ends with an assistant and supplies `Continue` as the current user input. A final user turn remains current, including its tool results and images. Declared tool specifications remain on the current message, and completed tool exchanges stay in order without repeating their results.

This applies to the direct Claude-to-Kiro route. The existing OpenAI conversion, empty-input defaults, system and timestamp decoration, and tool reconciliation conventions remain unchanged. Offline synthetic fixtures cover both final-turn shapes and tool pairing; they do not establish provider behavior.
