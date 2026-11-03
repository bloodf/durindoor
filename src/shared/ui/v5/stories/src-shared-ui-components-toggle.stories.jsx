// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Toggle.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Choice/Toggle", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Toggle.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/ui/components/Toggle.stories.jsx","standalone":false}) };
export const Off = { ...reviewStory(original.Off, {"source":"src/shared/ui/components/Toggle.stories.jsx","standalone":false}) };
export const On = { ...reviewStory(original.On, {"source":"src/shared/ui/components/Toggle.stories.jsx","standalone":false}) };
export const Sizes = { ...reviewStory(original.Sizes, {"source":"src/shared/ui/components/Toggle.stories.jsx","standalone":false}) };
export const Disabled = { ...reviewStory(original.Disabled, {"source":"src/shared/ui/components/Toggle.stories.jsx","standalone":false}) };
export const SettingsCard = { ...reviewStory(original.SettingsCard, {"source":"src/shared/ui/components/Toggle.stories.jsx","standalone":false}) };
