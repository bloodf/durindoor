// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/timeline/components/TimelineSwimlane.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/timeline/TimelineSwimlane", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/timeline/components/TimelineSwimlane.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/timeline/components/TimelineSwimlane.stories.jsx","standalone":false}) };
export const LiveAppend = { ...reviewStory(original.LiveAppend, {"source":"src/app/(dashboard)/dashboard/timeline/components/TimelineSwimlane.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/timeline/components/TimelineSwimlane.stories.jsx","standalone":false}) };
export const NarrowSimultaneous = { ...reviewStory(original.NarrowSimultaneous, {"source":"src/app/(dashboard)/dashboard/timeline/components/TimelineSwimlane.stories.jsx","standalone":false}) };
