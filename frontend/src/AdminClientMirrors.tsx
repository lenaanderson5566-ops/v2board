import { mirrorAssets } from "./mirror-assets";
import { useEffect, useState } from "react";
import { ops, request, rows, bytes, date, type Row } from "./api";
import { useData, State } from "./ui";
const labels: Record<string,string> = { queued:"排队中",downloading:"下载中",ready:"已就绪",failed:"失败" };
export function AdminClientMirrors({clients}: {clients: Row[]}) {
 const d=useData(ops("client/mirrors/fetch"));
 const [client,setClient]=useState("cmfa"),[asset,setAsset]=useState(""),[target,setTarget]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const current=clients.find(c=>c.id===client);
 const targets: string[]=d.data?.targets?.[client] || [];
 const candidates=mirrorAssets(rows(current?.assets),target);
 const candidateKey=candidates.map(a=>`${a.id}:${a.name}`).join("|");
 useEffect(()=>{if(targets.length===1 && !target)setTarget(targets[0]);},[client,targets.join("|"),target]);
 useEffect(()=>{setAsset(String(candidates.find(a=>a.universal)?.id || ""));},[client,target,candidateKey]);
 const selected=candidates.find(a=>String(a.id)===asset);
 const items=rows(d.data?.items);
 const active=items.some(r=>["queued","downloading"].includes(r.status));
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>d.reload(),5000);return()=>clearInterval(timer);},[active]);
 async function run(path:string,body:Row){setBusy(true);setError("");try{await request(ops(path),body);d.reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="release-card"><h3>本地安装包镜像</h3>
 <p className="muted">选择系统后自动筛选安装包，优先选中通用包；没有通用包时请手动确认架构。下载完成后再发布。</p>
 {error && <p role="alert">{error}</p>}
 <State {...d} retry={d.reload}>
 <div className="actions">
 <select aria-label="镜像客户端" value={client} onChange={e=>{setClient(e.target.value);setAsset("");setTarget("");}}>{clients.filter(c=>d.data?.targets?.[c.id]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
 <select aria-label="目标系统" value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择系统</option>{targets.map(t=><option key={t} value={t}>{t.split("_").pop()}</option>)}</select>
 <select aria-label="官方安装包" value={asset} onChange={e=>setAsset(e.target.value)} style={{maxWidth:"100%"}}><option value="">选择官方安装包（先检查版本）</option>{candidates.map(a=><option key={a.id} value={a.id}>{a.universal ? "推荐 · " : ""}{a.architecture} · {a.name} · {bytes(a.size)}</option>)}</select>
 <button disabled={busy || !selected || !target} onClick={()=>run("client/mirrors/download",{client,asset_id:Number(asset),target})}>下载到服务器</button>
 <button onClick={d.reload}>刷新状态</button>
 </div>
 {target && <p className="muted">{!candidates.length ? "暂无可识别的安装包，请先检查官方版本；命名不明确的压缩包不会自动推荐。" : selected?.universal ? "已优先选用通用安装包（按官方文件名识别）。" : "未自动选用特定架构，请选择适合用户设备的安装包；特定架构不能覆盖所有设备。"}</p>}
 <p className="muted">独立队列，每次下载一个文件，单文件上限 512 MiB。自动计算 SHA-256；有官方摘要时核对，否则仅作本地指纹。下载不会自动覆盖线上镜像。</p>
 {!items.length && <p>尚无镜像安装包</p>}
 {items.map(r=><article className="risk-rule-card" key={r.id}>
 <strong>{r.name}</strong><p>{r.version} · {r.target} · {bytes(r.size)} · {labels[r.status]}{d.data?.published?.[r.target]===r.id ? " · 已发布" : ""}</p>
 <small>{date(r.updated_at)}</small>{r.error && <p role="alert">{r.error}</p>}
 {r.sha256 && <p style={{overflowWrap:"anywhere"}}>SHA-256：{r.sha256}<br/>{r.verified ? "已与官方摘要核对" : "本地指纹；官方未提供可核对的 SHA-256"}</p>}
 <div className="actions">
 {r.status==="ready" && <button disabled={busy} onClick={()=>run("client/mirrors/action",{id:r.id,action:d.data?.published?.[r.target]===r.id?"unpublish":"publish"})}>{d.data?.published?.[r.target]===r.id?"下架":"发布为默认镜像"}</button>}
 {d.data?.published?.[r.target]===r.id && <a className="button" href={`/client-mirrors/${r.id}`}>下载安装包</a>}
 {r.status==="failed" && <button disabled={busy} onClick={()=>run("client/mirrors/download",{client:r.client,asset_id:r.asset_id,target:r.target})}>重新下载</button>}
 {!['queued','downloading'].includes(r.status) && d.data?.published?.[r.target]!==r.id && <button disabled={busy} onClick={()=>{if(confirm("删除这份未发布的安装包？"))run("client/mirrors/action",{id:r.id,action:"delete"});}}>删除</button>}
 </div></article>)}
 </State></section>;
}
