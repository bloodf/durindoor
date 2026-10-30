// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/providers/components/ModelAvailabilityBadge.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/providers/components/ModelAvailabilityBadge", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/providers/components/ModelAvailabilityBadge.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Healthy = { ...reviewStory(original.Healthy, {"source":"src/app/(dashboard)/dashboard/providers/components/ModelAvailabilityBadge.stories.jsx","standalone":false}) };
export const WithIssuesOpen = { ...reviewStory(original.WithIssuesOpen, {"source":"src/app/(dashboard)/dashboard/providers/components/ModelAvailabilityBadge.stories.jsx","standalone":false}) };
