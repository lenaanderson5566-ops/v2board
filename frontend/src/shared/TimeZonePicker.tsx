import { useEffect, useMemo, useState } from "react";
import { locale, tx } from "./i18n";
import { formatInstant, validZone } from "./timezone";
import "./timezone-picker.css";

const cities: Record<string, string> = {
    "Asia/Shanghai": "北京",
    "Asia/Hong_Kong": "香港",
    "Asia/Tokyo": "东京",
    "Asia/Singapore": "新加坡",
    "Europe/London": "伦敦",
    "America/New_York": "纽约",
    "America/Los_Angeles": "洛杉矶",
    "Australia/Sydney": "悉尼",
    UTC: "UTC",
};
function name(zone: string, now: Date) {
    const parts = new Intl.DateTimeFormat(locale(), {
        timeZone: zone,
        timeZoneName: "longOffset",
    }).formatToParts(now);
    const offset = (
        parts.find((p) => p.type === "timeZoneName")?.value || "UTC"
    ).replace("GMT", "UTC");
    const city = cities[zone]
        ? tx(cities[zone])
        : zone.split("/").pop()!.replaceAll("_", " ");
    return `${city} (${offset})`;
}
export function TimeZonePicker({
    id,
    label,
    value,
    zones,
    onChange,
    disabled = false,
    allowDevice = false,
}: {
    id?: string;
    label: string;
    value: string;
    zones: string[];
    onChange: (zone: string) => void;
    disabled?: boolean;
    allowDevice?: boolean;
}) {
    const [more, setMore] = useState(false),
        [search, setSearch] = useState("");
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 30000);
        return () => window.clearInterval(timer);
    }, []);
    const available = useMemo(
        () =>
            [...new Set([...zones, ...(value ? [value] : [])])].filter(
                validZone,
            ),
        [zones, value],
    );
    const common = [
        ...new Set([
            ...Object.keys(cities).filter((zone) => available.includes(zone)),
            ...(value ? [value] : []),
        ]),
    ].filter(validZone);
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const effective = validZone(value) ? value : device;
    const matches = (more ? available : []).filter((zone) =>
        `${zone === "Asia/Shanghai" ? "Beijing" : ""} ${zone} ${zone.replaceAll("_", " ")} ${cities[zone] || ""} ${name(zone, now)}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
    );
    return (
        <div className="timezone-picker">
            <select
                id={id}
                aria-label={label}
                value={value}
                disabled={disabled}
                onChange={(event) => {
                    if (event.target.value === "__more") setMore(true);
                    else onChange(event.target.value);
                }}
            >
                {allowDevice && (
                    <option value="">
                        {tx("跟随设备")} · {name(device, now)}
                    </option>
                )}
                {common.map((zone) => (
                    <option value={zone} key={zone}>
                        {name(zone, now)}
                    </option>
                ))}
                <option value="__more">{tx("更多时区")}</option>
            </select>
            <small>
                {tx("当前时间")}：{formatInstant(now, {}, effective)}
            </small>
            {value && <small dir="ltr">{value}</small>}
            {more && (
                <div className="timezone-search">
                    <input
                        type="search"
                        aria-label={tx("搜索时区")}
                        placeholder={tx("搜索城市或时区名称")}
                        value={search}
                        disabled={disabled}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    {matches.length ? (
                        <select
                            size={6}
                            aria-label={tx("搜索结果")}
                            value={matches.includes(value) ? value : ""}
                            disabled={disabled}
                            onChange={(event) => {
                                onChange(event.target.value);
                                setMore(false);
                                setSearch("");
                            }}
                        >
                            <option value="" disabled>
                                {tx("搜索结果")}
                            </option>
                            {matches.map((zone) => (
                                <option key={zone} value={zone}>
                                    {name(zone, now)} · {zone}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <p role="status">{tx("暂无匹配时区")}</p>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            setMore(false);
                            setSearch("");
                        }}
                    >
                        {tx("收起")}
                    </button>
                </div>
            )}
        </div>
    );
}
