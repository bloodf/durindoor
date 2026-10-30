// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Footer.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Shared-Support/Footer", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Footer.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/components/Footer.stories.jsx","standalone":false}) };
export const NarrowViewport = { ...reviewStory(original.NarrowViewport, {"source":"src/shared/components/Footer.stories.jsx","standalone":false}) };
