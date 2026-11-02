// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/DataTable.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Data/DataTable", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const ProxyTimeline = { ...reviewStory(original.ProxyTimeline, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}) };
export const Empty = { ...reviewStory(original.Empty, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}) };
export const Loading = { ...reviewStory(original.Loading, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}) };
export const Sortable = { ...reviewStory(original.Sortable, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}) };
export const Expandable = { ...reviewStory(original.Expandable, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}) };
export const ServerOwnedTotal = { ...reviewStory(original.ServerOwnedTotal, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}) };
export const Narrow = { ...reviewStory(original.Narrow, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}) };
export const DenseLongValues = { ...reviewStory(original.DenseLongValues, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}) };
export const Frameless = { ...reviewStory(original.Frameless, {"source":"src/shared/ui/components/DataTable.stories.jsx","standalone":false}) };
