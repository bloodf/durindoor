// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../components/Pagination.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Components/Durin DS/Data/Pagination", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/components/Pagination.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const FirstPage = { ...reviewStory(original.FirstPage, {"source":"src/shared/ui/components/Pagination.stories.jsx","standalone":false}) };
export const MiddlePage = { ...reviewStory(original.MiddlePage, {"source":"src/shared/ui/components/Pagination.stories.jsx","standalone":false}) };
export const LastPage = { ...reviewStory(original.LastPage, {"source":"src/shared/ui/components/Pagination.stories.jsx","standalone":false}) };
export const TotalFallback = { ...reviewStory(original.TotalFallback, {"source":"src/shared/ui/components/Pagination.stories.jsx","standalone":false}) };
export const WithRowsPerPage = { ...reviewStory(original.WithRowsPerPage, {"source":"src/shared/ui/components/Pagination.stories.jsx","standalone":false}) };
export const SinglePage = { ...reviewStory(original.SinglePage, {"source":"src/shared/ui/components/Pagination.stories.jsx","standalone":false}) };
