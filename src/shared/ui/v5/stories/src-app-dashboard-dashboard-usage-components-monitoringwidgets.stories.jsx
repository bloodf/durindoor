// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/usage/components/MonitoringWidgets.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/usage/Monitoring widgets", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/usage/components/MonitoringWidgets.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/usage/components/MonitoringWidgets.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/usage/components/MonitoringWidgets.stories.jsx","standalone":false}) };
export const Recovery = { ...reviewStory(original.Recovery, {"source":"src/app/(dashboard)/dashboard/usage/components/MonitoringWidgets.stories.jsx","standalone":false}) };
