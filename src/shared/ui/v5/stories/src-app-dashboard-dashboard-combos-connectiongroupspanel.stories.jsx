// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/Combos/ConnectionGroupsPanel", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Empty = { ...reviewStory(original.Empty, {"source":"src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.stories.jsx","standalone":false}) };
export const WithGroups = { ...reviewStory(original.WithGroups, {"source":"src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.stories.jsx","standalone":false}) };
export const CreateGroup = { ...reviewStory(original.CreateGroup, {"source":"src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.stories.jsx","standalone":false}) };
