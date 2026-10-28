// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../routes/MediaRoutes.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Media routes", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/v5/routes/MediaRoutes.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Automatic = { ...reviewStory(original.Automatic, {"source":"src/shared/ui/v5/routes/MediaRoutes.stories.jsx","standalone":false}) };
export const CustomUnavailable = { ...reviewStory(original.CustomUnavailable, {"source":"src/shared/ui/v5/routes/MediaRoutes.stories.jsx","standalone":false}) };
export const ResetToAutomatic = { ...reviewStory(original.ResetToAutomatic, {"source":"src/shared/ui/v5/routes/MediaRoutes.stories.jsx","standalone":false}) };
