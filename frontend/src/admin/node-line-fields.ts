import type { Row } from "../shared/api";
import type { Field } from "../shared/ui";
import type { NodeCatalog } from "./node-dictionary";

export const defaultLineFields = [
    "name",
    "group_id",
    "rate",
    "region_code",
    "city_code",
    "display_label",
    "tags",
];
export const serviceLineFields = new Set([
    ...defaultLineFields,
    "show",
    "sort",
    "host",
    "port",
]);
export function nodeLineFields(groups: Row[], catalog: NodeCatalog): Field[] {
    return [
        { key: "name", label: "节点名称", section: "节点信息", required: true },
        {
            key: "group_id",
            label: "权限组",
            type: "multiselect",
            options: groups.map((g) => [String(g.id), g.name]),
            hint: "未选择权限组时，用户无法获取此线路。移除关联线路正在使用的权限组前，请先调整关联线路。",
        },
        {
            key: "rate",
            label: "计费倍率",
            type: "number",
            required: true,
            min: 0,
            max: 10000,
            step: 0.01,
            hint: "流量按此倍率计费；0 表示不扣除套餐流量。共用代理服务的线路使用同一倍率。",
        },
        {
            key: "region_code",
            label: "国家 / 地区",
            section: "展示信息",
            type: "select",
            nullable: true,
            hint: "表示代理服务的出口位置；中转入口位置在接入路径中单独展示。",
            options: [
                ["", "使用节点名称"],
                ...Object.entries(catalog.regions).map(
                    ([code, names]) =>
                        [code, names["zh-CN"] || names["en-US"]] as [
                            string,
                            string,
                        ],
                ),
            ],
        },
        { key: "city_code", label: "州、省或城市", nullable: true },
        { key: "display_label", label: "线路编号 / 后缀", nullable: true },
        { key: "tags", label: "标签（逗号分隔）", arrayText: true },
    ];
}
