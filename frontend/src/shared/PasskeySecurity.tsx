import { useEffect, useRef, useState } from "react";
import { logoutSession } from "./api";
import { tx } from "./i18n";
import { formatInstant } from "./timezone";
import { passkeyRequest, passkeySupported, registerPasskey, passkeyError, type PasskeyState } from "./passkey-api";
import { Modal } from "./ui";

export function PasskeySecurity() {
    const [state,setState]=useState<PasskeyState|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[password,setPassword]=useState(""),[name,setName]=useState(""),[removing,setRemoving]=useState<number|null>(null);
    const lock=useRef(false);
    const operation=useRef<AbortController|null>(null);
    useEffect(()=>()=>operation.current?.abort(),[]);
    const load=async(signal:AbortSignal)=>{const data=await passkeyRequest<PasskeyState>("me/security/passkeys",undefined,"GET",signal);if(!signal.aborted)setState(data);};
    useEffect(()=>{let live=true;passkeyRequest<PasskeyState>("me/security/passkeys").then(data=>{if(live)setState(data);}).catch(error=>{if(live)setError(passkeyError(error));});return()=>{live=false;};},[]);
    async function run(action:(signal:AbortSignal)=>Promise<void>) {if(lock.current)return;lock.current=true;const controller=new AbortController();operation.current=controller;setBusy(true);setError("");try{await action(controller.signal);}catch(error){if(!controller.signal.aborted)setError(passkeyError(error));}finally{lock.current=false;if(!controller.signal.aborted){setPassword("");setBusy(false);}}}
    return <section className="panel passkey-security"><div className="panel-head"><h2>{tx("Passkey")}</h2></div><div className="pad">
        <p>{tx("使用设备生物识别、PIN 或安全密钥登录。已启用的 MFA 继续生效。")}</p>
        <p className="muted">{tx("绑定和删除需要当前密码及最近 5 分钟内的完整登录验证；会话过期时请重新登录。")}</p>
        {state && <>
            {!state.enabled && <p className="muted">{tx("站点尚未开启 Passkey，可查看或移除已有绑定。")}</p>}
            <ul>{state.credentials.map(item=><li key={item.id}><strong>{item.name}</strong> · {item.rpId} · {tx("绑定时间")} {formatInstant(item.createdAt)} · {tx("最近使用")} {item.lastUsedAt ? formatInstant(item.lastUsedAt) : tx("尚未使用")} <button type="button" disabled={busy} onClick={()=>{setPassword("");setError("");setRemoving(item.id);}}>{tx("移除")}</button></li>)}</ul>
            {!state.credentials.length && <p className="muted">{tx("尚未绑定 Passkey。")}</p>}
            <form onSubmit={event=>{event.preventDefault();void run(async(signal)=>{await registerPasskey(password,name,signal);if(!signal.aborted){setName("");await load(signal);}});}}>
                <label>{tx("Passkey 名称")}<input required maxLength={64} value={name} onChange={event=>setName(event.target.value)} disabled={busy || !state.enabled}/></label>
                <label>{tx("当前密码")}<input required type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy || !state.enabled}/></label>
                <button type="submit" disabled={busy || !state.enabled || !passkeySupported() || state.credentials.length>=10}>{tx("绑定 Passkey")}</button>
                {state.enabled && !passkeySupported() && <p className="muted">{tx("当前浏览器不支持 Passkey，请使用支持的 HTTPS 浏览器。")}</p>}
            </form>
        </>}
        {error && removing===null && <p role="alert" className="alert">{error}</p>}
        {removing!==null && <Modal title={tx("移除 Passkey")} close={()=>{if(!busy){setRemoving(null);setPassword("");setError("");}}}><form className="pad" onSubmit={event=>{event.preventDefault();void run(async(signal)=>{
            await passkeyRequest(`me/security/passkeys/${removing}`,{password},"DELETE",signal);if(signal.aborted)return;await logoutSession();window.dispatchEvent(new Event("auth-expired"));setRemoving(null);
        });}}><p>{tx("移除后此 Passkey 无法继续登录，所有账户会话将退出。可用密码重新登录。")}</p><label>{tx("当前密码")}<input required type="password" autoComplete="current-password" maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></label>{error && <p role="alert" className="alert">{error}</p>}<button type="submit" disabled={busy}>{tx("确认移除 Passkey")}</button></form></Modal>}
    </div></section>;
}
