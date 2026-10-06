import { useEffect, useRef, useState } from "react";
import { Bell, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import DOMPurify from "dompurify";
import { date, request, type Row } from "../shared/api";
import { Html, Modal, useData } from "../shared/ui";
import { renderMarkdown } from "../shared/markdown";
import { tx } from "../shared/i18n";
import { a } from "./announcement-copy";

type Inbox = { items: Row[]; total: number; unread: number };

export function announcementSummary(content: unknown) {
    const html = DOMPurify.sanitize(renderMarkdown(content));
    return (
        new DOMParser()
            .parseFromString(html, "text/html")
            .body.textContent?.replace(/\s+/g, " ")
            .trim()
            .slice(0, 140) || ""
    );
}

export function AnnouncementCenter() {
    const [open, setOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<number | null>(null);
    const inbox = useData<Inbox>(`user/notice/inbox?current=${page}&page_size=10`);
    const unread = inbox.data?.unread || 0;
    const trigger = useRef<HTMLButtonElement>(null);
    const close = () => {
        setOpen(false);
        setSelected(null);
    };
    const openInbox = () => {
        window.dispatchEvent(
            new CustomEvent("header-popover-open", { detail: "announcements" }),
        );
        setPage(1);
        inbox.reload();
        setOpen(true);
    };
    return (
        <div className="announcement-control">
            <button
                ref={trigger}
                className="icon-button announcement-trigger"
                title={a("title")}
                aria-label={
                    unread ? a("unreadLabel", { count: unread }) : a("title")
                }
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={openInbox}
            >
                <Bell size={20} />
                {unread > 0 && (
                    <span className="announcement-dot" aria-hidden="true" />
                )}
            </button>
            {open && (
                <Modal
                    title={a("title")}
                    close={close}
                    className="announcement-overlay"
                >
                    {selected !== null ? (
                        <AnnouncementDetail
                            id={selected}
                            back={() => setSelected(null)}
                        />
                    ) : (
                        <>
                            <div className="announcement-intro">
                                <p>{a("intro")}</p>
                                {unread > 0 && (
                                    <span>
                                        {a("unreadCount", { count: unread })}
                                    </span>
                                )}
                            </div>
                            <div
                                className="announcement-list"
                                aria-busy={inbox.loading}
                            >
                                {inbox.error ? (
                                    <div
                                        className="announcement-empty"
                                        role="alert"
                                    >
                                        <p>{a("loadError")}</p>
                                        <button onClick={inbox.reload}>
                                            {tx("重试")}
                                        </button>
                                    </div>
                                ) : inbox.loading ? (
                                    <div
                                        className="announcement-empty"
                                        role="status"
                                    >
                                        {tx("正在加载…")}
                                    </div>
                                ) : !inbox.data?.items.length ? (
                                    <div className="announcement-empty">
                                        <Bell size={28} />
                                        <p>{a("empty")}</p>
                                        <small>{a("emptyHint")}</small>
                                    </div>
                                ) : (
                                    inbox.data.items.map((notice) => (
                                        <button
                                            className="announcement-item"
                                            key={notice.id}
                                            onClick={() =>
                                                setSelected(Number(notice.id))
                                            }
                                        >
                                            <span className="announcement-item-top">
                                                <strong>{notice.title}</strong>
                                                {!Number(notice.is_read) && (
                                                    <span className="announcement-unread">
                                                        {a("unread")}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="announcement-summary">
                                                {announcementSummary(
                                                    notice.content,
                                                )}
                                            </span>
                                            <time>
                                                {date(notice.created_at)}
                                            </time>
                                        </button>
                                    ))
                                )}
                            </div>
                            {(inbox.data?.total || 0) > 10 && (
                                <div className="announcement-pagination">
                                    <button
                                        className="icon-button"
                                        disabled={page <= 1 || inbox.loading}
                                        aria-label={a("previous")}
                                        onClick={() => setPage(page - 1)}
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                    <span>
                                        {page} /{" "}
                                        {Math.ceil(
                                            (inbox.data?.total || 0) / 10,
                                        )}
                                    </span>
                                    <button
                                        className="icon-button"
                                        disabled={
                                            page * 10 >=
                                                (inbox.data?.total || 0) ||
                                            inbox.loading
                                        }
                                        aria-label={a("next")}
                                        onClick={() => setPage(page + 1)}
                                    >
                                        <ChevronRight size={18} />
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </Modal>
            )}
        </div>
    );
}

function AnnouncementDetail({ id, back }: { id: number; back: () => void }) {
    const detail = useData(`user/notice/fetch?id=${id}`);
    const version = detail.data?.updated_at;
    const [readError, setReadError] = useState("");
    const [attempt, setAttempt] = useState(0);
    const backButton = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        backButton.current?.focus();
    }, []);
    useEffect(() => {
        if (version === undefined || Number(detail.data?.id) !== id) return;
        let live = true;
        setReadError("");
        request("user/notice/read", { id, version }).catch(
            (error: Error & { code?: string }) => {
                if (live)
                    setReadError(
                        error.code === "NOTICE_VERSION_CHANGED"
                            ? a("changed")
                            : a("readError"),
                    );
            },
        );
        return () => {
            live = false;
        };
    }, [id, version, attempt]);
    return (
        <div className="announcement-detail">
            <button
                ref={backButton}
                className="announcement-back"
                onClick={back}
            >
                <ArrowLeft size={16} />
                {a("back")}
            </button>
            {detail.error ? (
                <div role="alert">
                    <p>{a("unavailable")}</p>
                    <button onClick={detail.reload}>{tx("重试")}</button>
                </div>
            ) : !detail.data ? (
                <p role="status">{tx("正在加载…")}</p>
            ) : (
                <article>
                    <h3>{detail.data.title}</h3>
                    <time>{date(detail.data.created_at)}</time>
                    {readError && (
                        <div className="announcement-read-error" role="alert">
                            <p>{readError}</p>
                            <button
                                onClick={() => {
                                    detail.reload();
                                    setAttempt(attempt + 1);
                                }}
                            >
                                {tx("重试")}
                            </button>
                        </div>
                    )}
                    <Html markdown value={detail.data.content} />
                </article>
            )}
        </div>
    );
}
