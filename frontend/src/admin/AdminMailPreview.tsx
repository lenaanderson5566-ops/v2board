import { useEffect, useState } from "react";
import "./admin-mail.css";
import { admin, request } from "../shared/api";
export const mailLanguages = {
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    "en-US": "English",
    "ja-JP": "日本語",
    "ko-KR": "한국어",
    "vi-VN": "Tiếng Việt",
    "ru-RU": "Русский",
    "fa-IR": "فارسی",
};
const templates = {
    verify: "验证码",
    mailLogin: "登录链接",
    remindTraffic: "用量提醒",
    remindExpire: "订阅到期",
    emailInvitation: "邮件邀请",
    ticketReply: "工单回复",
    test: "测试邮件",
    notify: "自定义通知",
};
export function AdminMailPreview({
    subject,
    content,
    language: fixedLanguage,
}: {
    subject?: string;
    content?: string;
    language?: string;
}) {
    const [language, setLanguage] = useState("zh-CN");
    const [template, setTemplate] = useState("verify");
    const [preview, setPreview] = useState<{
        subject: string;
        html: string;
        text: string;
    }>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [plain, setPlain] = useState(false);
    const custom = subject !== undefined;
    useEffect(() => { setPreview(undefined); }, [subject, content, fixedLanguage]);
    return (
        <section className="mail-preview">
            <h3>邮件预览</h3>
            <p className="muted">
                使用已保存的站点名称。预览不会发送邮件，验证码及回复内容为示例。
            </p>
            <div className="toolbar">
                {!custom && (
                    <label>
                        邮件类型{" "}
                        <select
                            value={template}
                            onChange={(e) => {
                                setTemplate(e.target.value);
                                setPreview(undefined);
                            }}
                        >
                            {Object.entries(templates).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {!fixedLanguage && (
                    <label>
                        邮件语言{" "}
                        <select
                            value={language}
                            onChange={(e) => {
                                setLanguage(e.target.value);
                                setPreview(undefined);
                            }}
                        >
                            {Object.entries(mailLanguages).map(
                                ([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ),
                            )}
                        </select>
                    </label>
                )}
                <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                        setBusy(true);
                        setError("");
                        setPreview(undefined);
                        try {
                            const result = await request<{
                                subject: string;
                                html: string;
                                text: string;
                            }>(admin("config/previewMail"), {
                                template: custom ? "notify" : template,
                                language: fixedLanguage || language,
                                subject,
                                content,
                            });
                            setPreview(result.data);
                        } catch (e) {
                            setError((e as Error).message);
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    {busy ? "正在生成…" : "生成预览"}
                </button>
            </div>
            {error && <p role="alert">{error}</p>}
            {preview && (
                <div>
                    <p>
                        <strong>{preview.subject}</strong>
                    </p>
                    <label className="mail-preview-mode">
                        <input
                            type="checkbox"
                            checked={plain}
                            onChange={(e) => setPlain(e.target.checked)}
                        />
                        纯文本版本
                    </label>
                    {plain ? (
                        <pre style={{ whiteSpace: "pre-wrap" }}>
                            {preview.text}
                        </pre>
                    ) : (
                        <iframe
                            title="邮件内容预览"
                            sandbox=""
                            referrerPolicy="no-referrer"
                            srcDoc={preview.html}
                            style={{
                                width: "100%",
                                height: 520,
                                border: "1px solid #e6e6e6",
                                borderRadius: 16,
                                marginTop: 16,
                            }}
                        />
                    )}
                </div>
            )}
        </section>
    );
}
