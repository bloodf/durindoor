// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/LanguageSwitcher.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shell/LanguageSwitcher", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/LanguageSwitcher.stories.jsx","standalone":true}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Success = { ...reviewStory(original.Success, {"source":"src/shared/components/LanguageSwitcher.stories.jsx","standalone":true}) };
export const RequestError = { ...reviewStory(original.RequestError, {"source":"src/shared/components/LanguageSwitcher.stories.jsx","standalone":true}) };
