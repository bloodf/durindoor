// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/Header.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shell/Header", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/Header.stories.jsx","standalone":true}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const SessionAndSearch = { ...reviewStory(original.SessionAndSearch, {"source":"src/shared/components/Header.stories.jsx","standalone":true}) };
export const MobileMenu = { ...reviewStory(original.MobileMenu, {"source":"src/shared/components/Header.stories.jsx","standalone":true}) };
