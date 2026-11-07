// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../../app/(dashboard)/dashboard/timeline/page.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Pages/timeline/TimelinePage", parameters: reviewParameters(originalMeta.parameters, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Loaded = { ...reviewStory(original.Loaded, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const SelectBar = { ...reviewStory(original.SelectBar, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const ConnectionLanes = { ...reviewStory(original.ConnectionLanes, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const TableView = { ...reviewStory(original.TableView, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const LiveUpdates = { ...reviewStory(original.LiveUpdates, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const CaptureDisabled = { ...reviewStory(original.CaptureDisabled, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const AllRows = { ...reviewStory(original.AllRows, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const LoadError = { ...reviewStory(original.LoadError, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const Loading = { ...reviewStory(original.Loading, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const StreamDisconnectAndReconnect = { ...reviewStory(original.StreamDisconnectAndReconnect, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
export const InitialReadUnavailable = { ...reviewStory(original.InitialReadUnavailable, {"source":"src/app/(dashboard)/dashboard/timeline/page.stories.jsx","standalone":false}) };
