// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/HeaderMenu.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shell/HeaderMenu", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/HeaderMenu.stories.jsx","standalone":true}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ShutdownConfirm = { ...reviewStory(original.ShutdownConfirm, {"source":"src/shared/components/HeaderMenu.stories.jsx","standalone":true}) };
export const OpenMenu = { ...reviewStory(original.OpenMenu, {"source":"src/shared/components/HeaderMenu.stories.jsx","standalone":true}) };
