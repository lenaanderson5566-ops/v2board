import {
    initializeBrowserSession,
    hasBrowserSession,
} from "../shared/browser-session";
import "../shared/style.css";
import "../shared/console.css";
import "./admin.css";
import "./admin-surfaces.css";
import { useEffect, useRef, useState } from "react";
import { AdminAuth } from "./AdminAuth";
import AdminWorkspace from "./admin-workspace";
import {
    boot,
    request,
    navigate,
    logoutSession,
    type Row,
} from "../shared/api";
import { tx } from "../shared/i18n";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import "./admin-shell-experience.css";

export default function AdminApp() {
    const [path, setPath] = useState(
        location.hash.slice(2).split("?")[0] || "",
    );
    const [user, setUser] = useState<Row | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [sessionError, setSessionError] = useState(false);
    const [sessionAttempt, setSessionAttempt] = useState(0);
    const [retryAt, setRetryAt] = useState(0);
    const retryIn = useRetryCountdown(retryAt);
    const sessionEpoch = useRef(0);
    const retrying = useRef(false);
    const loggingOut = useRef(false);
    const authenticated = useRef(false);
    function updateUser(next: Row | null) {
        sessionEpoch.current += 1;
        setSessionError(false);
        setLoading(false);
        retrying.current = false;
        authenticated.current = next !== null;
        setUser(next);
    }
    async function logout() {
        if (loggingOut.current) return;
        loggingOut.current = true;
        try {
            await logoutSession();
        } catch (reason) {
            setError(
                reason instanceof Error
                    ? reason.message
                    : "退出未完成，请联网后重试。",
            );
        } finally {
            updateUser(null);
            navigate("login");
            loggingOut.current = false;
        }
    }
    useEffect(() => {
        document.body.classList.remove("admin-dark");
        try {
            localStorage.removeItem("v2board.admin.dark");
        } catch {
            /* Optional preference cleanup. */
        }
        let acceptedUrl = location.href;
        let expiring = false;
        const changed = () => {
            if (location.href === acceptedUrl) return;
            if (
                !expiring &&
                authenticated.current &&
                !loggingOut.current &&
                document.querySelector(
                    '.admin-content [data-saving="true"], .admin-content form[aria-busy="true"]',
                )
            ) {
                history.replaceState(history.state, "", acceptedUrl);
                return;
            }
            if (
                !expiring &&
                authenticated.current &&
                !loggingOut.current &&
                document.querySelector('[data-unsaved="true"]') &&
                !window.confirm("有尚未保存的修改，确认离开当前页面？")
            ) {
                history.replaceState(history.state, "", acceptedUrl);
                return;
            }
            expiring = false;
            acceptedUrl = location.href;
            setPath(location.hash.slice(2).split("?")[0] || "");
        };
        const expired = () => {
            expiring = true;
            updateUser(null);
            navigate("login");
        };
        window.addEventListener("hashchange", changed);
        window.addEventListener("auth-expired", expired);
        return () => {
            window.removeEventListener("hashchange", changed);
            window.removeEventListener("auth-expired", expired);
        };
    }, []);
    useEffect(() => {
        let live = true;
        const epoch = ++sessionEpoch.current;
        const current = () => live && sessionEpoch.current === epoch;
        retrying.current = true;
        setLoading(true);
        void (async () => {
            try {
                await initializeBrowserSession();
                if (!current()) return;
                if (!hasBrowserSession()) {
                    updateUser(null);
                    return;
                }
                const result = await request("user/info");
                if (!current()) return;
                await request(`${boot.adminPath}/config/fetch`);
                if (current()) {
                    setError("");
                    setRetryAt(0);
                    updateUser(result.data);
                }
            } catch (cause) {
                if (!current()) return;
                const problem = cause as {
                    status?: number;
                    code?: string;
                    retryAfter?: number;
                };
                if (
                    [401, 403].includes(Number(problem.status)) ||
                    problem.code === "SESSION_CHANGED"
                ) {
                    updateUser(null);
                } else {
                    setSessionError(true);
                    setLoading(false);
                    const seconds = Number(problem.retryAfter);
                    setRetryAt(
                        problem.status === 429
                            ? Date.now() +
                                  (Number.isFinite(seconds)
                                      ? Math.max(1, seconds)
                                      : 60) *
                                      1000
                            : 0,
                    );
                    retrying.current = false;
                }
            }
        })();
        return () => {
            live = false;
        };
    }, [sessionAttempt]);
    useEffect(() => {
        if (sessionError)
            document.getElementById("admin-recovery-title")?.focus();
    }, [sessionError]);
    if (loading && !sessionError)
        return (
            <div className="state full">
                <span className="spinner" />
                {tx("正在加载工作空间…")}
            </div>
        );
    if (sessionError)
        return (
            <main className="admin-session-recovery">
                <section
                    aria-labelledby="admin-recovery-title"
                    aria-busy={loading}
                >
                    <h1 id="admin-recovery-title" tabIndex={-1}>
                        {tx("页面暂时无法加载")}
                    </h1>
                    <p role="alert">
                        {tx("accountLoadFailed", { ns: "experience" })}
                    </p>
                    <button
                        type="button"
                        className="primary"
                        disabled={loading || retryIn > 0}
                        onClick={() => {
                            if (retrying.current || retryIn > 0) return;
                            retrying.current = true;
                            setSessionAttempt((value) => value + 1);
                        }}
                    >
                        {loading
                            ? tx("正在加载…")
                            : retryIn > 0
                              ? tx("retryIn", {
                                    ns: "pricing",
                                    seconds: retryIn,
                                })
                              : tx("重试")}
                    </button>
                </section>
            </main>
        );
    if (!user)
        return (
            <>
                {error && <div className="alert">{error}</div>}
                <AdminAuth key={path} mode={path} onLogin={updateUser} />
            </>
        );
    return <AdminWorkspace path={path} user={user} logout={logout} />;
}
