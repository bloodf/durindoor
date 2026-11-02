// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../routes/SaverSettings.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Token saver settings", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/v5/routes/SaverSettings.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const AllSettings = { ...reviewStory(original.AllSettings, {"source":"src/shared/ui/v5/routes/SaverSettings.stories.jsx","standalone":false}) };
export const DependencyMissing = { ...reviewStory(original.DependencyMissing, {"source":"src/shared/ui/v5/routes/SaverSettings.stories.jsx","standalone":false}) };
