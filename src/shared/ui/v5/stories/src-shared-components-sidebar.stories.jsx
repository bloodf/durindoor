// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Sidebar.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shell/Sidebar", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Sidebar.stories.jsx","standalone":true}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const GroupsAndUpdate = { ...reviewStory(original.GroupsAndUpdate, {"source":"src/shared/components/Sidebar.stories.jsx","standalone":true}) };
export const MediaExpanded = { ...reviewStory(original.MediaExpanded, {"source":"src/shared/components/Sidebar.stories.jsx","standalone":true}) };
export const TokenSaverActiveHierarchy = { ...reviewStory(original.TokenSaverActiveHierarchy, {"source":"src/shared/components/Sidebar.stories.jsx","standalone":true}) };
export const CollapsibleRail = { ...reviewStory(original.CollapsibleRail, {"source":"src/shared/components/Sidebar.stories.jsx","standalone":true}) };
