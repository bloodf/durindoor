// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Modal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Overlays/Modal", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Modal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Keyboard = { ...reviewStory(original.Keyboard, {"source":"src/shared/ui/components/Modal.stories.jsx","standalone":false}) };
export const Nested = { ...reviewStory(original.Nested, {"source":"src/shared/ui/components/Modal.stories.jsx","standalone":false}) };
export const Busy = { ...reviewStory(original.Busy, {"source":"src/shared/ui/components/Modal.stories.jsx","standalone":false}) };
export const Cancel = { ...reviewStory(original.Cancel, {"source":"src/shared/ui/components/Modal.stories.jsx","standalone":false}) };
export const LongContent = { ...reviewStory(original.LongContent, {"source":"src/shared/ui/components/Modal.stories.jsx","standalone":false}) };
export const Mobile = { ...reviewStory(original.Mobile, {"source":"src/shared/ui/components/Modal.stories.jsx","standalone":false}) };
export const NarrowOverflow = { ...reviewStory(original.NarrowOverflow, {"source":"src/shared/ui/components/Modal.stories.jsx","standalone":false}) };
