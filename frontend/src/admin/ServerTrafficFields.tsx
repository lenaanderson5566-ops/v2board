import type { Row } from "../shared/api";
export function trafficDraft(budget?: Row): Row {
    return {trafficGiB:String(Number(budget?.limitBytes || 0)/1073741824),countingMode:budget?.countingMode || "both",resetDay:budget?.resetDay || 1};
}
export function trafficPayload(draft: Row) {
    const limit=Number(draft.trafficGiB)*1073741824;
    if (String(draft.trafficGiB).trim()==="" || !Number.isFinite(limit) || !Number.isSafeInteger(Math.round(limit)) || limit<0) throw new Error("请输入有效的流量额度");
    return {limitBytes:Math.round(limit),countingMode:draft.countingMode,resetDay:Number(draft.resetDay)};
}
export function ServerTrafficFields({value,onChange}:{value:Row;onChange:(value:Row)=>void}) {
    return <fieldset><legend>流量与计费周期</legend>
        <label>流量额度（GiB，0 为不限量）<input type="number" min="0" step="0.001" required value={value.trafficGiB} onChange={e=>onChange({...value,trafficGiB:e.target.value})}/></label>
        <label>计费方向<select value={value.countingMode} onChange={e=>onChange({...value,countingMode:e.target.value})}><option value="both">上传 + 下载</option><option value="upload">仅上传</option><option value="download">仅下载</option></select></label>
        <label>每月周期起始日<input type="number" min="1" max="28" step="1" required value={value.resetDay} onChange={e=>onChange({...value,resetDay:Number(e.target.value)})}/></label>
        <p className="muted">同机代理服务共享额度。达到额度后限制连接，提高额度或进入新周期后恢复。修改额度不会清零用量；修改计费方向或起始日会重新计算当前周期用量。</p>
    </fieldset>;
}
