import { useEffect, useRef, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { Modal } from "../shared/ui";

export function NodeNetworkSetup({
    node,
    disabled = false,
}: {
    node: Row;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false),
        [busy, setBusy] = useState(false);
    const [grant, setGrant] = useState<Row | null>(null),
        [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const pending = useRef(false);
    useEffect(() => {
        if (!grant) return;
        const timer = window.setTimeout(
            () => {
                setGrant(null);
                setCopied(false);
                setError(
                    "命令已过期，请重新生成。已成功配置的上报服务不受影响。",
                );
            },
            Math.max(0, Date.parse(grant.expiresAt) - Date.now()),
        );
        return () => window.clearTimeout(timer);
    }, [grant]);
    async function generate() {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        setGrant(null);
        setCopied(false);
        try {
            const r = await request<Row>(
                admin("server/credentials/deployment"),
                {
                    type: "v2box",
                    id: node.id,
                    networkOnly: true,
                },
            );
            setGrant(r.data);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            pending.current = false;
            setBusy(false);
        }
    }
    return (
        <>
            <button disabled={disabled} onClick={() => setOpen(true)}>
                配置 / 修复 IP 上报
            </button>
            {open && (
                <Modal
                    title="配置 IP 上报"
                    close={() => {
                        if (pending.current) return;
                        setOpen(false);
                        setGrant(null);
                        setError("");
                        setCopied(false);
                    }}
                >
                    <div className="pad">
                        <p>
                            在节点 #{node.id} 所在服务器执行命令，自动安装并配置
                            IP 上报服务，无需输入密钥。
                        </p>
                        <p className="muted">
                            命令有效期 10
                            分钟，仅可兑换一次。执行时更换此节点的上报密钥，不重装或重启
                            V2Box。
                        </p>
                        <button
                            className="primary"
                            disabled={busy}
                            onClick={generate}
                        >
                            {grant ? "重新生成命令" : "生成上报配置命令"}
                        </button>
                        {grant && (
                            <>
                                <textarea
                                    aria-label="IP 上报一键配置命令"
                                    className="admin-command-input"
                                    readOnly
                                    rows={5}
                                    value={grant.command}
                                />
                                <button
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(
                                                grant.command,
                                            );
                                            setCopied(true);
                                        } catch {
                                            setError(
                                                "复制失败，请手动复制命令",
                                            );
                                        }
                                    }}
                                >
                                    {copied ? "已复制" : "复制上报配置命令"}
                                </button>
                                <p>
                                    首次配置成功后立即上报，之后每约 5
                                    分钟更新。配置中断可在同一服务器重新执行原命令。
                                </p>
                            </>
                        )}
                        {error && <p role="alert">{error}</p>}
                    </div>
                </Modal>
            )}
        </>
    );
}
