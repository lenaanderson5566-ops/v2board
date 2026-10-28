import { AdminTabs } from "./AdminChoices";
import { AdminClientDictionary } from "./AdminClientDictionary";
import { languages } from "../shared/language-options";
import { useState, useRef, type FormEvent } from "react";
import { admin, request } from "../shared/api";
import { State, useData, Modal, Pager, TableViewport } from "../shared/ui";
import type { DictionaryData } from "./node-dictionary";
import { AdminFilterBar } from "./AdminFilterBar";
import { AdminChoiceGroup } from "./AdminChoices";
export function AdminDictionary() {
    const [tab,setTab]=useState("nodes");
    return <AdminTabs label="字典分类" value={tab} onChange={setTab} options={[{value:"nodes",label:"节点地区"},{value:"clients",label:"客户端识别"}]}>{tab==="nodes" ? <NodeDictionaryEditor/> : <AdminClientDictionary/>}</AdminTabs>;
}
function NodeDictionaryEditor() {
    const data=useData<DictionaryData>(admin("dictionary/fetch"));
    const [kind,setKind]=useState<"regions"|"cities">("regions"),[search,setSearch]=useState(""),[page,setPage]=useState(1);
    const [language,setLanguage]=useState("zh-CN"),[source,setSource]=useState("all"),[region,setRegion]=useState(""),[pageSize,setPageSize]=useState(20);
    const [edit,setEdit]=useState<{kind:"regions"|"cities";code:string;version:number;names:Record<string,string>}|null>(null);
    const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");const pending=useRef(false);
    const [initialNames,setInitialNames]=useState("");
    const dirty=!!edit && JSON.stringify(edit.names)!==initialNames;
    function dismiss(){if(pending.current)return;if(dirty&&!window.confirm("字典修改尚未保存，确认放弃？"))return;setEdit(null);if(error)data.reload();}
    const catalog=data.data?.catalog;
    const displayName=(names:Record<string,string> | undefined, code:string) => names?.[language] || names?.["en-US"] || code;
    const entries=Object.entries(catalog?.[kind] || {}).filter(([code,names])=>{
        const custom=Object.keys(data.data?.overrides[`${kind}:${code}`] || {}).length>0;
        const country=kind==="cities" ? catalog?.cityRegions[code] : code;
        return (source==="all" || (source==="custom" ? custom : !custom)) &&
            (kind!=="cities" || !region || country===region) &&
            [code,...Object.values(names),country,...Object.values(catalog?.regions[country || ""] || {})].join(" ").toLowerCase().includes(search.trim().toLowerCase());
    }).sort(([a],[b])=>a.localeCompare(b));
    const currentPage=Math.min(page,Math.max(1,Math.ceil(entries.length/pageSize)));
    async function save(event:FormEvent) {event.preventDefault();if(!edit||pending.current)return;pending.current=true;setBusy(true);setError("");try {await request(admin("dictionary/save"),edit);setEdit(null);setNotice("字典已保存，节点展示名称将使用新的翻译。");data.reload();}catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}}
    return <section className="panel"><header className="panel-head"><h2>字典维护</h2></header><div className="pad"><p className="muted">仅维护节点地区显示名称，不影响 GeoIP、代码或节点归属。留空使用内置名称，缺少译文时回退到英文。</p>
        {notice && <p role="status">{notice}</p>}
        <AdminFilterBar onSubmit={e=>e.preventDefault()}><AdminChoiceGroup label="字典类型" value={kind} onChange={value=>{setKind(value as typeof kind);setPage(1);setSearch("");setRegion("");}} options={[{value:"regions",label:"国家／地区"},{value:"cities",label:"州、省与城市"}]} /><input aria-label="搜索字典" placeholder="搜索名称或代码" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} />
            <label>预览语言<select aria-label="预览语言" value={language} onChange={e=>setLanguage(e.target.value)}>{(data.data?.languages || ["zh-CN"]).map(code=><option key={code} value={code}>{languages.find(item=>item.code===code)?.name || code}</option>)}</select></label>
            <label>来源<select aria-label="字典来源" value={source} onChange={e=>{setSource(e.target.value);setPage(1);}}><option value="all">全部</option><option value="custom">已自定义</option><option value="builtin">内置</option></select></label>
            {kind==="cities" && <label>所属地区<select aria-label="所属地区" value={region} onChange={e=>{setRegion(e.target.value);setPage(1);}}><option value="">全部地区</option>{Object.entries(catalog?.regions || {}).map(([code,names])=><option key={code} value={code}>{displayName(names,code)}</option>)}</select></label>}
        </AdminFilterBar>
        <State {...data} retry={data.reload}><TableViewport><table><thead><tr><th>代码</th><th>显示名称</th><th>英文名称</th><th>来源</th><th>操作</th></tr></thead><tbody>{entries.slice((currentPage-1)*pageSize,currentPage*pageSize).map(([code,names])=><tr key={code}><td>{code}{kind==="cities" && <small> · {displayName(catalog?.regions[catalog.cityRegions[code]],catalog?.cityRegions[code] || "—")}</small>}</td><td>{displayName(names,code)}</td><td>{names["en-US"]}</td><td>{Object.keys(data.data?.overrides[`${kind}:${code}`]||{}).length ? "已自定义" : "内置"}</td><td><button onClick={()=>{setError("");setInitialNames(JSON.stringify(data.data?.overrides[`${kind}:${code}`] || {}));setEdit({kind,code,version:data.data?.versions[`${kind}:${code}`]||0,names:{...data.data?.overrides[`${kind}:${code}`]}});}}>编辑</button></td></tr>)}</tbody></table></TableViewport>{!entries.length && <p>没有匹配的字典项</p>}<Pager page={currentPage} total={entries.length} size={pageSize} loading={data.loading} onChange={setPage} onSizeChange={size=>{setPageSize(size);setPage(1);}}/></State>
        </div>{edit && <Modal variant="drawer" wide title={`编辑字典 · ${edit.code}`} dismissible={!busy} close={dismiss}><form className="pad admin-dictionary-editor" aria-busy={busy} data-unsaved={dirty ? "true" : undefined} onSubmit={save}><p className="muted">代码与归属不可修改。恢复默认会清空此项自定义翻译，保存后生效。</p><div className="admin-dictionary-fields">{data.data?.languages.map(language=><label key={language}>{languages.find(item=>item.code===language)?.name || language} · {language}<input aria-label={language} maxLength={100} disabled={busy} lang={language} dir={language==="fa-IR" ? "rtl" : "auto"} value={edit.names[language] || ""} placeholder={data.data?.defaults[edit.kind][edit.code][language] || data.data?.defaults[edit.kind][edit.code]["en-US"]} onChange={e=>setEdit({...edit,names:{...edit.names,[language]:e.target.value}})} /><small>默认：{data.data?.defaults[edit.kind][edit.code][language] || data.data?.defaults[edit.kind][edit.code]["en-US"] || edit.code}</small><small>显示：{edit.names[language]?.trim() || data.data?.defaults[edit.kind][edit.code][language] || edit.names["en-US"]?.trim() || data.data?.defaults[edit.kind][edit.code]["en-US"] || edit.code}</small></label>)}</div>{error && <p role="alert" className="alert">{error}</p>}<div className="actions admin-dictionary-actions"><button type="button" disabled={busy} onClick={()=>setEdit({...edit,names:{}})}>恢复默认</button><button type="button" disabled={busy} onClick={dismiss}>取消</button><button className="primary" disabled={busy}>{busy ? "保存中…" : "保存"}</button></div></form></Modal>}</section>;
}
