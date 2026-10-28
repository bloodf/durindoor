// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Tabs.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Choice/Tabs", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Tabs.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Default = { ...reviewStory(original.Default, {"source":"src/shared/ui/components/Tabs.stories.jsx","standalone":false}) };
export const WithIcons = { ...reviewStory(original.WithIcons, {"source":"src/shared/ui/components/Tabs.stories.jsx","standalone":false}) };
export const WithCounts = { ...reviewStory(original.WithCounts, {"source":"src/shared/ui/components/Tabs.stories.jsx","standalone":false}) };
export const WithDisabledTab = { ...reviewStory(original.WithDisabledTab, {"source":"src/shared/ui/components/Tabs.stories.jsx","standalone":false}) };
