// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginView } from '../../src/app/login/LoginView.js';
import { CallbackStatusView } from '../../src/app/callback/CallbackStatusView.js';
import CallbackPage from '../../src/app/callback/page.js';
import { deliverOAuthCallback } from '../../src/app/callback/callbackDelivery.js';
import GateScene from '../../src/shared/ui/v5/login/GateScene.jsx';
import { startGateScene } from '../../src/shared/ui/v5/login/gate-scene.js';

vi.mock('../../src/shared/ui/login/durinDoorBackdrop.js', async (original) => ({ ...await original(), startDurinDoorBackdrop: () => ({ destroy() {} }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams }));
vi.mock('../../src/app/callback/callbackDelivery.js', () => ({ deliverOAuthCallback: vi.fn(() => () => {}) }));
const searchParams = new URLSearchParams('code=example&state=state');
let container, root;
const props = () => ({ authMode: 'password', passwordAvailable: true, password: 'secret', setPassword: vi.fn(), newPassword: 'new-secret', setNewPassword: vi.fn(), mfaCode: '123456', setMfaCode: vi.fn(), handleLogin: vi.fn(e => e.preventDefault()), handleMfaSubmit: vi.fn(e => e.preventDefault()), handleSetNewPassword: vi.fn(e => e.preventDefault()), handleOidcLogin: vi.fn(), onBackToPassword: vi.fn() });
async function render(component, enabled) {
  if (enabled) document.documentElement.dataset.ui = 'v5'; else delete document.documentElement.dataset.ui;
  await act(async () => root.render(component));
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete document.documentElement.dataset.ui; vi.restoreAllMocks(); });

describe.each([false, true])('login with v5=%s', enabled => {
  it('keeps the password submit handler, labelled input, error and reset hint', async () => {
    const p = props(); await render(React.createElement(LoginView, { ...p, error: 'Rejected password', resetHint: true }), enabled);
    expect(container.querySelector('label[for="dashboard-password"]').textContent).toContain('Password');
    expect(container.textContent).toContain('Reset Password to Default');
    expect(container.querySelector('[role="alert"]').textContent).toBe('Rejected password');
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(p.handleLogin).toHaveBeenCalledOnce();
    if (enabled) { expect(container.querySelector('form').getAttribute('aria-label')).toBe('Sign in'); expect(container.querySelector('.v5-gate-scene').dataset.renderer).toBe('css'); expect(container.querySelector('canvas').getAttribute('aria-hidden')).toBe('true'); }
    else expect(container.querySelector('.v5-gate-scene')).toBeNull();
  });
  it('retains MFA, password-change and OIDC actions', async () => {
    const p = props(); await render(React.createElement(LoginView, { ...p, mfaRequired: true, error: 'Invalid code' }), enabled);
    expect(container.querySelector('[role="alert"]').textContent).toBe('Invalid code');
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(p.handleMfaSubmit).toHaveBeenCalledOnce();
    await render(React.createElement(LoginView, { ...p, mustChange: true, passwordChangeProof: 'proof' }), enabled);
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(p.handleSetNewPassword).toHaveBeenCalledOnce();
    await render(React.createElement(LoginView, { ...p, oidcAvailable: true, oidcLoginLabel: 'Sign in with OIDC', loading: true }), enabled);
    await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('Sign in with OIDC')).click());
    expect(p.handleOidcLogin).toHaveBeenCalledOnce();
  });
  it('shows callback processing, success, manual and error states', async () => {
    for (const [status, message] of [['processing', 'Please wait'], ['success', 'Authorization successful'], ['done', 'close this tab'], ['manual', 'Copy this URL'], ['error', 'Denied']]) {
      await render(React.createElement(CallbackStatusView, { status, failureMessage: 'Denied' }), enabled);
      expect(container.textContent).toContain(message);
      if (enabled) { expect(container.querySelector(status === 'error' ? '[role="alert"]' : '[role="status"]')).not.toBeNull(); if (status === 'error') expect(container.querySelector('a').getAttribute('href')).toBe('/login'); }
    }
  });
});

it('renders one WebGL frame and schedules no animation for reduced motion', () => {
  const gl = new Proxy({ COMPILE_STATUS: 1, LINK_STATUS: 2, createShader: () => ({}), getShaderParameter: () => true, createProgram: () => ({}), getProgramParameter: () => true, createBuffer: () => ({}), getAttribLocation: () => 0, getUniformLocation: () => ({}), drawArrays: vi.fn() }, { get: (target, key) => key in target ? target[key] : vi.fn() });
  HTMLCanvasElement.prototype.getContext.mockReturnValue(gl);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
  const scene = startGateScene(document.createElement('canvas'));
  expect(gl.drawArrays).toHaveBeenCalledTimes(1);
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  scene.destroy(); vi.unstubAllGlobals();
});

it('delivers the same callback parameters with the switch on and off', async () => {
  await render(React.createElement(CallbackPage), false);
  expect(deliverOAuthCallback).toHaveBeenCalledOnce();
  expect(deliverOAuthCallback.mock.calls[0][0]).toBe(searchParams);
  await act(async () => root.unmount());
  root = createRoot(container); deliverOAuthCallback.mockClear();
  await render(React.createElement(CallbackPage), true);
  expect(deliverOAuthCallback).toHaveBeenCalledOnce();
  expect(deliverOAuthCallback.mock.calls[0][0]).toBe(searchParams);
});

it('exposes the scene pause button as a keyboard-operable toggle', async () => {
  const gl = new Proxy({ createShader: () => ({}), getShaderParameter: () => true, createProgram: () => ({}), getProgramParameter: () => true, createBuffer: () => ({}), getAttribLocation: () => 0, getUniformLocation: () => ({}) }, { get: (target, key) => key in target ? target[key] : vi.fn() });
  HTMLCanvasElement.prototype.getContext.mockReturnValue(gl);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  await render(React.createElement(GateScene), true);
  const button = container.querySelector('button');
  expect(button.textContent).toBe('Pause animation');
  expect(button.getAttribute('aria-pressed')).toBe('false');
  button.focus(); expect(document.activeElement).toBe(button);
  await act(async () => button.click());
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.textContent).toBe('Resume animation');
  await act(async () => root.unmount()); root = createRoot(container); vi.unstubAllGlobals();
});
