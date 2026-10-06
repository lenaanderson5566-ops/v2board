import { useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { AdminMailPreview, mailLanguages } from "./AdminMailPreview";
import { Html } from "../shared/ui";
import "./content-composer.css";
type Draft = { subject: string; content: string };
export function ContentComposer({
    kind,
    initial = {},
    onSave,
    confirmed = true,
}: {
    kind: "mail" | "notice";
    initial?: Row;
    confirmed?: boolean;
    onSave: (body: Row) => Promise<void>;
}) {
    const [source, setSource] = useState(initial.source_language || "zh-CN");
    const [selected, setSelected] = useState<string[]>(
        Array.from(
            new Set([
                "zh-CN",
                "en-US",
                ...Object.keys(initial.translations || {}),
            ]),
        ),
    );
    const [tab, setTab] = useState("default");
    const [drafts, setDrafts] = useState<Record<string, Draft>>({
        default: {
            subject: initial.subject || initial.title || "",
            content: initial.content || "",
        },
        ...initial.translations,
    });
    const [busy, setBusy] = useState(false),
        [status, setStatus] = useState(""),
        [error, setError] = useState("");
    const [failures, setFailures] = useState<Record<string, string>>({});
    const [cover, setCover] = useState(initial.img_url || ""),
        [tags, setTags] = useState(JSON.stringify(initial.tags || []));
    const draft = drafts[tab] || { subject: "", content: "" };
    const edit = (key: keyof Draft, value: string) =>
        setDrafts((prev) => ({
            ...prev,
            [tab]: {
                ...(prev[tab] || { subject: "", content: "" }),
                [key]: value,
            },
        }));
    async function generate() {
        const original = drafts.default;
        if (!original.subject.trim() || !original.content.trim()) {
            setError("请先填写原文标题和正文");
            return;
        }
        if (
            !confirm(
                "将原文发送至 Azure Translator 生成缺失译文，可能产生翻译费用。已有内容保留，生成后请审核。",
            )
        )
            return;
        setBusy(true);
        setError("");
        const errors: Record<string, string> = {};
        const missing = selected.filter(
            (locale) =>
                locale !== source &&
                !drafts[locale]?.subject.trim() &&
                !drafts[locale]?.content.trim(),
        );
        for (const [index, locale] of missing.entries()) {
            setStatus(
                `正在生成 ${index + 1}/${missing.length} · ${mailLanguages[locale as keyof typeof mailLanguages]}`,
            );
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 45000);
            try {
                const result = await request<Draft>(
                    admin("ops/i18n/content/generate"),
                    {
                        ...original,
                        source,
                        locale,
                        format: kind === "mail" || /<\/?[a-z][\s>]/i.test(original.content) ? "html" : "plain",
                    },
                    { signal: controller.signal },
                );
                setDrafts((prev) => ({ ...prev, [locale]: result.data }));
            } catch (e) {
                errors[locale] = controller.signal.aborted
                    ? "请求超时，可重试"
                    : (e as Error).message;
            } finally {
                clearTimeout(timer);
            }
        }
        setFailures(errors);
        setStatus(
            missing.length
                ? "生成结束，请审核译文后保存"
                : "所选语言已有内容，无需生成",
        );
        setBusy(false);
    }
    return (
        <form
            className="mail-composer content-composer"
            onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                if (!confirmed) {
                    setError("请先确认操作范围和人数");
                    return;
                }
                const original = drafts.default;
                if (!original.subject.trim() || !original.content.trim()) {
                    setError("请填写原文标题和正文");
                    return;
                }
                const translations: Record<string, Draft> = {};
                for (const locale of selected) {
                    const value = locale === source ? original : drafts[locale];
                    if (!value?.subject.trim() || !value?.content.trim()) {
                        setError(
                            `请补全 ${mailLanguages[locale as keyof typeof mailLanguages]} 译文，或取消勾选该语言`,
                        );
                        return;
                    }
                    translations[locale] = value;
                }
                let parsedTags;
                if (kind === "notice") {
                    try {
                        parsedTags = JSON.parse(tags);
                        if (
                            !Array.isArray(parsedTags) ||
                            parsedTags.some((t) => typeof t !== "string")
                        )
                            throw new Error();
                    } catch {
                        setError('标签须为字符串数组，例如 ["维护"]');
                        return;
                    }
                }
                setBusy(true);
                try {
                    await onSave(
                        kind === "mail"
                            ? {
                                  ...original,
                                  source_language: source,
                                  translations,
                              }
                            : {
                                  id: initial.id,
                                  title: original.subject,
                                  content: original.content,
                                  source_language: source,
                                  translations,
                                  img_url: cover || null,
                                  tags: parsedTags,
                              },
                    );
                } catch (e) {
                    setError((e as Error).message);
                } finally {
                    setBusy(false);
                }
            }}
        >
            <p className="muted">
                按用户语言展示；缺少对应译文时使用原文。勾选内容语言，简体与繁体分别维护。
            </p>
            <fieldset disabled={busy}>
                <legend>内容语言</legend>
                <div className="content-languages">
                    {Object.entries(mailLanguages).map(([locale, label]) => (
                        <label key={locale}>
                            <input
                                type="checkbox"
                                checked={selected.includes(locale)}
                                onChange={(e) => {
                                    setSelected((prev) =>
                                        e.target.checked
                                            ? [...prev, locale]
                                            : prev.filter((l) => l !== locale),
                                    );
                                    if (!e.target.checked && tab === locale)
                                        setTab("default");
                                }}
                            />
                            {label}
                        </label>
                    ))}
                </div>
                <div className="toolbar">
                    <label>
                        原文语言
                        <select
                            value={source}
                            onChange={(e) => {
                                setSource(e.target.value);
                                setTab("default");
                            }}
                        >
                            {Object.entries(mailLanguages).map(
                                ([locale, label]) => (
                                    <option key={locale} value={locale}>
                                        {label}
                                    </option>
                                ),
                            )}
                        </select>
                    </label>
                    <button type="button" onClick={generate}>
                        生成缺失译文 / 重试
                    </button>
                </div>
                <label>
                    编辑语言
                    <select
                        value={tab}
                        onChange={(e) => setTab(e.target.value)}
                    >
                        <option value="default">原文（必填）</option>
                        {selected
                            .filter((l) => l !== source)
                            .map((locale) => (
                                <option key={locale} value={locale}>
                                    {
                                        mailLanguages[
                                            locale as keyof typeof mailLanguages
                                        ]
                                    }
                                    {drafts[locale]?.content
                                        ? " · 已填写"
                                        : " · 待补全"}
                                </option>
                            ))}
                    </select>
                </label>
                <label>
                    {kind === "mail" ? "邮件主题" : "公告标题"}
                    <input
                        required
                        dir="auto"
                    maxLength={200}
                        value={draft.subject}
                        onChange={(e) => edit("subject", e.target.value)}
                        placeholder="明确说明事项，避免夸张或催促性标题"
                    />
                </label>
                <label>
                    {kind === "mail"
                        ? "邮件正文 HTML"
                        : "公告正文（Markdown / HTML）"}
                    <textarea
                        dir="auto"
                    rows={7}
                        maxLength={100000}
                        value={draft.content}
                        onChange={(e) => edit("content", e.target.value)}
                        placeholder="说明发生了什么、对用户的影响，以及需要采取的操作。"
                    />
                </label>
                <p className="muted">
                    建议：事项 → 影响 / 时间 → 操作。自动翻译原文最多 20,000
                    字；修改原文后，请检查已有译文。
                </p>
                {kind === "notice" && (
                    <details>
                        <summary>封面与标签</summary>
                        <label>
                            封面 URL
                            <input
                                type="url"
                                value={cover}
                                onChange={(e) => setCover(e.target.value)}
                            />
                        </label>
                        <label>
                            标签数组
                            <input
                                value={tags}
                                onChange={(e) => setTags(e.target.value)}
                            />
                        </label>
                    </details>
                )}
            </fieldset>
            {status && <p role="status">{status}</p>}
            {Object.entries(failures).map(([locale, message]) => (
                <p role="alert" key={locale}>
                    {mailLanguages[locale as keyof typeof mailLanguages]}：
                    {message}
                </p>
            ))}
            {kind === "mail" ? (
                <AdminMailPreview
                    subject={draft.subject}
                    content={draft.content}
                    language={tab === "default" ? source : tab}
                />
            ) : (
                <details>
                    <summary>预览当前语言</summary>
                    <h3>{draft.subject}</h3>
                    <Html markdown value={draft.content} />
                </details>
            )}
            {error && <p role="alert">{error}</p>}
            <button className="primary" type="submit" disabled={busy}>
                {busy
                    ? "正在处理…"
                    : kind === "mail"
                      ? "加入发送队列"
                      : "保存公告"}
            </button>
        </form>
    );
}
