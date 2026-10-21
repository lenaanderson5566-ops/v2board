import { useState } from "react";
import { admin, date, query, request, type Row } from "../shared/api";
import { Modal, State, Table, useData } from "../shared/ui";

export function NodeCredentials({
    node,
    close,
    embedded = false,
    onBusyChange,
    onChanged,
}: {
    node: Row;
    close: () => void;
    embedded?: boolean;
    onBusyChange?: (busy: boolean) => void;
    onChanged?: () => void;
}) {
    const identity = { type: node.type, id: node.id };
    const report = useData<Row>(query(admin("server/credentials"), identity));
    const [password, setPassword] = useState("");
    const [secret, setSecret] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function act(action: string, credentialId?: string) {
        if (
            !window.confirm(
                action === "issue"
                    ? "首次生成后，此节点将立即拒绝全局密钥；轮换时旧独立密钥保留 30 分钟。确认继续？"
                    : action === "revoke"
                      ? "撤销后不可恢复，节点可能失去面板访问权限。确认继续？"
                      : "确认永久关闭全局节点密钥认证？请确保所有节点已成功使用独立密钥。",
            )
        )
            return;
        setBusy(true);
        onBusyChange?.(true);
        setError("");
        setSecret("");
        try {
            const result = await request(
                admin(`server/credentials/${action}`),
                { ...identity, credentialId, password },
            );
            setSecret(result.data?.secret || "");
            report.reload();
            onChanged?.();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
            onBusyChange?.(false);
            setPassword("");
        }
    }
    const content = (
        <>
            <p className="muted">
                凭据仅授权此节点。生成后完整密钥只显示一次，请保存到节点配置；遗失请重新生成。此处不会自动轮换。
            </p>
            {node.type === "v2node" && (
                <p role="note">
                    V2Node 必须先确认所用版本支持 Authorization: Bearer
                    独立密钥。仅支持查询参数 token
                    的旧版本不能迁移；请先升级兼容内核。
                </p>
            )}
            <State {...report} retry={report.reload}>
                {report.data && (
                    <>
                        <p>
                            {report.data.migrated
                                ? "已切换独立凭据，禁止全局密钥回退"
                                : report.data.legacyEnabled
                                  ? "尚未迁移，仍允许全局密钥"
                                  : "全局认证已关闭，需要生成独立凭据"}
                        </p>
                        <Table
                            data={report.data.keys || []}
                            columns={[
                                ["fingerprint", "指纹"],
                                [
                                    "status",
                                    "状态",
                                    (r) =>
                                        ({
                                            active: "有效",
                                            retiring: "宽限期",
                                            expired: "已过期",
                                            revoked: "已撤销",
                                        })[r.status as string] || r.status,
                                ],
                                [
                                    "createdAt",
                                    "创建时间",
                                    (r) => date(r.createdAt),
                                ],
                                [
                                    "lastUsedAt",
                                    "最近认证",
                                    (r) =>
                                        r.lastUsedAt
                                            ? date(r.lastUsedAt)
                                            : "尚未使用",
                                ],
                                [
                                    "expiresAt",
                                    "失效时间",
                                    (r) =>
                                        r.expiresAt ? date(r.expiresAt) : "—",
                                ],
                            ]}
                            actions={(r) =>
                                ["active", "retiring"].includes(r.status) && (
                                    <button
                                        disabled={busy || !password}
                                        onClick={() => act("revoke", r.id)}
                                    >
                                        撤销 {r.fingerprint}
                                    </button>
                                )
                            }
                        />
                        <label>
                            管理员密码
                            <input
                                aria-label="凭据操作管理员密码"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </label>
                        <div className="actions">
                            <button
                                disabled={busy || report.loading}
                                onClick={report.reload}
                            >
                                检查连接状态
                            </button>
                            <button
                                disabled={
                                    busy ||
                                    !password ||
                                    (report.data.keys || []).some(
                                        (k: Row) => k.status === "retiring",
                                    )
                                }
                                onClick={() => act("issue")}
                            >
                                生成 / 手动轮换密钥
                            </button>
                        </div>
                        {report.data.legacyEnabled && (
                            <details>
                                <summary>
                                    全局密钥迁移：剩余{" "}
                                    {report.data.legacyNodes?.length || 0}{" "}
                                    个节点
                                </summary>
                                {(report.data.legacyNodes || []).map(
                                    (n: Row) => (
                                        <p key={`${n.type}:${n.id}`}>
                                            {n.name} · {n.type} #{n.id}
                                        </p>
                                    ),
                                )}
                                <button
                                    disabled={
                                        busy ||
                                        !password ||
                                        !!report.data.legacyNodes?.length
                                    }
                                    onClick={() => act("disable-legacy")}
                                >
                                    关闭全局密钥认证
                                </button>
                            </details>
                        )}
                    </>
                )}
            </State>
            {error && <p role="alert">{error}</p>}
            {secret && (
                <section>
                    <p>完整密钥仅本次展示，关闭窗口后无法找回。</p>
                    <textarea aria-label="新节点密钥" readOnly value={secret} />
                    <p className="muted">
                        首次安装在安装器提示时粘贴。已有 V2Box：运行 v2box
                        credential，按提示选择节点并粘贴；成功后手动运行 v2box
                        restart。回到此处检查新指纹的最近认证时间，再撤销旧凭据。撤销面板凭据不会终止已有代理连接。
                    </p>
                </section>
            )}
        </>
    );
    return embedded ? (
        content
    ) : (
        <Modal
            title={`${node.name} · 接入与凭据`}
            close={() => {
                if (!busy) close();
            }}
        >
            {content}
        </Modal>
    );
}
