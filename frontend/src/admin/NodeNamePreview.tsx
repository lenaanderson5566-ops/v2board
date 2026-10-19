import countries from "../../../resources/client/node-countries.json";
import locations from "../../../resources/client/node-locations.json";
import { resolveLocation } from "./node-location-options";

export function NodeNamePreview({
    values,
}: {
    values: Record<string, unknown>;
}) {
    const region = String(values.region_code ?? "")
        .trim()
        .toUpperCase();
    const country = (countries as Record<string, Record<string, string>>)[
        region
    ];
    const rawCity = String(values.city_code ?? "").trim();
    const cityCode =
        resolveLocation(rawCity, region) ??
        rawCity.toLowerCase().replace(/[\s_]+/g, "-");
    const city = (locations.cities as Record<string, Record<string, string>>)[
        cityCode
    ];
    const fallbackCity = cityCode
        .replace(/-/g, " ")
        .replace(
            /(^|\s)([a-z])/g,
            (_, space: string, letter: string) => space + letter.toUpperCase(),
        );
    const name = (language: string) =>
        country
            ? [
                  country[language] ?? country["en-US"],
                  city?.[language] ?? city?.["en-US"] ?? fallbackCity,
                  String(values.display_label ?? "").trim(),
              ]
                  .filter(Boolean)
                  .join(" · ")
            : String(values.name ?? "").trim() || "尚未填写节点名称";

    return (
        <section className="admin-node-name-preview" aria-label="节点名称预览">
            <strong>节点名称预览</strong>
            <dl>
                <div>
                    <dt>中文</dt>
                    <dd lang="zh-CN">{name("zh-CN")}</dd>
                </div>
                <div>
                    <dt>English</dt>
                    <dd lang="en-US">{name("en-US")}</dd>
                </div>
            </dl>
            <p className="muted">
                {country
                    ? "名称随地区、城市和线路后缀实时变化。订阅可能附加地区代码、旗帜及重名序号。"
                    : region
                      ? "当前地区代码未收录，请重新选择；预览暂显示原节点名称。"
                      : "未选择国家 / 地区，将保留原节点名称。"}
            </p>
        </section>
    );
}
