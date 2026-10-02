import { useState } from "react";
import { Search, ChevronDown, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { tx } from "./i18n";
import { Panel } from "./ui";
import { h, type helpCopy } from "./help-copy";

type Category = "setup" | "usage" | "account";
const topics: {
    id: string;
    category: Category;
    question: keyof typeof helpCopy;
    answer: keyof typeof helpCopy;
    action: keyof typeof helpCopy;
    href: string;
}[] = [
    {
        id: "start",
        category: "setup",
        question: "qStart",
        answer: "aStart",
        action: "configure",
        href: "#/subscribe",
    },
    {
        id: "import",
        category: "setup",
        question: "qImport",
        answer: "aImport",
        action: "configure",
        href: "#/subscribe",
    },
    {
        id: "connect",
        category: "setup",
        question: "qConnect",
        answer: "aConnect",
        action: "viewUsage",
        href: "#/dashboard",
    },
    {
        id: "credits",
        category: "usage",
        question: "qCredits",
        answer: "aCredits",
        action: "viewUsage",
        href: "#/dashboard",
    },
    {
        id: "reset",
        category: "usage",
        question: "qReset",
        answer: "aReset",
        action: "viewUsage",
        href: "#/dashboard",
    },
    {
        id: "payment",
        category: "account",
        question: "qPayment",
        answer: "aPayment",
        action: "billing",
        href: "#/order",
    },
    {
        id: "cancelled",
        category: "account",
        question: "qCancelled",
        answer: "aCancelled",
        action: "billing",
        href: "#/order",
    },
    {
        id: "security",
        category: "account",
        question: "qSecurity",
        answer: "aSecurity",
        action: "security",
        href: "#/security",
    },
];

export function HelpGuides() {
    const { i18n } = useTranslation("help");
    const [category, setCategory] = useState<Category | "all">("all");
    const [search, setSearch] = useState("");
    const terms = search
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const visible = topics.filter(
        (topic) =>
            (category === "all" || category === topic.category) &&
            terms.every((term) =>
                `${h(topic.question)} ${h(topic.answer)}`
                    .toLocaleLowerCase()
                    .includes(term),
            ),
    );
    return (
        <Panel title={tx("常见问题与问题排查")}>
            <div className="pad help-guides">
                <p className="muted help-intro">{h("intro")}</p>
                <div className="help-search">
                    <Search size={18} aria-hidden="true" />
                    <input
                        type="search"
                        aria-label={h("search")}
                        placeholder={h("search")}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </div>
                <div
                    className="help-categories"
                    role="group"
                    aria-label={tx("常见问题与问题排查")}
                >
                    {(["all", "setup", "usage", "account"] as const).map(
                        (key) => (
                            <button
                                key={key}
                                type="button"
                                aria-pressed={category === key}
                                onClick={() => setCategory(key)}
                            >
                                {h(key)}
                            </button>
                        ),
                    )}
                </div>
                <p className="help-count muted" role="status">
                    {h("count", { count: visible.length })}
                </p>
                <div className="help-results" key={i18n.resolvedLanguage}>
                    {visible.map((topic) => (
                        <details key={topic.id}>
                            <summary>
                                {h(topic.question)}
                                <ChevronDown size={18} aria-hidden="true" />
                            </summary>
                            <div className="help-answer">
                                <p>{h(topic.answer)}</p>
                                <a className="help-action" href={topic.href}>
                                    {h(topic.action)}
                                    <ArrowUpRight
                                        size={16}
                                        aria-hidden="true"
                                    />
                                </a>
                            </div>
                        </details>
                    ))}
                </div>
                {!visible.length && (
                    <div className="help-empty">
                        <p>{h("empty")}</p>
                        <button
                            type="button"
                            onClick={() => {
                                setSearch("");
                                setCategory("all");
                            }}
                        >
                            {h("clear")}
                        </button>
                    </div>
                )}
            </div>
        </Panel>
    );
}

export function ContactSupport() {
    return (
        <Panel title={tx("仍需帮助？")}>
            <div className="pad">
                <p className="muted">
                    {tx(
                        "请先查看使用文档和排查建议；问题仍未解决时，再联系客服。已有未关闭的工单请继续回复。",
                    )}
                </p>
                <a className="button" href="#/ticket">
                    {tx("联系客服 / 查看已有工单")}
                </a>
            </div>
        </Panel>
    );
}
