import { BaseExecutor } from "./base.js";
const API = "https://app.blackbox.ai/api/chat";
function cookie(value) { const s = String(value || "").trim(); return s.includes("=") ? s : s ? `next-auth.session-token=${s}` : ""; }
function completion(content, model) { return new Response(JSON.stringify({ id: `chatcmpl-${crypto.randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } }); }
function stream(content, model) { const id = `chatcmpl-${crypto.randomUUID()}`, enc = new TextEncoder(); return new Response(new ReadableStream({ start(c) { for (const chunk of [{ id, object:"chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices:[{index:0,delta:{role:"assistant"},finish_reason:null}] }, {id,object:"chat.completion.chunk",created:Math.floor(Date.now()/1000),model,choices:[{index:0,delta:{content},finish_reason:null}]}, {id,object:"chat.completion.chunk",created:Math.floor(Date.now()/1000),model,choices:[{index:0,delta:{},finish_reason:"stop"}] }]) c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`)); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } }), { headers: { "content-type":"text/event-stream" } }); }
export class BlackboxWebExecutor extends BaseExecutor {
 constructor() { super("blackbox-web", { id:"blackbox-web", baseUrl:API }); }
 async execute(input) {
  const model=input.model, body=input.body||{}, c=cookie(input.credentials?.apiKey||input.credentials?.providerSpecificData?.cookie);
  const error=(status,message)=>({response:new Response(JSON.stringify({error:{message,type:"upstream_error",code:`HTTP_${status}`}}),{status,headers:{"content-type":"application/json"}}),url:API,headers:{},transformedBody:body});
  if (!Array.isArray(body.messages)||!body.messages.length) return error(400,"Missing or empty messages array");
  if (!c) return error(401,"Missing Blackbox session cookie");
  const headers={Cookie:c,Origin:"https://app.blackbox.ai",Referer:"https://app.blackbox.ai/",Accept:"text/plain, */*","Content-Type":"application/json","User-Agent":"Mozilla/5.0"};
  const sessionRes=await fetch("https://app.blackbox.ai/api/auth/session",{headers:{...headers,Accept:"application/json"},signal:input.signal});
  if (sessionRes.status===401||sessionRes.status===403) return error(sessionRes.status,"Blackbox session expired; sign in again");
  if (sessionRes.status===401||sessionRes.status===403) return error(sessionRes.status,"Blackbox session expired; sign in again");
  const session=sessionRes.ok?await sessionRes.json():null; const email=session?.user?.email||"";
  let subscriptionCache=null;
  if(email){const sub=await fetch("https://app.blackbox.ai/api/check-subscription",{method:"POST",headers,body:JSON.stringify({email}),signal:input.signal}); if(sub.ok){const x=await sub.json(); subscriptionCache={status:x.hasActiveSubscription?"PREMIUM":"FREE",...x};}}
  const id=crypto.randomUUID().slice(0,7); const messages=body.messages.filter(m=>["user","assistant","system","developer"].includes(m.role)).map(m=>({id:m.role==="user"?id:crypto.randomUUID(),role:m.role==="developer"?"system":m.role,content:Array.isArray(m.content)?m.content.map(p=>p?.text||"").join("\n"):String(m.content??"")}));
  const payload={messages,id,previewToken:null,userId:input.credentials?.providerSpecificData?.userId??null,codeModelMode:true,trendingAgentMode:{},isMicMode:false,userSystemPrompt:null,maxTokens:Number(body.max_tokens)||1024,playgroundTopP:null,playgroundTemperature:null,isChromeExt:false,githubToken:"",clickedAnswer2:false,clickedAnswer3:false,clickedForceWebSearch:false,visitFromDelta:false,isMemoryEnabled:false,mobileClient:false,userSelectedModel:model||null,userSelectedAgent:"VscodeAgent",validated:crypto.randomUUID(),imageGenerationMode:false,imageGenMode:"autoMode",webSearchModePrompt:false,deepSearchMode:false,promptSelection:"",domains:null,vscodeClient:false,codeInterpreterMode:false,customProfile:{name:"",occupation:"",traits:[],additionalInfo:"",enableNewChats:false},webSearchModeOption:{autoMode:true,webMode:false,offlineMode:false},session, isPremium:subscriptionCache?subscriptionCache.status==="PREMIUM":true,teamAccount:email,subscriptionCache,beastMode:false,reasoningMode:false,designerMode:false,workspaceId:"",asyncMode:false,integrations:{},isTaskPersistent:false,selectedElement:null};
  const res=await fetch(API,{method:"POST",headers,body:JSON.stringify(payload),signal:input.signal});
  if(!res.ok) return error(res.status,res.status===401||res.status===403?"Blackbox session expired; sign in again":res.status===429?"Blackbox rate limit exceeded":`Blackbox Web returned HTTP ${res.status}`);
  const text=(await res.text()).trim(); if(/please login|login required|authentication required/i.test(text)) return error(401,"Blackbox session expired; sign in again"); if(/rate limit|too many requests/i.test(text)) return error(429,"Blackbox rate limit exceeded"); if(/not upgraded|upgrade to a premium plan|please upgrade/i.test(text)) return error(402,"Blackbox subscription required");
  return {response:input.stream?stream(text,model):completion(text,model),url:API,headers:{cookie:"***"},transformedBody:payload};
 }
}
