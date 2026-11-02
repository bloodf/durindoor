// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/cli-tools/DefaultToolCard", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const QwenGuideConfigured = { ...reviewStory(original.QwenGuideConfigured, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.stories.jsx","standalone":false}) };
export const CursorExternalUrlUnavailable = { ...reviewStory(original.CursorExternalUrlUnavailable, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.stories.jsx","standalone":false}) };
