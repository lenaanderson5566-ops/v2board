// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ClientUaStats } from "./ClientUaStats";
afterEach(cleanup);

it("shows a single UA directly without a disclosure", () => {
    const { container } = render(
        <ClientUaStats items={[{ ua: "FastAI/1.0.0", count_24h: 3 }]} />,
    );
    expect(screen.getByText(/FastAI\/1.0.0/)).toBeTruthy();
    expect(container.querySelector("details")).toBeNull();
});

it("groups multiple UAs once and explains their statistics window", () => {
    const { container } = render(
        <ClientUaStats
            items={[
                { ua: "FastAI/1.0.0", count_24h: 3 },
                { ua: "FastAI/1.0.1", count_24h: 0 },
            ]}
        />,
    );
    expect(container.querySelectorAll("details").length).toBe(1);
    expect(screen.getByText("2 种 UA · 查看明细")).toBeTruthy();
    expect(screen.getByText(/最近 30 天出现过/)).toBeTruthy();
});
