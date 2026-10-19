import { useTranslation } from "react-i18next";
import { useRef, useState, type ReactNode } from "react";
import {
    Compass,
    Copy,
    Check,
    MoreHorizontal,
    ExternalLink,
    Sparkles,
} from "lucide-react";
import { e as defaultExperience } from "../experience-copy";
import { tx as defaultText } from "../i18n";
import "./browser-notice.css";

export function BrowserNoticeView({
    onContinue,
    embedded,
    device,
    address,
    title,
    onAction = () => {},
    copy = async (value: string) => navigator.clipboard.writeText(value),
    languagePicker,
    translations,
    language,
}: {
    language?: string;
    translations?: {
        experience: Record<string, string>;
        translation: Record<string, string>;
    };
    onContinue?: () => void;
    embedded: string | null;
    device: string;
    address: string;
    title: string;
    onAction?: (
        action:
            "copy_success" | "copy_failed" | "guide_manual" | "guide_continue",
        page: "browser_prompt" | "browser_guide",
    ) => void;
    copy?: (value: string) => Promise<void>;
    languagePicker?: ReactNode;
}) {
    useTranslation();
    const e: typeof defaultExperience = (key, values) =>
        translations
            ? (translations.experience[key] || key).replace(
                  /{{\s*(\w+)\s*}}/g,
                  (_, name: string) => String(values?.[name] ?? ""),
              )
            : defaultExperience(key, values);
    const tx = (key: string) =>
        translations ? translations.translation[key] || key : defaultText(key);
    const page = onContinue ? "browser_prompt" : "browser_guide";
    const [copied, setCopied] = useState(false),
        [failed, setFailed] = useState(false),
        [manual, setManual] = useState(false),
        [busy, setBusy] = useState(false);
    const copying = useRef(false);
    if (!embedded) return null;
    const app =
        ([
            "xiaohongshu",
            "douyin",
            "bilibili",
            "alipay",
            "dingtalk",
            "wecom",
        ].includes(embedded)
            ? e(
                  embedded as
                      | "xiaohongshu"
                      | "douyin"
                      | "bilibili"
                      | "alipay"
                      | "dingtalk"
                      | "wecom",
              )
            : "") ||
        e(
            embedded === "WeChat"
                ? "wechat"
                : embedded === "QQ"
                  ? "qq"
                  : embedded === "Weibo"
                    ? "weibo"
                    : "browserOther",
        );
    async function copyAddress() {
        if (copying.current) return;
        copying.current = true;
        setBusy(true);
        setCopied(false);
        setFailed(false);
        try {
            await copy(address);
            setCopied(true);
            onAction("copy_success", page);
        } catch {
            setFailed(true);
            onAction("copy_failed", page);
            setManual(true);
        } finally {
            copying.current = false;
            setBusy(false);
        }
    }
    return (
        <main
            className="browser-notice"
            lang={language}
            dir={language ? (language === "fa-IR" ? "rtl" : "ltr") : undefined}
        >
            <div className="browser-notice-brand">
                <Sparkles size={19} aria-hidden="true" />
                <strong>{title}</strong>
                {languagePicker}
            </div>
            <section
                className="browser-notice-card"
                aria-labelledby="browser-notice-title"
            >
                <span className="browser-context">
                    {e("browserHelp", { app })}
                </span>
                <div className="notice-symbol">
                    <Compass size={30} aria-hidden="true" />
                </div>
                <h1 id="browser-notice-title">{e("browserTitle")}</h1>
                <p className="browser-intro">{e("browserReason")}</p>
                <ol className="browser-instructions">
                    <li>
                        <span className="browser-step-number">1</span>
                        <div>
                            <h2>{e("browserMenu")}</h2>
                            <p>{e("browserMenuDetail")}</p>
                        </div>
                        <MoreHorizontal size={22} aria-hidden="true" />
                    </li>
                    <li>
                        <span className="browser-step-number">2</span>
                        <div>
                            <h2>{e("browserChoose")}</h2>
                            <p className="browser-device-help">
                                {e(
                                    device === "ios"
                                        ? "browserIos"
                                        : device === "android"
                                          ? "browserAndroid"
                                          : "browserDesktop",
                                )}
                            </p>
                        </div>
                        <ExternalLink size={19} aria-hidden="true" />
                    </li>
                </ol>
                <div className="browser-alternative">
                    <h2>{e("browserAlternative")}</h2>
                    <p>{e("browserPaste")}</p>
                    <button
                        className="primary browser-copy"
                        disabled={busy}
                        aria-busy={busy}
                        onClick={copyAddress}
                    >
                        {copied ? (
                            <Check size={17} aria-hidden="true" />
                        ) : (
                            <Copy size={17} aria-hidden="true" />
                        )}
                        {copied ? tx("已复制") : e("copyAddress")}
                    </button>
                    <div role="status" aria-live="polite">
                        {copied && (
                            <p className="browser-copy-success">
                                {e("browserCopied")}
                            </p>
                        )}
                        {failed && (
                            <p className="browser-copy-error">
                                {e("browserCopyHelp")}
                            </p>
                        )}
                    </div>
                    {!manual && (
                        <button
                            className="browser-manual"
                            onClick={() => {
                                setManual(true);
                                onAction("guide_manual", page);
                            }}
                        >
                            {e("browserManual")}
                        </button>
                    )}
                    {manual && (
                        <label className="browser-manual-address">
                            <span>{e("copyAddress")}</span>
                            <input
                                aria-label={e("copyAddress")}
                                value={address}
                                readOnly
                                dir="ltr"
                                onFocus={(event) => event.target.select()}
                            />
                        </label>
                    )}
                </div>
                {onContinue && (
                    <button
                        type="button"
                        className="browser-continue"
                        onClick={() => {
                            onAction("guide_continue", page);
                            onContinue();
                        }}
                    >
                        {e("browserContinue")}
                    </button>
                )}
            </section>
        </main>
    );
}
