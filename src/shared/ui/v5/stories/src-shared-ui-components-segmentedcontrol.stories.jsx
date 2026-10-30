// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/SegmentedControl.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Choice/SegmentedControl", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/SegmentedControl.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/ui/components/SegmentedControl.stories.jsx","standalone":false}) };
export const WithIcons = { ...reviewStory(original.WithIcons, {"source":"src/shared/ui/components/SegmentedControl.stories.jsx","standalone":false}) };
export const Small = { ...reviewStory(original.Small, {"source":"src/shared/ui/components/SegmentedControl.stories.jsx","standalone":false}) };
export const DisabledControl = { ...reviewStory(original.DisabledControl, {"source":"src/shared/ui/components/SegmentedControl.stories.jsx","standalone":false}) };
export const DisabledOption = { ...reviewStory(original.DisabledOption, {"source":"src/shared/ui/components/SegmentedControl.stories.jsx","standalone":false}) };
