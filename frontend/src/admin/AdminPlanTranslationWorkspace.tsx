import { useEffect, useRef, useState } from "react";
import { admin, query, request, type Row } from "../shared/api";
import { languages } from "../shared/language-options";
import { PlanDescription } from "../shared/PlanDescription";
import { Editor, State, useData } from "../shared/ui";
import { field } from "./admin-fields";
import { AdminPlanAutoTranslation } from "./AdminPlanAutoTranslation";

const labels: Record<string, string> = Object.fromEntries(languages.map(l => [l.code, l.name]));
const statusLabels: Record<string, string> = {
    inherited: "沿用原文", missing: "缺失", current: "已同步",
    outdated: "原文已变更", unverified: "历史译文待核对",
};

export function AdminPlanTranslationWorkspace({ plan, autoStart = false, onBusyChange, locales: availableLocales }: {
    plan: string; autoStart?: boolean; onBusyChange?: (busy: boolean) => void; locales?: string[];
}) {
    const data = useData<Row>(query(admin("ops/i18n/plan/fetch"), { plan_id: plan }));
    const locales = useData<string[]>(availableLocales ? "" : admin("ops/i18n/plan/locales"));
    const localeOptions = availableLocales || locales.data || [];
    const [locale, setLocale] = useState("en-US");
    const [autoBusy, setAutoBusy] = useState(false), [autoDirty, setAutoDirty] = useState(false);
    const [manualBusy, setManualBusy] = useState(false), [manualDirty, setManualDirty] = useState(false);
    const [notice, setNotice] = useState(""), [reviewError, setReviewError] = useState("");
    const [refreshVersion, setRefreshVersion] = useState(0);
    const reviewPending = useRef(false);
    const busy = autoBusy || manualBusy;
    useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
    const snapshot = data.data;
    const translation = snapshot?.translations?.[locale];
    const blocked = busy || data.loading || !!data.error || !translation?.version;
    const reviewFields = ["name", "content"].filter(key =>
        translation?.[key]?.trim() && ["outdated", "unverified"].includes(translation?.fields?.[key]?.status));
    const refresh = () => {
        if (busy || manualDirty && !window.confirm("重新加载会放弃手动编辑的未保存译文，确认继续？生成候选将保留。")) return;
        setManualDirty(false); setRefreshVersion(value => value + 1);
        setNotice(""); setReviewError(""); data.reload();
    };
    async function confirmExisting() {
        if (blocked || manualDirty || autoDirty || reviewPending.current || !reviewFields.length) return;
        if (!window.confirm("确认已核对当前语言的名称和说明，现有待复核译文适用于最新原文？")) return;
        reviewPending.current = true; setManualBusy(true); setReviewError("");
        try {
            await request(admin("ops/i18n/plan/save"), {
                plan_id: Number(plan), locale, fields: reviewFields,
                source_hashes: snapshot!.source_hashes, translation_version: translation.version,
                ...Object.fromEntries(reviewFields.map(key => [key, translation[key]])),
                origins: Object.fromEntries(reviewFields.map(key => [key, "manual"])),
            });
            setNotice("现有译文已确认适用"); data.reload();
        } catch (error) { setReviewError((error as Error).message); }
        finally { reviewPending.current = false; setManualBusy(false); }
    }
    return <div className="admin-plan-translation-workspace" data-saving={busy ? "true" : undefined}>
        <State {...locales}><State {...data}>
            {snapshot && <>
                <div className="pad">
                    {autoStart && <p role="status">套餐已保存。可在这里更新缺失或过期译文，人工译文须先核对。</p>}
                    <p><strong>基准语言：简体中文</strong> · {snapshot.default?.name}</p>
                    <p className="muted">套餐名称留空时跟随原名。流量、设备数、价格与周期从套餐配置读取，无需在说明中重复维护。</p>
                    <details><summary>查看最新原文</summary><PlanDescription content={snapshot.default?.content} /></details>
                </div>
                <fieldset disabled={manualBusy || manualDirty || !!data.error} className="plan-translation-fieldset">
                    <AdminPlanAutoTranslation plan={plan} snapshot={snapshot} locales={localeOptions} showRefresh={false}
                        disabled={manualBusy || manualDirty || data.loading || !!data.error}
                        onBusyChange={setAutoBusy} onDirtyChange={setAutoDirty} onSaved={data.reload} />
                </fieldset>
                <details className="pad">
                    <summary>手动编辑与核对</summary>
                    {(autoBusy || autoDirty) && <p role="status">请先保存或放弃生成的候选译文，再手动编辑。</p>}
                    <label>编辑语言 <select aria-label="选择语言" value={locale}
                        disabled={busy || autoDirty || data.loading || !!data.error}
                        onChange={event => {
                            if (manualDirty && !window.confirm("有尚未保存的译文，确认切换语言？")) return;
                            setLocale(event.target.value); setManualDirty(false); setNotice(""); setReviewError("");
                        }}>
                        {localeOptions.filter(code => code !== snapshot.source_language).map(code =>
                            <option key={code} value={code}>{labels[code] || code}</option>)}
                    </select></label>
                    {translation && <>
                        <p className="muted">名称：{statusLabels[translation.fields?.name?.status] || "待核对"}；说明：{statusLabels[translation.fields?.content?.status] || "待核对"}。仅保存修改的字段。</p>
                        <fieldset disabled={autoBusy || autoDirty || !!data.error || data.loading} className="plan-translation-fieldset">
                            <Editor key={`${locale}:${translation.version}:${JSON.stringify(snapshot.source_hashes)}:${refreshVersion}`}
                                fields={[field("name", "翻译名称（留空沿用原名）"), field("content", "翻译说明（JSON / HTML）", "textarea")]}
                                initial={{ name: translation.name || "", content: translation.content || "" }}
                                onDirtyChange={setManualDirty} onBusyChange={setManualBusy}
                                onSave={async body => {
                                    const fields = ["name", "content"].filter(key => (body[key] || "") !== (translation[key] || ""));
                                    if (!fields.length) throw new Error("请修改译文，或确认现有译文仍适用。");
                                    await request(admin("ops/i18n/plan/save"), {
                                        plan_id: Number(plan), locale, fields,
                                        source_hashes: snapshot.source_hashes, translation_version: translation.version,
                                        ...Object.fromEntries(fields.map(key => [key, body[key] || null])),
                                        origins: Object.fromEntries(fields.map(key => [key, "manual"])),
                                    });
                                    setManualDirty(false); setNotice("翻译已保存"); data.reload();
                                }} />
                        </fieldset>
                        {!!reviewFields.length && <button type="button" disabled={blocked || manualDirty || autoDirty}
                            onClick={confirmExisting}>确认现有译文仍适用</button>}
                    </>}
                    {reviewError && <p role="alert">{reviewError}</p>}
                    {notice && <p role="status">{notice}</p>}
                </details>
                <div className="pad"><button type="button" disabled={busy || data.loading} onClick={refresh}>重新加载翻译状态</button></div>
            </>}
        </State></State>
    </div>;
}
