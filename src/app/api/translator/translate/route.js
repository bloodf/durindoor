import { NextResponse } from "next/server";
import { detectFormat, getTargetFormat, resolveTransport } from "open-sse/services/provider.js";
import { translateRequest } from "open-sse/translator/index.js";
import { stripInternalKeys } from "open-sse/translator/validate.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { parseSuffix } from "open-sse/translator/concerns/thinkingUnified.js";
import {
  getCanonicalModelId,
  getModelTargetFormat,
  getModelUpstreamId,
  PROVIDER_ID_TO_ALIAS,
} from "open-sse/config/providerModels.js";
import { getModelInfo } from "@/sse/services/model.js";
import { getProviderConnections } from "@/lib/localDb.js";
import { getExecutor } from "open-sse/executors/index.js";

function resolveRequestModel(provider, requestedModel) {
  const { cleanModel, override } = parseSuffix(requestedModel);
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const upstreamModel = getModelUpstreamId(alias, cleanModel);
  const targetFormat = getModelTargetFormat(alias, cleanModel) || getTargetFormat(provider);
  // Kiro GPT-5.6 (#2596): synthetic `-thinking`/`-agentic` variants register an
  // upstreamModelId set to the bare wire id, so upstreamModel has lost the
  // suffix by the time translation runs. Mirror chatCore: hand translateRequest
  // the canonical (suffixed) catalog id on the Kiro seam so the translator can
  // derive the thinking/agentic flags, then strips the suffix at the wire
  // boundary. Non-Kiro targets keep the bare upstream id. Leaf import
  // (providerModels) only — chatCore would drag the DB/executor layer in here.
  const translationModel = targetFormat === FORMATS.KIRO
    ? getCanonicalModelId(alias, cleanModel) || upstreamModel
    : upstreamModel;
  return {
    capabilityModel: cleanModel,
    upstreamModel,
    translationModel,
    thinkingIntent: override,
    targetFormat,
  };
}

export async function POST(request) {
  try {
    const { step, body } = await request.json();

    if (!step || !body) {
      return NextResponse.json({ success: false, error: "Step and body required" }, { status: 400 });
    }

    switch (step) {
      case 1: {
        // Detect provider + formats from 1_req_client.json
        const clientBody = body.body || body;
        const { provider, model } = await getModelInfo(clientBody.model);
        const sourceFormat = detectFormat(clientBody);
        const targetFormat = getTargetFormat(provider);
        return NextResponse.json({ success: true, result: { provider, model, sourceFormat, targetFormat } });
      }

      case 2: {
        // source → OpenAI intermediate (mirrors 3_req_openai.json)
        // Translate source→openai only (half of the pipeline)
        const clientBody = body.body || body;
        const { provider, model } = await getModelInfo(clientBody.model);
        const sourceFormat = detectFormat(clientBody);
        const stream = clientBody.stream !== false;
        const resolvedModel = resolveRequestModel(provider, model);

        // translateRequest(source, OPENAI) = only the first half; the target
        // here is OpenAI, so use the bare upstream id (never the Kiro-canonical
        // translationModel).
        const result = translateRequest(
          sourceFormat,
          FORMATS.OPENAI,
          resolvedModel.upstreamModel,
          { ...clientBody, model: resolvedModel.capabilityModel },
          stream,
          null,
          provider,
          null,
          [],
          null,
          null,
          {
            thinkingIntent: resolvedModel.thinkingIntent,
            capabilityModel: resolvedModel.capabilityModel,
          },
        );
        delete result._toolNameMap;

        return NextResponse.json({ success: true, result: { body: result } });
      }

      case 3: {
        // OpenAI intermediate → target + build URL/headers (mirrors 4_req_target.json)
        const openaiBody = body.body || body;
        const provider = body.provider;
        const model = body.model;

        if (!provider || !model) {
          return NextResponse.json({ success: false, error: "provider and model required" }, { status: 400 });
        }

        const resolvedModel = resolveRequestModel(provider, model);
        const targetFormat = resolvedModel.targetFormat;
        const stream = openaiBody.stream !== false;

        // translateRequest(OPENAI, target) = second half of pipeline
        const translated = translateRequest(
          FORMATS.OPENAI,
          targetFormat,
          resolvedModel.translationModel,
          { ...openaiBody, model: resolvedModel.capabilityModel },
          stream,
          null,
          provider,
          null,
          [],
          null,
          null,
          {
            thinkingIntent: resolvedModel.thinkingIntent,
            capabilityModel: resolvedModel.capabilityModel,
          },
        );
        delete translated._toolNameMap;
        stripInternalKeys(translated);
        if (targetFormat !== FORMATS.KIRO) {
          translated.model = resolvedModel.upstreamModel;
        }

        // Build URL + headers via executor (same as chatCore → executor.execute)
        const connections = await getProviderConnections({ provider });
        const connection = connections.find(c => c.isActive !== false);
        if (!connection) {
          return NextResponse.json({ success: false, error: `No active connection for provider: ${provider}` }, { status: 400 });
        }

        const credentials = {
          apiKey: connection.apiKey,
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken,
          copilotToken: connection.copilotToken,
          projectId: connection.projectId,
          providerSpecificData: connection.providerSpecificData
        };

        // Attach the resolved transport so the executor uses the model-selected URL/auth headers.
        const runtimeTransport = resolveTransport(provider, targetFormat);
        if (runtimeTransport) credentials.runtimeTransport = runtimeTransport;

        const executor = getExecutor(provider);
        const url = executor.buildUrl(resolvedModel.upstreamModel, stream, 0, credentials);
        const headers = executor.buildHeaders(credentials, stream);
        const finalBody = executor.transformRequest(
          resolvedModel.upstreamModel,
          translated,
          stream,
          credentials,
        );

        return NextResponse.json({ success: true, result: { url, headers, body: finalBody } });
      }

      default:
        return NextResponse.json({ success: false, error: "Invalid step (1-3)" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error in translator:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
