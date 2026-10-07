import { useEffect, useRef, useState } from "react";
import { ShieldCheck, MonitorSmartphone } from "lucide-react";
import { request, type Row } from "../shared/api";
import { tx } from "../shared/i18n";
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
    const [id] = useState(
        () =>
            new URLSearchParams(location.hash.split("?")[1]).get(
                "authorizationId",
            ) || "",
    );
    const [details, setDetails] =
        useState<V10ClientAuthorizationDetails | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [callback, setCallback] = useState("");
    const submitting = useRef(false);
    useEffect(() => {
        let active = true;
        if (!/^[a-f0-9]{64}$/.test(id)) {
            setError(tx("授权已过期，请返回 App 重新登录。"));
            return;
        }
        request<V10ClientAuthorizationDetails>(
            "user/client-authorization?authorization_id=" + id,
        )
            .then(({ data }) => {
                if (active) setDetails(data);
            })
            .catch((reason: Error & { code?: string }) => {
                if (active)
                    setError(
                        tx(
                            reason.code === "CLIENT_AUTH_EXPIRED"
                                ? "授权已过期，请返回 App 重新登录。"
                                : "授权未完成，请返回 App 重试。",
                        ),
                    );
            });
        return () => {
            active = false;
        };
    }, [id]);
    async function approve() {
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
            const { data } = await request<V10ClientAuthorizationApproval>(
                "user/client-authorization/approve",
                { authorization_id: id },
            );
            const target = clientCallback(data.callbackUrl || "");
            setCallback(target);
            history.replaceState(
                null,
                "",
                location.pathname + "#/client-authorize",
            );
            location.assign(target);
        } catch {
            setError(tx("授权未完成，请返回 App 重试。"));
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    }
    return (
        <main className="client-authorization">
            <section className="panel client-authorization-card">
                <div className="client-authorization-mark">
                    <ShieldCheck size={32} aria-hidden="true" />
                </div>
                <h1>{tx(callback ? "授权完成" : "登录 FastAI")}</h1>
                <p>
                    {tx(
                        callback
                            ? "请返回 FastAI 继续使用。"
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
                {callback ? (
                    <a className="btn primary" href={callback}>
                        {tx("返回 FastAI")}
                    </a>
                ) : (
                    <button
                        className="btn primary"
                        disabled={!details || busy || !!error}
                        onClick={approve}
                    >
                        {tx(busy ? "正在授权…" : "确认登录")}
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
            </section>
        </main>
    );
}
