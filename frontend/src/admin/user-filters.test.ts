// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
vi.hoisted(() => { window.V2BOARD = { mode: "admin", adminPath: "test-admin" } as any; });
import { configureTimeZone, setDisplayTimeZone } from "../shared/timezone";
import { normalizeUserFilters, emailSearchFilters } from "./user-filters";
describe("user filters", () => {
    it("retains zero and GiB units for server conversion", () => {
        expect(
            normalizeUserFilters([
                { key: "d", condition: ">=", value: 0 },
                { key: "transfer_enable", condition: ">", value: 1.5 },
            ]),
        ).toEqual([
            { key: "d", condition: ">=", value: 0 },
            { key: "transfer_enable", condition: ">", value: 1.5 },
        ]);
    });
    it("converts wall-clock dates in the configured time zone into Unix seconds", () => {
        configureTimeZone("UTC", true);
        expect(
            normalizeUserFilters([
                {
                    key: "expired_at",
                    condition: "<",
                    value: "2026-10-01T00:00",
                },
            ])[0].value,
        ).toBe(1790812800);
        expect(normalizeUserFilters([{ key: "created_at", condition: ">=", value: "2026-10-01T00:00" }])[0].value).toBe(1790812800);
    });
    it("rejects unsupported fields, conditions and missing values", () => {
        for (const filter of [
            { key: "password", condition: "=", value: "x" },
            { key: "token", condition: "模糊", value: "x" },
            { key: "email", condition: "=", value: " " },
            { key: "d", condition: ">", value: -1 },
        ])
            expect(() => normalizeUserFilters([filter])).toThrow();
    });
    it("replaces the email criterion while retaining other filters", () => {
        const filters = [
            { key: "banned", condition: "=", value: 0 },
            { key: "email", condition: "=", value: "old" },
        ];
        expect(emailSearchFilters(filters, " new ")).toEqual([
            filters[0],
            { key: "email", condition: "模糊", value: "new" },
        ]);
        expect(emailSearchFilters(filters, "")).toEqual([filters[0]]);
    });
});

it("preserves ISO filter instants and rejects impossible or ambiguous local dates", () => {
    configureTimeZone("Asia/Kathmandu", true);
    const at = Date.parse("2026-10-19T00:00:37Z") / 1000;
    expect(normalizeUserFilters([{ key: "created_at", condition: ">=", value: "2026-10-19T00:00:37Z" }])[0].value).toBe(at);
    expect(normalizeUserFilters([{ key: "expired_at", condition: "<", value: "2026-10-19T05:45:37" }])[0].value).toBe(at);
    expect(() => normalizeUserFilters([{ key: "expired_at", condition: "<", value: 9999999999999999 }])).toThrow();
    configureTimeZone("America/New_York", true);
    expect(() => normalizeUserFilters([{ key: "expired_at", condition: "<", value: "2026-11-01T01:30:37" }])).toThrow();
    configureTimeZone("Asia/Shanghai", true);
});

it("restores ISO user-filter values in the system zone and preserves seconds on apply", async () => {
    const { createElement } = await import("react");
    const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
    const { UserFilters } = await import("./UserFilters");
    configureTimeZone("Asia/Kathmandu", true);
    setDisplayTimeZone("America/New_York");
    const apply = vi.fn();
    try {
        render(createElement(UserFilters, { initial: [{ key: "expired_at", condition: "<", value: "2026-10-19T00:00:37Z" }], plans: [], onApply: apply }));
        const input = screen.getByLabelText("筛选值 1") as HTMLInputElement;
        expect(input.value.replace(/\.0{1,3}$/, "")).toBe("2026-10-19T05:45:37");
        expect(input.step).toBe("1");
        expect(screen.getByText(/系统业务时区 Asia\/Kathmandu/)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
        expect(apply).toHaveBeenCalledWith([{ key: "expired_at", condition: "<", value: Date.parse("2026-10-19T00:00:37Z") / 1000 }]);
    } finally { cleanup(); setDisplayTimeZone(null); configureTimeZone("Asia/Shanghai", true); }
});

it("preserves the original repeated-hour instant for each user filter", async () => {
    const { createElement } = await import("react");
    const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
    const { UserFilters } = await import("./UserFilters");
    configureTimeZone("America/New_York", true);
    const initial = [
        { key: "expired_at", condition: ">=", value: Date.parse("2026-11-01T05:30:37Z") / 1000 },
        { key: "expired_at", condition: "<", value: Date.parse("2026-11-01T06:30:37Z") / 1000 },
    ];
    const apply = vi.fn();
    try {
        render(createElement(UserFilters, { initial, plans: [], onApply: apply }));
        fireEvent.change(screen.getByLabelText("筛选值 2"), { target: { value: "2026-11-01T01:30:37.000" } });
        fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
        expect(apply).toHaveBeenCalledWith(initial);
        fireEvent.change(screen.getByLabelText("筛选值 2"), { target: { value: "2026-11-01T01:31:37" } });
        fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
        expect(screen.getByRole("alert").textContent).toContain("夏令时重复");
        expect(apply).toHaveBeenCalledTimes(1);
    } finally { cleanup(); configureTimeZone("Asia/Shanghai", true); }
});
