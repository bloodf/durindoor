// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/endpoint/EndpointPageClient.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/Endpoint", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.stories.jsx","standalone":false}) };
export const ApiKeyRequired = { ...reviewStory(original.ApiKeyRequired, {"source":"src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.stories.jsx","standalone":false}) };
export const UnsafeTunnel = { ...reviewStory(original.UnsafeTunnel, {"source":"src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.stories.jsx","standalone":false}) };
