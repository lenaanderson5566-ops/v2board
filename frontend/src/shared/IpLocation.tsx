import { tx } from "./i18n";
export function IpLocation({ row }: { row: Record<string, any> }) {
    const region = [
        ...new Set([row.country, row.region, row.city].filter(Boolean)),
    ].join(" · ");
    return (
        <span>
            <span>{row.ip || "—"}</span>
            <small className="muted" style={{ display: "block" }}>
                {region || tx("地区未知")}
            </small>
        </span>
    );
}
