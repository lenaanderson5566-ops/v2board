import { useEffect, useRef, useState } from "react";
import { boot } from "./api";
import { tx } from "./i18n";
import { loginPasskey, passkeyError, passkeySupported } from "./passkey-api";
import type { V10MfaChallenge } from "./v10-types";

export function PasskeyLogin({onMfa,onComplete,disabled=false}:{onMfa:(challenge:V10MfaChallenge)=>void;onComplete:()=>Promise<void>;disabled?:boolean}) {
    const [busy,setBusy]=useState(false),[error,setError]=useState("");
    const lock=useRef(false);
    const operation=useRef<AbortController|null>(null);
    useEffect(()=>()=>operation.current?.abort(),[]);
    if (!boot.passkeyEnabled) return null;
    const supported=passkeySupported();
    return <div className="passkey-login"><button type="button" disabled={disabled || busy || !supported} onClick={async()=>{
        if(lock.current)return;lock.current=true;setBusy(true);setError("");
        const controller=new AbortController();operation.current=controller;
        try {const result=await loginPasskey(controller.signal);if(!controller.signal.aborted){if(result.mfaRequired)onMfa(result);else await onComplete();}}
        catch(error){if(!controller.signal.aborted)setError(passkeyError(error));}finally{lock.current=false;if(!controller.signal.aborted)setBusy(false);}
    }}>{tx(busy ? "正在验证 Passkey…" : "使用 Passkey 登录")}</button>
    {!supported && <p className="muted">{tx("当前浏览器不支持 Passkey，请使用密码登录。")}</p>}
    {error && <p role="alert" className="alert">{error}</p>}</div>;
}
