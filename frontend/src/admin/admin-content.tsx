import { AdminFilterBar } from "./AdminFilterBar";
import { AdminChoiceGroup } from "./AdminChoices";
import { StatusBadge } from "../shared/StatusBadge";
import { AdminUserActivityLink } from "./AdminUserActivity";
import { useState } from "react";
import { admin, query, date, type Row } from "../shared/api";
import { Modal, State, Html, useData } from "../shared/ui";
import { ResourcePage, resources } from "./admin";
import { Tickets } from "../shared/Tickets";
export function AdminTickets() {
    const paramsFromHash = new URLSearchParams(
        window.location.hash.split("?")[1] || "",
    );
    const [email, setEmail] = useState(""),
        [draftEmail, setDraftEmail] = useState(""),
        [status, setStatus] = useState(paramsFromHash.get("status") || "0"),
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
            renderAccount={(row) => <AdminUserActivityLink row={row} />}
            queryParams={params}
            pageSize={pageSize}
                onPageSizeChange={setPageSize}
            heading="工单管理"
            adminColumns={[
                ["id", "#"],
                ["subject", "主题"],
                ["user_id", "用户（ID / 邮箱）", (r) => <AdminUserActivityLink row={r} />],
                [
                    "level",
                    "工单级别",
                    (r) => ["低", "中", "高"][Number(r.level)],
                ],
                [
                    "reply_status",
                    "工单状态",
                    (r) => (
                        <StatusBadge
                            tone={Number(r.status) === 1 ? "neutral" : Number(r.reply_status) === 1 ? "success" : "warning"}
                        >
                            {Number(r.status) === 1
                                ? "已关闭"
                                : Number(r.reply_status) === 1
                                  ? "已回复"
                                  : "待回复"}
                        </StatusBadge>
                    ),
                ],
                ["created_at", "创建时间", (r) => date(r.created_at)],
                ["updated_at", "最后回复", (r) => date(r.updated_at)],
            ]}
            toolbar={
                <AdminFilterBar

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
                    <AdminChoiceGroup label="工单状态快捷筛选" value={status} onChange={setStatus}
                        options={[{value:"0",label:"已开启"},{value:"1",label:"已关闭"}]} />
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
                </AdminFilterBar>
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
                            <Html markdown value={selected.content || ""} />
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
                <Html markdown value={d.data?.body || ""} />
            </div>
        </State>
    );
}
