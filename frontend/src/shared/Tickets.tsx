import { StatusBadge } from "./StatusBadge";
import { useState, useRef, type ReactNode } from "react";
import { boot, request, rows, query, date, type Row } from "./api";
import { tx } from "./i18n";
import {
    useData,
    State,
    Panel,
    Table,
    Empty,
    Html,
    Editor,
    Modal,
    Reload,
    Pager,
    type Field,
} from "./ui";
import {
    supportTopics,
    unresolvedTicket,
    supportPayload,
} from "./support-flow";
export function Tickets({
    isAdmin = false,
    queryParams = {},
    toolbar,
    pageSize = 20,
    heading,
    adminColumns,
    orderTradeNo,
}: {
    isAdmin?: boolean;
    queryParams?: Row;
    toolbar?: ReactNode;
    pageSize?: number;
    heading?: string;
    adminColumns?: [string, string, ((row: Row) => ReactNode)?][];
    orderTradeNo?: string;
}) {
    const [page, setPage] = useState(1);
    const prefix = isAdmin ? boot.adminPath : "user";
    const ticketAccount = useData(isAdmin ? "" : "user/info");
    const ticketPolicy = ticketAccount.data?.ticket_creation;
    const [id, setId] = useState<number | null>(null),
        [creating, setCreating] = useState(false);
    const d = useData<Row[]>(
            query(`${prefix}/ticket/fetch`, {
                current: page,
                pageSize,
                ...queryParams,
            }),
        ),
        detail = useData(
            id
                ? query(`${prefix}/ticket/fetch`, { id })
                : `${prefix}/ticket/fetch`,
        );
    const openTicket = unresolvedTicket(d.data || []);
    const closingRef = useRef(false);
    const [closing, setClosing] = useState(false);
    const [closeTarget, setCloseTarget] = useState<number | null>(null);
    const [closeError, setCloseError] = useState("");
    async function closeTicket() {
        if (!closeTarget || closingRef.current) return;
        closingRef.current = true;
        setClosing(true);
        setCloseError("");
        try {
            await request(`${prefix}/ticket/close`, { id: closeTarget });
            setCloseTarget(null);
            detail.reload();
            d.reload();
        } catch (error) {
            setCloseError((error as Error).message);
        } finally {
            closingRef.current = false;
            setClosing(false);
        }
    }

    return (
        <>
            {!isAdmin && (
                <div className="pad support-context">
                    <a href="#/knowledge">{tx("先查看帮助中心")}</a>
                    <p className="muted">
                        {tx("已有未关闭的工单请继续回复，避免重复提交。")}
                        {ticketPolicy === "closed" && (
                            <span role="status">
                                {tx("暂不开放新工单，已有工单仍可查看和回复。")}
                            </span>
                        )}
                        {ticketPolicy === "purchase_required" && (
                            <span role="status">
                                {tx("完成购买后即可创建工单。")}
                            </span>
                        )}
                    </p>
                </div>
            )}
            <Panel
                title={heading || tx("工单中心")}
                actions={
                    <>
                        <Reload
                            onClick={() => {
                                d.reload();
                                if (!isAdmin) ticketAccount.reload();
                            }}
                        />
                        {!isAdmin && (
                            <button
                                className="button"
                                disabled={
                                    d.loading ||
                                    Boolean(d.error) ||
                                    (!openTicket &&
                                        (ticketAccount.loading ||
                                            Boolean(ticketAccount.error) ||
                                            ticketPolicy !== "allowed"))
                                }
                                onClick={() =>
                                    openTicket
                                        ? setId(openTicket.id)
                                        : setCreating(true)
                                }
                            >
                                {tx(openTicket ? "继续已有工单" : "创建工单")}
                            </button>
                        )}
                    </>
                }
            >
                {toolbar}
                <State {...d} retry={d.reload}>
                    <Table
                        data={d.data || []}
                        columns={
                            adminColumns || [
                                ["id", tx("编号")],
                                ["subject", tx("主题")],
                                [
                                    "status",
                                    tx("状态"),
                                    (r) => (
                                        <StatusBadge tone={Number(r.status) === 0 ? "info" : "neutral"}>
                                            {Number(r.status) === 0
                                                ? tx("处理中")
                                                : tx("已关闭")}
                                        </StatusBadge>
                                    ),
                                ],
                                [
                                    "updated_at",
                                    tx("更新时间"),
                                    (r) => date(r.updated_at),
                                ],
                            ]
                        }
                        actions={(r) => (
                            <>
                                <button onClick={() => setId(r.id)}>
                                    {tx("查看对话")}
                                </button>
                                {isAdmin && (
                                    <button
                                        disabled={r.status !== 0}
                                        onClick={() => {
                                            setCloseError("");
                                            setCloseTarget(r.id);
                                        }}
                                    >
                                        {tx("关闭工单")}
                                    </button>
                                )}
                            </>
                        )}
                    />
                    {d.total > pageSize && (
                        <Pager
                            page={page}
                            total={d.total}
                            size={pageSize}
                            onChange={setPage}
                        />
                    )}
                </State>
            </Panel>
            {creating && (
                <Modal title={tx("创建工单")} close={() => setCreating(false)}>
                    <Editor
                        draftKey="ticket-new"
                        fields={[
                            {
                                key: "topic",
                                label: tx("问题类型"),
                                type: "select",
                                required: true,
                                options: supportTopics.map(([value, label]) => [
                                    value,
                                    tx(label),
                                ]),
                            },
                            {
                                key: "subject",
                                label: tx("主题"),
                                required: true,
                            },
                            {
                                key: "level",
                                label: tx("优先级"),
                                type: "select",
                                options: [
                                    ["0", tx("普通")],
                                    ["1", tx("中等")],
                                    ["2", tx("紧急")],
                                ],
                            },
                            {
                                key: "message",
                                label: tx("问题描述"),
                                hint: tx(
                                    "请说明发生时间、设备与客户端、错误提示以及已尝试的排查步骤。",
                                ),
                                type: "textarea",
                                required: true,
                            },
                        ]}
                        initial={{
                            level: 0,
                            topic: orderTradeNo ? "payment" : "other",
                            order_trade_no: orderTradeNo || "",
                        }}
                        onSave={async (body) => {
                            const latest = await request("user/ticket/fetch");
                            const existing = unresolvedTicket(
                                rows(latest.data),
                            );
                            if (existing) {
                                d.reload();
                                throw new Error(
                                    tx(
                                        "已有未关闭的工单请继续回复，避免重复提交。",
                                    ),
                                );
                            }
                            await request(
                                "user/ticket/save",
                                supportPayload(body, tx),
                            );
                            setCreating(false);
                            d.reload();
                        }}
                    />
                </Modal>
            )}
            {id && (
                <Modal
                    title={detail.data?.subject || tx("工单对话")}
                    close={() => setId(null)}
                >
                    <State {...detail}>
                        <div className="messages">
                            {rows(detail.data?.message).map((m) => (
                                <div
                                    className={
                                        "message " + (m.is_me ? "mine" : "")
                                    }
                                    key={m.id}
                                >
                                    <small>
                                        {m.is_me ? tx("我") : tx("对方")} ·{" "}
                                        {date(m.created_at)}
                                    </small>
                                    <p>{m.message}</p>
                                </div>
                            ))}
                        </div>
                        {detail.data?.status === 0 && (
                            <>
                                <Editor
                                    fields={[
                                        {
                                            key: "message",
                                            label: tx("回复内容"),
                                            type: "textarea",
                                            required: true,
                                        },
                                    ]}
                                    key={id}
                                    draftKey={`ticket-reply-${id}`}
                                    initial={{ id }}
                                    submit={tx("发送回复")}
                                    onSave={async (body) => {
                                        await request(
                                            `${prefix}/ticket/reply`,
                                            body,
                                        );
                                        detail.reload();
                                        d.reload();
                                    }}
                                />
                                <div className="pad">
                                    <button
                                        onClick={() => {
                                            setCloseError("");
                                            setCloseTarget(id);
                                        }}
                                    >
                                        {tx("关闭工单")}
                                    </button>
                                </div>
                            </>
                        )}
                    </State>
                </Modal>
            )}
            {closeTarget !== null && (
                <Modal
                    title={tx("关闭工单")}
                    close={() => {
                        if (!closingRef.current) setCloseTarget(null);
                    }}
                >
                    <div className="pad">
                        <p>{tx("确认关闭此工单？")}</p>
                        {closeError && (
                            <div role="alert" className="alert">
                                {closeError}
                            </div>
                        )}
                        <div className="actions">
                            <button
                                disabled={closing}
                                onClick={() => setCloseTarget(null)}
                            >
                                {tx("取消")}
                            </button>
                            <button disabled={closing} onClick={closeTicket}>
                                {tx(closing ? "提交中…" : "关闭工单")}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
}
