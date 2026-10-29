import React from 'react';
import PageHeader from '@/shared/ui/components/PageHeader.jsx';
import { expect, userEvent, within } from 'storybook/test';
import MonitoringPage from '../dashboards/MonitoringWidget.jsx';
function MonitoringReviewPage() { return <section className="space-y-5"><PageHeader icon="monitoring" title="Monitoring" subtitle="Runtime, activity and storage" /><MonitoringPage /></section>; }
const payload = { version: '4.10.1', latencyMs: 24, runtime: { processUptimeSec: 86400, nodeVersion: '20.20.2', memoryRssMB: 146, dbSizeLabel: '8.2 MB', dbPath: '/review/data.sqlite', dataDir: '/review', errorProvider: '' }, activity: { today: { requests: 3180, promptTokens: 183000, completionTokens: 59000, providers: 5, models: 12 } }, health: [{ provider: 'openai', status: 'active' }] };
const meta = { title: 'Monitoring', component: MonitoringReviewPage, parameters: { reviewRoute: '/dashboard/monitoring', storyFixture: { scenario: 'default', pathname: '/dashboard/monitoring', routes: { 'GET /api/monitoring': { body: payload } } } } };
export default meta;
export const Runtime = { play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(await canvas.findByText('146 MB')).toBeVisible(); await userEvent.click(canvas.getByRole('button', { name: 'Live', exact: true })); await expect(canvas.getByRole('button', { name: 'Paused', exact: true })).toBeVisible(); await userEvent.click(canvas.getByRole('button', { name: /Refresh/ })); await expect(canvas.getByText('3,180')).toBeVisible(); } };
export const RequestFailure = { parameters: { storyFixture: { routes: { 'GET /api/monitoring': { status: 503, body: { error: 'Unavailable' } } } } }, play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByRole('alert')).toHaveTextContent('HTTP 503'); } };
export const StorageAndProviderWarning = { parameters: { storyFixture: { routes: { 'GET /api/monitoring': { body: { ...payload, latencyMs: 1500, runtime: { ...payload.runtime, errorProvider: 'review-provider' } } } } } } };
