// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/PageHeader.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Data/PageHeader", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/PageHeader.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const BaseHeader = { ...reviewStory(original.BaseHeader, {"source":"src/shared/ui/components/PageHeader.stories.jsx","standalone":false}) };
export const WithActions = { ...reviewStory(original.WithActions, {"source":"src/shared/ui/components/PageHeader.stories.jsx","standalone":false}) };
export const NarrowWithLongContent = { ...reviewStory(original.NarrowWithLongContent, {"source":"src/shared/ui/components/PageHeader.stories.jsx","standalone":false}) };
