// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/pxpipe/PxpipeClient", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Populated = { ...reviewStory(original.Populated, {"source":"src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx","standalone":false}) };
export const Unavailable = { ...reviewStory(original.Unavailable, {"source":"src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx","standalone":false}) };
export const Loading = { ...reviewStory(original.Loading, {"source":"src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx","standalone":false}) };
export const KeyboardPagingAndRange = { ...reviewStory(original.KeyboardPagingAndRange, {"source":"src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx","standalone":false}) };
export const RTL = { ...reviewStory(original.RTL, {"source":"src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx","standalone":false}) };
export const MobileViewport = { ...reviewStory(original.MobileViewport, {"source":"src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.stories.jsx","standalone":false}) };
