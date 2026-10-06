import "../../../public/assets/admin/res_002.css";
import "../../../public/assets/admin/res_004.css";
import "../shared/style.css";
import "../shared/console.css";
import "./admin-legacy.css";
import { useEffect, useRef, useState } from "react";
import { AdminAuth } from "./AdminAuth";
import AdminWorkspace from "./admin-workspace";
import {
    boot,
    request,
    storageKey,
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
    async function logout() {
        if (loggingOut.current) return;
        loggingOut.current = true;
        try {
            await logoutSession();
            setUser(null);
            navigate("login");
        } finally {
            loggingOut.current = false;
        }
    }
    useEffect(() => {
        let live = true;
        const changed = () =>
            setPath(location.hash.slice(2).split("?")[0] || "");
        const expired = () => {
            setUser(null);
            navigate("login");
        };
        window.addEventListener("hashchange", changed);
        window.addEventListener("auth-expired", expired);
        if (localStorage.getItem(storageKey)) {
            request("user/info")
                .then(async (result) => {
                    await request(`${boot.adminPath}/config/fetch`);
                    if (live) setUser(result.data);
                })
                .catch((error) => {
                    if (live) {
                        setError(error.message);
                        localStorage.removeItem(storageKey);
                    }
                })
                .finally(() => {
                    if (live) setLoading(false);
                });
        } else setLoading(false);
        return () => {
            live = false;
            window.removeEventListener("hashchange", changed);
            window.removeEventListener("auth-expired", expired);
        };
    }, []);
    useEffect(() => {
        if (path === "generate") navigate("users");
    }, [path]);
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
                <AdminAuth mode={path} onLogin={setUser} />
            </>
        );
    return <AdminWorkspace path={path} user={user} logout={logout} />;
}
