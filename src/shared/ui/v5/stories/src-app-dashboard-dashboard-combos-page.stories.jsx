// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/combos/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/Combos/CombosPage", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const LoadFailure = { ...reviewStory(original.LoadFailure, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const DeleteFlow = { ...reviewStory(original.DeleteFlow, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const CreateFlow = { ...reviewStory(original.CreateFlow, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const EditFlow = { ...reviewStory(original.EditFlow, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const SaveFailure = { ...reviewStory(original.SaveFailure, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const LoadFailureError = { ...reviewStory(original.LoadFailureError, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const CreateComboSpacing = { ...reviewStory(original.CreateComboSpacing, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const CreateComboSpacingMobile = { ...reviewStory(original.CreateComboSpacingMobile, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
export const ConnectionUsage = { ...reviewStory(original.ConnectionUsage, {"source":"src/app/(dashboard)/dashboard/combos/page.stories.jsx","standalone":false}) };
