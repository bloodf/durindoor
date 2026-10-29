// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/providers/[id]/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/providers/ProviderDetailPage", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const OpenAIDetail = { ...reviewStory(original.OpenAIDetail, {"source":"src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx","standalone":false}) };
export const SettingsControls = { ...reviewStory(original.SettingsControls, {"source":"src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx","standalone":false}) };
export const CompatibleBranch = { ...reviewStory(original.CompatibleBranch, {"source":"src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx","standalone":false}) };
export const CompatibleProxyOpen = { ...reviewStory(original.CompatibleProxyOpen, {"source":"src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx","standalone":false}) };
