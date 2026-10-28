// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/mcp-gateway/keys/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/MCP Gateway Keys", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/keys/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/keys/page.stories.jsx","standalone":false}) };
export const DeleteKey = { ...reviewStory(original.DeleteKey, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/keys/page.stories.jsx","standalone":false}) };
export const SaveGrants = { ...reviewStory(original.SaveGrants, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/keys/page.stories.jsx","standalone":false}) };
export const NewKeyKeyboard = { ...reviewStory(original.NewKeyKeyboard, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/keys/page.stories.jsx","standalone":false}) };
export const NewKeyFreshMount = { ...reviewStory(original.NewKeyFreshMount, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/keys/page.stories.jsx","standalone":false}) };
export const MobileNewKeyKeyboard = { ...reviewStory(original.MobileNewKeyKeyboard, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/keys/page.stories.jsx","standalone":false}) };
export const ErrorBoundary = { ...reviewStory(original.ErrorBoundary, {"source":"src/app/(dashboard)/dashboard/mcp-gateway/keys/page.stories.jsx","standalone":false}) };
