import { NextResponse } from "next/server";
import { createProxyPool } from "@/models";
import {
  buildRelayWorkerCode,
  generateRelaySecret,
} from "../relaySource.js";
import { sanitizePoolResponse } from "../sanitizePoolResponse.js";
import { isOperatorRequest } from "@/dashboardGuard";

// Empty-secret fixture for unit tests and pre-secret behavioural parity.
export const RELAY_WORKER_CODE = buildRelayWorkerCode("");

// POST /api/proxy-pools/cloudflare-deploy
export async function POST(request) {
  try {
    const body = await request.json();
    const accountId = body.accountId?.trim();
    const apiToken = body.apiToken?.trim();
    const projectName = body.projectName?.trim() || `relay-${Date.now().toString(36)}`;

    if (!accountId || !apiToken) {
      return NextResponse.json({ error: "Cloudflare Account ID and API Token are required" }, { status: 400 });
    }

    const relaySecret = generateRelaySecret();
    const workerCode = buildRelayWorkerCode(relaySecret);

    // 1. Upload Worker Script
    const workerScriptUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${projectName}`;
    
    // Cloudflare requires multipart/form-data for worker script upload
    const formData = new FormData();
    formData.append("index.js", new Blob([workerCode], { type: "application/javascript+module" }), "index.js");
    formData.append("metadata", new Blob([JSON.stringify({
      main_module: "index.js",
      compatibility_date: "2024-03-20",
      observability: { enabled: true }
    })], { type: "application/json" }), "metadata.json");

    const uploadRes = await fetch(workerScriptUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      body: formData,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      console.error("Cloudflare upload error:", err);
      return NextResponse.json(
        { error: err.errors?.[0]?.message || "Failed to upload Worker to Cloudflare" },
        { status: uploadRes.status }
      );
    }

    // 2. Enable workers.dev subdomain for the script
    const enableSubdomainRes = await fetch(`${workerScriptUrl}/subdomain`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });

    if (!enableSubdomainRes.ok) {
      const err = await enableSubdomainRes.json().catch(() => ({}));
      console.error("Cloudflare subdomain enable error:", err);
      // We don't fail completely here, just continue
    }

    // 3. Get the workers.dev subdomain for the account to construct the final URL
    let deployUrl = "";
    const subdomainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (subdomainRes.ok) {
      const subdomainData = await subdomainRes.json();
      if (subdomainData.result && subdomainData.result.subdomain) {
        deployUrl = `https://${projectName}.${subdomainData.result.subdomain}.workers.dev`;
      }
    }

    if (!deployUrl) {
       return NextResponse.json(
        { error: "Worker deployed but failed to retrieve workers.dev subdomain. Make sure you have setup a workers.dev subdomain in Cloudflare Dashboard." },
        { status: 400 }
      );
    }

    // Create proxy pool entry with type cloudflare
    const proxyPool = await createProxyPool({
      name: projectName,
      proxyUrl: deployUrl,
      type: "cloudflare",
      noProxy: "",
      isActive: true,
      strictProxy: false,
      relaySecret,
    });

    const privileged = await isOperatorRequest(request);
    return NextResponse.json(
      { proxyPool: sanitizePoolResponse(proxyPool, privileged), deployUrl },
      { status: 201 }
    );
  } catch (error) {
    console.log("Error deploying Cloudflare relay:", error);
    return NextResponse.json({ error: error.message || "Deploy failed" }, { status: 500 });
  }
}
