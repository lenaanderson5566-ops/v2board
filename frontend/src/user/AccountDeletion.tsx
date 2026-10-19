import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { browserFetch, forgetBrowserSession } from "../shared/browser-session";
import { clearReadCache } from "../shared/api";
import { apiUrl } from "../shared/runtime-config";
import { locale, tx } from "../shared/i18n";
import { Modal } from "../shared/ui";
import type { V10AccountDeletionState } from "../shared/v10-types";

const reasons: Record<string,string> = {
    ADMIN_ACCOUNT: "管理员账户不能自助删除。",
    ACCOUNT_FUNDS: "请先处理账户余额和佣金。",
    OPEN_ORDERS: "请先处理未完成的订单。",
    PENDING_COMMISSION: "请等待邀请佣金结算完成。",
    OPEN_TICKETS: "请先处理并关闭未完成的工单或提现申请。",
    RECENT_LOGIN_REQUIRED: "请重新登录并完成安全验证，在 5 分钟内删除账户。",
    INCORRECT_PASSWORD: "当前密码不正确。",
    ACCOUNT_DELETION_DISABLED: "站点已关闭自助删除账户。",
    RATE_LIMITED: "操作过于频繁，请稍后重试。",
};
async function deletionRequest(body?: {password:string;confirmation:string}, signal?:AbortSignal):Promise<V10AccountDeletionState|undefined> {
    const controller=new AbortController();
    const abort=()=>controller.abort();
    if(signal?.aborted)controller.abort();
    signal?.addEventListener("abort",abort,{once:true});
    const timer=setTimeout(abort,15000);
    try {
    const response=await browserFetch(apiUrl(`/api/v10/me${body ? "" : "/account-deletion"}`),{
        method:body ? "DELETE" : "GET",signal:controller.signal,
        headers:{Accept:"application/json","Accept-Language":locale(),...(body ? {"Content-Type":"application/json"} : {})},
        ...(body ? {body:JSON.stringify(body)} : {}),
    });
    if(response.status===204)return;
    const payload=await response.json();
    if(!response.ok)throw new Error(tx(reasons[payload.code] || "无法完成操作，请刷新页面后重试。"));
    return payload.data;
    } catch(error) {
        if(controller.signal.aborted)throw new Error(tx("无法完成操作，请刷新页面后重试。"));
        throw error;
    } finally {clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
export function AccountDeletion() {
    useTranslation();
    const [state,setState]=useState<V10AccountDeletionState|null>(null);
    const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[password,setPassword]=useState(""),[confirmation,setConfirmation]=useState(""),[error,setError]=useState(""),[ack,setAck]=useState(false),[done,setDone]=useState(false);
    const pending=useRef(false);
    useEffect(()=>{const controller=new AbortController();deletionRequest(undefined,controller.signal).then(value=>{if(!controller.signal.aborted && value)setState(value);}).catch(()=>{});return()=>controller.abort();},[]);
    function close(){if(!pending.current){setOpen(false);setPassword("");setConfirmation("");setAck(false);setError("");}}
    async function remove(event:React.FormEvent){
        event.preventDefault();if(pending.current || !ack || confirmation!=="DELETE")return;
        pending.current=true;setBusy(true);setError("");
        try {
            await deletionRequest({password,confirmation});
            clearReadCache();forgetBrowserSession();setPassword("");setDone(true);setOpen(false);
        } catch(reason){setError((reason as Error).message);setPassword("");}
        finally {pending.current=false;setBusy(false);}
    }
    if(done)return <section className="settings-section"><p role="status">{tx("账户已删除。")}</p><button onClick={()=>window.dispatchEvent(new Event("auth-expired"))}>{tx("返回登录")}</button></section>;
    if(!state?.enabled)return null;
    return <section className="settings-section"><h2>{tx("删除账户")}</h2><div className="settings-card">
        <p className="muted">{tx("永久删除账号身份资料，停用订阅并退出所有设备，无法恢复。")}</p>
        {state.blockers.map(code=><p key={code} className="muted">{tx(reasons[code] || "请先处理未完成事项。")}</p>)}
        <button className="danger" disabled={!!state.blockers.length} onClick={()=>{setOpen(true);setError("");}}>{tx("删除账户")}</button>
    </div>{open && <Modal title={tx("删除账户")} close={close}><form className="pad" onSubmit={remove}>
        <p>{tx("剩余套餐、流量和优惠权益将作废，不会自动退款。必要账务及安全记录按保留规则保存，不会全部立即清除。")}</p>
        <p className="muted">{tx("请重新登录并完成安全验证，在 5 分钟内删除账户。")}</p>
        <label>{tx("当前密码")}<input type="password" autoComplete="current-password" maxLength={128} required value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/></label>
        <label>{tx("输入 DELETE 确认删除")}<input autoComplete="off" spellCheck={false} dir="ltr" required pattern="DELETE" value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)}/></label>
        <label className="account-deletion-ack"><input type="checkbox" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/>{tx("我已了解删除后果，并确认永久删除账户。")}</label>
        {error && <p className="alert" role="alert">{error}</p>}
        <div className="actions"><button type="button" disabled={busy} onClick={close}>{tx("取消")}</button><button type="submit" className="danger" disabled={busy || !ack || confirmation!=="DELETE" || !password}>{tx(busy ? "提交中…" : "确认删除账户")}</button></div>
    </form></Modal>}</section>;
}
