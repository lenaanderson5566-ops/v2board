import { useEffect, useRef, useState } from "react";
import { ShieldCheck, MonitorSmartphone } from "lucide-react";
import { request, type Row } from "../shared/api";
import { tx } from "../shared/i18n";
import { useRetryCountdown } from "../shared/use-retry-countdown";
import type {
    V10ClientAuthorizationDetails,
    V10ClientAuthorizationApproval,
} from "../shared/v10-types";

export function clientCallback(value: string): string {
    const uri = new URL(value);
    const desktop =
        uri.protocol === "http:" &&
        uri.hostname === "127.0.0.1" &&
        Number(uri.port) >= 1024 &&
        uri.pathname === "/fastai-auth/callback";
    const mobile =
        uri.protocol === "ws.fastdog.fastai:" &&
        uri.hostname === "oauth" &&
        uri.pathname === "/callback" &&
        !uri.port;
    if (
        (!desktop && !mobile) ||
        uri.username ||
        uri.password ||
        uri.hash ||
        !/^[a-f0-9]{64}$/.test(uri.searchParams.get("code") || "") ||
        !/^[A-Za-z0-9_-]{43}$/.test(uri.searchParams.get("state") || "") ||
        [...uri.searchParams].length !== 2
    )
        throw new Error(tx("授权响应无效，请返回 App 重试。"));
    return uri.href;
}

