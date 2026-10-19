import { browserFetch, markBrowserAuthenticated, forgetBrowserSession } from "./browser-session";
import { apiUrl } from "./runtime-config";
import { locale, tx } from "./i18n";

export type PasskeyState = { enabled: boolean; credentials: {id:number;name:string;rpId:string;createdAt:string;lastUsedAt:string|null}[] };
export function passkeySupported() { return window.isSecureContext && typeof PublicKeyCredential !== "undefined" && !!navigator.credentials?.create && !!navigator.credentials?.get; }
function active(signal?:AbortSignal) { if(signal?.aborted) throw new DOMException("Aborted","AbortError"); }
export async function passkeyRequest<T=any>(path:string,body?:Record<string,unknown>,method=body ? "POST" : "GET",signal?:AbortSignal):Promise<T> {
    active(signal);
    const controller=new AbortController();
    const abort=()=>controller.abort();signal?.addEventListener("abort",abort,{once:true});
    const timer=setTimeout(abort,15000);
    try {
    const response=await browserFetch(apiUrl(`/api/v10/${path}`),{method,signal:controller.signal,headers:{Accept:"application/json","Accept-Language":locale(),...(body ? {"Content-Type":"application/json"} : {})},...(body ? {body:JSON.stringify(body)} : {})});
    active(signal);
    if(response.status===401 && path.startsWith("me/")) {forgetBrowserSession();window.dispatchEvent(new Event("auth-expired"));}
    const payload=response.status===204 ? {} : await response.json().catch(()=>{throw new Error(tx("Passkey 操作失败，请重试。"));});
    active(signal);
    if (!response.ok) throw new Error(payload.detail || payload.message || tx("Passkey 操作失败，请重试。"));
    if (payload.data?.authenticated===true && typeof payload.data.accountId==="number") markBrowserAuthenticated(payload.data.accountId);
    return payload.data;
    } catch(error) {
        if(controller.signal.aborted && !signal?.aborted) throw new Error(tx("请求超时，请刷新确认结果后再试"));
        throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
function decode(value:string):ArrayBuffer { return Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0)).buffer; }
function encode(value:ArrayBuffer):string { return btoa(Array.from(new Uint8Array(value),v=>String.fromCharCode(v)).join("")).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function credential(value:Credential|null):PublicKeyCredential {
    if (!value || value.type!=="public-key") throw new Error(tx("Passkey 验证已取消，请重试或使用密码登录。"));
    return value as PublicKeyCredential;
}
export async function registerPasskey(password:string,name:string,signal?:AbortSignal) {
    const setup=await passkeyRequest("me/security/passkeys/registration-options",{password,name},"POST",signal);
    active(signal);
    const key=setup.publicKey;
    const result=credential(await navigator.credentials.create({signal,publicKey:{...key,challenge:decode(key.challenge),user:{...key.user,id:decode(key.user.id)},excludeCredentials:(key.excludeCredentials || []).map((item:any)=>({...item,id:decode(item.id)}))}}));
    active(signal);
    const response=result.response as AuthenticatorAttestationResponse;
    return passkeyRequest("me/security/passkeys",{challengeId:setup.challengeId,credentialId:encode(result.rawId),clientDataJSON:encode(response.clientDataJSON),attestationObject:encode(response.attestationObject)},"POST",signal);
}
export async function loginPasskey(signal?:AbortSignal) {
    const setup=await passkeyRequest("auth/passkeys/options",{},"POST",signal);
    active(signal);
    const result=credential(await navigator.credentials.get({signal,publicKey:{...setup.publicKey,challenge:decode(setup.publicKey.challenge)}}));
    active(signal);
    const response=result.response as AuthenticatorAssertionResponse;
    if (!response.userHandle) throw new Error(tx("请选择本站已绑定的 Passkey。"));
    const resultData=await passkeyRequest("auth/passkeys/sessions",{challengeId:setup.challengeId,credentialId:encode(result.rawId),clientDataJSON:encode(response.clientDataJSON),authenticatorData:encode(response.authenticatorData),signature:encode(response.signature),userHandle:encode(response.userHandle)},"POST",signal);
    if(resultData?.authenticated!==true && !(resultData?.mfaRequired===true && typeof resultData.challengeId==="string")) throw new Error(tx("Passkey 操作失败，请重试。"));
    return resultData;
}
export function passkeyError(error:unknown) {
    return error instanceof DOMException && error.name==="NotAllowedError" ? tx("Passkey 验证已取消，请重试或使用密码登录。") : error instanceof Error ? error.message : tx("Passkey 操作失败，请重试。");
}
