import { useRef, useState } from "react";
import {
    Compass,
    Copy,
    Check,
    MoreHorizontal,
    ExternalLink,
    Sparkles,
} from "lucide-react";
import { currentDevice } from "../shared/user-experience";
import { e } from "../shared/experience-copy";
import { tx } from "../shared/i18n";
import { boot } from "../shared/api";
export function EmbeddedBrowserNotice() {
    const { embedded } = currentDevice();
    const [copied, setCopied] = useState(false),
        [failed, setFailed] = useState(false),
        [manual, setManual] = useState(false),
        [busy, setBusy] = useState(false);
    const copying = useRef(false);
    if (!embedded) return null;
    const app = e(
        embedded === "WeChat" ? "wechat" : embedded === "QQ" ? "qq" : "weibo",
    );
    async function copyAddress() {
        if (copying.current) return;
        copying.current = true;
        setBusy(true);
        setCopied(false);
        setFailed(false);
        try {
            await navigator.clipboard.writeText(location.href);
            setCopied(true);
        } catch {
            setFailed(true);
            setManual(true);
        } finally {
            copying.current = false;
            setBusy(false);
        }
    }
    return (
        <main className="browser-notice">
            <div className="browser-notice-brand">
                <Sparkles size={19} aria-hidden="true" />
                <strong>{boot.title}</strong>
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
                            <p>{e("browserChooseDetail")}</p>
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
                            onClick={() => setManual(true)}
                        >
                            {e("browserManual")}
                        </button>
                    )}
                    {manual && (
                        <label className="browser-manual-address">
                            <span>{e("copyAddress")}</span>
                            <input
                                aria-label={e("copyAddress")}
                                value={location.href}
                                readOnly
                                dir="ltr"
                                onFocus={(event) => event.target.select()}
                            />
                        </label>
                    )}
                </div>
            </section>
        </main>
    );
}
