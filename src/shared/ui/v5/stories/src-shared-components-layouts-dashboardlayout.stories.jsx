// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../../../components/layouts/DashboardLayout.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/shell/DashboardLayout", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const SuccessToast = { ...reviewStory(original.SuccessToast, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}) };
export const ErrorToast = { ...reviewStory(original.ErrorToast, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}) };
export const WarningToast = { ...reviewStory(original.WarningToast, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}) };
export const InfoToast = { ...reviewStory(original.InfoToast, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}) };
export const ToastDismissal = { ...reviewStory(original.ToastDismissal, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}) };
export const MobileDrawer = { ...reviewStory(original.MobileDrawer, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}) };
export const MobileDrawerTransitions = { ...reviewStory(original.MobileDrawerTransitions, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}) };
export const PersistedDesktopCollapse = { ...reviewStory(original.PersistedDesktopCollapse, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}) };
export const PlaygroundFullBleed = { ...reviewStory(original.PlaygroundFullBleed, {"source":"src/shared/components/layouts/DashboardLayout.stories.jsx","standalone":true}) };
