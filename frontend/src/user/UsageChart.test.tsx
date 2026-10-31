// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("../shared/api", () => ({ bytes: (n: number) => `${n} B`, date: String }));
vi.mock("../shared/i18n", () => ({ tx: (s: string) => s, locale: () => "en-US" }));
vi.mock("../shared/experience-copy", () => ({ e: (s: string) => s }));
vi.mock("../shared/billing-copy", () => ({ b: (s: string) => s }));
vi.mock("../shared/ui", () => ({
    useData: () => ({ data: mocks.rows }),
    State: ({ children }: any) => children,
    Table: ({data, columns}: any) => <table><tbody>{data.map((row: any, index: number) => <tr key={index}>{columns.map(([key, ,render]: any) => <td key={key}>{render ? render(row) : row[key]}</td>)}</tr>)}</tbody></table>,
}));
import { UsageChart } from "./UsageChart";
import { configureTimeZone, setDisplayTimeZone } from "../shared/timezone";
beforeEach(() => {
    configureTimeZone("UTC");
    mocks.rows = [{ record_at: Date.now() / 1000, u: 12, d: 34 }];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); setDisplayTimeZone(null); });
it("defaults to seven touch-selectable days on mobile and preserves the 30-day option", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { container } = render(<UsageChart />);
    expect(container.querySelectorAll(".usage-day")).toHaveLength(7);
    expect(container.querySelector(".usage-selected-detail")?.textContent).toContain("34 B");
    fireEvent.click(container.querySelector(".usage-day")!);
    expect(container.querySelector(".usage-day")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".usage-selected-detail")?.textContent).toContain("0 B");
    fireEvent.click(screen.getByRole("button", { name: "近30天" }));
    expect(container.querySelectorAll(".usage-day")).toHaveLength(30);
});
it("keeps the desktop 30-day overview", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { container } = render(<UsageChart />);
    expect(container.querySelectorAll(".usage-day")).toHaveLength(30);
});

it("labels aggregate record dates consistently and filters future or invalid days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T00:30:00Z"));
    setDisplayTimeZone("America/Los_Angeles");
    mocks.rows = [
        {record_at: Date.parse("2026-10-31T00:00:00Z") / 1000, u: 12, d: 34},
        {record_at: Date.parse("2026-10-29T16:00:00Z") / 1000, business_date: "2026-10-30", record_timezone: "Asia/Shanghai", u: 2, d: 3},
        {record_at: Date.parse("2026-11-01T00:00:00Z") / 1000, u: 999, d: 999},
        {record_at: NaN, u: 888, d: 888},
    ];
    render(<UsageChart showRecords />);
    expect(screen.getByText("10/31/2026 · UTC")).toBeTruthy();
    expect(screen.getByText("10/30/2026 · Asia/Shanghai")).toBeTruthy();
    expect(screen.queryByText(/undefined|999 B|888 B/)).toBeNull();
    expect(screen.getByText(/按统计日汇总/)).toBeTruthy();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
});
