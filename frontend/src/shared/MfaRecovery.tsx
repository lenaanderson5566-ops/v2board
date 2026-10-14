import { useTranslation } from "react-i18next";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Modal } from "./ui";
import { clearReadCache } from "./api";
import { forgetBrowserSession } from "./browser-session";
import { tx } from "./i18n";
import { Copy, Download, ShieldCheck } from "lucide-react";

const RecoveryContext = createContext<((codes: string[]) => void) | null>(null);
export function useMfaRecovery() {
    const complete = useContext(RecoveryContext);
    if (!complete) throw new Error("MFA recovery provider is required");
    return complete;
}

/** Lives above authentication views; one-time codes survive a session-expiry render. */
export function MfaRecoveryProvider({ children }: { children: ReactNode }) {
    useTranslation();
    const [codes, setCodes] = useState<string[] | null>(null),
        [saved, setSaved] = useState(false);
    const [notice, setNotice] = useState("");
    async function copy() {
        try {
            await navigator.clipboard.writeText(codes!.join("\n"));
            setNotice(tx("恢复码已复制，请保存在安全的位置。"));
        } catch {
            setNotice(tx("无法复制，请手动选中恢复码保存。"));
        }
    }
    function download() {
        const url = URL.createObjectURL(
            new Blob([codes!.join("\n") + "\n"], {
                type: "text/plain;charset=utf-8",
            }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "recovery-codes.txt";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function acknowledge() {
        if (codes?.length && !saved) return;
        setCodes(null);
        setSaved(false);
        clearReadCache();
        forgetBrowserSession();
        window.dispatchEvent(new Event("auth-expired"));
    }
    return (
        <RecoveryContext.Provider
            value={(next) => {
                setSaved(false);
                setNotice("");
                setCodes([...next]);
            }}
        >
            {children}
            {codes !== null && (
                <Modal
                    title={tx("安全验证已更新")}
                    close={acknowledge}
                    dismissible={!codes.length || saved}
                    className="mfa-recovery-dialog"
                >
                    <div className="pad mfa-security">
                        {codes.length > 0 && (
                            <>
                                <div className="mfa-emblem">
                                    <ShieldCheck size={28} aria-hidden="true" />
                                </div>
                                <h3>{tx("保存恢复码")}</h3>
                                <p>
                                    {tx(
                                        "恢复码只显示一次，每个只能使用一次。请保存在安全的位置，不要与密码放在一起。",
                                    )}
                                </p>
                                <textarea
                                    readOnly
                                    rows={10}
                                    aria-label={tx("恢复码")}
                                    value={codes.join("\n")}
                                    dir="ltr"
                                    autoComplete="off"
                                />
                                <div className="actions mfa-backup-actions">
                                    <button
                                        type="button"
                                        onClick={() => void copy()}
                                    >
                                        <Copy size={16} aria-hidden="true" />
                                        {tx("复制恢复码")}
                                    </button>
                                    <button type="button" onClick={download}>
                                        <Download
                                            size={16}
                                            aria-hidden="true"
                                        />
                                        {tx("下载恢复码")}
                                    </button>
                                </div>
                                {notice && <p role="status">{notice}</p>}
                                <label className="mfa-saved">
                                    <input
                                        type="checkbox"
                                        checked={saved}
                                        onChange={(event) =>
                                            setSaved(event.target.checked)
                                        }
                                    />
                                    {tx("我已安全保存恢复码")}
                                </label>
                            </>
                        )}
                        <p>{tx("其他登录会话已退出，请重新登录。")}</p>
                        <button
                            className="primary"
                            disabled={!!codes.length && !saved}
                            onClick={acknowledge}
                        >
                            {tx("重新登录")}
                        </button>
                    </div>
                </Modal>
            )}
        </RecoveryContext.Provider>
    );
}
