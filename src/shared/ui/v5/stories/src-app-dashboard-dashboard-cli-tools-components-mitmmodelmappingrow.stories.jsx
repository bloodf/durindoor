// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/cli-tools/components/MitmModelMappingRow.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/cli-tools/MitmModelMappingRow", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/MitmModelMappingRow.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/MitmModelMappingRow.stories.jsx","standalone":false}) };
export const WithModel = { ...reviewStory(original.WithModel, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/MitmModelMappingRow.stories.jsx","standalone":false}) };
export const AntigravityReasoning = { ...reviewStory(original.AntigravityReasoning, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/MitmModelMappingRow.stories.jsx","standalone":false}) };
export const Disabled = { ...reviewStory(original.Disabled, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/MitmModelMappingRow.stories.jsx","standalone":false}) };
export const ClearModel = { ...reviewStory(original.ClearModel, {"source":"src/app/(dashboard)/dashboard/cli-tools/components/MitmModelMappingRow.stories.jsx","standalone":false}) };
