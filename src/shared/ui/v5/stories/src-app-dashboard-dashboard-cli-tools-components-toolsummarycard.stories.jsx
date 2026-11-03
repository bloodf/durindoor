// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/cli-tools/ToolSummaryCard", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Connected = { ...reviewStory(original.Connected, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.stories.jsx","standalone":false}) };
export const NotConfigured = { ...reviewStory(original.NotConfigured, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.stories.jsx","standalone":false}) };
export const NotInstalled = { ...reviewStory(original.NotInstalled, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.stories.jsx","standalone":false}) };
export const Unknown = { ...reviewStory(original.Unknown, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.stories.jsx","standalone":false}) };
export const Unsupported = { ...reviewStory(original.Unsupported, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolSummaryCard.stories.jsx","standalone":false}) };
