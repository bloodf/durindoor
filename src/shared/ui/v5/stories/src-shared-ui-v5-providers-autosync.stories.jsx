// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../providers/AutoSync.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Redesign/Providers/Model auto-sync", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Enabled = { ...reviewStory(original.Enabled, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const Paused = { ...reviewStory(original.Paused, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const LoadingStatus = { ...reviewStory(original.LoadingStatus, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const UnsupportedProvider = { ...reviewStory(original.UnsupportedProvider, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const NoActiveConnection = { ...reviewStory(original.NoActiveConnection, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const SyncAndReadback = { ...reviewStory(original.SyncAndReadback, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const ToggleAndReadback = { ...reviewStory(original.ToggleAndReadback, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const StatusFailureAndRetry = { ...reviewStory(original.StatusFailureAndRetry, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const SyncFailureAndRetry = { ...reviewStory(original.SyncFailureAndRetry, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const SyncPending = { ...reviewStory(original.SyncPending, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
export const SettingSaveFailure = { ...reviewStory(original.SettingSaveFailure, {"source":"src/shared/ui/v5/providers/AutoSync.stories.jsx","standalone":false}) };
