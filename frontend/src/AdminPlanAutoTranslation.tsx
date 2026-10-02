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
    async function generate() {
        if (
            !window.confirm(
                "将把此套餐的描述发送至服务端配置的 Azure Translator，可能产生翻译费用。仅生成缺失译文，确认继续？",
            )
        )
            return;
        setBusy(true);
        setError("");
        setDrafts({});
        try {
            const current = await request<Row>(
                query(admin("ops/i18n/plan/fetch"), { plan_id: plan }),
            );
            const missing = locales.filter(
                (l) =>
                    languages[l] &&
                    !current.data.translations?.[l]?.content?.trim(),
            );
            if (!missing.length) {
                setMessage("所有语言已有译文，无需补齐");
                return;
            }
            for (let i = 0; i < missing.length; i++) {
                const locale = missing[i];
                setMessage(
                    `正在生成 ${languages[locale]}（${i + 1}/${missing.length}）`,
                );
                const result = await request<Row>(
                    admin("ops/i18n/plan/generate"),
                    { plan_id: Number(plan), source, locale },
                );
                setDrafts((previous) => ({
                    ...previous,
                    [locale]: result.data,
                }));
            }
            setMessage("译文已生成，请预览并保存。套餐名称默认保持不变。");
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function save() {
        setBusy(true);
        setError("");
        let count = 0;
        try {
            for (const [locale, draft] of Object.entries(drafts)) {
                const result = await request<boolean>(
                    admin("ops/i18n/plan/save"),
                    {
                        plan_id: Number(plan),
                        locale,
                        ...draft,
                        only_missing: true,
                    },
                );
                if (result.data) count++;
                setDrafts((previous) => {
                    const next = { ...previous };
                    delete next[locale];
                    return next;
                });
            }
            setMessage(`已保存 ${count} 种语言；已有译文保留。`);
        } catch (e) {
            setError((e as Error).message);
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
                    {busy ? "处理中…" : "生成缺失译文"}
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