export default function ClientAuthorization({ user }: { user: Row }) {
    const readId = () => new URLSearchParams(location.hash.split("?")[1]).get("authorizationId") || "";
    const [id, setId] = useState(readId);
    const currentId = useRef(id);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        const changed = () => {
            const nextId = readId();
            if (currentId.current !== nextId) revision.current += 1;
            currentId.current = nextId;
            setId(nextId);
        };
        window.addEventListener("hashchange", changed);
        return () => { mounted.current = false; window.removeEventListener("hashchange", changed); };
    }, []);
    const [details, setDetails] =
        useState<V10ClientAuthorizationDetails | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [recoverable, setRecoverable] = useState(false);
    const [retryAt, setRetryAt] = useState(0);
    const [version, setVersion] = useState(0);
    const retryIn = useRetryCountdown(retryAt);
    const [callback, setCallback] = useState("");
    const submitting = useRef(false);
    const querying = useRef(false);
    const revision = useRef(0);
    const unavailable = () => tx("authorizationUnavailable", {
        ns: "experience",
        defaultValue: "This sign-in request is no longer available. Return to the app to check its sign-in status or start a new request.",
    });
    function showFailure(reason: unknown) {
        const problem = reason as { status?: number; code?: string; retryAfter?: number } | null;
        const terminal = [400, 403, 404, 410, 422].includes(Number(problem?.status)) ||
            ["CLIENT_AUTH_EXPIRED", "CLIENT_AUTH_INVALID", "INVALID_CLIENT_REDIRECT"].includes(problem?.code || "");
        setDetails(null);
        setRecoverable(!terminal);
        setError(terminal ? unavailable() : tx("authorizationRetryHelp", {
            ns: "experience",
            defaultValue: "The sign-in request status could not be confirmed. Check your connection and query the request again before confirming.",
        }));
        const delay = Number(problem?.retryAfter);
        setRetryAt(Number(problem?.status) === 429
            ? Date.now() + (Number.isFinite(delay) ? Math.max(1, delay) : 60) * 1000 : 0);
    }
    useEffect(() => {
        let active = true;
        const requestRevision = ++revision.current;
        querying.current = true;
        setLoading(true);
        setDetails(null);
        setError("");
        setRecoverable(false);
        setRetryAt(0);
        setCallback("");
        if (!/^[a-f0-9]{64}$/.test(id)) {
            setError(tx("授权已过期，请返回 App 重新登录。"));
            setLoading(false);
            querying.current = false;
            return;
        }
        request<V10ClientAuthorizationDetails>(
            "user/client-authorization?authorization_id=" + id,
        )
            .then(({ data }) => {
                if (!data || !["windows", "macos", "linux", "android"].includes(data.platform || ""))
                    throw new Error("Invalid authorization details");
                if (active && currentId.current === id && revision.current === requestRevision) setDetails(data);
            })
            .catch((reason: unknown) => {
                if (active && currentId.current === id && revision.current === requestRevision) showFailure(reason);
            })
            .finally(() => {
                if (active && revision.current === requestRevision) {
                    querying.current = false;
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [id, version]);
    function recheck() {
        if (querying.current || submitting.current || retryIn > 0) return;
        querying.current = true;
        setVersion((value) => value + 1);
    }
    async function approve() {
        if (submitting.current || loading || !details || error || retryIn > 0) return;
        submitting.current = true;
        const requestRevision = revision.current;
        setBusy(true);
        setError("");
        try {
            const { data } = await request<V10ClientAuthorizationApproval>(
                "user/client-authorization/approve",
                { authorization_id: id },
            );
            if (!mounted.current || currentId.current !== id || revision.current !== requestRevision) return;
            let target: string;
            try {
                target = clientCallback(data.callbackUrl || "");
            } catch {
                setDetails(null);
                setRecoverable(false);
                setError(tx("授权响应无效，请返回 App 重试。"));
                return;
            }
            setCallback(target);
            history.replaceState(
                null,
                "",
                location.pathname + "#/client-authorize",
            );
            try {
                location.assign(target);
            } catch {
                // The validated callback remains available for an explicit return attempt.
                setError(tx("请返回 FastAI 完成登录。若客户端未自动打开，可点击下方按钮继续。"));
            }
        } catch (reason) {
            if (mounted.current && currentId.current === id && revision.current === requestRevision) showFailure(reason);
        } finally {
            submitting.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    return (
        <main className="client-authorization">
            <section className="panel client-authorization-card">
                <div className="client-authorization-mark">
                    <ShieldCheck size={32} aria-hidden="true" />
                </div>
                <div className="client-authorization-eyebrow">
                    FastAI · {tx("安全登录")}
                </div>
                <h1>{tx(callback ? "授权完成" : "登录 FastAI")}</h1>
                <p>
                    {tx(
                        callback
                            ? "请返回 FastAI 完成登录。若客户端未自动打开，可点击下方按钮继续。"
                            : "确认使用当前帐号登录你刚刚打开的 FastAI。",
                    )}
                </p>
                {!callback && (
                    <>
                        <div className="client-authorization-account">
                            <strong>{user.email}</strong>
                            <span>
                                <MonitorSmartphone
                                    size={16}
                                    aria-hidden="true"
                                />{" "}
                                FastAI · {details?.platform || "—"}
                            </span>
                        </div>
                        <p className="muted">
                            {tx("仅在你主动发起 App 登录时批准此请求。")}
                        </p>
                    </>
                )}
                {error && (
                    <div className="alert" role="alert">
                        {error}
                    </div>
                )}
                {loading && <p role="status">{tx("正在加载…")}</p>}
                {callback ? (
                    <a className="btn primary" href={callback}>
                        {tx("返回 FastAI")}
                    </a>
                ) : (
                    <button
                        className="btn primary"
                        disabled={busy || loading || retryIn > 0 || (!recoverable && (!details || !!error))}
                        onClick={recoverable ? recheck : approve}
                    >
                        {busy ? tx("正在授权…") : loading ? tx("正在加载…")
                            : retryIn > 0 ? tx("retryIn", { ns: "pricing", seconds: retryIn })
                              : recoverable ? tx("authorizationRecheck", {
                                  ns: "experience", defaultValue: "Check request status",
                              }) : tx("确认登录")}
                    </button>
                )}
                {!callback && (
                    <button
                        className="btn"
                        disabled={busy}
                        onClick={() => location.assign("#/dashboard")}
                    >
                        {tx("取消")}
                    </button>
                )}
                <div className="client-authorization-footer">
                    {tx("FastDog 提供技术支持")}
                </div>
            </section>
        </main>
    );
}
