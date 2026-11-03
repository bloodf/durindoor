// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/media-providers/web/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/media/WebListing", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/media-providers/web/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/media-providers/web/page.stories.jsx","standalone":false}) };
export const CreateComboError = { ...reviewStory(original.CreateComboError, {"source":"src/app/(dashboard)/dashboard/media-providers/web/page.stories.jsx","standalone":false}) };
export const ConnectionStatuses = { ...reviewStory(original.ConnectionStatuses, {"source":"src/app/(dashboard)/dashboard/media-providers/web/page.stories.jsx","standalone":false}) };
export const LoadFailureAndRetry = { ...reviewStory(original.LoadFailureAndRetry, {"source":"src/app/(dashboard)/dashboard/media-providers/web/page.stories.jsx","standalone":false}) };
export const MalformedResponseAndRetry = { ...reviewStory(original.MalformedResponseAndRetry, {"source":"src/app/(dashboard)/dashboard/media-providers/web/page.stories.jsx","standalone":false}) };
export const NetworkFailureAndRetry = { ...reviewStory(original.NetworkFailureAndRetry, {"source":"src/app/(dashboard)/dashboard/media-providers/web/page.stories.jsx","standalone":false}) };
