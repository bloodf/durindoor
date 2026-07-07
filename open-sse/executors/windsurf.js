import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

export class WindsurfExecutor extends BaseExecutor {
  constructor() {
    super("windsurf", PROVIDERS.windsurf);
  }

  buildUrl() {
    return "windsurf://grpc-web/GetChatMessage";
  }

  buildHeaders() {
    return {};
  }

  transformRequest() {
    return null;
  }

  async execute() {
    return {
      response: new Response(JSON.stringify({
        error: {
          message: "Windsurf runtime is not implemented in this branch. Port the gRPC-web protobuf transport before enabling calls.",
          type: "not_implemented",
          code: "windsurf_transport_blocked",
        },
      }), {
        status: 501,
        headers: { "Content-Type": "application/json" },
      }),
      url: this.buildUrl(),
      headers: {},
      transformedBody: null,
    };
  }
}
