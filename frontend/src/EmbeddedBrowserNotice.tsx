import { useState } from "react";
import { Smartphone, Copy, Check, ArrowUpRight } from "lucide-react";
import { currentDevice } from "./user-experience";
import { e } from "./experience-copy";
import { tx } from "./i18n";
export function EmbeddedBrowserNotice() {
    const { embedded } = currentDevice();
    const [copied, setCopied] = useState(false),
        [failed, setFailed] = useState(false);
    if (!embedded) return null;
    return (
        <main className="browser-notice">
            <div className="browser-notice-card">
                <span className="notice-symbol">
                    <Smartphone size={32} />
                    <ArrowUpRight size={23} />
                </span>
                <h1>{e("browserTitle")}</h1>
                <p>
                    {e("browserHelp", {
                        app: e(
                            embedded === "WeChat"
                                ? "wechat"
                                : embedded === "QQ"
                                  ? "qq"
                                  : "weibo",
                        ),
                    })}
                </p>
                <p className="muted">{e("browserReason")}</p>
                <button
                    className="primary"
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(location.href);
                            setCopied(true);
                            setFailed(false);
                        } catch {
                            setFailed(true);
                        }
                    }}
                >
                    {copied ? <Check size={18} /> : <Copy size={18} />}{" "}
                    {copied ? tx("已复制") : e("copyAddress")}
                </button>
                {failed && (
                    <p role="status">{tx("复制失败，请手动复制链接")}</p>
                )}
                <input
                    aria-label={e("copyAddress")}
                    value={location.href}
                    readOnly
                    dir="ltr"
                    onFocus={(event) => event.target.select()}
                />
            </div>
        </main>
    );
}
