// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../motion/Motion.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Motion/Actions", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/v5/motion/Motion.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const SaveAndReadback = { ...reviewStory(original.SaveAndReadback, {"source":"src/shared/ui/v5/motion/Motion.stories.jsx","standalone":false}) };
