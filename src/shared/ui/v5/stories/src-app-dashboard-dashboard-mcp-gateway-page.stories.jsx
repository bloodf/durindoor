// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/MCP Gateway", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx","standalone":false}) };
export const DeleteInstance = { ...reviewStory(original.DeleteInstance, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx","standalone":false}) };
export const OAuthLoginPopupBoundary = { ...reviewStory(original.OAuthLoginPopupBoundary, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx","standalone":false}) };
export const CreateInstance = { ...reviewStory(original.CreateInstance, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx","standalone":false}) };
export const SelectServerPreset = { ...reviewStory(original.SelectServerPreset, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx","standalone":false}) };
export const EditInstance = { ...reviewStory(original.EditInstance, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx","standalone":false}) };
export const ToggleInstance = { ...reviewStory(original.ToggleInstance, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx","standalone":false}) };
export const ErrorBoundary = { ...reviewStory(original.ErrorBoundary, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/page.stories.jsx","standalone":false}) };
