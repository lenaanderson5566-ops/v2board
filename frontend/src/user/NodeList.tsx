import { formatMultiplier } from "../shared/number-format";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "../shared/StatusBadge";
import { ChevronRight, Globe } from "lucide-react";
import { type Row } from "../shared/api";
import { locale, tx } from "../shared/i18n";
import { Modal, Table } from "../shared/ui";
import "./node-list.css";

const flags = import.meta.glob<string>("./assets/flags/*.svg", {
    eager: true,
    query: "?url&no-inline",
    import: "default",
});
export function nodeName(node: Row, language: string): string {
    const names = node.display_names;
    for (const value of [names?.[language], names?.["en-US"], node.name]) {
        if (typeof value === "string" && value.trim()) return value;
    }
    return "—";
}
function nodeTags(node: Row) {
    const tags = Array.isArray(node.tags)
        ? [
              ...new Set(
                  node.tags.filter(
                      (tag: unknown): tag is string =>
                          typeof tag === "string" && !!tag.trim(),
                  ),
              ),
          ]
        : [];
    return tags.length ? (
        <span className="user-node-tags">
            {tags.map((tag) => (
                <span className="badge" key={tag}>
                    {tag}
                </span>
            ))}
        </span>
    ) : (
        <span className="muted">—</span>
    );
}
function nodeStatus(node: Row) {
    return (
        <StatusBadge tone={node.is_online ? "success" : "danger"}>
            {node.is_online ? tx("在线") : tx("离线")}
        </StatusBadge>
    );
}
export function NodeList({ nodes }: { nodes: Row[] }) {
    const { t } = useTranslation("nodes");
    const language = locale();
    const [selected, setSelected] = useState<Row | null>(null);
    return (
        <div className="user-node-list">
            <Table
                data={nodes}
                columns={[
                    [
                        "name",
                        tx("节点名称"),
                        (node) => {
                            const region =
                                typeof node.region_code === "string"
                                    ? node.region_code.toLowerCase()
                                    : "";
                            const code = region === "tw" ? "cn" : region;
                            const flag = flags[`./assets/flags/${code}.svg`];
                            const name = nodeName(node, language);
                            return (
                                <button
                                    className="user-node-name"
                                    type="button"
                                    aria-haspopup="dialog"
                                    onClick={() => setSelected(node)}
                                >
                                    {flag ? (
                                        <img
                                            src={flag}
                                            width="28"
                                            height="28"
                                            alt=""
                                            aria-hidden="true"
                                        />
                                    ) : (
                                        <Globe size={28} aria-hidden="true" />
                                    )}
                                    <span title={name}>{name}</span>
                                    <ChevronRight
                                        size={14}
                                        className="user-node-details-icon"
                                        aria-hidden="true"
                                    />
                                </button>
                            );
                        },
                    ],
                    ["tags", t("tags"), nodeTags],
                    [
                        "rate",
                        tx("倍率"),
                        (node) => (
                            <span className="user-node-rate">
                                {formatMultiplier(node.rate)}
                            </span>
                        ),
                    ],
                    ["is_online", tx("状态"), nodeStatus],
                ]}
            />
            {selected && (
                <Modal
                    title={nodeName(selected, language)}
                    className="user-node-detail"
                    close={() => setSelected(null)}
                >
                    <dl className="detail-grid pad">
                        <div>
                            <dt>{t("tags")}</dt>
                            <dd>{nodeTags(selected)}</dd>
                        </div>
                        <div>
                            <dt>{tx("倍率")}</dt>
                            <dd>{formatMultiplier(selected.rate)}</dd>
                        </div>
                        <div>
                            <dt>{tx("状态")}</dt>
                            <dd>{nodeStatus(selected)}</dd>
                        </div>
                    </dl>
                </Modal>
            )}
        </div>
    );
}
