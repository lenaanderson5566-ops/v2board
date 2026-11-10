import { languages as languageOptions } from "../shared/language-options";
import { useMemo, useState } from "react";
import "./admin-mail.css";
import { admin, request } from "../shared/api";
export const mailLanguages = Object.fromEntries(
    languageOptions.map(({ code, name }) => [code, name]),
);
const templates = {
    verify: "验证码",
    mailLogin: "登录链接",
    remindTraffic: "额度提醒",
    serviceActivated: "服务开通成功",
    serviceRenewed: "服务续期成功",
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
    type Preview = {
        subject: string;
        html: string;
        text: string;
    };
    const custom = subject !== undefined;
    const selectedTemplate = custom ? "notify" : template;
    const selectedLanguage = fixedLanguage || language;
    const input = useMemo(() => ({
        template: selectedTemplate,
        language: selectedLanguage,
        subject,
        content,
    }), [selectedTemplate, selectedLanguage, subject, content]);
    const [result, setResult] = useState<{ input: typeof input; preview?: Preview; error?: string }>();
    // A slow response belongs to the selection that initiated it.
    const { preview, error } = result?.input === input ? result : {};
    const [busy, setBusy] = useState(false);
    const [plain, setPlain] = useState(false);
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
                            onChange={(e) => setTemplate(e.target.value)}
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
                            onChange={(e) => setLanguage(e.target.value)}
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
                        setResult(undefined);
                        try {
                            const response = await request<Preview>(admin("config/previewMail"), input);
                            setResult({ input, preview: response.data });
                        } catch (e) {
                            setResult({ input, error: (e as Error).message });
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
