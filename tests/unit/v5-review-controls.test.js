// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { V5NativeSelect, nativeOptions } from '../../src/shared/ui/v5/NativeSelect.jsx';
import { getStoryFixtureOptions } from '../../.storybook/decorators.jsx';
import { reviewParameters, reviewStory } from '../../src/shared/ui/v5/review-parameters.js';
import { surfaceForRoute, reviewSidebarSections, isReviewComponent } from '../../src/shared/ui/v5/review-navigation.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; container?.remove(); document.documentElement.removeAttribute('data-v5-review'); });
async function mount(node, review = true) { if (review) document.documentElement.dataset.v5Review = 'true'; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); await act(async () => root.render(node)); }
const options = [React.createElement('option', { key: 'never', value: '' }, 'Choose expiry'), React.createElement('option', { key: '30', value: '30' }, '30 days'), React.createElement('option', { key: '90', value: '90', disabled: true }, '90 days')];

describe('review native dropdown compatibility', () => {
  it('selects through the custom menu and serializes the original named native control', async () => {
    let eventValue;
    await mount(React.createElement('form', {}, React.createElement(V5NativeSelect, { name: 'expiration', defaultValue: '', 'aria-label': 'Expiration', onChange: (event) => { eventValue = event.target.value; } }, options)));
    await act(async () => container.querySelector('[role="combobox"]').click());
    const option = [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent.trim() === '30 days');
    await act(async () => option.click());
    expect(eventValue).toBe('30');
    expect(new FormData(container.querySelector('form')).get('expiration')).toBe('30');
    expect(container.querySelector('[role="combobox"]').textContent).toContain('30 days');
  });
  it('keeps externally controlled values and disabled choices authoritative', async () => {
    const change = [];
    await mount(React.createElement(V5NativeSelect, { value: '30', onChange: (event) => change.push(event.target.value) }, options));
    await act(async () => container.querySelector('[role="combobox"]').click());
    const disabled = [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent.trim() === '90 days');
    await act(async () => disabled.click());
    expect(change).toEqual([]);
    expect(container.querySelector('select').value).toBe('30');
  });
  it('keeps native required validation and focuses its visible trigger', async () => {
    await mount(React.createElement(V5NativeSelect, { value: '', required: true, onChange: () => {} }, options));
    await act(async () => container.querySelector('select').dispatchEvent(new Event('invalid', { cancelable: true })));
    expect(document.activeElement).toBe(container.querySelector('[role="combobox"]'));
    expect(container.querySelector('[role="alert"]').textContent).toBe('Choose an option.');
  });
  it('preserves disabled groups and a control associated with an external form', async () => {
    const grouped = React.createElement('optgroup', { disabled: true, label: 'Unavailable' }, React.createElement('option', { value: 'restricted' }, 'Restricted'));
    expect(nativeOptions(grouped)[0]).toMatchObject({ disabled: true, hint: 'Unavailable' });
    await mount(React.createElement(React.Fragment, {}, React.createElement('form', { id: 'settings' }), React.createElement(V5NativeSelect, { name: 'expiration', form: 'settings', value: '30', onChange: () => {} }, options)));
    expect(new FormData(container.querySelector('form')).get('expiration')).toBe('30');
  });
  it('retains the incumbent native select outside the review scope', async () => {
    await mount(React.createElement(V5NativeSelect, { value: '30', onChange: () => {} }, options), false);
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.querySelector('select').value).toBe('30');
  });
});

describe('source story and resource contracts', () => {
  it('routes settings to its full page and media to the most specific workflow', () => {
    expect(surfaceForRoute('/dashboard/profile').source).toBe('src/app/(dashboard)/dashboard/profile/page.stories.jsx');
    expect(surfaceForRoute('/dashboard/media-providers/web').source).toBe('src/app/(dashboard)/dashboard/media-providers/web/page.stories.jsx');
    expect(surfaceForRoute('/dashboard/media-providers/combo/review-route').source).toBe('src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.stories.jsx');
    expect(surfaceForRoute('/dashboard/providers/openai').source).toBe('src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx');
    expect(surfaceForRoute('/dashboard/token-saver').source).toBe('src/shared/ui/v5/routes/SaverOverview.stories.jsx');
    expect(surfaceForRoute('/dashboard').source).toBe('src/app/(dashboard)/dashboard/usage/page.stories.jsx');
  });
  it('keeps original play/args/lifecycle and per-story authentication presentation', async () => {
    let playedCanvas;
    const play = ({ canvasElement }) => { playedCanvas = canvasElement; };
    const beforeEach = () => {};
    const original = { play, beforeEach, args: { key: 'synthetic' }, parameters: { storyFixture: { pathname: '/login' }, v5Review: { keepRedirectVisible: true } } };
    const result = reviewStory(original, { source: 'source.jsx', standalone: false });
    const canvas = document.createElement('div');
    const content = document.createElement('div'); content.dataset.v5StoryCanvas = ''; canvas.appendChild(content);
    await result.play({ canvasElement: canvas }); expect(playedCanvas).toBe(content);
    expect(result.beforeEach).toBe(beforeEach); expect(result.args).toEqual(original.args);
    expect(result.parameters.v5Review).toMatchObject({ standalone: true, keepRedirectVisible: true });
  });
  it('lets page fixtures override shell routes and keeps unknown operations unconfigured', () => {
    const route = { status: 403, body: { error: 'Forbidden' } };
    const result = reviewParameters({ storyFixture: { routes: { 'GET /api/auth/status': route } } }, { source: 'source.jsx' });
    expect(result.storyFixture.routes['GET /api/auth/status']).toBe(route);
    expect(result.storyFixture.routes['POST /api/deploy']).toBeUndefined();
  });
  it('maps deep-linked resource identities and queries without changing source args', () => {
    const old = window.location.href;
    window.location.href = 'http://storybook.local/iframe.html?id=review&v5Route=%2Fdashboard%2Fmedia-providers%2Fvideo%2Freview-video%3Ftab%3Dmodels';
    const context = { parameters: { v5Review: {}, storyFixture: { pathname: '/dashboard/media-providers/image/default', params: { kind: 'image', id: 'default' } } }, globals: {} };
    const result = getStoryFixtureOptions(context);
    expect(result.pathname).toBe('/dashboard/media-providers/video/review-video?tab=models');
    expect(result.params).toEqual({ kind: 'video', id: 'review-video' });
    expect(context.parameters.storyFixture.params.id).toBe('default');
    window.location.href = old;
  });
});

describe('review shell boundaries', () => {
  it('adds personal dashboards only at render time inside review, without mutating production navigation', () => {
    const sections = [{ key: 'monitor', entries: [{ href: '/dashboard/usage' }] }];
    expect(reviewSidebarSections(sections)).toBe(sections);
    document.documentElement.dataset.v5Review = 'true';
    expect(reviewSidebarSections(sections)[0].entries[0].href).toBe('/dashboard/workspaces');
    expect(sections[0].entries).toHaveLength(1);
  });
  it('does not put component-only stories inside an unrelated page shell', () => {
    expect(isReviewComponent('src/app/(dashboard)/dashboard/combos/ComboAllowListEditor.stories.jsx')).toBe(true);
    expect(isReviewComponent('src/app/(dashboard)/dashboard/combos/page.stories.jsx')).toBe(false);
    expect(isReviewComponent('src/shared/ui/v5/providers/AutoSync.stories.jsx', true)).toBe(true);
  });
});
