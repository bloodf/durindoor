// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/HeaderLanguage.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shell/HeaderLanguage", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/HeaderLanguage.stories.jsx","standalone":true}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const CompactTrigger = { ...reviewStory(original.CompactTrigger, {"source":"src/shared/components/HeaderLanguage.stories.jsx","standalone":true}) };
