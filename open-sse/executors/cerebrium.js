import { DefaultExecutor } from "./default.js";
import { cerebriumBaseUrl } from "../config/cerebrium.js";

// The documented OpenAI base is /run; the client appends /chat/completions.
export class CerebriumExecutor extends DefaultExecutor {
  constructor() { super("cerebrium"); }
  buildUrl(model, stream, index, credentials) {
    return `${cerebriumBaseUrl(credentials?.providerSpecificData?.baseUrl)}/chat/completions`;
  }
  async execute(input) {
    if (!cerebriumBaseUrl(input.credentials?.providerSpecificData?.baseUrl) || !input.credentials?.apiKey?.trim()) {
      return { response: Response.json({ error: { message: "Cerebrium requires a deployment /run URL and project API key" } }, { status: 400 }), url: "", headers: {}, transformedBody: input.body };
    }
    return super.execute(input);
  }
}
