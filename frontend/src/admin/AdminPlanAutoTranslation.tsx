import { languages as languageOptions } from "../shared/language-options";
import { useEffect, useRef, useState } from "react";
import { admin, query, request, type Row } from "../shared/api";
import { PlanDescription } from "../shared/PlanDescription";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import "./AdminPlanAutoTranslation.css";

const languages: Record<string, string> = Object.fromEntries(
    languageOptions.map((language) => [language.code, language.name]),
);
const fields = ["name", "content"] as const;
type Field = (typeof fields)[number];
type Status = "inherited" | "missing" | "current" | "outdated" | "unverified";
type Draft = Row & {
    fields: Field[];
    origins: Partial<Record<Field, "machine" | "manual">>;
    previous: Row;
    selected: boolean;
    invalid?: string;
};
const statusLabels: Record<Status, string> = {
    inherited: "沿用原名", missing: "缺失", current: "已同步",
    outdated: "原文已更新", unverified: "旧版译文待核对",
};

function fieldState(current: Row | undefined, locale: string, field: Field) {
    const row = current?.translations?.[locale];
    const state = row?.fields?.[field];
    const status: Status = state?.status || (row?.[field]?.trim()
        ? "unverified" : field === "name" ? "inherited" : "missing");
    return { status, origin: state?.origin as string | null | undefined };
}
function automatic(status: Status, origin?: string | null) {
    return status === "missing" || status === "inherited" ||
        (status === "outdated" && origin === "machine");
}
function draftConflict(draft: Draft, current: Row | undefined, locale: string) {
    if (!current || !/^[a-f0-9]{64}$/.test(draft.translation_version || "") ||
        draft.fields.some((field) => !/^[a-f0-9]{64}$/.test(draft.source_hashes?.[field] || "")))
        return "翻译版本信息不完整，请重新检查状态后生成。";
    if (draft.fields.some((field) => draft.source_hashes?.[field] !== current.source_hashes?.[field]))
        return "原文已变更，请移除此候选后重新生成。";
    if (draft.translation_version !== current.translations?.[locale]?.version)
        return "此语言译文已被更新，请移除此候选后重新生成。";
    return "";
}

