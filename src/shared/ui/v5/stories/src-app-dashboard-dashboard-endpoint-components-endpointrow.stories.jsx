// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/endpoint/components/EndpointRow.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/endpoint/EndpointRow", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/endpoint/components/EndpointRow.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Idle = { ...reviewStory(original.Idle, {"source":"src/app/(dashboard)/dashboard/endpoint/components/EndpointRow.stories.jsx","standalone":false}) };
export const AccentBadge = { ...reviewStory(original.AccentBadge, {"source":"src/app/(dashboard)/dashboard/endpoint/components/EndpointRow.stories.jsx","standalone":false}) };
export const CopyInteraction = { ...reviewStory(original.CopyInteraction, {"source":"src/app/(dashboard)/dashboard/endpoint/components/EndpointRow.stories.jsx","standalone":false}) };
