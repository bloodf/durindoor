// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/KeyValue.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Data/KeyValue", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/KeyValue.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Playground = { ...reviewStory(original.Playground, {"source":"src/shared/ui/components/KeyValue.stories.jsx","standalone":false}) };
export const ApiKeyMetadata = { ...reviewStory(original.ApiKeyMetadata, {"source":"src/shared/ui/components/KeyValue.stories.jsx","standalone":false}) };
