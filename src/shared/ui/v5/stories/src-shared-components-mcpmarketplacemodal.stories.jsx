// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/McpMarketplaceModal.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/GitHub", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/McpMarketplaceModal.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Browse = { ...reviewStory(original.Browse, {"source":"src/shared/components/McpMarketplaceModal.stories.jsx","standalone":false}) };
export const FilterAuthless = { ...reviewStory(original.FilterAuthless, {"source":"src/shared/components/McpMarketplaceModal.stories.jsx","standalone":false}) };
export const RequiresAuthBranch = { ...reviewStory(original.RequiresAuthBranch, {"source":"src/shared/components/McpMarketplaceModal.stories.jsx","standalone":false}) };
export const ProbeErrorBranch = { ...reviewStory(original.ProbeErrorBranch, {"source":"src/shared/components/McpMarketplaceModal.stories.jsx","standalone":false}) };
export const ConfirmAddPerServerRow = { ...reviewStory(original.ConfirmAddPerServerRow, {"source":"src/shared/components/McpMarketplaceModal.stories.jsx","standalone":false}) };
export const RegistryError = { ...reviewStory(original.RegistryError, {"source":"src/shared/components/McpMarketplaceModal.stories.jsx","standalone":false}) };
