// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/timeline/[id]/components/EventRow.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/timeline/EventRow", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/components/EventRow.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ObjectPayload = { ...reviewStory(original.ObjectPayload, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/components/EventRow.stories.jsx","standalone":false}) };
export const StringPayload = { ...reviewStory(original.StringPayload, {"source":"src/app/(dashboard)/dashboard/timeline/[id]/components/EventRow.stories.jsx","standalone":false}) };
