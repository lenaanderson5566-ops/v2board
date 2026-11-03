// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("../shared/api", () => ({ boot: { mode: "user" } }));
import i18n from "../shared/i18n";
import { NodeList, nodeName } from "./NodeList";
afterEach(cleanup);
it("uses translated names, Chinese SVG for TW and tags instead of protocols", async () => {
    await i18n.changeLanguage("zh-CN");
    const { container } = render(
        <NodeList
            nodes={[
                {
                    name: "Legacy",
                    type: "vless",
                    region_code: "TW",
                    display_names: { "zh-CN": "中国台湾 · 台北 · A" },
                    tags: ["流媒体", "低延迟", "流媒体"],
                    rate: 1,
                    is_online: true,
                },
            ]}
        />,
    );
    expect(screen.getByText("中国台湾 · 台北 · A")).toBeTruthy();
    expect(screen.getAllByText("流媒体")).toHaveLength(1);
    expect(screen.getByText("低延迟")).toBeTruthy();
    expect(screen.getByText("标签 / 备注")).toBeTruthy();
    expect(screen.queryByText("vless")).toBeNull();
    expect(screen.queryByText("协议")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
        "cn.svg",
    );
});
it("falls back to English and original names without displaying internal IDs", () => {
    expect(
        nodeName(
            { name: "Legacy", display_names: { "en-US": "United States" } },
            "ja-JP",
        ),
    ).toBe("United States");
    expect(nodeName({ name: "Legacy" }, "zh-CN")).toBe("Legacy");
});
it("handles missing countries and tags with a neutral fallback", () => {
    const { container } = render(
        <NodeList
            nodes={[{ name: "Legacy", region_code: "../../bad", tags: null }]}
        />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Legacy")).toBeTruthy();
});

it("opens full node information from the accessible name button", async () => {
    await i18n.changeLanguage("zh-CN");
    const name = "台北 · 这个节点名称在狭窄屏幕上会缩略显示 · 高速线路 A";
    const tag = "备用连接与流媒体长标签，不丢失原有说明";
    render(<NodeList nodes={[{ name, tags: [tag, tag, "低延迟"], rate: 1.25, is_online: false }]} />);
    const trigger = screen.getByRole("button", { name });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    trigger.focus();
    fireEvent.click(trigger);
    const detail = screen.getByRole("dialog", { name });
    expect(within(detail).getAllByText(tag)).toHaveLength(1);
    expect(within(detail).getByText("低延迟")).toBeTruthy();
    expect(within(detail).getByText("1.25×")).toBeTruthy();
    expect(within(detail).getByText("离线")).toBeTruthy();
    fireEvent.click(within(detail).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
});

it("bundles valid SVG flags and keeps TW identical to CN", () => {
    const assets = import.meta.glob<string>("./assets/flags/*.svg", {
        eager: true,
        query: "?raw",
        import: "default",
    });
    for (const svg of Object.values(assets))
        expect(svg.trim().startsWith("<svg")).toBe(true);
    expect(assets["./assets/flags/tw.svg"]).toBe(
        assets["./assets/flags/cn.svg"],
    );
});

it("preserves small billing multipliers and formats them with the interface locale", async () => {
    await i18n.changeLanguage("de-DE");
    render(<NodeList nodes={[
        { name: "Small", rate: "0.00001" },
        { name: "Precise", rate: "1.2300" },
        { name: "Free", rate: 0 },
    ]} />);
    expect(screen.getByText("0,00001×")).toBeTruthy();
    expect(screen.getByText("1,23×")).toBeTruthy();
    expect(screen.getByText("0×")).toBeTruthy();
});
