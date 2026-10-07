// First-party capability audit updated on 2026-10-05.
// https://developers.openai.com/api/docs/models
// https://platform.claude.com/docs/en/build-with-claude/context-windows
// https://platform.minimax.io/docs/api-reference/text-anthropic-api
// https://docs.x.ai/developers/models
// Claude Code rows retain separately verified authenticated Models API data.
// null limits are unknown, never a default or a token ceiling.
// OAuth/reseller quotas and subscription entitlements remain separate contracts.

const OPENAI_API_CAPABILITIES = {
  "gpt-6-astra": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxInput":922000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai","thinkingEfforts":["low","medium","high","xhigh","max"],"thinkingCanDisable":false},
  "gpt-6.1-sol": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxInput":922000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai","thinkingEfforts":["low","medium","high","xhigh","max"],"thinkingCanDisable":false},
  "gpt-6-sol": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxInput":922000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh","max"],"thinkingCanDisable":true},
  "gpt-6-luna": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxInput":922000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh","max"],"thinkingCanDisable":true},
  "gpt-5.6": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxInput":922000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh","max"],"thinkingCanDisable":true},
  "gpt-5.6-sol": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxInput":922000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh","max"],"thinkingCanDisable":true},
  "gpt-5.6-terra": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxInput":922000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh","max"],"thinkingCanDisable":true},
  "gpt-5.6-luna": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxInput":922000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh","max"],"thinkingCanDisable":true},
  "gpt-5.6-cyber": {"vision":true,"tools":true,"reasoning":true,"contextWindow":400000,"maxInput":272000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai"},
  "gpt-5.5": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","tool_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh"],"thinkingCanDisable":true},
  // Prompt-cache reuse is supported, but GPT-5.5 Pro offers no cached-input discount.
  // https://developers.openai.com/api/docs/guides/prompt-caching
  "gpt-5.5-pro": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","image_generation","code_interpreter","hosted_shell","mcp"],"thinkingFormat":"openai","thinkingEfforts":["medium","high","xhigh"],"thinkingCanDisable":false},
  "gpt-5.4": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","tool_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh"],"thinkingCanDisable":true},
  "gpt-5.4-pro": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":false,"promptCaching":false,"supportedTools":["function_calling","web_search","file_search","tool_search","image_generation","apply_patch","computer_use","mcp"],"thinkingFormat":"openai","thinkingEfforts":["medium","high","xhigh"],"thinkingCanDisable":false},
  "gpt-5.4-mini": {"vision":true,"tools":true,"reasoning":true,"contextWindow":400000,"maxInput":272000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","tool_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh"],"thinkingCanDisable":true},
  "gpt-5.4-nano": {"vision":true,"tools":true,"reasoning":true,"contextWindow":400000,"maxInput":272000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","mcp"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh"],"thinkingCanDisable":true},
  "gpt-5.3-codex": {"vision":true,"tools":true,"reasoning":true,"contextWindow":400000,"maxInput":272000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","hosted_shell","skills"],"thinkingFormat":"openai"},
  "gpt-5.2": {"vision":true,"tools":true,"reasoning":true,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":400000,"maxOutput":128000,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","mcp"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high","xhigh"],"thinkingCanDisable":true},
  "gpt-5.2-pro": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"contextWindow":400000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":false,"promptCaching":false,"supportedTools":["function_calling","file_search","image_generation","mcp","web_search"],"thinkingFormat":"openai"},
  "gpt-5.1": {"vision":true,"tools":true,"reasoning":true,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":400000,"maxOutput":128000,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","image_generation","code_interpreter","apply_patch","mcp"],"thinkingFormat":"openai","thinkingEfforts":["none","low","medium","high"],"thinkingCanDisable":true},
  "gpt-5": {"vision":true,"tools":true,"reasoning":true,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":400000,"maxOutput":128000,"maxInput":272000,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","image_generation","code_interpreter","mcp"],"thinkingFormat":"openai","thinkingEfforts":["minimal","low","medium","high"],"thinkingCanDisable":false},
  "gpt-5-pro": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"contextWindow":400000,"maxOutput":272000,"search":true,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":false,"supportedTools":["function_calling","file_search","image_generation","mcp","web_search"],"thinkingFormat":"openai"},
  "gpt-5-mini": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"contextWindow":400000,"maxInput":272000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","code_interpreter","mcp"],"thinkingFormat":"openai"},
  "gpt-5-nano": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"contextWindow":400000,"maxInput":272000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","image_generation","code_interpreter","mcp"],"thinkingFormat":"openai"},
  "gpt-4.1": {"vision":true,"pdf":true,"tools":true,"reasoning":false,"contextWindow":1047576,"maxOutput":32768,"search":true,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","image_generation","code_interpreter","mcp"]},
  "gpt-4.1-mini": {"vision":true,"pdf":true,"tools":true,"reasoning":false,"contextWindow":1047576,"maxOutput":32768,"search":true,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","code_interpreter","mcp"]},
  "gpt-4.1-nano": {"vision":true,"tools":true,"reasoning":false,"search":false,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":1047576,"maxOutput":32768,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","file_search","image_generation","code_interpreter","mcp"]},
  "gpt-4o": {"vision":true,"pdf":true,"tools":true,"reasoning":false,"contextWindow":128000,"maxOutput":16384,"search":true,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","image_generation","code_interpreter","mcp"]},
  "gpt-4o-mini": {"vision":true,"pdf":true,"tools":true,"reasoning":false,"contextWindow":128000,"maxOutput":16384,"search":true,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","web_search","file_search","image_generation","code_interpreter","mcp"]},
  "gpt-4-turbo": {"vision":true,"tools":true,"reasoning":false,"search":false,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":128000,"maxOutput":4096,"structuredOutput":false,"promptCaching":false},
  "o3": {"vision":true,"tools":true,"reasoning":true,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":200000,"maxOutput":100000,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","file_search","image_generation","code_interpreter","mcp","web_search"],"thinkingFormat":"openai"},
  "o3-pro": {"vision":true,"tools":true,"reasoning":true,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":200000,"maxOutput":100000,"structuredOutput":true,"promptCaching":false,"supportedTools":["function_calling","file_search","image_generation","mcp","web_search"],"thinkingFormat":"openai"},
  "o4-mini": {"vision":true,"tools":true,"reasoning":true,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":200000,"maxOutput":100000,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","file_search","code_interpreter","mcp","web_search"],"thinkingFormat":"openai"},
  "o3-mini": {"vision":false,"tools":true,"reasoning":true,"search":false,"audioInput":false,"videoInput":false,"pdf":false,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":200000,"maxOutput":100000,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","file_search","code_interpreter","mcp","image_generation"],"thinkingFormat":"openai"},
  "o1": {"vision":true,"tools":true,"reasoning":true,"search":false,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":200000,"maxOutput":100000,"structuredOutput":true,"promptCaching":true,"supportedTools":["function_calling","file_search","mcp"],"thinkingFormat":"openai"},
  "o1-pro": {"vision":true,"tools":true,"reasoning":true,"search":false,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"contextWindow":200000,"maxOutput":100000,"structuredOutput":true,"promptCaching":false,"supportedTools":["function_calling","file_search","mcp"],"thinkingFormat":"openai"},
  "gpt-daybreak-blue-latest": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1050000,"maxInput":922000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai"},
  "gpt-daybreak-red-latest": {"vision":true,"tools":true,"reasoning":true,"contextWindow":400000,"maxInput":272000,"maxOutput":128000,"search":true,"audioInput":false,"videoInput":false,"pdf":true,"imageOutput":false,"audioOutput":false,"videoOutput":false,"structuredOutput":true,"promptCaching":true,"supportedTools":["web_search","file_search","image_generation","code_interpreter","hosted_shell","apply_patch","skills","computer_use","mcp","tool_search"],"thinkingFormat":"openai"},
  "text-embedding-3-large": {"vision":false,"tools":false,"reasoning":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false},
  "text-embedding-3-small": {"vision":false,"tools":false,"reasoning":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false},
  "text-embedding-ada-002": {"vision":false,"tools":false,"reasoning":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"imageOutput":false,"audioOutput":false,"videoOutput":false},
  "tts-1": {"audioOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"vision":false,"audioInput":false,"videoInput":false,"imageOutput":false,"videoOutput":false},
  "tts-1-hd": {"audioOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"vision":false,"audioInput":false,"videoInput":false,"imageOutput":false,"videoOutput":false},
  "gpt-4o-mini-tts": {"audioOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"vision":false,"audioInput":false,"videoInput":false,"imageOutput":false,"videoOutput":false},
  "whisper-1": {"audioInput":true,"audioOutput":false,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"vision":false,"videoInput":false,"imageOutput":false,"videoOutput":false},
  "gpt-transcribe": {"audioInput":true,"audioOutput":false,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"vision":false,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-4o-transcribe": {"audioInput":true,"audioOutput":false,"tools":false,"contextWindow":16000,"maxInput":null,"maxOutput":2000,"vision":false,"videoInput":false,"imageOutput":false,"videoOutput":false},
  "gpt-4o-mini-transcribe": {"audioInput":true,"audioOutput":false,"tools":false,"contextWindow":16000,"maxInput":null,"maxOutput":2000,"vision":false,"videoInput":false,"imageOutput":false,"videoOutput":false},
  "gpt-4o-transcribe-diarize": {"audioInput":true,"audioOutput":false,"tools":false,"contextWindow":16000,"maxInput":null,"maxOutput":2000,"vision":false,"videoInput":false,"imageOutput":false,"videoOutput":false},
  "gpt-image-2.5-sunburst": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"audioOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-image-2.5-flare": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"audioOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-image-2": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"audioOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-image-1.5": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"audioOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-image-1-mini": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"audioOutput":false,"videoOutput":false},
  "gpt-image-1": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"audioOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "chatgpt-image-latest": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"audioInput":false,"videoInput":false,"audioOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-audio-1.5": {"audioInput":true,"audioOutput":true,"tools":true,"contextWindow":128000,"maxInput":null,"maxOutput":16384,"vision":false,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-audio": {"audioInput":true,"audioOutput":true,"tools":true,"contextWindow":128000,"maxInput":null,"maxOutput":16384,"vision":false,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-audio-mini": {"audioInput":true,"audioOutput":true,"tools":true,"contextWindow":128000,"maxInput":null,"maxOutput":16384,"vision":false,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":true,"supportedTools":["function_calling"]},
  "gpt-realtime-2.1": {"vision":true,"audioInput":true,"audioOutput":true,"tools":true,"reasoning":true,"contextWindow":128000,"maxInput":null,"maxOutput":32000,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":true},
  "gpt-realtime-2.1-mini": {"vision":true,"audioInput":true,"audioOutput":true,"tools":true,"reasoning":true,"contextWindow":128000,"maxInput":null,"maxOutput":32000,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":true},
  "gpt-realtime-2": {"vision":true,"audioInput":true,"audioOutput":true,"tools":true,"reasoning":true,"contextWindow":128000,"maxInput":null,"maxOutput":32000,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":true},
  "gpt-realtime-1.5": {"vision":true,"audioInput":true,"audioOutput":true,"tools":true,"reasoning":false,"contextWindow":32000,"maxInput":null,"maxOutput":4096,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":true},
  "gpt-realtime": {"vision":true,"audioInput":true,"audioOutput":true,"tools":true,"reasoning":false,"contextWindow":32000,"maxInput":null,"maxOutput":4096,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":true},
  "gpt-realtime-mini": {"vision":true,"audioInput":true,"audioOutput":true,"tools":true,"reasoning":false,"contextWindow":32000,"maxInput":null,"maxOutput":4096,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":true},
  "gpt-realtime-translate": {"vision":false,"audioInput":true,"audioOutput":true,"tools":false,"contextWindow":16000,"maxInput":null,"maxOutput":2000,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-live-transcribe": {"vision":false,"audioInput":true,"audioOutput":false,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-realtime-whisper": {"vision":false,"audioInput":true,"audioOutput":false,"tools":false,"contextWindow":16000,"maxInput":null,"maxOutput":2000,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-live-1": {"vision":false,"audioInput":true,"audioOutput":true,"tools":true,"contextWindow":null,"maxInput":null,"maxOutput":null,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "omni-moderation-latest": {"vision":true,"audioInput":false,"audioOutput":false,"tools":false,"contextWindow":null,"maxInput":null,"maxOutput":null,"videoInput":false,"imageOutput":false,"videoOutput":false,"search":false,"structuredOutput":false,"promptCaching":false},
  "gpt-rosalind-research": {"contextWindow":null,"maxOutput":null}
};

const MINIMAX_API_CAPABILITIES = {
  "MiniMax-M3.1-Flash-Preview": {"vision":true,"audioInput":false,"videoInput":true,"reasoning":true,"thinkingFormat":"openai","thinkingCanDisable":false,"contextWindow":1000000,"maxOutput":null,"tools":true,"supportedTools":["function_calling"],"thinkingEfforts":["low","medium","high","xhigh","max"],"thinkingType":"adaptive"},
  "MiniMax-M3": {"vision":true,"audioInput":false,"videoInput":true,"reasoning":true,"thinkingFormat":"minimax","thinkingCanDisable":true,"contextWindow":1000000,"maxOutput":null,"tools":true,"search":true,"promptCaching":true,"supportedTools":["function_calling","web_search"]},
  "MiniMax-M2.7": {"vision":false,"audioInput":false,"videoInput":false,"reasoning":true,"thinkingFormat":"minimax","thinkingCanDisable":false,"contextWindow":204800,"maxOutput":null,"tools":true},
  "MiniMax-M2.7-highspeed": {"vision":false,"audioInput":false,"videoInput":false,"reasoning":true,"thinkingFormat":"minimax","thinkingCanDisable":false,"contextWindow":204800,"maxOutput":null,"tools":true},
  "MiniMax-M2.5": {"vision":false,"audioInput":false,"videoInput":false,"reasoning":true,"thinkingFormat":"minimax","thinkingCanDisable":false,"contextWindow":204800,"maxOutput":null,"tools":true},
  "MiniMax-M2.5-highspeed": {"vision":false,"audioInput":false,"videoInput":false,"reasoning":true,"thinkingFormat":"minimax","thinkingCanDisable":false,"contextWindow":204800,"maxOutput":null,"tools":true},
  "MiniMax-M2.1": {"vision":false,"audioInput":false,"videoInput":false,"reasoning":true,"thinkingFormat":"minimax","thinkingCanDisable":false,"contextWindow":204800,"maxOutput":null,"tools":true},
  "MiniMax-M2.1-highspeed": {"vision":false,"audioInput":false,"videoInput":false,"reasoning":true,"thinkingFormat":"minimax","thinkingCanDisable":false,"contextWindow":204800,"maxOutput":null,"tools":true},
  "MiniMax-M2": {"vision":false,"audioInput":false,"videoInput":false,"reasoning":true,"thinkingFormat":"minimax","thinkingCanDisable":false,"contextWindow":204800,"maxOutput":128000,"tools":true},
  "image-01": {"imageOutput":true,"vision":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "MiniMax-H3": {"videoOutput":true,"vision":true,"videoInput":true,"audioInput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "MiniMax-H3-Max": {"videoOutput":true,"vision":true,"videoInput":true,"audioInput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "MiniMax-Hailuo-2.3": {"videoOutput":true,"vision":true,"videoInput":false,"audioInput":false,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "MiniMax-Hailuo-2.3-Fast": {"videoOutput":true,"vision":true,"videoInput":false,"audioInput":false,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "MiniMax-Hailuo-02": {"videoOutput":true,"vision":true,"videoInput":false,"audioInput":false,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "image-01-live": {"imageOutput":true,"vision":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "speech-2.8-hd": {"audioOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "speech-2.8-turbo": {"audioOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "speech-2.6-hd": {"audioOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "speech-2.6-turbo": {"audioOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "speech-02-hd": {"audioOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "speech-02-turbo": {"audioOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "asr-1.0": {"audioInput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "music-3.0": {"audioOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "music-2.6": {"audioOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "music-cover": {"audioInput":true,"audioOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null},
  "M2-her": {"vision":false,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":2048}
};
for (const id of ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"]) {
  MINIMAX_API_CAPABILITIES[id].promptCaching = true;
}

// Codex shares API model capacity; its roster, effort controls, and quotas remain separate.
const CODEX_CATALOG_CAPABILITIES = Object.fromEntries([
  ["gpt-6-astra", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-6-astra-review", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-6.1-sol", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-6-sol", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-6-sol-review", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-6-luna", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-6-luna-review", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-reserve", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-reserve-review", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-5.6-sol-ultra", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-5.6-sol-review", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-5.6-terra-review", ["low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.6-luna-review", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.5", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.5-review", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.5-medium", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.5-high", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.5-xhigh", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.4", ["none", "low", "medium", "high", "xhigh"]],
  ["gpt-5.4-review", ["none", "low", "medium", "high", "xhigh"]],
  ["gpt-5.4-mini", ["none", "low", "medium", "high", "xhigh"]],
  ["gpt-5.4-mini-review", ["none", "low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex-review", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex-high", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex-high-review", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex-low", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex-low-review", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex-xhigh", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex-xhigh-review", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex-none", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.3-codex-none-review", ["low", "medium", "high", "xhigh"]],
  ["codex-auto-review", ["low", "medium", "high", "xhigh", "max"]]
].map(([id, thinkingEfforts]) => {
  const canonicalId = id.replace(/-review$/, "").replace(/-(medium|high|xhigh|low|none|ultra)$/, "");
  const api = OPENAI_API_CAPABILITIES[canonicalId];
  return [id, {
    vision: true, tools: true, reasoning: true, search: true,
    thinkingFormat: "openai", thinkingCanDisable: thinkingEfforts.includes("none"), thinkingEfforts,
    contextWindow: api?.contextWindow ?? null,
    maxInput: api?.maxInput,
    maxOutput: api?.maxOutput ?? null,
  }];
}));

const CLAUDE_CODE_CAPABILITIES = {
  "claude-sonnet-5-5": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["low","medium","high","xhigh","max"],"thinkingModes":["adaptive","between_tools"],"search":true},
  "claude-opus-5-5": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["low","medium","high","xhigh","max"]},
  "claude-fable-5-1": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["low","medium","high","xhigh","max"]},
  "claude-opus-5": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["none","low","medium","high","xhigh","max"]},
  "claude-sonnet-5": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["none","low","medium","high","xhigh","max"]},
  "claude-fable-5": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["low","medium","high","xhigh","max"]},
  "claude-opus-4-8": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["none","low","medium","high","xhigh","max"]},
  "claude-opus-4-7": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["none","low","medium","high","xhigh","max"]},
  "claude-sonnet-4-6": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["none","low","medium","high","max"]},
  "claude-opus-4-6": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":1000000,"maxOutput":128000,"thinkingEfforts":["none","low","medium","high","max"]},
  "claude-opus-4-5-20251101": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-budget","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":200000,"maxOutput":64000,"thinkingEfforts":["none","low","medium","high"]},
  "claude-haiku-4-5-20251001": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-budget","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":200000,"maxOutput":64000},
  "claude-sonnet-4-5-20250929": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-budget","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":1000000,"maxOutput":64000},
  "claude-opus-4-5": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-budget","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":200000,"maxOutput":64000,"thinkingEfforts":["none","low","medium","high"]},
  "claude-sonnet-4-5": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-budget","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":1000000,"maxOutput":64000},
  "claude-haiku-4-5": {"vision":true,"pdf":true,"tools":true,"reasoning":true,"thinkingFormat":"claude-budget","thinkingCanDisable":true,"structuredOutput":true,"contextWindow":200000,"maxOutput":64000}
};
for (const caps of Object.values(CLAUDE_CODE_CAPABILITIES)) {
  caps.search = true;
  caps.promptCaching = true;
}

export const AUDITED_PROVIDER_CAPABILITIES = {
  openai: {
    ...OPENAI_API_CAPABILITIES,
    "gpt-5.5-2026-04-23": OPENAI_API_CAPABILITIES["gpt-5.5"],
    "gpt-5.5-pro-2026-04-23": OPENAI_API_CAPABILITIES["gpt-5.5-pro"],
    "gpt-5.4-2026-03-05": OPENAI_API_CAPABILITIES["gpt-5.4"],
    "gpt-5.4-mini-2026-03-17": OPENAI_API_CAPABILITIES["gpt-5.4-mini"],
    "gpt-5.4-nano-2026-03-17": OPENAI_API_CAPABILITIES["gpt-5.4-nano"],
    "gpt-image-2-2026-04-21": OPENAI_API_CAPABILITIES["gpt-image-2"],
    "gpt-image-2.5-sunburst-2026-09-08": OPENAI_API_CAPABILITIES["gpt-image-2.5-sunburst"],
    "gpt-image-2.5-flare-2026-09-08": OPENAI_API_CAPABILITIES["gpt-image-2.5-flare"],
    "gpt-image-1.5-2025-12-16": OPENAI_API_CAPABILITIES["gpt-image-1.5"],
    "gpt-audio-2025-08-28": OPENAI_API_CAPABILITIES["gpt-audio"],
    "gpt-audio-mini-2025-12-15": OPENAI_API_CAPABILITIES["gpt-audio-mini"],
    "omni-moderation-2024-09-26": OPENAI_API_CAPABILITIES["omni-moderation-latest"],
    "gpt-4.1-nano-2025-04-14": OPENAI_API_CAPABILITIES["gpt-4.1-nano"],
    // Strict response schemas start with the 2024-08-06 snapshot, not May's GPT-4o.
    // https://developers.openai.com/api/docs/guides/structured-outputs
    "gpt-4o-2024-05-13": { ...OPENAI_API_CAPABILITIES["gpt-4o"], structuredOutput: false },
    "gpt-4-turbo-2024-04-09": OPENAI_API_CAPABILITIES["gpt-4-turbo"],
    "o4-mini-2025-04-16": OPENAI_API_CAPABILITIES["o4-mini"],
    "o3-mini-2025-01-31": OPENAI_API_CAPABILITIES["o3-mini"],
    "o1-2024-12-17": OPENAI_API_CAPABILITIES["o1"],
    "o1-pro-2025-03-19": OPENAI_API_CAPABILITIES["o1-pro"],
    "gpt-5.2-2025-12-11": OPENAI_API_CAPABILITIES["gpt-5.2"],
    "gpt-5.1-2025-11-13": OPENAI_API_CAPABILITIES["gpt-5.1"],
    "gpt-5-2025-08-07": OPENAI_API_CAPABILITIES["gpt-5"],
    "gpt-4.1-2025-04-14": OPENAI_API_CAPABILITIES["gpt-4.1"],
    "gpt-4.1-mini-2025-04-14": OPENAI_API_CAPABILITIES["gpt-4.1-mini"],
    "gpt-4o-2024-08-06": OPENAI_API_CAPABILITIES["gpt-4o"],
    "gpt-4o-2024-11-20": OPENAI_API_CAPABILITIES["gpt-4o"],
    "gpt-4o-mini-2024-07-18": OPENAI_API_CAPABILITIES["gpt-4o-mini"],
    "gpt-5.4-pro-2026-03-05": OPENAI_API_CAPABILITIES["gpt-5.4-pro"],
    "gpt-5.2-pro-2025-12-11": OPENAI_API_CAPABILITIES["gpt-5.2-pro"],
    "gpt-5-pro-2025-10-06": OPENAI_API_CAPABILITIES["gpt-5-pro"],
    "gpt-5-mini-2025-08-07": OPENAI_API_CAPABILITIES["gpt-5-mini"],
    "gpt-5-nano-2025-08-07": OPENAI_API_CAPABILITIES["gpt-5-nano"]
  },
  codex: CODEX_CATALOG_CAPABILITIES,
  cx: CODEX_CATALOG_CAPABILITIES,
  anthropic: {
    "claude-fable-5-1": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-mythos-5-1": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-fable-5": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-mythos-5": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-mythos-preview": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-opus-5-5": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-opus-5": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-opus-4-8": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-opus-4-7": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-opus-4-6": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-opus-4-5-20251101": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-budget","search":true,"contextWindow":200000,"maxOutput":64000,"structuredOutput":true},
    "claude-opus-4-5": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-budget","search":true,"contextWindow":200000,"maxOutput":64000,"structuredOutput":true},
    "claude-sonnet-5-5": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","thinkingCanDisable":false,"search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true,"thinkingModes":["adaptive","between_tools"]},
    "claude-sonnet-5": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-sonnet-4-6": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-adaptive","search":true,"contextWindow":1000000,"maxOutput":128000,"structuredOutput":true},
    "claude-sonnet-4-5-20250929": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-budget","search":true,"contextWindow":200000,"maxOutput":64000,"structuredOutput":true},
    "claude-sonnet-4-5": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-budget","search":true,"contextWindow":200000,"maxOutput":64000,"structuredOutput":true},
    "claude-haiku-4-5-20251001": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-budget","search":true,"contextWindow":200000,"maxOutput":64000,"structuredOutput":true},
    "claude-haiku-4-5": {"vision":true,"pdf":true,"reasoning":true,"thinkingFormat":"claude-budget","search":true,"contextWindow":200000,"maxOutput":64000,"structuredOutput":true}
  },
  claude: CLAUDE_CODE_CAPABILITIES,
  cc: CLAUDE_CODE_CAPABILITIES,
  minimax: MINIMAX_API_CAPABILITIES,
  "minimax-cn": { ...MINIMAX_API_CAPABILITIES, "image-01-live": {"vision":true,"imageOutput":true,"tools":false,"reasoning":false,"contextWindow":null,"maxOutput":null} },
  xai: {
    "grok-4.7": {"vision":true,"tools":true,"reasoning":true,"contextWindow":500000,"maxOutput":null,"thinkingFormat":"openai","thinkingCanDisable":false,"search":true,"thinkingEfforts":["low","medium","high","xhigh"],"audioInput":false},
    "grok-4.6": {"vision":true,"tools":true,"reasoning":true,"contextWindow":500000,"maxOutput":null,"thinkingFormat":"openai","thinkingCanDisable":false,"search":true,"thinkingEfforts":["low","medium","high","xhigh"],"audioInput":false},
    // The model page accepts xhigh; the reasoning guide says it maps to high on 4.5.
    "grok-4.5": {"vision":true,"tools":true,"reasoning":true,"contextWindow":500000,"maxOutput":null,"thinkingFormat":"openai","thinkingCanDisable":false,"search":true,"thinkingEfforts":["low","medium","high","xhigh"],"audioInput":false},
    "grok-4.3": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1000000,"maxOutput":null,"thinkingFormat":"openai","thinkingCanDisable":true,"search":true,"thinkingEfforts":["none","low","medium","high","xhigh"],"audioInput":false},
    "grok-4.20-0309-reasoning": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1000000,"maxOutput":null,"thinkingFormat":"openai","thinkingCanDisable":false,"search":true,"audioInput":false},
    "grok-4.20-0309-non-reasoning": {"vision":true,"tools":true,"reasoning":false,"contextWindow":1000000,"maxOutput":null,"thinkingFormat":null,"thinkingCanDisable":false,"search":true,"audioInput":false},
    "grok-4.20-multi-agent-0309": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1000000,"maxOutput":null,"thinkingFormat":"openai","thinkingCanDisable":false,"search":true,"thinkingEfforts":["low","medium","high","xhigh"],"audioInput":false},
    "grok-4.20-multi-agent": {"vision":true,"tools":true,"reasoning":true,"contextWindow":1000000,"maxOutput":null,"thinkingFormat":"openai","thinkingCanDisable":false,"search":true,"thinkingEfforts":["low","medium","high","xhigh"],"audioInput":false},
    "grok-build-0.1": {"vision":true,"tools":true,"reasoning":true,"contextWindow":256000,"maxOutput":null,"thinkingFormat":"openai","thinkingCanDisable":false,"search":true,"audioInput":false},
    "grok-imagine-image": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":false},
    "grok-imagine-image-2.0": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":false},
    "grok-imagine-image-quality": {"vision":true,"imageOutput":true,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":false},
    // Speech-to-speech is a native realtime service, not a text model's hosted tool.
    // https://docs.x.ai/developers/model-capabilities/audio/voice
    "grok-voice-think-fast-2.0": {"audioOutput":true,"tools":true,"contextWindow":null,"maxOutput":null,"audioInput":true},
    "grok-imagine-video": {"vision":true,"videoInput":true,"audioOutput":null,"videoOutput":true,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":false},
    "realtime": {"audioOutput":true,"tools":true,"contextWindow":null,"maxOutput":null,"audioInput":true},
    "grok-imagine-video-1.5": {"vision":true,"videoInput":false,"audioOutput":true,"videoOutput":true,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":false},
    "grok-imagine-video-1.5-lite": {"vision":true,"videoInput":false,"audioOutput":null,"videoOutput":true,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":false},
    "grok-voice-transcribe-2.0": {"audioOutput":false,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":true},
    "grok-voice-transcribe-1.0": {"audioOutput":false,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":true},
    "tts": {"audioOutput":true,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":false},
    "stt": {"audioOutput":false,"tools":false,"contextWindow":null,"maxOutput":null,"audioInput":true}
  }
};

for (const caps of Object.values(AUDITED_PROVIDER_CAPABILITIES.anthropic)) caps.promptCaching = true;
for (const id of ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.3", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning", "grok-4.20-multi-agent-0309", "grok-4.20-multi-agent", "grok-build-0.1"]) {
  Object.assign(AUDITED_PROVIDER_CAPABILITIES.xai[id], { structuredOutput: true, promptCaching: true });
}

// Published wire aliases must retain JSON/cache support and unknown output limits.
// https://docs.x.ai/developers/models/grok-build-0.1
// https://docs.x.ai/developers/models/grok-4.5
for (const id of ["grok-code-fast-1", "grok-code-fast", "grok-code-fast-1-0825"]) {
  AUDITED_PROVIDER_CAPABILITIES.xai[id] = AUDITED_PROVIDER_CAPABILITIES.xai["grok-build-0.1"];
}
AUDITED_PROVIDER_CAPABILITIES.xai["grok-build-latest"] = AUDITED_PROVIDER_CAPABILITIES.xai["grok-4.5"];
