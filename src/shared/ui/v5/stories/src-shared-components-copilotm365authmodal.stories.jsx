// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/CopilotM365AuthModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shared-oauth/CopilotM365AuthModal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/CopilotM365AuthModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Intro = { ...reviewStory(original.Intro, {"source":"src/shared/components/CopilotM365AuthModal.stories.jsx","standalone":false}) };
export const SignInStarted = { ...reviewStory(original.SignInStarted, {"source":"src/shared/components/CopilotM365AuthModal.stories.jsx","standalone":false}) };
export const ExchangeRejected = { ...reviewStory(original.ExchangeRejected, {"source":"src/shared/components/CopilotM365AuthModal.stories.jsx","standalone":false}) };
