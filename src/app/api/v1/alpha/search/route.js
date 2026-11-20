import { handleCodexAlphaSearch } from "@/sse/handlers/codexAlphaSearch.js";
import { withHttpRequestCorrelation } from "@/sse/utils/requestCorrelation.js";

export const POST = withHttpRequestCorrelation(handleCodexAlphaSearch);