export function AdminPlanAutoTranslation({
    plan, locales, onSaved, snapshot, autoStart = false, onBusyChange, onDirtyChange, disabled = false, showRefresh = true,
}: {
    plan: string;
    locales: string[];
    onSaved: () => void;
    snapshot?: Row;
    autoStart?: boolean;
    onBusyChange?: (busy: boolean) => void;
    onDirtyChange?: (dirty: boolean) => void;
    disabled?: boolean;
    showRefresh?: boolean;
}) {
    const [current, setCurrent] = useState<Row | undefined>(snapshot);
    const [loading, setLoading] = useState(!snapshot);
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [selection, setSelection] = useState<Record<string, boolean>>({});
    const [translateNames, setTranslateNames] = useState(false);
    const [busy, setBusy] = useState<"generate" | "save" | null>(null);
    const [message, setMessage] = useState(autoStart ? "套餐已保存，请选择需要同步的译文。生成后可集中预览并保存。" : "");
    const [error, setError] = useState("");
    const [failures, setFailures] = useState<Record<string, string>>({});
    const [retryAt, setRetryAt] = useState(0);
    const retryIn = useRetryCountdown(retryAt);
    const retryDeadline = useRef(0);
    const mounted = useRef(true);
    const pending = useRef(false);
    const activeController = useRef<AbortController | null>(null);
    const stopping = useRef(false);
    const currentRef = useRef(current);
    currentRef.current = current;
    const draftsRef = useRef(drafts);
    draftsRef.current = drafts;
    const supported = locales.filter((locale) => languages[locale] && locale !== "zh-CN");
    const hasDrafts = Object.keys(drafts).length > 0;

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; activeController.current?.abort(); };
    }, []);
    useEffect(() => {
        if (snapshot) { setCurrent(snapshot); setLoading(false); }
    }, [snapshot]);
    useEffect(() => {
        onBusyChange?.(Boolean(busy));
        return () => onBusyChange?.(false);
    }, [busy, onBusyChange]);
    useEffect(() => {
        onDirtyChange?.(hasDrafts);
        return () => onDirtyChange?.(false);
    }, [hasDrafts, onDirtyChange]);
    useEffect(() => {
        if (!hasDrafts) return;
        const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", beforeUnload);
        return () => window.removeEventListener("beforeunload", beforeUnload);
    }, [hasDrafts]);
    useEffect(() => {
        setDrafts((previous) => {
            let changed = false;
            const next = { ...previous };
            Object.entries(previous).forEach(([locale, draft]) => {
                const invalid = draftConflict(draft, current, locale);
                if (invalid && invalid !== draft.invalid) {
                    changed = true;
                    next[locale] = { ...draft, invalid, selected: false };
                }
            });
            return changed ? next : previous;
        });
    }, [current]);

    async function translationRequest<T = Row>(path: string, body?: Row) {
        const controller = new AbortController();
        activeController.current = controller;
        const timer = window.setTimeout(() => controller.abort(), 45000);
        try {
            return await request<T>(path, body, { signal: controller.signal, timeoutMs: 45000 });
        } catch (reason) {
            if (controller.signal.aborted && !stopping.current)
                throw new Error("请求超时，请重试此语言");
            throw reason;
        } finally {
            window.clearTimeout(timer);
            if (activeController.current === controller) activeController.current = null;
        }
    }
    function rateLimited(reason: unknown) {
        const problem = reason as { status?: number; retryAfter?: number };
        if (problem?.status !== 429) return false;
        const seconds = Number(problem.retryAfter);
        retryDeadline.current = Date.now() + Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1000;
        setRetryAt(retryDeadline.current);
        return true;
    }
    async function reload() {
        if (pending.current || disabled || retryDeadline.current > Date.now()) return;
        pending.current = true;
        setLoading(true); setError("");
        try {
            const result = await translationRequest<Row>(query(admin("ops/i18n/plan/fetch"), { plan_id: plan }));
            if (mounted.current) setCurrent(result.data);
        } catch (reason) {
            if (mounted.current) { rateLimited(reason); setError((reason as Error).message); }
        } finally {
            pending.current = false;
            if (mounted.current) setLoading(false);
        }
    }
    useEffect(() => { if (!snapshot) void reload(); }, [plan]);

    function selected(locale: string, field: Field) {
        if (!String(current?.default?.[field] || "").trim()) return false;
        if (field === "name" && !translateNames) return false;
        const state = fieldState(current, locale, field);
        if (state.status === "current") return false;
        return selection[`${locale}:${field}`] ?? automatic(state.status, state.origin);
    }
    function changeSelection(locale: string, field: Field, checked: boolean) {
        setSelection((previous) => ({ ...previous, [`${locale}:${field}`]: checked }));
    }
    function chooseAutomatic(clear = false) {
        const next: Record<string, boolean> = {};
        supported.forEach((locale) => fields.forEach((field) => {
            const state = fieldState(current, locale, field);
            next[`${locale}:${field}`] = !clear && automatic(state.status, state.origin);
        }));
        setSelection(next);
    }
    function chooseReview() {
        setSelection((previous) => {
            const next = { ...previous };
            supported.forEach((locale) => fields.forEach((field) => {
                const state = fieldState(current, locale, field);
                if ((field !== "name" || translateNames) && state.status !== "current" &&
                    !automatic(state.status, state.origin)) next[`${locale}:${field}`] = true;
            }));
            return next;
        });
    }
    const targets = supported.map((locale) => ({ locale, fields: fields.filter((field) =>
        !drafts[locale]?.invalid && selected(locale, field) && !drafts[locale]?.fields.includes(field)) })).filter((target) => target.fields.length > 0);
    const saveTargets = Object.entries(drafts).filter(([, draft]) => draft.selected && !draft.invalid);
    const unavailable = disabled || loading || Boolean(busy) || !current || retryIn > 0;
    const needsSync = (locale: string) => fields.some((field) =>
        (field !== "name" || translateNames) && String(current?.default?.[field] || "").trim() !== "" &&
        fieldState(current, locale, field).status !== "current");
    const relatedLocales = supported.filter(needsSync);
    const otherLocales = supported.filter((locale) => !needsSync(locale));

    async function generate() {
        if (pending.current || unavailable || retryDeadline.current > Date.now() || !targets.length) return;
        if (!window.confirm("将把所选套餐名称或描述发送至服务端配置的 Azure Translator，可能产生翻译费用。仅生成更新候选，现有译文在保存前保持不变。确认继续？")) return;
        pending.current = true; stopping.current = false;
        setBusy("generate"); setError(""); setFailures({});
        let succeeded = 0;
        let paused = false;
        const failed: Record<string, string> = {};
        try {
            for (let index = 0; index < targets.length; index++) {
                if (!mounted.current || stopping.current) break;
                const target = targets[index];
                setMessage(`正在生成 ${languages[target.locale]}（${index + 1}/${targets.length}）`);
                try {
                    const result = await translationRequest<Row>(admin("ops/i18n/plan/generate"), {
                        plan_id: Number(plan), source: "zh-CN", locale: target.locale, fields: target.fields,
                    });
                    if (!mounted.current || stopping.current) break;
                    if (target.fields.some((field) => typeof result.data?.[field] !== "string"))
                        throw new Error("翻译服务返回了不完整的候选，请重试此语言。");
                    const candidate: Draft = {
                        ...result.data, fields: target.fields,
                        origins: Object.fromEntries(target.fields.map((field) => [field, "machine"])),
                        previous: { ...currentRef.current?.translations?.[target.locale] }, selected: true,
                    };
                    const conflict = draftConflict(candidate, currentRef.current, target.locale);
                    if (conflict) {
                        failed[target.locale] = conflict;
                        setError("套餐原文或译文已变更，请重新检查状态后生成。");
                        paused = true; break;
                    }
                    const existing = draftsRef.current[target.locale];
                    const existingConflict = existing && (existing.invalid || draftConflict(existing, currentRef.current, target.locale));
                    if (existingConflict) {
                        setDrafts((previous) => ({ ...previous, [target.locale]: { ...previous[target.locale], invalid: existingConflict, selected: false } }));
                        failed[target.locale] = existingConflict;
                        paused = true; break;
                    }
                    setDrafts((previous) => {
                        const old = previous[target.locale];
                        if (!old) return { ...previous, [target.locale]: candidate };
                        return { ...previous, [target.locale]: {
                            ...old, ...candidate,
                            fields: Array.from(new Set([...old.fields, ...candidate.fields])),
                            origins: { ...old.origins, ...candidate.origins }, previous: old.previous,
                        } };
                    });
                    succeeded++;
                } catch (reason) {
                    if (!mounted.current || stopping.current) break;
                    failed[target.locale] = (reason as Error).message;
                    if (rateLimited(reason) || (reason as { status?: number }).status === 409) { paused = true; break; }
                }
                setFailures({ ...failed });
            }
            if (mounted.current) {
                setFailures(failed);
                setMessage(`${stopping.current ? "生成已停止" : paused ? "生成已暂停" : "生成结束"}：成功 ${succeeded}，失败 ${Object.keys(failed).length}。成功候选保留，可预览并保存。`);
            }
        } finally {
            pending.current = false;
            if (mounted.current) setBusy(null);
        }
    }
    async function save() {
        if (pending.current || unavailable || retryDeadline.current > Date.now() || !saveTargets.length) return;
        pending.current = true; setBusy("save"); setError("");
        let count = 0;
        let paused = false;
        const failed: Record<string, string> = {};
        try {
            for (const [locale, draft] of saveTargets) {
                if (!mounted.current) break;
                const invalid = draftConflict(draft, currentRef.current, locale);
                if (invalid) { failed[locale] = invalid; paused = true; break; }
                try {
                    const result = await translationRequest<boolean>(admin("ops/i18n/plan/save"), {
                        plan_id: Number(plan), locale, fields: draft.fields,
                        source_hashes: draft.source_hashes, translation_version: draft.translation_version,
                        origins: draft.origins,
                        ...Object.fromEntries(draft.fields.map((field) => [field, draft[field]])),
                    });
                    if (!mounted.current) break;
                    if (result.data !== true) throw new Error("译文尚未保存，请重新检查状态后重试。");
                    count++;
                    setDrafts((previous) => { const next = { ...previous }; delete next[locale]; return next; });
                } catch (reason) {
                    if (!mounted.current) break;
                    failed[locale] = (reason as Error).message;
                    if ((reason as { status?: number }).status === 409) {
                        setDrafts((previous) => Object.fromEntries(Object.entries(previous).map(([code, candidate]) =>
                            [code, { ...candidate, invalid: "状态已变更，请重新检查后生成。", selected: false }])));
                        setError("原文或译文已变更，已停止保存，请重新检查状态。旧候选保留供对照。");
                        paused = true; break;
                    }
                    if (rateLimited(reason)) { paused = true; break; }
                }
            }
            if (mounted.current) {
                setFailures(failed);
                setMessage(`${paused ? "保存已暂停" : "保存结束"}：已保存 ${count}，失败 ${Object.keys(failed).length}。未保存候选保留。`);
                onSaved();
            }
        } finally {
            pending.current = false;
            if (mounted.current) setBusy(null);
        }
    }
    function edit(locale: string, field: Field, value: string) {
        setDrafts((previous) => ({ ...previous, [locale]: {
            ...previous[locale], [field]: value,
            origins: { ...previous[locale].origins, [field]: "manual" },
        } }));
    }
    function renderLanguage(locale: string) {
        return <div key={locale} className="plan-translation-language">
            <strong>{languages[locale]}</strong>
            {(["content", "name"] as Field[]).map((field) => {
                const state = fieldState(current, locale, field);
                const protectedValue = !automatic(state.status, state.origin) && state.status !== "current";
                const emptySource = !String(current?.default?.[field] || "").trim();
                const inactive = emptySource || state.status === "current" || (field === "name" && !translateNames);
                return <label key={field} className="plan-translation-field">
                    <span className="plan-translation-check"><input type="checkbox" aria-label={`${languages[locale]}${field === "name" ? "名称" : "描述"}`} checked={selected(locale, field)} disabled={unavailable || inactive} onChange={(event) => changeSelection(locale, field, event.target.checked)} />{field === "name" ? "名称" : "描述"}</span>
                    <small>{emptySource ? "原文为空" : statusLabels[state.status]}{!emptySource && (protectedValue ? " · 需复核" : state.origin === "manual" ? " · 人工" : "")}</small>
                </label>;
            })}
        </div>;
    }

    return <section className="pad plan-translation-sync" aria-label="套餐翻译同步"
        aria-busy={Boolean(busy) || loading} data-saving={busy ? "true" : undefined}
        data-unsaved={hasDrafts ? "true" : undefined}>
        <div className="plan-translation-heading">
            <div><h3>同步套餐翻译</h3><p className="muted">基准语言：简体中文。自动识别缺失和过期译文，人工及旧版译文需主动选择；生成后集中预览保存。</p></div>
            {showRefresh && <button type="button" className="button secondary" disabled={disabled || loading || Boolean(busy) || retryIn > 0} onClick={reload}>重新检查状态</button>}
        </div>
        {current && <>
            <div className="actions plan-translation-selection">
                <label className="plan-translation-check"><input type="checkbox" checked={translateNames} disabled={unavailable} onChange={(event) => setTranslateNames(event.target.checked)} />翻译套餐名称（默认沿用原名）</label>
                <button type="button" className="button secondary" disabled={unavailable} onClick={() => chooseAutomatic()}>选择可自动更新项</button>
                <button type="button" className="button secondary" disabled={unavailable} onClick={chooseReview}>选择需复核项</button>
                <button type="button" className="button secondary" disabled={unavailable} onClick={() => chooseAutomatic(true)}>取消全选</button>
            </div>
            {relatedLocales.length > 0 ? <div className="plan-translation-language-list" role="group" aria-label="待同步语言">
                {relatedLocales.map(renderLanguage)}
            </div> : <p className="muted">当前没有需要同步的文字。</p>}
            {otherLocales.length > 0 && <details className="plan-translation-other-locales">
                <summary>已同步或无需更新（{otherLocales.length}种语言）</summary>
                <div className="plan-translation-language-list" role="group" aria-label="已同步或无需更新的语言">
                    {otherLocales.map(renderLanguage)}
                </div>
            </details>}
        </>}
        <div className="actions">
            <button type="button" className="button secondary" disabled={unavailable || !targets.length} onClick={generate}>{busy === "generate" ? "生成中…" : Object.keys(failures).length ? "重试待同步译文" : "生成待同步译文"}</button>
            {busy === "generate" && <button type="button" className="button secondary" onClick={() => { stopping.current = true; activeController.current?.abort(); }}>停止生成</button>}
            {hasDrafts && <button type="button" className="button primary" disabled={unavailable || !saveTargets.length} onClick={save}>{busy === "save" ? "保存中…" : `保存所选译文（${saveTargets.length}）`}</button>}
            {hasDrafts && <button type="button" className="button secondary" disabled={Boolean(busy) || disabled} onClick={() => { if (window.confirm("放弃所有尚未保存的翻译候选？已保存的译文保持不变。")) { setDrafts({}); setFailures({}); } }}>放弃全部候选</button>}
        </div>
        {loading && <p role="status">正在检查翻译状态…</p>}
        {message && <p role="status">{message}</p>}
        {retryIn > 0 && <p role="status">请求频繁，已暂停后续请求。请在 {retryIn} 秒后手动重试。</p>}
        {error && <p role="alert" className="alert">{error}</p>}
        {Object.keys(failures).length > 0 && <div role="alert" className="plan-translation-failures"><strong>以下语言未完成，已有候选保留：</strong><ul>{Object.entries(failures).map(([locale, reason]) => <li key={locale}>{languages[locale]}：{reason}</li>)}</ul></div>}
        {Object.entries(drafts).map(([locale, draft]) => <div key={locale} className="plan-translation-candidate">
            <div className="plan-translation-heading">
                <label className="plan-translation-check"><input type="checkbox" aria-label={`保存${languages[locale]}候选`} disabled={disabled || Boolean(busy) || Boolean(draft.invalid)} checked={draft.selected} onChange={(event) => setDrafts((previous) => ({ ...previous, [locale]: { ...previous[locale], selected: event.target.checked } }))} /><strong>{languages[locale]}更新候选</strong></label>
                <button type="button" className="button secondary" disabled={disabled || Boolean(busy)} onClick={() => {
                    if (!window.confirm(`放弃${languages[locale]}尚未保存的翻译候选？已保存的译文保持不变。`)) return;
                    setDrafts((previous) => { const next = { ...previous }; delete next[locale]; return next; });
                }}>移除此候选</button>
            </div>
            {draft.invalid && <p role="alert">{draft.invalid}</p>}
            <details open><summary>查看对照与编辑</summary><div dir={locale === "fa-IR" ? "rtl" : "ltr"} lang={locale}>
                {draft.fields.map((field) => <div key={field} className="plan-translation-comparison">
                    <details><summary>当前{field === "name" ? "名称" : "描述"}</summary>{field === "content" ? <PlanDescription content={draft.previous.content || ""} /> : <p>{draft.previous.name || "沿用原名"}</p>}</details>
                    <label>{languages[locale]}{field === "name" ? "名称候选" : "描述候选"}
                        {field === "name" ? <input value={draft.name || ""} maxLength={255} disabled={disabled || Boolean(busy) || Boolean(draft.invalid)} onChange={(event) => edit(locale, field, event.target.value)} /> : <textarea rows={5} value={draft.content || ""} disabled={disabled || Boolean(busy) || Boolean(draft.invalid)} onChange={(event) => edit(locale, field, event.target.value)} />}
                    </label>
                    {field === "content" && <details><summary>预览更新后描述</summary><PlanDescription content={draft.content || ""} /></details>}
                    <small className="muted">{draft.origins[field] === "manual" ? "已人工修改，保存后将按人工译文保护。" : "机器翻译候选，可在保存前修改。"}</small>
                </div>)}
            </div></details>
        </div>)}
    </section>;
}
