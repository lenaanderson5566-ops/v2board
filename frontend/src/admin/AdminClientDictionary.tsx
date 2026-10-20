import { useRef, useState } from "react";
import { admin, request } from "../shared/api";
import { Modal, Pager, TableViewport, State, useData } from "../shared/ui";
import { AdminFilterBar } from "./AdminFilterBar";

type Client = {code:string; name:string; defaultName:string; builtinAliases:string[]; aliases:string[]; priority:number};
type Draft = Client & {aliasText:string};
type Recognition = {code:string; name:string; source:string};
export function AdminClientDictionary() {
    const data = useData<{items:Client[];version:number}>(admin("dictionary/clients"));
    const [search,setSearch] = useState(""), [page,setPage] = useState(1);
    const [edit,setEdit] = useState<Draft|null>(null);
    const [ua,setUa] = useState(""), [preview,setPreview] = useState<Recognition|null>(null);
    const [busy,setBusy] = useState(false), [error,setError] = useState(""), [notice,setNotice] = useState("");
    const pending = useRef(false);
    const items = (data.data?.items || []).filter(item =>
        [item.code,item.name,...item.builtinAliases,...item.aliases].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
    const currentPage = Math.min(page,Math.max(1,Math.ceil(items.length/20)));
    function rules() {
        return Object.fromEntries((data.data?.items || []).map(item => [item.code,
            edit?.code===item.code ? {name:edit.name,aliases:edit.aliasText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),priority:edit.priority}
                : {name:item.name,aliases:item.aliases,priority:item.priority}]));
    }
    async function run(action:"save"|"preview") {
        if (pending.current || !data.data) return;
        pending.current=true;setBusy(true);setError("");setPreview(null);
        try {
            if (action==="preview") {
                const result=await request<Recognition>(admin("dictionary/clients/preview"),{rules:rules(),ua});
                setPreview(result.data);
            } else {
                await request(admin("dictionary/clients/save"),{rules:rules(),version:data.data.version});
                setEdit(null);setNotice("识别库已保存。日志与报表将在下次加载时使用新规则。");data.reload();
            }
        } catch (cause) {setError((cause as Error).message);}
        finally {pending.current=false;setBusy(false);}
    }
    function close() {if (!pending.current) {setEdit(null);setPreview(null);if(error)data.reload();setError("");}}
    const tester = <div className="settings-card">
        <label>测试 UA<textarea aria-label="测试 UA" value={ua} maxLength={1024} disabled={busy} onChange={e=>{setUa(e.target.value);setPreview(null);}}/></label>
        <button type="button" disabled={busy || !ua.trim() || !data.data} onClick={()=>run("preview")}>测试识别</button>
        {preview && <p role="status">{preview.name} · {preview.code} · {preview.source==="builtin" ? "内置规则" : preview.source==="custom" ? "自定义别名" : "未识别"}</p>}
    </div>;
    return <section className="panel">
        <header className="panel-head"><h2>客户端识别</h2></header>
        <div className="pad">
            <p className="muted">维护第三方客户端的展示名称与 UA 产品别名。内置规则优先，自定义规则按优先级从高到低匹配；未知客户端归为“其他”，原始 UA 保留。</p>
            <p className="muted">仅用于日志与统计展示，不改变客户端白名单、最低版本、订阅格式或权限。下载、图标和教程在客户端管理维护。</p>
            {notice && <p role="status">{notice}</p>}
            <AdminFilterBar onSubmit={e=>e.preventDefault()}><input aria-label="搜索客户端识别" placeholder="搜索名称、代码或别名" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></AdminFilterBar>
            <State {...data} retry={data.reload}>
                <TableViewport><table><thead><tr><th>客户端</th><th>内置别名</th><th>自定义别名</th><th>优先级</th><th>操作</th></tr></thead><tbody>
                    {items.slice((currentPage-1)*20,currentPage*20).map(item=><tr key={item.code}><td>{item.name}<small className="muted"> · {item.code}</small></td><td>{item.builtinAliases.join(" / ")}</td><td>{item.aliases.join(" / ") || "—"}</td><td>{item.priority}</td><td><button onClick={()=>{setEdit({...item,aliasText:item.aliases.join("\n")});setError("");setPreview(null);}}>编辑</button></td></tr>)}
                </tbody></table></TableViewport>
                {!items.length && <p>没有匹配的客户端</p>}
                <Pager page={currentPage} total={items.length} size={20} loading={data.loading} onChange={setPage}/>
            </State>
            {!edit && tester}
            {!edit && error && <p role="alert">{error}</p>}
        </div>
        {edit && <Modal variant="drawer" title={`编辑客户端 · ${edit.code}`} close={close}>
            <form className="pad admin-dictionary-editor" onSubmit={e=>{e.preventDefault();run("save");}}>
                <label>显示名称<input aria-label="显示名称" value={edit.name} maxLength={100} required disabled={busy} onChange={e=>{setEdit({...edit,name:e.target.value});setPreview(null);}}/></label>
                <p className="muted">固定代码：{edit.code} · 内置别名：{edit.builtinAliases.join(" / ")}</p>
                <label>自定义别名<textarea aria-label="自定义别名" value={edit.aliasText} maxLength={1300} disabled={busy} onChange={e=>{setEdit({...edit,aliasText:e.target.value});setPreview(null);}}/></label>
                <p className="muted">每行一个产品名，最多 20 个；只匹配 UA 开头的完整产品名称，不支持正则。跨客户端重复及冲突别名不能保存。</p>
                <label>优先级<input aria-label="优先级" type="number" min={0} max={1000} step={1} required disabled={busy} value={edit.priority} onChange={e=>{setEdit({...edit,priority:Number(e.target.value)});setPreview(null);}}/></label>
                {tester}
                {error && <p role="alert">{error}</p>}
                <div className="actions admin-dictionary-actions">
                    <button type="button" disabled={busy} onClick={()=>{setEdit({...edit,name:edit.defaultName,aliasText:"",priority:100});setPreview(null);}}>恢复默认</button>
                    <button type="button" disabled={busy} onClick={close}>取消</button>
                    <button disabled={busy}>{busy ? "处理中…" : "保存"}</button>
                </div>
            </form>
        </Modal>}
    </section>;
}
