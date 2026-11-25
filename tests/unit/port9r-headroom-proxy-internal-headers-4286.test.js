import { describe, expect, it } from "vitest";
import { forwardedHeaders } from "@/app/api/headroom/proxy/[...path]/route.js";

describe("9router#4286: Headroom proxy keeps internal credentials local", () => {
  it("drops every x-9r-* header and forwards ordinary ones", () => {
    // custom-server.js stamps the peer token on every request; headroomUrl may be remote.
    const headers = forwardedHeaders(new Request("http://localhost:20128/api/headroom/proxy/stats", {
      headers: {
        "x-9r-cli-token": "cli", "x-9r-peer-token": "peer", "x-9r-real-ip": "127.0.0.1",
        "x-9r-via-proxy": "1", "x-9r-password": "pw", accept: "text/html",
      },
    }));

    expect([...headers.keys()].filter((name) => name.startsWith("x-9r-"))).toEqual([]);
    expect(headers.get("accept")).toBe("text/html");
  });
});
