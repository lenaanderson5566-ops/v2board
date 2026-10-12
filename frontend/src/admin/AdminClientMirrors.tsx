import { deviceProfiles, mirrorAssets, inspectMirrorUpdates, recommendedMirrorTargets, inspectRecommendedMirrors, type MirrorUpdateResult } from "./mirror-assets";
import { useEffect, useRef, useState } from "react";
import { admin, ops, request, rows, bytes, date, type Row } from "../shared/api";
import { useData, State } from "../shared/ui";
const labels: Record<string,string> = { queued:"排队中",downloading:"下载中",ready:"已就绪",failed:"失败" };
export function AdminClientMirrors({clients, checkUpdates, checking}: {clients: Row[]; checkUpdates?:()=>void; checking?:boolean}) {
 const d=useData(ops("client/mirrors/fetch"));
 const [client,setClient]=useState("cmfa"),[asset,setAsset]=useState(""),[target,setTarget]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const selector=useRef<HTMLSelectElement>(null);
 const manualDetails=useRef<HTMLDetailsElement>(null);
 const [results,setResults]=useState<MirrorUpdateResult[]>([]);
 const [checkedClients,setCheckedClients]=useState<Row[] | null>(null);
 const [manualProfile,setManualProfile]=useState<string | null>(null);
 const availableClients=checkedClients || clients;
 useEffect(()=>setCheckedClients(null),[clients]);
 const [batchMessage,setBatchMessage]=useState("");
 const [autoPublish,setAutoPublish]=useState(true);
 const [profile,setProfile]=useState("");
 const profiles=deviceProfiles[target.split("_").pop() || ""] || [];
 const current=availableClients.find(c=>c.id===client);
 const targets: string[]=d.data?.targets?.[client] || [];
 const candidates=mirrorAssets(rows(current?.assets),target,profile);
 useEffect(()=>{setProfile(manualProfile ?? profiles[0]?.id ?? "");},[target,manualProfile]);
 const candidateKey=candidates.map(a=>`${a.id}:${a.name}`).join("|");
 useEffect(()=>{if(targets.length===1 && !target)setTarget(targets[0]);},[client,targets.join("|"),target]);
 useEffect(()=>{setAsset(String(candidates.find(a=>a.recommended || (!profile && a.universal))?.id || ""));},[client,target,profile,candidateKey]);
 const selected=candidates.find(a=>String(a.id)===asset);
 const items=rows(d.data?.items);
 const active=items.some(r=>["queued","downloading"].includes(r.status));
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>d.reload(),5000);return()=>clearInterval(timer);},[active]);
 async function run(path:string,body:Row){setBusy(true);setError("");try{await request(ops(path),body);d.reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function downloadUpdates(allRecommended=false){
  setBusy(true);setError("");setResults([]);setBatchMessage("正在检查已有镜像的官方版本…");
  let fresh=clients,failed=0,queued=0;
  const failedClients=new Set<string>();
  try {
   let recommended:ReturnType<typeof recommendedMirrorTargets>=[];
   if(allRecommended){
    setBatchMessage("正在读取推荐配置并检查官方版本…");
    const settings=await request<Row>(admin("config/fetch"));
    const app=settings.data?.app;
    if(!app)throw new Error("无法读取客户端推荐配置，请重试");
    const configured=Object.fromEntries(["android","windows","macos","linux","ios"].map(os=>[os,[app[`client_primary_${os}`],app[`client_secondary_${os}`]]]));
    recommended=recommendedMirrorTargets(configured,d.data?.targets);
   }
   for(const id of [...new Set(allRecommended ? recommended.filter(t=>t.supported).map(t=>t.client) : items.map(i=>String(i.client)))]){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try{const res=await request<Row[]>(ops("client/releases/check"),{id},{signal:controller.signal});const checked=rows(res.data).find(c=>c.id===id);if(!checked || checked.error || checked.stale){failedClients.add(id);failed++;}if(checked)fresh=[...fresh.filter(c=>c.id!==id),checked];}
    catch{failedClients.add(id);failed++;}finally{clearTimeout(timer);}
   }
   fresh=fresh.map(c=>failedClients.has(c.id)?{...c,error:c.error || "检查请求失败或超时，请重试"}:c);
   setCheckedClients(fresh);
   const latest=await request<Row>(ops("client/mirrors/fetch"));
   const latestItems=rows(latest.data?.items);
   const report=allRecommended ? inspectRecommendedMirrors(fresh,latestItems,recommended) : inspectMirrorUpdates(fresh,latestItems);
   for(const row of report){
    const reason=latest.data?.policyReasons?.[row.client];
    if(reason && row.status!=="failed"){row.status="skipped";row.reason=reason;continue;}
    if(autoPublish && row.asset_id && row.status==="skipped"){
     const existing=latestItems.find(i=>i.client===row.client && i.target===row.target && Number(i.asset_id)===row.asset_id);
     if(existing?.status==="ready" && !Object.values(latest.data?.published || {}).includes(existing.id)){
      row.status="pending";row.reason="已下载，等待检查自动上架条件";
     }
    }
   }
   const submitted=new Set<string>();
   for(const row of report){const key=`${row.client}:${row.target}:${row.asset_id}`;if(row.status==="pending"){if(submitted.has(key)){row.status="skipped";row.reason="已合并相同通用包";}else submitted.add(key);}}
   setResults([...report]);
   const updates=report.filter(r=>r.status==="pending");
   for(const update of updates){
    setBatchMessage(`加入下载队列：${update.name}`);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try{await request(ops("client/mirrors/download"),{client:update.client,target:update.target,asset_id:update.asset_id,auto_publish:autoPublish},{signal:controller.signal});queued++;update.status="queued";update.reason=autoPublish ? "已提交，校验及策略通过后自动上架" : "已加入下载队列，完成后请发布";}
    catch(e){failed++;update.status="failed";update.reason=`提交失败：${(e as Error).message}；可重新检查后重试`;}finally{clearTimeout(timer);setResults(report.map(r=>({...r})));}
   }
   setBatchMessage(`已加入 ${queued} 个下载任务${failed ? `，${failed} 项检查或提交失败，可重试` : ""}。${autoPublish ? "符合条件的安装包会自动上架，其余项目显示待确认原因。" : "下载完成后请发布。"}`);
  }catch(e){setError((e as Error).message);setBatchMessage("批量下载未完成，请重试。");}finally{setBusy(false);d.reload();}
 }
 return <section className="release-card"><h3>智能安装包同步</h3>
 <p className="muted">优先通用包；没有通用包时，分别匹配 Windows Intel / AMD 与 ARM、Mac Intel 与 Apple M 系列。只有官方 SHA-256 校验和当前策略通过的明确安装包才自动上架。</p>
 <p className="muted">“下载全部推荐客户端”按当前已保存的主推荐、备选及用户端默认推荐批量下载，首次使用也可执行；“一键下载更新”仅更新已有镜像。商店安装和需要人工确认的安装包会列出原因。</p>
 {error && <p role="alert">{error}</p>}
 {batchMessage && <p role="status">{batchMessage}</p>}
 <State {...d} retry={d.reload}>
 <div className="actions">
 {checkUpdates && <button disabled={checking || busy} onClick={checkUpdates}>{checking ? "检查中…" : "一键检查更新"}</button>}
 <button className="primary" disabled={busy || checking || !d.data?.targets} onClick={()=>downloadUpdates(true)}>下载全部推荐客户端</button>
 <label><input type="checkbox" checked={autoPublish} disabled={busy} onChange={e=>setAutoPublish(e.target.checked)}/>符合条件时自动上架</label>
 <button disabled={busy || checking || !items.length} onClick={()=>downloadUpdates()}>一键下载更新</button>
 <details ref={manualDetails}><summary>手动选择安装包</summary><div className="actions">
 <select aria-label="镜像客户端" value={client} onChange={e=>{setClient(e.target.value);setAsset("");setTarget("");setManualProfile(null);}}>{clients.filter(c=>d.data?.targets?.[c.id]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
 <select aria-label="目标系统" value={target} onChange={e=>{setTarget(e.target.value);setManualProfile(null);}}><option value="">选择系统</option>{targets.map(t=><option key={t} value={t}>{t.split("_").pop()}</option>)}</select>
 <select aria-label="适用设备" value={profile} onChange={e=>setProfile(e.target.value)}>{profiles.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
 <select ref={selector} aria-label="官方安装包" value={asset} onChange={e=>setAsset(e.target.value)} style={{maxWidth:"100%"}}><option value="">选择官方安装包（先检查版本）</option>{candidates.map(a=><option key={a.id} value={a.id}>{a.recommended ? "推荐 · " : ""}{a.architecture} · {a.name} · {bytes(a.size)}</option>)}</select>
 <button disabled={busy || !selected || !target} onClick={()=>run("client/mirrors/download",{client,asset_id:Number(asset),target})}>下载到服务器</button>
 </div></details>
 <button onClick={d.reload}>刷新状态</button>
 </div>
 {results.length>0 && <section aria-label="更新检查结果"><h4>更新检查结果</h4><p className="muted">本次检查记录；实时下载状态见下方镜像列表。</p>{results.map(r=><article className="risk-rule-card" key={`${r.client}:${r.target}:${r.architecture}`}>
 <strong>{availableClients.find(c=>c.id===r.client)?.name || r.client} · {r.target.split("_").pop()} · {r.architecture}</strong>
 <p>{({manual:"需确认",failed:"失败",skipped:"已跳过",pending:"待提交",queued:"已排队"} as Record<string,string>)[r.status]}：{r.reason}</p>
 <small style={{overflowWrap:"anywhere"}}>{r.name}</small>
 {r.candidates.length>0 && <details><summary>候选安装包（{r.candidates.length}）</summary><ul>{r.candidates.map(name=><li key={name} style={{overflowWrap:"anywhere"}}>{name}</li>)}</ul></details>}
 {["manual","failed"].includes(r.status) && <button disabled={busy} onClick={()=>{if(manualDetails.current)manualDetails.current.open=true;setClient(r.client);setTarget(r.target);setManualProfile(r.profile || "");setAsset("");selector.current?.focus();selector.current?.scrollIntoView?.({block:"center",behavior:"smooth"});}}>手动选择</button>}
 </article>)}</section>}
 {target && <p className="muted">{current?.error ? `检查失败：${current.error}` : !candidates.length ? "暂无匹配安装包，请先检查更新。" : selected?.recommended ? `推荐：${profiles.find(p=>p.id===profile)?.label || "通用设备"} · ${selected.architecture}（按官方文件名识别）` : "需要手动确认安装包；Linux 请核对发行版，sing-box 桌面发布包为内核程序。"}</p>}
 {target && <p className="muted">官方版本：{current?.version || "尚未检查"} · {items.some(r=>r.target===target && r.version===current?.version && Object.values(d.data?.published || {}).includes(r.id)) ? "已有此版本镜像，请核对适用架构" : "尚未发布此版本"}</p>}
 <p className="muted">独立队列，每次下载一个文件，单文件上限 512 MiB。自动上架在服务器执行，关闭页面不影响任务。无官方摘要时仅保存本地指纹，需手动确认发布。</p>
 {!items.length && <p>尚无镜像安装包</p>}
 {items.map(r=><article className="risk-rule-card" key={r.id}>
 <strong>{r.name}</strong><p>{r.version} · {r.target} · {bytes(r.size)} · {labels[r.status]}{d.data?.published?.[r.publish_key || r.target]===r.id ? " · 已发布" : ""}</p>
 <small>{date(r.updated_at)}</small>{r.error && <p role="alert">{r.error}</p>}
 {r.auto_publish && <p className="muted">{r.publish_reason || "等待下载校验及策略检查后自动上架"}</p>}
 {r.sha256 && <p style={{overflowWrap:"anywhere"}}>SHA-256：{r.sha256}<br/>{r.verified ? "已与官方摘要核对" : "本地指纹；官方未提供可核对的 SHA-256"}</p>}
 <div className="actions">
 {r.status==="ready" && <button disabled={busy} onClick={()=>run("client/mirrors/action",{id:r.id,action:d.data?.published?.[r.publish_key || r.target]===r.id?"unpublish":"publish"})}>{d.data?.published?.[r.publish_key || r.target]===r.id?"下架":"发布此架构镜像"}</button>}
 {d.data?.published?.[r.publish_key || r.target]===r.id && <a className="button" href={`/api/v10/public/client-installers/${r.id}/content`}>下载安装包</a>}
 {r.status==="failed" && <button disabled={busy} onClick={()=>run("client/mirrors/download",{client:r.client,asset_id:r.asset_id,target:r.target})}>重新下载</button>}
 {!['queued','downloading'].includes(r.status) && d.data?.published?.[r.publish_key || r.target]!==r.id && <button disabled={busy} onClick={()=>{if(confirm("删除这份未发布的安装包？"))run("client/mirrors/action",{id:r.id,action:"delete"});}}>删除</button>}
 </div></article>)}
 </State></section>;
}
