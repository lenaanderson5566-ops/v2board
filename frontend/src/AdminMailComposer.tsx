import { useState } from "react";
import { AdminMailPreview, mailLanguages } from "./AdminMailPreview";
import type { Row } from "./api";
export function AdminMailComposer({
    confirmed,
    onSave,
}: {
    confirmed: boolean;
    onSave: (body: Row) => Promise<void>;
}) {
    const [tab, setTab] = useState("default");
    const [drafts, setDrafts] = useState<
        Record<string, { subject: string; content: string }>
    >({ default: { subject: "", content: "" } });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const draft = drafts[tab] || { subject: "", content: "" };
    const edit = (key: "subject" | "content", value: string) =>
        setDrafts({ ...drafts, [tab]: { ...draft, [key]: value } });
    return (
        <form
            className="mail-composer"
            onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                if (!confirmed) {
                    setError("请先确认操作范围和人数");
                    return;
                }
                const translations: Row = {};
                for (const [key, value] of Object.entries(drafts)) {
                    if (
                        key !== "default" &&
                        !value.subject.trim() &&
                        !value.content.trim()
                    )
                        continue;
                    if (!value.subject.trim() || !value.content.trim()) {
                        setError("默认邮件及已填写的语言版本都需要主题和正文");
                        return;
                    }
                    if (key !== "default") translations[key] = value;
                }
                setBusy(true);
                try {
                    await onSave({ ...drafts.default, translations });
                } catch (e) {
                    setError((e as Error).message);
                } finally {
                    setBusy(false);
                }
            }}
        >
            <p className="muted">
                按用户保存的语言选择版本；未填写的语言使用默认主题和正文。系统不会自动翻译正文。仅保留基础文字格式及
                HTTP(S) 链接。
            </p>
            <label>
                编辑语言
                <select value={tab} onChange={(e) => setTab(e.target.value)}>
                    <option value="default">默认正文（必填）</option>
                    {Object.entries(mailLanguages).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                邮件主题
                <input
                    maxLength={200}
                    value={draft.subject}
                    onChange={(e) => edit("subject", e.target.value)}
                />
            </label>
            <label>
                邮件正文 HTML
                <textarea
                    rows={8}
                    maxLength={100000}
                    value={draft.content}
                    onChange={(e) => edit("content", e.target.value)}
                />
            </label>
            <AdminMailPreview
                subject={draft.subject}
                content={draft.content}
                language={tab === "default" ? undefined : tab}
            />
            {error && <p role="alert">{error}</p>}
            <button type="submit" disabled={busy}>
                {busy ? "正在加入队列…" : "加入发送队列"}
            </button>
        </form>
    );
}
