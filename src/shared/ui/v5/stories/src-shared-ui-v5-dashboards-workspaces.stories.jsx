// Generated from the actual component stories. Do not edit; run node scripts/gen-v5-stories.mjs.
import React from 'react';
import originalMeta, * as original from "../dashboards/Workspaces.stories.jsx";
import { reviewDecorator } from '../ReviewFrame.jsx';
import { reviewParameters, reviewStory } from '../review-parameters.js';
const meta = { ...originalMeta, title: "V5 review/Workflows/Your dashboards", parameters: reviewParameters(originalMeta.parameters, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}), decorators: [...(originalMeta.decorators || []), reviewDecorator] };
export default meta;
export const Operations = { ...reviewStory(original.Operations, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
export const CreateAndComposeDashboard = { ...reviewStory(original.CreateAndComposeDashboard, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
export const RenameAndDeleteDashboard = { ...reviewStory(original.RenameAndDeleteDashboard, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
export const EmptyDashboard = { ...reviewStory(original.EmptyDashboard, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
export const MissingSource = { ...reviewStory(original.MissingSource, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
export const MonitoringUnavailable = { ...reviewStory(original.MonitoringUnavailable, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
export const MonitoringRefreshAndPause = { ...reviewStory(original.MonitoringRefreshAndPause, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
export const DirtyDashboardSelection = { ...reviewStory(original.DirtyDashboardSelection, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
export const MonitoringOnlyWithOtherSourcesOffline = { ...reviewStory(original.MonitoringOnlyWithOtherSourcesOffline, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
export const SlowMonitoringSnapshot = { ...reviewStory(original.SlowMonitoringSnapshot, {"source":"src/shared/ui/v5/dashboards/Workspaces.stories.jsx","standalone":false}) };
