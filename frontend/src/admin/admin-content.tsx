import { AdminFilterBar } from "./AdminFilterBar";
import { AdminChoiceGroup } from "./AdminChoices";
import { StatusBadge } from "../shared/StatusBadge";
import { AdminUserActivityLink } from "./AdminUserActivity";
import { useEffect, useState } from "react";
import { admin, query, date, type Row } from "../shared/api";
import { Modal, State, Html, useData } from "../shared/ui";
import { ResourcePage } from "./admin";
import { resources } from "./admin-resources";
import { Tickets } from "../shared/Tickets";
import { AdminTicketConversation } from "./AdminTicketConversation";

const ticketQueues = [
    { value: "pending", label: "待回复", status: "0", reply: "0" },
    { value: "replied", label: "已回复", status: "0", reply: "1" },
    { value: "open", label: "处理中", status: "0", reply: "" },
    { value: "closed", label: "已关闭", status: "1", reply: "" },
    { value: "all", label: "全部", status: "", reply: "" },
] as const;

function readTicketQueue(route: string) {
    const params = new URLSearchParams(route.split("?")[1]);
    const status = params.get("status");
    const reply = params.get("reply_status");
    return {
        status: status === "" || status === "1" ? status : "0",
        reply: reply === "0" || reply === "1" ? reply : "",
    };
}

export function AdminTickets({ route }: { route: string }) {
    const [email, setEmail] = useState("");
    const [draftEmail, setDraftEmail] = useState("");
    const [{ status, reply }, setQueue] = useState(() => readTicketQueue(route));
    const [pageSize, setPageSize] = useState(20);
    useEffect(() => {
        setQueue(readTicketQueue(route));
    }, [route]);
    const queue = ticketQueues.find(item => item.status === status && item.reply === reply)?.value
        ?? (status === "1" ? "closed" : "all");
    const params = {
        email,
        status,
        reply_status: reply === "" ? undefined : [reply],
    };
    return <>
        <AdminChoiceGroup
            className="pad"
            label="工单队列"
            options={ticketQueues}
            value={queue}
            onChange={value => {
                const next = ticketQueues.find(item => item.value === value);
                if (next) setQueue({ status: next.status, reply: next.reply });
            }}
        />
        <Tickets
            key={JSON.stringify({ params, pageSize })}
            isAdmin
            renderAdminConversation={(props) => <AdminTicketConversation key={props.id} {...props} />}
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
                    {status !== "0" && (
                        <select
                            aria-label="工单回复状态"
                            value={reply}
                            onChange={event => {
                                const next = event.target.value;
                                setQueue({ status, reply: next === "0" || next === "1" ? next : "" });
                            }}
                        >
                            <option value="">全部回复状态</option>
                            <option value="0">待回复</option>
                            <option value="1">已回复</option>
                        </select>
                    )}

                    <button
                        type="button"
                        onClick={() => {
                            setEmail("");
                            setDraftEmail("");
                            setQueue({ status: "", reply: "" });
                        }}
                    >
                        重置筛选
                    </button>
                </AdminFilterBar>
            }
        />
    </>;
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
