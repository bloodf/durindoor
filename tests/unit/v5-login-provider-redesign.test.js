// @vitest-environment happy-dom
import {afterEach,describe,expect,it,vi} from 'vitest';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {readFileSync} from 'node:fs';
import {parse} from '@babel/parser';
import {getStoryFixtureOptions} from '../../.storybook/decorators.jsx';
import {ReviewLoginView} from '../../src/shared/ui/v5/login/ReviewLoginView.jsx';
import ReviewAutoSyncCard from '../../src/shared/ui/v5/providers/ReviewAutoSyncCard.jsx';
import {gateMotionMode,startGateScene} from '../../src/shared/ui/v5/login/gate-scene.js';

vi.mock('../../src/app/(dashboard)/dashboard/providers/[id]/page.js',()=>({default:()=>null}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container;
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;container?.remove();vi.unstubAllGlobals();});
async function mount(node){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(node));}
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
const ready={eligible:true,enabled:true,syncedAt:null,newModelIds:[],removedModelIds:[],models:[{id:'gpt-4o'}],error:null};
const viewProps={authMode:'password',passwordAvailable:true,hasPassword:true,password:'sample',setPassword:()=>{},sceneFallback:true};

describe('Storybook login and provider redesign',()=>{
 it('binds fresh provider data for a cross-provider review route and keeps ordinary fixtures intact',async()=>{
   const {default:meta}=await import('../../src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx');
   const original=meta.parameters.storyFixture;
   const make=(review)=>({parameters:{v5Review:review,storyFixture:original},globals:{}});
   window.location.href='http://storybook.local/iframe.html?id=review&v5Route=%2Fdashboard%2Fproviders%2Fclaude';
   const next=getStoryFixtureOptions(make({}));
   expect(next.params).toEqual({id:'claude'});
   const providerResponse=await next.routes['GET /api/providers'](new Request('http://storybook.local/api/providers'));
   expect(providerResponse.body.connections[0]).toMatchObject({provider:'claude',authType:'oauth'});
   const syncResponse=await next.routes['GET /api/models/auto-sync']();
   const sync=syncResponse.body.providers.claude;
   expect(sync.eligible).toBe(true);expect(sync.models.length).toBeGreaterThan(0);
   expect(sync.models.every(model=>model.id.startsWith('claude'))).toBe(true);
   expect(syncResponse.body.providers.openai).toBeUndefined();
   const fetched=next.routes['GET /api/providers/review-claude/models'].body.models;expect(fetched).toEqual(sync.models);
   await next.routes['POST /api/models/custom'](new Request('http://storybook.local/api/models/custom',{method:'POST',body:JSON.stringify({id:'claude-private',providerAlias:'cc',capabilities:{tools:true}})}));
   expect((await next.routes['GET /api/models/custom']()).body.models).toContainEqual({id:'claude-private',providerAlias:'cc',capabilities:{tools:true}});
   await next.routes['PUT /api/models/alias'](new Request('http://storybook.local/api/models/alias',{method:'PUT',body:JSON.stringify({model:'cc/claude-private',alias:'private-route'})}));
   expect((await next.routes['GET /api/models/alias']()).body.aliases).toEqual({'private-route':'cc/claude-private'});
   expect(getStoryFixtureOptions(make(undefined)).routes).toBe(original.routes);
   window.location.href='http://storybook.local/iframe.html?id=review&v5Route=%2Fdashboard%2Fproviders%2Fopenai';
   expect(getStoryFixtureOptions(make({})).routes).toBe(original.routes);
   const unsupported=original.providerFixture('openrouter');
   expect((await unsupported.routes['GET /api/models/auto-sync']()).body.providers.openrouter.eligible).toBe(false);
   window.location.href='http://storybook.local/iframe.html';
 });
 it('keeps the browser eligibility IDs aligned with the actual server model-list configuration',()=>{
   const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
   const source=parse(read('../../src/app/api/providers/[id]/models/modelsConfig.js'),{sourceType:'module'});
   const declaration=source.program.body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.declarations?.some(item=>item.id.name==='PROVIDER_MODELS_CONFIG')).declaration.declarations.find(item=>item.id.name==='PROVIDER_MODELS_CONFIG');
   const orca=parse(read('../../open-sse/providers/orcarouterCatalog.js'),{sourceType:'module'}).program.body.find(node=>node.type==='ExportNamedDeclaration'&&node.declaration?.declarations?.some(item=>item.id.name==='ORCAROUTER_ID')).declaration.declarations.find(item=>item.id.name==='ORCAROUTER_ID').init.value;
   const expected=declaration.init.properties.map(item=>item.computed&&item.key.name==='ORCAROUTER_ID'?orca:item.key.name||item.key.value).sort();
   const story=parse(read('../../src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx'),{sourceType:'module',plugins:['jsx']});
   const ids=story.program.body.find(node=>node.type==='VariableDeclaration'&&node.declarations[0].id.name==='REVIEW_MODEL_LIST_PROVIDERS').declarations[0].init.arguments[0].elements.map(item=>item.value).sort();
   expect(ids).toEqual(expected);
 });

 it('renders the actual website mark and preserves password form submission',async()=>{const login=vi.fn(event=>event.preventDefault());await mount(React.createElement(ReviewLoginView,{...viewProps,handleLogin:login}));expect(container.querySelector('.v5-login-brand svg').getAttribute('viewBox')).toBe('0 0 48 56');expect(container.querySelector('h1').textContent).toBe('Welcome back');await act(async()=>container.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(login).toHaveBeenCalledOnce();expect(container.querySelector('#dashboard-password').required).toBe(true);});
 it('retains MFA, backup-code copy, lockout and return handler',async()=>{const back=vi.fn();await mount(React.createElement(ReviewLoginView,{...viewProps,mfaRequired:true,mfaCode:'',setMfaCode:()=>{},retryAfter:17,onBackToPassword:back}));expect(container.querySelector('#mfa-code').getAttribute('autocomplete')).toBe('one-time-code');expect(container.textContent).toContain('backup codes');const button=[...container.querySelectorAll('button')].find(node=>node.textContent==='Back to sign in');await act(async()=>button.click());expect(back).toHaveBeenCalledOnce();expect(container.querySelector('button[type="submit"]').disabled).toBe(true);});
 it('preserves OIDC-only and password-change branches',async()=>{const oidc=vi.fn();await mount(React.createElement(ReviewLoginView,{...viewProps,passwordAvailable:false,oidcAvailable:true,authMode:'oidc',oidcConfigured:true,oidcLoginLabel:'Sign in with SSO',handleOidcLogin:oidc}));expect(container.querySelector('#dashboard-password')).toBeNull();await act(async()=>[...container.querySelectorAll('button')].find(node=>node.textContent==='Sign in with SSO').click());expect(oidc).toHaveBeenCalledOnce();await act(async()=>root.render(React.createElement(ReviewLoginView,{...viewProps,mustChange:true,passwordChangeProof:'proof',newPassword:'new',setNewPassword:()=>{}})));expect(container.querySelector('#new-password')).not.toBeNull();});
 it('halts motion for reduced motion, hidden pages and pause, and exposes the static fallback',()=>{expect(gateMotionMode()).toEqual({renderer:'webgl',animated:true});for(const state of[{reducedMotion:true},{hidden:true},{paused:true}])expect(gateMotionMode(state).animated).toBe(false);expect(gateMotionMode({webgl:false})).toEqual({renderer:'css',animated:false});const onMode=vi.fn(),canvas={getContext:vi.fn(()=>null)};const scene=startGateScene(canvas,{onMode});expect(onMode).toHaveBeenCalledWith('css');scene.destroy();expect(()=>scene.setPaused(true)).not.toThrow();});
 it('merges provider toggle settings and reads server status back',async()=>{let enabled=true;const writes=[];vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{if(url.startsWith('/api/models/auto-sync'))return response({providers:{openai:{...ready,enabled}}});if(options.method==='PATCH'){const payload=JSON.parse(options.body);writes.push(payload);enabled=payload.modelAutoSyncProviders.openai;return response({});}return response({modelAutoSyncProviders:{google:false,openai:true}});}));const models=vi.fn();await mount(React.createElement(ReviewAutoSyncCard,{providerId:'openai',hasConnection:true,onModelsChange:models}));await act(async()=>container.querySelector('[role="switch"]').click());expect(writes).toEqual([{modelAutoSyncProviders:{google:false,openai:false}}]);expect(container.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false');expect(models).toHaveBeenLastCalledWith(null);});
 it('keeps previous models on sync failure and allows another sync',async()=>{let fail=true;const models=vi.fn();vi.stubGlobal('fetch',vi.fn(async(url,options={})=>{if(options.method==='POST'){if(fail){fail=false;return response({error:'Provider offline'},503);}return response({results:[{status:'synced',modelCount:1}]});}return response({providers:{openai:ready}});}));await mount(React.createElement(ReviewAutoSyncCard,{providerId:'openai',hasConnection:true,onModelsChange:models}));const sync=()=>[...container.querySelectorAll('button')].find(node=>node.textContent.endsWith('Sync now'));await act(async()=>sync().click());expect(container.querySelector('[role="alert"]').textContent).toContain('The previous model list is kept.');expect(models).toHaveBeenCalledTimes(1);await act(async()=>sync().click());expect(container.textContent).toContain('Synced 1 models.');expect(models).toHaveBeenCalledTimes(2);});
 it('exposes failed status rather than silently removing the card and retries',async()=>{let fail=true;vi.stubGlobal('fetch',vi.fn(async()=>{if(fail){fail=false;return response({},503);}return response({providers:{openai:ready}});}));await mount(React.createElement(ReviewAutoSyncCard,{providerId:'openai',hasConnection:true,onModelsChange:()=>{}}));expect(container.querySelector('h2').textContent).toBe('Model auto-sync');expect(container.querySelector('[role="alert"]')).not.toBeNull();await act(async()=>[...container.querySelectorAll('button')].find(node=>node.textContent==='Retry status').click());expect(container.querySelector('[role="switch"]')).not.toBeNull();});
 it('shows unsupported providers and blocks syncing without an active connection',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>response({providers:{openai:{...ready,eligible:false}}})));await mount(React.createElement(ReviewAutoSyncCard,{providerId:'openai',hasConnection:true,onModelsChange:()=>{}}));expect(container.textContent).toContain('no model-list API');fetch.mockImplementation(async()=>response({providers:{openai:ready}}));await act(async()=>root.render(React.createElement(ReviewAutoSyncCard,{key:'no-connection',providerId:'openai',hasConnection:false,onModelsChange:()=>{}})));expect(container.textContent).toContain('Add an active connection');expect([...container.querySelectorAll('button')].find(node=>node.textContent.endsWith('Sync now')).disabled).toBe(true);});
 it('ignores stale provider status and aborts it when navigating to another provider',async()=>{let resolveOld;const old=new Promise(resolve=>{resolveOld=resolve;});const calls=[];vi.stubGlobal('fetch',vi.fn((url,options)=>{calls.push(options);return url.includes('openai')?old:Promise.resolve(response({providers:{google:{...ready,models:[{id:'gemini'}]}}}));}));const models=vi.fn();await mount(React.createElement(ReviewAutoSyncCard,{providerId:'openai',hasConnection:true,onModelsChange:models}));await act(async()=>root.render(React.createElement(ReviewAutoSyncCard,{providerId:'google',hasConnection:true,onModelsChange:models})));expect(calls[0].signal.aborted).toBe(true);await act(async()=>resolveOld(response({providers:{openai:ready}})));expect(models).toHaveBeenCalledTimes(1);expect(models).toHaveBeenLastCalledWith([{id:'gemini'}]);});
});
