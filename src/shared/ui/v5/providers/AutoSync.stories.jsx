import React from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import ReviewAutoSyncCard from './ReviewAutoSyncCard.jsx';

function fixture({ enabled=true, eligible=true, pending=false, failStatus=false, syncError=false, noConnection=false, pendingSync=false, saveError=false }={}) {
  let settings, status, fail, syncFails, writes;
  const reset=()=>{settings={modelAutoSyncProviders:{openai:enabled,google:false},requireApiKey:true};status={eligible,enabled,syncedAt:'2026-10-08T12:00:00Z',models:[{id:'gpt-4o',name:'GPT-4o'}],newModelIds:['gpt-4o'],removedModelIds:['retired-model'],error:null};fail=failStatus;syncFails=syncError;writes=[];}; reset();
  return { reset, snapshot:()=>({settings,writes}), routes:{
    'GET /api/models/auto-sync':()=>pending?new Promise(()=>{}):fail?(fail=false,{status:503,body:{error:'Status unavailable'}}):{body:{intervalHours:24,providers:{openai:{...status,enabled:settings.modelAutoSyncProviders.openai}}}},
    'GET /api/settings':()=>({body:settings}),
    'PATCH /api/settings':async(request)=>{if(saveError)return{status:503,body:{error:'Save failed'}};const patch=await request.json();writes.push(patch);settings={...settings,...patch};return{body:settings};},
    'POST /api/models/auto-sync':async(request)=>{if(pendingSync)return new Promise(()=>{});writes.push(await request.json());if(syncFails){syncFails=false;return{status:503,body:{error:'Provider unavailable'}};}return{body:{results:[{status:'synced',modelCount:1}]}};},
  }, noConnection };
}
function scenario(options={},play) {
  const data=fixture(options);
  return {beforeEach:()=>data.reset(),parameters:{storyFixture:{pathname:'/dashboard/providers/openai',params:{id:'openai'},routes:data.routes}},render:()=> <ReviewAutoSyncCard providerId="openai" hasConnection={!data.noConnection} onModelsChange={()=>{}} />,play:play?async(context)=>play(context,data):undefined};
}
const meta = {title:'Redesign/Providers/Model auto-sync',component:ReviewAutoSyncCard,parameters:{layout:'padded',v5Review:{componentOnly:true}}};
export default meta;
export const Enabled = scenario();
export const Paused = scenario({enabled:false},async({canvasElement})=>{const canvas=within(canvasElement);await expect(await canvas.findByRole('switch')).toHaveAttribute('aria-checked','false');await expect(canvas.getByRole('button',{name:'Sync now'})).toBeDisabled();});
export const LoadingStatus = scenario({pending:true});
export const UnsupportedProvider = scenario({eligible:false});
export const NoActiveConnection = scenario({noConnection:true});
export const SyncAndReadback = scenario({},async({canvasElement},data)=>{const canvas=within(canvasElement);await userEvent.click(await canvas.findByRole('button',{name:'Sync now'}));await expect(await canvas.findByText('Synced 1 models.')).toBeVisible();await expect(data.snapshot().writes).toContainEqual({provider:'openai'});});
export const ToggleAndReadback = scenario({},async({canvasElement},data)=>{const canvas=within(canvasElement);await userEvent.click(await canvas.findByRole('switch'));await waitFor(()=>expect(canvas.getByRole('switch')).toHaveAttribute('aria-checked','false'));await expect(data.snapshot().settings.modelAutoSyncProviders).toEqual({openai:false,google:false});});
export const StatusFailureAndRetry = scenario({failStatus:true},async({canvasElement})=>{const canvas=within(canvasElement);await expect(await canvas.findByRole('alert')).toHaveTextContent('Model sync status is unavailable.');await userEvent.click(canvas.getByRole('button',{name:'Retry status'}));await expect(await canvas.findByRole('switch')).toHaveAttribute('aria-checked','true');});
export const SyncFailureAndRetry = scenario({syncError:true},async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(await canvas.findByRole('button',{name:'Sync now'}));await expect(await canvas.findByRole('alert')).toHaveTextContent('The previous model list is kept.');await userEvent.click(canvas.getByRole('button',{name:'Sync now'}));await expect(await canvas.findByText('Synced 1 models.')).toBeVisible();});

export const SyncPending = scenario({pendingSync:true},async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(await canvas.findByRole('button',{name:'Sync now'}));await expect(await canvas.findByRole('button',{name:'Syncing…'})).toBeDisabled();await expect(canvas.getByRole('switch')).toBeDisabled();});
export const SettingSaveFailure = scenario({saveError:true},async({canvasElement},data)=>{const canvas=within(canvasElement);await userEvent.click(await canvas.findByRole('switch'));await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not save the auto-update setting.');await expect(canvas.getByRole('switch')).toHaveAttribute('aria-checked','true');await expect(data.snapshot().settings.modelAutoSyncProviders).toEqual({openai:true,google:false});});
