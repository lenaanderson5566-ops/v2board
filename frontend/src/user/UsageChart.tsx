import { useEffect, useRef, useState } from "react";
import { e } from "../shared/experience-copy";
import { tx, locale } from "../shared/i18n";
import { bytes, date } from "../shared/api";
import { State, Table, useData } from "../shared/ui";
import { b } from "../shared/billing-copy";
import { usageDays, type UsageRecord } from "./usage-data";

export function UsageChart({
    showDetails = true,
    showRecords = false,
}: {
    showDetails?: boolean;
    showRecords?: boolean;
}) {
    const data = useData<UsageRecord[]>("user/stat/getTrafficLog?days=30&page_size=100", undefined, true);
    const [period, setPeriod] = useState<"30days" | "week">(() =>
        window.matchMedia?.("(max-width: 800px)").matches ? "week" : "30days");
    const days = usageDays(data.data || [], period);
    const [selectedDate, setSelectedDate] = useState<number | null>(null);
    const selectedDay = days.find((day) => day.date.getTime() === selectedDate) || days[days.length - 1];
    const bars = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (bars.current) bars.current.scrollLeft = bars.current.scrollWidth;
    }, [period]);
    const max = Math.max(1, ...days.map((day) => day.upload + day.download));
    const formatDate = (date: Date) =>
        date.toLocaleDateString(locale(), { month: "short", day: "numeric" });
    return (
        <section className="usage-analysis">
            <header>
                <h2>{e("usageAnalysis")}</h2>
                <div
                    className="usage-period"
                    role="group"
                    aria-label={tx("日期")}
                >
                    {(["week", "30days"] as const).map((value) => (
                        <button
                            key={value}
                            aria-pressed={period === value}
                            onClick={() => setPeriod(value)}
                        >
                            {value === "week" ? e("week") : tx("近30天")}
                        </button>
                    ))}
                </div>
            </header>
            <div className="usage-section-title">
                <h3>{e("dailyUsage")}</h3>
                {showDetails && <a href="#/traffic">{tx("使用情况")}</a>}
            </div>
            <p className="muted usage-scope">
                {tx("按日汇总近{{days}}天上传与下载用量，包含今天。", {
                    days: period === "week" ? 7 : 30,
                })}
            </p>
            <State {...data} retry={data.reload}>
                {data.data?.length ? (
                    <>
                        <div className="usage-legend">
                            <span>
                                <i className="download-dot" />
                                {tx("下载")}
                            </span>
                            <span>
                                <i className="upload-dot" />
                                {tx("上传")}
                            </span>
                        </div>
                        <div className="usage-chart">
                            <div className="usage-axis">
                                <span>{bytes(max)}</span>
                                <span>0 B</span>
                            </div>
                            <div className="usage-bars" ref={bars}>
                                {days.map((day) => {
                                    const label = `${formatDate(day.date)} · ${tx("上传")} ${bytes(day.upload)} · ${tx("下载")} ${bytes(day.download)}`;
                                    return (
                                        <button
                                            type="button"
                                            className="usage-day"
                                            key={day.date.getTime()}
                                            aria-pressed={selectedDay === day}
                                            onClick={() => setSelectedDate(day.date.getTime())}
                                            aria-label={label}
                                        >
                                            <span
                                                className="usage-stack"
                                                style={{
                                                    height: `${((day.upload + day.download) / max) * 100}%`,
                                                }}
                                            >
                                                <i
                                                    className="upload-bar"
                                                    style={{
                                                        flexGrow: day.upload,
                                                    }}
                                                />
                                                <i
                                                    className="download-bar"
                                                    style={{
                                                        flexGrow: day.download,
                                                    }}
                                                />
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <p className="usage-selected-detail" aria-live="polite" aria-atomic="true">
                            {formatDate(selectedDay.date)} · {tx("上传")} {bytes(selectedDay.upload)} · {tx("下载")} {bytes(selectedDay.download)}
                        </p>
                        <div className="usage-dates">
                            <span>{formatDate(days[0].date)}</span>
                            <span>
                                {formatDate(days[days.length - 1].date)}
                            </span>
                        </div>
                    </>
                ) : (
                    <div className="usage-empty">{tx("暂无数据")}</div>
                )}
            </State>
            {showRecords && !!data.data?.length && (
                <details className="usage-records">
                    <summary>{b("usageDetails")}</summary>
                    <Table compact
                        data={data.data.filter(
                            (row) =>
                                Number(row.record_at) >=
                                days[0].date.getTime() / 1000,
                        )}
                        columns={[
                            [
                                "record_at",
                                tx("日期"),
                                (row) => date(row.record_at),
                            ],
                            ["u", tx("上传"), (row) => bytes(row.u)],
                            ["d", tx("下载"), (row) => bytes(row.d)],
                            ["server_rate", tx("倍率")],
                        ]}
                    />
                </details>
            )}
        </section>
    );
}
