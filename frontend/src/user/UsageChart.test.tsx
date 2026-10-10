// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("../shared/api", () => ({ bytes: (n: number) => `${n} B`, date: String }));
vi.mock("../shared/i18n", () => ({ tx: (s: string) => s, locale: () => "en-US" }));
vi.mock("../shared/experience-copy", () => ({ e: (s: string) => s }));
vi.mock("../shared/billing-copy", () => ({ b: (s: string) => s }));
vi.mock("../shared/ui", () => ({
    useData: () => ({ data: [{ record_at: Date.now() / 1000, u: 12, d: 34 }] }),
    State: ({ children }: any) => children,
    Table: () => null,
}));
import { UsageChart } from "./UsageChart";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
