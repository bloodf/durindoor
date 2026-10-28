// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/cli-tools/components/ToolCards.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/cli-tools/ToolCards", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolCards.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ClaudeCollapsed = { ...reviewStory(original.ClaudeCollapsed, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolCards.stories.jsx","standalone":false}) };
export const ClaudeExpanded = { ...reviewStory(original.ClaudeExpanded, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolCards.stories.jsx","standalone":false}) };
export const AntigravityInactive = { ...reviewStory(original.AntigravityInactive, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolCards.stories.jsx","standalone":false}) };
export const AntigravityActive = { ...reviewStory(original.AntigravityActive, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolCards.stories.jsx","standalone":false}) };
export const MitmServerStopped = { ...reviewStory(original.MitmServerStopped, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolCards.stories.jsx","standalone":false}) };
export const MitmServerRunning = { ...reviewStory(original.MitmServerRunning, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/ToolCards.stories.jsx","standalone":false}) };
