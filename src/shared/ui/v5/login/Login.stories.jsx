import React,{useState} from 'react';
import {expect,userEvent,within} from 'storybook/test';
import {ReviewLoginView} from './ReviewLoginView.jsx';

const base={authMode:'password',oidcConfigured:false,oidcLoginLabel:'Sign in with OIDC',oidcAvailable:false,passwordAvailable:true,usingDefaultPassword:false,hasPassword:true,mustChange:false,passwordChangeProof:'',error:'',password:'',newPassword:'',loading:false,retryAfter:0,resetHint:'',handleLogin:(event)=>event.preventDefault(),handleSetNewPassword:(event)=>event.preventDefault(),handleOidcLogin:()=>{},mfaRequired:false,mfaCode:'',handleMfaSubmit:(event)=>event.preventDefault(),onBackToPassword:()=>{}};
function View(props) {const[password,setPassword]=useState(''),[newPassword,setNewPassword]=useState(''),[mfaCode,setMfaCode]=useState('');return <ReviewLoginView {...base} {...props} password={password} setPassword={setPassword} newPassword={newPassword} setNewPassword={setNewPassword} mfaCode={mfaCode} setMfaCode={setMfaCode} />;}
const meta = {title:'Redesign/Login',component:ReviewLoginView,parameters:{layout:'fullscreen',v5Review:{standalone:true},storyFixture:{pathname:'/login',routes:{}}},render:(args)=><View {...args}/>};
export default meta;
export const AnimatedGate = {};
export const StaticFallback = {args:{sceneFallback:true},play:async({canvasElement})=>{const canvas=within(canvasElement);await expect(canvas.getByRole('heading',{name:'Welcome back'})).toBeVisible();await expect(canvas.getByRole('img',{name:'DurinDoor logo'})).toBeVisible();await userEvent.type(canvas.getByLabelText(/^Password/),'review-password');await expect(canvas.getByLabelText(/^Password/)).toHaveValue('review-password');}};
export const AnimationPaused = {args:{scenePaused:true}};
export const SigningIn = {args:{loading:true,password:'storybook-password'}};
export const InvalidPassword = {args:{error:'Invalid password',resetHint:'Reset password from the host CLI.'}};
export const AuthenticationCode = {args:{mfaRequired:true},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.type(canvas.getByLabelText(/^Authentication code/),'123456');await expect(canvas.getByLabelText(/^Authentication code/)).toHaveValue('123456');await expect(canvas.getByText(/backup codes/i)).toBeVisible();}};
export const OIDCAndPassword = {args:{authMode:'both',oidcConfigured:true,oidcAvailable:true}};
