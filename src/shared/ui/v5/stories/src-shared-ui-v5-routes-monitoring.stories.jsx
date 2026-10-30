// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../routes/Monitoring.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Monitoring", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/v5/routes/Monitoring.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Runtime = { ...reviewStory(original.Runtime, {"source":"src/shared/ui/v5/routes/Monitoring.stories.jsx","standalone":false}) };
export const RequestFailure = { ...reviewStory(original.RequestFailure, {"source":"src/shared/ui/v5/routes/Monitoring.stories.jsx","standalone":false}) };
export const StorageAndProviderWarning = { ...reviewStory(original.StorageAndProviderWarning, {"source":"src/shared/ui/v5/routes/Monitoring.stories.jsx","standalone":false}) };
