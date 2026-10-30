import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
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
    preview = false,
    compact = false,
}: {
    preview?: boolean;
    compact?: boolean;
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
    const scope = `${embedded}\0${device}\0${page}\0${preview}\0${address}`;
    const initial = { scope, copied: false, failed: false, manual: false, busy: false };
    const [feedback, setFeedback] = useState(initial);
    const { copied, failed, manual, busy } = feedback.scope === scope ? feedback : initial;
    const copying = useRef<{ scope: string; attempt: symbol } | null>(null);
    const currentScope = useRef(scope);
    currentScope.current = scope;
    const mounted = useRef(true);
    const addressInput = useRef<HTMLInputElement>(null);
    const focusRequested = useRef("");
    const headingId = useId();
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            copying.current = null;
        };
    }, []);
    useEffect(() => {
        if (manual && focusRequested.current === scope) {
            addressInput.current?.focus();
            addressInput.current?.select();
            focusRequested.current = "";
        }
    }, [manual, busy, scope]);
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
    const mobile = device === "ios" || device === "android";
    const Container = compact || preview ? "div" : "main";
    const Heading = compact || preview ? "h2" : "h1";
    function track(action: Parameters<NonNullable<typeof onAction>>[0]) {
        if (preview) return;
        // Telemetry must not interrupt copying or the user's navigation.
        try { onAction(action, page); } catch {}
    }
    function update(values: Partial<typeof initial>) {
        setFeedback(previous => ({ ...(previous.scope === scope ? previous : initial), ...values }));
    }
    async function copyAddress() {
        if (!address || copying.current?.scope === scope) return;
        const attempt = Symbol();
        copying.current = { scope, attempt };
        const focusBefore = document.activeElement;
        const current = () => mounted.current && currentScope.current === scope && copying.current?.attempt === attempt;
        update({ busy: true, copied: false, failed: false });
        try {
            if (!preview) await copy(address);
            if (!current()) return;
            update({ copied: true, busy: false });
            track("copy_success");
        } catch {
            if (!current()) return;
            if (document.activeElement === focusBefore) focusRequested.current = scope;
            update({ failed: true, manual: true, busy: false });
            track("copy_failed");
        } finally {
            if (copying.current?.attempt === attempt) copying.current = null;
        }
    }
    return (
        <Container
            className={`browser-notice${compact ? " browser-notice-compact" : " browser-notice-entry"}`}
            lang={language}
            dir={language ? (language === "fa-IR" ? "rtl" : "ltr") : undefined}
        >
            {!compact && <div className="browser-notice-brand">
                <Sparkles size={19} aria-hidden="true" />
                <strong>{title}</strong>
                {languagePicker}
            </div>}
            <section
                className="browser-notice-card"
                aria-labelledby={headingId}
            >
                <span className="browser-context">
                    {e("browserHelp", { app })}
                </span>
                <Heading className="browser-notice-heading" id={headingId}>{e(compact ? "browserTitle" : "browserEntryTitle")}</Heading>
                <p className="browser-intro">{e(compact ? "browserReason" : "browserEntryIntro")}</p>
                {!compact && onContinue && <p className="browser-entry-choice">{e("browserEntryPrompt")}</p>}
                <div className="browser-copy-actions">
                    <button
                        type="button"
                        className="primary browser-copy"
                        disabled={busy || !address}
                        aria-busy={busy}
                        onClick={copyAddress}
                    >
                        {copied && !preview ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
                        {copied && !preview ? tx("已复制") : e("copyAddress")}
                    </button>
                    <div className="browser-copy-feedback" role="status" aria-live="polite" aria-atomic="true">
                        {copied && <p className="browser-copy-success">{e(preview ? "browserPreviewCopied" : "browserCopied")}</p>}
                        {failed && <p className="browser-copy-error">{e("browserCopyHelp")}</p>}
                        {!address && <p className="browser-copy-error">{e("browserCopyUnavailable")}</p>}
                    </div>
                    {onContinue && (
                        <button type="button" className="browser-continue" onClick={() => {
                            track("guide_continue");
                            onContinue();
                        }}>{e("browserContinue")}</button>
                    )}
                    {address && !manual && <button type="button" className="browser-manual" onClick={() => {
                        focusRequested.current = scope;
                        update({ manual: true });
                        track("guide_manual");
                    }}>{e("browserManual")}</button>}
                    {address && manual && <label className="browser-manual-address">
                        <span>{e("copyAddress")}</span>
                        <input ref={addressInput} aria-label={e("copyAddress")} value={address} readOnly dir="ltr"
                            onFocus={event => event.target.select()} />
                    </label>}
                </div>
                <ol className="browser-instructions">
                    <li>
                        <span className="browser-step-number">1</span>
                        <div>
                            <h2>{e(mobile ? "browserMenu" : "copyAddress")}</h2>
                            <p>{e(mobile ? embedded === "Other" ? "browserMenuUnknown" : "browserMenuDetail" : "browserPaste")}</p>
                        </div>
                        {mobile ? <MoreHorizontal size={22} aria-hidden="true" /> : <Copy size={20} aria-hidden="true" />}
                    </li>
                    <li>
                        <span className="browser-step-number">2</span>
                        <div>
                            <h2>{e(mobile ? "browserChoose" : "browserOpenCopied")}</h2>
                            <p className="browser-device-help">
                                {e(
                                    device === "ios"
                                        ? "browserIos"
                                        : device === "android"
                                          ? "browserAndroid"
                                          : "browserExternalStep",
                                )}
                            </p>
                        </div>
                        <ExternalLink size={19} aria-hidden="true" />
                    </li>
                </ol>
                {compact && <p className="browser-session-note">{e("browserSessionNote")}</p>}
            </section>
        </Container>
    );
}
