import { useState } from "react";
import { admin, query, type Row } from "./api";
import { Modal, State, Html, useData } from "./ui";
import { ResourcePage, resources } from "./admin";
import { Tickets } from "./user";
export function AdminTickets() {
    const paramsFromHash = new URLSearchParams(
        window.location.hash.split("?")[1] || "",
    );
    const [email, setEmail] = useState(""),
        [draftEmail, setDraftEmail] = useState(""),
        [status, setStatus] = useState(paramsFromHash.get("status") || ""),
        [reply, setReply] = useState(paramsFromHash.get("reply_status") || ""),
        [pageSize, setPageSize] = useState(20);
    const params = {
        email,
        status,
        reply_status: reply === "" ? undefined : [reply],
    };
    return (
        <Tickets
            key={JSON.stringify({ params, pageSize })}
            isAdmin
            queryParams={params}
            pageSize={pageSize}
            toolbar={
                <form
                    className="pad actions"
                    onSubmit={(e) => {
                        e.preventDefault();
                        setEmail(draftEmail.trim());
                    }}
                >
                    <input
                        aria-label="工单用户邮箱"
                        placeholder="用户邮箱（精确匹配）"
                        value={draftEmail}
                        onChange={(e) => setDraftEmail(e.target.value)}
                    />
                    <button>搜索</button>
                    <select
                        aria-label="工单状态"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                    >
                        <option value="">全部状态</option>
                        <option value="0">处理中</option>
                        <option value="1">已关闭</option>
                    </select>
                    <select
                        aria-label="工单回复状态"
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                    >
                        <option value="">全部回复状态</option>
                        <option value="0">待回复</option>
                        <option value="1">已回复</option>
                    </select>
                    <select
                        aria-label="工单每页数量"
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                    >
                        {[10, 20, 50, 100].map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={() => {
                            setEmail("");
                            setDraftEmail("");
                            setStatus("");
                            setReply("");
                        }}
                    >
                        重置筛选
                    </button>
                </form>
            }
        />
    );
}
export function ContentPage({ kind }: { kind: "knowledge" | "notices" }) {
    const [selected, setSelected] = useState<Row | null>(null);
    return (
        <>
            <ResourcePage
                resource={resources[kind]}
                extraActions={(row) => (
                    <button onClick={() => setSelected(row)}>预览</button>
                )}
            />
            {selected && (
                <Modal
                    title={`预览 · ${selected.title}`}
                    close={() => setSelected(null)}
                >
                    {kind === "knowledge" ? (
                        <KnowledgePreview id={selected.id} />
                    ) : (
                        <div className="pad">
                            <Html value={selected.content || ""} />
                        </div>
                    )}
                </Modal>
            )}
        </>
    );
}
function KnowledgePreview({ id }: { id: number }) {
    const d = useData(query(admin("knowledge/fetch"), { id }));
    return (
        <State {...d} retry={d.reload}>
            <div className="pad">
                <Html value={d.data?.body || ""} />
            </div>
        </State>
    );
}
