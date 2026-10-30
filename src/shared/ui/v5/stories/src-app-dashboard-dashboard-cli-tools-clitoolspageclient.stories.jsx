// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/cli-tools/CLIToolsPageClient", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Catalog = { ...reviewStory(original.Catalog, {"source":"src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.stories.jsx","standalone":false}) };
export const CatalogVisible = { ...reviewStory(original.CatalogVisible, {"source":"src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.stories.jsx","standalone":false}) };
export const MitmSectionVisible = { ...reviewStory(original.MitmSectionVisible, {"source":"src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.stories.jsx","standalone":false}) };
export const FetchError = { ...reviewStory(original.FetchError, {"source":"src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.stories.jsx","standalone":false}) };
export const Loading = { ...reviewStory(original.Loading, {"source":"src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.stories.jsx","standalone":false}) };
export const FetchErrorRetry = { ...reviewStory(original.FetchErrorRetry, {"source":"src/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.stories.jsx","standalone":false}) };
