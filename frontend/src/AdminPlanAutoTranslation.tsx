import { useState } from "react";
import { admin, query, request, type Row } from "./api";
import { PlanDescription } from "./PlanDescription";

const languages: Record<string, string> = {
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    "en-US": "English",
    "ja-JP": "日本語",
    "ko-KR": "한국어",
    "vi-VN": "Tiếng Việt",
    "ru-RU": "Русский",
    "fa-IR": "فارسی",
};
async function translationRequest<T = Row>(path: string, body?: Row) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
        return await request<T>(path, body, { signal: controller.signal });
    } catch (e) {
        if (controller.signal.aborted)
            throw new Error("请求超时，请重试此语言");
        throw e;
    } finally {
        window.clearTimeout(timer);
    }
}
export function AdminPlanAutoTranslation({
    plan,
    locales,
    onSaved,
}: {
    plan: string;
    locales: string[];
    onSaved: () => void;
}) {
    const [source, setSource] = useState("zh-CN");
    const [drafts, setDrafts] = useState<Record<string, Row>>({});
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [failures, setFailures] = useState<Record<string, string>>({});
    async function generate() {
        if (
            !window.confirm(
                "将把此套餐的描述发送至服务端配置的 Azure Translator，可能产生翻译费用。仅生成缺失译文，确认继续？",
            )
        )
            return;
        setBusy(true);
        setError("");
        setFailures({});
        try {
            const current = await translationRequest<Row>(
                query(admin("ops/i18n/plan/fetch"), { plan_id: plan }),
            );
            const missing = locales.filter(
                (l) =>
                    languages[l] &&
                    !current.data.translations?.[l]?.content?.trim() &&
                    !drafts[l],
            );
            if (!missing.length) {
                setMessage("没有缺失译文，已生成的译文可继续保存");
                return;
            }
            let succeeded = 0;
            const failed: Record<string, string> = {};
            for (let i = 0; i < missing.length; i++) {
                const locale = missing[i];
                setMessage(
                    `正在生成 ${languages[locale]}（${i + 1}/${missing.length}）`,
                );
                try {
                    const result = await translationRequest<Row>(
                        admin("ops/i18n/plan/generate"),
                        { plan_id: Number(plan), source, locale },
                    );
                    setDrafts((previous) => ({
                        ...previous,
                        [locale]: result.data,
                    }));
                    succeeded++;
                } catch (e) {
                    failed[locale] = (e as Error).message;
                    setFailures({ ...failed });
                }
            }
            setMessage(
                `生成结束：成功 ${succeeded}，失败 ${Object.keys(failed).length}。成功译文可预览并保存。`,
            );
        } catch (e) {
            setError((e as Error).message);
            setMessage("生成已停止，请重试；已有译文保留。");
        } finally {
            setBusy(false);
        }
    }
    async function save() {
        setBusy(true);
        setError("");
        let count = 0;
        const savedLocales: string[] = [];
        const failed: Record<string, string> = {};
        try {
            for (const [locale, draft] of Object.entries(drafts)) {
                try {
                    const result = await translationRequest<boolean>(
                        admin("ops/i18n/plan/save"),
                        {
                            plan_id: Number(plan),
                            locale,
                            ...draft,
                            only_missing: true,
                        },
                    );
                    if (result.data) count++;
                    savedLocales.push(locale);
                    setDrafts((previous) => {
                        const next = { ...previous };
                        delete next[locale];
                        return next;
                    });
                } catch (e) {
                    failed[locale] = (e as Error).message;
                }
            }
            setFailures((previous) => { const next={...previous,...failed}; savedLocales.forEach(locale=>delete next[locale]); return next; });
            setMessage(
                `保存结束：已保存 ${count}，失败 ${Object.keys(failed).length}。未保存译文保留，可重试。`,
            );
        } finally {
            setBusy(false);
            onSaved();
        }
    }
    return (
        <section className="pad">
            <h3>Azure 自动翻译</h3>
            <p className="muted">
                读取当前套餐说明，补齐缺失语言。保留功能列表、支持状态与数字；已有译文不覆盖。
            </p>
            <div className="actions">
                <label>
                    原文语言{" "}
                    <select
                        disabled={busy}
                        value={source}
                        onChange={(e) => {
                            setSource(e.target.value);
                            setDrafts({});
                            setMessage("");
                            setFailures({});
                            setError("");
                        }}
                    >
                        {Object.entries(languages).map(([code, name]) => (
                            <option key={code} value={code}>
                                {name}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    className="button secondary"
                    disabled={busy}
                    onClick={generate}
                >
                    {busy
                        ? "处理中…"
                        : Object.keys(failures).length
                          ? "重试缺失译文"
                          : "生成缺失译文"}
                </button>
                {Object.keys(drafts).length > 0 && (
                    <button
                        className="button primary"
                        disabled={busy}
                        onClick={save}
                    >
                        保存已预览译文
                    </button>
                )}
            </div>
            {message && <p role="status">{message}</p>}
            {error && <p role="alert">{error}</p>}
            {Object.keys(failures).length > 0 && (
                <div role="alert">
                    <strong>以下语言未完成，其他语言可继续保存：</strong>
                    <ul>
                        {Object.entries(failures).map(([locale, reason]) => (
                            <li key={locale}>
                                {languages[locale]}：{reason}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {Object.entries(drafts).map(([locale, draft]) => (
                <details key={locale} className="pad">
                    <summary>{languages[locale]}</summary>
                    <div dir={locale === "fa-IR" ? "rtl" : "ltr"}>
                        <PlanDescription content={draft.content} />
                    </div>
                    <label>
                        编辑译文
                        <textarea
                            disabled={busy}
                            rows={5}
                            value={draft.content}
                            onChange={(e) => {
                                const content = e.target.value;
                                setDrafts((previous) => ({
                                    ...previous,
                                    [locale]: { ...previous[locale], content },
                                }));
                            }}
                        />
                    </label>
                </details>
            ))}
        </section>
    );
}
