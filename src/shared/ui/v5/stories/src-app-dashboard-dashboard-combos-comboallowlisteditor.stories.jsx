// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/combos/ComboAllowListEditor.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/Combos/ComboAllowListEditor", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/combos/ComboAllowListEditor.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Unrestricted = { ...reviewStory(original.Unrestricted, {"source":"src/app/(dashboard)/dashboard/combos/ComboAllowListEditor.stories.jsx","standalone":false}) };
export const Populated = { ...reviewStory(original.Populated, {"source":"src/app/(dashboard)/dashboard/combos/ComboAllowListEditor.stories.jsx","standalone":false}) };
export const WithGroupQuickAdd = { ...reviewStory(original.WithGroupQuickAdd, {"source":"src/app/(dashboard)/dashboard/combos/ComboAllowListEditor.stories.jsx","standalone":false}) };
