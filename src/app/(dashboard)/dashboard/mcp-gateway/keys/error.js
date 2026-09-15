"use client";

import { useEffect } from "react";
import McpGatewayErrorView from "../McpGatewayErrorView.jsx";

export default function McpGatewayKeysError({ error, reset }) {
  useEffect(() => { console.error("MCP Gateway keys page error:", error); }, [error]);
  return <McpGatewayErrorView reset={reset} />;
}
