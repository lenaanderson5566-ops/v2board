import { useLayoutEffect, useRef, useState } from "react";
import { date, rows } from "../shared/api";
import { AdminTicketReplyStatus } from "../shared/admin-status";
import type { TicketConversationProps } from "../shared/Tickets";
import { Editor, Modal, State } from "../shared/ui";
import { AdminUserActivityLink } from "./AdminUserActivity";
import "./admin-ticket-conversation.css";

const replyLimit = 10_000;
const priorities = ["普通", "中等", "紧急"];

export function AdminTicketConversation({ id, detail, dismiss, confirmClose, reply }: TicketConversationProps) {
    const ticket = detail.data;
    const messages = rows(ticket?.message);
    const latestId = messages.at(-1)?.id;
    const thread = useRef<HTMLDivElement>(null);
    const followLatest = useRef(true);
    const [sending, setSending] = useState(false);
    const isOpen = Number(ticket?.status) === 0;

    function showLatest() {
        followLatest.current = true;
        if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    }

    useLayoutEffect(() => {
        if (followLatest.current) showLatest();
    }, [latestId]);

    return <Modal title={ticket?.subject || "工单对话"} variant="drawer" wide className="admin-ticket-dialog" close={dismiss} guardChanges>
        <State {...detail} retry={detail.reload}>
            {ticket && <div className="admin-ticket-workspace">
                <div className="admin-ticket-context">
                    <AdminUserActivityLink row={ticket} />
                    <div className="admin-ticket-meta">
                        <span>工单 #{id}</span>
                        {priorities[Number(ticket.level)] && <span>{priorities[Number(ticket.level)]}优先级</span>}
                        <AdminTicketReplyStatus status={ticket.status} replyStatus={ticket.reply_status} />
                    </div>
                </div>
                <div className="admin-ticket-thread-head">
                    <h3>对话记录</h3>
                    {messages.length > 0 && <button type="button" onClick={showLatest}>跳到最新消息</button>}
                </div>
                <div ref={thread} className="messages" role="region" aria-label="工单消息" tabIndex={0}
                    onScroll={({ currentTarget }) => {
                        followLatest.current = currentTarget.scrollHeight - currentTarget.scrollTop - currentTarget.clientHeight < 64;
                    }}>
                    {messages.length === 0 && <p className="muted">暂无对话消息</p>}
                    {messages.map((message) => <article className={`message${message.is_me ? " mine" : ""}`} key={message.id}>
                        <header><strong>{message.is_me ? "客服" : "用户"}</strong><span>{date(message.created_at)}</span></header>
                        <p>{message.message}</p>
                    </article>)}
                </div>
                {isOpen ? <div className="admin-ticket-compose" onKeyDown={(event) => {
                    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing
                        || !(event.target instanceof HTMLTextAreaElement) || sending) return;
                    event.preventDefault();
                    event.target.form?.requestSubmit();
                }}>
                    <Editor
                        initial={{ id }}
                        draftKey={`ticket-reply-${id}`}
                        fields={[{
                            key: "message", label: "回复内容", type: "textarea", required: true, columns: 12,
                            placeholder: "输入发给用户的回复…",
                            hint: "最多 10,000 字符。可按 Ctrl 或 ⌘ 加 Enter 发送。",
                        }]}
                        validate={({ message }) => {
                            const text = String(message ?? "").trim();
                            if (!text) return "请输入回复内容。";
                            if (Array.from(text).length > replyLimit) return "回复内容不能超过 10,000 字符。";
                        }}
                        onBusyChange={setSending}
                        submit="发送回复"
                        onSave={async (body) => {
                            await reply(body);
                            showLatest();
                        }}
                    />
                    <button className="admin-ticket-close" type="button" onClick={confirmClose} disabled={sending || detail.loading}>关闭工单</button>
                </div> : <p className="admin-ticket-closed">工单已关闭，可在上方查阅完整对话。</p>}
            </div>}
        </State>
    </Modal>;
}
