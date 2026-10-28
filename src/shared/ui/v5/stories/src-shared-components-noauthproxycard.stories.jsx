// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/NoAuthProxyCard.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-provider/NoAuthProxyCard", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/NoAuthProxyCard.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const TwoOrMorePoolsReady = { ...reviewStory(original.TwoOrMorePoolsReady, {"source":"src/shared/components/NoAuthProxyCard.stories.jsx","standalone":false}) };
export const SavesStrategyAndPoolsPersist = { ...reviewStory(original.SavesStrategyAndPoolsPersist, {"source":"src/shared/components/NoAuthProxyCard.stories.jsx","standalone":false}) };
export const FewerThanTwoPoolsDisablesRotation = { ...reviewStory(original.FewerThanTwoPoolsDisablesRotation, {"source":"src/shared/components/NoAuthProxyCard.stories.jsx","standalone":false}) };
export const RotationStrategyChangePersists = { ...reviewStory(original.RotationStrategyChangePersists, {"source":"src/shared/components/NoAuthProxyCard.stories.jsx","standalone":false}) };
