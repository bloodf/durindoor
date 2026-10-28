// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/ChangelogModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Shared-Support/ChangelogModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/ChangelogModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Loaded = { ...reviewStory(original.Loaded, {"source":"src/shared/components/ChangelogModal.stories.jsx","standalone":false}) };
export const ErrorState = { ...reviewStory(original.ErrorState, {"source":"src/shared/components/ChangelogModal.stories.jsx","standalone":false}) };
export const EmptyBody = { ...reviewStory(original.EmptyBody, {"source":"src/shared/components/ChangelogModal.stories.jsx","standalone":false}) };
