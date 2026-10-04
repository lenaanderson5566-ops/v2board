import { deviceProfiles, mirrorAssets, mirrorUpdates } from "./mirror-assets";
import { useEffect, useState } from "react";
import { ops, request, rows, bytes, date, type Row } from "./api";
import { useData, State } from "./ui";
const labels: Record<string,string> = { queued:"排队中",downloading:"下载中",ready:"已就绪",failed:"失败" };
export function AdminClientMirrors({clients, checkUpdates, checking}: {clients: Row[]; checkUpdates?:()=>void; checking?:boolean}) {
 const d=useData(ops("client/mirrors/fetch"));
 const [client,setClient]=useState("cmfa"),[asset,setAsset]=useState(""),[target,setTarget]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [batchMessage,setBatchMessage]=useState("");
 const [profile,setProfile]=useState("");
 const profiles=deviceProfiles[target.split("_").pop() || ""] || [];
 const current=clients.find(c=>c.id===client);
 const targets: string[]=d.data?.targets?.[client] || [];
 const candidates=mirrorAssets(rows(current?.assets),target,profile);
 useEffect(()=>setProfile(profiles[0]?.id || ""),[target]);
 const candidateKey=candidates.map(a=>`${a.id}:${a.name}`).join("|");
 useEffect(()=>{if(targets.length===1 && !target)setTarget(targets[0]);},[client,targets.join("|"),target]);
 useEffect(()=>{setAsset(String(candidates.find(a=>a.recommended || (!profile && a.universal))?.id || ""));},[client,target,profile,candidateKey]);
 const selected=candidates.find(a=>String(a.id)===asset);
 const items=rows(d.data?.items);
 const active=items.some(r=>["queued","downloading"].includes(r.status));
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>d.reload(),5000);return()=>clearInterval(timer);},[active]);
 async function run(path:string,body:Row){setBusy(true);setError("");try{await request(ops(path),body);d.reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function downloadUpdates(){
  setBusy(true);setError("");setBatchMessage("正在检查已有镜像的官方版本…");
  let fresh=clients,failed=0,queued=0;
  const failedClients=new Set<string>();
  try {
   for(const id of [...new Set(items.map(i=>String(i.client)))]){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try{const res=await request<Row[]>(ops("client/releases/check"),{id},{signal:controller.signal});fresh=rows(res.data);if(fresh.find(c=>c.id===id)?.error){failedClients.add(id);failed++;}}
    catch{failedClients.add(id);failed++;}finally{clearTimeout(timer);}
   }
   const updates=mirrorUpdates(fresh.filter(c=>!failedClients.has(c.id)),items);
   for(const update of updates){
    setBatchMessage(`加入下载队列：${update.name}`);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try{const {name,...body}=update;await request(ops("client/mirrors/download"),body,{signal:controller.signal});queued++;}
    catch{failed++;}finally{clearTimeout(timer);}
   }
   setBatchMessage(`已加入 ${queued} 个下载任务${failed ? `，${failed} 项检查或提交失败，可重试` : ""}。已下载、处理中及无法明确匹配的安装包会跳过；下载完成后请发布。`);
  }finally{setBusy(false);d.reload();}
 }
 return <section className="release-card"><h3>本地安装包镜像</h3>
 <p className="muted">按设备推荐安装包，优先通用包。下载完成后发布，同一系统可保留不同架构。</p>
 {error && <p role="alert">{error}</p>}
 {batchMessage && <p role="status">{batchMessage}</p>}
 <State {...d} retry={d.reload}>
 <div className="actions">
 {checkUpdates && <button disabled={checking || busy} onClick={checkUpdates}>{checking ? "检查中…" : "一键检查更新"}</button>}
 <button disabled={busy || checking || !items.length} onClick={downloadUpdates}>一键下载更新</button>
 <select aria-label="镜像客户端" value={client} onChange={e=>{setClient(e.target.value);setAsset("");setTarget("");}}>{clients.filter(c=>d.data?.targets?.[c.id]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
 <select aria-label="目标系统" value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择系统</option>{targets.map(t=><option key={t} value={t}>{t.split("_").pop()}</option>)}</select>
 <select aria-label="适用设备" value={profile} onChange={e=>setProfile(e.target.value)}>{profiles.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
 <select aria-label="官方安装包" value={asset} onChange={e=>setAsset(e.target.value)} style={{maxWidth:"100%"}}><option value="">选择官方安装包（先检查版本）</option>{candidates.map(a=><option key={a.id} value={a.id}>{a.recommended ? "推荐 · " : ""}{a.architecture} · {a.name} · {bytes(a.size)}</option>)}</select>
 <button disabled={busy || !selected || !target} onClick={()=>run("client/mirrors/download",{client,asset_id:Number(asset),target})}>下载到服务器</button>
 <button onClick={d.reload}>刷新状态</button>
 </div>
 {target && <p className="muted">{current?.error ? `检查失败：${current.error}` : !candidates.length ? "暂无匹配安装包，请先检查更新。" : selected?.recommended ? `推荐：${profiles.find(p=>p.id===profile)?.label || "通用设备"} · ${selected.architecture}（按官方文件名识别）` : "需要手动确认安装包；Linux 请核对发行版，sing-box 桌面发布包为内核程序。"}</p>}
 {target && <p className="muted">官方版本：{current?.version || "尚未检查"} · {items.some(r=>r.target===target && r.version===current?.version && Object.values(d.data?.published || {}).includes(r.id)) ? "已有此版本镜像，请核对适用架构" : "尚未发布此版本"}</p>}
 <p className="muted">独立队列，每次下载一个文件，单文件上限 512 MiB。自动计算 SHA-256；有官方摘要时核对，否则仅作本地指纹。下载不会自动覆盖线上镜像。</p>
 {!items.length && <p>尚无镜像安装包</p>}
 {items.map(r=><article className="risk-rule-card" key={r.id}>
 <strong>{r.name}</strong><p>{r.version} · {r.target} · {bytes(r.size)} · {labels[r.status]}{d.data?.published?.[r.publish_key || r.target]===r.id ? " · 已发布" : ""}</p>
 <small>{date(r.updated_at)}</small>{r.error && <p role="alert">{r.error}</p>}
 {r.sha256 && <p style={{overflowWrap:"anywhere"}}>SHA-256：{r.sha256}<br/>{r.verified ? "已与官方摘要核对" : "本地指纹；官方未提供可核对的 SHA-256"}</p>}
 <div className="actions">
 {r.status==="ready" && <button disabled={busy} onClick={()=>run("client/mirrors/action",{id:r.id,action:d.data?.published?.[r.publish_key || r.target]===r.id?"unpublish":"publish"})}>{d.data?.published?.[r.publish_key || r.target]===r.id?"下架":"发布此架构镜像"}</button>}
 {d.data?.published?.[r.publish_key || r.target]===r.id && <a className="button" href={`/client-mirrors/${r.id}`}>下载安装包</a>}
 {r.status==="failed" && <button disabled={busy} onClick={()=>run("client/mirrors/download",{client:r.client,asset_id:r.asset_id,target:r.target})}>重新下载</button>}
 {!['queued','downloading'].includes(r.status) && d.data?.published?.[r.publish_key || r.target]!==r.id && <button disabled={busy} onClick={()=>{if(confirm("删除这份未发布的安装包？"))run("client/mirrors/action",{id:r.id,action:"delete"});}}>删除</button>}
 </div></article>)}
 </State></section>;
}
