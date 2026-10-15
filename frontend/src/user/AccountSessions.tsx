import { LogOut } from "lucide-react";
import { useRef, useState } from "react";
import { request, date, clearReadCache, type Row } from "../shared/api";
import { forgetBrowserSession } from "../shared/browser-session";
import { tx, locale } from "../shared/i18n";
import { Modal, State, Table, useData } from "../shared/ui";
export function AccountSessions() {
    const [allOpen, setAllOpen] = useState(false);
    const allLock = useRef(false);
    async function removeAll() {
        if (allLock.current || removing !== null) return;
        allLock.current = true;
        setRemoving("all");
        setError("");
        try {
            await request("user/logoutAll", {});
            clearReadCache();
            forgetBrowserSession();
            window.dispatchEvent(new Event("auth-expired"));
        } catch (problem) {
            setError((problem as Error).message);
        } finally {
            allLock.current = false;
            setRemoving(null);
        }
    }
    const sessions = useData<Row[]>("user/getActiveSession");
    const [error, setError] = useState("");
    const [removing, setRemoving] = useState<string | null>(null);
    const [selected, setSelected] = useState<Row | null>(null);
    async function remove() {
        if (!selected || removing) return;
        setRemoving(String(selected.id));
        setError("");
        try {
            await request("user/removeActiveSession", {
                session_id: selected.id,
            });
            setSelected(null);
            clearReadCache();
            if (selected.current) {
                forgetBrowserSession();
                window.dispatchEvent(new Event("auth-expired"));
            } else sessions.reload();
        } catch (problem) {
            setError((problem as Error).message);
        } finally {
            setRemoving(null);
        }
    }
    return (
        <section className="settings-section">
            {error && !selected && !allOpen && (
                <p role="alert" className="alert">
                    {error}
                </p>
            )}
            <div className="security-section-heading">
                <h2>{tx("登录设备")}</h2>
                <button
                    className="danger"
                    disabled={
                        removing !== null ||
                        sessions.loading ||
                        !!sessions.error
                    }
                    onClick={() => {
                        setError("");
                        setAllOpen(true);
                    }}
                >
                    {tx("退出全部会话")}
                </button>
            </div>
            <div className="settings-card">
                <p className="muted">
                    {tx(
                        "这里展示账号登录会话，不代表代理在线设备。同一设备可能有多个登录会话。",
                    )}
                </p>
                <p className="muted">
                    {tx("位置根据登录 IP 估算，可能显示代理出口所在地。")}
                </p>
                <State {...sessions}>
                    <Table
                        data={Object.entries(sessions.data || {})
                            .sort(
                                ([, a], [, b]) =>
                                    Number(b.current) - Number(a.current) ||
                                    Number(b.login_at) - Number(a.login_at),
                            )
                            .map(([id, value]) => ({ ...value, id }))}
                        columns={[
                            [
                                "ip",
                                tx("登录位置"),
                                (r) => (
                                    <span>
                                        <strong>
                                            {sessionCountry(r.country_code)}
                                        </strong>
                                        <br />
                                        <small dir="ltr">{r.ip || "—"}</small>
                                    </span>
                                ),
                            ],
                            [
                                "ua",
                                tx("客户端"),
                                (r) => (
                                    <span title={r.ua}>
                                        {r.client_kind === "browser"
                                            ? tx("浏览器")
                                            : r.client_kind === "native"
                                              ? tx("应用客户端")
                                              : tx("客户端")}{" "}
                                        · {deviceName(r.ua)}
                                        {r.current && (
                                            <strong> · {tx("当前会话")}</strong>
                                        )}
                                    </span>
                                ),
                            ],
                            [
                                "login_at",
                                tx("登录时间"),
                                (r) => date(r.login_at),
                            ],
                        ]}
                        actions={(r) => (
                            <button
                                className="icon-button session-signout"
                                aria-label={tx("退出登录")}
                                title={tx("退出登录")}
                                disabled={removing !== null}
                                onClick={() => {
                                    setError("");
                                    setSelected(r);
                                }}
                            >
                                <LogOut size={20} aria-hidden="true" />
                            </button>
                        )}
                    />
                </State>
            </div>
            {allOpen && (
                <Modal
                    title={tx("退出全部会话")}
                    dismissible={removing === null}
                    close={() => {
                        if (removing === null) setAllOpen(false);
                    }}
                >
                    <div className="pad">
                        <p>
                            {tx(
                                "所有已登录的浏览器和 App 都需要重新登录，包括当前会话。订阅链接不变，已建立的代理连接不会因此立即断开。",
                            )}
                        </p>
                        {error && (
                            <p role="alert" className="alert">
                                {error}
                            </p>
                        )}
                        <div className="actions space">
                            <button
                                disabled={removing !== null}
                                onClick={() => setAllOpen(false)}
                            >
                                {tx("取消")}
                            </button>
                            <button
                                className="danger"
                                disabled={removing !== null}
                                onClick={removeAll}
                            >
                                {tx(removing ? "提交中…" : "确认退出全部会话")}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
            {selected && (
                <Modal
                    title={tx("退出登录")}
                    close={() => {
                        if (!removing) setSelected(null);
                    }}
                >
                    <div className="pad">
                        <p>
                            {tx(
                                "退出此登录会话后，该客户端需要重新登录。已建立的代理连接不会因此立即断开。",
                            )}
                        </p>
                        <p className="muted">
                            {deviceName(selected.ua)} · {selected.ip || "—"}
                        </p>
                        {error && (
                            <p className="alert" role="alert">
                                {error}
                            </p>
                        )}
                        <div className="actions space">
                            <button
                                disabled={removing !== null}
                                onClick={() => setSelected(null)}
                            >
                                {tx("取消")}
                            </button>
                            <button
                                className="primary"
                                disabled={removing !== null}
                                onClick={remove}
                            >
                                {tx(removing ? "提交中…" : "退出登录")}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </section>
    );
}

function deviceName(value: unknown): string {
    const ua = typeof value === "string" ? value : "";
    const app = ua.match(/FastAI[^\s]*/i)?.[0];
    const browser = /Edg\//.test(ua)
        ? "Edge"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
    const os = /Android/i.test(ua)
        ? "Android"
        : /iPhone|iPad/i.test(ua)
          ? "iOS"
          : /Windows|windows/i.test(ua)
            ? "Windows"
            : /Macintosh|macos/i.test(ua)
              ? "macOS"
              : /Linux/i.test(ua)
                ? "Linux"
                : "";
    return [app || browser, os].filter(Boolean).join(" / ") || tx("未知设备");
}

function sessionCountry(value: unknown): string {
    const code = typeof value === "string" ? value.toUpperCase() : "";
    if (!/^[A-Z]{2}$/.test(code)) return tx("位置未知");
    for (const language of [locale(), "en-US"]) {
        try {
            const name = new Intl.DisplayNames([language], {
                type: "region",
                fallback: "none",
            }).of(code);
            if (name) return name;
        } catch {
            /* Older browsers fall back to the country code. */
        }
    }
    return code;
}
