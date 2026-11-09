// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/RequestLogger.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-analytics/RequestLogger", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/RequestLogger.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Populated = { ...reviewStory(original.Populated, {"source":"src/shared/components/RequestLogger.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/shared/components/RequestLogger.stories.jsx","standalone":false}) };
export const FetchError = { ...reviewStory(original.FetchError, {"source":"src/shared/components/RequestLogger.stories.jsx","standalone":false}) };
export const AutoRefreshControl = { ...reviewStory(original.AutoRefreshControl, {"source":"src/shared/components/RequestLogger.stories.jsx","standalone":false}) };
