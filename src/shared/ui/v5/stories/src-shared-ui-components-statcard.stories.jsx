// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/StatCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Data/StatCard", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/StatCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const NarrowLongMetric = { ...reviewStory(original.NarrowLongMetric, {"source":"src/shared/ui/components/StatCard.stories.jsx","standalone":false}) };
export const RequestsToday = { ...reviewStory(original.RequestsToday, {"source":"src/shared/ui/components/StatCard.stories.jsx","standalone":false}) };
export const DashboardMetrics = { ...reviewStory(original.DashboardMetrics, {"source":"src/shared/ui/components/StatCard.stories.jsx","standalone":false}) };
