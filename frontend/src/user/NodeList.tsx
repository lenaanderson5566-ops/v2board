import { Globe } from "lucide-react";
import { type Row } from "../shared/api";
import { locale, tx } from "../shared/i18n";
import { Table } from "../shared/ui";
import "./node-list.css";

const flags = import.meta.glob<string>("./assets/flags/*.svg", {
    eager: true,
    query: "?url&no-inline",
    import: "default",
});
const labels: Record<string, string> = {
    "zh-CN": "标签 / 备注",
    "zh-TW": "標籤 / 備註",
    "en-US": "Tags / notes",
    "ja-JP": "タグ / 備考",
    "ko-KR": "태그 / 비고",
    "vi-VN": "Nhãn / ghi chú",
    "ru-RU": "Метки / примечания",
    "fa-IR": "برچسب‌ها / توضیحات",
};
export function nodeName(node: Row, language: string): string {
    const names = node.display_names;
    for (const value of [names?.[language], names?.["en-US"], node.name]) {
        if (typeof value === "string" && value.trim()) return value;
    }
    return "—";
}
export function NodeList({ nodes }: { nodes: Row[] }) {
    const language = locale();
    return (
        <Table
            compact
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
                            <span className="user-node-name">
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
                            </span>
                        );
                    },
                ],
                [
                    "tags",
                    labels[language] || labels["en-US"],
                    (node) => {
                        const tags = Array.isArray(node.tags)
                            ? [
                                  ...new Set(
                                      node.tags.filter(
                                          (tag: unknown): tag is string =>
                                              typeof tag === "string" &&
                                              !!tag.trim(),
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
                    },
                ],
                [
                    "rate",
                    tx("倍率"),
                    (node) => (
                        <span>{node.rate == null ? "—" : `${node.rate}×`}</span>
                    ),
                ],
                [
                    "is_online",
                    tx("状态"),
                    (node) => (
                        <span
                            className={`badge ${node.is_online ? "success" : ""}`}
                        >
                            {node.is_online ? tx("在线") : tx("离线")}
                        </span>
                    ),
                ],
            ]}
        />
    );
}
