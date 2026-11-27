// Staged from OmniRoute 9671192011beb2d7f83979f40be488c5da8772b9,
// open-sse/executors/poe-web.ts and src/shared/constants/providers/web-cookie.ts.
export const POE_WEB_MODELS = Object.freeze([
  ['poe-default', 'Assistant'], ['gpt-4o', 'GPT-4o'], ['gpt-4-turbo', 'GPT-4-Turbo'],
  ['claude-3.5-sonnet', 'Claude-3.5-Sonnet'], ['claude-3-opus', 'Claude-3-Opus'],
  ['gemini-2.0-flash', 'Gemini-2.0-Flash'], ['llama-3-70b', 'Llama-3-70B'], ['mixtral-8x22b', 'Mixtral-8x22B'],
].map(([id, bot]) => Object.freeze({ id, name: bot, bot })));

// Discovery is the pinned static mapping, not a claim about account access.
export function discoverPoeWebModels() {
  return POE_WEB_MODELS.map(({ id, name }) => ({ id, name, toolCalling: false }));
}

export default {
  id: 'poe-web', alias: 'poew', priority: 258,
  display: { name: 'Poe Web', icon: 'auto_awesome', color: '#6C3AED', textIcon: 'PW', website: 'https://poe.com' },
  category: 'webCookie', authType: 'cookie', authHint: 'Paste the p-b cookie value from poe.com.',
  serviceKinds: ['llm'],
  transport: { baseUrl: 'https://www.poe.com/api/gql_POST', format: 'openai', executor: 'poe-web', authType: 'cookie' },
  models: discoverPoeWebModels(),
};
