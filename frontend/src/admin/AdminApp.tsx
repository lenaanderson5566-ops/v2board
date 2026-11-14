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
import { setAdminSessionLanguage } from "../shared/i18n";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import { setWorkspaceAccessDocument } from "../shared/runtime-config";
import { WorkspaceAccess } from "./WorkspaceAccess";
import "./admin-shell-experience.css";

export default function AdminApp() {
    const [route, setRoute] = useState(() => location.hash.slice(2));
    const path = route.split("?", 1)[0];
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
        if (!next) {
            setWorkspaceAccessDocument();
            void setAdminSessionLanguage(false);
        }
        setUser(next);
    }
    async function enterWorkspace(next: Row, isCurrent = () => true) {
        const epoch = sessionEpoch.current;
        const current = () => sessionEpoch.current === epoch && isCurrent();
        await setAdminSessionLanguage(true, current);
        if (!current()) return false;
        updateUser(next);
        return true;
    }
    async function logout() {
        if (loggingOut.current) return;
        loggingOut.current = true;
        try {
            await logoutSession();
        } catch {
            setError("Sign-out is incomplete. Reconnect and try again.");
        } finally {
            updateUser(null);
            navigate("login");
            loggingOut.current = false;
        }
    }
    useEffect(() => {
        document.body.classList.remove("admin-dark");
        try {
            localStorage.removeItem("fastai.admin.dark");
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
                    ':is(.admin-content, .modal) :is([data-saving="true"], form[aria-busy="true"])',
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
            setRoute(location.hash.slice(2));
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
                    await enterWorkspace(result.data, current);
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
            <WorkspaceAccess>
                <p className="workspace-access-loading" role="status">
                    <span className="spinner" aria-hidden="true" />
                    Checking your session…
                </p>
            </WorkspaceAccess>
        );
    if (sessionError)
        return (
            <WorkspaceAccess>
                <section
                    aria-labelledby="admin-recovery-title"
                    aria-busy={loading}
                >
                    <h1 id="admin-recovery-title" tabIndex={-1}>
                        This page could not load
                    </h1>
                    <p role="alert">
                        Check your connection and try again.
                    </p>
                    <button
                        type="button"
                        className="workspace-access-submit"
                        disabled={loading || retryIn > 0}
                        onClick={() => {
                            if (retrying.current || retryIn > 0) return;
                            retrying.current = true;
                            setSessionAttempt((value) => value + 1);
                        }}
                    >
                        {loading
                            ? "Checking…"
                            : retryIn > 0
                              ? `Retry in ${retryIn}s`
                              : "Retry"}
                    </button>
                </section>
            </WorkspaceAccess>
        );
    if (!user)
        return (
            <AdminAuth key={path} mode={path} notice={error} onLogin={enterWorkspace} />
        );
    return <AdminWorkspace path={route} user={user} logout={logout} />;
}
