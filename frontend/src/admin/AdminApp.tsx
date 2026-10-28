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

export default function AdminApp() {
    const [path, setPath] = useState(
        location.hash.slice(2).split("?")[0] || "",
    );
    const [user, setUser] = useState<Row | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const loggingOut = useRef(false);
    const authenticated = useRef(false);
    function updateUser(next: Row | null) {
        authenticated.current = next !== null;
        setUser(next);
    }
    async function logout() {
        if (loggingOut.current) return;
        loggingOut.current = true;
        try {
            await logoutSession();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "退出未完成，请联网后重试。");
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
        let live = true;
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
        {
            initializeBrowserSession()
                .then(() => (hasBrowserSession() ? request("user/info") : null))
                .then(async (result) => {
                    if (!result) return;
                    await request(`${boot.adminPath}/config/fetch`);
                    if (live) updateUser(result.data);
                })
                .catch((error) => {
                    if (live) {
                        setError(error.message);
                    }
                })
                .finally(() => {
                    if (live) setLoading(false);
                });
        }
        return () => {
            live = false;
            window.removeEventListener("hashchange", changed);
            window.removeEventListener("auth-expired", expired);
        };
    }, []);
    if (loading)
        return (
            <div className="state full">
                <span className="spinner" />
                {tx("正在加载工作空间…")}
            </div>
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
