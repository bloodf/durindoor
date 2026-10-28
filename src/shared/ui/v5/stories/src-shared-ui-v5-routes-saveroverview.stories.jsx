// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../routes/SaverOverview.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Token saver overview", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/v5/routes/SaverOverview.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Overview = { ...reviewStory(original.Overview, {"source":"src/shared/ui/v5/routes/SaverOverview.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/shared/ui/v5/routes/SaverOverview.stories.jsx","standalone":false}) };
export const ServiceUnavailable = { ...reviewStory(original.ServiceUnavailable, {"source":"src/shared/ui/v5/routes/SaverOverview.stories.jsx","standalone":false}) };
export const EditSaveAndCancel = { ...reviewStory(original.EditSaveAndCancel, {"source":"src/shared/ui/v5/routes/SaverOverview.stories.jsx","standalone":false}) };
export const AllWidgetsHidden = { ...reviewStory(original.AllWidgetsHidden, {"source":"src/shared/ui/v5/routes/SaverOverview.stories.jsx","standalone":false}) };
export const MissingSavedSource = { ...reviewStory(original.MissingSavedSource, {"source":"src/shared/ui/v5/routes/SaverOverview.stories.jsx","standalone":false}) };
export const LoadingMetrics = { ...reviewStory(original.LoadingMetrics, {"source":"src/shared/ui/v5/routes/SaverOverview.stories.jsx","standalone":false}) };
