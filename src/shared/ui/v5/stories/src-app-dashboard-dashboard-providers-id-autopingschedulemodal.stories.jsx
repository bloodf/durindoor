// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/providers/AutoPingScheduleModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Open = { ...reviewStory(original.Open, {"source":"src/app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.stories.jsx","standalone":false}) };
export const ValidationError = { ...reviewStory(original.ValidationError, {"source":"src/app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.stories.jsx","standalone":false}) };
export const Loading = { ...reviewStory(original.Loading, {"source":"src/app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.stories.jsx","standalone":false}) };
export const SaveError = { ...reviewStory(original.SaveError, {"source":"src/app/(dashboard)/dashboard/providers/[id]/AutoPingScheduleModal.stories.jsx","standalone":false}) };
