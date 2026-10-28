// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/providers/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/providers/ProvidersPage", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/providers/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Inventory = { ...reviewStory(original.Inventory, {"source":"src/app/(dashboard)/dashboard/providers/page.stories.jsx","standalone":false}) };
export const StatusFiltering = { ...reviewStory(original.StatusFiltering, {"source":"src/app/(dashboard)/dashboard/providers/page.stories.jsx","standalone":false}) };
export const AllStatusScenarios = { ...reviewStory(original.AllStatusScenarios, {"source":"src/app/(dashboard)/dashboard/providers/page.stories.jsx","standalone":false}) };
