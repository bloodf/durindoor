// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/combos/error.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/combos/CombosError", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/combos/error.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Retry = { ...reviewStory(original.Retry, {"source":"src/app/(dashboard)/dashboard/combos/error.stories.jsx","standalone":false}) };
export const RetainedError = { ...reviewStory(original.RetainedError, {"source":"src/app/(dashboard)/dashboard/combos/error.stories.jsx","standalone":false}) };
