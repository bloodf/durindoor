import { WebSessionExecutor } from "./webSessionBase.js";
import { cancelDiscardedResponse } from "./sendRequest.js";
import { errorResponse } from "../utils/error.js";
import { readBodyWithTimeout, BodyReadTimeoutError } from "../utils/bodyTimeout.js";
import { MAX_PROVIDER_BODY_BYTES, PROVIDER_BODY_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const API = "https://app.blackbox.ai/api/chat";
const SESSION = "https://app.blackbox.ai/api/auth/session";
const SUBSCRIPTION = "https://app.blackbox.ai/api/check-subscription";
const SETUP_BODY_BYTES = 64 * 1024;
const EXPIRED = "Blackbox session expired; sign in again";
// Same code other executors author for a send the provider may have accepted.
const OUTCOME_UNKNOWN = "upstream_outcome_unknown";

function completion(content, model) { return new Response(JSON.stringify({ id: `chatcmpl-${crypto.randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } }); }
function chunks(content, model) { const id = `chatcmpl-${crypto.randomUUID()}`; return [[{role:"assistant"},null],[{content},null],[{},"stop"]].map(([delta,finish_reason]) => ({ id, object:"chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices:[{index:0,delta,finish_reason}] })); }
const isHtml = (response, text = "") => /text\/html|application\/xhtml/i.test(response.headers.get("content-type") || "") || /^<(?:!doctype|html|head|body)\b/i.test(text);
const isRecord = (value) => value !== null && isObject(value) && !Array.isArray(value);
const read = (response, signal, maxBytes) => readBodyWithTimeout(response, { signal, maxBytes, timeoutMs: PROVIDER_BODY_TIMEOUT_MS });
/** An abort after the chat send keeps the request-scoped marker, so no layer replays it. */
const scopedAbort = () => Object.assign(new DOMException("Provider request aborted", "AbortError"), { claudeRequestScoped: true });

export class BlackboxWebExecutor extends WebSessionExecutor {
 constructor() { super("blackbox-web", { id:"blackbox-web", baseUrl:API }); }
 async runSession(input, { send, sendBillable }) {
  // Session and subscription checks are setup; only the chat request is quota-bearing.
  const model=input.model, body=input.body||{}, c=this.sessionCookie(input.credentials,"next-auth.session-token");
  const error=(status,message)=>({response:this.errorReply(status,message),url:API,headers:{},transformedBody:body});
  // A setup failure that is neither an account refusal nor a quota answer: nothing was
  // billed, but the provider did not explain it, so no layer replays the session probe.
  const setupFailure=(status,message)=>({...error(status,message),claudeRequestScoped:true});
  if (!Array.isArray(body.messages)||!body.messages.length) return error(400,"Missing or empty messages array");
  if (!c) return error(401,"Missing Blackbox session cookie");
  const headers={Cookie:c,Origin:"https://app.blackbox.ai",Referer:"https://app.blackbox.ai/",Accept:"text/plain, */*","Content-Type":"application/json","User-Agent":"Mozilla/5.0"};
  const sessionRes=await send(SESSION,{headers:{...headers,Accept:"application/json"}});
  if (!sessionRes.ok) {
   cancelDiscardedResponse(sessionRes);
   if (sessionRes.status >= 300 && sessionRes.status < 400) return error(401,EXPIRED);
   if (sessionRes.status===401||sessionRes.status===403) return error(sessionRes.status,EXPIRED);
   if (sessionRes.status===429) return error(429,"Blackbox rate limit exceeded");
   return setupFailure(502,`Blackbox session check returned HTTP ${sessionRes.status}`);
  }
  let session;
  try {
   const text=await read(sessionRes,input.signal,SETUP_BODY_BYTES);
   if (isHtml(sessionRes,text.trim())) return setupFailure(502,"Blackbox session check returned an unusable response");
   session=JSON.parse(text);
  } catch (cause) {
   if (input.signal?.aborted) throw cause;
   return setupFailure(cause instanceof BodyReadTimeoutError?504:502,"Blackbox session check returned an unusable response");
  }
  // The legitimate session document is an object (or null when signed out); pass it on unchanged.
  if (session!==null&&!isRecord(session)) return setupFailure(502,"Blackbox session check returned an unusable response");
  const email=isString(session?.user?.email)?session.user.email:"";
  let subscriptionCache=null;
  if(email){
   const sub=await send(SUBSCRIPTION,{method:"POST",headers,body:JSON.stringify({email})});
   if (sub.status >= 300 && sub.status < 400) { cancelDiscardedResponse(sub); return error(401,EXPIRED); }
   if (sub.ok) {
    // The subscription answer is optional: an unreadable one leaves the cache unset, as a non-ok one does.
    try { const x=JSON.parse(await read(sub,input.signal,SETUP_BODY_BYTES)); if (isRecord(x)) subscriptionCache={status:x.hasActiveSubscription?"PREMIUM":"FREE",...x}; }
    catch (cause) { if (input.signal?.aborted) throw cause; }
   } else cancelDiscardedResponse(sub);
  }
  const id=crypto.randomUUID().slice(0,7); const messages=body.messages.filter(m=>["user","assistant","system","developer"].includes(m.role)).map(m=>({id:m.role==="user"?id:crypto.randomUUID(),role:m.role==="developer"?"system":m.role,content:Array.isArray(m.content)?m.content.map(p=>p?.text||"").join("\n"):String(m.content??"")}));
  const payload={messages,id,previewToken:null,userId:input.credentials?.providerSpecificData?.userId??null,codeModelMode:true,trendingAgentMode:{},isMicMode:false,userSystemPrompt:null,maxTokens:Number(body.max_tokens)||1024,playgroundTopP:null,playgroundTemperature:null,isChromeExt:false,githubToken:"",clickedAnswer2:false,clickedAnswer3:false,clickedForceWebSearch:false,visitFromDelta:false,isMemoryEnabled:false,mobileClient:false,userSelectedModel:model||null,userSelectedAgent:"VscodeAgent",validated:crypto.randomUUID(),imageGenerationMode:false,imageGenMode:"autoMode",webSearchModePrompt:false,deepSearchMode:false,promptSelection:"",domains:null,vscodeClient:false,codeInterpreterMode:false,customProfile:{name:"",occupation:"",traits:[],additionalInfo:"",enableNewChats:false},webSearchModeOption:{autoMode:true,webMode:false,offlineMode:false},session, isPremium:subscriptionCache?subscriptionCache.status==="PREMIUM":true,teamAccount:email,subscriptionCache,beastMode:false,reasoningMode:false,designerMode:false,workspaceId:"",asyncMode:false,integrations:{},isTaskPersistent:false,selectedElement:null};
  // From here the chat may have been accepted and billed. An answer that does not prove
  // a refusal or a completion is terminal: the existing request-scoped marker stops the
  // account fallback and the outer transient retry, and the response is never a success.
  const uncertain=(status=502)=>{
   const response=errorResponse(status,"Blackbox Web chat outcome is unknown; the request was not replayed",{type:"upstream_error",code:OUTCOME_UNKNOWN});
   response.upstreamPartialOutput=true;
   return {response,url:API,headers:{},transformedBody:payload,claudeRequestScoped:true};
  };
  let res;
  try { res=await sendBillable(API,{method:"POST",headers,body:JSON.stringify(payload)}); }
  catch (cause) { if (isQuotaDispatchUnavailable(cause)) throw cause; if (input.signal?.aborted) throw scopedAbort(); return uncertain(); }
  if (!res.ok) {
   cancelDiscardedResponse(res);
   if (res.status >= 300 && res.status < 400) return error(401,EXPIRED);
   if (res.status===401||res.status===403) return error(res.status,EXPIRED);
   if (res.status===429) return error(429,"Blackbox rate limit exceeded");
   return uncertain();
  }
  if (isHtml(res)) { cancelDiscardedResponse(res); return uncertain(); }
  let text;
  try { text=(await read(res,input.signal,MAX_PROVIDER_BODY_BYTES)).trim(); }
  catch (cause) {
   if (input.signal?.aborted) throw scopedAbort();
   if (cause instanceof BodyReadTimeoutError) return uncertain(504);
   // The shared transport contract settles an unreadable billable body as a transport error,
   // which needs the throw; the marker keeps every layer from replaying it.
   throw Object.assign(cause, { claudeRequestScoped: true });
  }
  if (!text||isHtml(res,text)) return uncertain();
  if(/please login|login required|authentication required/i.test(text)) return error(401,EXPIRED); if(/rate limit|too many requests/i.test(text)) return error(429,"Blackbox rate limit exceeded"); if(/not upgraded|upgrade to a premium plan|please upgrade/i.test(text)) return error(402,"Blackbox subscription required");
  return {response:input.stream?this.sseReply(chunks(text,model)):completion(text,model),url:API,headers:{cookie:"***"},transformedBody:payload};
 }
}
