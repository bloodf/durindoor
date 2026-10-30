// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/DocsLink.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-navigation/DocsLink", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/DocsLink.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ExternalDocumentation = { ...reviewStory(original.ExternalDocumentation, {"source":"src/shared/components/DocsLink.stories.jsx","standalone":false}) };
