"use client";

import { useEffect } from "react";
import McpGatewayErrorView from "./McpGatewayErrorView.jsx";

export default function McpGatewayError({ error, reset }) {
  useEffect(() => { console.error("MCP Gateway page error:", error); }, [error]);
  return <McpGatewayErrorView reset={reset} />;
}
